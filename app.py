"""
Affecta — Flask web application.

Run:  python3 app.py
Then: http://localhost:8080  (opens automatically)
"""

import json
import os
import tempfile
import threading
import time
import traceback
import webbrowser
from datetime import datetime
from functools import wraps

from dotenv import load_dotenv
from flask import (Flask, Response, jsonify, redirect, render_template,
                   request, session as flask_session, stream_with_context,
                   url_for)

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "affecta-dev-key-2026")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB
app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 24 * 7  # 7 days

# ── Supabase ───────────────────────────────────────────────────────────────────
#
# GOOGLE OAUTH SETUP (Supabase Dashboard):
#   1. Authentication → Providers → Google → Enable
#   2. Add your Google OAuth Client ID and Client Secret
#      (create at console.cloud.google.com → APIs & Services → Credentials)
#   3. In Google Console → OAuth Client → Authorised redirect URIs add:
#      https://<your-supabase-ref>.supabase.co/auth/v1/callback
#   4. Authentication → URL Configuration → Site URL = http://localhost:8080
#      Add to Redirect URLs: http://localhost:8080/auth/callback
#
# SQL — run once in Supabase Dashboard → SQL Editor:
#   CREATE TABLE IF NOT EXISTS sessions (
#     id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
#     user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
#     created_at       TIMESTAMPTZ DEFAULT NOW(),
#     mode             TEXT,
#     submode          TEXT,
#     topic            TEXT,
#     duration         INTEGER,
#     transcript       TEXT,
#     overall_score    INTEGER,
#     confidence_avg   REAL,
#     filler_count     INTEGER,
#     filler_words     JSONB DEFAULT '[]',
#     emotion_timeline JSONB DEFAULT '[]',
#     ai_feedback      TEXT,
#     language         TEXT
#   );
#   ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
#   CREATE POLICY "select_own" ON sessions FOR SELECT  USING (auth.uid() = user_id);
#   CREATE POLICY "insert_own" ON sessions FOR INSERT  WITH CHECK (auth.uid() = user_id);
#   CREATE POLICY "delete_own" ON sessions FOR DELETE  USING (auth.uid() = user_id);
#
#   CREATE TABLE IF NOT EXISTS user_profiles (
#     id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
#     user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
#     current_band  REAL,
#     target_band   REAL,
#     exam_date     DATE,
#     goal          TEXT,
#     created_at    TIMESTAMPTZ DEFAULT NOW()
#   );
#   ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
#   CREATE POLICY "select_own" ON user_profiles FOR SELECT USING (auth.uid() = user_id);
#   CREATE POLICY "insert_own" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
#   CREATE POLICY "update_own" ON user_profiles FOR UPDATE USING (auth.uid() = user_id);

from supabase import create_client as _create_supabase_client

_SUPA_URL = os.getenv("SUPABASE_URL", "")
_SUPA_KEY = os.getenv("SUPABASE_ANON_KEY", "")

# Global anon client — used for auth operations (sign_in, sign_up, OAuth)
supabase = _create_supabase_client(_SUPA_URL, _SUPA_KEY)
print("[supabase] Client ready")


def _supa(access_token: str | None = None):
    """Return a fresh Supabase client, optionally authenticated with a user JWT.
    A new client per request avoids shared-state issues in threaded Flask."""
    client = _create_supabase_client(_SUPA_URL, _SUPA_KEY)
    if access_token:
        client.postgrest.auth(access_token)
    return client


def _refresh_access_token() -> str | None:
    """Use the stored refresh_token to get a new access_token.
    Updates flask_session in-place. Returns the new token or None on failure."""
    refresh_token = flask_session.get("refresh_token")
    if not refresh_token:
        print("[supabase] no refresh_token in session — cannot refresh")
        return None
    try:
        result = supabase.auth.refresh_session(refresh_token)
        sess   = result.session
        flask_session["access_token"]  = sess.access_token
        flask_session["refresh_token"] = sess.refresh_token
        flask_session["user_id"]       = str(result.user.id)
        flask_session["user_email"]    = result.user.email or ""
        print("[supabase] token refreshed OK")
        return sess.access_token
    except Exception as exc:
        print(f"[supabase] token refresh failed: {exc}")
        flask_session.clear()   # force re-login; token is irrecoverable
        return None


def _supa_exec(fn):
    """Execute fn(access_token).
    On JWT expiry: refresh once and retry. Raises on any other error."""
    token = flask_session.get("access_token")
    try:
        return fn(token)
    except Exception as exc:
        if "JWT expired" not in str(exc) and "PGRST303" not in str(exc):
            raise
        print("[supabase] JWT expired — attempting token refresh")
        new_token = _refresh_access_token()
        if not new_token:
            raise
        return fn(new_token)


def _calc_score(confidence_avg: float, filler_count: int, duration: float) -> int:
    base           = confidence_avg
    filler_penalty = min(filler_count * 3, 30)
    duration_bonus = min(duration / 10, 10)
    return max(0, min(100, int(base - filler_penalty + duration_bonus)))


try:
    supabase.table("sessions").select("id").limit(1).execute()
    print("[supabase] sessions table OK")
except Exception as _exc:
    print(f"[supabase] sessions table check failed: {_exc}")
    print("[supabase] Run the CREATE TABLE SQL in the app.py comment above.")

try:
    supabase.table("user_profiles").select("id").limit(1).execute()
    print("[supabase] user_profiles table OK")
except Exception as _exc:
    print(f"[supabase] user_profiles table missing — onboarding will fail open: {_exc}")


# ── Auth helpers ───────────────────────────────────────────────────────────────

