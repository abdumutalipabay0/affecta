"""
Affecta — Flask web application.

Run:  python3 app.py
Then: http://localhost:8080  (opens automatically)

Architecture
────────────
All routes live in routes/ as Flask Blueprints.
Shared helpers (Supabase client, auth decorators, prompt builder) live in services/.

Database setup (run once in Supabase Dashboard → SQL Editor):
─────────────────────────────────────────────────────────────
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

Google OAuth setup (Supabase Dashboard):
─────────────────────────────────────────
  1. Authentication → Providers → Google → Enable
  2. Add Google OAuth Client ID and Client Secret
     (create at console.cloud.google.com → APIs & Services → Credentials)
  3. Google Console → OAuth Client → Authorised redirect URIs:
     https://<your-supabase-ref>.supabase.co/auth/v1/callback
  4. Supabase → Authentication → URL Configuration:
     Site URL = http://localhost:8080
     Redirect URLs: http://localhost:8080/auth/callback
"""

import os
import threading
import webbrowser

from dotenv import load_dotenv
from flask import Flask

load_dotenv()

# ── App ────────────────────────────────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "affecta-dev-key-2026")
app.config["MAX_CONTENT_LENGTH"]       = 50 * 1024 * 1024  # 50 MB
app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 24 * 7  # 7 days

# ── Blueprints ─────────────────────────────────────────────────────────────────

from routes.auth        import auth_bp
from routes.pages       import pages_bp
from routes.ai          import ai_bp
from routes.sessions    import sessions_bp
from routes.profile_api import profile_api_bp

app.register_blueprint(auth_bp)
app.register_blueprint(pages_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(sessions_bp)
app.register_blueprint(profile_api_bp)

# ── Startup DB check ───────────────────────────────────────────────────────────

from services.db import supabase

try:
    supabase.table("sessions").select("id").limit(1).execute()
    print("[supabase] sessions table OK")
except Exception as _exc:
    print(f"[supabase] sessions table check failed: {_exc}")
    print("[supabase] Run the CREATE TABLE SQL in the docstring above.")

try:
    supabase.table("user_profiles").select("id").limit(1).execute()
    print("[supabase] user_profiles table OK")
except Exception as _exc:
    print(f"[supabase] user_profiles table missing — onboarding will fail open: {_exc}")

# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    def _open_browser():
        import time
        time.sleep(1.2)
        webbrowser.open("http://localhost:8080")

    threading.Thread(target=_open_browser, daemon=True).start()
    print("Affecta starting → http://localhost:8080")
    app.run(host="0.0.0.0", port=8080, debug=False, threaded=True)
