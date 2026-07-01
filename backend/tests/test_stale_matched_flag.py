"""Stale-matched-flag cleanup tests.

Bug: `MATCHED_USERS` used to linger past the match end because the
ranked ws_game endpoint never popped the flag on connect (only casual
did). If the ack also failed (tab close, network hiccup) the next
`/queue/ranked` GET would report `matched: true` forever, spamming
"match found" on the client every 3s and preventing a fresh queue.

Fix:
  • Ranked ws_game connect pops MATCHED_USERS[uid] after reading it.
  • POST /queue/ranked + GET /queue/ranked both sweep any entry older
    than 60s as stale (real matches consume the flag in <5s).
"""
import sys
import pathlib
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_matched():
    server.MATCHED_USERS.clear()
    yield
    server.MATCHED_USERS.clear()


def _user(uid: str = "u_stale", rp: int = 450) -> dict:
    return {
        "_id": uid,
        "email": f"{uid}@t.test",
        "username": uid,
        # Enough XP to clear the Level-5 ranked gate.
        "stats": {"kills": 200, "deaths": 100, "matches": 50, "wins": 30},
        "rank_points": rp,
    }


@pytest.mark.asyncio
async def test_stale_matched_flag_swept_on_get():
    """A MATCHED_USERS entry older than 60s must NOT be surfaced by
    GET /queue/ranked — it should be cleaned up and the endpoint
    should return the plain no-queue state."""
    user = _user()
    uid = user["_id"]
    server.MATCHED_USERS[uid] = {
        "match_id": "old", "tier": 1, "matched_at": time.time() - 61.0,
    }
    out = await server.queue_ranked_status(user=user)
    assert out.get("matched") is not True, out
    assert out.get("in_queue") is False
    # Flag should have been swept.
    assert uid not in server.MATCHED_USERS


@pytest.mark.asyncio
async def test_fresh_matched_flag_still_returns_matched():
    """A MATCHED_USERS entry created seconds ago (typical: player just
    got matched) should still return `matched: true` — we only sweep
    the ancient ones."""
    user = _user(uid="u_fresh")
    uid = user["_id"]
    server.MATCHED_USERS[uid] = {
        "match_id": "new", "tier": 1, "matched_at": time.time(),
    }
    out = await server.queue_ranked_status(user=user)
    assert out.get("matched") is True
    assert out["match_id"] == "new"
    # Still present (fresh flag isn't swept).
    assert uid in server.MATCHED_USERS


@pytest.mark.asyncio
async def test_post_queue_ranked_sweeps_stale_flag_before_join():
    """POST /queue/ranked must also sweep — otherwise a stale flag
    would short-circuit the join and instantly report a ghost match."""
    user = _user(uid="u_stale_post")
    uid = user["_id"]
    server.MATCHED_USERS[uid] = {
        "match_id": "old", "tier": 1, "matched_at": time.time() - 120.0,
    }
    out = await server.queue_ranked_join(user=user)
    # After the sweep the flag is gone and we get queued fresh.
    assert out.get("matched") is not True, out
    assert out.get("in_queue") is True
    assert uid not in server.MATCHED_USERS
    # Cleanup: yank the queue entry we just inserted so we don't
    # bleed state into other tests.
    server._remove_user_from_ranked_queue(uid)
