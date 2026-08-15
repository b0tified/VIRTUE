"""Crypto + auth helpers — pure functions with no DB access.

Extracted from `server.py` during the 2026-02-24 refactor. Re-exported
from server.py so callers (`srv.hash_password`, `srv.create_access_token`,
etc.) don't need to change.

Anything that touches Mongo (`get_current_user`, `_user_from_token`)
STAYS in server.py because it depends on the module-level `db` client.
"""
import os
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from fastapi import Response

JWT_ALGORITHM = "HS256"
ACCESS_TTL_MIN = 60 * 24        # 24 hours
REFRESH_TTL_DAYS = 7


def hash_password(password: str) -> str:
    """bcrypt hash — 12 rounds via `gensalt()` default."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time bcrypt compare. Swallows bad-hash exceptions so a
    corrupted stored hash surfaces as "wrong password" rather than a
    500."""
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def get_jwt_secret() -> str:
    """Fetch JWT secret at call time (not module-load time) so a test
    that sets `os.environ['JWT_SECRET']` before importing still works."""
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MIN),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TTL_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str, remember: bool = True):
    """Attach access + refresh cookies to `response`.

    When `remember=False`, BOTH cookies are session-scoped (no
    max_age) so closing the browser signs the user out. Without this,
    the 24-hour access cookie would keep them signed in across
    restarts regardless of the "Remember me" toggle.
    """
    if remember:
        response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax",
                            max_age=ACCESS_TTL_MIN * 60, path="/")
        response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax",
                            max_age=REFRESH_TTL_DAYS * 86400, path="/")
    else:
        response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax",
                            path="/")
        response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax",
                            path="/")
