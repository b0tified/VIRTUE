"""Regression test for the season-pass reset on rollover.

User report: "reset season pass level and make sure it resets after the
countdown ends".

Pre-fix bug: when `maybe_reset_season()` fired at end-of-season it only
zeroed `rank_points` + `placement_matches_played`. Pass progression
(`season_xp`, `claimed_season_tiers`) was left intact, so every player
walked into the new season already at last-season's pass level with all
the milestone rewards greyed out as "claimed".

Fix under test:
  - `maybe_reset_season()` now also resets `season_xp` to 0 and clears
    `claimed_season_tiers`. Owned skins (`owned_skins`) are left alone
    so cosmetics already granted stay in the inventory.
  - A new admin-only endpoint `POST /admin/season/reset_pass` lets
    admins fire a soft pass-only reset without bumping the season
    number (useful when the live pass needs to be wiped early).
"""
import sys
import pathlib
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_maybe_reset_season_wipes_pass_progression(monkeypatch):
    """When the season clock expires, `maybe_reset_season` must zero
    `season_xp` and `claimed_season_tiers` in the user.update_many
    payload — otherwise players walk into the new season already maxed
    out on the pass."""
    captured = {}

    class _Meta:
        async def find_one(self, _):
            # Season 1 has elapsed (started 999 days ago).
            return {
                "_id": "season",
                "season_number": 1,
                "season_start": datetime.now(timezone.utc) - timedelta(days=999),
            }
        async def insert_one(self, _): pass
        async def update_one(self, *_): pass

    class _Users:
        async def update_many(self, query, update):
            captured["query"] = query
            captured["update"] = update

    async def _noop_archive(*a, **k):
        return None

    monkeypatch.setattr(server.db, "meta", _Meta())
    monkeypatch.setattr(server.db, "users", _Users())
    monkeypatch.setattr(server, "_archive_season_top_100", _noop_archive)

    await server.maybe_reset_season()

    # The update_many call must reset BOTH rank and pass fields.
    set_ops = captured["update"][0]["$set"]
    assert set_ops["rank_points"] == 0, "rank_points must be zeroed on rollover"
    assert set_ops["placement_matches_played"] == 0, "placement_matches_played must be zeroed"
    assert set_ops["season_xp"] == 0, \
        "season_xp must be zeroed on rollover (otherwise pass level carries over)"
    assert set_ops["claimed_season_tiers"] == [], \
        "claimed_season_tiers must be cleared (otherwise milestone rewards stay greyed)"
    # `owned_skins` MUST NOT appear in the $set — cosmetics players
    # earned last season should stay in their inventory.
    assert "owned_skins" not in set_ops, \
        "owned_skins must NOT be wiped — players keep cosmetics they already earned"


@pytest.mark.asyncio
async def test_reset_does_not_fire_before_countdown_ends(monkeypatch):
    """Sanity check the other half of the user's request — the reset
    must NOT fire when the season is still live. A fresh season doc
    with `season_start = now` should leave both the rank fields AND
    the pass fields untouched."""
    captured = {}

    class _Meta:
        async def find_one(self, _):
            return {
                "_id": "season",
                "season_number": 1,
                "season_start": datetime.now(timezone.utc),  # just started
            }
        async def insert_one(self, _): pass
        async def update_one(self, *_):
            captured["meta_updated"] = True

    class _Users:
        async def update_many(self, *_):
            captured["users_updated"] = True

    monkeypatch.setattr(server.db, "meta", _Meta())
    monkeypatch.setattr(server.db, "users", _Users())

    doc = await server.maybe_reset_season()

    # Neither collection should have been touched — the timer hasn't
    # expired yet, so the no-op return path runs.
    assert captured.get("users_updated") is not True
    assert captured.get("meta_updated") is not True
    assert doc["season_number"] == 1
