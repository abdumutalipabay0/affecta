/* ── Affecta History ───────────────────────────────────────────────────── */

// ── Accent & colour helpers ───────────────────────────────────────────────────
const ACCENT = { ielts:'#3b82f6', pitch:'#6366f1', free:'#10b981' };
const MODE_ICON = { ielts:'🎓', pitch:'💼', free:'💬' };
const MODE_LABEL = { ielts:'IELTS Speaking', pitch:'Pitch & Interview', free:'Free Talk' };
const SUB_LABEL = {
  part1:'Part 1', part2:'Part 2', part3:'Part 3',
  pitch:'Pitch', interview:'Interview', presentation:'Presentation',
};

function hexToRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── State ─────────────────────────────────────────────────────────────────────
let allSessions  = [];
let activeFilter = 'all';
let progressChart = null;

// ── Main ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res  = await fetch('/api/sessions');
    allSessions = await res.json();
  } catch (_) {
    allSessions = [];
  }

  renderProgressOverview();
  renderSessions(allSessions);
}

// ── Progress overview ─────────────────────────────────────────────────────────
function renderProgressOverview() {
  if (!allSessions.length) return;

  const scores = [...allSessions].reverse().slice(-10).map(s => s.overall_score || 0);
  const labels = scores.map((_, i) => `#${i + 1}`);
  const accentColor = '#3b82f6';

  const ctx = document.getElementById('progressChart').getContext('2d');
  if (progressChart) progressChart.destroy();
  progressChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets:[{
        data: scores,
        borderColor: accentColor,
        backgroundColor: hexToRgba(accentColor, 0.1),
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: accentColor,
        pointBorderWidth: 0,
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display:false }, tooltip: {
        callbacks: { label: ctx => `Score: ${ctx.raw}` },
        backgroundColor: 'rgba(18,18,18,0.95)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        padding: 10,
        titleColor: '#fff',
        bodyColor: '#a1a1aa',
      }},
      scales: {
        x: { display:false },
        y: { display:false, min: 0, max: 100 },
      },
    },
  });

  // Stats
  const best   = Math.max(...allSessions.map(s => s.overall_score || 0));
  const avg    = Math.round(allSessions.reduce((s,e) => s + (e.overall_score||0), 0) / allSessions.length);
  const recent = scores.slice(-3);
  const older  = scores.slice(0, Math.max(1, scores.length - 3));
  const trend  = recent.length && older.length
    ? Math.round(recent.reduce((a,b)=>a+b,0)/recent.length - older.reduce((a,b)=>a+b,0)/older.length)
    : 0;

  document.getElementById('statBest').textContent     = best;
  document.getElementById('statAvg').textContent      = avg;
  document.getElementById('statSessions').textContent = allSessions.length;

  const trendEl     = document.getElementById('statTrend');
  const trendDelta  = document.getElementById('statTrendDelta');
  if (trend > 0) {
    trendEl.textContent   = '↑ Rising';
    trendEl.className     = 'prog-stat-val up';
    trendDelta.textContent = `+${trend} pts`;
    trendDelta.className   = 'prog-stat-delta up';
  } else if (trend < 0) {
    trendEl.textContent   = '↓ Falling';
    trendEl.className     = 'prog-stat-val down';
    trendDelta.textContent = `${trend} pts`;
    trendDelta.className   = 'prog-stat-delta down';
  } else {
    trendEl.textContent   = '→ Steady';
    trendEl.className     = 'prog-stat-val';
    trendDelta.textContent = '0 pts';
    trendDelta.className   = 'prog-stat-delta';
  }
}

// ── Filter ────────────────────────────────────────────────────────────────────
function setFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  const filtered = filter === 'all' ? allSessions : allSessions.filter(s => s.mode === filter);
  renderSessions(filtered);
}

