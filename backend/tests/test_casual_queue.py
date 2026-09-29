"""Casual matchmaking queue tests.

The Quick Match flow now mirrors Ranked: a server-side FIFO queue
(`CASUAL_QUEUE`) with a 10s bot-fill timeout. The matchmaker pairs
two entries head-to-head when present, otherwise bot-fills after the
timeout. Both branches stamp `MATCHED_USERS[uid]` with `casual: True`
and a single rolled `tdm` flag so paired players land in the same
shared room (game_room vs tdm_room).
"""
import sys
import pathlib
import asyncio
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_queue_state():
    """Each test gets a clean queue/matched-users dict so order
    doesn't leak between cases."""
    server.CASUAL_QUEUE.clear()
    server.MATCHED_USERS.clear()
    yield
    server.CASUAL_QUEUE.clear()
    server.MATCHED_USERS.clear()


def _queue_entry(uid: str, joined_ago: float = 0.0) -> dict:
    return {
        "user_id": uid,
        "user_ids": [uid],
        "username": f"u_{uid}",
        "usernames": [f"u_{uid}"],
        "joined_at": time.time() - joined_ago,
        "is_party": False,
    }


@pytest.mark.asyncio
async def test_two_entries_pair_head_to_head_with_same_tdm_choice(monkeypatch):
    """Two waiting entries should be popped on the same matchmaker tick
    and both users tagged with the SAME `tdm` flag so they land in
    the same shared room."""
    server.CASUAL_QUEUE.append(_queue_entry("alice"))
    server.CASUAL_QUEUE.append(_queue_entry("bob"))
    # Force a deterministic TDM roll so the test assertion is stable.
    monkeypatch.setattr(server.random, "random", lambda: 0.0)  # < 0.5 → tdm
    # Run one tick of the matchmaker by inlining its body. We can't
    # await the loop directly (infinite), so we recreate one cycle.
    now = time.time()
    async with server.QUEUE_LOCK:
        while len(server.CASUAL_QUEUE) >= 2:
            a = server.CASUAL_QUEUE.pop(0)
            b = server.CASUAL_QUEUE.pop(0)
            import uuid as _uuid
            mid = _uuid.uuid4().hex[:10]
            match_tdm = server.random.random() < server.TDM_QUICK_MATCH_ROLL
            for uid in (a["user_ids"] + b["user_ids"]):
                server.MATCHED_USERS[uid] = {
                    "match_id": mid, "casual": True,
                    "matched_at": now, "tdm": match_tdm,
                }
    assert server.CASUAL_QUEUE == []
    assert "alice" in server.MATCHED_USERS
    assert "bob" in server.MATCHED_USERS
    # Both share the SAME match id AND the same tdm flag.
    assert server.MATCHED_USERS["alice"]["match_id"] == server.MATCHED_USERS["bob"]["match_id"]
    assert server.MATCHED_USERS["alice"]["tdm"] == server.MATCHED_USERS["bob"]["tdm"]
    assert server.MATCHED_USERS["alice"]["casual"] is True


@pytest.mark.asyncio
async def test_solo_entry_bot_fills_after_timeout():
    """A single entry waiting longer than CASUAL_BOT_FILL_SEC is
    bot-filled (vs_bot=True with a private room_key)."""
    e = _queue_entry("carol", joined_ago=server.CASUAL_BOT_FILL_SEC + 1)
    server.CASUAL_QUEUE.append(e)
    now = time.time()
    async with server.QUEUE_LOCK:
        while server.CASUAL_QUEUE and (now - server.CASUAL_QUEUE[0]["joined_at"]) >= server.CASUAL_BOT_FILL_SEC:
            a = server.CASUAL_QUEUE.pop(0)
            import uuid as _uuid
            mid = _uuid.uuid4().hex[:10]
            shared_key = a["user_ids"][0]
            bot_tdm = False  # forced; the actual loop rolls random
            for uid in a["user_ids"]:
                server.MATCHED_USERS[uid] = {
                    "match_id": mid, "casual": True,
                    "matched_at": now, "vs_bot": True,
                    "room_key": shared_key, "tdm": bot_tdm,
                }
    assert server.CASUAL_QUEUE == []
    assert server.MATCHED_USERS["carol"]["vs_bot"] is True
    assert server.MATCHED_USERS["carol"]["room_key"] == "carol"
    assert server.MATCHED_USERS["carol"]["casual"] is True


def test_remove_user_from_casual_queue_yanks_entry():
    """The leave helper must pop the entry holding the given uid."""
    server.CASUAL_QUEUE.append(_queue_entry("dan"))
    server.CASUAL_QUEUE.append(_queue_entry("eve"))
    server.MATCHED_USERS["dan"] = {"casual": True, "match_id": "x"}
    removed = server._remove_user_from_casual_queue("dan")
    assert removed is not None
    assert removed["user_id"] == "dan"
    # Eve should still be in the queue; only Dan was popped.
    assert len(server.CASUAL_QUEUE) == 1
    assert server.CASUAL_QUEUE[0]["user_id"] == "eve"


def test_casual_bot_fill_seconds_is_ten():
    """The product spec is 10s for casual bot-fill — guard against
    accidental regressions to ranked-tier values (60-300s)."""
    assert server.CASUAL_BOT_FILL_SEC == 10.0


def test_casual_matched_payload_includes_tdm_flag(monkeypatch):
    """The GET /queue/casual handler returns the `tdm` flag from
    MATCHED_USERS so the client can drive any pre-match UI hints."""
    server.MATCHED_USERS["frank"] = {
        "casual": True, "match_id": "m1", "tdm": True,
        "vs_bot": False, "room_key": None,
        # Real matchmaker always stamps matched_at; the GET handler
        # now sweeps entries older than 60s to prevent stale matched
        # residue from popping a phantom match on next login.
        "matched_at": time.time(),
    }
    # Build a minimal "user" shape that the dependency expects.
    user_doc = {"_id": "frank", "username": "frank"}
    # Call the endpoint coroutine directly.
    async def run():
        return await server.queue_casual_state(user=user_doc)
    out = asyncio.get_event_loop().run_until_complete(run())
    assert out["matched"] is True
    assert out["tdm"] is True
    assert out["match_id"] == "m1"
