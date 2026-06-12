"""Auto-claim sweep for daily challenges on /progression.

`_auto_claim_completed_dailies` is invoked at the top of the
`/progression` endpoint. Any daily challenge whose progress has met
its goal — but which the user hasn't claimed yet — should be claimed
automatically in a single batched Mongo write (coins + season_xp $inc,
plus a $set on the `daily_state.claimed` map). The endpoint then
returns the freshly-claimed list in `daily.auto_claimed` so the lobby
UI can show "+50 coins · +30 XP — Massacre, Hat Trick" without the
player tapping a Claim button.
"""
import sys
import pathlib
from typing import Any, Dict, List

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


class _FakeUsers:
    """Stub that captures every update_one call for assertions."""
    def __init__(self):
        self.updates: List[tuple] = []  # (filt, ops)

    async def update_one(self, filt, ops):
        self.updates.append((dict(filt), {k: dict(v) for k, v in ops.items()}))


@pytest.mark.asyncio
async def test_auto_claim_credits_coins_and_xp_in_one_write(monkeypatch):
    """A user with TWO completed-but-unclaimed dailies should get a
    single batched update_one whose $inc carries the SUM of both
    rewards. The returned list reflects both newly-claimed challenges."""
    fake = _FakeUsers()
    monkeypatch.setattr(server.db, "users", fake)

    # Pick the first two challenges from the pool whose goals are easy
    # to satisfy via the snapshot (kills/matches/etc.).
    ch1 = server.DAILY_CHALLENGES_POOL[0]
    ch2 = server.DAILY_CHALLENGES_POOL[1]

    user: Dict[str, Any] = {
        "_id": "u1",
        # Stats high enough to clear ANY challenge goal in the pool.
        "stats": {"kills": 1000, "deaths": 100, "matches": 1000, "wins": 500},
        "coins": 100,
        "season_xp": 200,
    }
    daily_state = {
        "date": "2026-06-07",
        "challenges": [ch1["id"], ch2["id"]],
        "claimed": {},
        "snapshot": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
    }
    newly = await server._auto_claim_completed_dailies(user, daily_state)

    # Both challenges claimed.
    assert len(newly) == 2
    assert {n["id"] for n in newly} == {ch1["id"], ch2["id"]}

    # Exactly one Mongo write — batching invariant.
    assert len(fake.updates) == 1
    _filt, ops = fake.updates[0]
    expected_coins = int(ch1.get("coins", 0)) + int(ch2.get("coins", 0))
    expected_xp = int(ch1.get("season_xp", 0)) + int(ch2.get("season_xp", 0))
    assert ops["$inc"]["coins"] == expected_coins
    assert ops["$inc"]["season_xp"] == expected_xp

    # In-memory state was mirrored so the caller can keep using it
    # without re-reading the user from Mongo.
    assert daily_state["claimed"][ch1["id"]] is True
    assert daily_state["claimed"][ch2["id"]] is True
    assert user["coins"] == 100 + expected_coins
    assert user["season_xp"] == 200 + expected_xp


@pytest.mark.asyncio
async def test_auto_claim_noop_when_no_challenge_completed(monkeypatch):
    """If nothing is completed the helper must NOT issue a Mongo
    write — it's a pure read on a hot endpoint."""
    fake = _FakeUsers()
    monkeypatch.setattr(server.db, "users", fake)

    ch1 = server.DAILY_CHALLENGES_POOL[0]
    user = {
        "_id": "u1",
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "coins": 0,
        "season_xp": 0,
    }
    daily_state = {
        "date": "2026-06-07",
        "challenges": [ch1["id"]],
        "claimed": {},
        # Snapshot identical to current stats → progress is 0.
        "snapshot": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
    }
    newly = await server._auto_claim_completed_dailies(user, daily_state)

    assert newly == []
    assert fake.updates == []  # NO write
    assert daily_state["claimed"] == {}


@pytest.mark.asyncio
async def test_auto_claim_skips_already_claimed(monkeypatch):
    """A challenge that was claimed in a PREVIOUS sweep (already in the
    `claimed` map) must not be re-credited even if it's still
    completed."""
    fake = _FakeUsers()
    monkeypatch.setattr(server.db, "users", fake)

    ch1 = server.DAILY_CHALLENGES_POOL[0]
    user = {
        "_id": "u1",
        "stats": {"kills": 1000, "matches": 1000, "wins": 500, "deaths": 100},
        "coins": 500,
        "season_xp": 700,
    }
    daily_state = {
        "date": "2026-06-07",
        "challenges": [ch1["id"]],
        "claimed": {ch1["id"]: True},  # already claimed
        "snapshot": {"kills": 0, "matches": 0, "wins": 0, "deaths": 0},
    }
    newly = await server._auto_claim_completed_dailies(user, daily_state)

    assert newly == []
    assert fake.updates == []
    # Coins/xp untouched.
    assert user["coins"] == 500
    assert user["season_xp"] == 700
