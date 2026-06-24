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
    # Bronze 0..99 → bands: 0..33 (III), 33..66 (II), 66..99 (I).
    ("BRONZE",       0,    100,  [(0, 3), (50, 2), (99, 1)]),
    ("SILVER",       100,  250,  [(100, 3), (175, 2), (249, 1)]),
    ("GOLD",         250,  500,  [(250, 3), (375, 2), (499, 1)]),
    ("PLATINUM",     500,  800,  [(500, 3), (650, 2), (799, 1)]),
    ("DIAMOND",      800,  1200, [(800, 3), (1000, 2), (1199, 1)]),
    ("MASTER",       1200, 1700, [(1200, 3), (1450, 2), (1699, 1)]),
    ("GRANDMASTER",  1700, 2300, [(1700, 3), (2000, 2), (2299, 1)]),
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
    for pts in [2300, 2500, 5000, 10000]:
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
        "rank_points": 175,           # Silver II
        "peak_rank_points": 1690,     # Master I
    }
    out = server.public_user(u)
    assert out["rank_tier"] == 1
    assert out["rank_name"] == "SILVER"
    assert out["rank_division"] == 2
    assert out["peak_rank_tier"] == 5
    assert out["peak_rank_name"] == "MASTER"
    assert out["peak_rank_division"] == 1
