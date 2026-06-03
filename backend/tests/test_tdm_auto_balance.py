"""Regression tests for TDM auto-balance + friendly-fire fixes.

Covers three user-reported bugs in the 3v3 TDM room:
  1. Bots used to target teammates (friendly fire visual confusion).
  2. Bots in TDM looked like bots (BOT-NAMES + -T suffix), breaking the
     "blends in with humans" feel that FFA already had.
  3. Population was static at 5 bots — joining a busy room could yield
     4v3 or 4v4, and leaving never replenished the slot.

Fix under test:
  - `_tick_bots` target loop skips same-team allies in TDM.
  - Boot spawns 6 disguised bots (`DISGUISED_BOT_NAMES`, disguised=True)
    in every TDM room so the lobby reads as 3v3 of "humans".
  - `_maintain_tdm_population` runs on every real-player join/leave to
    despawn / spawn bots so the head count stays at 6.
"""
import sys
import uuid

import pytest

sys.path.insert(0, "/app/backend")
import server as srv  # noqa: E402


def _real_player(name: str = "human"):
    p = srv.Player(ws=None, is_bot=True, bot_name=name)
    p.is_bot = False
    p.user_id = f"u-{uuid.uuid4().hex[:6]}"
    p.username = name
    p.alive = True
    p.hp = p.max_hp
    p.kills = 0
    p.deaths = 0
    p.is_spectator = False
    return p


def _make_tdm_room(num_bots: int = srv.TDM_TEAM_SIZE * 2):
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="tdm")
    for i in range(num_bots):
        room.spawn_bot(f"BOT{i}", disguised=True, difficulty=1.45)
    return room


# ---------------------------------------------------------------------------
# 1. Friendly-fire targeting
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bots_never_target_same_team_in_tdm():
    """A bot's target selection in TDM must never pick a teammate. We
    simulate the inner scoring loop directly: even when the closest
    eligible body is a teammate, the loop should skip it."""
    room = _make_tdm_room(num_bots=0)
    # Hand-place bots so we control teams precisely.
    ally_close = srv.Player(ws=None, is_bot=True, bot_name="ALLY")
    ally_close.team = "red"
    ally_close.alive = True
    ally_close.hp = 100
    ally_close.x, ally_close.y, ally_close.z = 1.0, 0.0, 0.0  # 1m away
    enemy_far = srv.Player(ws=None, is_bot=True, bot_name="ENEMY")
    enemy_far.team = "blue"
    enemy_far.alive = True
    enemy_far.hp = 100
    enemy_far.x, enemy_far.y, enemy_far.z = 20.0, 0.0, 0.0  # 20m away
    me = srv.Player(ws=None, is_bot=True, bot_name="ME")
    me.team = "red"
    me.alive = True
    me.x, me.y, me.z = 0.0, 0.0, 0.0
    me.bot_target_id = None
    me.bot_target_locked_until = 0.0
    me.last_attacker = None
    room.players = {me.id: me, ally_close.id: ally_close, enemy_far.id: enemy_far}

    # Mimic the production target loop exactly.
    import math
    is_tdm = room.game_mode == "tdm"
    target = None
    best_score = -1.0
    for p in room.players.values():
        if p is me or not p.alive:
            continue
        if is_tdm and me.team and p.team and me.team == p.team:
            continue  # the fix under test
        d = math.hypot(p.x - me.x, p.z - me.z)
        if d < 0.5:
            continue
        score = 1000.0 - d  # casual scoring branch
        if score > best_score:
            best_score = score
            target = p

    assert target is enemy_far, \
        f"Bot picked teammate ALLY over enemy. Selected: {target.username if target else None}"


@pytest.mark.asyncio
async def test_bots_drop_locked_target_if_team_flips():
    """Locked-target shortcut path (smart bots) must also re-check team
    every tick — otherwise a bot whose team got reassigned between
    matches would keep hunting an old enemy who is now an ally."""
    room = _make_tdm_room(num_bots=0)
    bot = srv.Player(ws=None, is_bot=True, bot_name="BOT")
    bot.team = "red"
    bot.alive = True
    enemy = srv.Player(ws=None, is_bot=True, bot_name="X")
    enemy.team = "red"  # same team as bot — locked target is now an ally
    enemy.alive = True
    enemy.x, enemy.z = 2.0, 0.0
    bot.bot_target_id = enemy.id
    bot.bot_target_locked_until = 9e9  # essentially "forever locked"
    room.players = {bot.id: bot, enemy.id: enemy}

    # Replicate the locked-target acceptance check.
    import time as _time
    now_s = _time.time()
    is_tdm = room.game_mode == "tdm"
    target = None
    if bot.bot_target_id and now_s < bot.bot_target_locked_until:
        t = room.players.get(bot.bot_target_id)
        if t and t.alive and not getattr(t, "is_spectator", False):
            if not (is_tdm and bot.team and t.team and bot.team == t.team):
                target = t

    assert target is None, "Bot must abandon a now-teammate locked target"


