'use strict';

const SKILL_CIRCUMFERENCE = 2 * Math.PI * 32; // 201.06

const MODE_META = {
  ielts:     { icon: '🎓', name: 'IELTS',          color: '#3b82f6' },
  ielts_sim: { icon: '🎯', name: 'IELTS Sim',       color: '#6366f1' },
  pitch:     { icon: '💼', name: 'Pitch & Interview', color: '#8b5cf6' },
  free:      { icon: '💬', name: 'Free Talk',        color: '#10b981' },
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadProgress);

async function loadProgress() {
  try {
    const res  = await fetch('/api/progress_map');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    renderGoalHero(data);
    renderSkills(data);
    renderTrendChart(data);
    renderWeeklyActivity(data);
    renderModeBreakdown(data);

    // Remove skeleton pulse
    document.querySelectorAll('.skeleton-card').forEach(el => el.classList.remove('skeleton-card'));
  } catch (err) {
    console.error('[progress] load error:', err);
  }
}

// ── Goal Hero ─────────────────────────────────────────────────────────────────
function renderGoalHero(data) {
  const hero = document.getElementById('pgHero');
  if (!data.target_band) return;  // no goal set yet

  hero.style.display = '';

  const target  = parseFloat(data.target_band);
  const current = data.skills.confidence || 0;

  // Band display: map score 0-100 → band ~4.0-9.0 (rough heuristic)
  const currentBand = (current / 100 * 5 + 4).toFixed(1);
  document.getElementById('heroBands').textContent =
    `${currentBand} → ${target.toFixed(1)}`;

  // Progress toward target
  const minBand  = 4.0;
  const progress = Math.min(100, Math.max(0,
    Math.round((parseFloat(currentBand) - minBand) / (target - minBand) * 100)
  ));
  document.getElementById('heroProgressLabel').textContent = `${progress}% there`;

  // Exam countdown
  if (data.exam_date) {
    const exam   = new Date(data.exam_date + 'T00:00:00');
    const today  = new Date();
    today.setHours(0, 0, 0, 0);
    const days   = Math.ceil((exam - today) / 86400000);
    const label  = exam.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('heroSub').textContent =
      days > 0 ? `Exam: ${label} · ${days} days to go` : `Exam: ${label}`;
    document.getElementById('heroProgressDays').textContent =
      days > 0 ? `${days}d left` : 'Today!';
  } else {
    document.getElementById('heroSub').textContent =
      data.goal ? `Focus: ${capitalize(data.goal)}` : 'Keep practicing!';
  }

  // Animate fill on next frame
  requestAnimationFrame(() => {
    document.getElementById('heroProgressFill').style.width = progress + '%';
  });
}

// ── Skills ────────────────────────────────────────────────────────────────────
function renderSkills(data) {
  const skills = data.skills      || {};
  const trends = data.skill_trends || {};

  [
    { key: 'fluency',     color: '#3b82f6' },
    { key: 'vocabulary',  color: '#6366f1' },
    { key: 'confidence',  color: '#4ade80' },
    { key: 'consistency', color: '#f59e0b' },
  ].forEach(({ key, color }) => {
    const val    = Math.round(skills[key] || 0);
    const trend  = trends[key] || 0;
    const capKey = key[0].toUpperCase() + key.slice(1);

    // Ring
    const ring  = document.getElementById(`ring${capKey}`);
    const offset = SKILL_CIRCUMFERENCE - (val / 100) * SKILL_CIRCUMFERENCE;
    ring.style.stroke = color;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ring.style.strokeDashoffset = offset;
      });
    });

    // Value
    document.getElementById(`val${capKey}`).textContent = val;

    // Trend
    const trendEl = document.getElementById(`trend${capKey}`);
    if (trend > 1) {
      trendEl.textContent = `+${trend}`;
      trendEl.className   = 'skill-trend up';
    } else if (trend < -1) {
      trendEl.textContent = `${trend}`;
      trendEl.className   = 'skill-trend down';
    } else {
      trendEl.textContent = '→';
      trendEl.className   = 'skill-trend flat';
    }
  });
}

// ── Score Trend Chart ─────────────────────────────────────────────────────────
function renderTrendChart(data) {
  const scores = data.score_trend || [];
  const canvas = document.getElementById('trendChart');
  const empty  = document.getElementById('trendEmpty');

  if (scores.length < 2) {
    canvas.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  // Improvement badge
  const imp = data.improvement;
  if (imp != null) {
    const badge = document.getElementById('improvementBadge');
    const cls   = imp > 0 ? 'pos' : imp < 0 ? 'neg' : 'neu';
    badge.innerHTML =
      `<span class="improvement-badge ${cls}">${imp > 0 ? '↑' : imp < 0 ? '↓' : '→'} ${Math.abs(imp)} pts</span>`;
  }

  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0,   'rgba(99,102,241,0.18)');
  grad.addColorStop(1,   'rgba(99,102,241,0)');

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: scores.map((_, i) => `#${i + 1}`),
      datasets: [{
        data: scores,
        borderColor: '#6366f1',
        backgroundColor: grad,
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#6366f1',
        pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeInOutQuart' },
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
            title:  items  => `Session ${items[0].dataIndex + 1}`,
            label:  item   => `Score: ${item.raw}`,
          },
        },
      },
      scales: {
        x: { display: false },
        y: {
          min: 0, max: 100,
          display: true,
          ticks:  { color: '#52525b', font: { size: 10 }, stepSize: 25 },
          grid:   { color: 'rgba(255,255,255,0.04)' },
          border: { color: 'transparent' },
        },
      },
    },
  });
}

// ── Weekly Activity ───────────────────────────────────────────────────────────
function renderWeeklyActivity(data) {
  const activity = data.weekly_activity || [];
  const grid     = document.getElementById('activityGrid');
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let weekTotal = 0;

  grid.innerHTML = activity.map(day => {
    weekTotal += day.count;
    const d   = new Date(day.date + 'T00:00:00');
    const abbr = DAY_ABBR[d.getDay()];
    const lvl  = day.count === 0 ? 0 : day.count === 1 ? 1 : day.count === 2 ? 2 : 3;
    return `
      <div class="activity-day" title="${day.date}: ${day.count} session${day.count !== 1 ? 's' : ''}">
        <div class="activity-cell s${lvl}"></div>
        <div class="activity-day-label">${abbr}</div>
      </div>`;
  }).join('');

  document.getElementById('weekTotal').textContent =
    `${weekTotal} session${weekTotal !== 1 ? 's' : ''} this week`;
}

// ── Mode Breakdown ────────────────────────────────────────────────────────────
function renderModeBreakdown(data) {
  const breakdown = data.mode_breakdown || [];
  const container = document.getElementById('modeBreakdown');

  if (!breakdown.length) {
    container.innerHTML = '<p style="color:#52525b;font-size:13px">No sessions yet.</p>';
    return;
  }

  container.innerHTML = breakdown.map(item => {
    const meta = MODE_META[item.mode] || { icon: '💬', name: item.mode, color: '#52525b' };
    return `
      <div class="mode-card glass" style="border-color:${meta.color}22">
        <div class="mode-card-icon">${meta.icon}</div>
        <div class="mode-card-name">${meta.name}</div>
        <div class="mode-card-stats">
          <span><strong>${item.sessions}</strong> sessions</span>
          <span><strong>${item.avg_score}</strong> avg score</span>
        </div>
      </div>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
