"""Public-profile endpoint surfaces `banned` + `ban_status` + `ban_until`.

The friends-list / leaderboard `PublicProfileModal` needs to render
a "BANNED" indicator so users can tell when a top-of-the-leaderboard
account has been actioned. Banned accounts still appear in the
leaderboard (their historical RP anchors them there until a manual
scrub) so this profile signal is the primary user-visible cue.

Uses `check_ban()` which returns None for unbanned users AND for
expired suspensions — the test covers both paths.
"""
import sys
import pathlib
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_public_profile_exposes_ban_state():
    if server.db is None:
        pytest.skip("No mongo")
    marker = "banned_profile_test"
    viewer = {
        "_id": ObjectId(),
        "email": "banview@t.test", "username": "banview", "password_hash": "x",
        "_test_marker": marker,
    }
    banned_permanent = {
        "_id": ObjectId(),
        "email": "banperm@t.test", "username": "banperm_ut", "password_hash": "x",
        "rank_points": 500, "peak_rank_points": 700,
        "ban": {"status": "banned", "reason": "cheating", "at": datetime.now(timezone.utc)},
        "_test_marker": marker,
    }
    banned_suspended = {
        "_id": ObjectId(),
        "email": "bansusp@t.test", "username": "bansusp_ut", "password_hash": "x",
        "rank_points": 500, "peak_rank_points": 700,
        "ban": {
            "status": "suspended",
            "reason": "toxicity",
            "at": datetime.now(timezone.utc),
            "until": datetime.now(timezone.utc) + timedelta(days=3),
        },
        "_test_marker": marker,
    }
    suspended_expired = {
        "_id": ObjectId(),
        "email": "banexp@t.test", "username": "banexp_ut", "password_hash": "x",
        "rank_points": 500, "peak_rank_points": 700,
        "ban": {
            "status": "suspended",
            "reason": "toxicity",
            "at": datetime.now(timezone.utc) - timedelta(days=5),
            "until": datetime.now(timezone.utc) - timedelta(days=1),
        },
        "_test_marker": marker,
    }
    clean_user = {
        "_id": ObjectId(),
        "email": "banclean@t.test", "username": "banclean_ut", "password_hash": "x",
        "rank_points": 500, "peak_rank_points": 700,
        "_test_marker": marker,
    }
    await server.db.users.insert_many([
        viewer, banned_permanent, banned_suspended, suspended_expired, clean_user,
    ])
    try:
        # Permanent ban → banned=True, ban_status="banned", no ban_until.
        out = await server.public_profile(username="banperm_ut", _user=viewer)
        assert out.get("banned") is True
        assert out.get("ban_status") == "banned"

        # Active suspension → banned=True, ban_status="suspended", ban_until set.
        out = await server.public_profile(username="bansusp_ut", _user=viewer)
        assert out.get("banned") is True
        assert out.get("ban_status") == "suspended"
        assert out.get("ban_until") is not None

        # Expired suspension → treated as unbanned by `check_ban`.
        out = await server.public_profile(username="banexp_ut", _user=viewer)
        assert "banned" not in out or out.get("banned") is False

        # Clean account → no ban fields.
        out = await server.public_profile(username="banclean_ut", _user=viewer)
        assert "banned" not in out or out.get("banned") is False
    finally:
        await server.db.users.delete_many({"_test_marker": marker})
