/* ── Affecta Feedback ──────────────────────────────────────────────────── */

// ── Accent colours ────────────────────────────────────────────────────────────
const ACCENT = { ielts:'#3b82f6', pitch:'#6366f1', free:'#10b981' };

// Legacy emotion map (DeepFace-style keys, used for heatmap CSS data-emo attrs)
const EMO_COLOR = {
  happy:'#eab308', sad:'#6366f1', angry:'#ef4444',
  fear:'#f97316', surprise:'#ec4899', disgust:'#14b8a6', neutral:'#71717a',
};

// Hume emotion colours (used for donut chart)
const EMOTION_COLORS = {
  joy:'#4ade80',          happiness:'#4ade80',      amusement:'#4ade80',
  calmness:'#3b82f6',     concentration:'#6366f1',
  confusion:'#f59e0b',    boredom:'#94a3b8',
  fear:'#ef4444',         sadness:'#60a5fa',         anger:'#ef4444',
  surprise:'#fbbf24',     pain:'#f97316',            distress:'#ef4444',
  interest:'#34d399',     excitement:'#a78bfa',      love:'#ec4899',
  disappointment:'#6b7280', doubt:'#9ca3af',         tiredness:'#78716c',
  neutral:'#52525b',      disgust:'#14b8a6',
};

function setAccent(mode) {
  const c = ACCENT[mode] || '#3b82f6';
  document.documentElement.style.setProperty('--accent', c);
  document.documentElement.style.setProperty('--accent-dim', hexToRgba(c, 0.1));
  document.documentElement.style.setProperty('--accent-border', hexToRgba(c, 0.3));
}
function hexToRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Load session ──────────────────────────────────────────────────────────────
let sessionData = null;
let confChart   = null;
let emoChart    = null;

async function init() {
  // Check URL for session id (viewing from history)
  const params   = new URLSearchParams(window.location.search);
  const urlId    = params.get('id');

  if (urlId) {
    try {
      const res = await fetch(`/api/session/${urlId}`);
      if (res.ok) sessionData = await res.json();
    } catch (_) {}
  }

  if (!sessionData) {
    const raw = localStorage.getItem('affecta_session');
    if (raw) {
      try { sessionData = JSON.parse(raw); } catch(_) {}
    }
  }

  // Normalise JSONB array fields — DB may return null for older rows;
  // localStorage may omit fields entirely. Both are safe after this.
  if (sessionData) {
    sessionData.words          = Array.isArray(sessionData.words)          ? sessionData.words          : [];
    sessionData.emotion_timeline = Array.isArray(sessionData.emotion_timeline) ? sessionData.emotion_timeline : [];
    sessionData.filler_words   = Array.isArray(sessionData.filler_words)   ? sessionData.filler_words   : [];
  }

  console.log('Session data:', sessionData);

  document.getElementById('loadingState').style.display = 'none';

  if (!sessionData || !sessionData.mode) {
    document.getElementById('noSessionState').style.display = 'block';
    return;
  }

  document.getElementById('mainContent').style.display = 'block';

  setAccent(sessionData.mode);
  renderHeader();
  renderMetrics();
  renderSessionReplay(sessionData.emotion_timeline || [], sessionData.words || []);
  renderHeatmap();
  renderCharts();
  findWeakestMoment();

  // If session already has ai_feedback (loaded from DB), render it directly
  if (sessionData.ai_feedback) {
    document.getElementById('aiLoading').classList.add('hidden');
    document.getElementById('feedbackContent').innerHTML = parseMarkdown(sessionData.ai_feedback);
    animateScore(sessionData.overall_score || 0);
  } else {
    animateScore(estimateScore());
    streamFeedback();
  }

  loadVocabularyAnalysis();
}

