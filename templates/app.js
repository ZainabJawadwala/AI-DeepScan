/* ── State ─────────────────────────────────────────────────── */
let currentFile = null;
let currentScanId = null;
let isLoggedIn = false;
let currentUsername = '';

/* ── DOM helpers ───────────────────────────────────────────── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* ── Init ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupUpload();
  setupAuth();
  checkSession();
});

/* ── Session check ─────────────────────────────────────────── */
async function checkSession() {
  try {
    const res = await fetch('/me');
    const data = await res.json();
    if (data.logged_in) {
      isLoggedIn = true;
      currentUsername = data.username;
      updateNavAuth();
      loadHistory();
    }
  } catch {}
}

/* ── Upload & Drag-Drop ────────────────────────────────────── */
function setupUpload() {
  const zone = $('#upload-zone');
  const input = $('#file-input');

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', e => handleFile(e.target.files[0]));

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  $('#btn-analyze').addEventListener('click', analyzeImage);
  $('#btn-clear').addEventListener('click', clearAll);
  $('#btn-download-report').addEventListener('click', downloadReport);
  $('#btn-scan-again').addEventListener('click', clearAll);
}

function handleFile(file) {
  if (!file) return;
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];
  if (!allowed.includes(file.type)) {
    showToast('Unsupported format. Use JPG, PNG, WEBP, or BMP.', 'error');
    return;
  }
  if (file.size > 16 * 1024 * 1024) {
    showToast('File too large. Max 16 MB.', 'error');
    return;
  }

  currentFile = file;
  const url = URL.createObjectURL(file);
  $('#preview-original').src = url;
  $('#preview-filename').textContent = file.name;

  $('#preview-section').style.display = 'block';
  $('#result-section').style.display = 'none';
  $('#heatmap-panel').style.display = 'none';
  $('#heatmap-img').src = '';

  // Smooth scroll to preview
  setTimeout(() => $('#preview-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

/* ── Analyze ───────────────────────────────────────────────── */
async function analyzeImage() {
  if (!currentFile) return;

  const btn = $('#btn-analyze');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analyzing…';

  const form = new FormData();
  form.append('image', currentFile);

  try {
    const res = await fetch('/analyze', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Analysis failed.', 'error'); return; }

    displayResult(data);
    currentScanId = data.scan_id;

    if (isLoggedIn) loadHistory();
  } catch (err) {
    showToast('Network error. Is the server running?', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔍 Analyze Image';
  }
}

function displayResult(data) {
  const isFake = data.label === 'AI Generated';
  const section = $('#result-section');
  const card = $('#verdict-card');

  // Verdict
  card.className = `verdict-card ${isFake ? 'fake' : 'real'}`;
  $('#verdict-icon').textContent = isFake ? '⚠️' : '✅';
  $('#verdict-label').textContent = data.label;
  $('#verdict-label').className = `verdict-label ${isFake ? 'fake' : 'real'}`;
  $('#confidence-pill').textContent = `${data.confidence.toFixed(1)}%`;
  $('#confidence-pill').className = `confidence-pill`;

  // Bar
  $('#conf-bar-label').textContent = `Confidence: ${data.confidence.toFixed(1)}%`;
  setTimeout(() => { $('#conf-bar-fill').style.width = `${data.confidence}%`; }, 50);

  // Probability chart
  if (data.chart_b64) {
    $('#chart-img').src = `data:image/png;base64,${data.chart_b64}`;
  }

  // Heatmap
  if (data.heatmap_b64) {
    $('#heatmap-img').src = `data:image/png;base64,${data.heatmap_b64}`;
    $('#heatmap-panel').style.display = 'block';
  } else {
    $('#heatmap-panel').style.display = 'block';
    $('#heatmap-img').style.display = 'none';
    $('#heatmap-placeholder').style.display = 'flex';
  }

  // Explanation
  $('#explanation-text').textContent = data.explanation;

  section.style.display = 'block';
  setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function clearAll() {
  currentFile = null;
  currentScanId = null;
  $('#file-input').value = '';
  $('#preview-section').style.display = 'none';
  $('#result-section').style.display = 'none';
  $('#upload-zone').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function downloadReport() {
  if (!currentScanId) return;
  window.open(`/report/${currentScanId}`, '_blank');
}

/* ── History ───────────────────────────────────────────────── */
async function loadHistory() {
  if (!isLoggedIn) return;
  try {
    const res = await fetch('/history');
    const scans = await res.json();
    renderHistory(scans);
  } catch {}
}

function renderHistory(scans) {
  const container = $('#history-grid');
  if (!scans.length) {
    container.innerHTML = `
      <div class="history-empty" style="grid-column:1/-1">
        <div class="empty-icon">🔍</div>
        <div>No scans yet. Upload an image to get started.</div>
      </div>`;
    return;
  }

  container.innerHTML = scans.map(s => `
    <div class="history-item" onclick="viewScanDetails('${s.scan_id}')">
      <div class="history-thumb">
        <img src="${s.image_url}" alt="${s.original_filename}" loading="lazy"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      </div>
      <div class="history-meta">
        <div class="history-verdict ${s.label === 'AI Generated' ? 'fake' : 'real'}">
          ${s.label === 'AI Generated' ? '⚠ FAKE' : '✓ REAL'}
        </div>
        <div class="history-name">${escHtml(s.original_filename)}</div>
        <div class="history-time">${s.scanned_at}</div>
      </div>
    </div>
  `).join('');
}

function viewScanDetails(scanId) {
  window.open(`/report/${scanId}`, '_blank');
}

/* ── Auth ──────────────────────────────────────────────────── */
function setupAuth() {
  $('#btn-open-auth').addEventListener('click', () => showModal('login'));
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) closeModal(); });

  $$('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.tab;
      $('#form-login').style.display = mode === 'login' ? 'block' : 'none';
      $('#form-register').style.display = mode === 'register' ? 'block' : 'none';
    });
  });

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('.btn-form');
    btn.textContent = 'Signing in…';
    btn.disabled = true;

    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: $('#login-username').value,
        password: $('#login-password').value,
      }),
    });
    const data = await res.json();
    btn.textContent = 'Sign In'; btn.disabled = false;

    if (!res.ok) { $('#login-error').textContent = data.error; return; }
    isLoggedIn = true; currentUsername = data.username;
    closeModal(); updateNavAuth(); loadHistory();
    showToast(`Welcome back, ${data.username}!`, 'success');
  });

  $('#form-register').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('.btn-form');
    btn.textContent = 'Creating account…'; btn.disabled = true;

    const res = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: $('#reg-username').value,
        email: $('#reg-email').value,
        password: $('#reg-password').value,
      }),
    });
    const data = await res.json();
    btn.textContent = 'Create Account'; btn.disabled = false;

    if (!res.ok) { $('#reg-error').textContent = data.error; return; }
    isLoggedIn = true; currentUsername = data.username;
    closeModal(); updateNavAuth(); loadHistory();
    showToast(`Account created! Welcome, ${data.username}!`, 'success');
  });
}

