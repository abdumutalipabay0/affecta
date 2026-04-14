"""
Auth decorators shared by all route blueprints.

Decorator order (outer → inner):
    @require_auth
    @require_profile
"""

from functools import wraps

from flask import redirect, session as flask_session, url_for

from services.db import _supa, _supa_exec


def require_auth(f):
    """Redirect to /auth if the user is not logged in."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not flask_session.get("user_id"):
            return redirect(url_for("auth.auth_page"))
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
                    return redirect(url_for("pages.onboarding"))
            except Exception as exc:
                print(f"[require_profile] check failed (fail open): {exc}")
                flask_session["onboarded"] = True  # fail open — don't block on table missing
        return f(*args, **kwargs)
    return decorated
