'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 68; // 427.26

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadIdentity();
  loadStats();
  document.getElementById('btnLogout').addEventListener('click', logout);
});

// ── Identity ──────────────────────────────────────────────────────────────────
function loadIdentity() {
  // Email and member-since come from /api/profile/stats (user_email + first_session_at)
  // Avatar initials set after stats load
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await fetch('/api/profile/stats');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    // ── Identity ──────────────────────────────────────────────────────────────
    const email  = data.user_email || '';
    const initials = email ? email[0].toUpperCase() : '?';
    document.getElementById('proAvatar').textContent = initials;
    document.getElementById('proEmail').textContent  = email || 'Unknown';

    const since = data.member_since
      ? 'Member since ' + fmtMonthYear(data.member_since)
      : '';
    document.getElementById('proSince').textContent = since;

    // ── Score ring ────────────────────────────────────────────────────────────
    const avg = Math.round(data.avg_score || 0);
    document.getElementById('ringScore').textContent = avg || '—';
    animateRing(avg);

    // ── Hero metrics ──────────────────────────────────────────────────────────
    document.getElementById('hmSessions').textContent = data.total_sessions ?? '0';
    document.getElementById('hmMinutes').textContent  = data.total_minutes   ?? '0';
    document.getElementById('hmStreak').textContent   = data.streak_count    ?? data.streak ?? '0';

    // ── Streak card ───────────────────────────────────────────────────────────
    renderStreakCard(data);

    // ── Trend chart ───────────────────────────────────────────────────────────
    const trend = Array.isArray(data.score_trend) ? data.score_trend : [];
    if (trend.length >= 2) {
      renderChart(trend);
    } else {
      document.getElementById('trendChart').classList.add('hidden');
      document.getElementById('chartEmpty').classList.remove('hidden');
      document.getElementById('trendSub').textContent = '';
    }

    // ── Recent sessions ───────────────────────────────────────────────────────
    const recent = Array.isArray(data.recent_sessions) ? data.recent_sessions : [];
    renderSessions(recent);

  } catch (err) {
    console.error('[profile] loadStats error:', err);
  }
}

// ── Streak card ───────────────────────────────────────────────────────────────
function renderStreakCard(data) {
  const card    = document.getElementById('streakCard');
  if (!card) return;

  const count   = data.streak_count   ?? data.streak ?? 0;
  const longest = data.longest_streak ?? 0;
  const atRisk  = data.streak_at_risk ?? false;

  if (count === 0 && longest === 0) return; // no sessions yet

  document.getElementById('streakCount').textContent = count;
  document.getElementById('streakBest').textContent  = `Best: ${longest} day${longest !== 1 ? 's' : ''}`;

  card.classList.remove('hidden');
  if (atRisk)  card.classList.add('at-risk');
  if (count > 3) card.classList.add('on-fire');

  const riskEl = document.getElementById('streakRisk');
  if (atRisk && riskEl) riskEl.classList.remove('hidden');
}

// ── Score ring animation ──────────────────────────────────────────────────────
function animateRing(score) {
  const ring  = document.getElementById('ringFg');
  const clamp = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE - (clamp / 100) * CIRCUMFERENCE;

  // Choose colour by score band
  let colour;
  if (clamp >= 70)      colour = '#4ade80';
  else if (clamp >= 50) colour = '#f59e0b';
  else                  colour = '#ef4444';

  ring.style.stroke = colour;

  // Update gradient stops to match (optional nice touch)
  const grad = document.getElementById('ringGrad');
  if (grad) {
    grad.children[0].setAttribute('stop-color', colour);
    grad.children[1].setAttribute('stop-color', colour === '#4ade80' ? '#22d3ee' : colour);
  }

  // Trigger animation on next frame so the transition fires
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = offset;
    });
  });
}

// ── Trend chart ───────────────────────────────────────────────────────────────
function renderChart(scores) {
  const canvas = document.getElementById('trendChart');
  const ctx    = canvas.getContext('2d');

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, 180);
  grad.addColorStop(0,   'rgba(255,255,255,0.08)');
  grad.addColorStop(1,   'rgba(255,255,255,0)');

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: scores.map((_, i) => `#${i + 1}`),
      datasets: [{
        data: scores,
        borderColor: 'rgba(255,255,255,0.85)',
        borderWidth: 2,
        backgroundColor: grad,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#fff',
        pointBorderColor: 'transparent',
        pointHoverBackgroundColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a2e',
          titleColor: '#888',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,.1)',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            title: (items) => `Session ${items[0].dataIndex + 1}`,
            label: (item)  => `Score: ${item.raw}`,
          },
        },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    },
  });
}

// ── Recent sessions list ──────────────────────────────────────────────────────
function renderSessions(sessions) {
  const list = document.getElementById('sessionsList');
  if (!sessions.length) return; // default "No sessions yet" text stays

  list.innerHTML = sessions.map(s => {
    const badge   = modeBadge(s.mode);
    const topic   = (s.topic || s.submode || s.mode || 'Session').slice(0, 30);
    const score   = s.overall_score ?? '—';
    const scoreClass = scoreColour(s.overall_score);
    const date    = fmtDate(s.created_at);
    const href    = `/feedback?id=${s.id}`;

    return `
      <li class="sl-item" onclick="location.href='${href}'" role="link" tabindex="0">
        <span class="sl-badge ${badge.cls}">${badge.label}</span>
        <span class="sl-topic">${escHtml(topic)}</span>
        <span class="sl-score ${scoreClass}">${score}</span>
        <span class="sl-date">${date}</span>
      </li>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function modeBadge(mode) {
  if (!mode) return { cls: 'free', label: 'Free' };
  const m = mode.toLowerCase();
  if (m === 'ielts' || m === 'ielts_sim') return { cls: 'ielts', label: 'IELTS' };
  if (m === 'pitch')                       return { cls: 'pitch', label: 'Pitch' };
  return { cls: 'free', label: 'Free' };
}

function scoreColour(score) {
  if (score == null) return '';
  if (score >= 70) return 'good';
  if (score >= 50) return 'ok';
  return 'low';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMonthYear(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function logout() {
  try {
    const res  = await fetch('/auth/logout', { method: 'POST' });
    const data = await res.json();
    window.location.href = data.redirect || '/auth';
  } catch {
    window.location.href = '/auth';
  }
}
