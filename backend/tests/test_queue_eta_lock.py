"""Ranked queue ETA — server-side sanity + tier-boundary tests.

The client-side ETA lock (QueueContext.jsx) captures whatever the server
returns on the FIRST poll and never re-reads it. This guarantee only
works if the server keeps returning a valid `estimated_wait_seconds` on
BOTH the initial POST and subsequent GETs (even if the underlying value
varies). Guard both here.

Also verifies the tier-boundary changes per the 2026-07-01 tuning:
  • Tier 4 (Diamond) is now in the LOW band (20-45s)
  • Tier 5 (Master) is now in the HIGH band (30-180s)
"""
import sys
import pathlib
import asyncio
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_queue_state():
    server.MATCHED_USERS.clear()
    for q in server.RANKED_QUEUE.values():
        q.clear()
    yield
    server.MATCHED_USERS.clear()
    for q in server.RANKED_QUEUE.values():
        q.clear()


def _user(uid: str, rp: int) -> dict:
    return {
        "_id": uid,
        "email": f"{uid}@t.test",
        "username": uid,
        "stats": {"kills": 200, "deaths": 100, "matches": 50, "wins": 30},
        "rank_points": rp,
    }


@pytest.mark.asyncio
async def test_queue_ranked_status_returns_eta_key_when_in_queue():
    """The server MUST populate `estimated_wait_seconds` on the first
    in-queue response — the client caches this value for the lifetime
    of the queue session."""
    # Bronze user (0 RP → tier 0)
    user = _user("eta_bronze", 0)
    post_out = await server.queue_ranked_join(user=user)
    assert post_out.get("in_queue") is True
    assert "estimated_wait_seconds" in post_out
    assert isinstance(post_out["estimated_wait_seconds"], int)
    assert post_out["estimated_wait_seconds"] >= 1
    # GET /queue/ranked should also return the ETA while in-queue.
    get_out = await server.queue_ranked_status(user=user)
    assert get_out.get("in_queue") is True
    assert "estimated_wait_seconds" in get_out


@pytest.mark.asyncio
async def test_diamond_now_uses_low_band_20_45s():
    """Tier 4 (Diamond) was fixed 45s pre-tuning; per user request it
    now rolls in the LOW band [20, 45]."""
    # Diamond starts at RANK_STEP*4 = 1200 RP (approx). Use a value
    # squarely inside Diamond by picking something 4 * 300 = 1200 RP.
    user = _user("eta_diamond", 1200)
    # Sanity: confirm we actually resolved to tier 4.
    tier_idx, _ = server.rank_for_points(1200)
    assert tier_idx == 4, f"expected Diamond (idx 4), got {tier_idx}"
    # Sample the raw helper 100× — every roll should fall in [20, 45].
    for _ in range(100):
        v = server.bot_fill_seconds_for_tier(4)
        assert 20.0 <= v <= 45.0


@pytest.mark.asyncio
async def test_master_uses_high_band_30_180s():
    """Tier 5 (Master) is the lowest of the HIGH tiers now — random
    30-180s per join instead of the old fixed 120s."""
    for _ in range(100):
        v = server.bot_fill_seconds_for_tier(5)
        assert 30.0 <= v <= 180.0
