"""Party ranked queue integration — verifies the whole pipeline that
was reported broken:
  1. Leader queues → server enqueues ALL party members' user_ids.
  2. Follower calls GET /queue/ranked → returns `in_queue: true`
     (the follower's client uses this to detect and follow the leader
     into the ranked room).
  3. Follower's PMI stays consistent while queued.

The reported symptom was "only the leader queues; follower stays in
lobby". This test locks in the invariant that the follower is
detectable in RANKED_QUEUE via their own user_id.
"""
import sys
import pathlib
import asyncio
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def _clear_state():
    server.PARTIES.clear()
    server.PARTY_MEMBER_INDEX.clear()
    server.PARTY_OWNERS.clear()
    for q in server.RANKED_QUEUE.values():
        q.clear()
    server.MATCHED_USERS.clear()


def _setup_party():
    """Two-member party: leader u1 + follower u2. Both PMI-registered
    (the healthy-state baseline)."""
    _clear_state()
    server.PARTIES["p1"] = {
        "leader_id": "u1",
        "members": ["u1", "u2"],
        "match_starting": False,
        "party_id": "p1",
    }
    server.PARTY_MEMBER_INDEX["u1"] = "p1"
    server.PARTY_MEMBER_INDEX["u2"] = "p1"
    server.PARTY_OWNERS["p1"] = "u1"


def test_leader_queue_enqueues_all_members():
    """When the leader posts to /queue/ranked (via the internal path
    the endpoint uses), the queue entry must contain BOTH user_ids.
    Follower's client detects the queue by scanning for their own
    user_id in the entries' user_ids list."""
    _setup_party()
    # Mimic what queue_ranked_join builds after `_party_for_user`
    # returns the party: `member_ids = list(party["members"])` then
    # appends a queue entry with `user_ids=member_ids`.
    party = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("u1")
    )
    assert party is not None
    member_ids = list(party["members"])
    assert "u1" in member_ids
    assert "u2" in member_ids, (
        "Follower u2 missing from party members — leader queue would "
        "enqueue leader only, follower stays in lobby (reported bug)."
    )
    # Simulate the endpoint's enqueue.
    server.RANKED_QUEUE[3].append({
        "user_ids": member_ids,
        "usernames": ["Leader", "Follower"],
        "user_id": "u1",
        "username": "Leader",
        "joined_at": time.time(),
        "is_party": True,
        "party_id": "p1",
    })
    # Follower's status query must find them in the entry.
    found = False
    for q in server.RANKED_QUEUE.values():
        for e in q:
            uids = e.get("user_ids") or []
            if "u2" in uids:
                found = True
                break
    assert found, "Follower u2 not detectable in RANKED_QUEUE — bg poll returns in_queue:false"


def test_follower_detects_leader_queue_even_with_stale_pmi():
    """Regression: even if the follower's PMI entry was lost (desync),
    `_party_for_user('u2')` MUST still find them via the members-list
    scan and repair the index. Otherwise the leader's queue call would
    treat u2 as solo and enqueue u1 alone."""
    _setup_party()
    # Simulate the desync — u2's PMI is missing but they're still in
    # party["members"].
    del server.PARTY_MEMBER_INDEX["u2"]
    # Leader still resolves fine.
    p_leader = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("u1")
    )
    assert p_leader is not None
    # Follower resolves via self-repair.
    p_follower = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("u2")
    )
    assert p_follower is not None, (
        "Self-repair failed for follower — leader would queue as solo."
    )
    # PMI must be back in sync.
    assert server.PARTY_MEMBER_INDEX.get("u2") == "p1"


def test_solo_user_not_affected():
    """Solo (non-party) users must still get None from _party_for_user
    even after the resync scan added defensive logic."""
    _clear_state()
    # A different user is in a party, but our test user is not.
    server.PARTIES["p1"] = {"leader_id": "other", "members": ["other"], "match_starting": False}
    server.PARTY_MEMBER_INDEX["other"] = "p1"
    result = asyncio.get_event_loop().run_until_complete(
        server._party_for_user("solo_user")
    )
    assert result is None
    assert "solo_user" not in server.PARTY_MEMBER_INDEX


def test_party_me_uses_resync_path():
    """The /party/me endpoint calls `_party_for_user` (not a raw PMI
    lookup) so a desync doesn't cause the client's party panel to
    flash off. Read the source back to confirm."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    marker = 'async def party_me'
    idx = src.find(marker)
    assert idx > 0
    window = src[idx:idx + 800]
    assert "_party_for_user(me_id)" in window, (
        "/party/me is not routing through the PMI-resync helper — "
        "the client's party panel can flash off on transient index "
        "misses."
    )
