"""Backend tests for the Feb-2026 leaderboard upgrades:
- GET /api/leaderboard/friends — friends-only board, includes caller
- GET /api/leaderboard/weapons  — per-weapon top kills, keyed by weapon slug
"""
import os
import uuid
import requests
import pytest

LOCAL = "http://localhost:8001"


def _register(suffix: str):
    """Register or login a throwaway account and return (token, user, uname)."""
    uname = f"TESTlb{suffix}"[:20]
    body = {
        "email": f"TEST_lb_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": uname,
    }
    r = requests.post(f"{LOCAL}/api/auth/register", json=body)
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": body["email"], "password": body["password"]})
    assert r.status_code == 200, f"auth failed: {r.status_code} {r.text}"
    j = r.json()
    return j["access_token"], j["user"], uname


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# --- /leaderboard/friends -------------------------------------------

def test_friends_leaderboard_requires_auth():
    """Anonymous calls to /leaderboard/friends must be rejected."""
    r = requests.get(f"{LOCAL}/api/leaderboard/friends")
    assert r.status_code in (401, 403), f"got {r.status_code} {r.text}"


def test_friends_leaderboard_includes_self():
    """A brand-new user with zero friends still sees themselves listed
    on the friends leaderboard (as the "is_me" row)."""
    suffix = uuid.uuid4().hex[:6]
    tok, u, uname = _register(suffix)
    r = requests.get(f"{LOCAL}/api/leaderboard/friends", headers=_auth(tok))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) >= 1
    me = next((row for row in rows if row.get("is_me")), None)
    assert me is not None, "self row missing from friends leaderboard"
    assert me["username"].lower() == uname.lower()
    # Row shape sanity — mirrors /leaderboard fields the UI reads.
    for field in ("id", "username", "rank_points", "rank_tier",
                  "rank_name", "rank_division", "online", "in_match"):
        assert field in me, f"missing field {field} in friends row"


def test_friends_leaderboard_reflects_added_friend():
    """After A friends B (auto-accept via reverse pending), both accounts
    appear on each other's /leaderboard/friends board."""
    sa, sb = uuid.uuid4().hex[:6], uuid.uuid4().hex[:6]
    tok_a, ua, uname_a = _register(sa)
    tok_b, ub, uname_b = _register(sb)

    # A sends friend request to B
    r = requests.post(f"{LOCAL}/api/friends/request",
                      json={"username": uname_b}, headers=_auth(tok_a))
    assert r.status_code == 200, r.text
    # B sends back — auto-accepts
    r = requests.post(f"{LOCAL}/api/friends/request",
                      json={"username": uname_a}, headers=_auth(tok_b))
    assert r.status_code == 200, r.text

    # Both boards should now include both users.
    for tok, expected in [(tok_a, {uname_a.lower(), uname_b.lower()}),
                          (tok_b, {uname_a.lower(), uname_b.lower()})]:
        r = requests.get(f"{LOCAL}/api/leaderboard/friends", headers=_auth(tok))
        assert r.status_code == 200
        names = {row["username"].lower() for row in r.json()}
        assert expected.issubset(names), f"expected {expected} ⊆ {names}"