// ── Header ────────────────────────────────────────────────────────────────────
function renderHeader() {
  const modeLabels = { ielts:'IELTS Speaking', pitch:'Pitch & Interview', free:'Free Talk' };
  const subLabels  = {
    part1:'Part 1', part2:'Part 2', part3:'Part 3',
    pitch:'Startup Pitch', interview:'Job Interview', presentation:'Presentation',
  };
  const mode    = sessionData.mode || 'free';
  const sub     = sessionData.submode ? ` · ${subLabels[sessionData.submode] || sessionData.submode}` : '';
  const topic   = sessionData.topic   ? ` — ${sessionData.topic}` : '';

  document.getElementById('sessionTitle').textContent = (modeLabels[mode] || mode) + topic;
  document.getElementById('modeTag').textContent      = (modeLabels[mode] || mode) + sub;

  if (sessionData.created_at) {
    const d = new Date(sessionData.created_at);
    document.getElementById('dateTag').textContent = d.toLocaleDateString('en-US',{
      year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit',
    });
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────────
function renderMetrics() {
  const dur = sessionData.duration || 0;
  document.getElementById('metricDuration').textContent  = fmtDuration(dur);
  document.getElementById('metricFillers').textContent   = sessionData.filler_count ?? (sessionData.filler_words?.length || 0);
  document.getElementById('metricConfidence').textContent =
    (sessionData.confidence_avg != null ? Math.round(sessionData.confidence_avg) + '%' : '—');
}

function estimateScore() {
  const conf    = sessionData.confidence_avg || 0;
  const fillers = sessionData.filler_count   || (sessionData.filler_words?.length || 0);
  const dur     = sessionData.duration        || 0;
  return Math.max(0, Math.min(100, Math.round(conf - Math.min(fillers * 3, 30) + Math.min(dur / 10, 10))));
}

function animateScore(target) {
  const arc    = document.getElementById('scoreArc');
  const numEl  = document.getElementById('scoreNum');
  const circum = 2 * Math.PI * 35; // r=35
  arc.style.strokeDasharray  = circum;
  arc.style.strokeDashoffset = circum;

  let current = 0;
  const step  = target / 60;
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    numEl.textContent = Math.round(current);
    arc.style.strokeDashoffset = circum - (circum * current / 100);
    if (current >= target) clearInterval(timer);
  }, 16);
}

// ── Session Replay ────────────────────────────────────────────────────────────
const EMO_EMOJI = {
  joy:'😄', happiness:'😊', amusement:'😄', calmness:'😌', concentration:'🧐',
  confusion:'😕', boredom:'😑', fear:'😨', sadness:'😢', anger:'😠',
  surprise:'😲', pain:'😣', distress:'😰', interest:'🤔', excitement:'🤩',
  love:'😍', disappointment:'😞', doubt:'🤨', tiredness:'😴', neutral:'😐',
  disgust:'🤢',
};

