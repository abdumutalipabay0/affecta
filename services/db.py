"""
Supabase client and database helpers.

All routes import from here instead of defining their own clients.
"""

import os

from flask import session as flask_session
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