def require_auth(f):
    """Redirect to /auth if the user is not logged in."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not flask_session.get("user_id"):
            return redirect(url_for("auth_page"))
        return f(*args, **kwargs)
    return decorated


def require_profile(f):
    """Redirect to /onboarding if the user hasn't completed onboarding.
    Must be applied INSIDE @require_auth (i.e., listed after it in decorator order)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not flask_session.get("onboarded"):
            user_id = flask_session.get("user_id")
            try:
                result = _supa_exec(
                    lambda tok: _supa(tok)
                    .table("user_profiles")
                    .select("id")
                    .eq("user_id", user_id)
                    .limit(1)
                    .execute()
                )
                if result.data:
                    flask_session["onboarded"] = True
                else:
                    return redirect(url_for("onboarding"))
            except Exception as exc:
                print(f"[require_profile] check failed (fail open): {exc}")
                flask_session["onboarded"] = True  # fail open — don't block on table missing
        return f(*args, **kwargs)
    return decorated

# ── Hume AI ────────────────────────────────────────────────────────────────────

_HUME_KEY = os.getenv("HUME_API_KEY", "")
_hume_enabled = bool(_HUME_KEY)

if _hume_enabled:
    print("[hume] API key found — video emotion analysis enabled")
else:
    print("[hume] WARNING: HUME_API_KEY not set — emotion analysis will return empty timeline")


def _parse_hume_predictions(predictions) -> list[dict]:
    """Convert Hume job predictions → unified emotion_timeline list."""
    timeline: list[dict] = []
    try:
        for file_pred in predictions:
            results = getattr(file_pred, "results", None)
            if results is None:
                continue
            for inference_pred in (results.predictions or []):
                models = getattr(inference_pred, "models", None)
                if models is None:
                    continue
                face_model = getattr(models, "face", None)
                if face_model is None:
                    continue
                for group in (face_model.grouped_predictions or []):
                    for pred in (group.predictions or []):
                        t_sec    = float(getattr(pred, "time", 0) or 0)
                        emotions = getattr(pred, "emotions", None) or []
                        if not emotions:
                            continue
                        # Sort by score descending
                        sorted_emos = sorted(emotions, key=lambda e: float(e.score or 0), reverse=True)
                        top         = sorted_emos[0]
                        top_name    = (top.name or "neutral").lower()
                        top_score   = round(float(top.score or 0) * 100, 1)
                        all_emos    = {
                            e.name.lower(): round(float(e.score or 0) * 100, 1)
                            for e in sorted_emos[:8]
                        }
                        timeline.append({
                            "timestamp":    round(t_sec, 3),
                            "ms":           round(t_sec * 1000),
                            "emotion":      top_name,
                            "confidence":   top_score,
                            "all_emotions": all_emos,
                        })
    except Exception as exc:
        print(f"[hume] parse error: {exc}")
        traceback.print_exc()
    return sorted(timeline, key=lambda x: x["timestamp"])


# ── Prompt builder ─────────────────────────────────────────────────────────────

