# SYSTEM.md — Affecta Architecture Reference

This document is intended for AI agents and developers who need a complete technical picture of the codebase.

---

## Entry Point

```
python app.py  →  http://localhost:8080
```

All server logic lives in **`app.py`** (~1310 lines). No blueprints or separate modules in production yet. The `routes/` and `services/` directories are scaffolded for future extraction.

---

## Auth Flow

- **Providers**: Supabase PKCE OAuth (Google) + email/password
- After auth: `access_token` + `refresh_token` stored in Flask session
- Every protected route uses `@require_auth` decorator
- Every route that requires onboarding uses `@require_profile` (fails open if `user_profiles` table is missing)
- Decorator order: `@require_auth` outer, `@require_profile` inner
- `_supa_exec(fn)` — wraps all DB calls; auto-refreshes JWT via `_refresh_access_token()` on 401
- `_supa(access_token)` — per-request Supabase client (avoids shared-state issues in threaded Flask)

---

## Database (Supabase / Postgres)

### Tables

**`sessions`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto |
| user_id | UUID FK → auth.users | |
| created_at | TIMESTAMPTZ | |
| mode | TEXT | `"ielts"`, `"free"`, `"challenge"` |
| submode | TEXT | IELTS part, etc. |
| topic | TEXT | |
| duration | INTEGER | seconds |
| transcript | TEXT | |
| overall_score | INTEGER | 0–100 |
| confidence_avg | REAL | |
| filler_count | INTEGER | |
| filler_words | JSONB | array of strings |
| emotion_timeline | JSONB | array of `{timestamp, ms, emotion, confidence, all_emotions}` |
| ai_feedback | TEXT | |
| language | TEXT | `"english"` or `"russian"` |

**`user_profiles`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto |
| user_id | UUID FK → auth.users UNIQUE | |
| current_band | REAL | IELTS band 0–9 |
| target_band | REAL | |
| exam_date | DATE | |
| goal | TEXT | |
| created_at | TIMESTAMPTZ | |

All tables have RLS enabled; policies restrict all operations to the owning user via `auth.uid() = user_id`.

---

## API Endpoints

### Auth
| Route | Method | Description |
|-------|--------|-------------|
| `/auth` | GET | Login/register page |
| `/auth/callback` | GET | Supabase PKCE callback |
| `/auth/google` | GET | Initiate Google OAuth |
| `/logout` | GET | Clear session, redirect to auth |

### Pages (protected)
| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Redirect → `/coach` or `/auth` |
| `/coach` | GET | Main practice page |
| `/feedback` | GET | Post-session feedback page |
| `/history` | GET | Session history list |
| `/profile` | GET | User profile & stats |
| `/progress` | GET | Progress map page |
| `/onboarding` | GET | Onboarding wizard |

### API (JSON/SSE)
| Route | Method | Description |
|-------|--------|-------------|
| `/transcribe` | POST | Audio → Groq Whisper → `{text, words}` |
| `/analyze_video` | POST | Video blob → Hume batch → `emotion_timeline` |
| `/generate_feedback` | POST | SSE stream of AI feedback |
| `/vocabulary_analysis` | POST | SSE stream of vocabulary analysis |
| `/interviewer` | POST | Stateless IELTS question generator |
| `/save_session` | POST | Persist session to Supabase |
| `/api/sessions` | GET | Paginated session list |
| `/api/session/<id>` | GET | Single session detail |
| `/api/session/<id>` | DELETE | Delete session |
| `/api/profile/stats` | GET | Streak + aggregate stats |
| `/api/progress_map` | GET | Skill scores + trends + activity |
| `/api/daily_challenge` | GET | Today's challenge topic (deterministic) |
| `/api/onboarding` | POST | Save onboarding profile |
| `/api/user_profile` | GET | Retrieve user profile |

---

## Request / Response Patterns

### SSE Streaming (`/generate_feedback`, `/vocabulary_analysis`)
```
Content-Type: text/event-stream
data: {"text": "...chunk..."}\n\n
...
data: {"done": true}\n\n
```
Client reads via `ReadableStream`. Implemented with Flask `stream_with_context`.

