"""Season rollback — Goonmasters land at Diamond III.

Contract:
  - RP >= 2100 (Goonmaster tier floor) → new_rp = 1200 (Diamond III floor)
  - RP < 2100 → new_rp = max(0, rp - 900)  (standard soft reset)

Rationale: Goonmasters were dominating first-week lobbies of every new
season. Landing them at Diamond III means they still start above the
median but have to prove themselves through the middle of the ladder
again. Their `peak_rank_points` still reflects the GM finish so the
past-season title / profile "Peak" card stays intact.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def _simulate_reset(pts, drop=900, gm_floor=None, d3_rp=None):
    """Mirror the aggregation pipeline branch added to update_many."""
    gm_floor = gm_floor if gm_floor is not None else server.RANK_TIERS[-1][0]
    d3_rp = d3_rp if d3_rp is not None else server.RANK_TIERS[4][0]
    if pts >= gm_floor:
        return d3_rp
    return max(0, pts - drop)


def test_goonmaster_floor_lands_at_diamond_iii():
    """RP just at the Goonmaster floor (2100) snaps to Diamond III (1200)."""
    assert _simulate_reset(2100) == 1200


def test_max_goonmaster_lands_at_diamond_iii():
    """RP well into Goonmaster (2700, the seed-target ceiling) still
    snaps to Diamond III, not Master or Grandmaster."""
    assert _simulate_reset(2700) == 1200
    # And confirm 1200 resolves to Diamond III via the shared helpers.
    idx, name = server.rank_for_points(1200)
    assert name == "DIAMOND"
    assert server.rank_division_for_points(1200, idx) == 3  # III


def test_grandmaster_uses_soft_reset():
    """RP just below Goonmaster (2099) uses the -900 soft-reset path.
    Grandmaster starts at 1800; 2099 - 900 = 1199 → PLATINUM I (still
    a step below Diamond III). Non-GM players are unaffected by the
    new rule."""
    assert _simulate_reset(2099) == 1199
    idx, name = server.rank_for_points(1199)
    assert name == "PLATINUM"


def test_master_uses_soft_reset():
    """Master (1500) drops to 600 = Silver — standard soft reset."""
    assert _simulate_reset(1500) == 600


def test_bronze_floors_at_zero():
    """Low RP players don't go negative after the soft reset."""
    assert _simulate_reset(200) == 0
    assert _simulate_reset(0) == 0


def test_source_has_goonmaster_branch():
    """Verify the aggregation pipeline includes the $cond branch."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    marker = 'GOONMASTER_FLOOR_RP = RANK_TIERS[-1][0]'
    assert marker in src
    # Confirm the $cond uses those constants.
    assert '{"$gte": [{"$ifNull": ["$rank_points", 0]}, GOONMASTER_FLOOR_RP]}' in src
    assert 'DIAMOND_III_RP,' in src


def test_diamond_iii_constant_matches_diamond_tier_floor():
    """DIAMOND_III_RP must equal RANK_TIERS[4][0] (start of Diamond)
    since Division III is the entry band of every tier. If the tier
    table shifts, this test flags the mismatch."""
    diamond_floor = None
    for rp, name in server.RANK_TIERS:
        if name == "DIAMOND":
            diamond_floor = rp
            break
    assert diamond_floor == 1200
    # And Diamond III must resolve to division 3 at exactly this RP.
    idx, name = server.rank_for_points(diamond_floor)
    assert server.rank_division_for_points(diamond_floor, idx) == 3


def test_peak_rank_points_preserves_gm_ceiling():
    """Sanity: after rollover, peak_rank_points must be ≥ the pre-reset
    RP (via $max in the aggregation). A GM's title/profile Peak card
    stays at Goonmaster even though live RP dropped to Diamond III."""
    # This is a code-scan sanity — verifies the peak_rank_points $max
    # branch is still in the pipeline alongside the new $cond RP branch.
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    idx = src.find("await db.users.update_many(")
    window = src[idx:idx + 2500]
    assert '"peak_rank_points":' in window
    assert '"$max": [' in window