function renderSessionReplay(timeline, words) {
  const section = document.getElementById('replaySection');
  const track   = document.getElementById('replayTrack');
  const legend  = document.getElementById('replayLegend');
  if (!section || !timeline || timeline.length < 2) return;

  const lastMs  = timeline[timeline.length - 1].ms || 0;
  if (lastMs < 1000) return;

  section.style.display = 'block';
  track.innerHTML = '';
  legend.innerHTML = '';

  const usedEmotions = new Map(); // emotion → color

  for (let i = 0; i < timeline.length; i++) {
    const entry  = timeline[i];
    const nextMs = i < timeline.length - 1 ? timeline[i + 1].ms : lastMs;
    const durMs  = Math.max(nextMs - entry.ms, 1);
    const pct    = (durMs / lastMs) * 100;
    const color  = EMOTION_COLORS[entry.emotion] || '#64748b';
    const opacity = Math.max(0.25, Math.min(1, (entry.confidence || 0) / 100));

    const timeStr  = fmtTime(Math.round(entry.ms / 1000));
    const emoji    = EMO_EMOJI[entry.emotion] || '•';
    const conf     = Math.round(entry.confidence || 0);

    // Find nearest word
    let nearestWord = '';
    if (words.length) {
      const targetSec = entry.ms / 1000;
      const nearest   = words.reduce((best, w) =>
        Math.abs(w.start - targetSec) < Math.abs((best.start || 0) - targetSec) ? w : best
      , words[0]);
      if (nearest && Math.abs(nearest.start - targetSec) < 4) {
        nearestWord = `<div class="replay-tt-word">"${escHtml(nearest.word)}"</div>`;
      }
    }

    const block = document.createElement('div');
    block.className = 'replay-block';
    block.style.cssText =
      `width:${pct}%;background:${color};opacity:${opacity};flex-shrink:0`;
    block.innerHTML = `
      <div class="replay-tooltip">
        <div class="replay-tt-time">${timeStr}</div>
        <div class="replay-tt-emo">${emoji} ${capitalize(entry.emotion)}</div>
        <div class="replay-tt-conf">${conf}% confidence</div>
        ${nearestWord}
      </div>`;
    track.appendChild(block);

    if (!usedEmotions.has(entry.emotion)) usedEmotions.set(entry.emotion, color);
  }

  // Legend
  usedEmotions.forEach((color, emo) => {
    const item = document.createElement('div');
    item.className = 'replay-legend-item';
    item.innerHTML =
      `<span class="replay-legend-dot" style="background:${color}"></span>
       <span>${capitalize(emo)}</span>`;
    legend.appendChild(item);
  });
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function renderHeatmap() {
  const wrap      = document.getElementById('heatmapWrap');
  const legendEl  = document.getElementById('heatmapLegend');
  const transcript = sessionData.transcript || '';
  const words      = sessionData.words || [];
  const timeline   = sessionData.emotion_timeline || [];
  const fillerWords= new Set((sessionData.filler_words || []).map(w => w.toLowerCase()));

  if (!transcript.trim()) {
    wrap.innerHTML = '<span style="color:#52525b;font-size:14px">No transcript available.</span>';
    return;
  }

  // If we have word timestamps, use them; otherwise split plain text
  if (words.length) {
    const spans = words.map(w => {
      const wordMs  = w.start * 1000;
      const emo     = closestEmotion(timeline, wordMs);
      const isFiller = fillerWords.has(w.word.toLowerCase().replace(/[.,!?;:]/g,''));
      return `<span class="heatmap-word${isFiller?' filler':''}" data-emo="${emo.emotion}"
        >${escHtml(w.word)}<span class="word-tooltip">${capitalize(emo.emotion)} ${Math.round(emo.confidence)}%</span></span> `;
    });
    wrap.innerHTML = spans.join('');
  } else {
    const splitWords = transcript.split(/(\s+)/);
    wrap.innerHTML = splitWords.map(w => {
      if (/^\s+$/.test(w)) return w;
      const isFiller = fillerWords.has(w.toLowerCase().replace(/[.,!?;:]/g,''));
      return `<span class="heatmap-word${isFiller?' filler':''}" data-emo="neutral">${escHtml(w)}</span>`;
    }).join('');
  }

  // Build legend from emotions present
  const emotionsPresent = new Set([...wrap.querySelectorAll('.heatmap-word')].map(el => el.dataset.emo));
  const legendItems = [...emotionsPresent].filter(e => e !== 'neutral').map(e =>
    `<div class="legend-item">
      <div class="legend-dot" style="background:${EMO_COLOR[e]||'#71717a'}"></div>
      <span>${capitalize(e)}</span>
    </div>`
  );
  if (fillerWords.size) {
    legendItems.push(`<div class="legend-item">
      <div class="legend-dot" style="background:#ef4444;opacity:0.5"></div>
      <span style="text-decoration:line-through">Filler words</span>
    </div>`);
  }
  legendEl.innerHTML = legendItems.join('');
}

function closestEmotion(timeline, targetMs) {
  if (!timeline.length) return { emotion:'neutral', confidence:0 };
  return timeline.reduce((best, e) => {
    const d = Math.abs((e.ms || 0) - targetMs);
    return d < Math.abs((best.ms || 0) - targetMs) ? e : best;
  });
}

// ── Weakest moment ────────────────────────────────────────────────────────────
function findWeakestMoment() {
  const timeline = sessionData.emotion_timeline || [];
  const words    = sessionData.words || [];
  if (!timeline.length) return;

  // Weakest = lowest confidence point
  const worst = timeline.reduce((w, e) => e.confidence < w.confidence ? e : w, timeline[0]);
  const timeS  = Math.round((worst.ms || 0) / 1000);

  // Find nearby words
  let quote = '';
  if (words.length) {
    const nearby = words.filter(w => Math.abs(w.start - timeS) < 4);
    quote = nearby.map(w => w.word).join(' ').trim();
  }

  if (!quote && sessionData.transcript) {
    const allWords = sessionData.transcript.split(/\s+/);
    const idx = Math.floor(allWords.length * (timeS / (sessionData.duration || 60)));
    quote = allWords.slice(Math.max(0,idx-4), idx+5).join(' ');
  }

  if (!quote) return;

  document.getElementById('weakestCard').style.display = 'block';
  document.getElementById('weakestTime').textContent    = fmtTime(timeS);
  document.getElementById('weakestQuote').textContent   = '"' + quote + '…"';
  document.getElementById('weakestEmotion').innerHTML   =
    `<div class="weakest-emo-dot" style="background:${EMO_COLOR[worst.emotion]||'#71717a'}"></div>
     <span>${capitalize(worst.emotion)} detected — ${Math.round(worst.confidence)}% confidence</span>`;
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts() {
  const timeline = sessionData.emotion_timeline || [];
  const accent   = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';

  // Confidence timeline
  if (timeline.length) {
    const labels = timeline.map((_, i) => i % Math.ceil(timeline.length / 8) === 0 ? fmtTime(Math.round(_.ms / 1000)) : '');
    const data   = timeline.map(e => e.confidence || 0);

    const confCtx = document.getElementById('confChart').getContext('2d');
    if (confChart) confChart.destroy();
    confChart = new Chart(confCtx, {
      type: 'line',
      data: {
        labels,
        datasets:[{
          data,
          borderColor: accent,
          backgroundColor: hexToRgba(accent, 0.08),
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend:{ display:false } },
        scales: {
          x: { ticks:{ color:'#52525b', font:{size:10} }, grid:{color:'rgba(255,255,255,0.04)'}, border:{color:'transparent'} },
          y: { min:0, max:100, ticks:{ color:'#52525b', font:{size:10}, stepSize:25 }, grid:{color:'rgba(255,255,255,0.04)'}, border:{color:'transparent'} },
        },
      },
    });
  }

  // Emotion donut — uses Hume emotion names
  const counts = {};
  for (const e of timeline) counts[e.emotion] = (counts[e.emotion] || 0) + 1;
  const emoLabels = Object.keys(counts);
  const emoCounts = Object.values(counts);
  const emoColors = emoLabels.map(l => EMOTION_COLORS[l.toLowerCase()] || '#64748b');

  if (emoLabels.length) {
    const emoCtx = document.getElementById('emoChart').getContext('2d');
    if (emoChart) emoChart.destroy();
    emoChart = new Chart(emoCtx, {
      type: 'doughnut',
      data: {
        labels: emoLabels.map(capitalize),
        datasets:[{ data:emoCounts, backgroundColor:emoColors, borderWidth:0, hoverOffset:6 }],
      },
      options: {
        responsive: true,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#e2e8f0',
              font: { size: 12 },
              padding: 12,
              usePointStyle: true,
              pointStyleWidth: 8,
            },
          },
          tooltip: {
            bodyColor:       '#ffffff',
            titleColor:      '#ffffff',
            backgroundColor: '#1a1a2e',
          },
        },
      },
    });
  }
}

