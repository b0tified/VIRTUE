"""Regression test — 2026-02-25.

User report: "Custom game only brings host into the game when bots are
disabled."

Root cause: `cleanup_party_room_if_empty` used to run immediately on
every WS disconnect. When the leader's Game.jsx mounted, StrictMode
(or any brief network hiccup) closed the socket a beat later, dropping
the room to 0 humans → the room was destroyed AND `match_starting`
was flipped back to False. The follower's next `/party/me` poll then
saw `match_starting=False` and never navigated.

With `bots_enabled=True` the same race exists but the room lived just
long enough through the reconnect for the follower's poll to catch a
True snapshot; with `bots_enabled=False` the room drops to exactly 0
players and dies faster.

Fix: `cleanup_party_room_if_empty` now schedules a delayed cleanup
(`PARTY_ROOM_CLEANUP_GRACE_SEC = 15s`) instead of tearing the room
down instantly. If a real player rejoins within the grace window,
the pending cleanup wakes up, sees the non-empty room, and bails.
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


class _FakePlayer:
    _counter = 0

    def __init__(self, *, is_bot: bool):
        _FakePlayer._counter += 1
        self.id = f"fk_{_FakePlayer._counter}"
        self.is_bot = is_bot
        self.is_spectator = False
        self.is_dummy = False
        self.team = "red"
        self.username = f"tester_{self.id}"


# ---------- static / grep guards ---------------------------------------


def test_cleanup_grace_constant_exists_and_positive():
    assert hasattr(srv, "PARTY_ROOM_CLEANUP_GRACE_SEC"), (
        "The grace-period constant must be defined at module level so "
        "future tuning happens in one place."
    )
    # Anything < ~10s risks racing the follower's 5s /party/me poll.
    # Anything > ~60s starts leaking dead rooms for minutes.
    assert 10.0 <= srv.PARTY_ROOM_CLEANUP_GRACE_SEC <= 60.0, (
        f"PARTY_ROOM_CLEANUP_GRACE_SEC={srv.PARTY_ROOM_CLEANUP_GRACE_SEC} "
        "is outside the sane 10-60s window."
    )


def test_cleanup_uses_delayed_task_not_inline_teardown():
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    marker = "async def cleanup_party_room_if_empty"
    assert marker in src
    body = src.split(marker, 1)[1][:4000]
    assert "asyncio.sleep(PARTY_ROOM_CLEANUP_GRACE_SEC)" in body, (
        "cleanup_party_room_if_empty must delay teardown via "
        "asyncio.sleep(PARTY_ROOM_CLEANUP_GRACE_SEC) — otherwise a "
        "brief WS disconnect (StrictMode / navigation hiccup) tears "
        "the room down before the follower's /party/me poll fires."
    )
    # And the delayed task must re-check emptiness before destroying —
    # a rejoin during the grace window must NOT get its room nuked.
    assert "grace-window rescue" in body or "current = PARTY_ROOMS.get(party_id)" in body


# ---------- runtime behaviour ------------------------------------------


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_cleanup_defers_teardown_when_empty():
    """A single call to cleanup_party_room_if_empty must NOT destroy
    the room synchronously — the delayed task owns the teardown."""
    party_id = "test_grace_defer"
    room = srv.GameRoom(is_ranked=False, match_duration=300.0, game_mode="ffa")
    room.is_party = True
    room.party_id = party_id
    srv.PARTY_ROOMS[party_id] = room
    srv.PARTIES[party_id] = {
        "party_id": party_id,
        "leader_id": "u1",
        "members": ["u1"],
        "match_starting": True,
        "bots_enabled": False,
    }
    try:
        _run(srv.cleanup_party_room_if_empty(party_id))
        # Synchronous state must be unchanged — cleanup is scheduled, not applied.
        assert party_id in srv.PARTY_ROOMS, (
            "cleanup_party_room_if_empty destroyed the room "
            "synchronously — that's the bug we're fixing."
        )
        assert srv.PARTIES[party_id]["match_starting"] is True, (
            "match_starting must NOT be flipped synchronously — "
            "otherwise the follower's next /party/me poll misses the "
            "auto-nav trigger."
        )
        assert party_id in srv._PARTY_ROOM_CLEANUP_TASKS, (
            "A grace-period task must be registered so a rejoin "
            "during the window can be detected."
        )
    finally:
        # Cancel the scheduled task so the test doesn't leave background
        # coroutines running past teardown.
        t = srv._PARTY_ROOM_CLEANUP_TASKS.pop(party_id, None)
        if t and not t.done():
            t.cancel()
        srv.PARTY_ROOMS.pop(party_id, None)
        srv.PARTIES.pop(party_id, None)


def test_rejoin_during_grace_saves_the_room():
    """A real player joining during the grace window must rescue the
    room — the delayed cleanup should detect the non-empty room and
    bail without destroying it."""
    party_id = "test_grace_rejoin"
    room = srv.GameRoom(is_ranked=False, match_duration=300.0, game_mode="ffa")
    room.is_party = True
    room.party_id = party_id
    srv.PARTY_ROOMS[party_id] = room
    srv.PARTIES[party_id] = {
        "party_id": party_id,
        "leader_id": "u1",
        "members": ["u1"],
        "match_starting": True,
        "bots_enabled": False,
    }
    # Monkey-patch the grace window to something tiny so the test
    # finishes fast without waiting 15 real seconds.
    original = srv.PARTY_ROOM_CLEANUP_GRACE_SEC
    srv.PARTY_ROOM_CLEANUP_GRACE_SEC = 0.3
    try:
        async def scenario():
            await srv.cleanup_party_room_if_empty(party_id)
            # Rejoin BEFORE the grace expires.
            await asyncio.sleep(0.05)
            room.players["rejoin"] = _FakePlayer(is_bot=False)
            # Wait past the grace window so the delayed task wakes up.
            await asyncio.sleep(0.6)

        _run(scenario())

        assert party_id in srv.PARTY_ROOMS, (
            "Rejoin during grace must rescue the room — the delayed "
            "cleanup should detect the non-empty room on wake-up "
            "and bail without popping it from PARTY_ROOMS."
        )
        assert srv.PARTIES[party_id]["match_starting"] is True, (
            "match_starting must still be True after a rescue — "
            "otherwise the follower's poll misses the auto-nav trigger."
        )
    finally:
        srv.PARTY_ROOM_CLEANUP_GRACE_SEC = original
        srv._PARTY_ROOM_CLEANUP_TASKS.pop(party_id, None)
        srv.PARTY_ROOMS.pop(party_id, None)
        srv.PARTIES.pop(party_id, None)


def test_true_empty_room_still_gets_destroyed_after_grace():
    """Sanity: a room that stays empty for the full grace period
    must eventually be destroyed and match_starting flipped to False
    so the party UI returns to the lobby state."""
    party_id = "test_grace_expiry"
    room = srv.GameRoom(is_ranked=False, match_duration=300.0, game_mode="ffa")
    room.is_party = True
    room.party_id = party_id
    srv.PARTY_ROOMS[party_id] = room
    srv.PARTIES[party_id] = {
        "party_id": party_id,
        "leader_id": "u1",
        "members": ["u1"],
        "match_starting": True,
        "bots_enabled": False,
    }
    original = srv.PARTY_ROOM_CLEANUP_GRACE_SEC
    srv.PARTY_ROOM_CLEANUP_GRACE_SEC = 0.2
    try:
        async def scenario():
            await srv.cleanup_party_room_if_empty(party_id)
            await asyncio.sleep(0.5)  # past the (patched) grace window

        _run(scenario())

        assert party_id not in srv.PARTY_ROOMS, (
            "A truly abandoned party room must be destroyed after "
            "the grace window elapses."
        )
        assert srv.PARTIES[party_id]["match_starting"] is False, (
            "match_starting must reset to False so the party UI "
            "returns to the lobby state after real cleanup."
        )
        assert party_id not in srv._PARTY_ROOM_CLEANUP_TASKS, (
            "The scheduled task must remove itself from the tracker "
            "dict so we don't leak entries per abandoned party."
        )
    finally:
        srv.PARTY_ROOM_CLEANUP_GRACE_SEC = original
        srv._PARTY_ROOM_CLEANUP_TASKS.pop(party_id, None)
        srv.PARTY_ROOMS.pop(party_id, None)
        srv.PARTIES.pop(party_id, None)
