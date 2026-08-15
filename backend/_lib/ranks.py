"""Rank + placement math — pure functions, no I/O.

Extracted from `server.py` during the 2026-02-24 refactor. Every
symbol here is re-exported from `server.py` so existing callers and
pytests (`srv.RANK_TIERS`, `srv.compute_rp_delta`, ...) don't change.

Design rules for this module:
  - No `db`, no async, no FastAPI types.
  - Any tunable constant (RP thresholds, tier counts) lives here so a
    future ladder shuffle only touches one file.
"""
from typing import Optional


# ─── Rank ladder ─────────────────────────────────────────────────────
# Every tier is 300 RP wide (100 RP per division: III / II / I). See
# `test_emerald_tier.test_rank_tiers_layout` for the invariant. Adding
# a new tier only requires inserting a row here and updating the
# `MASTERS_TIER_IDX` / `QUEUE_LOW_TIER_MAX` constants below.
RANK_TIERS = [
    (0,    "BRONZE"),
    (300,  "SILVER"),
    (600,  "GOLD"),
    (900,  "PLATINUM"),
    (1200, "EMERALD"),
    (1500, "DIAMOND"),
    (1800, "MASTER"),
    (2100, "GRANDMASTER"),
    (2400, "GOONMASTER"),
]

# Tier-index constants. Kept as named symbols so the callers in
# `end_match`, `compute_placement_delta`, and the ranked-queue matcher
# don't scatter magic numbers across the codebase.
MASTERS_TIER_IDX = 6           # RANK_TIERS index for MASTER

# Placement-match RP math tunables (below).
PLACEMENT_PERF_BONUS_CAP = 150
PLACEMENT_PERF_PENALTY_CAP = -200
PLACEMENT_HIGH_TIER_WIN_CAP = 150


# ─── Rank lookup helpers ─────────────────────────────────────────────
def rank_for_points(points: int):
    """Return `(tier_idx, tier_name)` for a given RP total. Walks the
    ladder low → high so the last threshold reached wins."""
    idx = 0
    name = RANK_TIERS[0][1]
    for i, (threshold, n) in enumerate(RANK_TIERS):
        if points >= threshold:
            idx = i
            name = n
    return idx, name


def rank_division_for_points(points: int, tier_idx: Optional[int] = None) -> int:
    """Return the sub-division within a tier (1 = highest, 3 = entry).

    Every non-Goonmaster tier is 300 RP wide split into 3 equal
    100 RP bands: III (entry), II (middle), I (top). Goonmaster
    (top tier) is undivided → returns 0.
    """
    if tier_idx is None:
        tier_idx, _ = rank_for_points(points)
    tier_idx = max(0, min(len(RANK_TIERS) - 1, int(tier_idx)))
    if tier_idx >= len(RANK_TIERS) - 1:
        return 0
    low = RANK_TIERS[tier_idx][0]
    high = RANK_TIERS[tier_idx + 1][0]
    span = max(1, high - low)
    p = max(low, min(high - 1, int(points)))
    frac = (p - low) / span
    if frac < 1.0 / 3.0:
        return 3
    if frac < 2.0 / 3.0:
        return 2
    return 1


def rank_division_roman(division: int) -> str:
    """Turn the integer division into a Roman numeral for display.
    Returns empty string for Goonmaster (0) so callers can safely
    concat without a spurious "0" suffix."""
    return {1: "I", 2: "II", 3: "III"}.get(int(division or 0), "")


# ─── Per-match RP delta math ─────────────────────────────────────────
def compute_rp_delta(placement: int, tier_idx: int) -> int:
    """RP delta for a single ranked player finishing at `placement`.

    Curve:
      - Below Masters:  +30 / +15 / 0 / -30  (1st through last).
      - Masters and up: +30 /   0 / -60 / -60.

    "Last" means anyone outside the podium — matches with more than 4
    slots all lose the same amount.
    """
    tier_idx = max(0, min(len(RANK_TIERS) - 1, int(tier_idx)))
    if tier_idx >= MASTERS_TIER_IDX:
        if placement == 1:
            return 30
        if placement == 2:
            return 0
        return -60
    if placement == 1:
        return 30
    if placement == 2:
        return 15
    if placement == 3:
        return 0
    return -30


def compute_placement_delta(kills: int, deaths: int, placement: int, cur_tier_idx: int) -> int:
    """RP delta for a placement match.

    Args:
      kills / deaths: player's frag line this match.
      placement: 1 = 1st place, anything else counts as a loss.
      cur_tier_idx: tier BEFORE the match (0..8).

    Total range roughly [-300, +250]. Perf modifier is clamped by
    `PLACEMENT_PERF_BONUS_CAP` / `PLACEMENT_PERF_PENALTY_CAP`. Players
    past Diamond (tier >= Masters) also get their positive delta
    capped at `PLACEMENT_HIGH_TIER_WIN_CAP` so a returning veteran
    can't rocket back to peak on placement wins alone.
    """
    base = 100 if placement == 1 else -100
    perf_raw = int(kills) * 10 - int(deaths) * 8
    if perf_raw >= 0:
        perf = min(PLACEMENT_PERF_BONUS_CAP, perf_raw)
    else:
        perf = max(PLACEMENT_PERF_PENALTY_CAP, perf_raw)
    delta = base + perf
    if cur_tier_idx >= MASTERS_TIER_IDX and delta > PLACEMENT_HIGH_TIER_WIN_CAP:
        delta = PLACEMENT_HIGH_TIER_WIN_CAP
    return delta
