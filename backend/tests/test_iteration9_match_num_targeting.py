"""Iteration-9 backend tests for VIRTUE FPS.

These tests exercise the new `match_num` targeting introduced to fix the
"instant-match-end" bug in casual quick-play. The casual room is shared
across players who connect at different times. Previously, a player
joining seconds before `end_match` ran would still get the match_end
broadcast and immediately see the "MATCH OVER" overlay on a freshly
loaded screen.

Fix under test:
  - GameRoom.__init__ tracks self.match_num (starts at 0)
  - GameRoom.add stamps player.joined_match_num = match_num + (1 if in_intermission else 0)
  - end_match snapshots ended_match_num and uses asyncio.gather to send
    match_end ONLY to players whose joined_match_num == ended_match_num
    (or spectators)
  - The reset block sets joined_match_num = match_num + 1 on existing
    players and increments self.match_num right before broadcasting
    match_start.

We unit-test the broadcast targeting directly by:
  1) constructing a GameRoom programmatically (not via the WS endpoint)
  2) creating fake Player objects with a SpyWS that records every send
  3) calling end_match() manually with a short match_duration

We skip the asyncio.create_task loop entirely — the targeting logic
lives in end_match itself and that's the code path we care about.
"""
import asyncio
import json
import os
import sys
import time
import uuid

import pytest

# Make backend importable.
sys.path.insert(0, "/app/backend")
import server as srv  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers / fakes
# ---------------------------------------------------------------------------


class SpyWS:
    """Stand-in for the FastAPI WebSocket — records every send_text payload
    in order so we can assert which messages a given player received."""

    def __init__(self):
        self.sent: list[dict] = []
        self.closed = False

    async def send_text(self, text: str):
        try:
            self.sent.append(json.loads(text))
        except Exception:
            self.sent.append({"_raw": text})

    async def send_json(self, obj):
        self.sent.append(obj)

    async def close(self, code: int = 1000):
        self.closed = True

    # Convenience
    def types(self):
        return [m.get("type") for m in self.sent if isinstance(m, dict)]

    def count(self, t):
        return sum(1 for m in self.sent if isinstance(m, dict) and m.get("type") == t)


def _make_player(username: str, ws: SpyWS, user_id: str | None = None):
    """Construct a Player without touching the DB by routing through the
    `is_bot=True` branch (which doesn't read user["_id"]), then converting
    it back into a non-bot for end_match's broadcast targeting logic."""
    p = srv.Player(ws=ws, is_bot=True, bot_name=username)
    p.is_bot = False  # flip back so end_match targets real-player path
    p.ws = ws
    p.user_id = user_id or str(uuid.uuid4())
    p.username = username
    p.alive = True
    p.hp = p.max_hp
    p.kills = 0
    p.deaths = 0
    return p


@pytest.fixture()
def fast_room(monkeypatch):
    """A casual GameRoom with a 2-second match and a stubbed intermission
    so end_match returns quickly. We patch asyncio.sleep within server's
    namespace for the duration of the test so the 10s intermission inside
    end_match takes <1s."""
    # Replace the long intermission with a tiny pause to keep tests fast.
    orig_sleep = asyncio.sleep

    async def fast_sleep(secs: float):
        # collapse anything >=1s to 0.05s, leave shorter sleeps untouched
        await orig_sleep(0.05 if secs >= 1.0 else secs)

    monkeypatch.setattr(srv.asyncio, "sleep", fast_sleep)
    room = srv.GameRoom(is_ranked=False, match_duration=2.0)
    return room


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


# --- match_num init + join stamping ---------------------------------------

@pytest.mark.asyncio
async def test_initial_match_num_is_zero(fast_room):
    """A freshly constructed GameRoom starts at match_num=0."""
    assert fast_room.match_num == 0
    assert fast_room.in_intermission is False


@pytest.mark.asyncio
async def test_player_join_stamps_current_match_num(fast_room):
    """A player who joins while a match is live gets joined_match_num=match_num."""
    ws = SpyWS()
    p = _make_player("TEST_alice", ws)
    await fast_room.add(p)
    assert p.joined_match_num == 0  # current match
    assert fast_room.match_num == 0


@pytest.mark.asyncio
async def test_player_join_during_intermission_stamps_next_match(fast_room):
    """Joining mid-intermission stamps joined_match_num = match_num + 1."""
    fast_room.in_intermission = True
    ws = SpyWS()
    p = _make_player("TEST_bob", ws)
    await fast_room.add(p)
    assert p.joined_match_num == 1  # next match


# --- core fix: late joiner doesn't get stale match_end --------------------

