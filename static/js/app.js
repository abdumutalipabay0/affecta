/* ── Constants ─────────────────────────────────────────────────────────────── */

const CAPTURE_W        = 640;
const CAPTURE_H        = 480;
const ANALYZE_INTERVAL = 2000; // ms between frames sent to server

const EMOTION_COLORS = {
  happy:    '#4ade80',
  sad:      '#60a5fa',
  angry:    '#f87171',
  fear:     '#c084fc',
  surprise: '#fbbf24',
  neutral:  '#e2e8f0',
  disgust:  '#fb923c',
};

const EMOTION_EMOJI = {
  happy:    '😊',
  sad:      '😢',
  angry:    '😠',
  fear:     '😨',
  surprise: '😲',
  neutral:  '😐',
  disgust:  '🤢',
};

// Y-axis order (bottom → top)
const EMOTION_ORDER = ['neutral', 'disgust', 'fear', 'sad', 'surprise', 'angry', 'happy'];

/* ── DOM refs ──────────────────────────────────────────────────────────────── */

const videoEl        = document.getElementById('video');
const overlayCanvas  = document.getElementById('overlay');
const overlayCtx     = overlayCanvas.getContext('2d');

const loadingOverlay = document.getElementById('loadingOverlay');

const statusDot      = document.getElementById('statusDot');
const statusLabel    = document.getElementById('statusLabel');

const emotionEmoji   = document.getElementById('emotionEmoji');
const emotionName    = document.getElementById('emotionName');
const confFill       = document.getElementById('confFill');
const confValue      = document.getElementById('confValue');
const lowConfBadge   = document.getElementById('lowConfBadge');

const sessionStatus  = document.getElementById('sessionStatus');
const recDot         = document.getElementById('recDot');
const sessionTimeEl  = document.getElementById('sessionTime');
const sampleCountEl  = document.getElementById('sampleCount');

const startBtn       = document.getElementById('startBtn');
const stopBtn        = document.getElementById('stopBtn');

const statsModal     = document.getElementById('statsModal');
const closeStatsBtn  = document.getElementById('closeStats');

const legendEl       = document.getElementById('timelineLegend');

/* ── Capture canvas (hidden, fixed size) ───────────────────────────────────── */

const captureCanvas = document.createElement('canvas');
captureCanvas.width  = CAPTURE_W;
captureCanvas.height = CAPTURE_H;
const captureCtx = captureCanvas.getContext('2d');

/* ── State ─────────────────────────────────────────────────────────────────── */

let isAnalyzing      = false;
let sessionActive    = false;
let sessionStartTime = null;
let sessionTimer     = null;
let analyzeTimer     = null;
let sampleCount      = 0;
let seenEmotions     = new Set();
let timelineChart    = null;
let pieChart         = null;
let serverReady      = false;
let statusPollTimer  = null;

/* ── Server readiness poll ─────────────────────────────────────────────────── */

function startStatusPoll() {
  statusPollTimer = setInterval(async () => {
    try {
      const res  = await fetch('/status');
      const data = await res.json();
      if (data.ready) {
        serverReady = true;
        clearInterval(statusPollTimer);
        setServerStatus('ready', 'DeepFace ready');
        loadingOverlay.classList.add('hidden');
      } else {
        setServerStatus('loading', 'Loading models…');
      }
    } catch {
      setServerStatus('error', 'Server unreachable');
    }
  }, 1500);
}

function setServerStatus(state, label) {
  statusDot.className   = `status-dot ${state}`;
  statusLabel.textContent = label;
}

/* ── Camera ────────────────────────────────────────────────────────────────── */

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: CAPTURE_W }, height: { ideal: CAPTURE_H }, facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    analyzeTimer = setInterval(analyzeFrame, ANALYZE_INTERVAL);
  } catch (err) {
    setServerStatus('error', `Camera: ${err.message}`);
    loadingOverlay.querySelector('p').textContent = `Camera error: ${err.message}`;
  }
}

