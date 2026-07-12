Deployment and model setup for AI Deepfake Detector

Summary
- The app will run in demo mode (random predictions) if a valid Keras .h5 model is not available.
- For production predictions, upload a trained Keras model and provide its URL via the `MODEL_URL` environment variable.

Steps to prepare a model (Option A: S3 / public URL)
1. Upload `deepfake_model.h5` to S3 (or another host) and make it accessible (signed URL or public).
2. In Render dashboard, add an environment variable `MODEL_URL` pointing to the model file URL.

Steps for Render deployment
1. Ensure repository contains:
   - `requirements.txt` (includes `tensorflow-cpu` pinned for a compatible Python)
   - `render.yaml` (contains `pythonVersion: 3.11` and build/start commands)
   - `Procfile` (web process defined)
2. In Render service settings:
   - Set Runtime / Python Version to `3.11` (if not using `render.yaml`).
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 3`
   - Environment Variables:
     - `MODEL_URL` = https://.../deepfake_model.h5 (if using hosted model)
     - `FLASK_DEBUG` = `0`
3. Trigger a deploy in Render.

Testing after deploy
- Use the UI to upload an image or use `curl`:

```bash
curl -F "image=@/path/to/test.jpg" https://<your-render-url>/analyze -v
```

Local verification script
- Use `scripts/verify_model.py` to test model download and prediction locally (see file in `scripts/`).

If you run into an installation/build error on Render
- Copy the full Render build and runtime logs and paste them here. I will analyze them and patch the repo accordingly.

Notes
- I cannot access your Render dashboard directly. I prepared the repo and helper scripts; you must set `MODEL_URL` and trigger redeploy on Render.
- If you want, provide a model URL and I will test model download and prediction locally against your model.
