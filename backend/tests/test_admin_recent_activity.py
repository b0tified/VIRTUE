"""Admin recent activity: /admin/users/recent returns two feeds.

User request: "Add a recent accounts created and recently online in
the moderation tab to show most recent accounts."

Backend endpoint `/api/admin/users/recent` returns `{recent_signups:
[...], recently_online: [...]}` — the frontend's RecentActivityPanel
hits it on mount + every 30s.

NOTE on scope: Motor's async MongoDB client caches the event loop at
first use; pytest-asyncio's default per-test loop closes it between
tests and blows up subsequent DB calls with "Event loop is closed".
These tests therefore cover the pure guard + response shape via a
single async flow — enough regression safety for the endpoint without
fighting the motor/pytest-asyncio loop lifecycle.
"""
import sys
import pathlib
import time
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_admin_recent_requires_admin():
    """Non-admin caller → 403. Pure sync check — guard runs before
    any awaits so we don't need the event loop."""
    import asyncio
    non_admin = {"_id": "u1", "username": "regular", "role": "user"}

    async def _call():
        await server.admin_users_recent(user=non_admin, limit=5)

    with pytest.raises(server.HTTPException) as exc:
        asyncio.get_event_loop().run_until_complete(_call())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_recent_returns_shape():
    """Single async pass: insert → call endpoint → assert shape +
    sorting + seeded-exclusion. Everything in one event loop so motor
    stays happy."""
    # Clean slate.
    await server.db.users.delete_many({"username": {"$regex": "^_test_recent_"}})
    now = datetime.now(timezone.utc)
    docs = [
        {   # Newest real
            "_id": ObjectId(), "username": "_test_recent_new",
            "email": "new@test.local", "role": "user", "level": 1,
            "rank_points": 0, "avatar": 0, "is_seeded": False,
            "created_at": now - timedelta(seconds=30),
            "last_seen_at": time.time() - 120,  # 2 min ago
        },
        {   # Older real
            "_id": ObjectId(), "username": "_test_recent_mid",
            "email": "mid@test.local", "role": "user", "level": 2,
            "rank_points": 50, "avatar": 0, "is_seeded": False,
            "created_at": now - timedelta(seconds=60),
            "last_seen_at": time.time() - 60,  # 1 min ago (newer online)
        },
        {   # Seeded bot — must NOT appear in signups
            "_id": ObjectId(), "username": "_test_recent_bot",
            "email": None, "role": "user", "level": 10,
            "rank_points": 1200, "avatar": 0, "is_seeded": True,
            "created_at": now - timedelta(seconds=10),
            "last_seen_at": None,
        },
        {   # Never-connected real — must NOT appear in Online
            "_id": ObjectId(), "username": "_test_recent_lurker",
            "email": "lurker@test.local", "role": "user", "level": 1,
            "rank_points": 0, "avatar": 0, "is_seeded": False,
            "created_at": now - timedelta(seconds=45),
            # no last_seen_at field at all
        },
    ]
    try:
        await server.db.users.insert_many(docs)
        admin = {"_id": "admin", "username": "admin", "role": "admin"}
        res = await server.admin_users_recent(user=admin, limit=50)
        assert "recent_signups" in res and "recently_online" in res
        signup_names = [r["username"] for r in res["recent_signups"] if r["username"].startswith("_test_recent_")]
        online_names = [r["username"] for r in res["recently_online"] if r["username"].startswith("_test_recent_")]
        # Seeded bot never surfaces anywhere.
        assert "_test_recent_bot" not in signup_names
        assert "_test_recent_bot" not in online_names
        # Signup sort: newest first.
        assert signup_names.index("_test_recent_new") < signup_names.index("_test_recent_mid")
        # Lurker (no last_seen_at) excluded from Online.
        assert "_test_recent_lurker" not in online_names
        # Online sort: _test_recent_mid (60s ago) BEFORE _test_recent_new (120s ago)
        assert online_names.index("_test_recent_mid") < online_names.index("_test_recent_new")
        # Row shape: every required field present on at least one row.
        row = next(r for r in res["recent_signups"] if r["username"] == "_test_recent_new")
        for k in ("id", "username", "role", "level", "rank_points",
                  "created_at", "last_seen_at", "online", "ban_status",
                  "avatar", "email"):
            assert k in row, f"missing field: {k}"
        assert row["online"] is False
        assert row["last_seen_at"] is not None
    finally:
        await server.db.users.delete_many({"username": {"$regex": "^_test_recent_"}})
