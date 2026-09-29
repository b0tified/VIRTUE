"""Stale MATCHED_USERS sweep on /queue/casual and /queue/bigffa GET.

Repro: user was reporting "the Quick Match queue pops up even when I'm
not queuing, and it pops up when I log in." Root cause was a leftover
`MATCHED_USERS[uid]` entry (casual or bigffa) from a previous session
that never got consumed (e.g. tab closed mid-3-2-1 countdown, ack
never fired). On next login the client's background poll would hit
GET /queue/casual, see matched:true, and instantly fire the
"Match Found!" overlay + nav to /play.

Fix: mirror the 60s stale sweep that /queue/ranked already applies —
if the matched entry is older than 60s, evict it and return
in_queue:false, matched:false.

Also test that a FRESH matched entry (<60s) is still surfaced so the
legit party-follower flow continues to work.
"""
import sys
import pathlib
import time
import asyncio
import types

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_state():
    server.CASUAL_QUEUE.clear()
    server.BIGFFA_QUEUE.clear()
    server.MATCHED_USERS.clear()
    yield
    server.CASUAL_QUEUE.clear()
    server.BIGFFA_QUEUE.clear()
    server.MATCHED_USERS.clear()


def _user(uid: str) -> dict:
    return {"_id": uid, "username": f"u_{uid}"}


@pytest.mark.asyncio
async def test_stale_casual_matched_swept_on_get():
    """A casual MATCHED_USERS entry older than 60s must be evicted
    on GET /queue/casual so the client doesn't auto-enter a phantom
    match on login."""
    uid = "alice"
    server.MATCHED_USERS[uid] = {
        "match_id": "old_match",
        "casual": True,
        "matched_at": time.time() - 120.0,  # 2 min ago
        "tdm": False,
    }
    res = await server.queue_casual_state(user=_user(uid))
    assert res["in_queue"] is False
    assert res["matched"] is False
    assert uid not in server.MATCHED_USERS  # swept


@pytest.mark.asyncio
async def test_fresh_casual_matched_still_surfaces():
    """A casual MATCHED_USERS entry within the 60s window should still
    return matched:true — this is the legit party-follower path."""
    uid = "bob"
    server.MATCHED_USERS[uid] = {
        "match_id": "fresh_match",
        "casual": True,
        "matched_at": time.time() - 5.0,  # 5s ago
        "tdm": True,
    }
    res = await server.queue_casual_state(user=_user(uid))
    assert res["matched"] is True
    assert res["match_id"] == "fresh_match"
    assert res["tdm"] is True
    assert uid in server.MATCHED_USERS  # NOT swept


@pytest.mark.asyncio
async def test_stale_bigffa_matched_swept_on_get():
    """Same sweep on GET /queue/bigffa."""
    uid = "carol"
    server.MATCHED_USERS[uid] = {
        "match_id": "old_bigffa",
        "bigffa": True,
        "matched_at": time.time() - 120.0,
    }
    res = await server.queue_bigffa_state(user=_user(uid))
    assert res["in_queue"] is False
    assert res["matched"] is False
    assert uid not in server.MATCHED_USERS


@pytest.mark.asyncio
async def test_fresh_bigffa_matched_still_surfaces():
    uid = "dave"
    server.MATCHED_USERS[uid] = {
        "match_id": "fresh_bigffa",
        "bigffa": True,
        "matched_at": time.time() - 5.0,
    }
    res = await server.queue_bigffa_state(user=_user(uid))
    assert res["matched"] is True
    assert res.get("bigffa") is True
    assert res["match_id"] == "fresh_bigffa"


@pytest.mark.asyncio
async def test_ranked_matched_entry_does_not_leak_into_casual_get():
    """A ranked MATCHED_USERS entry (has `tier`, no `casual`) must not
    trigger matched:true on GET /queue/casual — otherwise the wrong
    overlay pops on the wrong queue."""
    uid = "eve"
    server.MATCHED_USERS[uid] = {
        "match_id": "ranked_match",
        "tier": 3,
        "matched_at": time.time() - 5.0,
    }
    res = await server.queue_casual_state(user=_user(uid))
    assert res["matched"] is False
    assert res["in_queue"] is False
    # Ranked entry preserved (not swept by the casual GET's sweep).
    assert uid in server.MATCHED_USERS
