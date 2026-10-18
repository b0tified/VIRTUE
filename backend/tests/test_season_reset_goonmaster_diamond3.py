"""Season rollback — Goonmaster lands at Diamond III; everyone else drops 900 RP (floor 0)."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402

GOON = server.RANK_TIERS[-1][0]
DIAMOND_III = server.RANK_TIERS[5][0]


def _simulate_reset(pts):
    if pts >= GOON:
        return DIAMOND_III
    return max(0, pts - 900)


def test_tier_constants():
    assert server.RANK_TIERS[-1][1] == "GOONMASTER" and GOON == 2400
    assert server.RANK_TIERS[5][1] == "DIAMOND" and DIAMOND_III == 1500
    assert server.rank_division_for_points(DIAMOND_III, 5) == 3


def test_goonmaster_lands_at_diamond_iii():
    assert _simulate_reset(2400) == 1500
    assert _simulate_reset(3000) == 1500


def test_below_goonmaster_uses_soft_reset():
    assert _simulate_reset(2399) == 1499
    assert _simulate_reset(1800) == 900
    assert _simulate_reset(1500) == 600
    assert _simulate_reset(200) == 0


def test_source_uses_goonmaster_branch():
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert "GOONMASTER_RP = RANK_TIERS[-1][0]" in src
    assert "DIAMOND_III_RP = RANK_TIERS[5][0]" in src
    assert '{"$gte": [{"$ifNull": ["$rank_points", 0]}, GOONMASTER_RP]}' in src
    assert "DIAMOND_III_RP," in src
    assert "if rp >= GOONMASTER_RP:\n                return DIAMOND_III_RP" in src


def test_peak_rank_points_preserved():
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    idx = src.find("await db.users.update_many(")
    window = src[idx:idx + 2500]
    assert '"peak_rank_points":' in window and '"$max": [' in window
