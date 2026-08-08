"""Public-profile endpoint surfaces `leaderboard_rank` + `title_ultimate`.

Regression guard for the "friends-list peak rank shows Ultimate Gooner"
fix: `GET /users/{username}/profile` needs to expose both the cached
top-50 position (`leaderboard_rank`) AND the equipped ULTIMATE title
flag (`title_ultimate`) so the friends-list `PublicProfileModal` can
render the flame + #N badge on the peak rank pill.
"""
import sys
import pathlib

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_public_profile_exposes_leaderboard_rank_and_title_ultimate():
    if server.db is None:
        pytest.skip("No mongo")
    marker = "pub_ult_test"
    viewer = {
        "_id": ObjectId(),
        "email": "viewer@t.test",
        "username": "viewer_ut",
        "password_hash": "x",
        "_test_marker": marker,
    }
    target = {
        "_id": ObjectId(),
        "email": "target@t.test",
        "username": "target_ut",
        "password_hash": "x",
        "rank_points": 6200,
        "peak_rank_points": 6770,
        "title_ultimate": True,
        "_test_marker": marker,
    }
    non_ultimate = {
        "_id": ObjectId(),
        "email": "reg@t.test",
        "username": "regular_ut",
        "password_hash": "x",
        "rank_points": 500,
        "peak_rank_points": 900,
        "_test_marker": marker,
    }
    await server.db.users.insert_many([viewer, target, non_ultimate])
    # Force target into the top-50 cache; non_ultimate stays out.
    server.TOP50_GOONER_IDS[str(target["_id"])] = 3
    server.TOP50_GOONER_IDS.pop(str(non_ultimate["_id"]), None)
    try:
        # Target (top-50) → leaderboard_rank = 3, title_ultimate = True.
        out = await server.public_profile(username="target_ut", _user=viewer)
        assert out.get("leaderboard_rank") == 3, out
        assert out.get("title_ultimate") is True, out
        # Non-top-50 → leaderboard_rank absent, title_ultimate defaults to False.
        out2 = await server.public_profile(username="regular_ut", _user=viewer)
        assert "leaderboard_rank" not in out2 or out2.get("leaderboard_rank") is None
        assert out2.get("title_ultimate") is False
    finally:
        server.TOP50_GOONER_IDS.pop(str(target["_id"]), None)
        await server.db.users.delete_many({"_test_marker": marker})
