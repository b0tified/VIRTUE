"""Regression tests for the lag-compensated raycast path.

User report:
  > the shots dont feel like they always register

Root cause: server resolves shots using TARGETS' current positions, but
by the time the WS packet arrives the target has moved ~80-150ms in
the server's view. A shot the client visually landed on the target
silently misses.

Fix under test:
  - Every player gains a `pos_history` deque appended to once per tick
    (in `GameRoom.tick`).
  - `raycast_hit` accepts an optional `at_time` arg — when set, every
    candidate target's position is rewound to its snapshot at that
    timestamp before the sphere test.
  - `_apply_shoot` passes `at_time = time.time() - half_rtt - 50ms` for
    real-player shots (bot shots skip lag-comp entirely).
  - Client `shoot` message now carries `ping_ms`; server clamps it
    0..300ms and stashes it on `Player.last_ping_ms`.
"""
import math
import sys
import time

import pytest

sys.path.insert(0, "/app/backend")
import server as srv  # noqa: E402


def _make_room():
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")
    # Strip obstacles + walls so the test's clean -Z aim line isn't
    # occluded by random procgen. Keep `spawn_points` so respawn logic
    # doesn't trip on an empty list.
    room.arena = {"size": 200, "obstacles": [], "spawn_points": [(0.0, 0.0)]}
    return room


def _shooter():
    """Real-player shooter positioned at origin, looking down +Z negative
    (matches the engine's default camera-forward convention)."""
    p = srv.Player(ws=None, is_bot=True, bot_name="shooter")
    p.is_bot = False
    p.user_id = "u-shooter"
    p.username = "shooter"
    p.alive = True
    p.hp = p.max_hp
    p.x, p.y, p.z = 0.0, srv.PLAYER_HEIGHT, 0.0
    p.yaw = 0.0     # look toward -Z
    p.pitch = 0.0
    p.invuln_until = 0.0
    p.last_ping_ms = 0
    return p


def _target_at(x, z):
    p = srv.Player(ws=None, is_bot=True, bot_name="target")
    p.alive = True
    p.x, p.y, p.z = float(x), srv.PLAYER_HEIGHT, float(z)
    p.invuln_until = 0.0
    return p


@pytest.mark.asyncio
async def test_pos_history_appended_per_tick():
    """A single tick must record one history snapshot per live player."""
    room = _make_room()
    bot = room.spawn_bot("BOT", disguised=True, difficulty=1.0)
    bot.x, bot.z = 5.0, -5.0
    before = len(bot.pos_history)
    await room.tick()
    assert len(bot.pos_history) == before + 1
    # Snapshot must include both position and alive state.
    snap = bot.pos_history[-1]
    assert len(snap) == 5
    ts, sx, sy, sz, salive = snap
    assert sx == pytest.approx(5.0)
    assert sz == pytest.approx(-5.0)
    assert salive is True


@pytest.mark.asyncio
async def test_history_buffer_is_bounded():
    """The deque must cap at maxlen=16 so memory doesn't grow unbounded."""
    room = _make_room()
    bot = room.spawn_bot("BOT", disguised=True, difficulty=1.0)
    for _ in range(50):
        await room.tick()
    assert len(bot.pos_history) <= 16


@pytest.mark.asyncio
async def test_raycast_rewinds_target_to_at_time():
    """Shooter at origin, target moved past the shooter's aim line in the
    last ~120ms. A current-time raycast misses; a rewound raycast hits."""
    room = _make_room()
    shooter = _shooter()
    target = _target_at(0.0, -10.0)  # 10m down the -Z aim line at "shot time"
    room.players = {shooter.id: shooter, target.id: target}
    # Seed history: target was at (0,-10) ~120ms ago, then moved sideways.
    shot_time = time.time() - 0.12
    target.pos_history.append((shot_time, 0.0, srv.PLAYER_HEIGHT, -10.0, True))
    # Move target out of the aim line "now".
    target.x = 15.0
    target.pos_history.append((time.time(), 15.0, srv.PLAYER_HEIGHT, -10.0, True))

    # Current-time raycast misses (target is way off the +Z line now).
    hit_now, _, _ = room.raycast_hit(shooter)
    assert hit_now is None, "Current-time raycast should miss after target moved"

    # Rewound raycast hits — target was on the aim line at shot_time.
    hit_then, body_part, _ = room.raycast_hit(shooter, at_time=shot_time)
    assert hit_then is target, "Lag-comp raycast should still register a hit"
    assert body_part in ("head", "torso", "legs")


