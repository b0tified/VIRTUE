"""Emerald tier tests.

A new EMERALD tier was inserted between PLATINUM and DIAMOND. Verify:
  1. RANK_TIERS layout: 9 tiers, EMERALD at index 4 with 1050 RP threshold.
  2. `rank_for_points` maps 1050..1199 to EMERALD.
  3. Emerald has all 3 divisions (I / II / III) — thresholds at
     1050 / 1100 / 1150.
  4. Downstream tier-index constants shifted correctly:
      • MASTERS_TIER_IDX = 6 (was 5)
      • QUEUE_LOW_TIER_MAX = 5 (was 4)
      • Goonmaster is the last tier (index 8, was 7).
  5. `compute_placement_delta` past-Diamond cap kicks in at tier 6 (Master)
     now, NOT at tier 5 (Diamond).
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_rank_tiers_layout():
    """Emerald must sit at index 4 with the 1050 threshold; Diamond
    shifts to index 5, Master 6, GM 7, Goonmaster 8."""
    tiers = server.RANK_TIERS
    assert len(tiers) == 9, f"Expected 9 tiers, got {len(tiers)}"
    assert tiers[0] == (0, "BRONZE")
    assert tiers[3] == (900, "PLATINUM")
    assert tiers[4] == (1050, "EMERALD")
    assert tiers[5] == (1200, "DIAMOND")
    assert tiers[6] == (1500, "MASTER")
    assert tiers[7] == (1800, "GRANDMASTER")
    assert tiers[8] == (2100, "GOONMASTER")


def test_rank_for_points_covers_emerald_band():
    """Any RP in [1050, 1200) resolves to EMERALD (tier 4)."""
    for rp in (1050, 1099, 1150, 1199):
        idx, name = server.rank_for_points(rp)
        assert idx == 4, f"rp={rp} → tier {idx} ({name}), expected 4 (EMERALD)"
        assert name == "EMERALD"
    # Boundaries — 1049 stays Platinum, 1200 becomes Diamond.
    assert server.rank_for_points(1049) == (3, "PLATINUM")
    assert server.rank_for_points(1200) == (5, "DIAMOND")


def test_emerald_has_all_three_divisions():
    """Emerald spans 150 RP → 50 RP per division. 1050 / 1100 / 1150
    map to divisions III / II / I respectively."""
    assert server.rank_division_for_points(1050, 4) == 3
    assert server.rank_division_for_points(1100, 4) == 2
    assert server.rank_division_for_points(1150, 4) == 1


def test_shifted_tier_index_constants():
    """The tier index constants must have shifted with the insertion."""
    assert server.MASTERS_TIER_IDX == 6
    assert server.QUEUE_LOW_TIER_MAX == 5


def test_placement_high_tier_cap_kicks_in_at_master_not_diamond():
    """The past-Diamond win cap of +150 must trigger for Master (6),
    NOT Diamond (5). Otherwise inserting Emerald effectively lowered
    the gate."""
    # A monster win that would normally be +250:
    d_diamond = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=5)
    assert d_diamond == 250, f"Diamond win should still hit +250, got {d_diamond}"
    d_master = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=6)
    assert d_master == 150, f"Master win should cap at +150, got {d_master}"
    d_goonmaster = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=8)
    assert d_goonmaster == 150, f"Goonmaster win should cap at +150, got {d_goonmaster}"


def test_emerald_placement_win_uncapped():
    """Emerald (tier 4) is below the past-Diamond cap and gets full
    +250 on a monster win."""
    d = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=4)
    assert d == 250
