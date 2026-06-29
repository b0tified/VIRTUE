"""Season-reset soft drop tests.

When a season rolls over, `maybe_reset_season` no longer zeroes every
player's RP — it subtracts 900 (9 sub-tiers × 100 RP) and clamps at 0,
keeping high-ranked players near the top of the ladder so they don't
have to grind from Bronze every month. Peak RP is still snapshotted
before the drop so the all-time high is preserved.
"""
import sys
import pathlib
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_season_reset_drops_900_rp_clamped_at_zero():
    """Set up users at 2400 / 450 / 50 RP, force the season to be over,
    then call `maybe_reset_season`. Expected post-reset RP: 1500, 0, 0.
    Peak RP must match the highest of (existing peak, prev rank)."""
    if server.db is None:
        pytest.skip("No mongo available")

    # Seed three users at varying RP. Use a unique seed_target so we
    # can identify + clean them up.
    test_marker = f"seasonreset_{ObjectId()}"
    users = [
        {"email": f"{test_marker}_a@t.test", "username": f"{test_marker}_a",
         "password_hash": "x", "rank_points": 2400, "peak_rank_points": 2400,
         "season_xp": 500, "claimed_season_tiers": [1, 2, 3],
         "placement_matches_played": 5, "_test_marker": test_marker},
        {"email": f"{test_marker}_b@t.test", "username": f"{test_marker}_b",
         "password_hash": "x", "rank_points": 450, "peak_rank_points": 700,
         "season_xp": 100, "_test_marker": test_marker},
        {"email": f"{test_marker}_c@t.test", "username": f"{test_marker}_c",
         "password_hash": "x", "rank_points": 50, "peak_rank_points": 0,
         "_test_marker": test_marker},
    ]
    for u in users:
        await server.db.users.insert_one(u)

    # Remember the original season doc so we can restore it after the test.
    orig_season = await server.db.meta.find_one({"_id": "season"})

    try:
        # Force season expiry by setting season_start to 31 days ago.
        past = datetime.now(timezone.utc) - timedelta(days=server.SEASON_LENGTH_DAYS + 1)
        await server.db.meta.update_one(
            {"_id": "season"},
            {"$set": {"season_start": past, "season_number": 99}},
            upsert=True,
        )

        await server.maybe_reset_season()

        # Re-read each user post-reset.
        a = await server.db.users.find_one({"_test_marker": test_marker, "username": users[0]["username"]})
        b = await server.db.users.find_one({"_test_marker": test_marker, "username": users[1]["username"]})
        c = await server.db.users.find_one({"_test_marker": test_marker, "username": users[2]["username"]})

        # GOONMASTER 2400 → 2400-900 = 1500 (MASTER III).
        assert a["rank_points"] == 1500, f"A: got {a['rank_points']}"
        assert a["peak_rank_points"] == 2400, f"A peak: got {a['peak_rank_points']}"
        # Pass progression cleared.
        assert a["season_xp"] == 0
        assert a["claimed_season_tiers"] == []
        assert a["placement_matches_played"] == 0

        # SILVER II 450 → 450-900 = clamped at 0 (BRONZE III).
        assert b["rank_points"] == 0, f"B: got {b['rank_points']}"
        # Peak should keep the existing 700 (higher than 450).
        assert b["peak_rank_points"] == 700, f"B peak: got {b['peak_rank_points']}"

        # BRONZE 50 → clamped at 0; peak was 0, climbs to 50 (the pre-reset RP).
        assert c["rank_points"] == 0, f"C: got {c['rank_points']}"
        assert c["peak_rank_points"] == 50, f"C peak: got {c['peak_rank_points']}"

    finally:
        # Cleanup: remove test users + restore season doc.
        await server.db.users.delete_many({"_test_marker": test_marker})
        if orig_season:
            orig_season.pop("_id", None)
            await server.db.meta.update_one(
                {"_id": "season"},
                {"$set": orig_season},
                upsert=True,
            )
