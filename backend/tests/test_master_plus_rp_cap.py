"""Master+ ranked-RP win cap tests — UPDATED 2026-02-24.

User request: "In masters and up games make it so you can still gain
35 points it's just harder."

Previously the cap TIGHTENED at higher tiers (Master +20, GM+ +15).
The cap is now uniform at +35 for every tier — instead, the perf
formula gets progressively harder to satisfy so hitting the ceiling
takes a dominant carry.

Effective formula (`end_match`):
    base       = compute_rp_delta(placement, tier_idx)   (podium curve)
    raw_perf   = kills * 3 − deaths * 5
    Master (6):  perf = int(raw_perf * 0.55) − 15   ("Master tax")
    GM+   (7+): perf = int(raw_perf * 0.4)  − 20   ("GM+ tax")
    Below Master: perf = raw_perf
    max_gain   = 35 uniformly
    delta      = clamp(base + perf, −60, 35)

Loss side is unchanged — still floors at −60 for everyone.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _simulate_ranked_delta(kills, deaths, placement, tier_idx):
    """Mirror the ranked delta math from `end_match` post-uniform-cap."""
    base = server.compute_rp_delta(placement, tier_idx)
    raw_perf = kills * 3 - deaths * 5
    if tier_idx >= server.MASTERS_TIER_IDX + 1:      # GM+ tax
        perf = int(raw_perf * 0.4) - 20
    elif tier_idx >= server.MASTERS_TIER_IDX:        # Master tax
        perf = int(raw_perf * 0.55) - 15
    else:
        perf = raw_perf
    return max(-60, min(35, base + perf))


def test_diamond_and_below_dominant_hits_plus_35():
    """A monster win at Diamond or below still trivially hits +35."""
    for tier in (0, 3, 4, 5):  # Bronze, Platinum, Emerald, Diamond
        d = _simulate_ranked_delta(kills=27, deaths=3, placement=1, tier_idx=tier)
        assert d == 35, f"tier {tier} expected +35, got {d}"


def test_master_dominant_carry_reaches_plus_35_but_tight():
    """Master (tier 6) — a 27/3 carry still hits the +35 ceiling, but
    the perf gap is now tiny (base 30 + perf 21 = +51 → capped 35).
    Any drop from that dominant line falls below the cap."""
    dominant = _simulate_ranked_delta(kills=27, deaths=3, placement=1, tier_idx=6)
    assert dominant == 35


def test_master_middle_of_pack_does_not_hit_plus_35():
    """15/5 game at Master used to hit +35 (perf 20 → base 30 + 20 → capped).
    Under the tax it lands at +26 — you *feel* the tightening."""
    d = _simulate_ranked_delta(kills=15, deaths=5, placement=1, tier_idx=6)
    assert d == 26, f"expected +26 (perf tax kicks in), got {d}"


def test_grandmaster_dominant_carry_reaches_plus_35_barely():
    """GM+ (tier 7) — 27/3 carry: base 30 + int(66*0.4)-20 = 30+6 = 36 → 35."""
    d = _simulate_ranked_delta(kills=27, deaths=3, placement=1, tier_idx=7)
    assert d == 35, f"expected +35 (GM+ dominant), got {d}"


def test_grandmaster_average_win_far_from_cap():
    """15/5 win at GM+ used to hit +15 (old cap). Under the new tax it
    lands at +18 — the cap is +35 but reaching it is punishing."""
    d = _simulate_ranked_delta(kills=15, deaths=5, placement=1, tier_idx=7)
    assert d == 18


def test_goonmaster_dominant_carry_reaches_plus_35():
    """Same math as GM (tier 8 also uses GM+ tax)."""
    d = _simulate_ranked_delta(kills=27, deaths=3, placement=1, tier_idx=8)
    assert d == 35


def test_master_plus_loss_still_floors_at_minus_60():
    """Loss side is UNCHANGED — Master/GM/Goonmaster still bottom
    out at −60 on a hard-throw."""
    for tier in (6, 7, 8):
        d = _simulate_ranked_delta(kills=3, deaths=9, placement=4, tier_idx=tier)
        assert d == -60, f"tier {tier} loss expected -60, got {d}"


def test_master_perf_tax_penalizes_deaths_harder():
    """A 5/5 game (net perf 0) at Master should still be POSITIVE for a
    win (base 30), but the −15 flat tax knocks it down to +15 — under
    the old +20 cap it was also +15 by coincidence, but the mechanism
    now is the tax, not the cap. Sanity: raw_perf=(15-25)=-10 → int(-10*0.55)-15 = -5-15 = -20 → +10."""
    d = _simulate_ranked_delta(kills=5, deaths=5, placement=1, tier_idx=6)
    assert d == 10


def test_master_2nd_place_middling_kd_now_small_positive():
    """User asked (2026-02-24) to make 2nd place gain a small amount at
    Master+. 8 K / 5 D + 2nd at Master: base +25 + int((24−25)*0.55) − 15 =
    25 + int(−0.55) − 15 = 25 + 0 − 15 = +10.
    Previously (base 0): 0 + 0 − 15 = −15 (a loss for a decent 2nd)."""
    d = _simulate_ranked_delta(kills=8, deaths=5, placement=2, tier_idx=6)
    assert d == 10


def test_master_2nd_place_bad_kd_still_loses():
    """The 2nd-place bonus is not a free ride — a hard-throw 2nd still
    loses points. 3 K / 9 D + 2nd at Master:
    25 + int((9−45)*0.55) − 15 = 25 + int(−19.8) − 15 =
    25 + (−19) − 15 = −9   (Python int() truncates toward zero)."""
    d = _simulate_ranked_delta(kills=3, deaths=9, placement=2, tier_idx=6)
    assert d == -9


def test_gm_2nd_place_average_kd_still_small_positive():
    """GM+ perf tax is stiffer. 5 K / 5 D + 2nd at GM+:
    25 + int((15−25)*0.4) − 20 = 25 − 4 − 20 = +1 — barely positive
    but the intent is preserved: a decent 2nd doesn't cost points."""
    d = _simulate_ranked_delta(kills=5, deaths=5, placement=2, tier_idx=7)
    assert d == 1


def test_ranks_compute_rp_delta_2nd_place_master_plus_is_25():
    """Base delta for 2nd at Master+ must be +25 (not the old 0).
    Directly asserts the source of truth in `_lib/ranks.py`."""
    assert server.compute_rp_delta(placement=2, tier_idx=6) == 25
    assert server.compute_rp_delta(placement=2, tier_idx=7) == 25
    assert server.compute_rp_delta(placement=2, tier_idx=8) == 25


def test_uniform_cap_at_35_across_all_tiers():
    """No matter which tier, the top of the delta range is +35 — the
    whole point of the user's request. Push a monster 40/0 game at
    each tier and confirm all cap at exactly +35."""
    for tier in range(0, 9):     # every tier including Goonmaster
        d = _simulate_ranked_delta(kills=40, deaths=0, placement=1, tier_idx=tier)
        assert d == 35, f"tier {tier} expected +35 uniform cap, got {d}"


def test_endmatch_source_uses_new_perf_tax_formula():
    """Grep guard: `end_match` must use the new scaled-perf formula,
    not the old max_gain-tightening branch. Prevents a future refactor
    from silently reverting to the tighter caps."""
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    assert "raw_perf = p.kills * 3 - p.deaths * 5" in src
    assert "int(raw_perf * 0.4) - 20" in src, "GM+ tax formula missing"
    assert "int(raw_perf * 0.55) - 15" in src, "Master tax formula missing"
    assert "max_gain = 35   # Uniform cap" in src, "Uniform +35 cap comment missing"
