/* ── Affecta Coach ─────────────────────────────────────────────────────── */

// ── IELTS Topics ────────────────────────────────────────────────────────────
const IELTS_TOPICS = {
  part1: [
    'Your hometown','Your home','Work or studies','Family life','Friends',
    'Hobbies & free time','Sports & exercise','Music','Food & cooking','Weather',
    'Shopping','Technology','Books & reading','Travel','Transport',
    'Health & fitness','Art & culture','Movies & TV','Environment','Daily routine',
  ],
  part2: [
    'A person who influenced you','A memorable trip','A skill you want to learn',
    'A book that affected you','A difficult decision','A time you helped someone',
    'A place you want to visit','An important life event','A piece of technology',
    'A hobby you enjoy','A famous person from your country','A gift you gave/received',
    'A time you were successful','A challenge you overcame','A teacher who inspired you',
    'A meal you prepared','A city you have visited','An environmental problem',
    'A piece of art or music','A time you were nervous',
  ],
  part3: [
    'Education systems globally','Impact of social media','Environmental challenges',
    'Economic inequality','Future of healthcare','Technology in daily life',
    'Cultural diversity & globalisation','Crime and justice','Media reliability',
    'Work-life balance','Immigration & integration','Role of government',
    'Space exploration','Urbanisation & city living','Gender equality at work',
    'Traditional vs modern values','Privacy in the digital age',
    'Growth vs sustainability','Mental health awareness','Arts in education',
  ],
};

// ── Pitch Topics ─────────────────────────────────────────────────────────────
const PITCH_TOPICS = {
  pitch: [
    'SaaS product pitch','EdTech startup','HealthTech solution','Climate tech',
    'Fintech innovation','Consumer app idea','B2B platform','AI tool for business',
    'Marketplace startup','Hardware product',
  ],
  interview: [
    'Tell me about yourself','Describe a challenge you overcame',
    'Why do you want this job?','Where do you see yourself in 5 years?',
    'Your greatest strength & weakness','Describe your biggest failure',
    'Why should we hire you?','Tell me about a conflict with a teammate',
    'Describe your leadership style','What motivates you?',
  ],
  presentation: [
    'Quarterly results','New product launch','Research findings',
    'Team project proposal','Industry trends','Company strategy',
    'Market analysis','Investor update','Technical roadmap','Team retrospective',
  ],
};

// ── Filler words ─────────────────────────────────────────────────────────────
const FILLER_SET = new Set([
  'um','uh','like','basically','literally','actually',
  'you know','sort of','kind of','right','okay','so','well','i mean',
  'you see','anyway','honestly','obviously','clearly',
]);

// ── State ─────────────────────────────────────────────────────────────────────
let mediaStream      = null;
let audioRecorder    = null;
let audioChunks      = [];
let videoRecorder    = null;
let videoChunks      = [];
let emotionTimeline  = [];
let sessionStartTime = null;
let timerInterval    = null;
let isRecording      = false;
let fillerCount      = 0;

const cfg = {
  mode:     null,
  submode:  null,
  topic:    '',
  duration: 60,
  language: 'english',
};

// ── Accent colours per mode ───────────────────────────────────────────────────
const ACCENT = {
  ielts: '#3b82f6',
  pitch: '#6366f1',
  free:  '#10b981',
};

function setAccent(mode) {
  const c = ACCENT[mode] || '#3b82f6';
  document.documentElement.style.setProperty('--accent', c);
  document.documentElement.style.setProperty('--accent-dim', hexToRgba(c, 0.12));
  document.documentElement.style.setProperty('--accent-border', hexToRgba(c, 0.35));
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Camera ────────────────────────────────────────────────────────────────────
async function startCamera() {
  const loadingEl = document.getElementById('camLoading');
  const videoEl   = document.getElementById('video');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
      audio: true,
    });
    videoEl.srcObject = stream;
    videoEl.play();
    mediaStream = stream;
    loadingEl.classList.add('hidden');

    document.getElementById('liveBadge').classList.remove('hidden');
  } catch (err) {
    console.error('[camera]', err);

    const isPermission = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
    const msg = isPermission
      ? 'Camera access denied — allow access in browser settings and refresh'
      : 'Camera unavailable: ' + err.message;

    loadingEl.querySelector('p').textContent = msg;
    loadingEl.querySelector('p').style.cssText = 'color:#ef4444;text-align:center;padding:8px 12px';
    loadingEl.querySelector('.spinner').style.display = 'none';

    // Disable start button so user can't attempt to record without a stream
    document.getElementById('startBtn').disabled = true;
    document.getElementById('startBtn').textContent = '⚠ Camera required';
  }
}

// ── Emotion constants ─────────────────────────────────────────────────────────
const EMO_COLOR = {
  happy:'#eab308', sad:'#6366f1', angry:'#ef4444',
  fear:'#f97316', surprise:'#ec4899', disgust:'#14b8a6', neutral:'#71717a',
};