/* ── Frame capture & analysis ──────────────────────────────────────────────── */

function captureFrame() {
  captureCtx.drawImage(videoEl, 0, 0, CAPTURE_W, CAPTURE_H);
  return captureCanvas.toDataURL('image/jpeg', 0.82);
}

async function analyzeFrame() {
  if (isAnalyzing) return;
  isAnalyzing = true;

  try {
    const image = captureFrame();
    const res   = await fetch('/analyze', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image }),
    });

    if (!res.ok) return;
    const data = await res.json();

    if (data.busy || data.warming_up || data.error) return;

    // Hide loading overlay on first successful response
    if (!serverReady) {
      serverReady = true;
      loadingOverlay.classList.add('hidden');
      setServerStatus('ready', `DeepFace · ${data.backend}`);
    } else if (data.backend) {
      statusLabel.textContent = `DeepFace · ${data.backend}`;
    }

    applyResult(data);

  } catch (err) {
    console.error('analyze error:', err);
  } finally {
    isAnalyzing = false;
  }
}

/* ── Apply analysis result ─────────────────────────────────────────────────── */

function applyResult(data) {
  const { emotion, confidence, region, low_confidence, logged, sample } = data;
  const color = EMOTION_COLORS[emotion] || '#e2e8f0';

  // Emotion info strip
  emotionEmoji.textContent      = EMOTION_EMOJI[emotion] || '😐';
  emotionName.textContent       = emotion.toUpperCase();
  emotionName.style.color       = color;
  confFill.style.width          = `${Math.min(confidence, 100)}%`;
  confFill.style.background     = low_confidence ? '#475569' : color;
  confValue.textContent         = `${confidence.toFixed(1)}%`;
  lowConfBadge.classList.toggle('visible', !!low_confidence);

  // Canvas face box
  drawFaceBox(region, color, low_confidence);

  // Live chart
  if (logged && sample) {
    sampleCount++;
    sampleCountEl.textContent = `${sampleCount} samples`;
    addChartPoint(emotion, confidence, sample.timestamp);
    ensureLegendItem(emotion, color);
  }
}

/* ── Canvas overlay ────────────────────────────────────────────────────────── */

function drawFaceBox(region, color, lowConf) {
  // Sync canvas buffer size to its displayed CSS size
  const dw = overlayCanvas.clientWidth;
  const dh = overlayCanvas.clientHeight;
  if (overlayCanvas.width !== dw)  overlayCanvas.width  = dw;
  if (overlayCanvas.height !== dh) overlayCanvas.height = dh;

  overlayCtx.clearRect(0, 0, dw, dh);

  if (!region || region.w <= 0 || region.h <= 0) return;

  // Reject whole-image boxes (no face detected with enforce_detection=False)
  if (region.w > CAPTURE_W * 0.9 || region.h > CAPTURE_H * 0.9) return;

  const sx = dw / CAPTURE_W;
  const sy = dh / CAPTURE_H;
  const bx = region.x * sx;
  const by = region.y * sy;
  const bw = region.w * sx;
  const bh = region.h * sy;

  overlayCtx.globalAlpha = lowConf ? 0.4 : 0.92;
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth   = 1.5;
  overlayCtx.strokeRect(bx, by, bw, bh);

  // Corner L-accents
  const arm = Math.min(bw, bh) / 6;
  overlayCtx.lineWidth = 3;
  [
    [bx,      by,      1,  1],
    [bx + bw, by,     -1,  1],
    [bx,      by + bh, 1, -1],
    [bx + bw, by + bh,-1, -1],
  ].forEach(([cx, cy, dx, dy]) => {
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx, cy);
    overlayCtx.lineTo(cx + dx * arm, cy);
    overlayCtx.stroke();
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx, cy);
    overlayCtx.lineTo(cx, cy + dy * arm);
    overlayCtx.stroke();
  });

  overlayCtx.globalAlpha = 1;
}

/* ── Chart.js timeline ─────────────────────────────────────────────────────── */

