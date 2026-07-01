"""Bot-fill timer tests — tier-banded wait windows.

Post 2026-07-01 tuning per user request:
  • Bronze .. Diamond (0-4): random 20-45s per join
  • Master .. Goonmaster (5-7): random 30-180s (30s to 3 minutes) per join

The randomised bands keep the lower-mid ladder snappy while giving the
high-end queues a wider window for real-vs-real matchmaking. This file
guards the ranges so a future agent doesn't accidentally collapse them
back to a single timer.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_low_and_mid_tier_bot_fill_is_20_to_45s():
    """Bronze (0), Silver (1), Gold (2), Platinum (3), Diamond (4) all
    roll inside [20, 45] seconds."""
    for tier in (0, 1, 2, 3, 4):
        for _ in range(60):
            v = server.bot_fill_seconds_for_tier(tier)
            assert 20.0 <= v <= 45.0, f"tier {tier} → {v}s outside 20-45"


def test_high_tier_bot_fill_is_30_to_180s():
    """Master (5), Grandmaster (6), Goonmaster (7) all roll inside
    [30, 180] seconds — that's 30 seconds to 3 minutes."""
    for tier in (5, 6, 7):
        for _ in range(60):
            v = server.bot_fill_seconds_for_tier(tier)
            assert 30.0 <= v <= 180.0, f"tier {tier} → {v}s outside 30-180"


def test_low_tier_band_constants_match_user_spec():
    assert server.QUEUE_BOT_FILL_LOW_MIN == 20.0
    assert server.QUEUE_BOT_FILL_LOW_MAX == 45.0
    assert server.QUEUE_LOW_TIER_MAX == 4  # Diamond (idx 4) is now the highest "low" tier


def test_high_tier_band_constants_match_user_spec():
    assert server.QUEUE_BOT_FILL_HIGH_MIN == 30.0
    assert server.QUEUE_BOT_FILL_HIGH_MAX == 180.0
    assert server.QUEUE_HIGH_TIER_MIN == 5  # Master (idx 5) is the lowest "high" tier
