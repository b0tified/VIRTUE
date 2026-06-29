"""Profile privacy tests — single combined async session to avoid motor
event-loop binding issues across pytest functions.

The previous shape ran into a known asyncio/Motor problem where each
pytest-asyncio test gets a fresh loop, but the global `server.db` motor
client is bound to whatever loop was active at import time. The first
test of the file worked; the next 3 silently failed mid-await. Combining
into one async test keeps everything on the same loop.
"""
import sys
import pathlib

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_profile_privacy_end_to_end():
    if server.db is None:
        pytest.skip("No mongo")
    marker = "privacy_e2e"
    real = {
        "_id": ObjectId(), "email": "real@t.test", "username": "real_priv_test",
        "password_hash": "x", "stats": {"kills": 50, "deaths": 10, "matches": 8, "wins": 5},
        "rank_points": 450, "peak_rank_points": 700, "_test_marker": marker,
    }
    bot = {
        "_id": ObjectId(), "email": "bot@t.test", "username": "bot_priv_test",
        "password_hash": "x", "stats": {"kills": 99, "deaths": 0, "matches": 1, "wins": 1},
        "rank_points": 1800, "is_seeded": True, "seed_target_rp": 1800,
        "_test_marker": marker,
    }
    viewer = {"_id": ObjectId(), "username": "viewer"}
    await server.db.users.insert_many([real, bot])
    try:
        # 1. Toggle privacy ON for the real user.
        await server.set_profile_privacy(
            server.ProfilePrivacyPayload(profile_private=True), user=real
        )
        saved = await server.db.users.find_one({"_id": real["_id"]})
        assert saved["profile_private"] is True

        # 2. Viewer sees the stripped payload.
        out = await server.public_profile(username="real_priv_test", _user=viewer)
        assert out["private"] is True
        assert out["is_bot"] is False
        assert out["rank_name"] == "SILVER"
        assert "stats" not in out and "history" not in out

        # 3. Owner sees their OWN full profile even with privacy ON.
        own = await server.public_profile(username="real_priv_test", _user=saved)
        assert own["private"] is False
        assert own["stats"]["kills"] == 50
        assert "history" in own

        # 4. Bots are always private regardless of the flag.
        bot_out = await server.public_profile(username="bot_priv_test", _user=viewer)
        assert bot_out["private"] is True
        assert bot_out["is_bot"] is True
        assert "stats" not in bot_out

        # 5. Toggle privacy OFF again.
        await server.set_profile_privacy(
            server.ProfilePrivacyPayload(profile_private=False), user=real
        )
        saved2 = await server.db.users.find_one({"_id": real["_id"]})
        assert saved2["profile_private"] is False
        public_again = await server.public_profile(username="real_priv_test", _user=viewer)
        assert public_again["private"] is False
        assert public_again["stats"]["kills"] == 50
    finally:
        await server.db.users.delete_many({"_test_marker": marker})