function initChart() {
  const ctx = document.getElementById('timelineChart').getContext('2d');

  timelineChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        data:                [],
        pointBackgroundColor: [],
        pointBorderColor:     [],
        pointBorderWidth:     2,
        pointRadius:          [],
        pointHoverRadius:     [],
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor:  'rgba(7,7,17,.96)',
          borderColor:      'rgba(255,255,255,.1)',
          borderWidth:      1,
          padding:          12,
          cornerRadius:     10,
          callbacks: {
            title(items) {
              const s = Math.round(items[0].raw.x);
              return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
            },
            label(item) {
              const d = item.raw;
              return [
                `  ${EMOTION_EMOJI[d.emotion] || ''} ${d.emotion}`,
                `  Confidence: ${d.confidence.toFixed(1)}%`,
              ];
            },
            labelColor(item) {
              const c = item.raw.color;
              return { borderColor: c, backgroundColor: c, borderRadius: 3 };
            },
          },
        },
      },
      scales: {
        x: {
          type:  'linear',
          min:   0,
          title: { display: true, text: 'Session time (s)', color: '#475569', font: { size: 11 } },
          grid:  { color: 'rgba(255,255,255,.04)' },
          border:{ color: 'rgba(255,255,255,.06)' },
          ticks: { color: '#475569', font: { family: 'Inter', size: 11 } },
        },
        y: {
          min:  -0.6,
          max:   EMOTION_ORDER.length - 0.4,
          grid:  { color: 'rgba(255,255,255,.04)' },
          border:{ color: 'rgba(255,255,255,.06)' },
          ticks: {
            color:    '#64748b',
            stepSize: 1,
            font:     { family: 'Inter', size: 11 },
            callback(v) {
              const e = EMOTION_ORDER[Math.round(v)];
              return e ? `${EMOTION_EMOJI[e] || ''} ${e}` : '';
            },
          },
        },
      },
    },
  });
}

function addChartPoint(emotion, confidence, timestamp) {
  if (!timelineChart || !sessionStartTime) return;

  const elapsed = (new Date(timestamp) - sessionStartTime) / 1000;
  const y       = EMOTION_ORDER.indexOf(emotion);
  if (y === -1) return;

  const color = EMOTION_COLORS[emotion] || '#e2e8f0';
  const ds    = timelineChart.data.datasets[0];

  ds.data.push({ x: elapsed, y, emotion, confidence, color });
  ds.pointBackgroundColor.push(color + 'cc');
  ds.pointBorderColor.push(color + '60');
  ds.pointRadius.push(5 + confidence / 20);
  ds.pointHoverRadius.push(9 + confidence / 20);

  timelineChart.update('none'); // no animation in real-time
}

function resetChart() {
  if (!timelineChart) return;
  const ds = timelineChart.data.datasets[0];
  ds.data                = [];
  ds.pointBackgroundColor = [];
  ds.pointBorderColor    = [];
  ds.pointRadius         = [];
  ds.pointHoverRadius    = [];
  timelineChart.update('none');
  legendEl.innerHTML = '';
  seenEmotions.clear();
}

function ensureLegendItem(emotion, color) {
  if (seenEmotions.has(emotion)) return;
  seenEmotions.add(emotion);
  const item = document.createElement('div');
  item.className = 'legend-item';
  item.innerHTML = `<div class="legend-dot" style="background:${color}"></div>
                    ${EMOTION_EMOJI[emotion] || ''} ${emotion}`;
  legendEl.appendChild(item);
}

/* ── Session control ───────────────────────────────────────────────────────── */

async function startSession() {
  try {
    const res  = await fetch('/session/start', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) throw new Error('Failed');

    sessionActive    = true;
    sessionStartTime = new Date(data.started_at);
    sampleCount      = 0;
    sampleCountEl.textContent = '0 samples';

    resetChart();

    startBtn.disabled = true;
    stopBtn.disabled  = false;
    recDot.classList.add('recording');
    sessionStatus.textContent = 'Recording…';

    sessionTimer = setInterval(tickSessionTime, 1000);
    tickSessionTime();

  } catch (err) {
    console.error('startSession:', err);
  }
}

