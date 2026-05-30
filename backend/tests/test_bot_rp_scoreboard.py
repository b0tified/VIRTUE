"""Bots in ranked matches must show plausible +/- RP on the scoreboard
so the end-of-match overlay reads like a real ranked lobby (every line
has a delta), not just the human player's line."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_bot_delta_uses_compute_rp_delta_per_placement_and_tier():
    # Bronze bot finishing 1st gains +30; finishing 5th loses -10.
    assert server.compute_rp_delta(1, tier_idx=0) == 30
    assert server.compute_rp_delta(5, tier_idx=0) == -10
    # Diamond bot finishing 1st gains +30; finishing 4th loses -60.
    assert server.compute_rp_delta(1, tier_idx=4) == 30
    assert server.compute_rp_delta(4, tier_idx=4) == -60
    # Goonmaster bot ranked 2nd → 0 (safe, no loss)
    assert server.compute_rp_delta(2, tier_idx=7) == 0
    # Out-of-range tier_idx is clamped (defensive — bot data is server-side
    # and may have unexpected values during a match).
    assert server.compute_rp_delta(5, tier_idx=99) == -60
    assert server.compute_rp_delta(5, tier_idx=-3) == -10