function showModal(tab = 'login') {
  $('#modal-overlay').classList.add('active');
  $$('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#form-login').style.display = tab === 'login' ? 'block' : 'none';
  $('#form-register').style.display = tab === 'register' ? 'block' : 'none';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('#modal-overlay').classList.remove('active');
  document.body.style.overflow = '';
  $('#login-error').textContent = '';
  $('#reg-error').textContent = '';
}

async function logout() {
  await fetch('/logout');
  isLoggedIn = false; currentUsername = '';
  updateNavAuth();
  renderHistory([]);
  showToast('Signed out.', 'success');
}

function updateNavAuth() {
  const authArea = $('#nav-auth');
  if (isLoggedIn) {
    authArea.innerHTML = `
      <span style="color:var(--text-mid);font-size:.85rem;">👤 ${escHtml(currentUsername)}</span>
      <button class="btn btn-ghost" onclick="logout()">Sign Out</button>
    `;
    $('#history-section').style.display = 'block';
  } else {
    authArea.innerHTML = `
      <button class="btn btn-ghost" id="btn-open-auth" onclick="showModal('login')">Sign In</button>
      <button class="btn btn-primary" onclick="showModal('register')">Sign Up</button>
    `;
    $('#history-section').style.display = 'none';
  }
}

/* ── Toast ─────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3200);
}

/* ── Utility ───────────────────────────────────────────────── */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}