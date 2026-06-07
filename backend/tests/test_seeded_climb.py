"""Tests for the progressive seeded leaderboard climb.

The leaderboard seed (`/admin/seed/veterans`) used to insert each bot at
its *final* RP value. We now stash the final RP on the doc as
`seed_target_rp` and lerp the live `rank_points` (plus stats) from 0
toward that target across the 14-day season via `seeded_climb_loop`.
Per-bot offset/speed make the board reshuffle organically instead of
scaling uniformly.

These tests cover:
  - Mid-season ticks lerp `rank_points` between 0 and the target.
  - End-of-season ticks land exactly on the target.
  - Pre-season ticks (offset hasn't elapsed yet) keep the bot at 0 RP.
  - `placement_matches_played` rises with the lerped match count and
    clamps at PLACEMENT_MATCHES so the leaderboard filter picks the bot
    up once it has "played enough".
  - Legacy seeded docs (no `seed_target_rp`) are auto-migrated on first
    tick: their static RP becomes the target and they restart climbing.
"""
import sys
import pathlib
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)
    def __aiter__(self):
        self._it = iter(self.docs); return self
    async def __anext__(self):
        try: return next(self._it)
        except StopIteration: raise StopAsyncIteration


class _FakeUsers:
    """Minimal users collection stub. Holds a list of docs in memory and
    records every `update_one` call so the tests can assert the lerped
    field values."""
    def __init__(self, docs):
        self.docs = docs
        self.writes = []  # list of (filter, $set dict)

    def find(self, query, _proj=None):
        # Filter docs by simple equality on each key.
        def _match(d):
            for k, v in query.items():
                if isinstance(v, dict):
                    if "$exists" in v:
                        present = k in d
                        if v["$exists"] is True and not present:
                            return False
                        if v["$exists"] is False and present:
                            return False
                    continue
                if d.get(k) != v:
                    return False
            return True
        return _Cursor([d for d in self.docs if _match(d)])

    async def update_one(self, filt, update):
        set_doc = update.get("$set", {})
        self.writes.append((dict(filt), dict(set_doc)))
        for d in self.docs:
            if d.get("_id") == filt.get("_id"):
                for k, v in set_doc.items():
                    if "." in k:
                        parent, child = k.split(".", 1)
                        d.setdefault(parent, {})[child] = v
                    else:
                        d[k] = v


async def _one_tick(monkeypatch, season_start, users_docs):
    """Run exactly one body of `seeded_climb_loop` (skip the sleep loop)
    by extracting the inner work and re-implementing it inline against
    the same `server` helpers the loop uses."""
    fake_users = _FakeUsers(users_docs)
    monkeypatch.setattr(server.db, "users", fake_users)

    # Stub get_or_init_season so the loop sees our season_start.
    async def fake_get():
        return {"_id": "season", "season_number": 1, "season_start": season_start}
    monkeypatch.setattr(server, "get_or_init_season", fake_get)

    # Pull the loop coroutine and run a single iteration by patching
    # asyncio.sleep to immediately raise so the while-True breaks after
    # one cycle.
    import asyncio as _aio

    class _Break(Exception):
        pass

    async def fake_sleep(_):
        raise _Break()

    monkeypatch.setattr(_aio, "sleep", fake_sleep)
    try:
        await server.seeded_climb_loop()
    except _Break:
        pass
    return fake_users


@pytest.mark.asyncio
async def test_midseason_climb_lerps_partial_rp(monkeypatch):
    """7 days into a 14-day season should put a baseline-speed bot at
    ~50% of its target RP."""
    now = datetime.now(timezone.utc)
    season_start = now - timedelta(days=7)  # halfway

    doc = {
        "_id": "bot1",
        "is_seeded": True,
        "rank_points": 0,
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "seed_target_rp": 1000,
        "seed_target_matches": 80,
        "seed_target_kills": 240,
        "seed_target_deaths": 200,
        "seed_target_wins": 32,
        "seed_climb_offset": 0.0,  # start at season start
        "seed_climb_speed": 1.0,   # baseline pace
    }
    fake = await _one_tick(monkeypatch, season_start, [doc])
    assert fake.writes, "Expected the climb loop to write at least one update"
    updated = fake.docs[0]
    # ~50% of 1000 RP = 500, allow some slack for clock drift.
    assert 460 <= updated["rank_points"] <= 540, f"got {updated['rank_points']}"
    assert 30 <= updated["stats"]["matches"] <= 50
    # Past PLACEMENT_MATCHES → clamped to PLACEMENT_MATCHES so the
    # leaderboard filter picks the bot up.
    assert updated["placement_matches_played"] == server.PLACEMENT_MATCHES


