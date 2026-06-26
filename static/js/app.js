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
  
  if (!zone || !input) {
    console.error('Upload zone or file input not found');
    return;
  }

  zone.addEventListener('click', () => {
    console.log('Zone clicked, opening file picker');
    input.click();
  });
  
  input.addEventListener('change', e => {
    console.log('File selected:', e.target.files[0]?.name);
    handleFile(e.target.files[0]);
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) {
      console.log('File dropped:', e.dataTransfer.files[0].name);
      handleFile(e.dataTransfer.files[0]);
    }
  });

  const btnAnalyze = $('#btn-analyze');
  const btnClear = $('#btn-clear');
  const btnDownload = $('#btn-download-report');
  const btnScanAgain = $('#btn-scan-again');
  
  if (btnAnalyze) btnAnalyze.addEventListener('click', analyzeImage);
  if (btnClear) btnClear.addEventListener('click', clearAll);
  if (btnDownload) btnDownload.addEventListener('click', downloadReport);
  if (btnScanAgain) btnScanAgain.addEventListener('click', clearAll);
}

function handleFile(file) {
  if (!file) return;
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif', 'image/jpg'];
  if (!allowed.includes(file.type)) {
    showToast('Unsupported format. Use JPG, PNG, WEBP, GIF, or BMP.', 'error');
    return;
  }
  if (file.size > 16 * 1024 * 1024) {
    showToast('File too large. Max 16 MB.', 'error');
    return;
  }

  currentFile = file;
  const url = URL.createObjectURL(file);
  const previewImg = $('#preview-original');
  if (previewImg) previewImg.src = url;

  $('#preview-section').style.display = 'block';
  $('#result-section').style.display = 'none';
  $('#heatmap-panel').style.display = 'none';
  const heatmapImg = $('#heatmap-img');
  if (heatmapImg) heatmapImg.src = '';

  // Smooth scroll to preview
  setTimeout(() => $('#preview-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

/* ── Analyze ───────────────────────────────────────────────── */
async function analyzeImage() {
  if (!currentFile) {
    showToast('Please select an image first.', 'error');
    return;
  }

  const btn = $('#btn-analyze');
  if (!btn) return;
  
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analyzing…';

  const form = new FormData();
  form.append('image', currentFile);

  try {
    const res = await fetch('/analyze', { method: 'POST', body: form });
    const data = await res.json();
    
    if (!res.ok) { 
      showToast(data.error || 'Analysis failed.', 'error'); 
      return; 
    }

    displayResult(data);
    currentScanId = data.scan_id;

    if (isLoggedIn) loadHistory();
  } catch (err) {
    console.error('Upload error:', err);
    showToast('Network error. Is the server running?', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔍 Analyze Image';
  }
}

function displayResult(data) {
  const isFake = data.label === 'AI GENERATED';
  const section = $('#result-section');
  const card = $('#verdict-card');

  if (!section || !card) {
    console.error('Result section or verdict card not found');
    return;
  }

  // Verdict
  card.className = `verdict-card ${isFake ? 'fake' : 'real'}`;
  const verdictIcon = $('#verdict-icon');
  if (verdictIcon) verdictIcon.textContent = isFake ? '⚠️' : '✅';
  
  const verdictText = $('#verdict-text');
  if (verdictText) verdictText.textContent = data.label;
  
  const verdictLabel = $('#verdict-label');
  if (verdictLabel) verdictLabel.className = `verdict-label ${isFake ? 'fake' : 'real'}`;
  
  const confPill = $('#confidence-pill');
  if (confPill) {
    confPill.textContent = `${data.confidence.toFixed(1)}%`;
    confPill.className = `confidence-pill`;
  }

  // Bar
  const confBarLabel = $('#conf-bar-label');
  if (confBarLabel) confBarLabel.textContent = `Confidence: ${data.confidence.toFixed(1)}%`;
  
  setTimeout(() => { 
    const confBarFill = $('#conf-bar-fill');
    if (confBarFill) confBarFill.style.width = `${data.confidence}%`; 
  }, 50);

  // Probability chart
  if (data.chart_b64) {
    const chartImg = $('#chart-img');
    if (chartImg) chartImg.src = `data:image/png;base64,${data.chart_b64}`;
  }

  // Heatmap
  if (data.heatmap_b64) {
    const heatmapImg = $('#heatmap-img');
    if (heatmapImg) {
      heatmapImg.src = `data:image/png;base64,${data.heatmap_b64}`;
      heatmapImg.style.display = 'block';
    }
    const heatmapPanel = $('#heatmap-panel');
    if (heatmapPanel) heatmapPanel.style.display = 'block';
  } else {
    const heatmapPanel = $('#heatmap-panel');
    if (heatmapPanel) heatmapPanel.style.display = 'block';
    const heatmapImg = $('#heatmap-img');
    if (heatmapImg) heatmapImg.style.display = 'none';
    const heatmapPlaceholder = $('#heatmap-placeholder');
    if (heatmapPlaceholder) heatmapPlaceholder.style.display = 'flex';
  }

  // Explanation
  const explanationText = $('#explanation-text');
  if (explanationText) explanationText.textContent = data.explanation;

  section.style.display = 'block';
  setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function clearAll() {
  currentFile = null;
  currentScanId = null;
  const fileInput = $('#file-input');
  if (fileInput) fileInput.value = '';
  
  const previewSection = $('#preview-section');
  if (previewSection) previewSection.style.display = 'none';
  
  const resultSection = $('#result-section');
  if (resultSection) resultSection.style.display = 'none';
  
  const uploadZone = $('#upload-zone');
  if (uploadZone) uploadZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  if (!container) return;
  
  if (!scans || !scans.length) {
    container.innerHTML = `
      <div class="history-empty" style="grid-column:1/-1">
        <div class="empty-icon">🔍</div>
        <div>No scans yet. Upload an image to get started.</div>
      </div>`;
    return;
  }

  container.innerHTML = scans.map(s => `
    <div class="history-item">
      <div class="history-thumb" onclick="viewScanDetails('${s.scan_id}')">
        <img src="${s.image_url}" alt="${escHtml(s.original_filename)}" loading="lazy"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      </div>
      <div class="history-meta">
        <div class="history-verdict ${s.label === 'AI GENERATED' ? 'fake' : 'real'}">
          ${s.label === 'AI GENERATED' ? '⚠ AI GENERATED' : '✓ AUTHENTIC'}
        </div>
        <div class="history-name">${escHtml(s.original_filename)}</div>
        <div class="history-time">${s.scanned_at}</div>
        <div class="history-actions">
          <button class="btn btn-danger btn-sm" onclick="deleteScan('${s.scan_id}')">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

function viewScanDetails(scanId) {
  window.open(`/report/${scanId}`, '_blank');
}

async function deleteScan(scanId) {
  if (!confirm('Delete this scan from your history?')) return;
  try {
    const res = await fetch(`/history/delete/${scanId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to delete scan.', 'error');
      return;
    }
    showToast('Scan deleted from history.', 'success');
    loadHistory();
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Unable to delete scan right now.', 'error');
  }
}

/* ── Auth ──────────────────────────────────────────────────── */
function setupAuth() {
  const btnOpenAuth = $('#btn-open-auth');
  const modalClose = $('#modal-close');
  const modalOverlay = $('#modal-overlay');
  const formLogin = $('#form-login');
  const formRegister = $('#form-register');
  
  if (btnOpenAuth) btnOpenAuth.addEventListener('click', () => showModal('login'));
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalOverlay) modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

  $$('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.tab;
      if (formLogin) formLogin.style.display = mode === 'login' ? 'block' : 'none';
      if (formRegister) formRegister.style.display = mode === 'register' ? 'block' : 'none';
    });
  });

  if (formLogin) {
    formLogin.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('.btn-form');
      const loginUsername = $('#login-username');
      const loginPassword = $('#login-password');
      const loginError = $('#login-error');
      
      if (!btn || !loginUsername || !loginPassword) return;
      
      btn.textContent = 'Signing in…';
      btn.disabled = true;

      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.value,
          password: loginPassword.value,
        }),
      });
      const data = await res.json();
      btn.textContent = 'Sign In'; btn.disabled = false;

      if (!res.ok) { 
        if (loginError) loginError.textContent = data.error; 
        return; 
      }
      isLoggedIn = true; currentUsername = data.username;
      closeModal(); updateNavAuth(); loadHistory();
      showToast(`Welcome back, ${data.username}!`, 'success');
    });
  }

  if (formRegister) {
    formRegister.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('.btn-form');
      const regUsername = $('#reg-username');
      const regEmail = $('#reg-email');
      const regPassword = $('#reg-password');
      const regError = $('#reg-error');
      
      if (!btn || !regUsername || !regEmail || !regPassword) return;
      
      btn.textContent = 'Creating account…'; btn.disabled = true;

      const res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: regUsername.value,
          email: regEmail.value,
          password: regPassword.value,
        }),
      });
      const data = await res.json();
      btn.textContent = 'Create Account'; btn.disabled = false;

      if (!res.ok) { 
        if (regError) regError.textContent = data.error; 
        return; 
      }
      isLoggedIn = true; currentUsername = data.username;
      closeModal(); updateNavAuth(); loadHistory();
      showToast(`Account created! Welcome, ${data.username}!`, 'success');
    });
  }
}

