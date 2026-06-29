"""Rank division tests.

Each main tier (Bronze..Grandmaster) is split into three sub-divisions:
  • III (3) — bottom third of the tier's RP range (entry).
  • II  (2) — middle third.
  • I   (1) — top third (close to next-tier promotion).
Goonmaster (tier 7) is undivided — `rank_division` returns 0.

`public_user` exposes the field so the lobby can render labels like
"SILVER II" and drive division-aware animated rank icons.
"""
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


# Each tier's [low, high) RP boundary from RANK_TIERS.
# (low, high, expected divisions at three sample points)
_CASES = [
    # Each main tier is now 300 RP wide → III (0..99), II (100..199), I (200..299).
    ("BRONZE",       0,    300,  [(0, 3), (150, 2), (299, 1)]),
    ("SILVER",       300,  600,  [(300, 3), (450, 2), (599, 1)]),
    ("GOLD",         600,  900,  [(600, 3), (750, 2), (899, 1)]),
    ("PLATINUM",     900,  1200, [(900, 3), (1050, 2), (1199, 1)]),
    ("DIAMOND",      1200, 1500, [(1200, 3), (1350, 2), (1499, 1)]),
    ("MASTER",       1500, 1800, [(1500, 3), (1650, 2), (1799, 1)]),
    ("GRANDMASTER",  1800, 2100, [(1800, 3), (1950, 2), (2099, 1)]),
]


@pytest.mark.parametrize("name,low,high,samples", _CASES)
def test_division_bands_across_each_tier(name, low, high, samples):
    """Sample three RP points per tier — entry / middle / top — and
    confirm we get division 3, 2, 1 in that order."""
    for pts, expected in samples:
        tier_idx, tier_name = server.rank_for_points(pts)
        assert tier_name == name, f"{pts} mapped to {tier_name}, expected {name}"
        got = server.rank_division_for_points(pts, tier_idx)
        assert got == expected, (
            f"{name} @ {pts} RP → division {got}, expected {expected}"
        )


def test_goonmaster_is_undivided():
    """Goonmaster (tier 7) has no sub-divisions — always returns 0."""
    for pts in [2100, 2300, 2500, 5000, 10000]:
        tier_idx, name = server.rank_for_points(pts)
        assert name == "GOONMASTER"
        assert server.rank_division_for_points(pts, tier_idx) == 0


def test_division_roman_helper():
    assert server.rank_division_roman(1) == "I"
    assert server.rank_division_roman(2) == "II"
    assert server.rank_division_roman(3) == "III"
    # Goonmaster / unknown → empty string so callers can concat freely.
    assert server.rank_division_roman(0) == ""
    assert server.rank_division_roman(None) == ""


def test_public_user_exposes_rank_division():
    """`public_user(...)` ships `rank_division` AND `peak_rank_division`
    so the lobby/profile UI can render the full label without a second
    fetch."""
    u = {
        "_id": "u1", "email": "a@b.com", "username": "a",
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "rank_points": 450,           # Silver II (300..599; II is 400..499)
        "peak_rank_points": 1750,     # Master I  (1500..1799; I is 1700..1799)
    }
    out = server.public_user(u)
    assert out["rank_tier"] == 1
    assert out["rank_name"] == "SILVER"
    assert out["rank_division"] == 2
    assert out["peak_rank_tier"] == 5
    assert out["peak_rank_name"] == "MASTER"
    assert out["peak_rank_division"] == 1


def test_each_division_is_exactly_100_rp_wide():
    """Product spec: every sub-tier spans exactly 100 RP. Guards
    against accidental drift in `RANK_TIERS` thresholds."""
    for i in range(len(server.RANK_TIERS) - 1):
        low = server.RANK_TIERS[i][0]
        high = server.RANK_TIERS[i + 1][0]
        assert high - low == 300, (
            f"{server.RANK_TIERS[i][1]} spans {high - low} RP, expected 300"
        )