### Video Emotion Analysis (`/analyze_video`)
1. Receive video blob (multipart)
2. Submit Hume batch job
3. Poll until complete (max 120 s, 3 s intervals)
4. Return `emotion_timeline`: `[{timestamp, ms, emotion, confidence, all_emotions}]`

### Transcription (`/transcribe`)
- Sends audio to Groq `whisper-large-v3` with `verbose_json` + word timestamps
- Returns `{text: string, words: [{word, start, end}]}`

### IELTS Interviewer (`/interviewer`)
- **Stateless** — caller passes full context: `{part, question_number, previous_answers, topics_used, language}`
- Returns next question string or Part 2 cue card JSON

---

## Score Formula

```python
overall_score = clamp(0, 100,
    confidence_avg
    - min(filler_count * 3, 30)
    + min(duration / 10, 10)
)
```
Defined in `_calc_score()`, applied server-side in `/save_session`.

---

## Skill Scores (`/api/progress_map`)

| Skill | Formula |
|-------|---------|
| Fluency | avg of `confidence_avg` across sessions |
| Vocabulary | `100 - min(avg_fillers × 5, 60)` |
| Confidence | avg of `overall_score` |
| Consistency | `streak_count × 10`, capped at 100 |

---

## Frontend Structure

No framework, no bundler. Each page has its own CSS and JS file.

```
static/css/<page>.css
static/js/<page>.js
```

Chart.js 4.4 loaded from CDN on pages that need it.

### Key JS Files

**`static/js/coach.js`**
- Camera setup, dual `MediaRecorder` (audio-only for Groq, video+audio for Hume)
- IELTS simulation state machine (`ieltsSim` object)
- Countdown/prep overlays, topic display

**`static/js/feedback.js`**
- Session replay rendering, emotion heatmap, Chart.js charts
- SSE feedback streaming
- `saveSession()` call
- Two emotion color maps (see below — do not confuse)

**`static/js/profile.js`**
- Streak rendering, score ring animation

**`static/js/progress.js`**
- `renderGoalHero()`, `renderSkills()`, `renderTrendChart()`, `renderWeeklyActivity()`, `renderModeBreakdown()`

**`static/js/onboarding.js`**
- `goToStep()`, `selectBand()`, `selectGoal()`, `updateSlider()`, `submitOnboarding()`, `launchConfetti()`

---

## Emotion Color Maps — Do Not Confuse

| Variable | File | Keys | Used For |
|----------|------|------|----------|
| `EMO_COLOR` | `feedback.js` | DeepFace: `happy`, `sad`, `angry`, … | Heatmap word coloring |
| `EMOTION_COLORS` | `feedback.js` | Hume: `joy`, `calmness`, `excitement`, … | Donut chart + session replay |

Hume returns ~30 emotion names; `EMOTION_COLORS` has a `'#64748b'` fallback for unmapped ones.

---

## Language Support

`language` field (`"english"` or `"russian"`) flows from the coach UI through to `/generate_feedback`.
In `_build_prompt()`, a `language_instruction` string is prepended to every prompt branch.

---

## Daily Challenge

```python
/api/daily_challenge → hash(str(date.today())) % len(_CHALLENGE_TOPICS)
```
Deterministic per calendar day; same topic for all users.

---

## Streak Calculation (`/api/profile/stats`)

- Iterates unique session days **descending** from today → `streak_count`
- Iterates **ascending** to find `longest_streak`
- `streak_at_risk = True` when today has no session yet

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `GROQ_API_KEY` | Yes | Groq API key (Whisper + LLaMA) |
| `HUME_API_KEY` | No | Hume AI key (video emotions; app degrades gracefully) |
| `SECRET_KEY` | Recommended | Flask session secret (defaults to dev key) |

---

## Legacy / Excluded Files

The following were removed from the repository as they are not connected to any Flask routes:

| Path | Reason |
|------|--------|
| `database.py` | Legacy SQLite layer |
| `affecta.db` | Legacy SQLite database |
| `utils/` | Standalone CSV → HTML report tool |
| `data/` | Legacy session CSVs |
| `reports/` | Generated HTML dashboards |
| `models/*.onnx` | Unused ONNX model (33 MB) |