// ── Step navigation ───────────────────────────────────────────────────────────
function toggleStep(n) {
  const step = document.getElementById(`step${n}`);
  if (step.classList.contains('locked')) return;
  const isActive = step.classList.contains('active');
  // Collapse all, expand clicked
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  if (!isActive) step.classList.add('active');
}

function activateStep(n) {
  const step = document.getElementById(`step${n}`);
  step.classList.remove('locked');
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  step.classList.add('active');
}

function completeStep(n, label) {
  const step = document.getElementById(`step${n}`);
  step.classList.remove('active');
  step.classList.add('completed');
  if (label) document.getElementById(`step${n}Val`).textContent = label;
}

// ── Mode selection ────────────────────────────────────────────────────────────
function selectMode(mode) {
  // ── Full IELTS Simulation shortcut ────────────────────────────────────────
  if (mode === 'ielts_sim') {
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.mode === 'ielts_sim');
    });
    setTimeout(startIELTSSimulation, 300);
    return;
  }

  cfg.mode = mode;
  cfg.submode = null;
  cfg.topic   = '';

  setAccent(mode);

  // Mark button selected
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.mode === mode);
  });

  completeStep(1, { ielts: 'IELTS Speaking', pitch: 'Pitch & Interview', free: 'Free Talk' }[mode]);

  // Build step 2 based on mode
  if (mode === 'free') {
    cfg.submode = 'free';
    completeStep(2, 'Open practice');
    buildTopicStep(mode, null);
    activateStep(3);
  } else {
    buildSubmodeStep(mode);
    activateStep(2);
  }
}

function buildSubmodeStep(mode) {
  const body = document.getElementById('step2Body');
  let submodes;
  if (mode === 'ielts') {
    submodes = [
      { val: 'part1', label: 'Part 1 — Introduction & Interview' },
      { val: 'part2', label: 'Part 2 — Individual Long Turn (Cue Card)' },
      { val: 'part3', label: 'Part 3 — Two-Way Discussion' },
    ];
  } else {
    submodes = [
      { val: 'pitch',        label: 'Startup Pitch' },
      { val: 'interview',    label: 'Job Interview' },
      { val: 'presentation', label: 'Public Presentation' },
    ];
  }
  body.innerHTML = `<div class="submode-grid">${submodes.map(s =>
    `<button class="submode-btn" data-sm="${s.val}" onclick="selectSubmode('${s.val}','${escHtml(s.label)}')">
      <div class="submode-dot"></div>${s.label}
    </button>`
  ).join('')}</div>`;
}

function selectSubmode(sm, label) {
  cfg.submode = sm;
  document.querySelectorAll('.submode-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.sm === sm);
  });
  completeStep(2, label);
  buildTopicStep(cfg.mode, sm);
  activateStep(3);
}

function buildTopicStep(mode, sm) {
  const body = document.getElementById('step3Body');

  // IELTS: pick random topic silently — shown above video only after Start
  if (mode === 'ielts' && sm && IELTS_TOPICS[sm]) {
    const pool  = IELTS_TOPICS[sm];
    cfg.topic   = pool[Math.floor(Math.random() * pool.length)];
    body.innerHTML = '';   // no card in the step — topic reveals after Start
    completeStep(3, cfg.topic);
    activateStep(4);
    return;
  }

  // Pitch / Free: manual selection
  let topics = [];
  if (mode === 'pitch' && sm && PITCH_TOPICS[sm]) topics = PITCH_TOPICS[sm];

  const chipsHtml = topics.length
    ? `<div class="topic-label">Suggested topics</div>
       <div class="topic-grid">${topics.map(t =>
         `<button class="topic-chip" onclick="selectTopic(this,'${escHtml(t)}')">${t}</button>`
       ).join('')}</div>`
    : '';

  body.innerHTML = `
    <div class="topic-wrap">
      ${chipsHtml}
      <div class="topic-label" style="margin-top:${topics.length ? '12px' : '0'}">Or enter your own</div>
      <input class="topic-input" id="topicInput" type="text" placeholder="Type a topic… (press Enter)"
        onblur="onTopicInput(this.value)"
        onkeydown="if(event.key==='Enter'){event.preventDefault();onTopicInput(this.value);this.blur()}" />
    </div>`;
}

function selectTopic(btn, topic) {
  document.querySelectorAll('.topic-chip').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  cfg.topic = topic;
  const inp = document.getElementById('topicInput');
  if (inp) inp.value = topic;
  completeStep(3, topic);
  activateStep(4);
}

function onTopicInput(val) {
  document.querySelectorAll('.topic-chip').forEach(b => b.classList.remove('selected'));
  cfg.topic = val.trim();
  if (val.trim()) {
    completeStep(3, val.trim());
    activateStep(4);
  }
}

