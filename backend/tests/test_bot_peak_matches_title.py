"""Bot peak_rank_points parity with past-season title.

Reported bug: on the leaderboard/profile, a bot's "Peak" rank card
showed a mid-climb value (e.g. Bronze, because peak_rank_points
defaulted to the current climb RP) while their past-season title
badge said "GOONMASTER" (because past_seasons[0].tier_name is derived
from seed_target_rp).

Fix contract:
  1. Newly-inserted seed bots have peak_rank_points == seed_target_rp
     (stamped at insert time in `_build_and_insert`).
  2. `seeded_climb_loop` lazily stamps peak on any bot whose peak is
     less than their seed_target_rp (covers the millions of existing
     bots that were inserted before this fix).
  3. Peak tier is computed via rank_for_points(target_rp) so it
     matches whichever tier past_seasons[0] resolves to.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_new_seed_doc_stamps_peak_at_target():
    """Read the _build_and_insert doc block and verify peak_rank_points
    is set from `rp` (the target)."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    marker = '"seed_v5_all_gm": True,'
    idx = src.find(marker)
    assert idx > 0
    window = src[idx:idx + 400]
    assert '"peak_rank_points": rp' in window, (
        "Fresh seed docs are missing peak_rank_points — profile 'Peak' "
        "card will show 0 while title shows the target tier."
    )
    assert '"peak_rank_tier": int(rank_idx)' in window
    assert '"peak_rank_name": rank_name' in window


def test_climb_loop_writes_peak_on_first_tick():
    """The climb loop lazily populates peak for existing bots. Read
    the code back to confirm the peak-write branch exists."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    marker = "if cur_peak < t_rp:"
    assert marker in src, (
        "Climb loop is missing the peak-catchup write — existing bots "
        "never get peak stamped after this deploy."
    )
    # Verify all four peak fields are written together.
    idx = src.find(marker)
    window = src[idx:idx + 500]
    assert 'update["peak_rank_points"] = t_rp' in window
    assert 'update["peak_rank_tier"] = int(peak_idx)' in window
    assert 'update["peak_rank_name"] = peak_name' in window
    assert 'update["peak_rank_division"]' in window


def test_climb_loop_no_op_check_respects_peak_state():
    """The 'skip write if nothing changed' fast-path used to bail on
    RP-stable rows. Now it must ALSO check peak so a bot at their
    target RP but missing peak_rank_points still gets stamped."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert "if new_rp == cur_rp and cur_peak >= t_rp and p > 0.0:" in src, (
        "Fast-path skip is ignoring peak state — bots that already "
        "reached target RP will never get peak stamped."
    )


def test_climb_projection_includes_peak_field():
    """The climb loop's Mongo projection must fetch peak_rank_points so
    the fast-path skip can compare against it."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # Anchor on the climb-loop cursor's projection block.
    marker = '"seed_climb_offset": 1, "seed_climb_speed": 1,'
    idx = src.find(marker)
    assert idx > 0
    window = src[idx:idx + 200]
    assert '"peak_rank_points": 1' in window


def test_peak_derives_to_goonmaster_for_gm_seed_targets():
    """Since all v5-migrated bots have seed_target_rp in [2100, 2700],
    their peak_rank_points must land in the Goonmaster tier — matching
    their past-season title."""
    # Sweep the current seed target range.
    for target in [2100, 2400, 2550, 2700]:
        peak_idx, peak_name = server.rank_for_points(target)
        assert peak_name == "GOONMASTER", (
            f"Target RP {target} resolves to tier '{peak_name}' — "
            "would mismatch the past-season title."
        )
