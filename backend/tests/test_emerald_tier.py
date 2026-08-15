"""Emerald tier tests.

A new EMERALD tier was inserted between PLATINUM and DIAMOND. Verify:
  1. RANK_TIERS layout: 9 tiers, EMERALD at index 4 with 1200 RP threshold.
  2. `rank_for_points` maps 1200..1499 to EMERALD.
  3. Emerald has all 3 divisions (I / II / III) — thresholds at
     1200 / 1300 / 1400 (each division exactly 100 RP wide).
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
    """Every tier is now exactly 300 RP wide (100 per division). Emerald
    sits at index 4, threshold 1200; Diamond 1500; Master 1800; GM 2100;
    Goonmaster 2400 — the fully uniform ladder the user asked for."""
    tiers = server.RANK_TIERS
    assert len(tiers) == 9, f"Expected 9 tiers, got {len(tiers)}"
    assert tiers[0] == (0, "BRONZE")
    assert tiers[3] == (900, "PLATINUM")
    assert tiers[4] == (1200, "EMERALD")
    assert tiers[5] == (1500, "DIAMOND")
    assert tiers[6] == (1800, "MASTER")
    assert tiers[7] == (2100, "GRANDMASTER")
    assert tiers[8] == (2400, "GOONMASTER")
    # And every band (except the open-ended Goonmaster) is 300 RP wide.
    for i in range(len(tiers) - 1):
        span = tiers[i + 1][0] - tiers[i][0]
        assert span == 300, f"Tier {tiers[i][1]} band is {span} RP, expected 300"


def test_rank_for_points_covers_emerald_band():
    """Any RP in [1200, 1500) resolves to EMERALD (tier 4). The band is
    now 300 RP wide → 3 sub-divisions of 100 RP each."""
    for rp in (1200, 1300, 1400, 1499):
        idx, name = server.rank_for_points(rp)
        assert idx == 4, f"rp={rp} → tier {idx} ({name}), expected 4 (EMERALD)"
        assert name == "EMERALD"
    # Boundaries — 1199 stays Platinum, 1500 becomes Diamond.
    assert server.rank_for_points(1199) == (3, "PLATINUM")
    assert server.rank_for_points(1500) == (5, "DIAMOND")


def test_emerald_has_all_three_divisions():
    """Emerald now spans 300 RP → 100 RP per division (matches every
    other main tier)."""
    assert server.rank_division_for_points(1200, 4) == 3   # entry
    assert server.rank_division_for_points(1300, 4) == 2   # middle
    assert server.rank_division_for_points(1400, 4) == 1   # top


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
