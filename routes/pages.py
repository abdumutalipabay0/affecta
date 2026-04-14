"""
Page-rendering routes — Blueprint: pages

/               GET  landing → redirect to /coach or /auth
/onboarding     GET  onboarding wizard
/coach          GET  main practice page
/feedback       GET  post-session feedback
/history        GET  session history list
/profile        GET  user profile & stats
/progress       GET  progress map
/status         GET  health check
/api/profile/stats  GET  streak + aggregate stats (JSON)
"""

from datetime import datetime, timedelta as _td

from flask import (Blueprint, jsonify, redirect, render_template,
                   session as flask_session, url_for)

from services.auth_helpers import require_auth, require_profile
from services.db import _supa, _supa_exec

pages_bp = Blueprint("pages", __name__)


@pages_bp.route("/")
def index():
    return render_template("landing.html")


@pages_bp.route("/onboarding")
@require_auth
def onboarding():
    """Onboarding wizard — shown on first login before any protected page."""
    if flask_session.get("onboarded"):
        return redirect(url_for("pages.coach"))
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
            return redirect(url_for("pages.coach"))
    except Exception:
        pass
    from datetime import date as _date
    return render_template("onboarding.html", today=_date.today().isoformat())


@pages_bp.route("/coach")
@require_auth
@require_profile
def coach():
    return render_template("coach.html")


@pages_bp.route("/feedback")
@require_auth
@require_profile
def feedback():
    return render_template("feedback.html")


@pages_bp.route("/history")
@require_auth
@require_profile
def history():
    return render_template("history.html")


@pages_bp.route("/profile")
@require_auth
@require_profile
def profile():
    return render_template("profile.html")


@pages_bp.route("/progress")
@require_auth
@require_profile
def progress():
    return render_template("progress.html")


@pages_bp.route("/status")
def status():
    return jsonify({"ready": True})


@pages_bp.route("/api/profile/stats")
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
    streak_count      = 0
    longest_streak    = 0
    last_session_date = None
    streak_at_risk    = True

    if rows:
        seen_days = sorted(
            {r["created_at"][:10] for r in rows if r.get("created_at")},
            reverse=True,
        )
        today = datetime.utcnow().date()
        last_session_date = seen_days[0] if seen_days else None
        streak_at_risk = today.isoformat() not in seen_days

        # Current streak — count from today backwards
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

    # Score trend — last 10 sessions (oldest first for chart)
    trend_rows  = [r for r in rows if r.get("overall_score") is not None][:10]
    score_trend = [r["overall_score"] for r in reversed(trend_rows)]

    # Recent sessions — last 5
    recent_sessions = rows[:5]

    # Member since — oldest session date
    all_dates    = [r["created_at"] for r in rows if r.get("created_at")]
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
