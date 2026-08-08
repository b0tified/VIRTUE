"""Party casual queue tests.

The "party Quick Match" flow was rewritten from spawning a private
party room to just enqueueing the whole party into the shared casual
queue. Rules:

  • Only the party leader may POST /queue/casual while partied.
    Non-leaders receive a 403.
  • The leader's POST enqueues the WHOLE party as a single multi-user
    CASUAL_QUEUE entry (mirroring the party-ranked pattern) so both
    members poll `in_queue: true` and get matched together.
  • DELETE /queue/casual dequeues every party-mate — the matched-users
    map is scrubbed for everyone so nobody ends up half-matched.
"""
import sys
import pathlib

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _make_party(leader_id: str, member_ids: list[str]) -> str:
    """Register a fresh 2-member party directly in the in-memory maps."""
    pid = "test_party_" + ObjectId().binary.hex()[:8]
    server.PARTIES[pid] = {
        "party_id": pid,
        "leader_id": leader_id,
        "members": [leader_id, *member_ids],
        "created_at": 0.0,
        "match_starting": False,
    }
    for uid in [leader_id, *member_ids]:
        server.PARTY_MEMBER_INDEX[uid] = pid
    return pid


def _cleanup_party(pid: str):
    p = server.PARTIES.pop(pid, None)
    if p:
        for uid in p.get("members", []):
            server.PARTY_MEMBER_INDEX.pop(uid, None)


@pytest.mark.asyncio
async def test_party_casual_queue_end_to_end():
    """Full flow — invite, follower blocked, leader enqueues whole party,
    both members show `in_queue`, leader's cancel dequeues both."""
    if server.db is None:
        pytest.skip("No mongo")
    leader_id = str(ObjectId())
    follower_id = str(ObjectId())
    marker = "party_casual_test"
    leader_doc = {
        "_id": ObjectId(leader_id),
        "email": "pcasl@t.test", "username": "pcasl", "password_hash": "x",
        "_test_marker": marker,
    }
    follower_doc = {
        "_id": ObjectId(follower_id),
        "email": "pcasf@t.test", "username": "pcasf", "password_hash": "x",
        "_test_marker": marker,
    }
    await server.db.users.insert_many([leader_doc, follower_doc])
    pid = _make_party(leader_id, [follower_id])
    # Clear any residual queue state from previous tests.
    async with server.QUEUE_LOCK:
        server.CASUAL_QUEUE.clear()
        for uid in (leader_id, follower_id):
            server.MATCHED_USERS.pop(uid, None)
    try:
        # 1. Follower → 403.
        try:
            await server.queue_casual_join(user=follower_doc)
            raise AssertionError("expected HTTPException 403")
        except server.HTTPException as e:
            assert e.status_code == 403

        # 2. Leader queues → single multi-user entry, party_size == 2.
        out = await server.queue_casual_join(user=leader_doc)
        assert out.get("ok") is True
        assert out.get("is_party") is True
        assert out.get("party_size") == 2
        assert len(server.CASUAL_QUEUE) == 1
        entry = server.CASUAL_QUEUE[0]
        assert entry["is_party"] is True
        assert set(entry["user_ids"]) == {leader_id, follower_id}

        # 3. Both members' GET reports in_queue.
        leader_state = await server.queue_casual_state(user=leader_doc)
        follower_state = await server.queue_casual_state(user=follower_doc)
        assert leader_state.get("in_queue") is True
        assert follower_state.get("in_queue") is True

        # 4. Leader cancels → queue is empty and both matched-users clean.
        # Stamp both members in MATCHED_USERS first to prove leave scrubs
        # every party-mate, not just the caller.
        server.MATCHED_USERS[leader_id] = {"match_id": "x", "casual": True, "matched_at": 0.0}
        server.MATCHED_USERS[follower_id] = {"match_id": "x", "casual": True, "matched_at": 0.0}
        # Re-enqueue for the cancel test (the previous state check consumed nothing).
        await server.queue_casual_leave(user=leader_doc)
        assert not any(
            leader_id in (e.get("user_ids") or []) or follower_id in (e.get("user_ids") or [])
            for e in server.CASUAL_QUEUE
        )
        assert leader_id not in server.MATCHED_USERS
        assert follower_id not in server.MATCHED_USERS
    finally:
        async with server.QUEUE_LOCK:
            server.CASUAL_QUEUE.clear()
            for uid in (leader_id, follower_id):
                server.MATCHED_USERS.pop(uid, None)
        _cleanup_party(pid)
        await server.db.users.delete_many({"_test_marker": marker})


@pytest.mark.asyncio
async def test_solo_casual_queue_still_works():
    """Regression — a solo (non-party) user's casual queue join should
    still enqueue exactly one user and report is_party == False."""
    if server.db is None:
        pytest.skip("No mongo")
    solo_id = str(ObjectId())
    marker = "solo_casual_test"
    solo_doc = {
        "_id": ObjectId(solo_id),
        "email": "solo@t.test", "username": "solo_qu", "password_hash": "x",
        "_test_marker": marker,
    }
    await server.db.users.insert_one(solo_doc)
    async with server.QUEUE_LOCK:
        server.CASUAL_QUEUE.clear()
        server.MATCHED_USERS.pop(solo_id, None)
    try:
        out = await server.queue_casual_join(user=solo_doc)
        assert out.get("is_party") is False
        assert out.get("party_size") == 1
        entry = server.CASUAL_QUEUE[0]
        assert entry["user_ids"] == [solo_id]
    finally:
        async with server.QUEUE_LOCK:
            server.CASUAL_QUEUE.clear()
            server.MATCHED_USERS.pop(solo_id, None)
        await server.db.users.delete_many({"_test_marker": marker})
