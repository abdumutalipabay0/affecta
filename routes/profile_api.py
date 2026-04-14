"""
Profile & progress API routes — Blueprint: profile_api

/api/onboarding     POST  save onboarding data
/api/user_profile   GET   retrieve user profile
/api/progress_map   GET   skill scores, trends, weekly activity, mode breakdown
/api/daily_challenge GET  today's challenge topic (deterministic)
"""

from datetime import date as _date, datetime, timedelta as _td

from flask import Blueprint, jsonify, request, session as flask_session

from services.auth_helpers import require_auth
from services.db import _supa, _supa_exec

profile_api_bp = Blueprint("profile_api", __name__)

# Deterministic daily challenge topics (topic, IELTS part)
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


@profile_api_bp.route("/api/onboarding", methods=["POST"])
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


@profile_api_bp.route("/api/user_profile")
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


@profile_api_bp.route("/api/progress_map")
@require_auth
def api_progress_map():
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
            "mode":      m,
            "sessions":  mode_counts[m],
            "avg_score": round(sum(mode_scores.get(m, [0])) / max(len(mode_scores.get(m, [1])), 1)),
        }
        for m in mode_counts
    ]

    # Score trend (last 10 sessions, oldest first)
    score_trend = [r["overall_score"] for r in rows if r.get("overall_score") is not None][-10:]

    # User profile: target band / exam date / goal
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
            "fluency":     fluency_trend,
            "vocabulary":  vocabulary_trend,
            "confidence":  confidence_trend,
            "consistency": 0,
        },
        "improvement":     improvement,
        "weekly_activity": weekly_activity,
        "mode_breakdown":  mode_breakdown,
        "score_trend":     score_trend,
        "total_sessions":  len(rows),
        "target_band":     target_band,
        "exam_date":       exam_date_str,
        "goal":            goal,
        "streak":          streak_count,
    })


@profile_api_bp.route("/api/daily_challenge")
@require_auth
def api_daily_challenge():
    today     = _date.today()
    idx       = hash(str(today)) % len(_CHALLENGE_TOPICS)
    topic, part = _CHALLENGE_TOPICS[abs(idx)]

    completed = False
    user_id   = flask_session.get("user_id")
    today_str = today.isoformat()
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