def _build_prompt(data: dict) -> str:
    mode      = data.get("mode", "free")
    submode   = data.get("submode", "")
    topic     = data.get("topic", "")
    duration  = float(data.get("duration", 0))
    transcript = data.get("transcript", "")
    language  = data.get("language", "english")
    filler_words    = data.get("filler_words", [])
    confidence_avg  = float(data.get("confidence_avg", 0))
    emotion_timeline = data.get("emotion_timeline", [])

    # Language instruction — prepended to every prompt
    language_instruction = (
        "Respond in Russian language."
        if data.get("language") == "russian"
        else "Respond in English."
    )

    # Emotion timeline — first 20 entries formatted
    timeline_lines = []
    for entry in emotion_timeline[:20]:
        if isinstance(entry, dict):
            ms  = entry.get("ms", entry.get("timestamp", "?"))
            em  = entry.get("emotion", "?")
            pct = entry.get("confidence", entry.get("percent", "?"))
            timeline_lines.append(f"{ms}ms: {em} {pct}%")
        else:
            timeline_lines.append(str(entry))
    timeline_str = "\n".join(timeline_lines) if timeline_lines else "No data."

    # Filler words summary
    if isinstance(filler_words, list):
        if filler_words:
            filler_summary = f"{len(filler_words)} filler words detected: {', '.join(filler_words[:30])}"
        else:
            filler_summary = "No filler words detected."
    else:
        filler_summary = str(filler_words)

    # Common context block
    context = (
        f"Topic: {topic or 'Not specified'}\n"
        f"Duration: {duration:.1f} seconds\n"
        f"Confidence (avg): {confidence_avg:.1f}%\n"
        f"Fillers: {filler_summary}\n\n"
        f"Transcript:\n{transcript or '(empty)'}\n\n"
        f"Emotion timeline (first 20 samples):\n{timeline_str}\n"
    )

    # ── Progress mode ──────────────────────────────────────────────────────────
    if mode == "progress":
        sessions = data.get("sessions", [])
        n        = len(sessions)
        scores   = [str(s.get("overall_score", "?")) for s in sessions]
        modes    = [s.get("mode", "?") for s in sessions]
        return (
            language_instruction + "\n\n" +
            f"You are analyzing speaking progress over {n} sessions. "
            f"Scores: {', '.join(scores)}. "
            f"Modes: {', '.join(modes)}. "
            "Give a concise 3-4 sentence progress analysis covering: trend, main strength, "
            "main area to improve. Be specific and encouraging."
        )

    # ── IELTS mode ─────────────────────────────────────────────────────────────
    if mode == "ielts":
        part_labels = {
            "part1": "Part 1 (Introduction & Interview)",
            "part2": "Part 2 (Individual Long Turn / Cue Card)",
            "part3": "Part 3 (Two-Way Discussion)",
        }
        part_label = part_labels.get(submode, f"Part: {submode}")
        return (
            language_instruction + "\n\n" +
            f"You are a strict IELTS examiner assessing {part_label}. "
            "Evaluate the candidate's response using official IELTS band descriptors. "
            "Be precise, critical, and constructive.\n\n"
            f"{context}\n"
            "Provide your assessment using EXACTLY these sections:\n\n"
            "## Band Score Estimate\n"
            "Give an estimated band (e.g. 6.0, 6.5, 7.0) with one sentence justification.\n\n"
            "## Fluency & Coherence\n"
            "Comment on hesitations, self-corrections, topic development, and use of cohesive devices.\n\n"
            "## Lexical Resource\n"
            "Comment on vocabulary range, precision, collocations, and any errors.\n\n"
            "## Grammatical Range & Accuracy\n"
            "Comment on sentence complexity, tense use, and grammatical errors.\n\n"
            "## Pronunciation & Delivery\n"
            "Comment on pace, clarity, and emotional delivery based on the emotion timeline.\n\n"
            "## Key Moment Analysis\n"
            "Identify the single strongest moment and the single weakest moment in the transcript.\n\n"
            "## One Drill For Tomorrow\n"
            "Give one specific, actionable 5-minute practice drill to address the biggest weakness."
        )

    # ── Pitch mode ─────────────────────────────────────────────────────────────
    if mode == "pitch" and submode == "pitch":
        return (
            language_instruction + "\n\n" +
            "You are a startup coach who has evaluated pitches securing $500M+ in funding. "
            "Be direct, brutally honest, and actionable.\n\n"
            f"{context}\n"
            "Provide your assessment using EXACTLY these sections:\n\n"
            "## Hook Score X/10\n"
            "Rate the opening hook and explain why it works or fails.\n\n"
            "## Problem-Solution Clarity X/10\n"
            "Rate how clearly the problem and solution are articulated.\n\n"
            "## Confidence Arc\n"
            "Describe how the speaker's confidence evolved using the emotion timeline.\n\n"
            "## Killer Lines\n"
            "Quote the 1-2 strongest lines verbatim and explain why they land.\n\n"
            "## Fatal Weaknesses\n"
            "List the top 2-3 weaknesses that would make an investor tune out.\n\n"
            "## The Weakest Moment\n"
            "Identify the exact moment (with approximate timestamp if available) where the pitch lost momentum.\n\n"
            "## Rewrite This Line\n"
            "Pick the weakest line, quote it, then rewrite it to be investor-grade.\n\n"
            "## One Thing To Fix Before Next Pitch\n"
            "Give one clear, specific action to take before the next pitch."
        )

    # ── Interview mode ─────────────────────────────────────────────────────────
    if mode == "pitch" and submode == "interview":
        return (
            language_instruction + "\n\n" +
            "You are an expert interview coach who has prepared candidates for Google, McKinsey, and Goldman Sachs. "
            "Be rigorous, empathetic, and specific.\n\n"
            f"{context}\n"
            "Provide your assessment using EXACTLY these sections:\n\n"
            "## Overall Impression X/10\n"
            "Rate the overall interview performance and give a one-sentence summary.\n\n"
            "## STAR Structure Analysis\n"
            "Assess use of Situation, Task, Action, Result structure. Was it present? Complete? Compelling?\n\n"
            "## Confidence Arc\n"
            "Describe how the speaker's confidence evolved using the emotion timeline.\n\n"
            "## Strongest Moments\n"
            "Identify the 1-2 moments where the candidate shone brightest.\n\n"
            "## Critical Weaknesses\n"
            "List the top 2-3 weaknesses that would cost points with a real interviewer.\n\n"
            "## The Weakest Answer Moment\n"
            "Identify the exact moment where the answer fell apart or lost the interviewer.\n\n"
            "## Rewrite This Line\n"
            "Pick the weakest line, quote it, then rewrite it to be interview-grade.\n\n"
            "## One Thing To Fix Before The Interview\n"
            "Give one clear, specific action to take before the real interview."
        )

    # ── Presentation mode ──────────────────────────────────────────────────────
    if mode == "pitch" and submode == "presentation":
        return (
            language_instruction + "\n\n" +
            "You are a TED speaker coach who has prepared speakers for the main TED stage. "
            "Focus on storytelling, structure, and audience impact.\n\n"
            f"{context}\n"
            "Provide your assessment using EXACTLY these sections:\n\n"
            "## Overall Score X/10\n"
            "Rate the overall presentation and give a one-sentence summary.\n\n"
            "## Opening Impact X/10\n"
            "Rate the opening 30 seconds and explain whether it would hook an audience.\n\n"
            "## Structure & Flow\n"
            "Assess the logical flow, transitions, and whether the structure serves the message.\n\n"
            "## Audience Engagement\n"
            "Comment on techniques used (or missing) to engage the audience.\n\n"
            "## Storytelling Elements\n"
            "Identify any stories, analogies, or vivid examples. Were they effective?\n\n"
            "## The Weakest Moment\n"
            "Identify the exact moment where audience attention would be lost.\n\n"
            "## Rewrite The Opening\n"
            "Rewrite the first 2-3 sentences to be TED-stage worthy.\n\n"
            "## One Focus For Next Time\n"
            "Give one specific area to focus on for the next practice session."
        )

    # ── Free talk mode (default) ───────────────────────────────────────────────
    return (
        language_instruction + "\n\n" +
        "You are a supportive speaking coach who helps people become more confident communicators. "
        "Be encouraging, warm, and specific.\n\n"
        f"{context}\n"
        "Provide your assessment using EXACTLY these sections:\n\n"
        "## Overall Impression\n"
        "Give a brief warm summary of the speaker's performance.\n\n"
        "## Communication Strengths\n"
        "Highlight 2-3 genuine strengths observed in this session.\n\n"
        "## Speaking Patterns\n"
        "Describe recurring patterns (positive or negative) in pace, pausing, or structure.\n\n"
        "## Vocabulary Highlights\n"
        "Note any particularly effective word choices, or suggest upgrades for weak ones.\n\n"
        "## Emotional Presence\n"
        "Comment on emotional expressiveness based on the emotion timeline.\n\n"
        "## One Small Win For Tomorrow\n"
        "Give one tiny, achievable improvement to practice tomorrow."
    )


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("landing.html")


