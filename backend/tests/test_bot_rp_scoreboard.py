"""Bots in ranked matches must show plausible +/- RP on the scoreboard
so the end-of-match overlay reads like a real ranked lobby (every line
has a delta), not just the human player's line.

The RP curve was simplified in 2026-06 to two tiers:
  - Below Masters (idx < 5): +30 / +15 /   0 / -30
  - Masters+      (idx >= 5): +30 /   0 / -60 / -60
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_bot_delta_uses_compute_rp_delta_per_placement_and_tier():
    # Bronze (idx 0) — below-Masters curve.
    assert server.compute_rp_delta(1, tier_idx=0) == 30
    assert server.compute_rp_delta(2, tier_idx=0) == 15
    assert server.compute_rp_delta(3, tier_idx=0) == 0
    assert server.compute_rp_delta(4, tier_idx=0) == -30
    assert server.compute_rp_delta(5, tier_idx=0) == -30

    # Diamond (idx 4) — still below Masters, same curve.
    assert server.compute_rp_delta(1, tier_idx=4) == 30
    assert server.compute_rp_delta(2, tier_idx=4) == 15
    assert server.compute_rp_delta(3, tier_idx=4) == 0
    assert server.compute_rp_delta(4, tier_idx=4) == -30

    # Master (idx 5) — Masters+ brutal curve kicks in.
    assert server.compute_rp_delta(1, tier_idx=5) == 30
    assert server.compute_rp_delta(2, tier_idx=5) == 0
    assert server.compute_rp_delta(3, tier_idx=5) == -60
    assert server.compute_rp_delta(4, tier_idx=5) == -60

    # Goonmaster (idx 7) — top of the ladder, same brutal curve.
    assert server.compute_rp_delta(2, tier_idx=7) == 0
    assert server.compute_rp_delta(3, tier_idx=7) == -60

    # Out-of-range tier_idx is clamped (defensive — bot data is server-side
    # and may have unexpected values during a match). Below-zero clamps to
    # Bronze, huge index clamps to Goonmaster.
    assert server.compute_rp_delta(4, tier_idx=99) == -60  # clamped to top → Masters+ curve
    assert server.compute_rp_delta(4, tier_idx=-3) == -30  # clamped to Bronze → below-Masters curve
