"""Regression: seeded leaderboard bots must be ROLLED BACK at season
rollover, not fully reset to 0 by the climb loop. Previously the
leaderboard emptied for the first days of a new season because:
  - Season reset dropped every user's `rank_points` (fine).
  - The `seeded_climb_loop` then set `rank_points = seed_target_rp * frac`
    where `frac` = 0 at the start of the new season → 0 for every bot.
Fix: `seed_start_rp` is set at rollover (using the same rules as real
players — Goonmaster → Diamond III, else −900 floor 0), and the climb
loop lerps from `seed_start_rp` → `seed_target_rp` across the season.
"""
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()


def test_season_reset_excludes_seeded_bots_from_generic_updatemany():
    """The generic `update_many` that drops real-user RP must NOT
    touch seeded bots — they get their own rollback pass so the climb
    loop can lerp from `seed_start_rp` instead of 0."""
    marker = "await db.users.update_many("
    idx = SRC.find(marker)
    assert idx >= 0, "season reset update_many missing"
    # Grab the first update_many after the marker (there are others).
    block = SRC[idx: idx + 400]
    assert '"is_seeded": {"$ne": True}' in block, (
        "season reset update_many must exclude seeded bots — otherwise "
        "the climb loop rebuilding from frac=0 will still empty the "
        "leaderboard."
    )


def test_season_reset_stamps_seed_start_rp():
    """The rollover code must write `seed_start_rp` on every seeded
    bot so the climb-loop lerp has a non-zero baseline for the new
    season."""
    marker = "Seeded leaderboard bots — separate pass"
    idx = SRC.find(marker)
    assert idx >= 0, "seeded rollback pass missing"
    block = SRC[idx: idx + 3000]
    assert '"seed_start_rp": start_rp' in block, (
        "seeded rollback must persist `seed_start_rp` for the climb loop."
    )
    assert '"rank_points": start_rp' in block, (
        "seeded rollback must snap `rank_points` to the rolled-back "
        "baseline immediately so the leaderboard shows the new-season "
        "starting values instead of 0."
    )


def test_climb_loop_lerps_from_seed_start_rp():
    """`seeded_climb_loop` must interpolate from `seed_start_rp` to
    `seed_target_rp` — not from 0."""
    marker = "async def seeded_climb_loop("
    idx = SRC.find(marker)
    assert idx >= 0, "seeded_climb_loop missing"
    # Search the whole function body — the climb lerp lives ~500 lines
    # after the def past a long chain of one-shot migrations. Scan up
    # to the next top-level `async def` / `def`.
    end_idx = SRC.find("\nasync def ", idx + 100)
    if end_idx < 0:
        end_idx = idx + 20000
    block = SRC[idx:end_idx]
    assert 'start_rp = int(u.get("seed_start_rp"' in block, (
        "climb loop must read `seed_start_rp` per-doc."
    )
    assert "start_rp + (t_rp - start_rp) * p" in block, (
        "climb loop must lerp from start_rp toward t_rp (not from 0)."
    )
