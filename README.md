# Affecta

AI-powered IELTS speaking coach. Practice speaking, get real-time AI feedback, and track your emotional and performance trends over time.

## Features

- **IELTS Simulation** — Parts 1, 2 & 3 with adaptive question flow
- **Transcription** — Groq Whisper (`whisper-large-v3`) with word-level timestamps
- **AI Feedback** — Streamed analysis via LLaMA-3.3-70b (Groq)
- **Video Emotion Analysis** — Hume AI batch job; 30-emotion timeline synced to transcript
- **Session Replay** — Emotion heatmap overlaid on words
- **Progress Map** — Skill rings (Fluency, Vocabulary, Confidence, Consistency), score trend, weekly activity
- **Onboarding** — Band score, target, exam date, goal
- **Streaks** — Daily practice tracking

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.10+ / Flask |
| Database | Supabase (Postgres + Auth) |
| Transcription | Groq Whisper |
| LLM Feedback | Groq LLaMA-3.3-70b |
| Emotion Analysis | Hume AI |
| Frontend | Vanilla JS, Chart.js 4.4 |

## Prerequisites

- Python 3.10+
- A [Supabase](https://supabase.com) project
- A [Groq](https://console.groq.com) API key
- A [Hume AI](https://beta.hume.ai) API key (optional)

## Setup

### 1. Clone & install

```bash
git clone https://github.com/<your-username>/affecta.git
cd affecta
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Set up the database

Run the following SQL in **Supabase Dashboard → SQL Editor**:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  mode             TEXT,
  submode          TEXT,
  topic            TEXT,
  duration         INTEGER,
  transcript       TEXT,
  overall_score    INTEGER,
  confidence_avg   REAL,
  filler_count     INTEGER,
  filler_words     JSONB DEFAULT '[]',
  emotion_timeline JSONB DEFAULT '[]',
  ai_feedback      TEXT,
  language         TEXT
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own" ON sessions FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON sessions FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own" ON sessions FOR DELETE  USING (auth.uid() = user_id);

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

### 4. Configure Supabase Auth (Google OAuth)

1. **Supabase Dashboard → Authentication → Providers → Google** — enable and add your Google OAuth credentials
2. **Google Cloud Console → APIs & Services → Credentials → OAuth Client → Authorised redirect URIs** — add:
   ```
   https://<your-supabase-ref>.supabase.co/auth/v1/callback
   ```
3. **Supabase → Authentication → URL Configuration**:
   - Site URL: `http://localhost:8080`
   - Redirect URLs: `http://localhost:8080/auth/callback`

### 5. Run

```bash
python app.py
```

Opens `http://localhost:8080` automatically.

## Project Structure

```
affecta/
├── app.py                  # All Flask routes and business logic (~1310 lines)
├── routes/                 # Reserved for future route extraction
├── services/               # Reserved for future service extraction
├── static/
│   ├── css/                # Per-page stylesheets
│   ├── js/                 # Per-page JavaScript (no bundler)
│   └── images/
├── templates/              # Jinja2 HTML templates
├── requirements.txt
├── .env.example
└── README.md
```

## Score Formula

```
overall_score = clamp(0, 100, confidence_avg − min(filler_count × 3, 30) + min(duration / 10, 10))
```

## License

Tony Stark approved
