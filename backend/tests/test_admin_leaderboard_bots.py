"""Backend tests for the admin `/admin/leaderboard_bots` endpoint —
lists the seeded leaderboard filler bots with RP-desc ordering,
optional substring search, and a limit cap.

Rename mutations reuse the existing `/admin/users/{u}/rename` endpoint
so we cover them via a quick end-to-end rename → revert flow.
"""
import uuid
import requests

LOCAL = "http://localhost:8001"


def _admin_token() -> str:
    r = requests.post(
        f"{LOCAL}/api/auth/login",
        json={"email": "admin@shooter.com", "password": "admin123"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def test_list_leaderboard_bots_requires_admin():
    """Non-admin (or missing) token returns 401/403."""
    r = requests.get(f"{LOCAL}/api/admin/leaderboard_bots")
    assert r.status_code in (401, 403)


def test_list_leaderboard_bots_returns_seeded_users_desc_by_rp():
    """Happy path: admin lists top-N seeded bots ordered by RP desc."""
    tok = _admin_token()
    r = requests.get(f"{LOCAL}/api/admin/leaderboard_bots?limit=10",
                     headers=_hdr(tok))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) > 0, "no seeded bots — did the seed job run?"
    # RP desc check.
    prev = 10**9
    for row in rows:
        assert "username" in row and "rank_points" in row
        assert row["rank_points"] <= prev, "not sorted RP-desc"
        prev = row["rank_points"]


def test_list_leaderboard_bots_limit_cap():
    """`limit` param is honored + clamped to 200."""
    tok = _admin_token()
    r5 = requests.get(f"{LOCAL}/api/admin/leaderboard_bots?limit=5",
                      headers=_hdr(tok))
    assert r5.status_code == 200
    assert len(r5.json()) <= 5

    # Absurd limit clamps to 200.
    rBig = requests.get(f"{LOCAL}/api/admin/leaderboard_bots?limit=9999",
                        headers=_hdr(tok))
    assert rBig.status_code == 200
    assert len(rBig.json()) <= 200


def test_list_leaderboard_bots_search_filter():
    """Substring `q` filters results (case-insensitive)."""
    tok = _admin_token()
    # Grab a sample bot's name to search for a fragment.
    seed = requests.get(f"{LOCAL}/api/admin/leaderboard_bots?limit=1",
                        headers=_hdr(tok)).json()
    assert seed, "no seeded bots"
    sample_name = seed[0]["username"]
    # Use the first 3 chars as a substring — will match many bots.
    frag = sample_name[:3]
    r = requests.get(f"{LOCAL}/api/admin/leaderboard_bots",
                     params={"q": frag, "limit": 50},
                     headers=_hdr(tok))
    assert r.status_code == 200
    for row in r.json():
        assert frag.lower() in row["username"].lower(), row


def test_rename_leaderboard_bot_end_to_end():
    """Rename an existing leaderboard bot via the shared admin rename
    endpoint, confirm the new name appears in the listing, then
    revert. Proves the admin can edit bot names from the moderation
    dashboard."""
    tok = _admin_token()
    # Pick a bot.
    seed = requests.get(f"{LOCAL}/api/admin/leaderboard_bots?limit=1",
                        headers=_hdr(tok)).json()
    assert seed, "no seeded bots"
    original = seed[0]["username"]
    new_name = f"AdmTest{uuid.uuid4().hex[:6]}"

    # Rename.
    r = requests.post(
        f"{LOCAL}/api/admin/users/{original}/rename",
        headers=_hdr(tok),
        json={"new_username": new_name},
    )
    assert r.status_code == 200, r.text
    assert r.json()["new_username"] == new_name

    # Verify visible in leaderboard bots listing.
    try:
        found = requests.get(
            f"{LOCAL}/api/admin/leaderboard_bots",
            params={"q": new_name, "limit": 5},
            headers=_hdr(tok),
        ).json()
        assert any(row["username"] == new_name for row in found), found
    finally:
        # Revert so the seed remains stable for future test runs.
        requests.post(
            f"{LOCAL}/api/admin/users/{new_name}/rename",
            headers=_hdr(tok),
            json={"new_username": original},
        )
