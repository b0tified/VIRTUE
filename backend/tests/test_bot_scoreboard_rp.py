"""Ranked scoreboard: bots show accurate RP math (as if real players).

User request: "Make the bots on the scoreboard in ranked mode show the
accurate number of points gained and lost as if they were human players."

Previously bots' scoreboard rows had:
  - `delta`      = compute_rp_delta(placement, tier_idx)  (base only)
  - `new_points` = 0  (never computed)
  - `rank_change`= 0  (never computed)

Now the bot path mirrors the real-player non-placement formula:
  base_delta = compute_rp_delta(placement, tier_idx)   (podium curve)
  perf       = kills*3 - deaths*5
  Master tier:  perf -> perf*0.55 - 15   (tax)
  GM+ tier:     perf -> perf*0.40 - 20   (tax)
  delta      = clamp(base + perf, -60, 35)
  new_points = max(0, cur + delta)
  rank_change= rank_for_points(new_points)[0] - prev_tier_idx
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402
from server import compute_rp_delta, rank_for_points, rank_division_for_points, MASTERS_TIER_IDX  # noqa: E402


def _simulate_bot_row(*, kills, deaths, placement, cur_rp, cur_tier_idx):
    """Reproduce the inline bot-row math from `_finalize_match` (ranked
    branch, bots path) so the test can assert each field independently."""
    base_delta = compute_rp_delta(placement, cur_tier_idx)
    raw_perf = kills * 3 - deaths * 5
    if cur_tier_idx >= MASTERS_TIER_IDX + 1:
        perf = int(raw_perf * 0.4) - 20
    elif cur_tier_idx >= MASTERS_TIER_IDX:
        perf = int(raw_perf * 0.55) - 15
    else:
        perf = raw_perf
    delta = max(-60, min(35, base_delta + perf))
    new_points = max(0, cur_rp + delta)
    new_tier, new_tier_name = rank_for_points(new_points)
    return {
        "delta": delta,
        "base_delta": base_delta,
        "new_points": new_points,
        "rank_tier": new_tier,
        "rank_name": new_tier_name,
        "rank_division": rank_division_for_points(new_points, new_tier),
        "prev_rank_tier": cur_tier_idx,
        "prev_rank_division": rank_division_for_points(cur_rp, cur_tier_idx),
        "rank_change": new_tier - cur_tier_idx,
    }


def test_bot_first_place_silver_gains_rp():
    """Silver bot (tier 1, 400 RP), 1st place, 15/5 → should gain real
    RP, not just a bare base delta."""
    r = _simulate_bot_row(kills=15, deaths=5, placement=1, cur_rp=400, cur_tier_idx=1)
    # 1st-place base at Silver = +30 (compute_rp_delta); perf 15*3-5*5=20
    # → delta clamp(30+20, -60, 35) = 35.
    assert r["delta"] == 35
    assert r["new_points"] == 435
    assert r["rank_change"] == 0  # still Silver
    assert r["prev_rank_tier"] == 1


def test_bot_last_place_gold_loses_rp():
    """Gold bot (tier 2, 750 RP), 4th place, 3/9 → heavy negative delta."""
    r = _simulate_bot_row(kills=3, deaths=9, placement=4, cur_rp=750, cur_tier_idx=2)
    # 4th base at Gold = -30; perf 3*3-9*5=-36 → clamp(-30-36, -60, 35) = -60
    assert r["delta"] == -60
    assert r["new_points"] == 690
    # 690 RP is still Gold (600-899).
    assert r["rank_tier"] == 2
    assert r["rank_change"] == 0


def test_bot_master_tax_limits_easy_cap():
    """Master bot (tier 6, 1900 RP), 1st place, 15/5 → Master tax
    softens the delta vs Silver."""
    r = _simulate_bot_row(kills=15, deaths=5, placement=1, cur_rp=1900, cur_tier_idx=6)
    # 1st base at Master = +30; raw_perf=20; master tax: int(20*0.55)-15 = 11-15 = -4
    # → delta clamp(30-4, -60, 35) = 26.
    assert r["delta"] == 26
    assert r["new_points"] == 1926


def test_bot_demotion_crosses_tier_boundary():
    """Bot at tier floor (Silver 300 RP) + a heavy loss should demote
    to Bronze and rank_change should surface as negative."""
    r = _simulate_bot_row(kills=2, deaths=10, placement=4, cur_rp=305, cur_tier_idx=1)
    # 4th at Silver = -20; perf 2*3-10*5=-44 → clamp(-20-44, -60, 35) = -60
    assert r["delta"] == -60
    assert r["new_points"] == 245
    assert r["rank_tier"] == 0  # Bronze
    assert r["rank_change"] == -1


def test_bot_promotion_crosses_tier_boundary():
    """Bot at Silver ceiling + a strong win should promote to Gold with
    rank_change = +1 for the scoreboard glow."""
    r = _simulate_bot_row(kills=15, deaths=4, placement=1, cur_rp=580, cur_tier_idx=1)
    # 1st at Silver = +30; perf = 15*3-4*5 = 25 → clamp(30+25, -60, 35) = 35
    assert r["delta"] == 35
    assert r["new_points"] == 615
    assert r["rank_tier"] == 2  # Gold
    assert r["rank_change"] == 1


def test_bot_new_points_never_negative():
    """Low-RP bronze bot losing badly must floor at 0, not go negative."""
    r = _simulate_bot_row(kills=1, deaths=12, placement=4, cur_rp=25, cur_tier_idx=0)
    assert r["new_points"] >= 0
    assert r["delta"] <= 0