# ── Auth routes ────────────────────────────────────────────────────────────────

@app.route("/auth")
def auth_page():
    if flask_session.get("user_id"):
        return redirect(url_for("coach"))
    error = request.args.get("error", "")
    return render_template("auth.html", error=error)


@app.route("/auth/callback")
def auth_callback():
    return render_template("auth_callback.html")


@app.route("/auth/session", methods=["POST"])
def auth_set_session():
    """Store tokens received from the OAuth callback (sent by client JS)."""
    data          = request.get_json(silent=True) or {}
    access_token  = data.get("access_token", "")
    refresh_token = data.get("refresh_token", "")
    if not access_token:
        return jsonify({"error": "missing access_token"}), 400
    try:
        user = supabase.auth.get_user(access_token).user
        flask_session.permanent = True
        flask_session["user_id"]       = str(user.id)
        flask_session["user_email"]    = user.email or ""
        flask_session["access_token"]  = access_token
        flask_session["refresh_token"] = refresh_token
        return jsonify({"ok": True, "email": user.email})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 401


@app.route("/auth/google")
def auth_google():
    result = supabase.auth.sign_in_with_oauth({
        "provider": "google",
        "options":  {"redirect_to": "http://localhost:8080/auth/callback"},
    })
    return redirect(result.url)


@app.route("/auth/exchange", methods=["POST"])
def auth_exchange():
    code = (request.get_json(silent=True) or {}).get("code", "")
    if not code:
        return jsonify({"error": "missing code"}), 400
    try:
        result = supabase.auth.exchange_code_for_session({"auth_code": code})
        user   = result.user
        sess   = result.session
        flask_session.permanent = True
        flask_session["user_id"]       = str(user.id)
        flask_session["user_email"]    = user.email or ""
        flask_session["access_token"]  = sess.access_token
        flask_session["refresh_token"] = sess.refresh_token
        return jsonify({"ok": True, "redirect": "/coach"})
    except Exception as exc:
        print(f"[supabase] exchange_code error: {exc}")
        return jsonify({"error": str(exc)}), 401


@app.route("/auth/login", methods=["POST"])
def auth_login():
    data     = request.get_json(silent=True) or {}
    email    = data.get("email", "").strip()
    password = data.get("password", "")
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    try:
        res  = supabase.auth.sign_in_with_password({"email": email, "password": password})
        user = res.user
        sess = res.session
        flask_session.permanent = True
        flask_session["user_id"]       = str(user.id)
        flask_session["user_email"]    = user.email or ""
        flask_session["access_token"]  = sess.access_token
        flask_session["refresh_token"] = sess.refresh_token
        return jsonify({"ok": True, "redirect": "/coach"})
    except Exception as exc:
        msg = str(exc)
        if "Invalid login credentials" in msg or "invalid_credentials" in msg:
            return jsonify({"error": "Invalid email or password"}), 401
        return jsonify({"error": msg}), 400


@app.route("/auth/signup", methods=["POST"])
def auth_signup():
    data     = request.get_json(silent=True) or {}
    email    = data.get("email", "").strip()
    password = data.get("password", "")
    name     = data.get("name", "").strip()
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    try:
        sign_up_data: dict = {"email": email, "password": password}
        if name:
            sign_up_data["options"] = {"data": {"full_name": name}}
        res  = supabase.auth.sign_up(sign_up_data)
        user = res.user
        sess = res.session
        if user and not sess:
            return jsonify({"ok": True, "confirm_email": True})
        flask_session.permanent = True
        flask_session["user_id"]       = str(user.id)
        flask_session["user_email"]    = user.email or ""
        flask_session["access_token"]  = sess.access_token
        flask_session["refresh_token"] = sess.refresh_token
        return jsonify({"ok": True, "redirect": "/coach"})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    if flask_session.get("access_token"):
        try:
            supabase.auth.sign_out()
        except Exception:
            pass
    flask_session.clear()
    return jsonify({"ok": True, "redirect": "/auth"})


@app.route("/auth/forgot", methods=["POST"])
def auth_forgot():
    data  = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    if not email:
        return jsonify({"ok": False, "error": "Email required"}), 400
    try:
        supabase.auth.reset_password_email(email)
    except Exception:
        pass  # Never reveal whether the email exists
    return jsonify({"ok": True})


# ── Protected page routes ──────────────────────────────────────────────────────

