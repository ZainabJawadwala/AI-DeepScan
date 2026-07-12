"""
app.py — Flask backend for AI Deepfake Detector.
"""

import os
import json
import uuid
import io
from datetime import datetime

from flask import (
    Flask, render_template, request, jsonify,
    redirect, url_for, flash, session, send_file,
)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin, login_user,
    logout_user, login_required, current_user,
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from predict import predict
import traceback

# ── App setup ──────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(__file__)
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "bmp", "gif"}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "deepfake-dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///deepfake.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = "login"

# ── Models ─────────────────────────────────────────────────────────────────

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    scans = db.relationship("Scan", backref="user", lazy=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Scan(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    scan_id = db.Column(db.String(36), unique=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    filename = db.Column(db.String(256))
    original_filename = db.Column(db.String(256))
    label = db.Column(db.String(20))
    confidence = db.Column(db.Float)
    fake_prob = db.Column(db.Float)
    real_prob = db.Column(db.Float)
    explanation = db.Column(db.Text)
    chart_b64 = db.Column(db.Text)
    heatmap_b64 = db.Column(db.Text)
    scanned_at = db.Column(db.DateTime, default=datetime.utcnow)


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


# ── Helpers ────────────────────────────────────────────────────────────────

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ── Routes ─────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    history = []
    if current_user.is_authenticated:
        history = (
            Scan.query.filter_by(user_id=current_user.id)
            .order_by(Scan.scanned_at.desc())
            .limit(20)
            .all()
        )
    return render_template("index.html", history=history)


@app.route("/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No file selected."}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "Unsupported file type."}), 400

    original_name = secure_filename(file.filename)
    unique_name = f"{uuid.uuid4().hex}_{original_name}"
    save_path = os.path.join(UPLOAD_FOLDER, unique_name)
    file.save(save_path)

    try:
        result = predict(save_path)
    except RecursionError as e:
        app.logger.exception('RecursionError during prediction')
        traceback.print_exc()
        return jsonify({"error": "Prediction failed: maximum recursion depth exceeded"}), 500
    except Exception as e:
        app.logger.exception('Prediction error')
        traceback.print_exc()
        return jsonify({"error": f"Prediction failed: {str(e)}"}), 500

    # Persist scan
    scan = Scan(
        filename=unique_name,
        original_filename=original_name,
        user_id=current_user.id if current_user.is_authenticated else None,
        label=result["label"],
        confidence=result["confidence"],
        fake_prob=result["fake_prob"],
        real_prob=result["real_prob"],
        explanation=result["explanation"],
        chart_b64=result["chart_b64"],
        heatmap_b64=result.get("heatmap_b64"),
    )
    db.session.add(scan)
    db.session.commit()

    return jsonify({
        "scan_id": scan.scan_id,
        "label": result["label"],
        "confidence": result["confidence"],
        "fake_prob": result["fake_prob"],
        "real_prob": result["real_prob"],
        "explanation": result["explanation"],
        "chart_b64": result["chart_b64"],
        "heatmap_b64": result.get("heatmap_b64"),
        "image_url": url_for("static", filename=f"uploads/{unique_name}"),
        "scanned_at": scan.scanned_at.strftime("%b %d, %Y %H:%M"),
    })


@app.route("/report/<scan_id>")
def download_report(scan_id):
    scan = Scan.query.filter_by(scan_id=scan_id).first_or_404()

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        import base64, tempfile

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=2*cm, bottomMargin=2*cm)
        styles = getSampleStyleSheet()
        story = []

        title_style = ParagraphStyle("title", parent=styles["Title"], fontSize=22, spaceAfter=6)
        sub_style = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#666666"))
        body_style = ParagraphStyle("body", parent=styles["Normal"], fontSize=11, leading=16)
        verdict_color = colors.HexColor("#d32f2f") if scan.label == "AI Generated" else colors.HexColor("#2e7d32")
        verdict_style = ParagraphStyle("verdict", parent=styles["Normal"], fontSize=16, textColor=verdict_color, fontName="Helvetica-Bold")

        story.append(Paragraph("AI Deepfake Detector", title_style))
        story.append(Paragraph(f"Scan Report — {scan.scanned_at.strftime('%B %d, %Y at %H:%M UTC')}", sub_style))
        story.append(Spacer(1, 0.5*cm))

        story.append(Paragraph(f"Verdict: {scan.label}", verdict_style))
        story.append(Spacer(1, 0.3*cm))

        table_data = [
            ["File", scan.original_filename],
            ["Scan ID", scan.scan_id],
            ["Confidence", f"{scan.confidence:.1f}%"],
            ["AI Generated Probability", f"{scan.fake_prob * 100:.1f}%"],
            ["Real Probability", f"{scan.real_prob * 100:.1f}%"],
        ]
        tbl = Table(table_data, colWidths=[5*cm, 11*cm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f0f0")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 0.5*cm))

        story.append(Paragraph("AI Analysis", styles["Heading2"]))
        story.append(Paragraph(scan.explanation, body_style))
        story.append(Spacer(1, 0.5*cm))

        # Embed probability chart
        if scan.chart_b64:
            chart_bytes = base64.b64decode(scan.chart_b64)
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            tmp.write(chart_bytes)
            tmp.close()
            story.append(Paragraph("Probability Chart", styles["Heading2"]))
            story.append(RLImage(tmp.name, width=12*cm, height=4*cm))
            story.append(Spacer(1, 0.3*cm))

        story.append(Spacer(1, 1*cm))
        story.append(Paragraph(
            "Generated by AI Deepfake Detector · For informational purposes only",
            ParagraphStyle("footer", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#999999"))
        ))

        doc.build(story)
        buf.seek(0)
        return send_file(
            buf,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"deepfake_report_{scan.scan_id[:8]}.pdf",
        )
    except ImportError:
        return jsonify({"error": "reportlab not installed. Run: pip install reportlab"}), 500


@app.route("/history")
@login_required
def history():
    scans = (
        Scan.query.filter_by(user_id=current_user.id)
        .order_by(Scan.scanned_at.desc())
        .all()
    )
    return jsonify([{
        "scan_id": s.scan_id,
        "original_filename": s.original_filename,
        "label": s.label,
        "confidence": s.confidence,
        "scanned_at": s.scanned_at.strftime("%b %d, %Y %H:%M"),
        "image_url": url_for("static", filename=f"uploads/{s.filename}"),
    } for s in scans])


@app.route("/history/delete/<scan_id>", methods=["DELETE"])
@login_required
def delete_scan(scan_id):
    scan = Scan.query.filter_by(scan_id=scan_id, user_id=current_user.id).first_or_404()
    file_path = os.path.join(UPLOAD_FOLDER, scan.filename)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass
    db.session.delete(scan)
    db.session.commit()
    return jsonify({"message": "Scan deleted.", "scan_id": scan_id})


# ── Auth routes ────────────────────────────────────────────────────────────

@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    if User.query.filter_by(username=data["username"]).first():
        return jsonify({"error": "Username already taken."}), 409
    if User.query.filter_by(email=data["email"]).first():
        return jsonify({"error": "Email already registered."}), 409
    user = User(username=data["username"], email=data["email"])
    user.set_password(data["password"])
    db.session.add(user)
    db.session.commit()
    login_user(user)
    return jsonify({"message": "Registered!", "username": user.username})


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.is_json:
        data = request.get_json()
        user = User.query.filter_by(username=data["username"]).first()
        if user and user.check_password(data["password"]):
            login_user(user, remember=data.get("remember", False))
            return jsonify({"message": "Logged in!", "username": user.username})
        return jsonify({"error": "Invalid credentials."}), 401
    return render_template("index.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Logged out."})


@app.route("/me")
def me():
    if current_user.is_authenticated:
        return jsonify({"logged_in": True, "username": current_user.username})
    return jsonify({"logged_in": False})


# ── Init ───────────────────────────────────────────────────────────────────

with app.app_context():
    db.create_all()

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=os.environ.get("FLASK_DEBUG", "0") == "1",
    )