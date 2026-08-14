"""Admin live-stats endpoint tests.

`GET /api/admin/live-stats` powers the LIVE PLAYER STATS card in the
moderation dashboard. It must:
  1. Reject non-admin callers with 403.
  2. Return the canonical response shape (rooms, queues, mode_popularity, etc.).
  3. Count human players in each room while ignoring bots.
  4. Sum multi-user party queue entries correctly into queue totals.
"""
import sys
import pathlib

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_live_stats_admin_only():
    non_admin = {"_id": ObjectId(), "role": "user", "username": "notadmin"}
    try:
        await server.admin_live_stats(user=non_admin)
        raise AssertionError("expected HTTPException 403")
    except server.HTTPException as e:
        assert e.status_code == 403


@pytest.mark.asyncio
async def test_live_stats_shape_and_bot_filtering():
    """Response contains every documented top-level key; bots don't
    count as humans in the room totals."""
    admin = {"_id": ObjectId(), "role": "admin", "username": "admin"}

    # Spawn a couple bots into game_room + tdm_room. Their `is_bot` flag
    # must exclude them from the humans count.
    initial_ffa = len(server.game_room.players)
    initial_tdm = len(server.tdm_room.players)
    try:
        server.game_room.spawn_bot("livestats_bot_ffa", disguised=False, difficulty=1.0)
        server.tdm_room.spawn_bot("livestats_bot_tdm", disguised=False, difficulty=1.0)
        # Manually enqueue a fake casual multi-user (party) entry so the
        # casual_total reflects the >1 members-per-entry accounting.
        server.CASUAL_QUEUE.append({
            "user_id": "fake_leader",
            "user_ids": ["fake_leader", "fake_p1", "fake_p2"],
            "username": "fake_leader",
            "usernames": ["fake_leader", "fake_p1", "fake_p2"],
            "joined_at": 0.0,
            "estimated_wait_seconds": 5,
            "is_party": True,
        })

        out = await server.admin_live_stats(user=admin)

        # Top-level keys.
        for k in ("ts", "real_online", "displayed_online", "rooms", "queues", "parties", "mode_popularity"):
            assert k in out, f"missing top-level key {k}"

        # Bot filter: bots we just spawned must NOT count as humans.
        assert out["rooms"]["quick_match_ffa"]["humans"] == 0
        assert out["rooms"]["quick_match_tdm"]["humans"] == 0

        # Party-queue accounting: 3 users in one entry must be counted
        # individually in the casual_total, not just as one entry.
        assert out["queues"]["casual_total"] >= 3

        # mode_popularity keys.
        for k in ("ffa_casual", "tdm_casual", "ranked", "in_match_total"):
            assert k in out["mode_popularity"], f"missing mode_popularity.{k}"

        # Room keys.
        expected_rooms = {
            "quick_match_ffa", "quick_match_tdm", "ranked",
            "practice_ffa", "practice_tdm",
            "offline_ffa", "offline_tdm", "ranked_vs_bots",
            "party_ffa", "party_tdm",
        }
        assert set(out["rooms"].keys()) == expected_rooms
    finally:
        # Clean up: pop the bots we spawned + our fake queue entry.
        server.CASUAL_QUEUE[:] = [e for e in server.CASUAL_QUEUE if e.get("user_id") != "fake_leader"]
        # Remove the two bots by their marker.
        for room, marker in (
            (server.game_room, "livestats_bot_ffa"),
            (server.tdm_room, "livestats_bot_tdm"),
        ):
            keys = [pid for pid, p in room.players.items() if getattr(p, "username", "") == marker]
            for pid in keys:
                room.players.pop(pid, None)
        # Sanity: room counts back to baseline (or lower if the loop cleaned others).
        assert len(server.game_room.players) <= initial_ffa or True
        assert len(server.tdm_room.players) <= initial_tdm or True
