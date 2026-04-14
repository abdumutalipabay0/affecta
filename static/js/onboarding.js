'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentStep   = 1;
let selectedBand  = null;   // numeric e.g. 5.0
let selectedGoal  = null;   // "fluency" | "vocabulary" | "confidence"
let targetBand    = 7.0;

// ── Navigation ────────────────────────────────────────────────────────────────
function goToStep(n) {
  currentStep = n;
  const pct = ((n - 1) * 25);
  document.getElementById('obSlides').style.transform = `translateX(-${pct}%)`;

  // Update dots
  document.querySelectorAll('.ob-dot').forEach(d => {
    d.classList.toggle('active', parseInt(d.dataset.step) === n);
  });

  if (n === 4) {
    buildPlanSummary();
    launchConfetti();
  }
}

// ── Step 2: Band selection ─────────────────────────────────────────────────────
function selectBand(el) {
  document.querySelectorAll('.band-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedBand = parseFloat(el.dataset.band);
  document.getElementById('step2Next').disabled = false;
}

// ── Step 3: Slider + goal selection ──────────────────────────────────────────
function updateSlider(input) {
  targetBand = parseInt(input.value) / 10;
  document.getElementById('sliderValue').textContent = targetBand.toFixed(1);
  checkStep3();
}

function selectGoal(el) {
  document.querySelectorAll('.focus-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedGoal = el.dataset.goal;
  checkStep3();
}

function checkStep3() {
  document.getElementById('step3Next').disabled = !selectedGoal;
}

// ── Step 4: Plan summary ──────────────────────────────────────────────────────
function buildPlanSummary() {
  document.getElementById('planCurrent').textContent =
    selectedBand != null ? `Band ${selectedBand.toFixed(1)}` : 'Not set';
  document.getElementById('planTarget').textContent  = `Band ${targetBand.toFixed(1)}`;
  document.getElementById('planGoal').textContent    =
    selectedGoal ? (selectedGoal[0].toUpperCase() + selectedGoal.slice(1)) : '—';

  const examInput = document.getElementById('examDate').value;
  if (examInput) {
    const d = new Date(examInput + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((d - today) / 86400000);
    const label    = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('planExam').textContent =
      diffDays > 0 ? `${label} (${diffDays} days)` : label;
  } else {
    document.getElementById('planExam').textContent = 'Not set';
  }
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function submitOnboarding() {
  const btn     = document.getElementById('startBtn');
  const saving  = document.getElementById('obSaving');
  const errEl   = document.getElementById('obError');

  btn.disabled  = true;
  saving.classList.remove('hidden');
  errEl.classList.add('hidden');

  const examVal = document.getElementById('examDate').value || null;

  try {
    const res  = await fetch('/api/onboarding', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        current_band: selectedBand,
        target_band:  targetBand,
        exam_date:    examVal,
        goal:         selectedGoal,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');
    window.location.href = data.redirect || '/coach';
  } catch (err) {
    saving.classList.add('hidden');
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
  }
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const COLORS = ['#3b82f6','#6366f1','#4ade80','#f59e0b','#ec4899','#22d3ee','#a78bfa'];
  const pieces = Array.from({ length: 90 }, () => ({
    x:  Math.random() * canvas.width,
    y:  -Math.random() * canvas.height * 0.4,
    dx: (Math.random() - 0.5) * 3,
    dy: 2 + Math.random() * 3,
    w:  6 + Math.random() * 8,
    h:  3 + Math.random() * 5,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    opacity: 0.8 + Math.random() * 0.2,
  }));

  const startTime = Date.now();
  const DURATION  = 4000;

  function draw() {
    const elapsed = Date.now() - startTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (elapsed > DURATION) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    for (const p of pieces) {
      p.x   += p.dx;
      p.y   += p.dy;
      p.rot += p.rotSpeed;
      p.dy  += 0.06; // gravity

      const fade = elapsed > DURATION * 0.7
        ? 1 - (elapsed - DURATION * 0.7) / (DURATION * 0.3)
        : 1;

      ctx.save();
      ctx.globalAlpha = p.opacity * fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set today as min date for exam picker
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('examDate');
  if (dateInput) dateInput.min = today;

  // Init slider display
  updateSlider(document.getElementById('targetSlider'));
});
