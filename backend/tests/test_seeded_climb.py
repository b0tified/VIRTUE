"""Tests for the progressive seeded leaderboard climb.

The leaderboard seed (`/admin/seed/veterans`) used to insert each bot at
its *final* RP value. We now stash the final RP on the doc as
`seed_target_rp` and lerp the live `rank_points` (plus stats) from 0
toward that target across the season via `seeded_climb_loop`.
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
    """Halfway through the season should put a baseline-speed bot at
    ~50% of its target RP — and crucially, the RP value must be a
    multiple of 15 (only RP values reachable via ranked match deltas
    of +30/+15/0/-30/-60)."""
    now = datetime.now(timezone.utc)
    season_start = now - timedelta(days=server.SEASON_LENGTH_DAYS * 0.5)

    doc = {
        "_id": "bot1",
        "is_seeded": True,
        "rank_points": 0,
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "seed_target_rp": 1005,  # multiple of 15
        "seed_target_matches": 80,
        "seed_target_kills": 240,
        "seed_target_deaths": 200,
        "seed_target_wins": 36,  # >= ceil(1005/30) = 34
        "seed_career_v2": True,
        "seed_climb_offset": 0.0,  # start at season start
        "seed_climb_speed": 1.0,   # baseline pace
    }
    fake = await _one_tick(monkeypatch, season_start, [doc])
    assert fake.writes, "Expected the climb loop to write at least one update"
    updated = fake.docs[0]
    # ~50% of 1005 RP = 502.5, snapped to nearest 15 → 495 or 510.
    assert 480 <= updated["rank_points"] <= 540, f"got {updated['rank_points']}"
    # RP MUST land on the match grid (multiple of 15).
    assert updated["rank_points"] % 15 == 0, \
        f"RP {updated['rank_points']} is not a multiple of 15"
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
        "seed_target_rp": 2490,  # multiple of 15
        "seed_target_matches": 200,
        "seed_target_kills": 800,
        "seed_target_deaths": 500,
        "seed_target_wins": 100,  # >= ceil(2490/30) = 83
        "seed_career_v2": True,
        "seed_climb_offset": 0.0,
        "seed_climb_speed": 1.0,
    }
    fake = await _one_tick(monkeypatch, season_start, [doc])
    updated = fake.docs[0]
    assert updated["rank_points"] == 2490
    assert updated["rank_points"] % 15 == 0
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
        "seed_target_wins": 40,  # >= ceil(1200/30) = 40
        "seed_career_v2": True,
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
    converted on the loop's first pass: its static RP is snapped to the
    match grid (multiples of 15) and stat targets are re-synthesized
    via `_synthesize_career` so wins/matches actually justify the RP."""
    now = datetime.now(timezone.utc)
    season_start = now - timedelta(days=server.SEASON_LENGTH_DAYS * 0.5)

    legacy = {
        "_id": "legacy1",
        "is_seeded": True,
        "rank_points": 1798,  # off-grid value (was real pre-snap seed)
        "stats": {"kills": 600, "deaths": 400, "matches": 120, "wins": 50},
        # No seed_target_rp / climb fields — pre-feature doc.
    }
    fake = await _one_tick(monkeypatch, season_start, [legacy])
    migrated = fake.docs[0]
    # Snapped to the match grid.
    assert migrated["seed_target_rp"] % 15 == 0
    assert migrated["seed_target_rp"] == 1785  # 1798 floors to 1785
    # Wins target must satisfy the arithmetic floor (ceil(rp/30)).
    assert migrated["seed_target_wins"] >= (1785 + 29) // 30
    # Match target should comfortably exceed wins (room for losses).
    assert migrated["seed_target_matches"] >= migrated["seed_target_wins"]
    assert 0.0 <= migrated["seed_climb_offset"] <= 0.20
    assert 0.75 <= migrated["seed_climb_speed"] <= 1.35
    assert migrated.get("seed_career_v2") is True
    # The same tick's lerp pass also writes a partial RP (50% in,
    # baseline speed), still snapped to multiples of 15.
    assert 0 < migrated["rank_points"] <= 1785
    assert migrated["rank_points"] % 15 == 0