// ── Duration ─────────────────────────────────────────────────────────────────
function selectDuration(secs) {
  cfg.duration = secs;
  document.querySelectorAll('.dur-btn').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.dur) === secs);
  });
  completeStep(4, formatDuration(secs) + ' · ' + cfg.language);
  activateStep(5);
  buildStartSummary();
}

function selectLang(lang) {
  cfg.language = lang;
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.lang === lang);
  });
  if (cfg.duration) {
    completeStep(4, formatDuration(cfg.duration) + ' · ' + lang);
    buildStartSummary();
  }
}

function formatDuration(s) {
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m} min`;
}

function buildStartSummary() {
  const modeLabels = { ielts: 'IELTS Speaking', pitch: 'Pitch & Interview', free: 'Free Talk' };
  const rows = [
    ['Mode', modeLabels[cfg.mode] || cfg.mode],
    ['Format', cfg.submode || '—'],
    ['Topic', cfg.topic || 'Open'],
    ['Duration', formatDuration(cfg.duration)],
    ['Language', cfg.language === 'russian' ? 'Russian' : 'English'],
  ];
  document.getElementById('sessionSummary').innerHTML = rows.map(([k,v]) =>
    `<div class="summary-row"><span class="summary-key">${k}</span><span class="summary-val">${v}</span></div>`
  ).join('');
  activateStep(5);
}

// ── Topic display above video ─────────────────────────────────────────────────
function showTopicDisplay(text, showBullets = false, label = 'YOUR TOPIC') {
  const card    = document.getElementById('topicDisplay');
  const textEl  = document.getElementById('topicDisplayText');
  const bullets = document.getElementById('topicDisplayBullets');
  const labelEl = document.getElementById('topicDisplayLabel');
  if (!card || !text) return;
  if (labelEl) labelEl.textContent = label;
  textEl.textContent = text;
  bullets.classList.toggle('hidden', !showBullets);
  card.classList.remove('hidden');
}

// ── IELTS Part 2 prep screen (60 s) ──────────────────────────────────────────
let _prepTimerID = null;
let _prepResolve = null;

function showPrepScreen(topic) {
  return new Promise(resolve => {
    _prepResolve = resolve;
    const overlay = document.getElementById('prepOverlay');
    const topicEl = document.getElementById('prepTopicText');
    const timerEl = document.getElementById('prepTimer');
    if (!overlay) { resolve(); return; }

    if (topicEl) topicEl.textContent = topic || '';
    // Clear previous notes
    const notesEl = document.getElementById('prepNotes');
    if (notesEl) notesEl.value = '';

    let remaining = 60;
    if (timerEl) timerEl.textContent = fmtTime(remaining);
    overlay.classList.remove('hidden');

    _prepTimerID = setInterval(() => {
      remaining--;
      if (timerEl) timerEl.textContent = fmtTime(remaining);
      if (remaining <= 0) {
        clearInterval(_prepTimerID);
        _prepTimerID = null;
        overlay.classList.add('hidden');
        if (_prepResolve) { _prepResolve(); _prepResolve = null; }
      }
    }, 1000);
  });
}

function skipPrep() {
  if (_prepTimerID) { clearInterval(_prepTimerID); _prepTimerID = null; }
  const overlay = document.getElementById('prepOverlay');
  if (overlay) overlay.classList.add('hidden');
  if (_prepResolve) { _prepResolve(); _prepResolve = null; }
}

// ── Countdown + Recording ─────────────────────────────────────────────────────
async function beginCountdown() {
  if (!mediaStream) { alert('Camera not ready'); return; }

  // Show topic card above video (Part 2 gets bullet prompts)
  const isPart2 = cfg.mode === 'ielts' && cfg.submode === 'part2';
  showTopicDisplay(cfg.topic || 'Open practice', isPart2);

  // For IELTS Part 2: 60 s preparation before the countdown
  if (isPart2) {
    await showPrepScreen(cfg.topic);
  }

  const overlay = document.getElementById('countdownOverlay');
  const numEl   = document.getElementById('countdownNum');
  overlay.classList.remove('hidden');

  for (let i = 3; i >= 1; i--) {
    numEl.textContent = i;
    // Trigger reflow to re-fire animation
    numEl.style.animation = 'none';
    numEl.offsetHeight; // eslint-disable-line no-unused-expressions
    numEl.style.animation = '';
    await sleep(900);
  }
  numEl.textContent = 'GO';
  await sleep(700);
  overlay.classList.add('hidden');
  startRecording();
}

function startRecording() {
  isRecording      = true;
  audioChunks      = [];
  videoChunks      = [];
  emotionTimeline  = [];
  fillerCount      = 0;
  sessionStartTime = Date.now();

  // Audio-only recorder → for Groq transcription
  const audioStream  = new MediaStream(mediaStream.getAudioTracks());
  const audioMime    = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';
  audioRecorder = new MediaRecorder(audioStream, { mimeType: audioMime });
  audioRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
  audioRecorder.start(250);

  // Video recorder (video+audio) → for Hume emotion analysis
  const videoMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
  videoRecorder = new MediaRecorder(mediaStream, { mimeType: videoMime, videoBitsPerSecond: 500_000 });
  videoRecorder.ondataavailable = e => { if (e.data.size > 0) videoChunks.push(e.data); };
  videoRecorder.start(500);

  // UI
  document.getElementById('recBadge').classList.remove('hidden');
  document.getElementById('recStats').classList.remove('hidden');
  document.getElementById('stopBtn').classList.remove('hidden');
  document.getElementById('steps').style.opacity = '0.35';
  document.getElementById('steps').style.pointerEvents = 'none';

  // Timer
  let elapsed = 0;
  timerInterval = setInterval(() => {
    elapsed++;
    document.getElementById('timerPill').textContent = fmtTime(elapsed);
    if (cfg.duration > 0 && elapsed >= cfg.duration) stopRecording();
  }, 1000);
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearInterval(timerInterval);

  document.getElementById('stopBtn').classList.add('hidden');

  // Stop both recorders; wait for both to finish before processing
  let stopped = 0;
  const onBothStopped = () => { if (++stopped === 2) processSession(); };

  audioRecorder.onstop = onBothStopped;
  videoRecorder.onstop = onBothStopped;

  audioRecorder.stop();
  videoRecorder.stop();
}

async function processSession() {
  showProcessing('Processing session…', 10);

  const audioBlob    = new Blob(audioChunks, { type: 'audio/webm' });
  const videoMime    = videoChunks.length ? videoChunks[0].type || 'video/webm' : 'video/webm';
  const videoBlob    = new Blob(videoChunks, { type: videoMime });

  // ── Run transcription + Hume in parallel ────────────────────────────────────
  showProcessing('Transcribing audio…', 20);

  const audioForm = new FormData();
  audioForm.append('audio', audioBlob, 'recording.webm');
  audioForm.append('language', cfg.language === 'russian' ? 'ru' : 'en');

  const videoForm = new FormData();
  videoForm.append('video', videoBlob, 'recording.webm');

  const [transcriptResult, humeResult] = await Promise.allSettled([
    fetch('/transcribe',    { method: 'POST', body: audioForm }).then(r => r.json()),
    fetch('/analyze_video', { method: 'POST', body: videoForm }).then(r => r.json()),
  ]);

  showProcessing('Analyzing emotions with Hume AI…', 55);
  await sleep(300); // let the label render

  // ── Parse results ─────────────────────────────────────────────────────────
  let transcript = '';
  let words      = [];
  if (transcriptResult.status === 'fulfilled' && !transcriptResult.value.error) {
    transcript = transcriptResult.value.text  || '';
    words      = transcriptResult.value.words || [];
  } else {
    console.error('[transcribe]', transcriptResult.reason || transcriptResult.value?.error);
  }

  let humeTimeline = [];
  if (humeResult.status === 'fulfilled') {
    const hv = humeResult.value;
    humeTimeline = hv.emotion_timeline || [];
    if (hv.warning)  console.warn('[hume]', hv.warning);
    if (hv.fallback) showToast('Emotion analysis unavailable, proceeding without it');
  } else {
    console.error('[hume]', humeResult.reason);
    showToast('Emotion analysis unavailable, proceeding without it');
  }
  console.log('[hume] timeline entries:', humeTimeline.length);

  // ── Build session data ─────────────────────────────────────────────────────
  const fillerWords  = detectFillers(transcript);
  fillerCount        = fillerWords.length;
  const duration     = (Date.now() - sessionStartTime) / 1000;
  const confAvg      = calcConfAvg(humeTimeline);
  const createdAt    = new Date(sessionStartTime).toISOString();

  const sessionData = {
    mode:             cfg.mode,
    submode:          cfg.submode,
    topic:            cfg.topic,
    duration,
    transcript,
    words,
    language:         cfg.language,
    filler_words:     fillerWords,
    filler_count:     fillerCount,
    confidence_avg:   confAvg,
    emotion_timeline: humeTimeline,
    created_at:       createdAt,
  };

  console.log('[coach] Session data:', sessionData);
  localStorage.setItem('affecta_session', JSON.stringify(sessionData));

  showProcessing('Ready!', 100);
  await sleep(600);
  window.location.href = '/feedback';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function detectFillers(text) {
  if (!text) return [];
  const words = text.toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/);
  return words.filter(w => FILLER_SET.has(w));
}

function calcConfAvg(timeline) {
  if (!timeline.length) return 0;
  return timeline.reduce((s, e) => s + (e.confidence || 0), 0) / timeline.length;
}

function fmtTime(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
}

// ── Processing modal ──────────────────────────────────────────────────────────
function showProcessing(msg, pct) {
  const overlay = document.getElementById('processingOverlay');
  overlay.classList.remove('hidden');
  document.getElementById('processingStatus').textContent = msg;
  document.getElementById('processingBar').style.width = pct + '%';
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, duration = 4000) {
  const el = document.getElementById('toastMsg');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), duration);
}

// ── Daily Challenge ───────────────────────────────────────────────────────────
async function loadDailyChallenge() {
  const banner = document.getElementById('challengeBanner');
  if (!banner) return;
  try {
    const res  = await fetch('/api/daily_challenge');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('challengeTopic').textContent = data.topic;
    document.getElementById('challengePart').textContent  =
      { part1: 'Part 1', part2: 'Part 2', part3: 'Part 3' }[data.part] || data.part;

    const btn = document.getElementById('challengeStartBtn');
    if (data.completed) {
      btn.textContent = '✓ Completed today';
      btn.disabled    = true;
      btn.classList.add('completed');
    } else {
      btn.onclick = () => startChallenge(data.topic, data.part);
    }
    banner.classList.remove('hidden');
  } catch (_) {}
}

function startChallenge(topic, part) {
  selectMode('ielts');
  // Wait for DOM to update then select submode + inject topic
  setTimeout(() => {
    selectSubmode(part, { part1: 'Part 1 — Introduction & Interview', part2: 'Part 2 — Individual Long Turn (Cue Card)', part3: 'Part 3 — Two-Way Discussion' }[part] || part);
    // Override the randomly assigned topic with the challenge topic
    cfg.topic = topic;
    const body = document.getElementById('step3Body');
    if (body) {
      body.innerHTML = `
        <div class="ielts-topic-card challenge">
          <div class="ielts-topic-icon">🎯</div>
          <div class="ielts-topic-body">
            <div class="ielts-topic-label">Today's Challenge Topic</div>
            <div class="ielts-topic-text">${escHtml(topic)}</div>
            <div class="ielts-topic-note">In real IELTS you cannot change your topic. Practice with what you get.</div>
          </div>
        </div>`;
    }
    completeStep(3, topic);
    activateStep(4);
  }, 100);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.getElementById('stopBtn').addEventListener('click', stopRecording);

// Start camera immediately on page load
startCamera();
loadDailyChallenge();


/* ════════════════════════════════════════════════════════════════════════════
   IELTS FULL SIMULATION MODULE
   ════════════════════════════════════════════════════════════════════════════ */

// ── Interview state ───────────────────────────────────────────────────────────
const ieltsSim = {
  startTime:    null,
  part1: { questions: [], answers: [] },
  part2: { cueCard: null, notes: '', transcript: '', followupQ: '', followupA: '' },
  part3: { questions: [], answers: [] },
  emoTimeline:  [],
  partTimerID:  null,
  emoCapID:     null,
};

// Resolve fn set before each recordAndTranscribe() call
let _answerResolve = null;
let _ieltsRecorder = null;
let _ieltsChunks   = [];
let _answerTimerID = null;
let _ieltsRecording = false;

// ── Entry point ───────────────────────────────────────────────────────────────
function startIELTSSimulation() {
  setAccent('ielts');
  ieltsSim.startTime = Date.now();

  // Hide regular flow, show IELTS panel
  document.getElementById('steps').style.display       = 'none';
  document.getElementById('ieltsPanel').classList.remove('hidden');

  // Emotion analysis runs post-session via Hume (no real-time /analyze endpoint)
  ieltsSim.emoCapID = null;

  runPart1();
}

// ── PART 1 ────────────────────────────────────────────────────────────────────
async function runPart1() {
  setPartHeader('PART 1', 'Introduction & Interview', 0, 9, 5 * 60);
  addSystemMsg('Part 1 — Introduction & Interview. I will ask you 9 questions about everyday topics. Answer naturally.');

  for (let i = 1; i <= 9; i++) {
    updateQCount(i, 9);
    updateProgress(i, 9);

    const prevQs  = ieltsSim.part1.questions.join(' | ');
    const prevAs  = ieltsSim.part1.answers.map(a => a.transcript).slice(-3).join(' ');
    const q       = await fetchInterviewerQ(1, prevQs, prevAs, i);
    ieltsSim.part1.questions.push(q);
    addAIBubble(q);
    showTopicDisplay(q, false, 'CURRENT QUESTION');

    const transcript = await recordAndTranscribe(20, `Answer (max 20s)`);
    ieltsSim.part1.answers.push({ question: q, transcript });
    addUserBubble(transcript);
  }

  clearInterval(ieltsSim.partTimerID);
  await showTransition('Part 1 Complete ✓', 'Starting Part 2 in 5 seconds…', 5);
  runPart2();
}

// ── PART 2 ────────────────────────────────────────────────────────────────────
async function runPart2() {
  setPartHeader('PART 2', 'Individual Long Turn', 0, 0, 4 * 60);
  clearChat();

  // Fetch cue card
  addThinkingBubble();
  const res  = await fetch('/interviewer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ part: 2, cue_card: true }),
  });
  const data = await res.json();
  removeThinkingBubble();
  ieltsSim.part2.cueCard = data.cue_card;
  showCueCard(data.cue_card);
  showTopicDisplay(data.cue_card?.topic || '', true, 'YOUR TOPIC');

  // 60s prep countdown
  addSystemMsg('You have 1 minute to prepare. Make notes if you like. Recording starts automatically.');
  await prepCountdown(60);

  // Hide notes, switch to speaking mode
  document.getElementById('cueNotes').style.display = 'none';
  document.getElementById('cuePrepPill').textContent = 'SPEAKING NOW';
  document.getElementById('cuePrepPill').style.color = '#ef4444';
  document.getElementById('cuePrepPill').style.borderColor = 'rgba(239,68,68,0.3)';
  document.getElementById('cuePrepPill').style.background  = 'rgba(239,68,68,0.08)';

  // 2 min monologue — auto-record with countdown in header
  setPartHeader('PART 2', 'Long Turn — Speaking', 0, 0, 2 * 60);
  const monologue = await recordAndTranscribe(120, 'Speak for up to 2 minutes');
  ieltsSim.part2.transcript = monologue;
  addUserBubble(monologue);

  // Followup question
  addThinkingBubble();
  const fuRes  = await fetch('/interviewer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      part:             'followup',
      context:          ieltsSim.part2.cueCard?.topic || '',
      previous_answers: monologue.slice(0, 250),
    }),
  });
  const fuData = await fuRes.json();
  removeThinkingBubble();
  ieltsSim.part2.followupQ = fuData.question;
  addAIBubble(fuData.question);

  const fuA = await recordAndTranscribe(30, 'Answer (max 30s)');
  ieltsSim.part2.followupA = fuA;
  addUserBubble(fuA);

  clearInterval(ieltsSim.partTimerID);
  await showTransition('Part 2 Complete ✓', 'Starting Part 3 in 5 seconds…', 5);
  runPart3();
}

// ── PART 3 ────────────────────────────────────────────────────────────────────
async function runPart3() {
  setPartHeader('PART 3', 'Two-Way Discussion', 0, 5, 5 * 60);
  clearChat();
  hideCueCard();
  addSystemMsg('Part 3 — Two-Way Discussion. I will ask abstract questions related to the Part 2 topic.');

  const topic = ieltsSim.part2.cueCard?.topic || '';

  for (let i = 1; i <= 5; i++) {
    updateQCount(i, 5);
    updateProgress(i, 5);

    const prevAs = ieltsSim.part3.answers.map(a => a.transcript).slice(-2).join(' ');
    const q      = await fetchInterviewerQ(3, topic, prevAs, i);
    ieltsSim.part3.questions.push(q);
    addAIBubble(q);
    showTopicDisplay(q, false, 'CURRENT QUESTION');

    const transcript = await recordAndTranscribe(60, 'Answer (max 60s)');
    ieltsSim.part3.answers.push({ question: q, transcript });
    addUserBubble(transcript);
  }

  clearInterval(ieltsSim.partTimerID);
  await showTransition('All Parts Complete ✓', 'Generating your feedback…', 3);
  finishIELTS();
}

// ── Finish ────────────────────────────────────────────────────────────────────
function finishIELTS() {
  clearInterval(ieltsSim.emoCapID);
  hideControls();

  const p1Lines = ieltsSim.part1.answers
    .map((a, i) => `Q${i + 1}: ${a.question}\nA: ${a.transcript}`)
    .join('\n\n');
  const p2Lines = [
    `Topic: ${ieltsSim.part2.cueCard?.topic || ''}`,
    `Monologue: ${ieltsSim.part2.transcript}`,
    `Follow-up Q: ${ieltsSim.part2.followupQ}`,
    `Follow-up A: ${ieltsSim.part2.followupA}`,
  ].join('\n');
  const p3Lines = ieltsSim.part3.answers
    .map((a, i) => `Q${i + 1}: ${a.question}\nA: ${a.transcript}`)
    .join('\n\n');

  const fullTranscript = [
    'PART 1 — Introduction & Interview:\n' + p1Lines,
    'PART 2 — Long Turn:\n' + p2Lines,
    'PART 3 — Two-Way Discussion:\n' + p3Lines,
  ].join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');

  const fillerWords = detectFillers(fullTranscript);
  const duration    = (Date.now() - ieltsSim.startTime) / 1000;
  const confAvg     = calcConfAvg(ieltsSim.emoTimeline);

  const sessionData = {
    mode:             'ielts',
    submode:          'full_simulation',
    topic:            'Full IELTS Simulation — ' + (ieltsSim.part2.cueCard?.topic || ''),
    duration,
    transcript:       fullTranscript,
    language:         cfg.language,
    filler_words:     fillerWords,
    filler_count:     fillerWords.length,
    confidence_avg:   confAvg,
    emotion_timeline: ieltsSim.emoTimeline,
    created_at:       new Date(ieltsSim.startTime).toISOString(),
  };

  console.log('[ielts] Session data ready, redirecting to feedback');
  localStorage.setItem('affecta_session', JSON.stringify(sessionData));
  window.location.href = '/feedback';
}

// ── Core: record + transcribe (returns Promise<string>) ───────────────────────
function recordAndTranscribe(maxSecs, hint) {
  return new Promise(resolve => {
    _answerResolve = resolve;
    showAnswerBtn(maxSecs, hint);
  });
}

function showAnswerBtn(maxSecs, hint) {
  const controls = document.getElementById('ieltsControls');
  const btn      = document.getElementById('ieltsAnswerBtn');
  const label    = document.getElementById('ieltsAnswerLabel');
  const timeEl   = document.getElementById('ieltsAnswerTime');
  const maxEl    = document.getElementById('ieltsAnswerMax');

  controls.classList.remove('hidden');
  btn.disabled      = false;
  btn.className     = 'ielts-answer-btn';
  label.textContent = 'Answer';
  timeEl.classList.add('hidden');
  timeEl.textContent = '0:00';
  maxEl.classList.remove('hidden');
  maxEl.textContent = hint || `Max ${maxSecs}s`;

  btn.onclick = () => beginIELTSRecording(maxSecs);
}

async function beginIELTSRecording(maxSecs) {
  if (!mediaStream) return;
  _ieltsChunks   = [];
  _ieltsRecording = true;

  const audioStream = new MediaStream(mediaStream.getAudioTracks());
  const mimeType    = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';
  _ieltsRecorder = new MediaRecorder(audioStream, { mimeType });
  _ieltsRecorder.ondataavailable = e => { if (e.data.size > 0) _ieltsChunks.push(e.data); };
  _ieltsRecorder.start(250);

  // UI
  const btn   = document.getElementById('ieltsAnswerBtn');
  const label = document.getElementById('ieltsAnswerLabel');
  const timeEl = document.getElementById('ieltsAnswerTime');
  btn.className     = 'ielts-answer-btn recording';
  label.textContent = 'Stop';
  timeEl.classList.remove('hidden');
  btn.onclick = stopIELTSRecording;

  // Auto-stop timer
  let elapsed = 0;
  _answerTimerID = setInterval(() => {
    elapsed++;
    timeEl.textContent = fmtTime(elapsed);
    if (elapsed >= maxSecs) stopIELTSRecording();
  }, 1000);
}

async function stopIELTSRecording() {
  if (!_ieltsRecording) return;
  _ieltsRecording = false;
  clearInterval(_answerTimerID);

  const btn   = document.getElementById('ieltsAnswerBtn');
  const label = document.getElementById('ieltsAnswerLabel');
  btn.disabled      = true;
  label.textContent = 'Processing…';
  btn.className     = 'ielts-answer-btn';

  _ieltsRecorder.onstop = async () => {
    const blob = new Blob(_ieltsChunks, { type: 'audio/webm' });
    let transcript = '';

    if (blob.size > 0) {
      try {
        const fd = new FormData();
        fd.append('audio', blob, 'answer.webm');
        const res  = await fetch('/transcribe', { method: 'POST', body: fd });
        const data = await res.json();
        transcript = data.text || '';
      } catch (err) {
        console.error('[ielts transcribe]', err);
        transcript = '(transcription failed)';
      }
    }

    hideControls();
    if (_answerResolve) {
      _answerResolve(transcript || '(no speech detected)');
      _answerResolve = null;
    }
  };
  _ieltsRecorder.stop();
}

// ── Prep countdown (Part 2) ───────────────────────────────────────────────────
function prepCountdown(secs) {
  return new Promise(resolve => {
    const timerEl = document.getElementById('cuePrepTimer');
    timerEl.classList.remove('speaking');
    let remaining = secs;
    timerEl.textContent = fmtTime(remaining);

    const id = setInterval(() => {
      remaining--;
      timerEl.textContent = fmtTime(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        timerEl.classList.add('speaking');
        resolve();
      }
    }, 1000);
  });
}

// ── Part transition overlay ───────────────────────────────────────────────────
function showTransition(title, sub, secs) {
  return new Promise(resolve => {
    const overlay   = document.getElementById('ieltsTransition');
    document.getElementById('transTitle').textContent    = title;
    document.getElementById('transSub').textContent      = sub;
    document.getElementById('transCountdown').textContent = secs;
    overlay.classList.remove('hidden');

    let remaining = secs;
    const id = setInterval(() => {
      remaining--;
      document.getElementById('transCountdown').textContent = remaining;
      if (remaining <= 0) {
        clearInterval(id);
        overlay.classList.add('hidden');
        resolve();
      }
    }, 1000);
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setPartHeader(part, desc, qCurrent, qTotal, totalSecs) {
  document.getElementById('ieltsBadge').textContent = part;
  document.getElementById('ieltsQCount').textContent =
    qTotal > 0 ? `${desc} · Question ${qCurrent} / ${qTotal}` : desc;
  document.getElementById('ieltsTimer').classList.remove('recording');

  clearInterval(ieltsSim.partTimerID);
  let remaining = totalSecs;
  document.getElementById('ieltsTimer').textContent = fmtTime(remaining);
  ieltsSim.partTimerID = setInterval(() => {
    remaining--;
    document.getElementById('ieltsTimer').textContent = fmtTime(remaining);
    if (remaining <= 0) clearInterval(ieltsSim.partTimerID);
  }, 1000);
}

function updateQCount(current, total) {
  const badge = document.getElementById('ieltsBadge').textContent;
  document.getElementById('ieltsQCount').textContent =
    `${badge === 'PART 1' ? 'Intro' : 'Discussion'} · Question ${current} / ${total}`;
}

function updateProgress(current, total) {
  document.getElementById('ieltsProgressFill').style.width = ((current - 1) / total * 100) + '%';
}

function clearChat() {
  document.getElementById('ieltsChat').innerHTML = '';
}

function hideControls() {
  document.getElementById('ieltsControls').classList.add('hidden');
}

function showCueCard(card) {
  const el = document.getElementById('ieltsCueCard');
  el.classList.remove('hidden');
  document.getElementById('cueTopic').textContent = card.topic;
  document.getElementById('cueBullets').innerHTML = card.bullets.map(b => `<li>${escHtml(b)}</li>`).join('');
  document.getElementById('cueNotes').style.display = '';
  document.getElementById('cueNotes').value = '';
  // Reset prep pill
  const pill = document.getElementById('cuePrepPill');
  pill.textContent = 'PREPARATION TIME';
  pill.style.color         = '';
  pill.style.borderColor   = '';
  pill.style.background    = '';
}

function hideCueCard() {
  document.getElementById('ieltsCueCard').classList.add('hidden');
}

function addAIBubble(text) {
  const chat = document.getElementById('ieltsChat');
  const div  = document.createElement('div');
  div.className = 'chat-bubble ai';
  div.innerHTML = `<div class="bubble-label">Examiner</div>
    <div class="bubble-text">${escHtml(text)}</div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function addUserBubble(text) {
  if (!text || text === '(no speech detected)') return;
  const chat = document.getElementById('ieltsChat');
  const div  = document.createElement('div');
  div.className = 'chat-bubble user';
  div.innerHTML = `<div class="bubble-label">You</div>
    <div class="bubble-text">${escHtml(text)}</div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function addSystemMsg(text) {
  const chat = document.getElementById('ieltsChat');
  const div  = document.createElement('div');
  div.style.cssText = 'text-align:center;font-size:12px;color:#3f3f46;padding:4px 0;font-weight:500';
  div.textContent   = text;
  chat.appendChild(div);
}

function addThinkingBubble() {
  const chat = document.getElementById('ieltsChat');
  const div  = document.createElement('div');
  div.id        = 'thinkingBubble';
  div.className = 'chat-bubble ai bubble-thinking';
  div.innerHTML = `<div class="bubble-label">Examiner</div>
    <div class="bubble-text"><div class="dot-pulse"><span></span><span></span><span></span></div></div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function removeThinkingBubble() {
  const el = document.getElementById('thinkingBubble');
  if (el) el.remove();
}

// ── API call ──────────────────────────────────────────────────────────────────
async function fetchInterviewerQ(part, context, prevAnswers, qNum) {
  addThinkingBubble();
  try {
    const res  = await fetch('/interviewer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        part,
        context,
        previous_answers: prevAnswers,
        question_number:  qNum,
      }),
    });
    const data = await res.json();
    removeThinkingBubble();
    return data.question || 'What do you think about that?';
  } catch (err) {
    removeThinkingBubble();
    console.error('[interviewer]', err);
    return 'Could you tell me more about yourself?';
  }
}

/* selectMode is defined earlier in coach.js and already handles ielts_sim
   via the IELTS_SIM_MODE constant checked at the top of that function. */

startCamera();
