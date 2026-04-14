# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
python app.py
```

Opens http://localhost:8080 automatically. No build step — frontend is vanilla JS served as static files.

## Environment variables

Required in `.env`:
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — Supabase project credentials
- `GROQ_API_KEY` — used for Whisper transcription and LLaMA-3.3-70b feedback generation
- `HUME_API_KEY` — used for batch video emotion analysis (optional; app degrades gracefully without it)
- `SECRET_KEY` — Flask session secret (defaults to a dev key if unset)

## Database setup

The app uses **Supabase (Postgres)** with Row Level Security. Before first run, execute the `CREATE TABLE` SQL statements in the comments at the top of `app.py` via Supabase Dashboard → SQL Editor. Every table has an RLS policy restricting access to the owning user.

> **Note:** `database.py` and `affecta.db` are a legacy SQLite layer that is **not used** by any Flask routes. It can be ignored. Similarly, `utils/`, `data/`, and `reports/` are a standalone legacy tool (`utils/reporter.py`) that generates HTML dashboards from CSV emotion logs — also not connected to any Flask routes.

## Architecture

**All server logic lives in `app.py`** (~1150 lines). No blueprints or separate modules.

### Auth flow
Supabase PKCE OAuth (Google) and email/password. After successful auth, `access_token` + `refresh_token` are stored in the Flask session. Every protected route uses the `@require_auth` decorator. Database access uses `_supa_exec(fn)` which auto-refreshes the JWT on expiry by calling `_refresh_access_token()`. Per-request Supabase clients are created via `_supa(access_token)` to avoid shared-state issues.

### Request → response patterns

**AI feedback** (`/generate_feedback`, `/vocabulary_analysis`): SSE streaming via `Response(stream_with_context(...), content_type="text/event-stream")`. The client reads chunks with `ReadableStream`. Each SSE line is `data: {"text": "..."}`, terminated by `data: {"done": true}`.

**Video emotion analysis** (`/analyze_video`): Receives a video blob, submits a Hume batch job, polls until complete (max 120 s), returns `emotion_timeline` as a JSON array of `{timestamp, ms, emotion, confidence, all_emotions}`.

**Transcription** (`/transcribe`): Sends audio to Groq Whisper (`whisper-large-v3`) with `verbose_json` + word timestamps. Returns `{text, words: [{word, start, end}]}`.

**IELTS simulation** (`/interviewer`): Stateless — caller passes the full conversation context (part, question number, previous answers, topics used). Returns next question or Part 2 cue card JSON.

### Score formula
`overall_score = clamp(0, 100, confidence_avg - min(filler_count×3, 30) + min(duration/10, 10))`  
Defined in `_calc_score()` and applied server-side in `/save_session`.

### Frontend structure
Each page has its own CSS and JS file (`static/css/<page>.css`, `static/js/<page>.js`). No framework, no bundler. Chart.js 4.4 loaded from CDN on pages that need it.

Key frontend files:
- `static/js/coach.js` — the main recording flow: camera setup, MediaRecorder (two recorders: audio-only for Groq, video+audio for Hume), IELTS simulation state machine (`ieltsSim` object), countdown/prep overlays, topic display
- `static/js/feedback.js` — session replay rendering, emotion heatmap, Chart.js charts, SSE feedback streaming, `saveSession()` call
- `static/js/profile.js` — streak rendering, score ring animation

### Emotion color maps
Two separate maps exist — **don't confuse them**:
- `EMO_COLOR` in `feedback.js` — DeepFace-style keys (`happy`, `sad`, etc.) used for heatmap word coloring
- `EMOTION_COLORS` in `feedback.js` — Hume AI keys (`joy`, `calmness`, `excitement`, etc.) used for donut chart and session replay

Hume returns ~30 emotion names; the `EMOTION_COLORS` map covers the common ones with a `'#64748b'` fallback.

### Language support
`language` field (`"english"` or `"russian"`) flows from the coach UI through to `/generate_feedback`. In `_build_prompt()`, a `language_instruction` string is prepended to every prompt branch to enforce the response language.

### Daily challenge
`/api/daily_challenge` uses `hash(str(date.today())) % len(_CHALLENGE_TOPICS)` — deterministic per calendar day, same topic for all users.

### Streak calculation
In `/api/profile/stats`: iterates unique session days descending from today to compute `streak_count`; scans ascending to find `longest_streak`. `streak_at_risk = True` when today has no session yet.