@pytest.mark.asyncio
async def test_v2_resnap_fixes_legacy_off_grid_targets(monkeypatch):
    """A seed migrated by the v1 logic (static RP, mismatched stats)
    should be re-snapped + re-synthesized by the v2 pass on next tick."""
    now = datetime.now(timezone.utc)
    season_start = now - timedelta(days=server.SEASON_LENGTH_DAYS * 0.5)

    # Off-grid RP and wins below the arithmetic floor of ceil(2578/30)=86.
    pre_v2 = {
        "_id": "old_seed",
        "is_seeded": True,
        "rank_points": 100,
        "stats": {"kills": 50, "deaths": 30, "matches": 10, "wins": 5},
        "seed_target_rp": 2578,
        "seed_target_matches": 30,
        "seed_target_kills": 90,
        "seed_target_deaths": 60,
        "seed_target_wins": 12,  # impossibly low for RP=2578
        "seed_climb_offset": 0.1,
        "seed_climb_speed": 1.0,
    }
    fake = await _one_tick(monkeypatch, season_start, [pre_v2])
    updated = fake.docs[0]
    # RP must be snapped onto the grid.
    assert updated["seed_target_rp"] % 15 == 0
    assert updated["seed_target_rp"] == 2565  # 2578 floors to 2565
    # Wins target must now justify the new target RP.
    assert updated["seed_target_wins"] >= (2565 + 29) // 30
    assert updated["seed_target_matches"] >= updated["seed_target_wins"]
    assert updated.get("seed_career_v2") is True


@pytest.mark.asyncio
async def test_v2_pass_skips_already_consistent_seeds(monkeypatch):
    """A seed whose `seed_target_rp` is already grid-aligned AND whose
    wins target already exceeds ceil(rp/30) should NOT have its target
    stats overwritten by the v2 pass — only the `seed_career_v2` flag
    should be stamped so future ticks skip the migration filter."""
    now = datetime.now(timezone.utc)
    season_start = now - timedelta(days=server.SEASON_LENGTH_DAYS * 0.5)

    clean = {
        "_id": "clean_seed",
        "is_seeded": True,
        "rank_points": 0,
        "stats": {},
        "seed_target_rp": 1500,  # multiple of 15
        "seed_target_matches": 90,
        "seed_target_kills": 270,
        "seed_target_deaths": 180,
        "seed_target_wins": 60,  # >= ceil(1500/30) = 50
        "seed_climb_offset": 0.05,
        "seed_climb_speed": 1.0,
    }
    fake = await _one_tick(monkeypatch, season_start, [clean])
    updated = fake.docs[0]
    # Stat targets unchanged.
    assert updated["seed_target_rp"] == 1500
    assert updated["seed_target_matches"] == 90
    assert updated["seed_target_kills"] == 270
    assert updated["seed_target_deaths"] == 180
    assert updated["seed_target_wins"] == 60
    # But the v2 marker IS stamped.
    assert updated.get("seed_career_v2") is True


def test_snap_rp_floors_to_multiple_of_15():
    """Spot-checks for the RP grid snap helper."""
    assert server._snap_rp_to_match_grid(0) == 0
    assert server._snap_rp_to_match_grid(14) == 0
    assert server._snap_rp_to_match_grid(15) == 15
    assert server._snap_rp_to_match_grid(29) == 15
    assert server._snap_rp_to_match_grid(30) == 30
    assert server._snap_rp_to_match_grid(423) == 420
    assert server._snap_rp_to_match_grid(2578) == 2565
    assert server._snap_rp_to_match_grid(3200) == 3195
    # Negative inputs floor to 0 — no negative RP on the leaderboard.
    assert server._snap_rp_to_match_grid(-5) == 0


def test_synthesize_career_enforces_wins_floor():
    """`_synthesize_career` must produce a tuple where wins>=ceil(rp/30)
    and matches>=wins, at every rank tier."""
    import random as _r
    _r.seed(42)  # deterministic for the test
    for rp in (0, 15, 90, 240, 480, 780, 1185, 1500, 2280, 3195):
        tier_idx, _ = server.rank_for_points(rp)
        matches, kills, deaths, wins = server._synthesize_career(rp, tier_idx)
        min_wins = max(1, (rp + 29) // 30) if rp > 0 else 1
        assert wins >= min_wins, \
            f"rp={rp}: got wins={wins}, expected >= {min_wins}"
        assert matches >= wins, \
            f"rp={rp}: matches={matches} < wins={wins} (impossible)"
        assert kills >= 0 and deaths >= 1
