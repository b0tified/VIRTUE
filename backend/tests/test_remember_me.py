"""Remember Me cookie persistence tests.

When `remember=True` (or unspecified): both access + refresh cookies
must carry an explicit `max_age` so they survive browser restarts.
When `remember=False`: BOTH cookies must be session cookies (no
`max_age`/`Max-Age`) so the next browser launch starts signed out.

A previous regression set only the refresh cookie as session-only;
the access cookie still lived for 24h, which kept the user signed in
across restarts. This test guards against that recurrence.
"""
import sys
import pathlib

from starlette.responses import Response

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _cookies_for(remember: bool):
    """Run `set_auth_cookies(remember=...)` and return the parsed
    Set-Cookie headers as a dict[name -> raw header string]."""
    r = Response()
    server.set_auth_cookies(r, access="ACC", refresh="REF", remember=remember)
    out = {}
    for raw in r.raw_headers:
        # raw is (b'set-cookie', b'<value>')
        if raw[0].lower() == b"set-cookie":
            val = raw[1].decode()
            name = val.split("=", 1)[0]
            out[name] = val
    return out


def test_remember_true_persists_both_cookies():
    cookies = _cookies_for(remember=True)
    assert "access_token" in cookies and "refresh_token" in cookies
    # Both cookies must carry Max-Age (= persistent across restarts).
    assert "Max-Age" in cookies["access_token"]
    assert "Max-Age" in cookies["refresh_token"]


def test_remember_false_makes_both_session_cookies():
    """The crux of the bug: with remember=False, NEITHER cookie may
    carry Max-Age — otherwise the access cookie alone keeps the user
    signed in for ACCESS_TTL_MIN (24h) across browser restarts."""
    cookies = _cookies_for(remember=False)
    assert "access_token" in cookies and "refresh_token" in cookies
    assert "Max-Age" not in cookies["access_token"], cookies["access_token"]
    assert "Max-Age" not in cookies["refresh_token"], cookies["refresh_token"]


def test_remember_true_max_ages_match_constants():
    cookies = _cookies_for(remember=True)
    # Access cookie ≈ ACCESS_TTL_MIN minutes.
    expected_access = server.ACCESS_TTL_MIN * 60
    assert f"Max-Age={expected_access}" in cookies["access_token"]
    # Refresh cookie ≈ REFRESH_TTL_DAYS days.
    expected_refresh = server.REFRESH_TTL_DAYS * 86400
    assert f"Max-Age={expected_refresh}" in cookies["refresh_token"]
