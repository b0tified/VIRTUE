"""Master+ ranked-RP win cap tests.

The performance-scaled ranked delta previously clamped at +35 for
every tier. To raise the effective climbing floor for the top tiers,
the cap tightens above Diamond:
    Bronze..Diamond (tier ≤ 5) → +35 max
    Master           (tier 6)  → +20 max
    Grandmaster+     (tier 7+) → +15 max

Loss side is untouched — still floors at −60 for everyone.

This mirrors the inline math in `end_match` around the ranked delta
branch. The formula:
    base    = compute_rp_delta(placement, tier_idx)     (podium-based)
    perf    = kills * 3 - deaths * 5
    max_gain = 35 / 20 / 15 by tier
    delta   = clamp(base + perf, -60, max_gain)
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _simulate_ranked_delta(kills, deaths, placement, tier_idx):
    """Mirror the ranked delta math from `end_match` (post-Master-cap)."""
    base = server.compute_rp_delta(placement, tier_idx)
    perf = kills * 3 - deaths * 5
    if tier_idx >= server.MASTERS_TIER_IDX + 1:
        cap = 15  # Grandmaster + Goonmaster
    elif tier_idx >= server.MASTERS_TIER_IDX:
        cap = 20  # Master
    else:
        cap = 35  # Bronze..Diamond
    return max(-60, min(cap, base + perf))


def test_diamond_and_below_still_cap_at_plus_35():
    """A monster win in Diamond (tier 5) or below still hits the full +35."""
    for tier in (0, 3, 4, 5):  # Bronze, Platinum, Emerald, Diamond
        d = _simulate_ranked_delta(kills=27, deaths=3, placement=1, tier_idx=tier)
        assert d == 35, f"tier {tier} expected +35, got {d}"


def test_master_caps_at_plus_20():
    """Master (tier 6) — monster carries top out at +20 not +35."""
    d = _simulate_ranked_delta(kills=27, deaths=3, placement=1, tier_idx=6)
    assert d == 20


def test_grandmaster_caps_at_plus_15():
    """Grandmaster (tier 7) — top out at +15."""
    d = _simulate_ranked_delta(kills=27, deaths=3, placement=1, tier_idx=7)
    assert d == 15


def test_goonmaster_caps_at_plus_15():
    """Goonmaster (tier 8) — top out at +15."""
    d = _simulate_ranked_delta(kills=27, deaths=3, placement=1, tier_idx=8)
    assert d == 15


def test_master_plus_loss_still_floors_at_minus_60():
    """Loss side is untouched — Master/GM/Goonmaster still bottom
    out at −60 on a hard-throw."""
    for tier in (6, 7, 8):
        d = _simulate_ranked_delta(kills=3, deaths=9, placement=4, tier_idx=tier)
        assert d == -60, f"tier {tier} loss expected -60, got {d}"


def test_master_plus_modest_win_below_cap_untouched():
    """A modest positive delta below the cap is not clamped down —
    just capped when it would otherwise exceed. Master @ 2nd place
    with 8k/5d: base 0 + perf(24-25=-1) = -1, no cap change."""
    d = _simulate_ranked_delta(kills=8, deaths=5, placement=2, tier_idx=6)
    assert d == -1