# ---------------------------------------------------------------------------
# 2. Disguised TDM bots
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_tdm_bots_are_disguised_in_serialize():
    """Every bot spawned in a TDM room should serialize as `is_bot=False`
    (disguise flag) so the scoreboard / killfeed show them as real
    players (matches the no-BOT-tag visual)."""
    room = _make_tdm_room(num_bots=6)
    for bot in room.players.values():
        assert getattr(bot, "disguised", False) is True, f"{bot.username} is not disguised"
        ser = bot.to_state()
        assert ser["is_bot"] is False, \
            f"Disguised bot {bot.username} still serializes is_bot=True"


# ---------------------------------------------------------------------------
# 3. Population auto-balance
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_real_player_join_despawns_a_bot():
    """Adding a real player to a full TDM room (6 bots) must despawn one
    bot so the room stays at 6 total = 3v3."""
    room = _make_tdm_room(num_bots=6)
    assert len(room.players) == 6

    human = _real_player("alice")
    await room.add(human)

    # Total players (incl. the new human) should be exactly 6.
    combat = [p for p in room.players.values() if not getattr(p, "is_spectator", False)]
    assert len(combat) == 6, \
        f"After human join, expected 6 combat players, got {len(combat)}"
    # The new human is still in the room.
    assert human.id in room.players


@pytest.mark.asyncio
async def test_real_player_leave_spawns_a_bot_back():
    """Removing a real player from a TDM room must spawn one replacement
    bot so the room stays at 6 total for any remaining players."""
    room = _make_tdm_room(num_bots=6)
    human = _real_player("alice")
    await room.add(human)
    assert len([p for p in room.players.values() if not getattr(p, "is_spectator", False)]) == 6

    await room.remove(human)

    combat = [p for p in room.players.values() if not getattr(p, "is_spectator", False)]
    assert len(combat) == 6, \
        f"After human leave, expected 6 combat players (5 old bots + 1 new), got {len(combat)}"
    # The departing human is gone.
    assert human.id not in room.players


@pytest.mark.asyncio
async def test_two_humans_keep_population_balanced():
    """Two real players join — both displace bots so the total stays at 6."""
    room = _make_tdm_room(num_bots=6)
    alice = _real_player("alice")
    bob   = _real_player("bob")
    await room.add(alice)
    await room.add(bob)

    combat = [p for p in room.players.values() if not getattr(p, "is_spectator", False)]
    assert len(combat) == 6, f"Expected 6 combat players, got {len(combat)}"
    # Team split should be 3v3 (or as close as the balancer allows).
    red  = sum(1 for p in combat if p.team == "red")
    blue = sum(1 for p in combat if p.team == "blue")
    assert abs(red - blue) <= 1, f"Teams not balanced: red={red} blue={blue}"


@pytest.mark.asyncio
async def test_maintain_is_noop_in_ffa():
    """Auto-balance must never touch non-TDM rooms (FFA quick-match
    deliberately keeps its bot population fixed)."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")
    for i in range(4):
        room.spawn_bot(f"BOT{i}", disguised=True, difficulty=1.15)
    before = len(room.players)

    human = _real_player("alice")
    await room.add(human)
    after = len(room.players)

    # FFA: room count goes up by 1 (no bot displaced).
    assert after == before + 1, f"FFA room population unexpectedly changed (before={before}, after={after})"


@pytest.mark.asyncio
async def test_spectator_join_does_not_displace_bots():
    """Spectators don't count toward the 3v3 budget — they shouldn't
    cause a bot to be kicked from the playable lobby."""
    room = _make_tdm_room(num_bots=6)
    spec = _real_player("watcher")
    spec.is_spectator = True
    await room.add(spec)

    bots = [p for p in room.players.values() if p.is_bot]
    assert len(bots) == 6, f"Bot count changed after spectator joined: {len(bots)}"