// ── Vocabulary Analysis ───────────────────────────────────────────────────────
async function loadVocabularyAnalysis() {
  const section = document.getElementById('vocabSection');
  if (!section || !sessionData) return;

  // Always show filler words panel
  section.style.display = 'block';
  renderFillerBadges();

  // Only fetch AI suggestions if there's a transcript
  if (!sessionData.transcript) return;

  const loadingEl  = document.getElementById('vocabLoading');
  const contentEl  = document.getElementById('vocabContent');
  const cursorEl   = document.getElementById('vocabCursor');

  loadingEl.classList.remove('hidden');
  cursorEl.classList.remove('hidden');
  let fullText = '';

  try {
    const res = await fetch('/vocabulary_analysis', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ transcript: sessionData.transcript, topic: sessionData.topic || '' }),
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
        try {
          const p = JSON.parse(line.slice(6));
          if (p.done || p.error) { loadingEl.classList.add('hidden'); cursorEl.classList.add('hidden'); return; }
          if (p.text) {
            loadingEl.classList.add('hidden');
            fullText += p.text;
            contentEl.innerHTML = parseMarkdown(fullText);
          }
        } catch (_) {}
      }
    }
  } catch (_) {
    loadingEl.classList.add('hidden');
  } finally {
    cursorEl.classList.add('hidden');
  }
}

function renderFillerBadges() {
  const el = document.getElementById('fillerBadges');
  if (!el) return;
  const fillers = sessionData.filler_words || [];
  if (!fillers.length) {
    el.innerHTML = '<span class="filler-clean">Great job! No filler words detected 🎉</span>';
    return;
  }
  // Count occurrences
  const counts = {};
  for (const w of fillers) counts[w] = (counts[w] || 0) + 1;
  el.innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([w, n]) => `<span class="filler-badge">${escHtml(w)}<span class="filler-count">×${n}</span></span>`)
    .join('');
}

