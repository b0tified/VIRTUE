"""Quick Match bots show a level in [15, 90] on their scoreboard banner.

User asked for Quick Match (casual FFA / TDM / BigFFA) bots to roll a
displayed level anywhere between 15 and 90 — makes the lobby read like
a wide spread of grinders + whales instead of a row of fresh accounts.

Ranked bots still override via `_reroll_ranked_bots` to a tier-aligned
narrower band, so this test is scoped to the default Player.__init__
roll that every non-ranked bot inherits.
"""
import sys
import pathlib
import random

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_quick_match_bot_level_range():
    """1000 Player(..., is_bot=True) spawns must all land in [15, 90]."""
    for _ in range(1000):
        p = server.Player(ws=None, is_bot=True, bot_name="scratch_bot")
        assert 15 <= p.level <= 90, p.level


def test_quick_match_bot_level_actually_spreads():
    """Sanity check: not a constant — pulls values across the band."""
    seen = {server.Player(ws=None, is_bot=True, bot_name="b").level for _ in range(500)}
    # With a uniform [15, 90] roll, 500 samples will land on ≥30 distinct
    # values ~always (range is 76 ints wide, Chernoff makes this safe).
    assert len(seen) >= 30, f"only {len(seen)} distinct levels — did the range collapse?"
    assert min(seen) <= 30
    assert max(seen) >= 70
