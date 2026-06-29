"""Bot-fill timer tests — tier-banded wait windows.

  • Bronze .. Gold (0-2): 5-20s  (random per join)
  • Plat .. Diamond (3-4): 45s flat
  • Master .. Grandmaster (5-6): 120s flat
  • Goonmaster (7): 120-300s random per join

The randomised bands keep new players in fast queues and let high-end
queues hold longer for real-vs-real matchmaking. This file guards the
ranges so a future agent doesn't accidentally collapse them back to a
single timer.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_low_tier_bot_fill_is_5_to_20s():
    """Bronze (0), Silver (1), Gold (2) all roll inside [5, 20]."""
    for tier in (0, 1, 2):
        for _ in range(40):
            v = server.bot_fill_seconds_for_tier(tier)
            assert 5.0 <= v <= 20.0, f"tier {tier} → {v}s outside 5-20"


def test_mid_tier_bot_fill_stays_45s():
    for tier in (3, 4):
        # Mid tier is deterministic — assert exact value.
        assert server.bot_fill_seconds_for_tier(tier) == server.QUEUE_BOT_FILL_SEC


def test_high_tier_bot_fill_stays_120s():
    for tier in (5, 6):
        assert server.bot_fill_seconds_for_tier(tier) == server.QUEUE_BOT_FILL_SEC_HIGH


def test_goonmaster_bot_fill_in_120_to_300s():
    for _ in range(40):
        v = server.bot_fill_seconds_for_tier(7)
        assert 120.0 <= v <= 300.0


def test_low_tier_band_constants_match_user_spec():
    assert server.QUEUE_BOT_FILL_LOW_MIN == 5.0
    assert server.QUEUE_BOT_FILL_LOW_MAX == 20.0
    assert server.QUEUE_LOW_TIER_MAX == 2  # Gold (idx 2) is the highest "low" tier