@pytest.mark.asyncio
async def test_end_of_season_climb_lands_on_target(monkeypatch):
    """At the very end of the season, RP must converge to the target."""
    now = datetime.now(timezone.utc)
    season_start = now - timedelta(days=server.SEASON_LENGTH_DAYS + 1)

    doc = {
        "_id": "bot2",
        "is_seeded": True,
        "rank_points": 0,
        "stats": {},
        "seed_target_rp": 2500,
        "seed_target_matches": 200,
        "seed_target_kills": 800,
        "seed_target_deaths": 500,
        "seed_target_wins": 100,
        "seed_climb_offset": 0.0,
        "seed_climb_speed": 1.0,
    }
    fake = await _one_tick(monkeypatch, season_start, [doc])
    updated = fake.docs[0]
    assert updated["rank_points"] == 2500
    assert updated["stats"]["matches"] == 200
    assert updated["stats"]["kills"] == 800
    assert updated["placement_matches_played"] == server.PLACEMENT_MATCHES


@pytest.mark.asyncio
async def test_offset_keeps_bot_at_zero_before_their_start(monkeypatch):
    """A bot with `seed_climb_offset=0.5` shouldn't move until the season
    is half done — at 25% elapsed the offset hasn't been crossed yet so
    the lerp clamps to 0."""
    now = datetime.now(timezone.utc)
    season_start = now - timedelta(days=server.SEASON_LENGTH_DAYS * 0.25)

    doc = {
        "_id": "bot3",
        "is_seeded": True,
        "rank_points": 0,
        "stats": {},
        "seed_target_rp": 1200,
        "seed_target_matches": 50,
        "seed_target_kills": 100,
        "seed_target_deaths": 60,
        "seed_target_wins": 20,
        "seed_climb_offset": 0.5,
        "seed_climb_speed": 1.0,
    }
    fake = await _one_tick(monkeypatch, season_start, [doc])
    updated = fake.docs[0]
    assert updated["rank_points"] == 0
    # Match count also stays at 0 → placement also at 0 → leaderboard
    # filter EXCLUDES this bot until its offset elapses.
    assert updated["stats"].get("matches", 0) == 0
    assert updated["placement_matches_played"] == 0


@pytest.mark.asyncio
async def test_legacy_seeded_docs_are_auto_migrated(monkeypatch):
    """A pre-existing seeded doc without `seed_target_rp` should be
    converted on the loop's first pass: its static RP becomes the
    target, and (on subsequent ticks) it lerps from 0 again."""
    now = datetime.now(timezone.utc)
    season_start = now - timedelta(days=server.SEASON_LENGTH_DAYS * 0.5)

    legacy = {
        "_id": "legacy1",
        "is_seeded": True,
        "rank_points": 1800,
        "stats": {"kills": 600, "deaths": 400, "matches": 120, "wins": 50},
        # No seed_target_rp / climb fields — pre-feature doc.
    }
    fake = await _one_tick(monkeypatch, season_start, [legacy])
    migrated = fake.docs[0]
    # Migration must have stamped the target fields…
    assert migrated["seed_target_rp"] == 1800
    assert migrated["seed_target_matches"] == 120
    assert migrated["seed_target_kills"] == 600
    assert 0.0 <= migrated["seed_climb_offset"] <= 0.20
    assert 0.75 <= migrated["seed_climb_speed"] <= 1.35
    # …and the same tick's lerp pass should have written a partial RP
    # (we're 50% into the season, baseline speed). The legacy RP of
    # 1800 should now be re-pinned somewhere between 0 and 1800.
    assert 0 < migrated["rank_points"] <= 1800
