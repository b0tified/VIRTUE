"""Placement-match RP delta tests.

Covers:
  1. The classic Bronze–Diamond behaviour (unchanged):
     • Winning with a monster performance line still caps at +250
       (+100 base + +150 perf).
     • Losing with a hard-throw line still hits −300 (−100 base − 200 perf).
  2. Past-Diamond players (tier 6+ Master, 7 Grandmaster, 8 Goonmaster —
     tier indices bumped after inserting EMERALD at index 4) cap
     positive placement gains at +150 total so a returning veteran
     can't fast-track back to peak on placement wins alone. Losses stay
     uncapped.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


# ── Below-Master behaviour (tier 0..5) ─────────────────────────────
def test_bronze_placement_win_can_reach_plus_250():
    """Monster win: +100 base + capped +150 perf = +250."""
    d = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=0)
    assert d == 250


def test_bronze_placement_loss_can_reach_minus_300():
    """Hard-throw loss: −100 base + capped −200 perf = −300."""
    d = server.compute_placement_delta(kills=0, deaths=30, placement=4, cur_tier_idx=0)
    assert d == -300


def test_bronze_average_placement_win_scales_with_perf():
    """Middle-of-the-road win: base +100 + (5*10 − 3*8) = 100 + 26 = 126."""
    d = server.compute_placement_delta(kills=5, deaths=3, placement=1, cur_tier_idx=0)
    assert d == 126


def test_diamond_placement_win_uncapped():
    """Diamond (tier 5, was 4 pre-Emerald) is still BELOW the
    past-Diamond cap — a monster game should reach +250."""
    d = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=5)
    assert d == 250


# ── Past-Diamond cap (tier 6+) ─────────────────────────────────────
def test_master_placement_win_capped_at_150():
    """Master (tier 6) placement wins must cap at +150 even if perf
    would otherwise push the total to +250."""
    d = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=6)
    assert d == 150


def test_grandmaster_placement_win_capped_at_150():
    d = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=7)
    assert d == 150


def test_goonmaster_placement_win_capped_at_150():
    d = server.compute_placement_delta(kills=30, deaths=0, placement=1, cur_tier_idx=8)
    assert d == 150


def test_master_placement_win_below_cap_untouched():
    """If the calculated positive delta is already <= 150 we don't
    clamp — an average Master win still lands wherever the base + perf
    formula puts it. Base +100 + (5*10 − 3*8=26) = 126 → unchanged."""
    d = server.compute_placement_delta(kills=5, deaths=3, placement=1, cur_tier_idx=6)
    assert d == 126


def test_master_placement_loss_uncapped():
    """The past-Diamond cap is win-only — a Master with a hard-throw
    loss should still hit the full −300 penalty."""
    d = server.compute_placement_delta(kills=0, deaths=30, placement=4, cur_tier_idx=6)
    assert d == -300


def test_master_placement_close_loss_still_penalises():
    """Sanity: −100 base + (3*10 − 5*8) = −100 + (30 − 40) = −110 for
    a Master. Loss-side unchanged by the new cap."""
    d = server.compute_placement_delta(kills=3, deaths=5, placement=4, cur_tier_idx=6)
    assert d == -110
