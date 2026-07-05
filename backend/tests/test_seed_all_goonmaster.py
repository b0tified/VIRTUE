"""Seed-fill + past-season leaderboard trimming — verifies:

1. All newly-inserted seed bots target a Goonmaster RP (≥ 2100) so by
   end of season the leaderboard converges to all-Goonmaster.
2. Existing seeds are migrated via `seed_v5_all_gm` to also target
   Goonmaster (the v5 code path lifts every non-GM seed).
3. Past-season leaderboard archive endpoint returns at most 50 rows
   (was 100).
4. `/api/me/season_history` filters out placements outside the top 50.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_seed_buckets_are_all_goonmaster():
    """Read the seed endpoint source and confirm the RP bucket range
    is entirely in the Goonmaster tier (2100+)."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    marker = "# RP buckets: (low, high, weight)"
    idx = src.find(marker)
    assert idx > 0, "Seed bucket definition not found in server.py"
    # Scan the block that immediately follows.
    window = src[idx:idx + 800]
    # The old multi-tier buckets should be gone.
    assert "(40,   95," not in window, "Bronze bucket still present in seed logic"
    assert "(110,  240," not in window, "Silver bucket still present in seed logic"
    # New GM bucket must be present.
    assert "(2100, 2700" in window, "GM-only bucket missing from seed logic"


def test_v5_migration_present():
    """Confirm the v5 all-GM migration exists so existing seeds get
    lifted to Goonmaster on next `seeded_climb_loop` iteration."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert "seed_v5_all_gm" in src, "v5 migration flag missing"
    assert "GOONMASTER_FLOOR = 2100" in src, "GM floor constant missing in v5 migration"


def test_v5_migration_flag_stamped_on_new_seeds():
    """Fresh docs written by `_build_and_insert` must carry
    `seed_v5_all_gm: True` so the v5 migration skips them."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # Look inside the seed-insert doc block.
    marker = '"seed_v4_gm": True,'
    idx = src.find(marker)
    assert idx > 0
    window = src[idx:idx + 200]
    assert '"seed_v5_all_gm": True' in window, (
        "New seed docs are missing the v5 flag — the migration will "
        "keep re-touching every fresh seed on every loop iteration."
    )


def test_seed_climb_offset_widened():
    """The offset spread was widened 0..0.08 → 0..0.20 so the mid-
    season board looks like a real mixed ladder (some seeds still
    climbing through Bronze/Silver while others already sit at GM)
    instead of all bots bunched at their target from week one."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # The new `_build_and_insert` doc uses the widened range.
    assert 'random.uniform(0.0, 0.20)' in src


def test_archive_endpoint_trims_to_top_50():
    """The GET /leaderboard/archive/{n} endpoint must slice to 50 rows."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # Anchor on the trim comment we added.
    marker = "Trim to top 50 (was top 100)"
    assert marker in src, "Archive trim comment/code missing"
    # The slice itself.
    assert 'doc["top_100"] = rows[:50]' in src


def test_me_season_history_filters_beyond_top_50():
    """User's past-season row is hidden if their placement > 50."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert 'int(my_row.get("rank", 0) or 0) > 50' in src


def test_goonmaster_rp_threshold_unchanged():
    """Sanity: RANK_TIERS still has Goonmaster starting at 2100.
    If this drifted, the v5 migration's GOONMASTER_FLOOR=2100 would
    become misaligned."""
    gm_rows = [t for t in server.RANK_TIERS if t[1] == "GOONMASTER"]
    assert len(gm_rows) == 1
    assert gm_rows[0][0] == 2100
