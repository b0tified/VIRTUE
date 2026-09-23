"""Backend tests for the Feb-2026 news thumbs-up feature.

Contract:
  - POST /api/news/{post_id}/like — toggles the caller's like; unique
    (user, post) pair enforced by the compound index on news_post_likes.
  - PATCH /api/admin/news/{post_id} — admin-only partial update; the
    `likes` field powers the "edit like number" control.
  - GET /api/news returns `likes` + `liked_by_me` on every row.
"""
import os
import uuid
import requests
import pytest

LOCAL = "http://localhost:8001"


def _register(suffix: str, *, admin: bool = False) -> tuple[str, str]:
    """Register/login a throwaway user; returns (access_token, user_id).

    Admin flag only affects the seeded admin — regular test users
    authenticate against a fresh account so nothing pollutes the shared
    admin state."""
    if admin:
        r = requests.post(
            f"{LOCAL}/api/auth/login",
            json={"email": "admin@shooter.com", "password": "admin123"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        return j["access_token"], j["user"]["id"]
    body = {
        "email": f"TEST_news_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": f"TESTnw{suffix}"[:20],
    }
    r = requests.post(f"{LOCAL}/api/auth/register", json=body)
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": body["email"], "password": body["password"]})
    assert r.status_code == 200, f"auth failed: {r.status_code} {r.text}"
    j = r.json()
    return j["access_token"], j["user"]["id"]


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def _create_post(admin_tok: str) -> str:
    """Publish a throwaway news post via the admin endpoint; return its id."""
    body = {"title": f"Likes test {uuid.uuid4().hex[:6]}",
            "body": "Coverage post."}
    r = requests.post(f"{LOCAL}/api/admin/news", json=body, headers=_auth(admin_tok))
    assert r.status_code == 200, r.text
    j = r.json()
    # Freshly-published posts should default to zero likes / not-liked-by-author.
    assert int(j.get("likes", -1)) == 0
    assert bool(j.get("liked_by_me")) is False
    return j["id"]


# --- List endpoint contract ---------------------------------------

def test_news_list_includes_likes_and_liked_flag():
    """GET /api/news exposes `likes` and `liked_by_me` on every row.
    `liked_by_me` is per-caller — the batch-fetch inside `list_news`
    can't leak another user's likes."""
    admin_tok, _ = _register("skip", admin=True)
    pid = _create_post(admin_tok)
    try:
        tok, _ = _register(uuid.uuid4().hex[:6])
        r = requests.get(f"{LOCAL}/api/news", headers=_auth(tok))
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        target = next((p for p in rows if p["id"] == pid), None)
        assert target is not None
        assert "likes" in target and int(target["likes"]) == 0
        assert "liked_by_me" in target and target["liked_by_me"] is False
    finally:
        requests.delete(f"{LOCAL}/api/admin/news/{pid}", headers=_auth(admin_tok))


# --- Toggle behaviour ---------------------------------------------

def test_like_toggle_flips_count_and_flag():
    """POST /api/news/{id}/like flips between like/unlike per call.
    The response's `likes` count matches the aggregate on the doc."""
    admin_tok, _ = _register("skip", admin=True)
    pid = _create_post(admin_tok)
    try:
        tok, _ = _register(uuid.uuid4().hex[:6])
        r = requests.post(f"{LOCAL}/api/news/{pid}/like", headers=_auth(tok))
        assert r.status_code == 200
        j = r.json()
        assert j == {"likes": 1, "liked_by_me": True}
        # Idempotency: a second click removes the like.
        r = requests.post(f"{LOCAL}/api/news/{pid}/like", headers=_auth(tok))
        j = r.json()
        assert j == {"likes": 0, "liked_by_me": False}
        # And a third re-adds it.
        r = requests.post(f"{LOCAL}/api/news/{pid}/like", headers=_auth(tok))
        j = r.json()
        assert j == {"likes": 1, "liked_by_me": True}
    finally:
        requests.delete(f"{LOCAL}/api/admin/news/{pid}", headers=_auth(admin_tok))


def test_like_two_users_sum_correctly():
    """Two separate users each like the same post → aggregate = 2. Each
    user still sees only their own `liked_by_me`."""
    admin_tok, _ = _register("skip", admin=True)
    pid = _create_post(admin_tok)
    try:
        tok_a, _ = _register(uuid.uuid4().hex[:6])
        tok_b, _ = _register(uuid.uuid4().hex[:6])
        ra = requests.post(f"{LOCAL}/api/news/{pid}/like", headers=_auth(tok_a)).json()
        rb = requests.post(f"{LOCAL}/api/news/{pid}/like", headers=_auth(tok_b)).json()
        assert ra["likes"] == 1
        assert rb["likes"] == 2
        # Cross-check via list — B liked, A also liked.
        for tok in (tok_a, tok_b):
            rows = requests.get(f"{LOCAL}/api/news", headers=_auth(tok)).json()
            row = next(p for p in rows if p["id"] == pid)
            assert row["likes"] == 2
            assert row["liked_by_me"] is True
    finally:
        requests.delete(f"{LOCAL}/api/admin/news/{pid}", headers=_auth(admin_tok))


def test_like_requires_auth():
    """Anonymous like calls must be rejected."""
    admin_tok, _ = _register("skip", admin=True)
    pid = _create_post(admin_tok)
    try:
        r = requests.post(f"{LOCAL}/api/news/{pid}/like")
        assert r.status_code in (401, 403)
    finally:
        requests.delete(f"{LOCAL}/api/admin/news/{pid}", headers=_auth(admin_tok))


# --- Admin PATCH override -----------------------------------------

def test_admin_can_edit_like_count():
    """PATCH /admin/news/{id} with `likes` overrides the aggregate.
    Non-admin callers get 403."""
    admin_tok, _ = _register("skip", admin=True)
    pid = _create_post(admin_tok)
    try:
        # Admin sets likes = 999
        r = requests.patch(f"{LOCAL}/api/admin/news/{pid}",
                           json={"likes": 999}, headers=_auth(admin_tok))
        assert r.status_code == 200, r.text
        # Verify via list
        rows = requests.get(f"{LOCAL}/api/news", headers=_auth(admin_tok)).json()
        row = next(p for p in rows if p["id"] == pid)
        assert int(row["likes"]) == 999
        # Non-admin PATCH must 403
        tok, _ = _register(uuid.uuid4().hex[:6])
        r = requests.patch(f"{LOCAL}/api/admin/news/{pid}",
                           json={"likes": 5}, headers=_auth(tok))
        assert r.status_code == 403
    finally:
        requests.delete(f"{LOCAL}/api/admin/news/{pid}", headers=_auth(admin_tok))


def test_admin_patch_rejects_empty_body():
    """PATCH with no updatable fields → 400 (guards against accidental
    no-op calls)."""
    admin_tok, _ = _register("skip", admin=True)
    pid = _create_post(admin_tok)
    try:
        r = requests.patch(f"{LOCAL}/api/admin/news/{pid}", json={},
                           headers=_auth(admin_tok))
        assert r.status_code == 400
    finally:
        requests.delete(f"{LOCAL}/api/admin/news/{pid}", headers=_auth(admin_tok))