@pytest.mark.asyncio
async def test_only_participants_receive_match_end(fast_room):
    """Player A joins match 0 → end_match → match 1 → Player B joins → match 1 ends.
    A must get exactly ONE match_end (for match 0 plus match 1 = 2), and
    B must get exactly ONE match_end (only match 1)."""
    # --- Player A joins match 0 ---
    ws_a = SpyWS()
    a = _make_player("TEST_alice", ws_a)
    await fast_room.add(a)
    assert a.joined_match_num == 0

    # --- End match 0. Only A should receive match_end. ---
    await fast_room.end_match()
    # After end_match returns: match_num has been incremented to 1.
    assert fast_room.match_num == 1
    assert fast_room.in_intermission is False
    assert ws_a.count("match_end") == 1, f"A's messages: {ws_a.types()}"
    assert ws_a.count("match_start") == 1
    # A's joined_match_num should have been rolled forward in the reset
    # block so they continue receiving the next match_end.
    assert a.joined_match_num == 1

    # --- Player B joins partway through match 1 (NOT intermission). ---
    ws_b = SpyWS()
    b = _make_player("TEST_bob", ws_b)
    await fast_room.add(b)
    assert b.joined_match_num == 1  # current match
    # CRITICAL: joining did NOT replay the prior match_end onto B.
    assert ws_b.count("match_end") == 0, (
        f"Late joiner got stale match_end. B's messages: {ws_b.types()}"
    )

    # --- End match 1. Both A and B should receive match_end. ---
    await fast_room.end_match()
    assert fast_room.match_num == 2
    assert ws_a.count("match_end") == 2  # one per match they were in
    assert ws_b.count("match_end") == 1  # only the second match


@pytest.mark.asyncio
async def test_late_joiner_during_intermission_does_not_receive_ended_match_end(fast_room):
    """Player A is in match 0. We fire end_match — but during the 10s
    intermission window (here ~50ms), Player B connects. B's
    joined_match_num must be match_num+1, and B must NOT see the
    match_end broadcast that was scoped to match 0."""
    ws_a = SpyWS()
    a = _make_player("TEST_alice", ws_a)
    await fast_room.add(a)

    # Schedule a join during intermission. We can't reliably interleave
    # async tasks here, so instead we synchronously verify the targeting
    # logic by simulating it: set in_intermission=True (end_match sets
    # it first thing), add B, then run end_match.
    fast_room.in_intermission = True
    ws_b = SpyWS()
    b = _make_player("TEST_bob_late", ws_b)
    await fast_room.add(b)
    # B's joined_match_num should be 1 — i.e. the upcoming match.
    assert b.joined_match_num == 1
    # Reset intermission flag so end_match runs cleanly.
    fast_room.in_intermission = False

    await fast_room.end_match()
    # A was in match 0 → 1 match_end
    assert ws_a.count("match_end") == 1, ws_a.types()
    # B joined during intermission with joined_match_num=1 → 0 match_ends.
    # (The current match that just ended was match 0.)
    assert ws_b.count("match_end") == 0, (
        f"B saw stale match_end despite joined_match_num=1. msgs: {ws_b.types()}"
    )
    # Both should see the match_start for match 1.
    assert ws_a.count("match_start") == 1
    assert ws_b.count("match_start") == 1


@pytest.mark.asyncio
async def test_spectator_still_receives_match_end(fast_room):
    """Spectators should ALWAYS receive match_end regardless of
    joined_match_num — they're observers, not participants."""
    ws_a = SpyWS()
    a = _make_player("TEST_alice", ws_a)
    await fast_room.add(a)

    ws_spec = SpyWS()
    spec = _make_player("TEST_spec", ws_spec)
    spec.is_spectator = True
    # Spectators may have weird joined_match_num — force it ahead.
    await fast_room.add(spec)
    spec.joined_match_num = 999  # deliberately mismatched

    await fast_room.end_match()
    assert ws_a.count("match_end") == 1
    assert ws_spec.count("match_end") == 1, (
        f"Spectator missed match_end. msgs: {ws_spec.types()}"
    )


# --- regression: replay-on-join still works for original participants -----

@pytest.mark.asyncio
async def test_existing_participants_keep_their_match_end_on_replay(fast_room):
    """If a player who was in the match disconnects + reconnects during
    intermission, the replay-on-join logic in GameRoom.add should still
    deliver the last match_end to them (since they're in placements)."""
    ws_a = SpyWS()
    a = _make_player("TEST_alice_rejoin", ws_a, user_id="user-alice-1")
    await fast_room.add(a)

    await fast_room.end_match()
    # Force room back into intermission state to exercise the replay-on-join
    # path (end_match already exited intermission for us).
    fast_room.in_intermission = True
    # Re-arm last_match_end_payload by saving the most recent broadcast.
    # end_match already set last_match_end_payload, but the reset block
    # cleared it. Reconstruct minimally so we can test the replay code.
    fast_room.last_match_end_payload = {
        "type": "match_end",
        "placements": [{"user_id": "user-alice-1", "username": "TEST_alice_rejoin",
                         "kills": 0, "deaths": 0, "delta": 0, "rank_tier": 0,
                         "rank_name": "BRONZE", "id": "x"}],
        "duration": 2.0,
        "is_ranked": False,
    }

    # Now simulate reconnect.
    ws_a2 = SpyWS()
    a2 = _make_player("TEST_alice_rejoin", ws_a2, user_id="user-alice-1")
    await fast_room.add(a2)
    # Replay should have fired because user_id appears in placements.
    assert ws_a2.count("match_end") >= 1, (
        f"Original participant didn't get match_end replay on reconnect. msgs: {ws_a2.types()}"
    )