@app.route("/onboarding")
@require_auth
def onboarding():
    """Onboarding wizard — shown on first login before any protected page."""
    if flask_session.get("onboarded"):
        return redirect(url_for("coach"))
    user_id = flask_session.get("user_id")
    try:
        result = _supa_exec(
            lambda tok: _supa(tok)
            .table("user_profiles")
            .select("id")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if result.data:
            flask_session["onboarded"] = True
            return redirect(url_for("coach"))
    except Exception:
        pass
    from datetime import date as _date
    return render_template("onboarding.html", today=_date.today().isoformat())


@app.route("/coach")
@require_auth
@require_profile
def coach():
    return render_template("coach.html")


@app.route("/feedback")
@require_auth
@require_profile
def feedback():
    return render_template("feedback.html")


@app.route("/history")
@require_auth
@require_profile
def history():
    return render_template("history.html")


@app.route("/profile")
@require_auth
@require_profile
def profile():
    return render_template("profile.html")


@app.route("/progress")
@require_auth
@require_profile
def progress():
    return render_template("progress.html")


@app.route("/api/profile/stats")
@require_auth
def api_profile_stats():
    user_id = flask_session.get("user_id")

    try:
        rows = _supa_exec(
            lambda tok: _supa(tok)
            .table("sessions")
            .select("id,created_at,mode,submode,topic,overall_score,duration")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        ).data
    except Exception as exc:
        print(f"[profile/stats] error: {exc}")
        rows = []

    total_sessions = len(rows)
    scores         = [r["overall_score"] for r in rows if r.get("overall_score") is not None]
    avg_score      = round(sum(scores) / len(scores)) if scores else 0
    best_score     = max(scores) if scores else 0
    total_minutes  = round(sum(r.get("duration", 0) or 0 for r in rows) / 60)

    # Streak — current + longest + meta
    from datetime import timedelta as _td
    streak_count     = 0
    longest_streak   = 0
    last_session_date = None
    streak_at_risk   = True

    if rows:
        seen_days = sorted(
            {r["created_at"][:10] for r in rows if r.get("created_at")},
            reverse=True,
        )
        today = datetime.utcnow().date()
        last_session_date = seen_days[0] if seen_days else None
        streak_at_risk = today.isoformat() not in seen_days

        # Current streak — count from today backwards (no grace period)
        check = today
        for day_str in seen_days:
            day = datetime.strptime(day_str, "%Y-%m-%d").date()
            if day == check:
                streak_count += 1
                check = check - _td(days=1)
            elif day < check:
                break

        # Longest streak ever — scan all unique days ascending
        asc_days = sorted(datetime.strptime(d, "%Y-%m-%d").date() for d in seen_days)
        cur = 0
        prev_day = None
        for d in asc_days:
            if prev_day is None or d == prev_day + _td(days=1):
                cur += 1
            else:
                cur = 1
            longest_streak = max(longest_streak, cur)
            prev_day = d

    streak = streak_count  # keep backward-compat key

    # Score trend — last 10 sessions (oldest first for chart)
    trend_rows  = [r for r in rows if r.get("overall_score") is not None][:10]
    score_trend = [r["overall_score"] for r in reversed(trend_rows)]

    # Recent sessions — last 5
    recent_sessions = rows[:5]

    # Member since — oldest session date
    all_dates   = [r["created_at"] for r in rows if r.get("created_at")]
    member_since = min(all_dates) if all_dates else None

    return jsonify({
        "user_email":        flask_session.get("user_email", ""),
        "member_since":      member_since,
        "total_sessions":    total_sessions,
        "avg_score":         avg_score,
        "best_score":        best_score,
        "total_minutes":     total_minutes,
        "streak":            streak_count,
        "streak_count":      streak_count,
        "longest_streak":    longest_streak,
        "last_session_date": last_session_date,
        "streak_at_risk":    streak_at_risk,
        "score_trend":       score_trend,
        "recent_sessions":   recent_sessions,
    })


@app.route("/status")
def status():
    return jsonify({"ready": True})


@app.route("/analyze_video", methods=["POST"])
def analyze_video():
    """Receive a video blob, send to Hume Batch API, return emotion_timeline."""
    tmp_path = None
    try:
        if "video" not in request.files:
            return jsonify({"error": "No video file"}), 400

        video_file = request.files["video"]
        suffix     = ".webm"
        if video_file.content_type and "mp4" in video_file.content_type:
            suffix = ".mp4"

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            video_file.save(tmp.name)
            tmp_path = tmp.name

        size = os.path.getsize(tmp_path)
        print(f"[hume] video received: {size} bytes, suffix={suffix}")

        if size < 1000:
            return jsonify({"error": "Video too small", "emotion_timeline": []}), 400

        if not _hume_enabled:
            print("[hume] No API key — returning empty timeline")
            return jsonify({"emotion_timeline": [], "warning": "HUME_API_KEY not configured"})

        from hume import HumeClient
        from hume.expression_measurement.batch import Face, Models, InferenceBaseRequest

        client = HumeClient(api_key=_HUME_KEY)
        batch  = client.expression_measurement.batch

        # Submit job with local file
        with open(tmp_path, "rb") as f:
            job_id = batch.start_inference_job_from_local_file(
                file=[("file", f)],
                json=InferenceBaseRequest(models=Models(face=Face())),
            )

        print(f"[hume] job submitted: {job_id}")

        # Poll until complete (max 120s)
        deadline = time.time() + 120
        while time.time() < deadline:
            job_details = batch.get_job_details(job_id)
            status_str  = job_details.state.status if job_details.state else "UNKNOWN"
            if status_str == "COMPLETED":
                break
            if status_str == "FAILED":
                raise RuntimeError(f"Hume job failed: {job_details}")
            print(f"[hume] job status: {status_str} — waiting…")
            time.sleep(3)
        else:
            raise TimeoutError("Hume job timed out after 120s")

        predictions   = batch.get_job_predictions(job_id)
        print(f"[hume] got {len(predictions)} prediction file(s)")
        emotion_timeline = _parse_hume_predictions(predictions)
        print(f"[hume] parsed {len(emotion_timeline)} timeline entries")

        return jsonify({"emotion_timeline": emotion_timeline})

    except Exception as exc:
        print(f"[hume] analyze_video error: {exc}")
        traceback.print_exc()
        return jsonify({"emotion_timeline": [], "error": "Emotion analysis unavailable", "fallback": True})

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.route("/transcribe", methods=["POST"])
def transcribe():
    tmp_path = None
    try:
        print("=== TRANSCRIBE CALLED ===")
        print(f"Files: {list(request.files.keys())}")
        print(f"Form:  {list(request.form.keys())}")

        if "audio" not in request.files:
            print("ERROR: no 'audio' key in request.files")
            return jsonify({"error": "No audio file"}), 400

        audio_file = request.files["audio"]
        print(f"Audio file: name={audio_file.filename!r}, content_type={audio_file.content_type!r}")

        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name

        size = os.path.getsize(tmp_path)
        print(f"Saved to: {tmp_path}, size: {size} bytes")

        if size == 0:
            print("ERROR: audio file is empty (0 bytes)")
            return jsonify({"error": "Audio file is empty"}), 400

        language = request.form.get("language", "en")
        print(f"Transcription language: {language!r}")

        from groq import Groq
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))

        with open(tmp_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["word"],
                language=language,
            )

        print(f"Transcript ({len(result.text)} chars): {result.text[:120]!r}")

        words = []
        if hasattr(result, "words") and result.words:
            for w in result.words:
                if isinstance(w, dict):
                    words.append({"word": w["word"], "start": w["start"], "end": w["end"]})
                else:
                    words.append({"word": w.word, "start": w.start, "end": w.end})
        print(f"Words: {len(words)}")

        return jsonify({"text": result.text, "words": words})

    except Exception as exc:
        print(f"TRANSCRIBE ERROR: {exc}")
        traceback.print_exc()
        return jsonify({"text": "", "words": [], "error": "Transcription unavailable"})

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.route("/interviewer", methods=["POST"])
def interviewer():
    """Generate the next IELTS examiner question or cue card via Groq."""
    data            = request.get_json(silent=True) or {}
    part            = data.get("part", 1)
    context         = data.get("context", "")
    prev_answers    = data.get("previous_answers", "")
    question_number = int(data.get("question_number", 1))

    if part == 2 and data.get("cue_card"):
        prompt = (
            "You are a certified IELTS examiner creating a Part 2 cue card.\n"
            "Return ONLY a valid JSON object — no markdown, no explanation — in this exact format:\n"
            '{"topic":"Describe a ...","bullets":["You should say:","what it was","when it happened","why it was important","and explain how you felt about it"]}\n'
            "Make the topic varied and interesting. Bullets must be exactly 5 items starting with 'You should say:'."
        )
    elif part == "followup":
        prompt = (
            "You are a certified IELTS examiner. "
            f"The candidate just completed their Part 2 long turn. Topic: {context}\n"
            f"Summary of their answer: {prev_answers[:300]}\n"
            "Ask ONE short follow-up question to probe a little deeper. "
            "Return ONLY the question text, nothing else."
        )
    elif part == 1:
        topics_used = context or "none yet"
        prompt = (
            "You are a certified IELTS examiner conducting Part 1 (Introduction & Interview).\n"
            f"This is question {question_number} of 9.\n"
            f"Topics already covered: {topics_used}\n"
            f"Summary of previous answers: {prev_answers[:400] or 'none yet'}\n"
            "Generate the NEXT natural Part 1 question. Vary the topics across: "
            "hometown, home, work/study, hobbies, family, food, weather, technology, "
            "transport, health, friends, daily routine, sports, music, shopping.\n"
            "Keep it conversational and natural. Return ONLY the question text."
        )
    elif part == 3:
        prompt = (
            "You are a certified IELTS examiner conducting Part 3 (Two-Way Discussion).\n"
            f"The Part 2 topic was: {context}\n"
            f"This is Part 3 question {question_number} of 5.\n"
            f"Previous Part 3 answers: {prev_answers[:400] or 'none yet'}\n"
            "Generate an abstract, thought-provoking discussion question related to the Part 2 topic. "
            "Ask about societal trends, comparisons, opinions, or future predictions. "
            "Avoid repeating angles already covered. Return ONLY the question text."
        )
    else:
        return jsonify({"error": f"Unknown part: {part}"}), 400

    try:
        from groq import Groq
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=250,
            temperature=0.85,
        )
        result = completion.choices[0].message.content.strip()

        if part == 2 and data.get("cue_card"):
            # Strip any accidental markdown fences
            result = result.strip("` \n")
            if result.startswith("json"):
                result = result[4:].strip()
            try:
                cue_card = json.loads(result)
            except json.JSONDecodeError:
                cue_card = {
                    "topic": "Describe a memorable experience from your life",
                    "bullets": [
                        "You should say:",
                        "what the experience was",
                        "when and where it happened",
                        "who was involved",
                        "and explain why it was memorable",
                    ],
                }
            return jsonify({"cue_card": cue_card})

        return jsonify({"question": result})

    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/generate_feedback", methods=["POST"])
