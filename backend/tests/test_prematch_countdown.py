"""Pre-match freeze + 3-2-1 countdown tests.

Every new match (initial spawn AND inter-round resets) holds the room
in a movement+shoot lock until either:
  - every real player sends `{type: "loaded"}` and the configured
    countdown (default 3s) elapses, OR
  - a 30s safety grace window expires (force-start fallback so a buggy
    client can't softlock a lobby forever).

While frozen:
  - `match_started == False`
  - `handle_message` drops `shoot` / `melee`
  - `input` lets yaw/pitch through but ignores x/z movement
  - tick loop does not run bot AI / respawn / match-duration timer
"""
import asyncio
import sys
import pathlib
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


class _FakePlayer:
    """Minimum surface area Player stub for `GameRoom` plumbing."""
    def __init__(self, pid, is_bot=False):
        self.id = pid
        self.user_id = None if is_bot else f"u_{pid}"
        self.username = pid
        self.is_bot = is_bot
        self.is_spectator = False
        self.is_loaded = bool(is_bot)
        self.alive = True
        self.x = 0.0; self.y = 0.0; self.z = 0.0
        self.yaw = 0.0; self.pitch = 0.0
        # Stubs the handler reads while we're injecting messages.
        from collections import deque
        self.pos_history = deque(maxlen=16)
        self.weapon = "ak47"
        self.last_shot_ms = 0
        self.invuln_until = 0.0
        self.broadcasted = []  # captures _send (we monkeypatch room broadcast/_send)


def _make_room():
    """A bare `GameRoom` with broadcast / _send no-oped so we can call
    handlers without a real WebSocket."""
    r = server.GameRoom()
    r._sent: list = []
    async def fake_broadcast(payload):
        r._sent.append(("broadcast", payload))
    async def fake_send(p, payload):
        r._sent.append(("send", p, payload))
    r.broadcast = fake_broadcast
    r._send = fake_send
    return r


@pytest.mark.asyncio
async def test_room_starts_frozen_with_no_countdown():
    """Fresh `GameRoom` must come up frozen — no countdown until
    real players report loaded."""
    r = _make_room()
    assert r.match_started is False
    assert r.countdown_until is None
    assert r.countdown_seconds == 3.0


@pytest.mark.asyncio
async def test_countdown_starts_when_all_real_players_loaded():
    """Two real players: countdown starts only after BOTH send loaded."""
    r = _make_room()
    p1 = _FakePlayer("p1"); p2 = _FakePlayer("p2")
    r.players = {p1.id: p1, p2.id: p2}

    # Only p1 loaded → no countdown yet.
    await r.handle_message(p1, {"type": "loaded"})
    assert r.countdown_until is None, "should still be waiting on p2"
    assert r.match_started is False
    assert not any(s[0] == "broadcast" and s[1].get("type") == "match_countdown" for s in r._sent)

    # p2 loaded → countdown fires, broadcast emitted.
    await r.handle_message(p2, {"type": "loaded"})
    assert r.countdown_until is not None
    # match_start was pushed to the countdown end so the match-duration
    # timer doesn't include the frozen seconds.
    assert abs(r.match_start - r.countdown_until) < 1e-3
    broadcasts = [s[1] for s in r._sent if s[0] == "broadcast"]
    assert any(b.get("type") == "match_countdown" for b in broadcasts)


@pytest.mark.asyncio
async def test_shoot_and_melee_blocked_while_frozen():
    """Shoots/melees sent during the freeze must NOT mutate state."""
    r = _make_room()
    p1 = _FakePlayer("p1")
    r.players = {p1.id: p1}

    # Shoot before match_started → silently dropped.
    pre_shot_ts = p1.last_shot_ms
    await r.handle_message(p1, {"type": "shoot", "weapon": "ak47", "yaw": 0, "pitch": 0})
    assert p1.last_shot_ms == pre_shot_ts

    # Same for melee — handler returns immediately.
    await r.handle_message(p1, {"type": "melee", "yaw": 0, "pitch": 0})
    # Nothing was broadcast as a shoot/hit event.
    events = [s[1] for s in r._sent if s[0] == "broadcast"]
    assert not any(e.get("type") in ("shoot", "hit") for e in events)


@pytest.mark.asyncio
async def test_movement_xz_blocked_but_yaw_pitch_pass_through():
    """Players can pan the camera during the freeze (feels better than
    a fully locked view) but x/z deltas must be rejected."""
    r = _make_room()
    p1 = _FakePlayer("p1")
    p1.x, p1.z = 5.0, 5.0
    r.players = {p1.id: p1}

    await r.handle_message(p1, {
        "type": "input",
        "x": 9.0, "z": 9.0,        # would-be position delta
        "yaw": 1.2, "pitch": -0.3,  # camera pan
    })
    # x/z untouched
    assert p1.x == 5.0 and p1.z == 5.0
    # camera pan applied (pitch clamped to ±1.5)
    assert p1.yaw == 1.2
    assert abs(p1.pitch - (-0.3)) < 1e-6


@pytest.mark.asyncio
async def test_begin_match_now_flips_started_and_resets_match_start():
    """`_begin_match_now` is the only path that flips
    `match_started=True`. It must reset `match_start` to "now" so the
    duration timer starts fresh from this exact moment."""
    r = _make_room()
    r.countdown_until = time.time() + 0.1  # countdown almost done
    r.match_start = r.countdown_until      # what _maybe_start_countdown set
    await r._begin_match_now()
    assert r.match_started is True
    assert r.countdown_until is None
    # match_start should be ~now (within 50ms of the call).
    assert abs(r.match_start - time.time()) < 0.05
    # match_go broadcast emitted.
    broadcasts = [s[1] for s in r._sent if s[0] == "broadcast"]
    assert any(b.get("type") == "match_go" for b in broadcasts)


@pytest.mark.asyncio
async def test_idempotent_countdown_start():
    """Calling `_maybe_start_countdown` twice when conditions are met
    must NOT fire two `match_countdown` broadcasts."""
    r = _make_room()
    p1 = _FakePlayer("p1"); p1.is_loaded = True
    r.players = {p1.id: p1}

    await r._maybe_start_countdown()
    await r._maybe_start_countdown()
    countdown_msgs = [
        s[1] for s in r._sent
        if s[0] == "broadcast" and s[1].get("type") == "match_countdown"
    ]
    assert len(countdown_msgs) == 1


@pytest.mark.asyncio
async def test_late_join_skips_countdown_when_match_already_live():
    """A new player joining mid-match must NOT re-trigger the countdown
    — the match is already live and the late joiner gets dropped
    straight in. (`_maybe_start_countdown` is the early-return on
    `match_started == True`.)"""
    r = _make_room()
    r.match_started = True  # match has been live for a while
    late = _FakePlayer("late"); late.is_loaded = True
    r.players = {late.id: late}

    await r._maybe_start_countdown()
    # No countdown broadcast at all.
    broadcasts = [s[1] for s in r._sent if s[0] == "broadcast"]
    assert not any(b.get("type") == "match_countdown" for b in broadcasts)


@pytest.mark.asyncio
async def test_bots_count_as_loaded_so_a_solo_player_still_starts():
    """Solo practice mode (1 real + N bots): only the real player needs
    to report loaded — bots are `is_loaded=True` from construction."""
    r = _make_room()
    p1 = _FakePlayer("p1")
    bot1 = _FakePlayer("bot1", is_bot=True)
    bot2 = _FakePlayer("bot2", is_bot=True)
    r.players = {p1.id: p1, bot1.id: bot1, bot2.id: bot2}

    await r.handle_message(p1, {"type": "loaded"})
    assert r.countdown_until is not None
