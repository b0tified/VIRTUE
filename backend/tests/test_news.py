"""News broadcast tests.

Admin-only `news_posts` collection with public read. Endpoints:
  POST /api/admin/news        — admin creates a post.
  DELETE /api/admin/news/{id} — admin deletes a post.
  GET /api/news               — public list (pinned first, then newest), also
                                stamps the user's `news_last_read_at`.
  GET /api/news/unread        — returns {count} of posts published after the
                                user's last read timestamp.
"""
import sys
import pathlib
import asyncio
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


# --- In-memory mock for db.news_posts + db.users -------------------------

class _MockCursor:
    def __init__(self, rows):
        self._rows = rows
        self._limit = None
        self._sort_keys = None

    def sort(self, key_or_pairs, direction=None):
        # Accept either ("field", -1) OR [("a", -1), ("b", -1)].
        if isinstance(key_or_pairs, str):
            self._sort_keys = [(key_or_pairs, direction or -1)]
        else:
            self._sort_keys = list(key_or_pairs)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def __aiter__(self):
        rows = list(self._rows)
        if self._sort_keys:
            for key, direction in reversed(self._sort_keys):
                rows.sort(key=lambda r, k=key: r.get(k), reverse=(direction == -1))
        if self._limit is not None:
            rows = rows[: self._limit]
        self._iter = iter(rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class _MockNewsPosts:
    def __init__(self):
        self.rows: list = []

    async def insert_one(self, doc):
        from bson import ObjectId
        doc["_id"] = ObjectId()
        self.rows.append(doc)
        class _R:
            inserted_id = doc["_id"]
        return _R()

    async def delete_one(self, filt):
        before = len(self.rows)
        self.rows = [r for r in self.rows if r.get("_id") != filt.get("_id")]
        class _R:
            deleted_count = before - len(self.rows)
        return _R()

    def find(self, query):
        # Trivial filter — only supports created_at: {$gt: dt} (used by unread).
        rows = self.rows
        if "created_at" in query and isinstance(query["created_at"], dict):
            gt = query["created_at"].get("$gt")
            if gt is not None:
                rows = [r for r in rows if r.get("created_at") and r["created_at"] > gt]
        return _MockCursor(rows)

    async def count_documents(self, query):
        rows = self.rows
        if "created_at" in query and isinstance(query["created_at"], dict):
            gt = query["created_at"].get("$gt")
            if gt is not None:
                rows = [r for r in rows if r.get("created_at") and r["created_at"] > gt]
        return len(rows)


class _MockUsers:
    def __init__(self):
        self.updates = []
    async def update_one(self, filt, ops):
        self.updates.append((filt, ops))


@pytest.fixture
def mock_db(monkeypatch):
    posts = _MockNewsPosts()
    users = _MockUsers()
    monkeypatch.setattr(server.db, "news_posts", posts, raising=False)
    monkeypatch.setattr(server.db, "users", users)
    return posts, users


# --- Tests --------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_can_create_post(mock_db):
    posts, _ = mock_db
    admin = {"_id": "admin1", "username": "Admin", "role": "admin"}
    payload = server.NewsPostIn(title="Hello", body="World!", pinned=False)
    out = await server.admin_create_news(payload, user=admin)
    assert out["title"] == "Hello"
    assert out["body"] == "World!"
    assert out["author_username"] == "Admin"
    assert out["pinned"] is False
    assert len(posts.rows) == 1


@pytest.mark.asyncio
async def test_non_admin_cannot_create(mock_db):
    user = {"_id": "u1", "username": "u", "role": "user"}
    with pytest.raises(server.HTTPException) as exc:
        await server.admin_create_news(server.NewsPostIn(title="Hi", body="Hi"), user=user)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_news_sorts_pinned_first_then_newest(mock_db):
    posts, _ = mock_db
    admin = {"_id": "admin1", "username": "Admin", "role": "admin"}
    # Older unpinned, newer unpinned, oldest pinned.
    await server.admin_create_news(server.NewsPostIn(title="Old", body="Old"), user=admin)
    await asyncio.sleep(0.01)
    await server.admin_create_news(server.NewsPostIn(title="Newer", body="Newer"), user=admin)
    await asyncio.sleep(0.01)
    await server.admin_create_news(server.NewsPostIn(title="Pinned", body="Pinned", pinned=True), user=admin)
    reader = {"_id": "u1", "username": "u", "role": "user"}
    rows = await server.list_news(user=reader, limit=10)
    assert [r["title"] for r in rows] == ["Pinned", "Newer", "Old"]
    # ... and `news_last_read_at` was stamped via update_one.
    _, users = mock_db
    assert any("news_last_read_at" in (ops.get("$set", {}) or {}) for _, ops in users.updates)


@pytest.mark.asyncio
async def test_unread_counts_posts_after_last_read(mock_db):
    posts, _ = mock_db
    admin = {"_id": "admin1", "username": "Admin", "role": "admin"}
    # User read at T0.
    t0 = datetime.now(timezone.utc)
    await asyncio.sleep(0.01)
    # Two posts published after T0.
    await server.admin_create_news(server.NewsPostIn(title="AA", body="aa"), user=admin)
    await server.admin_create_news(server.NewsPostIn(title="BB", body="bb"), user=admin)
    user = {"_id": "u1", "news_last_read_at": t0}
    out = await server.news_unread(user=user)
    assert out["count"] == 2
    # Brand-new user with no last-read sees all posts as unread.
    out2 = await server.news_unread(user={"_id": "u2"})
    assert out2["count"] == 2


@pytest.mark.asyncio
async def test_admin_can_delete_post(mock_db):
    posts, _ = mock_db
    admin = {"_id": "admin1", "username": "Admin", "role": "admin"}
    out = await server.admin_create_news(server.NewsPostIn(title="XX", body="xx"), user=admin)
    post_id = out["id"]
    res = await server.admin_delete_news(post_id, user=admin)
    assert res["ok"] is True
    assert len(posts.rows) == 0
    # Deleting again 404s.
    with pytest.raises(server.HTTPException) as exc:
        await server.admin_delete_news(post_id, user=admin)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_invalid_post_id_returns_400(mock_db):
    admin = {"_id": "admin1", "username": "Admin", "role": "admin"}
    with pytest.raises(server.HTTPException) as exc:
        await server.admin_delete_news("not-a-valid-id", user=admin)
    assert exc.value.status_code == 400
