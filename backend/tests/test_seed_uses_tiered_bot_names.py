"""Regression test: leaderboard-seed accounts must draw their base
handle from the SAME `TIERED_BOT_NAMES` pool that in-game ranked bots
use for their tier. Two name catalogs would feel disjoint — a player
who keeps seeing "ApexLumen_T1" climb the ladder should also believably
run into "ApexLumen_T1-R" in their next Master-tier match."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_tiered_bot_names_cover_all_8_tiers():
    """Every rank tier 0..7 must have at least 3 candidate names so the
    seeder never collides into the global fallback."""
    for tier_idx in range(8):
        pool = server.TIERED_BOT_NAMES.get(tier_idx)
        assert pool and len(pool) >= 3, f"tier {tier_idx} has no/too-few names: {pool}"


def test_legacy_seed_handles_removed():
    """The old flat `_SEED_VETERAN_HANDLES` list was the source of the
    name divergence — it must no longer exist as a module attribute."""
    assert not hasattr(server, "_SEED_VETERAN_HANDLES"), \
        "_SEED_VETERAN_HANDLES should be removed in favour of TIERED_BOT_NAMES."


def test_seeder_uses_tiered_pool_for_rank():
    """A code-level check that the seeder picks from TIERED_BOT_NAMES."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # Locate the seeder fn body
    needle = "async def _build_and_insert"
    i = src.index(needle)
    # Look at the next ~1500 chars for the name-pick code
    snippet = src[i : i + 1500]
    assert "TIERED_BOT_NAMES" in snippet, \
        "_build_and_insert must reference TIERED_BOT_NAMES so seed handles match in-game bot handles."
