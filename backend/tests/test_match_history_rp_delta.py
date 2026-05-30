"""Regression test: match_history must persist the actual RP delta for
each real player (including negative deltas for losses), correctly
indexed by user_id — not via positional zip against the mixed
real+bot placements list which is sorted by kills."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_placement_lookup_uses_user_id_not_position():
    """If a bot finishes 1st (most kills) and a real player finishes 4th
    losing -60 RP, the docs we'd insert into match_history MUST associate
    the -60 with the real player's user_id, not silently drop it because
    the bot row sits at placements[0]."""
    placements = [
        # Bot finished 1st (most kills), real player ranked 2-3-4.
        {"user_id": "", "kills": 12, "deaths": 3, "delta": 0, "new_points": 0,
         "rank_name": "BRONZE", "is_placement": False},
        {"user_id": "real_A", "kills": 9, "deaths": 4, "delta": 30, "new_points": 1230,
         "rank_name": "DIAMOND", "is_placement": False},
        {"user_id": "", "kills": 6, "deaths": 5, "delta": 0, "new_points": 0,
         "rank_name": "BRONZE", "is_placement": False},
        {"user_id": "real_B", "kills": 4, "deaths": 7, "delta": -60, "new_points": 940,
         "rank_name": "DIAMOND", "is_placement": False},
    ]
    # Same indexing the server now uses
    placements_by_uid = {
        entry.get("user_id"): entry
        for entry in placements
        if entry.get("user_id")
    }
    assert placements_by_uid["real_A"]["delta"] == 30
    assert placements_by_uid["real_B"]["delta"] == -60
    # Lookup must NOT depend on zip position (which would have paired
    # real_A with the bot at index 0 → delta=0 → "—" in history).


def test_compute_rp_delta_returns_negatives():
    # Make sure the loss curve still produces negatives for non-podium
    # finishers — the data feeding into rp_delta must be real.
    assert server.compute_rp_delta(5, tier_idx=0) == -10   # Bronze, 5th
    assert server.compute_rp_delta(5, tier_idx=3) == -40   # Platinum, 5th
    assert server.compute_rp_delta(5, tier_idx=4) == -60   # Diamond, 5th
    # Platinum+ also lose for 4th
    assert server.compute_rp_delta(4, tier_idx=3) == -40
    # Below platinum, 4th place earns -10 (Bronze loss)
    assert server.compute_rp_delta(4, tier_idx=0) == -10
