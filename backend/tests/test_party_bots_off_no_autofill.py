"""Regression test — 2026-02-25.

User report: "The option to disable bots for custom games in parties
does not work."

Root cause: `GameRoom._maintain_population` auto-fills every casual FFA
room up to `FFA_LOBBY_SIZE` on every tick. `get_or_create_party_room`
seeded the room with 0 bots when the leader toggled BOTS OFF, but the
tick loop immediately backfilled bots on the very next call to
`_maintain_population` (triggered by any add / end_match / reset).

Fix: propagate `party["bots_enabled"]` to `GameRoom.bots_enabled` and
early-return from `_maintain_population` when the flag is False.

These tests hit the fix from two angles:
  1. Static grep guards — the propagation + early-return must exist
     so a future refactor can't quietly undo the fix.
  2. Runtime behaviour — spin up an actual GameRoom with
     `bots_enabled=False`, add a single real player, and confirm
     `_maintain_population` does NOT top the room off to
     `FFA_LOBBY_SIZE`.
"""
import asyncio
import pathlib
import sys
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


# ---------- static / grep guards ---------------------------------------


def test_gameroom_defaults_bots_enabled_true():
    """Default preserves legacy behaviour — every non-party room type
    still auto-fills like before this fix."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0)
    assert room.bots_enabled is True, (
        "GameRoom.bots_enabled must default to True — only party rooms "
        "with the toggle OFF should ever set it to False."
    )


def test_maintain_population_early_returns_when_bots_disabled():
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    # The guard must live inside `_maintain_population`. Anchor on the
    # function header so an unrelated `bots_enabled` check elsewhere
    # can't satisfy this assertion.
    marker = "def _maintain_population(self)"
    assert marker in src
    body = src.split(marker, 1)[1][:3000]
    assert "if not self.bots_enabled:" in body, (
        "`_maintain_population` must skip the bot-fill branch when "
        "`self.bots_enabled` is False — otherwise the tick loop "
        "backfills a party room the leader wanted human-only."
    )


def test_party_room_helper_propagates_bots_enabled():
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    marker = "async def get_or_create_party_room"
    assert marker in src
    body = src.split(marker, 1)[1][:3500]
    assert "room.bots_enabled = bots_enabled" in body, (
        "`get_or_create_party_room` must propagate the party's "
        "`bots_enabled` flag to the newly-created GameRoom so the "
        "tick loop knows to skip auto-fill."
    )


# ---------- runtime behaviour ------------------------------------------


class _FakePlayer:
    """Minimal Player stand-in — `_maintain_population` only reads
    `is_bot`, `team`, `is_spectator`, `is_dummy`, `username`, `id`.
    Bypasses the real Player constructor so we don't need a live WS."""

    _counter = 0

    def __init__(self, *, is_bot: bool, team: str = "red"):
        _FakePlayer._counter += 1
        self.id = f"fake_{_FakePlayer._counter}"
        self.is_bot = is_bot
        self.is_spectator = False
        self.is_dummy = False
        self.team = team
        self.username = f"tester_{self.id}"


def test_maintain_population_skips_fill_when_bots_disabled_runtime():
    """The whole point of the fix — a party room with bots_enabled=False
    and 1 real player MUST NOT get backfilled to FFA_LOBBY_SIZE by
    the tick loop."""
    room = srv.GameRoom(is_ranked=False, match_duration=300.0, game_mode="ffa")
    room.is_party = True
    room.party_id = "test_party"
    room.bots_enabled = False

    # Seed with a single "human" — mirrors the leader joining their
    # own private lobby.
    real = _FakePlayer(is_bot=False)
    room.players[real.id] = real

    before = len(room.players)
    room._maintain_population()
    after = len(room.players)

    assert after == before, (
        f"Bots-disabled party room got backfilled: went from "
        f"{before} -> {after} players. Expected no change."
    )
    # Belt & suspenders — no bot should have been spawned at all.
    bots_after = sum(1 for p in room.players.values() if p.is_bot)
    assert bots_after == 0, (
        f"Bots-disabled party room ended with {bots_after} bots — "
        "the early-return in `_maintain_population` is missing or "
        "not firing."
    )


def test_maintain_population_still_fills_when_bots_enabled_runtime():
    """Sanity: the fix must not break the default auto-fill behaviour.
    A normal casual FFA room (bots_enabled=True) with 1 real player
    should still top up to `FFA_LOBBY_SIZE`."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")
    assert room.bots_enabled is True  # default preserved

    real = _FakePlayer(is_bot=False)
    room.players[real.id] = real

    room._maintain_population()

    total = len(room.players)
    assert total == srv.FFA_LOBBY_SIZE, (
        f"Casual FFA auto-fill regressed: expected {srv.FFA_LOBBY_SIZE} "
        f"players after _maintain_population, got {total}."
    )


def test_get_or_create_party_room_refreshes_toggle_on_cache_hit():
    """Edge case flagged by the testing agent — the PARTY_ROOMS cache
    must honour a re-toggled `bots_enabled` when the room is still
    alive from a previous /party/start. Without this refresh a
    still-cached room keeps its old fill bots after the leader
    flipped BOTS OFF.
    """
    party_id = "test_refresh_party"
    # Seed a cached room in BOTS-ON state with some fake bots.
    room = srv.GameRoom(is_ranked=False, match_duration=300.0, game_mode="ffa")
    room.is_party = True
    room.party_id = party_id
    room.bots_enabled = True
    room.players["b1"] = _FakePlayer(is_bot=True)
    room.players["b2"] = _FakePlayer(is_bot=True)
    room.players["h1"] = _FakePlayer(is_bot=False)
    srv.PARTY_ROOMS[party_id] = room
    # Party record now flipped to BOTS OFF.
    srv.PARTIES[party_id] = {
        "party_id": party_id,
        "leader_id": "u1",
        "members": ["u1"],
        "bots_enabled": False,
        "tdm": False,
        "match_starting": True,
    }
    try:
        got = asyncio.get_event_loop().run_until_complete(
            srv.get_or_create_party_room(party_id)
        )
        assert got is room, "Cache-hit must return the same room instance."
        assert got.bots_enabled is False, (
            "Cache-hit path must refresh room.bots_enabled from the "
            "party record — otherwise a re-toggle is silently ignored."
        )
        remaining_bots = [p for p in got.players.values() if p.is_bot]
        assert remaining_bots == [], (
            f"Cache-hit path must despawn existing bots when the flag "
            f"flipped to False. Leftover bots: {[p.username for p in remaining_bots]}"
        )
        # Real player untouched.
        assert "h1" in got.players
    finally:
        srv.PARTY_ROOMS.pop(party_id, None)
        srv.PARTIES.pop(party_id, None)
