"""Season rollback — Diamond+ players land at Emerald III.

Contract (updated to seed the new EMERALD tier at every season roll):
  - RP >= 1200 (Diamond III floor) → new_rp = 1050 (Emerald III floor)
  - RP < 1200 → new_rp = max(0, rp - 900)  (standard soft reset)

Rationale: EMERALD was inserted between Platinum and Diamond at 1050 RP.
Landing every returning Diamond/Master/Grandmaster/Goonmaster at Emerald
III seeds the new tier with population from day one of the new season,
instead of leaving Emerald empty until natural climbers reach 1050 RP.

Previous behaviour ("Goonmasters land at Diamond III") is superseded —
Diamond+ is now the trigger, and Emerald III is the landing spot.
`peak_rank_points` still reflects the pre-reset RP so the past-season
title / profile "Peak" card stays intact.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def _simulate_reset(pts, drop=900, diamond_floor=None, emerald_iii_rp=None):
    """Mirror the aggregation pipeline branch added to update_many."""
    # Diamond is index 5 post-Emerald; Emerald III is index 4 at 1050.
    diamond_floor = diamond_floor if diamond_floor is not None else server.RANK_TIERS[5][0]
    emerald_iii_rp = emerald_iii_rp if emerald_iii_rp is not None else server.RANK_TIERS[4][0]
    if pts >= diamond_floor:
        return emerald_iii_rp
    return max(0, pts - drop)


def test_diamond_floor_lands_at_emerald_iii():
    """RP just at the Diamond III floor (1350 after Emerald was widened) snaps to Emerald III (1050)."""
    assert _simulate_reset(1350) == 1050


def test_goonmaster_lands_at_emerald_iii():
    """GMs (2100+) still land at Emerald III — they're squarely inside
    the Diamond+ bucket now."""
    assert _simulate_reset(2100) == 1050
    assert _simulate_reset(2700) == 1050


def test_master_lands_at_emerald_iii():
    """Master (1650 after tier shift) also lands at Emerald III — Diamond+
    includes Master and above."""
    assert _simulate_reset(1650) == 1050
    assert _simulate_reset(1500) == 1050   # mid-Diamond in the new layout


def test_emerald_iii_lands_via_soft_reset():
    """Emerald III itself (1050) uses the -900 soft reset since it's
    just BELOW the Diamond floor. 1050 - 900 = 150 → BRONZE III."""
    assert _simulate_reset(1050) == 150
    idx, name = server.rank_for_points(150)
    assert name == "BRONZE"


def test_platinum_uses_soft_reset():
    """Platinum (900) drops to 0 (0 floor). Below Diamond → soft reset."""
    assert _simulate_reset(900) == 0


def test_bronze_floors_at_zero():
    """Low RP players don't go negative after the soft reset."""
    assert _simulate_reset(200) == 0
    assert _simulate_reset(0) == 0


def test_source_has_diamond_branch():
    """Verify the aggregation pipeline includes the updated $cond branch."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert 'DIAMOND_FLOOR_RP = RANK_TIERS[5][0]' in src
    assert 'EMERALD_III_RP = RANK_TIERS[4][0]' in src
    # Confirm the $cond uses those constants.
    assert '{"$gte": [{"$ifNull": ["$rank_points", 0]}, DIAMOND_FLOOR_RP]}' in src
    assert 'EMERALD_III_RP,' in src


def test_emerald_iii_constant_matches_emerald_tier_floor():
    """EMERALD_III_RP must equal RANK_TIERS[4][0] (start of EMERALD)
    since Division III is the entry band of every tier. If the tier
    table shifts, this test flags the mismatch."""
    emerald_floor = None
    for rp, name in server.RANK_TIERS:
        if name == "EMERALD":
            emerald_floor = rp
            break
    assert emerald_floor == 1050
    # And Emerald III must resolve to division 3 at exactly this RP.
    idx, name = server.rank_for_points(emerald_floor)
    assert server.rank_division_for_points(emerald_floor, idx) == 3


def test_peak_rank_points_preserves_pre_reset_ceiling():
    """Sanity: after rollover, peak_rank_points must be ≥ the pre-reset
    RP (via $max in the aggregation). A GM's title/profile Peak card
    stays at Goonmaster even though live RP dropped to Emerald III."""
    # Code-scan sanity — verifies the peak_rank_points $max branch is
    # still in the pipeline alongside the updated $cond RP branch.
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    idx = src.find("await db.users.update_many(")
    window = src[idx:idx + 2500]
    assert '"peak_rank_points":' in window
    assert '"$max": [' in window