function showModal(tab = 'login') {
  const modalOverlay = $('#modal-overlay');
  const formLogin = $('#form-login');
  const formRegister = $('#form-register');
  
  if (modalOverlay) modalOverlay.classList.add('active');
  
  $$('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (formLogin) formLogin.style.display = tab === 'login' ? 'block' : 'none';
  if (formRegister) formRegister.style.display = tab === 'register' ? 'block' : 'none';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const modalOverlay = $('#modal-overlay');
  const loginError = $('#login-error');
  const regError = $('#reg-error');
  
  if (modalOverlay) modalOverlay.classList.remove('active');
  document.body.style.overflow = '';
  if (loginError) loginError.textContent = '';
  if (regError) regError.textContent = '';
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
  const historySection = $('#history-section');
  
  if (!authArea) return;
  
  if (isLoggedIn) {
    authArea.innerHTML = `
      <span style="color:var(--text-mid);font-size:.85rem;">👤 ${escHtml(currentUsername)}</span>
      <button class="btn btn-ghost" onclick="logout()">Sign Out</button>
    `;
    if (historySection) historySection.style.display = 'block';
  } else {
    authArea.innerHTML = `
      <button class="btn btn-ghost" id="btn-open-auth" onclick="showModal('login')">Sign In</button>
      <button class="btn btn-primary" onclick="showModal('register')">Sign Up</button>
    `;
    if (historySection) historySection.style.display = 'none';
  }
}

/* ── Toast ─────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, type = '') {
  const el = $('#toast');
  if (!el) return;
  
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3200);
}

/* ── Utility ───────────────────────────────────────────────── */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}