// ── SSE Feedback stream ───────────────────────────────────────────────────────
async function streamFeedback() {
  const cursor       = document.getElementById('feedbackCursor');
  const contentEl    = document.getElementById('feedbackContent');
  const loadingEl    = document.getElementById('aiLoading');

  cursor.classList.remove('hidden');
  let fullText = '';

  try {
    const res = await fetch('/generate_feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionData),
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

        // End-of-stream markers
        if (raw === '[DONE]') {
          cursor.classList.add('hidden');
          loadingEl.classList.add('hidden');
          await saveSession(fullText);
          return;
        }

        try {
          const payload = JSON.parse(raw);
          if (payload.error) {
            contentEl.innerHTML = `<p style="color:#ef4444">Error: ${escHtml(payload.error)}</p>`;
            cursor.classList.add('hidden');
            loadingEl.classList.add('hidden');
            return;
          }
          if (payload.done) {
            cursor.classList.add('hidden');
            loadingEl.classList.add('hidden');
            await saveSession(fullText);
            return;
          }
          if (payload.text) {
            loadingEl.classList.add('hidden');
            fullText += payload.text;
            contentEl.innerHTML = parseMarkdown(fullText);
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    contentEl.innerHTML = `<p style="color:#ef4444">Failed to load feedback: ${escHtml(err.message)}</p>`;
  } finally {
    cursor.classList.add('hidden');
    loadingEl.classList.add('hidden');
  }
}

// ── Save session ──────────────────────────────────────────────────────────────
async function saveSession(aiFeedback) {
  try {
    // Compute overall_score from live sessionData fields — never read from DOM
    const confAvg    = parseFloat(sessionData.confidence_avg)  || 0;
    const fillerCount = parseInt(sessionData.filler_count)     ||
                        (sessionData.filler_words?.length || 0);
    const duration   = parseFloat(sessionData.duration)        || 0;
    const overallScore = sessionData.overall_score != null && !isNaN(sessionData.overall_score)
      ? Number(sessionData.overall_score)
      : estimateScore();

    console.log('overall_score value:', overallScore,
      '| confidence_avg:', confAvg,
      '| filler_count:', fillerCount,
      '| duration:', duration);

    const payload = {
      ...sessionData,
      ai_feedback:    aiFeedback,
      overall_score:  overallScore,
      confidence_avg: confAvg,
      filler_count:   fillerCount,
      duration:       duration,
    };

    const res  = await fetch('/save_session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    console.log('[save_session] response status:', res.status, '| body:', body);
    const { id } = body;
    if (id) {
      history.replaceState({}, '', `/feedback?id=${id}`);
      localStorage.removeItem('affecta_session');

      // DB is now the single source of truth — fetch the full saved record
      // and rebuild every replay component from server data.
      const sRes = await fetch(`/api/session/${id}`);
      if (sRes.ok) {
        const saved = await sRes.json();

        // Normalise JSONB fields that may be null in older rows
        saved.words            = Array.isArray(saved.words)            ? saved.words            : [];
        saved.emotion_timeline = Array.isArray(saved.emotion_timeline) ? saved.emotion_timeline : [];
        saved.filler_words     = Array.isArray(saved.filler_words)     ? saved.filler_words     : [];

        // Replace in-memory session with authoritative server version
        sessionData = saved;

        // Update score ring with server-calculated value
        if (saved.overall_score != null) {
          animateScore(saved.overall_score);
          document.getElementById('scoreNum').textContent = saved.overall_score;
        }

        // Rebuild replay components from DB data
        renderSessionReplay(saved.emotion_timeline, saved.words);
        renderHeatmap();
        findWeakestMoment();

        console.log('[save_session] UI rebuilt from server | words:', saved.words.length, '| emotions:', saved.emotion_timeline.length);
      } else {
        console.warn('[save_session] failed to fetch saved session — replay stays on local data');
      }
    }
  } catch (err) {
    console.error('[save_session]', err);
  }
}

// ── Markdown parser ───────────────────────────────────────────────────────────
function parseMarkdown(md) {
  let html = escHtml(md)
    // ## headers
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // **bold**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // *italic*
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // > blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // - list item
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    // Double newline = paragraph break
    .replace(/\n\n/g, '</p><p>')
    // Single newline after non-tag
    .replace(/([^>])\n([^<])/g, '$1<br>$2');

  // Wrap in paragraph if not starting with block element
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

function fmtTime(s) {
  const m = String(Math.floor(s / 60)).padStart(2,'0');
  const r = String(s % 60).padStart(2,'0');
  return `${m}:${r}`;
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
