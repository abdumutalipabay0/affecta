"""
Session API routes — Blueprint: sessions

/save_session           POST    persist a completed session to Supabase
/api/sessions           GET     paginated session list (last 20)
/api/session/<id>       GET     single session detail
/api/session/<id>       DELETE  delete a session
/api/progress           GET     last 5 sessions (legacy endpoint)
"""

import traceback

from flask import Blueprint, jsonify, request, session as flask_session

from services.db import _calc_score, _supa, _supa_exec

sessions_bp = Blueprint("sessions", __name__)


@sessions_bp.route("/save_session", methods=["POST"])
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
    print(f"  words count:  {len(data.get('words', []))}")

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
    words = data.get("words", [])
    row = {
        "user_id":          user_id,
        "mode":             data.get("mode"),
        "submode":          data.get("submode"),
        "topic":            data.get("topic"),
        "duration":         int(float(data.get("duration") or 0)),
        "transcript":       data.get("transcript"),
        "words":            words if isinstance(words, list) else [],
        "overall_score":    overall_score,
        "confidence_avg":   float(data.get("confidence_avg") or 0),
        "filler_count":     int(data.get("filler_count") or 0),
        "filler_words":     filler_words if isinstance(filler_words, list) else [],
        "emotion_timeline": emotion_timeline if isinstance(emotion_timeline, list) else [],
        "ai_feedback":      data.get("ai_feedback"),
        "language":         data.get("language", "english"),
    }
    print(f"  overall_score: {overall_score}")
    print(f"  words:         {len(words)} word timestamps")
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


@sessions_bp.route("/api/sessions")
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


@sessions_bp.route("/api/session/<session_id>", methods=["GET", "DELETE"])
def api_session(session_id: str):
    if not flask_session.get("user_id"):
        return jsonify({"error": "Not authenticated"}), 401

    if request.method == "DELETE":
        try:
            _supa_exec(
                lambda tok: _supa(tok)
                .table("sessions")
                .delete()
                .eq("id", session_id)
                .execute()
            )
            return jsonify({"ok": True})
        except Exception as exc:
            print(f"[supabase] delete session error: {exc}")
            return jsonify({"error": str(exc)}), 500

    try:
        result = _supa_exec(
            lambda tok: _supa(tok)
            .table("sessions")
            .select("*")
            .eq("id", session_id)
            .single()
            .execute()
        )
        row = result.data or {}
        # Normalise JSONB array fields — older rows may have null instead of []
        for field in ("words", "emotion_timeline", "filler_words"):
            if not isinstance(row.get(field), list):
                if row.get(field) is not None:
                    print(f"[api_session] WARNING: {field} is not a list for session {session_id} — coercing to []")
                row[field] = []
        return jsonify(row)
    except Exception as exc:
        print(f"[supabase] api_session error: {exc}")
        return jsonify({"error": "not found"}), 404


@sessions_bp.route("/api/progress")
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
