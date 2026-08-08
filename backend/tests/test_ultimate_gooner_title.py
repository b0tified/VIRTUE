"""Ultimate Gooner banner-title tests.

Covers the new `POST /profile/me/title` behaviour where a top-50
GOONMASTER player can equip the special ULTIMATE GOONER title
(`ultimate=True`). The endpoint gates equipping on the live
`TOP50_GOONER_IDS` cache and clears the flag whenever a season
title is picked instead.

All DB-touching cases live in a single async test — motor's async
client is tied to whichever event loop opened it, so re-entering
`server.db` from a fresh loop (one per test with pytest-asyncio's
function scope) trips a "Event loop is closed" RuntimeError. We
keep every DB assertion under one loop to sidestep that entirely.
"""
import sys
import pathlib

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_ultimate_title_endpoint_flow():
    """End-to-end walk-through of every branch of `set_title` that
    interacts with the ULTIMATE GOONER title:

      1. Non-top-50 caller → 403.
      2. Top-50 caller → equips, `title_season` gets cleared.
      3. Clearing via `ultimate=False` while a season is also cleared
         → both stay off.
      4. Picking a season title clears any lingering `title_ultimate`
         flag — the two banner titles are mutually exclusive.
    """
    if server.db is None:
        pytest.skip("No mongo")
    marker = "ulttest_flow"
    uid_a = ObjectId()
    uid_b = ObjectId()
    doc_a = {
        "_id": uid_a, "email": "ua@t.test", "username": "ua",
        "password_hash": "x", "_test_marker": marker,
    }
    doc_b = {
        "_id": uid_b, "email": "ub@t.test", "username": "ub",
        "password_hash": "x",
        "past_seasons": [
            {"season": 1, "tier": 6, "tier_name": "GRANDMASTER", "rp": 1900},
        ],
        "title_season": 1, "title_ultimate": True,
        "_test_marker": marker,
    }
    await server.db.users.insert_many([doc_a, doc_b])
    # doc_a is NOT in the cache; doc_b IS.
    server.TOP50_GOONER_IDS.pop(str(uid_a), None)
    server.TOP50_GOONER_IDS[str(uid_b)] = 7
    try:
        # 1. Non-top-50 → 403.
        try:
            await server.set_title(server.TitleIn(ultimate=True), user=doc_a)
            raise AssertionError("expected HTTPException 403")
        except server.HTTPException as e:
            assert e.status_code == 403

        # 2. Top-50 equips ULTIMATE; season gets cleared.
        # Re-fetch doc_b so the in-memory copy reflects the DB (it started
        # with title_season=1 + title_ultimate=True). The endpoint mutates
        # its own `user` copy — the returned DTO is the source of truth.
        out = await server.set_title(server.TitleIn(ultimate=True), user=doc_b)
        assert out.get("title_ultimate") is True
        assert out.get("title_season") is None

        # 3. Clearing via ultimate=False.
        out = await server.set_title(server.TitleIn(ultimate=False), user=doc_b)
        assert out.get("title_ultimate") is False

        # 4. Picking a season title clears title_ultimate (re-equip
        # ULTIMATE first, then swap to a season).
        out = await server.set_title(server.TitleIn(ultimate=True), user=doc_b)
        assert out.get("title_ultimate") is True
        out = await server.set_title(server.TitleIn(season=1), user=doc_b)
        assert out.get("title_season") == 1
        assert out.get("title_ultimate") is False
    finally:
        server.TOP50_GOONER_IDS.pop(str(uid_a), None)
        server.TOP50_GOONER_IDS.pop(str(uid_b), None)
        await server.db.users.delete_many({"_test_marker": marker})


def test_public_user_exposes_title_ultimate():
    """The `public_user` DTO used by /auth/me + friend endpoints must
    include `title_ultimate` so the client can render the ULTIMATE
    GOONER banner text. Sync test — no DB needed."""
    user = {
        "_id": ObjectId(),
        "email": "pu2@t.test",
        "username": "pu2",
        "title_ultimate": True,
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "rank_points": 2500,
    }
    out = server.public_user(user)
    assert out.get("title_ultimate") is True

    # Absent flag defaults to False.
    user2 = {**user, "title_ultimate": False}
    assert server.public_user(user2).get("title_ultimate") is False
    user3 = {k: v for k, v in user.items() if k != "title_ultimate"}
    assert server.public_user(user3).get("title_ultimate") is False