// ── Render sessions ───────────────────────────────────────────────────────────
function renderSessions(sessions) {
  const grid = document.getElementById('sessionsGrid');
  const countEl = document.getElementById('sessionsCount');

  countEl.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  if (!sessions.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h2>${activeFilter === 'all' ? 'No sessions yet' : 'No ' + (MODE_LABEL[activeFilter] || activeFilter) + ' sessions'}</h2>
        <p>${activeFilter === 'all' ? 'Start your first session to see it here.' : 'Try this mode to see sessions here.'}</p>
        <button onclick="window.location.href='/coach'" style="
          padding:11px 24px;border-radius:10px;border:none;cursor:pointer;
          background:var(--accent);color:#fff;font-family:inherit;font-size:14px;font-weight:700">
          Start Session
        </button>
      </div>`;
    return;
  }

  grid.innerHTML = sessions.map(s => renderCard(s)).join('');
  // Draw sparklines after DOM settles
  setTimeout(() => drawSparklines(sessions), 0);
}

function renderCard(s) {
  const mode       = s.mode || 'free';
  const accent     = ACCENT[mode] || '#3b82f6';
  const icon       = MODE_ICON[mode] || '💬';
  const modeLabel  = MODE_LABEL[mode] || mode;
  const subLabel   = s.submode ? ` · ${SUB_LABEL[s.submode] || s.submode}` : '';
  const score      = s.overall_score ?? 0;
  const scoreClass = score >= 70 ? 'high' : score >= 45 ? 'mid' : 'low';
  const topic      = s.topic || 'No topic';
  const dur        = fmtDuration(s.duration);
  const fillers    = s.filler_count ?? (Array.isArray(s.filler_words) ? s.filler_words.length : 0);
  const dateStr    = s.created_at ? new Date(s.created_at).toLocaleDateString('en-US',{
    month:'short', day:'numeric', year:'numeric',
  }) : '';

  // Mini sparkline from emotion_timeline (just confidence values)
  const sparkId    = `spark-${s.id}`;

  return `
    <div class="session-card" onclick="openSession(${s.id})" style="--accent:${accent}">
      <div class="card-header">
        <div class="card-left">
          <div class="card-mode-icon ${mode}">${icon}</div>
          <div class="card-meta">
            <div class="card-mode">${modeLabel}${subLabel}</div>
            <div class="card-date">${dateStr}</div>
          </div>
        </div>
        <div class="score-badge">
          <span class="score-badge-val ${scoreClass}">${score}</span>
        </div>
      </div>
      <div class="card-topic">${escHtml(topic)}</div>
      <div class="card-stats">
        <div class="card-stat">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="6" cy="6" r="5"/><polyline points="6 3 6 6 8 7"/>
          </svg>
          ${dur}
        </div>
        <div class="card-stat">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 9 Q4 4 6 6 Q8 8 10 3"/>
          </svg>
          ${fillers} fillers
        </div>
      </div>
      <div class="card-sparkline">
        <canvas id="${sparkId}" height="32"></canvas>
      </div>
    </div>`;
}

// Draw mini sparklines after DOM update
function drawSparklines(sessions) {
  sessions.forEach(s => {
    const timeline = s.emotion_timeline;
    if (!Array.isArray(timeline) || !timeline.length) return;
    const canvas = document.getElementById(`spark-${s.id}`);
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const scores = timeline.map(e => e.confidence || 0);
    const accent = ACCENT[s.mode] || '#3b82f6';
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: scores.map(() => ''),
        datasets:[{
          data: scores,
          borderColor: hexToRgba(accent, 0.7),
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
          fill: false,
        }],
      },
      options: {
        responsive: false,
        plugins: { legend:{display:false}, tooltip:{enabled:false} },
        scales: { x:{display:false}, y:{display:false,min:0,max:100} },
        animation: false,
      },
    });
  });
}

// ── Open session detail ───────────────────────────────────────────────────────
async function openSession(id) {
  const modal   = document.getElementById('sessionModal');
  const body    = document.getElementById('sessionModalBody');
  const title   = document.getElementById('sessionModalTitle');
  modal.classList.remove('hidden');
  body.innerHTML = '<div style="text-align:center;padding:40px;color:#52525b">Loading…</div>';

  try {
    const res = await fetch(`/api/session/${id}`);
    if (!res.ok) throw new Error('Not found');
    const s = await res.json();

    const mode      = s.mode || 'free';
    const modeLabel = MODE_LABEL[mode] || mode;
    const sub       = s.submode ? ` · ${SUB_LABEL[s.submode] || s.submode}` : '';
    title.textContent = modeLabel + sub;

    const score   = s.overall_score ?? 0;
    const dur     = fmtDuration(s.duration);
    const fillers = s.filler_count ?? (Array.isArray(s.filler_words) ? s.filler_words.length : 0);
    const conf    = s.confidence_avg != null ? Math.round(s.confidence_avg) + '%' : '—';

    let feedbackHtml = '';
    if (s.ai_feedback) {
      feedbackHtml = `<div class="feedback-content">${parseMarkdown(s.ai_feedback)}</div>`;
    } else {
      feedbackHtml = `<p style="color:#52525b;font-size:14px">No AI feedback saved for this session.</p>`;
    }

    let transcriptHtml = '';
    if (s.transcript) {
      transcriptHtml = `
        <div style="margin-top:20px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#52525b;margin-bottom:10px">Transcript</div>
          <div style="font-size:14px;color:#a1a1aa;line-height:1.7;padding:14px;border-radius:10px;
            background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07)">${escHtml(s.transcript)}</div>
        </div>`;
    }

    body.innerHTML = `
      <div class="modal-meta">
        <div class="modal-stat"><div class="modal-stat-val">${score}</div><div class="modal-stat-lbl">Score</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${dur}</div><div class="modal-stat-lbl">Duration</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${fillers}</div><div class="modal-stat-lbl">Fillers</div></div>
      </div>
      ${feedbackHtml}
      ${transcriptHtml}
      <div style="margin-top:20px;display:flex;gap:10px">
        <a href="/feedback?id=${id}" style="padding:11px 20px;border-radius:9px;background:var(--accent);
          color:#fff;font-size:13px;font-weight:700;text-decoration:none;text-align:center">
          Full Feedback →
        </a>
      </div>`;

  } catch (err) {
    body.innerHTML = `<p style="color:#ef4444">Failed to load session.</p>`;
  }
}

function closeSessionModal() {
  document.getElementById('sessionModal').classList.add('hidden');
}

// ── Progress modal ────────────────────────────────────────────────────────────
async function openProgressModal() {
  if (allSessions.length < 2) {
    alert('You need at least 2 sessions for a progress analysis.');
    return;
  }
  const modal   = document.getElementById('progressModal');
  const content = document.getElementById('progressFeedbackContent');
  modal.classList.remove('hidden');
  content.innerHTML = `<div style="display:flex;align-items:center;gap:10px;color:#52525b">
    <div style="width:20px;height:20px;border:2px solid rgba(255,255,255,0.08);border-top-color:var(--accent);border-radius:50%;animation:spin 0.7s linear infinite"></div>
    Generating analysis…</div>`;

  // Build meta stats
  const scores = allSessions.map(s => s.overall_score || 0);
  const best   = Math.max(...scores);
  const avg    = Math.round(scores.reduce((a,b)=>a+b,0) / scores.length);
  const last   = scores[0];
  document.getElementById('progressModalMeta').innerHTML = `
    <div class="modal-stat"><div class="modal-stat-val">${best}</div><div class="modal-stat-lbl">Best</div></div>
    <div class="modal-stat"><div class="modal-stat-val">${avg}</div><div class="modal-stat-lbl">Average</div></div>
    <div class="modal-stat"><div class="modal-stat-val">${last}</div><div class="modal-stat-lbl">Latest</div></div>`;

  // Stream progress feedback
  const payload = {
    mode: 'progress',
    sessions: allSessions.slice(0, 5),
    language: 'english',
  };

  let fullText = '';
  try {
    const res    = await fetch('/generate_feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') break;
        try {
          const p = JSON.parse(raw);
          if (p.done) break;
          if (p.text) {
            fullText += p.text;
            content.innerHTML = `<div class="feedback-content">${parseMarkdown(fullText)}</div>`;
          }
        } catch(_) {}
      }
    }
  } catch (err) {
    content.innerHTML = `<p style="color:#ef4444">Error: ${escHtml(err.message)}</p>`;
  }
}

function closeProgressModal() {
  document.getElementById('progressModal').classList.add('hidden');
}

// Close modals on overlay click
document.getElementById('progressModal').addEventListener('click', e => {
  if (e.target === document.getElementById('progressModal')) closeProgressModal();
});
document.getElementById('sessionModal').addEventListener('click', e => {
  if (e.target === document.getElementById('sessionModal')) closeSessionModal();
});

// ── Markdown parser ───────────────────────────────────────────────────────────
function parseMarkdown(md) {
  let html = escHtml(md)
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/([^>])\n([^<])/g, '$1<br>$2');
  if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<p')) {
    html = '<p>' + html + '</p>';
  }
  return html;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtDuration(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  if (m === 0) return r + 's';
  return r ? `${m}m ${r}s` : `${m} min`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
