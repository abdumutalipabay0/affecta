# PROGRESS.md — Affecta

## Stack
- Python Flask (single-file app.py ~1310 lines) + Vanilla JS + Supabase (Postgres + Auth)
- Groq (Whisper + LLaMA-3.3-70b) · Hume AI (video emotions) · Chart.js 4.4
- Entry point: `app.py` → http://localhost:8080

## What Was Done (prev sessions)
- Removed NEUTRAL/0% emotion overlay (updateEmotionUI / EMO_EMOJI removed from coach.js)
- Removed ielts-topic-card from regular IELTS buildTopicStep() — kept in startChallenge() (intentional)
- Created CLAUDE.md

## What Was Done (this session) ✅
All 3 features + nav updates implemented:

### Feature 1 — ONBOARDING ✅
- `templates/onboarding.html` — 4-step wizard with slide animation, confetti on step 4
- `static/css/onboarding.css`
- `static/js/onboarding.js` — goToStep(), selectBand(), selectGoal(), updateSlider(), submitOnboarding(), launchConfetti()
- `app.py`: added `require_profile` decorator (fail-open), `/onboarding` GET, `/api/onboarding` POST, `/api/user_profile` GET
- `app.py`: `@require_profile` added to `/coach`, `/feedback`, `/history`, `/profile`, `/progress`
- SQL comment added to app.py for `user_profiles` table

### Feature 2 — PROGRESS MAP ✅
- `templates/progress.html` — hero goal bar, 2×2 skill rings, score trend chart, 7-day activity, mode breakdown
- `static/css/progress.css`
- `static/js/progress.js` — renderGoalHero(), renderSkills(), renderTrendChart(), renderWeeklyActivity(), renderModeBreakdown()
- `app.py`: `/progress` GET + `/api/progress_map` GET (computes Fluency/Vocabulary/Confidence/Consistency + trends + weekly_activity + mode_breakdown)

### Feature 3 — SESSION REPLAY ✅
- `templates/feedback.html`: added `.replay-section` block between hero metrics and `.fb-body`
- `static/js/feedback.js`: added `renderSessionReplay(timeline, words)` + `EMO_EMOJI` map, called from `init()`
- `static/css/feedback.css`: added `.replay-section`, `.replay-track`, `.replay-block`, `.replay-tooltip`, `.replay-legend` styles

### Nav updates ✅
- Added "Progress" link to coach.html, feedback.html, history.html, profile.html

## Pending: Before First Run
Run this SQL in Supabase Dashboard → SQL Editor:
```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  current_band  REAL,
  target_band   REAL,
  exam_date     DATE,
  goal          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own" ON user_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own" ON user_profiles FOR UPDATE USING (auth.uid() = user_id);
```

## Key Decisions Recorded
- `require_profile` fails open (if table missing → set onboarded=True, don't block)
- Decorator order: `@require_auth` outer, `@require_profile` inner
- Onboarding slides: flex container `translateX(-${(step-1)*25}%)` for 4-step
- Session replay works without word timestamps (tooltip degrades gracefully)
- words array NOT saved to DB — available only for fresh sessions from localStorage
- Skill scores: Fluency=avg conf_avg, Vocabulary=100-min(avg_fillers×5,60), Confidence=avg overall_score, Consistency=streak×10 capped 100
