"""Regression tests: `/api/auth/register` and `/api/profile/me/username`
must both enforce case-insensitive username uniqueness.

User request (2026-02-24):
  > Make it so you can't make an account with a name already in use
  > and can't change it to one already used by another player.

We monkey-patch `server.db.users` with an in-memory fake so the tests
run offline against the real endpoint functions (Pydantic validation +
uniqueness check + error mapping) without depending on a live Mongo.
"""
import os
import re
import sys
import pathlib
import uuid
from bson import ObjectId

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "shooter_test_uname_" + uuid.uuid4().hex[:8])

import server as srv  # noqa: E402


class _FakeResponse:
    def set_cookie(self, *a, **kw):
        pass


class _FakeUsersCollection:
    """Minimal async subset of motor's users collection — only the
    methods `register` + `change_username` touch. Uses a plain dict
    keyed by ObjectId."""

    def __init__(self):
        self._docs: dict = {}

    async def find_one(self, query, projection=None):
        for _id, doc in self._docs.items():
            if self._matches(doc, query):
                # Return a shallow copy so callers can safely mutate.
                return dict(doc)
        return None

    async def insert_one(self, doc):
        doc = dict(doc)
        _id = ObjectId()
        doc["_id"] = _id
        self._docs[_id] = doc

        class Res:
            inserted_id = _id
        return Res()

    async def update_one(self, query, update):
        for _id, doc in self._docs.items():
            if self._matches(doc, query):
                if "$set" in update:
                    doc.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        doc[k] = int(doc.get(k, 0) or 0) + int(v)
                return
        return

    async def delete_many(self, _q):
        self._docs.clear()

    # ---- helpers ----
    def _matches(self, doc, query):
        for k, v in query.items():
            if k == "_id":
                if isinstance(v, dict) and "$ne" in v:
                    if doc.get("_id") == v["$ne"]:
                        return False
                    continue
                if doc.get("_id") != v:
                    return False
                continue
            actual = doc.get(k)
            if isinstance(v, dict) and "$regex" in v:
                pattern = v["$regex"]
                flags = re.IGNORECASE if v.get("$options") == "i" else 0
                if not isinstance(actual, str) or not re.search(pattern, actual, flags):
                    return False
                continue
            if actual != v:
                return False
        return True


@pytest.fixture(autouse=True)
def _fake_db(monkeypatch):
    fake = _FakeUsersCollection()

    class _FakeDB:
        users = fake
    # Replace ONLY `db.users` on the server module for the duration of
    # each test — leaves other collections alone so future tests that
    # need them still work with the real client.
    monkeypatch.setattr(srv, "db", _FakeDB())
    yield fake


async def _register(email, username, password="pw123456"):
    payload = srv.RegisterIn(email=email, username=username, password=password)
    return await srv.register(payload, _FakeResponse())


class TestRegisterUsernameUniqueness:
    async def test_first_register_succeeds(self):
        out = await _register("alice@test.com", "Alice")
        assert out["user"]["username"] == "Alice"

    async def test_exact_duplicate_username_rejected(self):
        await _register("one@test.com", "duplicate_user")
        with pytest.raises(HTTPException) as exc:
            await _register("two@test.com", "duplicate_user")
        assert exc.value.status_code == 409
        assert "taken" in exc.value.detail.lower()

    @pytest.mark.parametrize("variant", ["alice", "ALICE", "aLiCe"])
    async def test_case_insensitive_duplicate_rejected(self, variant):
        """'Alice' and 'alice' look identical in the kill feed / friends
        list, so the API must treat them as the same name."""
        await _register("one@test.com", "Alice")
        with pytest.raises(HTTPException) as exc:
            await _register(f"{variant}@test.com", variant)
        assert exc.value.status_code == 409

    async def test_leading_trailing_whitespace_collides(self):
        """'  alice  ' would sneak past a naive equality check.
        Registration must trim before comparing."""
        await _register("one@test.com", "alice")
        with pytest.raises(HTTPException) as exc:
            await _register("two@test.com", "  alice  ")
        assert exc.value.status_code == 409

    async def test_different_username_still_allowed(self):
        await _register("one@test.com", "alice")
        out = await _register("two@test.com", "bob")
        assert out["user"]["username"] == "bob"

    @pytest.mark.parametrize("bad", ["!!hi!!", "a b c", "😀smiley"])
    async def test_invalid_format_rejected(self, bad):
        """Names with illegal chars must be blocked at register time,
        matching `USERNAME_PATTERN` on the rename endpoint. (Length
        under 2 chars is already rejected at the Pydantic layer, so
        no need to double-test it here.)"""
        with pytest.raises(HTTPException) as exc:
            await _register("bad@test.com", bad)
        assert exc.value.status_code == 400


class TestChangeUsernameStillEnforcesUniqueness:
    """Sanity coverage: the rename endpoint's uniqueness check was
    ALREADY in place before this fix. Kept alongside register tests
    so a future consolidation refactor can't weaken either side."""

    async def test_cannot_rename_to_taken_username(self):
        await _register("owner@test.com", "TargetName")
        await _register("mover@test.com", "MoverStart")
        mover = await srv.db.users.find_one({"email": "mover@test.com"})
        assert mover is not None
        payload = srv.UsernameChangeIn(username="targetname")   # different case
        with pytest.raises(HTTPException) as exc:
            await srv.change_username(payload, mover)
        assert exc.value.status_code == 409
        assert "taken" in exc.value.detail.lower()

    async def test_rename_to_own_username_no_op(self):
        await _register("solo@test.com", "OnlyOne")
        solo = await srv.db.users.find_one({"email": "solo@test.com"})
        payload = srv.UsernameChangeIn(username="OnlyOne")
        out = await srv.change_username(payload, solo)
        assert out["username"] == "OnlyOne"