def generate_feedback():
    data   = request.get_json(silent=True) or {}
    prompt = _build_prompt(data)

    def _stream():
        try:
            from groq import Groq
            client = Groq(api_key=os.getenv("GROQ_API_KEY"))

            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                stream=True,
                max_tokens=2000,
            )
            for chunk in completion:
                text = chunk.choices[0].delta.content
                if text:
                    yield f"data: {json.dumps({'text': text})}\n\n"

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as exc:
            error_payload = json.dumps({"error": str(exc)})
            yield f"data: {error_payload}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

    return Response(
        stream_with_context(_stream()),
        content_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/save_session", methods=["POST"])
def save_session():
    print("=== SAVE SESSION CALLED ===")
    data         = request.get_json(silent=True) or {}
    access_token = flask_session.get("access_token")
    user_id      = flask_session.get("user_id")

    print(f"  user_id:      {user_id!r}")
    print(f"  access_token: {'<present>' if access_token else '<MISSING>'}")
    print(f"  data keys:    {list(data.keys())}")
    print(f"  mode:         {data.get('mode')!r}")
    print(f"  transcript:   {str(data.get('transcript', ''))[:80]!r}")

    if not user_id or not access_token:
        print("  ERROR: not authenticated — aborting")
        return jsonify({"error": "Not authenticated"}), 401

    filler_words     = data.get("filler_words", [])
    emotion_timeline = data.get("emotion_timeline", [])
    overall_score    = _calc_score(
        float(data.get("confidence_avg") or 0),
        int(data.get("filler_count") or 0),
        float(data.get("duration") or 0),
    )
    row = {
        "user_id":          user_id,
        "mode":             data.get("mode"),
        "submode":          data.get("submode"),
        "topic":            data.get("topic"),
        "duration":         int(float(data.get("duration") or 0)),
        "transcript":       data.get("transcript"),
        "overall_score":    overall_score,
        "confidence_avg":   float(data.get("confidence_avg") or 0),
        "filler_count":     int(data.get("filler_count") or 0),
        "filler_words":     filler_words if isinstance(filler_words, list) else [],
        "emotion_timeline": emotion_timeline if isinstance(emotion_timeline, list) else [],
        "ai_feedback":      data.get("ai_feedback"),
        "language":         data.get("language", "english"),
    }
    print(f"  overall_score: {overall_score}")
    print(f"  inserting row with user_id={user_id!r}")
    try:
        result = _supa_exec(
            lambda tok: _supa(tok).table("sessions").insert(row).execute()
        )
        print(f"  INSERT OK — result.data: {result.data}")
        session_id = result.data[0]["id"]
        return jsonify({"ok": True, "id": session_id})
    except Exception as exc:
        print(f"  INSERT ERROR: {exc}")
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/api/sessions")
def api_sessions():
    user_id = flask_session.get("user_id")
    if not user_id:
        return jsonify([])
    try:
        result = _supa_exec(
            lambda tok: _supa(tok)
            .table("sessions")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        return jsonify(result.data)
    except Exception as exc:
        print(f"[supabase] api_sessions error: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/session/<session_id>")
def api_session(session_id: str):
    if not flask_session.get("user_id"):
        return jsonify({"error": "Not authenticated"}), 401
    try:
        result = _supa_exec(
            lambda tok: _supa(tok)
            .table("sessions")
            .select("*")
            .eq("id", session_id)
            .single()
            .execute()
        )
        return jsonify(result.data)
    except Exception as exc:
        print(f"[supabase] api_session error: {exc}")
        return jsonify({"error": "not found"}), 404


@app.route("/api/progress")
def api_progress():
    user_id = flask_session.get("user_id")
    if not user_id:
        return jsonify([])
    try:
        result = _supa_exec(
            lambda tok: _supa(tok)
            .table("sessions")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )
        return jsonify(result.data)
    except Exception as exc:
        print(f"[supabase] api_progress error: {exc}")
        return jsonify({"error": str(exc)}), 500


# ── Onboarding API ────────────────────────────────────────────────────────────

@app.route("/api/onboarding", methods=["POST"])
@require_auth
def api_onboarding():
    data    = request.get_json(silent=True) or {}
    user_id = flask_session.get("user_id")
    row = {
        "user_id":      user_id,
        "current_band": data.get("current_band"),
        "target_band":  data.get("target_band"),
        "exam_date":    data.get("exam_date") or None,
        "goal":         data.get("goal"),
    }
    try:
        _supa_exec(
            lambda tok: _supa(tok)
            .table("user_profiles")
            .upsert(row, on_conflict="user_id")
            .execute()
        )
        flask_session["onboarded"] = True
        return jsonify({"ok": True, "redirect": "/coach"})
    except Exception as exc:
        print(f"[api_onboarding] error: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/user_profile")
@require_auth
def api_user_profile():
    user_id = flask_session.get("user_id")
    try:
        result = _supa_exec(
            lambda tok: _supa(tok)
            .table("user_profiles")
            .select("*")
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return jsonify(result.data or {})
    except Exception:
        return jsonify({}), 200


# ── Progress Map API ───────────────────────────────────────────────────────────

@app.route("/api/progress_map")
@require_auth
def api_progress_map():
    from datetime import timedelta as _td
    user_id = flask_session.get("user_id")

    try:
        rows = _supa_exec(
            lambda tok: _supa(tok)
            .table("sessions")
            .select("id,created_at,mode,overall_score,confidence_avg,filler_count,duration")
            .eq("user_id", user_id)
            .order("created_at", desc=False)
            .limit(100)
            .execute()
        ).data
    except Exception as exc:
        print(f"[progress_map] error: {exc}")
        rows = []

    scores        = [r["overall_score"]  for r in rows if r.get("overall_score")  is not None]
    conf_avgs     = [r["confidence_avg"] for r in rows if r.get("confidence_avg") is not None]
    filler_counts = [r.get("filler_count") or 0 for r in rows]

    # Skill scores (0–100)
    fluency    = round(sum(conf_avgs) / len(conf_avgs)) if conf_avgs else 0
    avg_filler = sum(filler_counts) / len(filler_counts) if filler_counts else 0
    vocabulary = max(0, round(100 - min(avg_filler * 5, 60)))
    confidence = round(sum(scores) / len(scores)) if scores else 0

    # Streak for consistency
    streak_count = 0
    if rows:
        seen_days = sorted(
            {r["created_at"][:10] for r in rows if r.get("created_at")},
            reverse=True,
        )
        today = datetime.utcnow().date()
        check = today
        for day_str in seen_days:
            day = datetime.strptime(day_str, "%Y-%m-%d").date()
            if day == check:
                streak_count += 1
                check = check - _td(days=1)
            elif day < check:
                break
    consistency = min(streak_count * 10, 100)

    # Skill trends: delta between first half and second half of sessions
    def _trend(vals):
        if len(vals) < 2:
            return 0
        mid   = len(vals) // 2
        first = sum(vals[:mid]) / mid
        last  = sum(vals[mid:]) / (len(vals) - mid)
        return round(last - first, 1)

    fluency_trend    = _trend(conf_avgs)
    confidence_trend = _trend(scores)
    filler_inv       = [100 - min(f * 5, 60) for f in filler_counts]
    vocabulary_trend = _trend(filler_inv)

    # Improvement: first 3 vs last 3 overall scores
    improvement = None
    if len(scores) >= 2:
        n     = min(3, len(scores) // 2)
        first = sum(scores[:n]) / n
        last  = sum(scores[-n:]) / n
        improvement = round(last - first, 1)

    # Weekly activity (last 7 days)
    today = datetime.utcnow().date()
    weekly_activity = []
    for i in range(6, -1, -1):
        day     = today - _td(days=i)
        day_str = day.isoformat()
        count   = sum(1 for r in rows if r.get("created_at", "").startswith(day_str))
        weekly_activity.append({"date": day_str, "count": count})

    # Sessions per mode
    mode_counts = {}
    mode_scores: dict[str, list] = {}
    for r in rows:
        m = r.get("mode") or "free"
        mode_counts[m] = mode_counts.get(m, 0) + 1
        if r.get("overall_score") is not None:
            mode_scores.setdefault(m, []).append(r["overall_score"])
    mode_breakdown = [
        {
            "mode":       m,
            "sessions":   mode_counts[m],
            "avg_score":  round(sum(mode_scores.get(m, [0])) / max(len(mode_scores.get(m, [1])), 1)),
        }
        for m in mode_counts
    ]

    # Score trend (last 10 sessions, oldest first)
    score_trend = [r["overall_score"] for r in rows if r.get("overall_score") is not None][-10:]

    # User profile: target band / exam date
    target_band = exam_date_str = goal = None
    try:
        prof = _supa_exec(
            lambda tok: _supa(tok)
            .table("user_profiles")
            .select("target_band,exam_date,goal,current_band")
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if prof.data:
            target_band   = prof.data.get("target_band")
            exam_date_str = prof.data.get("exam_date")
            goal          = prof.data.get("goal")
    except Exception:
        pass

    return jsonify({
        "skills": {
            "fluency":     fluency,
            "vocabulary":  vocabulary,
            "confidence":  confidence,
            "consistency": consistency,
        },
        "skill_trends": {
            "fluency":    fluency_trend,
            "vocabulary": vocabulary_trend,
            "confidence": confidence_trend,
            "consistency": 0,
        },
        "improvement":       improvement,
        "weekly_activity":   weekly_activity,
        "mode_breakdown":    mode_breakdown,
        "score_trend":       score_trend,
        "total_sessions":    len(rows),
        "target_band":       target_band,
        "exam_date":         exam_date_str,
        "goal":              goal,
        "streak":            streak_count,
    })


# ── Daily challenge ────────────────────────────────────────────────────────────

_CHALLENGE_TOPICS = [
    ("Your hometown", "part1"), ("Your home", "part1"), ("Work or studies", "part1"),
    ("Family life", "part1"),   ("Friends", "part1"),   ("Hobbies & free time", "part1"),
    ("Sports & exercise", "part1"), ("Music", "part1"), ("Food & cooking", "part1"),
    ("Weather", "part1"),       ("Shopping", "part1"),  ("Technology", "part1"),
    ("Books & reading", "part1"), ("Travel", "part1"),  ("Health & fitness", "part1"),
    ("A person who influenced you", "part2"), ("A memorable trip", "part2"),
    ("A skill you want to learn", "part2"),   ("A difficult decision", "part2"),
    ("A time you helped someone", "part2"),   ("A book that affected you", "part2"),
    ("A place you want to visit", "part2"),   ("A piece of technology", "part2"),
    ("Education systems globally", "part3"),  ("Impact of social media", "part3"),
    ("Environmental challenges", "part3"),    ("Economic inequality", "part3"),
    ("Future of healthcare", "part3"),        ("Work-life balance", "part3"),
]


@app.route("/api/daily_challenge")
@require_auth
def api_daily_challenge():
    from datetime import date as _date
    today = _date.today()
    idx   = hash(str(today)) % len(_CHALLENGE_TOPICS)
    topic, part = _CHALLENGE_TOPICS[abs(idx)]

    completed  = False
    user_id    = flask_session.get("user_id")
    today_str  = today.isoformat()
    if user_id:
        try:
            result = _supa_exec(
                lambda tok: _supa(tok)
                .table("sessions")
                .select("id")
                .eq("user_id", user_id)
                .gte("created_at", today_str + "T00:00:00")
                .lte("created_at", today_str + "T23:59:59")
                .limit(1)
                .execute()
            )
            completed = len(result.data) > 0
        except Exception:
            pass

    return jsonify({"topic": topic, "part": part, "date": today_str, "completed": completed})


# ── Vocabulary analysis ────────────────────────────────────────────────────────

@app.route("/vocabulary_analysis", methods=["POST"])
@require_auth
def vocabulary_analysis():
    data       = request.get_json(silent=True) or {}
    transcript = (data.get("transcript") or "").strip()
    topic      = data.get("topic") or "general"

    if not transcript:
        return Response(
            f"data: {json.dumps({'done': True})}\n\n",
            content_type="text/event-stream",
        )

    prompt = (
        "Analyze this speaking response and provide:\n"
        "1. List of 5 basic/weak words used that could be replaced with more sophisticated vocabulary "
        "(format each as: **basic** → **better** — example usage in parentheses)\n"
        "2. List of 3 topic-specific vocabulary words the speaker should have used\n"
        "Be concise. No long introductions.\n\n"
        f"Topic: {topic}\n"
        f"Transcript: {transcript[:1200]}"
    )

    def _stream():
        try:
            from groq import Groq
            client = Groq(api_key=os.getenv("GROQ_API_KEY"))
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                stream=True,
                max_tokens=500,
            )
            for chunk in completion:
                text = chunk.choices[0].delta.content
                if text:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc), 'done': True})}\n\n"

    return Response(
        stream_with_context(_stream()),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    def _open_browser():
        import time
        time.sleep(1.2)
        webbrowser.open("http://localhost:8080")

    threading.Thread(target=_open_browser, daemon=True).start()
    print("Affecta starting → http://localhost:8080")
    app.run(host="0.0.0.0", port=8080, debug=False, threaded=True)