async function stopSession() {
  try {
    clearInterval(sessionTimer);
    recDot.classList.remove('recording');
    sessionStatus.textContent = 'Processing…';

    const res  = await fetch('/session/stop', { method: 'POST' });
    const data = await res.json();

    sessionActive = false;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    sessionStatus.textContent = 'Session ended';

    if (data.stats) showStats(data.stats);

  } catch (err) {
    console.error('stopSession:', err);
  }
}

function tickSessionTime() {
  if (!sessionStartTime) return;
  const s = Math.floor((Date.now() - sessionStartTime) / 1000);
  const m = Math.floor(s / 60);
  sessionTimeEl.textContent =
    `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ── Statistics modal ──────────────────────────────────────────────────────── */

function showStats(stats) {
  const dom   = stats.dominant;
  const color = EMOTION_COLORS[dom] || '#c4b5fd';
  const pct   = ((stats.distribution[dom] / stats.total_samples) * 100).toFixed(0);

  document.getElementById('statDomEmoji').textContent = EMOTION_EMOJI[dom] || '';
  document.getElementById('statDomName').textContent  = dom;
  document.getElementById('statDomName').style.color  = color;
  document.getElementById('statDomPct').textContent   = `${pct}% of session`;

  const dur = stats.duration;
  const m   = Math.floor(dur / 60);
  const s   = Math.floor(dur % 60);
  document.getElementById('statDuration').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  document.getElementById('statSamples').textContent  = stats.total_samples;

  // Doughnut chart
  if (pieChart) pieChart.destroy();
  const emotions = Object.keys(stats.distribution).sort((a, b) => stats.distribution[b] - stats.distribution[a]);
  const values   = emotions.map(e => stats.distribution[e]);
  const cols     = emotions.map(e => EMOTION_COLORS[e] || '#94a3b8');
  const total    = values.reduce((a, b) => a + b, 0);

  pieChart = new Chart(document.getElementById('pieChart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels:   emotions,
      datasets: [{
        data:            values,
        backgroundColor: cols.map(c => c + 'bb'),
        borderColor:     cols,
        borderWidth:     1.5,
        hoverOffset:     8,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      cutout:              '65%',
      animation:           { animateRotate: true, duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(7,7,17,.96)',
          borderColor:     'rgba(255,255,255,.1)',
          borderWidth:     1,
          padding:         10,
          callbacks: {
            label: item => {
              const p = ((item.raw / total) * 100).toFixed(1);
              return ` ${item.label}: ${item.raw} (${p}%)`;
            },
          },
        },
      },
    },
  });

  // Pie legend
  const pieLegend = document.getElementById('pieLegend');
  pieLegend.innerHTML = '';
  emotions.forEach((e, i) => {
    const p   = ((values[i] / total) * 100).toFixed(1);
    const c   = EMOTION_COLORS[e] || '#94a3b8';
    const row = document.createElement('div');
    row.className = 'pie-row';
    row.innerHTML = `
      <div class="pie-swatch" style="background:${c}"></div>
      <span class="pie-name">${EMOTION_EMOJI[e] || ''} ${e}</span>
      <div class="pie-bar-track">
        <div class="pie-bar-fill" style="width:${p}%;background:${c}"></div>
      </div>
      <span class="pie-pct">${p}%</span>`;
    pieLegend.appendChild(row);
  });

  statsModal.classList.add('active');
}

function closeStats() {
  statsModal.classList.remove('active');
}

/* ── Init ──────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initChart();
  initCamera();
  startStatusPoll();

  startBtn.addEventListener('click', startSession);
  stopBtn.addEventListener('click',  stopSession);
  closeStatsBtn.addEventListener('click', closeStats);

  // Close modal on backdrop click
  statsModal.addEventListener('click', e => {
    if (e.target === statsModal) closeStats();
  });
});
