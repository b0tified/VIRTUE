"""Performance-scaled RP delta in ranked matches (non-placement).

Locks in the user-specified spec (2026-02-24):
  - Max win gain: +35 RP
  - Max loss penalty: -60 RP
  - Anchor cases:
    · 27 K / 3 D + 1st place, Silver  →  +35
    · 3 K / 9 D + 4th place, Silver   →  -60
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _delta(kills, deaths, placement, tier_idx):
    """Reproduces the branch at server.py ~line 5520-5540 without needing
    to spin up a full match / MongoDB. Read the source to keep this in
    sync when the formula changes."""
    base = server.compute_rp_delta(placement, tier_idx)
    perf = kills * 3 - deaths * 5
    return max(-60, min(35, base + perf))


def test_dominant_carry_first_place_hits_plus_35():
    """27/3 KDA on a 1st-place finish → +35 (clamped max win)."""
    assert _delta(27, 3, 1, 0) == 35


def test_hard_thrower_bottom_place_hits_minus_60():
    """3/9 KDA on a 4th-place finish → -60 (clamped max loss)."""
    assert _delta(3, 9, 4, 0) == -60


def test_even_kda_win_earns_reduced_amount():
    """10/10 on a 2nd-place finish nets a small loss (not max)."""
    result = _delta(10, 10, 2, 0)
    # 15 + (30 - 50) = -5
    assert result == -5


def test_solid_carry_still_capped_at_35():
    """15/5 KDA on a win → +50 raw → clamped to +35."""
    assert _delta(15, 5, 1, 0) == 35


def test_max_loss_cap_holds_at_minus_60_below_masters():
    """Even in a Silver lobby with -30 base, the perf penalty stacks
    but never past -60."""
    assert _delta(0, 20, 4, 0) == -60


def test_masters_max_loss_stays_at_minus_60():
    """Masters+ base is -60 for 4th; perf shouldn't push us below."""
    # Masters index is MASTERS_TIER_IDX (5).
    assert _delta(0, 20, 4, server.MASTERS_TIER_IDX) == -60


def test_positive_perf_bonus_cant_exceed_plus_35():
    """No matter how good the KDA, delta caps at +35."""
    assert _delta(50, 0, 1, 0) == 35


def test_source_uses_kills_times_3_minus_deaths_times_5():
    """Static assert on the server source to catch a future rewrite that
    silently changes the coefficients — the anchor cases users memorised
    would then drift."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert "perf_delta = p.kills * 3 - p.deaths * 5" in src
    assert "max(-60, min(35, base_delta + perf_delta))" in src
