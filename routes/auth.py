"""
Auth routes — Blueprint: auth

/auth           GET   login/register page
/auth/callback  GET   Supabase PKCE callback page
/auth/session   POST  store tokens from OAuth callback
/auth/google    GET   initiate Google OAuth
/auth/exchange  POST  exchange PKCE code for session
/auth/login     POST  email/password sign-in
/auth/signup    POST  email/password sign-up
/auth/logout    POST  clear session
/auth/forgot    POST  send password-reset email
"""

from flask import (Blueprint, jsonify, redirect, render_template,
                   request, session as flask_session, url_for)

from services.db import supabase

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/auth")
def auth_page():
    if flask_session.get("user_id"):
        return redirect(url_for("pages.coach"))
    error = request.args.get("error", "")
    return render_template("auth.html", error=error)


@auth_bp.route("/auth/callback")
def auth_callback():
    return render_template("auth_callback.html")


@auth_bp.route("/auth/session", methods=["POST"])
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


@auth_bp.route("/auth/google")
def auth_google():
    result = supabase.auth.sign_in_with_oauth({
        "provider": "google",
        "options":  {"redirect_to": "http://localhost:8080/auth/callback"},
    })
    return redirect(result.url)


@auth_bp.route("/auth/exchange", methods=["POST"])
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


@auth_bp.route("/auth/login", methods=["POST"])
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


@auth_bp.route("/auth/signup", methods=["POST"])
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


@auth_bp.route("/auth/logout", methods=["POST"])
def auth_logout():
    if flask_session.get("access_token"):
        try:
            supabase.auth.sign_out()
        except Exception:
            pass
    flask_session.clear()
    return jsonify({"ok": True, "redirect": "/auth"})


@auth_bp.route("/auth/forgot", methods=["POST"])
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
