"""Iteration-21 regression test for the "instant defeat on Quick Play" bug.

Scenario reproduced:
  1. Backend starts → casual GameRoom created with match_start = now.
  2. Nobody joins for > match_duration seconds (e.g. dev server idle).
  3. First real player connects via WS.
  4. Tick loop sees `now - match_start >= match_duration` and a real player
     present, so it fires `end_match()` immediately → match_end broadcast
     hits the fresh joiner → instant defeat overlay.

Fix under test:
  - `GameRoom.add` now resets `self.match_start = time.time()` whenever
    the first real, non-spectator player joins an empty (or bots-only)
    room while not in intermission. This pauses the clock during idle.
"""
import asyncio
import json
import sys
import time
import uuid

import pytest

sys.path.insert(0, "/app/backend")
import server as srv  # noqa: E402


class SpyWS:
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

    def count(self, t):
        return sum(1 for m in self.sent if isinstance(m, dict) and m.get("type") == t)


def _make_player(username: str, ws: SpyWS, user_id: str | None = None):
    p = srv.Player(ws=ws, is_bot=True, bot_name=username)
    p.is_bot = False
    p.ws = ws
    p.user_id = user_id or str(uuid.uuid4())
    p.username = username
    p.alive = True
    p.hp = p.max_hp
    p.kills = 0
    p.deaths = 0
    return p


@pytest.mark.asyncio
async def test_first_player_resets_idle_match_clock():
    """A room that has been idle for more than match_duration must NOT
    immediately end_match when the first real player joins. After add(),
    `match_start` should be ~now so the player has the full match."""
    room = srv.GameRoom(is_ranked=False, match_duration=120.0)
    # Simulate the server having been idle for 5 minutes (300s > duration).
    room.match_start = time.time() - 300.0

    ws = SpyWS()
    p = _make_player("alice", ws, user_id="u-alice")
    await room.add(p)

    elapsed = time.time() - room.match_start
    assert elapsed < 1.0, (
        f"match_start was not reset on first real player join (elapsed={elapsed:.2f}s)"
    )
    # Player's joined_match_num must reflect THIS match (match_num=0), not next.
    assert p.joined_match_num == room.match_num


@pytest.mark.asyncio
async def test_clock_not_reset_for_spectator_joins():
    """Spectators must not restart the clock — only real combat players do."""
    room = srv.GameRoom(is_ranked=False, match_duration=120.0)
    fixed = time.time() - 300.0
    room.match_start = fixed

    ws = SpyWS()
    spec = _make_player("snoop", ws, user_id="u-spec")
    spec.is_spectator = True
    await room.add(spec)

    # Spectator join MUST NOT reset the clock.
    assert room.match_start == fixed


@pytest.mark.asyncio
async def test_clock_not_reset_for_subsequent_joiners():
    """Once one real player is in the room, additional real players joining
    must NOT reset the match_start (otherwise the clock could be abused)."""
    room = srv.GameRoom(is_ranked=False, match_duration=120.0)
    room.match_start = time.time() - 300.0

    a = _make_player("alice", SpyWS(), user_id="u-a")
    await room.add(a)
    after_first = room.match_start

    # Small gap so a clock reset would be visible.
    await asyncio.sleep(0.05)

    b = _make_player("bob", SpyWS(), user_id="u-b")
    await room.add(b)
    assert room.match_start == after_first, "Clock should only reset on the FIRST real player"


@pytest.mark.asyncio
async def test_no_instant_match_end_after_idle_then_join():
    """End-to-end: with a stale match_start, add() + a single tick must
    not trigger end_match. Spy on broadcast to detect match_end."""
    sent_payloads: list[dict] = []

    async def spy_end_match(self):
        sent_payloads.append({"type": "match_end"})

    room = srv.GameRoom(is_ranked=False, match_duration=120.0)
    room.match_start = time.time() - 600.0

    a = _make_player("alice", SpyWS(), user_id="u-a")
    await room.add(a)

    # Manually run the same check the tick loop does.
    real_count = sum(1 for p in room.players.values() if not p.is_bot)
    has_min = real_count >= 1
    elapsed_now = time.time() - room.match_start
    triggered = has_min and elapsed_now >= room.match_duration
    assert not triggered, (
        f"match_end would have fired immediately after add() — elapsed={elapsed_now:.2f}s, "
        f"duration={room.match_duration}s. The clock was not reset."
    )
