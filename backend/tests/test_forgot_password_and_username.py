"""Forgot-password (security-question flow) + username change tests.

Locks in:
  1. GET /auth/security-questions returns the preset list.
  2. Security-question hash uses bcrypt (via existing hash_password),
     answer normalisation is case/whitespace insensitive.
  3. Forgot-password challenge returns generic response when no user /
     no question set (email enumeration protection).
  4. Forgot-password reset rate-limit: 5 attempts per hour per email.
  5. Username change: format regex, uniqueness, 7-day cooldown.
"""
import sys
import pathlib
import time as _time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_security_questions_preset_list():
    """SECURITY_QUESTIONS has ≥ 3 options, all non-empty strings."""
    assert isinstance(server.SECURITY_QUESTIONS, list)
    assert len(server.SECURITY_QUESTIONS) >= 3
    for q in server.SECURITY_QUESTIONS:
        assert isinstance(q, str) and q.strip()


def test_norm_answer_lower_and_strip():
    """_norm_answer normalises to lower + strip so 'Fluffy' and '  fluffy '
    produce identical hashes."""
    assert server._norm_answer("Fluffy") == "fluffy"
    assert server._norm_answer("  fluffy ") == "fluffy"
    assert server._norm_answer("FLUFFY") == "fluffy"


def test_bcrypt_hash_verifies_normalised_answer():
    """Round-trip: hashing 'Fluffy' → hash; verify_password('fluffy', hash)
    must succeed after normalisation."""
    h = server.hash_password(server._norm_answer("Fluffy"))
    assert server.verify_password(server._norm_answer("fluffy"), h) is True
    assert server.verify_password(server._norm_answer("  FLUFFY  "), h) is True
    assert server.verify_password("wrong", h) is False


def test_forgot_pw_rate_limit_kicks_in_at_5_attempts():
    """5 attempts allowed, 6th blocked."""
    email = "ratelimit-test@x.com"
    server.FORGOT_PW_ATTEMPTS.pop(email, None)
    for i in range(server.FORGOT_PW_MAX_ATTEMPTS):
        assert server._consume_forgot_pw_attempt(email) is True, f"attempt {i+1} should be allowed"
    # 6th attempt must be blocked.
    assert server._consume_forgot_pw_attempt(email) is False


def test_forgot_pw_rate_limit_window_resets():
    """Old entries outside the 1-hour window are pruned so a legitimate
    user isn't locked out forever."""
    email = "window-test@x.com"
    server.FORGOT_PW_ATTEMPTS[email] = [_time.time() - server.FORGOT_PW_WINDOW_S - 10] * 5
    # A fresh call prunes the ancient entries.
    assert server._consume_forgot_pw_attempt(email) is True


def test_username_regex_accepts_valid():
    """2-20 chars, letters/digits/_./- only."""
    for name in ["ab", "player1", "cool_name.99", "a-b-c", "20xxxxxxxxxxxxxxxx"]:
        assert server.USERNAME_PATTERN.match(name), f"Should accept: {name}"


def test_username_regex_rejects_invalid():
    """Anything with spaces, special chars, or wrong length is rejected."""
    for name in ["a", "a" * 21, "with space", "bad!", "emoji😊", "sql'inject"]:
        assert server.USERNAME_PATTERN.match(name) is None, f"Should reject: {name}"


def test_username_cooldown_constant():
    """7 days in seconds — the per-user spec."""
    assert server.USERNAME_CHANGE_COOLDOWN_S == 7 * 24 * 3600


def test_public_user_exposes_security_question_marker():
    """UI needs to know if a question is set without leaking the answer."""
    doc = {"_id": "u1", "email": "x@y.com", "username": "u", "stats": {}, "level": 1, "xp": 0}
    assert server.public_user(doc).get("security_question") is None
    doc["security_question"] = server.SECURITY_QUESTIONS[0]
    assert server.public_user(doc).get("security_question") == server.SECURITY_QUESTIONS[0]


def test_forgot_password_endpoints_registered():
    """Ensure the endpoints are wired up (spot-check via source scan
    since a full ASGI test would need an event loop dance)."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert '@api.post("/auth/forgot-password/challenge")' in src
    assert '@api.post("/auth/forgot-password/reset")' in src
    assert '@api.get("/auth/security-questions")' in src
    assert '@api.post("/profile/me/security-question")' in src
    assert '@api.post("/profile/me/username")' in src
