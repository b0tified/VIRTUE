"""Regression tests for the FFA lobby cap.

User request:
  > make it so in ffa all modes its caps lobby at 4 players and removes
  > unneeded bots

Fix under test:
  - `FFA_LOBBY_SIZE = 4` constant.
  - `_maintain_population` generalised so FFA rooms despawn excess bots
    on real-player join and respawn replacements on real-player leave.
  - Hooked into `GameRoom.add` and `GameRoom.remove` (both `is_offline`
    exempt — those have per-user rosters).
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


def _make_ffa_room(num_bots: int = srv.FFA_LOBBY_SIZE, is_ranked: bool = False, is_practice: bool = False):
    room = srv.GameRoom(is_ranked=is_ranked, match_duration=60.0, game_mode="ffa")
    if is_practice:
        room.is_practice = True
    for i in range(num_bots):
        room.spawn_bot(f"BOT{i}", disguised=True, difficulty=1.15)
    return room


@pytest.mark.asyncio
async def test_ffa_constant_is_four():
    assert srv.FFA_LOBBY_SIZE == 4, "FFA cap should be 4 per user request"


@pytest.mark.asyncio
async def test_real_player_join_despawns_bot_when_over_cap():
    """FFA room seeded at the cap. One human joins → one bot is despawned
    so the total stays at FFA_LOBBY_SIZE."""
    room = _make_ffa_room(num_bots=srv.FFA_LOBBY_SIZE)
    assert len(room.players) == srv.FFA_LOBBY_SIZE

    alice = _real_player("alice")
    await room.add(alice)

    combat = [p for p in room.players.values() if not getattr(p, "is_spectator", False)]
    assert len(combat) == srv.FFA_LOBBY_SIZE, \
        f"FFA cap broken: expected {srv.FFA_LOBBY_SIZE} combat players, got {len(combat)}"
    assert alice.id in room.players


@pytest.mark.asyncio
async def test_multiple_humans_keep_lobby_at_cap():
    """Three humans joining a 4-bot FFA room must displace three bots so
    the total stays at exactly FFA_LOBBY_SIZE."""
    room = _make_ffa_room(num_bots=srv.FFA_LOBBY_SIZE)
    for nm in ("alice", "bob", "carol"):
        await room.add(_real_player(nm))

    combat = [p for p in room.players.values() if not getattr(p, "is_spectator", False)]
    assert len(combat) == srv.FFA_LOBBY_SIZE
    humans = [p for p in combat if not p.is_bot]
    assert len(humans) == 3


@pytest.mark.asyncio
async def test_real_player_leave_respawns_bot():
    """When a human leaves an FFA room, a replacement bot must spawn so
    the cap is preserved for whoever's still in the lobby."""
    room = _make_ffa_room(num_bots=srv.FFA_LOBBY_SIZE)
    alice = _real_player("alice")
    bob = _real_player("bob")
    await room.add(alice)
    await room.add(bob)

    # 2 humans + 2 bots = 4 total at this point.
    assert sum(1 for p in room.players.values() if not p.is_bot) == 2

    await room.remove(bob)

    combat = [p for p in room.players.values() if not getattr(p, "is_spectator", False)]
    assert len(combat) == srv.FFA_LOBBY_SIZE, \
        f"After bob left, expected {srv.FFA_LOBBY_SIZE} players, got {len(combat)}"
    # alice is still in.
    assert alice.id in room.players
    assert bob.id not in room.players


@pytest.mark.asyncio
async def test_ffa_practice_room_does_not_respawn_bots():
    """Practice rooms (with their fixed dummy roster) must NOT auto-spawn
    new combat bots when a player leaves — that would change the docile
    "shoot the dummies" feel of practice."""
    room = _make_ffa_room(num_bots=2, is_practice=True)
    # Mark seed bots as dummies, like the real practice_room does.
    for bot in list(room.players.values()):
        bot.is_dummy = True

    alice = _real_player("alice")
    await room.add(alice)
    # 1 human + 2 dummies = 3 total. Under cap → no displacement.
    assert len(room.players) == 3

    await room.remove(alice)
    # Practice room must NOT spawn additional combat bots when human leaves.
    bots = [p for p in room.players.values() if p.is_bot]
    assert len(bots) == 2, f"Practice room respawned bots: {len(bots)} (expected 2 dummies)"


@pytest.mark.asyncio
async def test_offline_room_is_exempt_from_cap():
    """Per-user offline FFA rooms have a fixed bot roster — the join/leave
    auto-balance hook must skip them entirely."""
    room = _make_ffa_room(num_bots=3)
    room.is_offline = True

    # Seed at 3 bots. Add a human — without the offline exemption, the
    # join hook would either no-op (already at cap=4 with bot) or… etc.
    # Either way, removing the human shouldn't change the bot count.
    alice = _real_player("alice")
    await room.add(alice)
    await room.remove(alice)

    bots = [p for p in room.players.values() if p.is_bot]
    assert len(bots) == 3, f"Offline room population changed: {len(bots)} (expected 3)"


@pytest.mark.asyncio
async def test_dummies_are_kept_when_combat_bots_available():
    """When FFA practice has both dummies AND a combat bot, the cap
    should despawn the combat bot first so the docile training targets
    survive."""
    room = _make_ffa_room(num_bots=0, is_practice=True)
    d1 = room.spawn_bot("DUMMY-A", disguised=False, difficulty=1.0)
    d1.is_dummy = True
    d2 = room.spawn_bot("DUMMY-B", disguised=False, difficulty=1.0)
    d2.is_dummy = True
    room.spawn_bot("COMBAT-1", disguised=True, difficulty=1.15)
    room.spawn_bot("COMBAT-2", disguised=True, difficulty=1.15)
    # 4 bots now (2 dummies + 2 combat). Add 2 humans → 6 total → must
    # drop to FFA_LOBBY_SIZE=4 by removing 2 bots; dummies should survive.
    await room.add(_real_player("alice"))
    await room.add(_real_player("bob"))

    bots = [p for p in room.players.values() if p.is_bot]
    dummies_left = [b for b in bots if getattr(b, "is_dummy", False)]
    assert len(dummies_left) == 2, \
        f"Dummies were despawned before combat bots: {len(dummies_left)} remaining"


@pytest.mark.asyncio
async def test_welcome_payload_includes_game_mode():
    """The server welcome must include `game_mode` so the loading screen
    can swap its subtitle to FFA / TDM after the server flips its coin."""
    room = _make_ffa_room(num_bots=2)
    # Capture the welcome payload via a fake WS.
    class _WS:
        def __init__(self):
            self.payloads = []
        async def send_text(self, txt):
            import json as _json
            self.payloads.append(_json.loads(txt))
        async def close(self, code=1000):
            pass

    ws = _WS()
    # Use the same shim the other test files use to dodge the Player
    # constructor's user-dict requirement.
    alice = _real_player("alice")
    alice.ws = ws
    await room.add(alice)

    welcomes = [m for m in ws.payloads if m.get("type") == "welcome"]
    assert welcomes, "No welcome payload was sent"
    w = welcomes[0]
    assert w.get("game_mode") == "ffa", f"welcome.game_mode should be 'ffa' got {w.get('game_mode')!r}"
    assert "is_practice" in w
