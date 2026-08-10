"""Seeded leaderboard bot climb + level tests.

Covers the user-requested tuning:
  1. Seeded bots climb faster — new speed range is 2.5..4.0.
  2. Seeded bots reach higher — new target RP window ceiling is 3800.
  3. Seeded bots' displayed level lands in [10, 25].
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


# ── xp_threshold_for_level ─────────────────────────────────────────
def test_xp_threshold_matches_compute_level():
    """For every level 1..30, `xp_threshold_for_level(L)` must be the
    exact XP value that resolves to level L via `compute_level`. This
    is what makes the "pin the bot's level via bonus_xp" trick work."""
    for L in range(1, 30):
        xp = server.xp_threshold_for_level(L)
        # `compute_level` treats bonus_xp additively; a fresh doc with
        # only `bonus_xp = xp` and zeroed stats should resolve to level L.
        out = server.compute_level({"kills": 0, "deaths": 0, "matches": 0, "wins": 0, "bonus_xp": xp})
        assert out["level"] == L, f"level {L}: threshold {xp} → resolved to {out['level']}"


def test_level_10_threshold_is_16500():
    """Sanity: the closed-form matches the loop-summation. Level 10
    needs 50 * (9 * 10 * 11) / 3 = 16,500 XP."""
    assert server.xp_threshold_for_level(10) == 16500


def test_level_1_threshold_is_zero():
    """Level 1 is the base — no XP required."""
    assert server.xp_threshold_for_level(1) == 0


# ── Bot level pinning ──────────────────────────────────────────────
def _levels_across_climb(target_stats, bonus_xp):
    """Simulate a bot's displayed level across the full climb progress
    (0% → 100%). Returns the min and max level seen. Handy for asserting
    a pinned level stays inside a target band."""
    levels = []
    for progress in (0.0, 0.25, 0.5, 0.75, 1.0):
        stats = {
            "kills": int(target_stats["kills"] * progress),
            "deaths": int(target_stats["deaths"] * progress),
            "matches": int(target_stats["matches"] * progress),
            "wins": int(target_stats["wins"] * progress),
            "bonus_xp": bonus_xp,
        }
        levels.append(server.compute_level(stats)["level"])
    return min(levels), max(levels)


def test_bot_level_stays_within_10_to_25_across_climb():
    """A bot seeded with a Goonmaster target and a bonus_xp pinned to
    a level in [10, 22] must display a level in [10, 25] at every
    step from 0% climb to 100% climb (natural stats climb can add up
    to ~3 levels; capping the pin at 22 leaves headroom to stay under 25)."""
    for target_level in range(10, 23):  # 10..22 inclusive — matches _build_and_insert range
        bonus = server.xp_threshold_for_level(target_level)
        # Worst-case Goonmaster totals (top of the 2100..3800 band).
        target_stats = {"kills": 2500, "deaths": 1800, "matches": 500, "wins": 300}
        lo, hi = _levels_across_climb(target_stats, bonus)
        assert lo >= 10, f"target_level={target_level}: min level {lo} dipped below 10"
        assert hi <= 25, f"target_level={target_level}: max level {hi} exceeded 25"


# ── Climb speed range ──────────────────────────────────────────────
def test_seed_climb_speed_range_is_25_to_40():
    """Regression guard for the doc-string spec on `_build_and_insert`:
    new seeds spawn with `seed_climb_speed` in 2.5..4.0. The legacy v1
    and v3 migration paths still carry the older 1.35..2.4 literal
    (they're guarded by `seed_career_v2` / `seed_v3_boost` and only
    ever fire on ancient docs that then get bumped by v6), so we only
    assert the presence of the new range — not the absence of the old."""
    src = pathlib.Path(server.__file__).read_text()
    assert "random.uniform(2.5, 4.0)" in src, (
        "seed_climb_speed range does not appear to include 2.5..4.0"
    )


def test_seed_target_rp_bucket_ceiling_is_3800():
    """The bucket used by the seed endpoint must include the widened
    3800 ceiling (was 2700)."""
    src = pathlib.Path(server.__file__).read_text()
    assert "(2100, 3800, 100)" in src, "seed target-RP bucket ceiling isn't 3800"
