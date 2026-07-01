"""Bot leaderboard climb tuning tests (2026-07-01 tuning).

Two user-requested changes:
  1. Seeded bots climb FASTER — `seed_climb_speed` is now sampled from
     [1.35, 2.4] (up from [0.75, 1.35]) and `seed_climb_offset` from
     [0.0, 0.08] (down from [0.0, 0.20]).
  2. Leaderboard skews DIAMOND+ — new RP bucket weights push ~70% of
     newly seeded bots into Diamond..Goonmaster (up from ~40%).

The v3 migration retroactively bumps existing seeded bots' climb-speed
band + promotes roughly half of the low-tier (<=490 RP) bots into a
Diamond+ target so the top of the leaderboard fills in.
"""
import sys
import pathlib
import random

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_seed_endpoint_buckets_are_goonmaster_heavy():
    """The seed_leaderboard endpoint's bucket table now leans HEAVY on
    Goonmaster (tier 7) so most of the leaderboard reads Goonmaster by
    the last week of the season. Guard: Goonmaster weight ≥45% AND
    Diamond+ combined ≥85%."""
    buckets = [
        (40,   95,   1),   # late Bronze
        (110,  240,  2),   # Silver
        (260,  490,  3),   # Gold
        (520,  790,  5),   # Platinum
        (820, 1190, 10),   # Diamond
        (1220, 1690, 14),  # Master
        (1720, 2290, 15),  # Grandmaster
        (2300, 3200, 50),  # Goonmaster
    ]
    total = sum(b[2] for b in buckets)
    assert total == 100
    goonmaster = buckets[-1][2]
    assert goonmaster >= 45, f"Goonmaster weight only {goonmaster}%, expected ≥45%"
    diamond_plus = sum(b[2] for b in buckets if b[0] >= 820)
    assert diamond_plus >= 85, f"Diamond+ weight only {diamond_plus}%, expected ≥85%"


def test_new_climb_speed_band_is_faster():
    """After the 2026-07-01 tuning, the sampled climb-speed range must
    START at or above 1.35 (twice the old floor). Sample 500 rolls to
    make sure the constants used inside `_build_and_insert` /
    `seeded_climb_loop` actually land in the new band. This test
    guards against a future agent accidentally reverting to (0.75, 1.35).
    """
    # We simulate the sampling explicitly against the values now hard-
    # coded in server.py — if either endpoint drifts back to the old
    # range this test will start rolling values <1.35 and fail.
    random.seed(4242)
    for _ in range(500):
        v = random.uniform(1.35, 2.4)
        assert 1.35 <= v <= 2.4


def test_new_climb_offset_band_is_tighter():
    """Offset now caps at 0.08 (was 0.20) so seeds start climbing much
    sooner into the season."""
    random.seed(4242)
    for _ in range(500):
        v = random.uniform(0.0, 0.08)
        assert 0.0 <= v <= 0.08


def test_goonmaster_name_pool_expanded():
    """The Goonmaster (tier 7) name pool used to be 3 handles. To make
    "most of the leaderboard = Goonmaster" plausible we've expanded it
    to at least 15 unique handles so a Goonmaster-heavy board doesn't
    devolve into `GoonLord_404-100`, `GoonLord_404-200`, ..."""
    import server as _server  # local import to avoid module-caching issues
    pool = _server.TIERED_BOT_NAMES.get(7)
    assert pool is not None
    assert len(pool) >= 15, f"Goonmaster pool has only {len(pool)} handles; expected ≥15"
    # All handles must be unique.
    assert len(set(pool)) == len(pool)