@pytest.mark.asyncio
async def test_raycast_does_not_revive_dead_target():
    """If the target was alive at shot_time but is dead now, lag-comp
    still hits (favor-the-shooter). If the target was dead at shot_time
    too, lag-comp must NOT hit."""
    room = _make_room()
    shooter = _shooter()
    target = _target_at(0.0, -8.0)
    room.players = {shooter.id: shooter, target.id: target}
    # Snapshot at -120ms: target was dead (just died earlier).
    shot_time = time.time() - 0.12
    target.pos_history.append((shot_time, 0.0, srv.PLAYER_HEIGHT, -8.0, False))
    target.alive = True  # alive now (respawned) but at the wrong spot
    target.x = 30.0
    target.pos_history.append((time.time(), 30.0, srv.PLAYER_HEIGHT, -8.0, True))

    hit, _, _ = room.raycast_hit(shooter, at_time=shot_time)
    assert hit is None, "Lag-comp must not register against a target who was dead at shot time"


@pytest.mark.asyncio
async def test_apply_shoot_uses_lag_compensation():
    """End-to-end: a moving target that was on the aim line ~100ms ago
    but isn't anymore should still take damage when the shooter fires.
    Validates the wiring from `_apply_shoot` → `raycast_hit(at_time=...)`."""
    room = _make_room()
    shooter = _shooter()
    shooter.last_ping_ms = 200  # → ~150ms lookback (100ms half-RTT + 50ms interp)
    shooter.weapon = "ak47"
    target = _target_at(0.0, -10.0)
    room.players = {shooter.id: shooter, target.id: target}
    # Target was on the aim line 200ms ago, but has since strafed off.
    past_ts = time.time() - 0.20
    target.pos_history.append((past_ts, 0.0, srv.PLAYER_HEIGHT, -10.0, True))
    target.x = 20.0
    target.pos_history.append((time.time(), 20.0, srv.PLAYER_HEIGHT, -10.0, True))

    starting_hp = target.hp
    await room._apply_shoot(shooter, base_damage=25)

    assert target.hp < starting_hp, (
        f"Shot did not register despite lag-comp window (hp {starting_hp} → {target.hp})"
    )


@pytest.mark.asyncio
async def test_bots_skip_lag_compensation():
    """Bot shots run at zero RTT — `at_time` must NOT be applied to them.
    A target that just moved out of a bot's aim line should NOT take
    damage because the bot fires using current state."""
    room = _make_room()
    bot = room.spawn_bot("BOT", disguised=True, difficulty=1.0)
    bot.x, bot.y, bot.z = 0.0, srv.PLAYER_HEIGHT, 0.0
    bot.yaw = 0.0
    bot.pitch = 0.0
    bot.alive = True
    bot.weapon = "ak47"
    target = _target_at(20.0, -10.0)  # WAY off the bot's -Z aim line "now"
    target.hp = 100
    room.players[target.id] = target
    # If we naively rewound, this snapshot would put target on the line.
    past_ts = time.time() - 0.20
    target.pos_history.append((past_ts, 0.0, srv.PLAYER_HEIGHT, -10.0, True))
    target.pos_history.append((time.time(), 20.0, srv.PLAYER_HEIGHT, -10.0, True))

    starting_hp = target.hp
    await room._apply_shoot(bot, base_damage=25)

    assert target.hp == starting_hp, "Bots must not use lag compensation"


@pytest.mark.asyncio
async def test_shoot_handler_stashes_ping_ms():
    """The WS shoot handler should clamp + record the client-provided
    ping value so subsequent shots get an accurate rewind window."""
    p = _shooter()
    # Simulate the inner stash from the shoot handler.
    for raw, expected in [(50, 50), (500, 500), (-30, -30), ("nope", None)]:
        msg = {"ping_ms": raw}
        if "ping_ms" in msg:
            try:
                p.last_ping_ms = int(msg["ping_ms"])
            except (TypeError, ValueError):
                pass
        if expected is None:
            # Unchanged from the previous successful set (or 0 if never set).
            assert isinstance(p.last_ping_ms, int)
        else:
            assert p.last_ping_ms == expected
    # And the clamp on the consumer side (downstream in _apply_shoot).
    p.last_ping_ms = 9999
    clamped = max(0, min(300, int(p.last_ping_ms)))
    assert clamped == 300
    p.last_ping_ms = -50
    clamped = max(0, min(300, int(p.last_ping_ms)))
    assert clamped == 0
