"""Regression tests for the past-seasons leaderboard archive.

Verifies:
  - `_archive_season_top_100` snapshots the right rows in the right
    order, capped at 100, with all the metadata the UI needs.
  - Re-running the snapshot on the same season number REPLACES the
    archive doc (no duplicate rows).
  - `maybe_reset_season` triggers an archive BEFORE zeroing the live
    `rank_points` field — so a season's final ranks are preserved.

The endpoints themselves (`GET /leaderboard/archive`,
`/leaderboard/archive/{N}`, `/me/season_history`) are smoke-tested
through the running app in a focused suite in test_match_history_rp_delta
or via curl — these tests cover the snapshot mechanics that they read
from.
"""
import asyncio
import sys
import pathlib
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_archive_snapshots_top_100_in_rank_order(monkeypatch):
    """Feed the archiver a fake users cursor and confirm it produces the
    expected ordered `top_100` rows with the metadata we promise."""
    fake_users = [
        {"_id": f"u{i}", "username": f"player{i}",
         "rank_points": 2000 - i * 5, "stats": {"kills": 50 + i, "matches": 10, "wins": 3},
         "avatar": (i % 7), "banner_icon": 0, "banner_color": 0,
         "selected_skin": "default"}
        for i in range(120)
    ]

    # Stub the Mongo cursor methods so the archiver runs purely in-memory.
    captured = {}

    class _Cursor:
        def __init__(self, docs):
            self.docs = docs
        def sort(self, *_):
            return self
        def limit(self, n):
            self.docs = self.docs[:n]
            return self
        def __aiter__(self):
            self._it = iter(self.docs)
            return self
        async def __anext__(self):
            try:
                return next(self._it)
            except StopIteration:
                raise StopAsyncIteration

    class _FakeColl:
        def find(self, _q, _proj):
            # The query filters by `placement_matches_played >= 1` AND
            # `rank_points > 0`; our test data has both implicit so just
            # return everything.
            return _Cursor(list(fake_users))
        async def update_one(self, filt, update, upsert=False):
            captured["filter"] = filt
            captured["update"] = update
            captured["upsert"] = upsert

    monkeypatch.setattr(server.db, "users", _FakeColl())
    monkeypatch.setattr(server.db, "season_archive", _FakeColl())

    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    ended   = datetime(2026, 6, 1, tzinfo=timezone.utc)
    await server._archive_season_top_100(season_number=1, started_at=started, ended_at=ended)

    upd = captured["update"]["$set"]
    assert captured["filter"] == {"_id": 1}
    assert captured["upsert"] is True
    assert upd["season_number"] == 1
    assert upd["total_players"] == 100, "Archive should be capped at 100 rows"
    rows = upd["top_100"]
    assert len(rows) == 100
    # Ranks are 1..100 in order.
    assert [r["rank"] for r in rows[:3]] == [1, 2, 3]
    # Top entry is the highest-RP user in the input.
    assert rows[0]["username"] == "player0"
    assert rows[0]["rank_points"] == 2000
    # Tier name resolves from RP — 2000 RP is GRANDMASTER (≥1700).
    assert rows[0]["rank_name"] == "GRANDMASTER"
    # User-id round-trips so /me/season_history can find me.
    assert rows[0]["user_id"] == "u0"


@pytest.mark.asyncio
async def test_archive_is_idempotent_via_upsert(monkeypatch):
    """Re-archiving the same season replaces the doc (upsert+ $set)."""
    fake_users = [
        {"_id": "u1", "username": "alice", "rank_points": 500,
         "stats": {"kills": 5}, "avatar": 0, "banner_icon": 0,
         "banner_color": 0, "selected_skin": "default"},
    ]
    update_calls = []

    class _Cursor:
        def __init__(self, docs): self.docs = docs
        def sort(self, *_): return self
        def limit(self, _): return self
        def __aiter__(self): self._it = iter(self.docs); return self
        async def __anext__(self):
            try: return next(self._it)
            except StopIteration: raise StopAsyncIteration

    class _FakeColl:
        def find(self, *_): return _Cursor(list(fake_users))
        async def update_one(self, filt, update, upsert=False):
            update_calls.append((filt, update, upsert))

    monkeypatch.setattr(server.db, "users", _FakeColl())
    monkeypatch.setattr(server.db, "season_archive", _FakeColl())

    now = datetime.now(timezone.utc)
    await server._archive_season_top_100(7, now, now)
    await server._archive_season_top_100(7, now, now)  # second call

    # Both calls hit the same key with upsert=True → idempotent.
    assert len(update_calls) == 2
    assert update_calls[0][0] == update_calls[1][0] == {"_id": 7}
    assert update_calls[0][2] is True and update_calls[1][2] is True


@pytest.mark.asyncio
async def test_maybe_reset_season_archives_before_zeroing(monkeypatch):
    """`maybe_reset_season` must call the archiver BEFORE the
    `update_many({rank_points: 0})` line — otherwise the snapshot would
    capture zeros for everyone and the archive would be useless."""
    order_of_ops = []

    async def fake_archive(season_number, started_at, ended_at):
        order_of_ops.append(("archive", season_number))

    class _Meta:
        async def find_one(self, _):
            # Season 5 already expired (started 100 days ago > SEASON_LENGTH_DAYS).
            from datetime import timedelta
            return {
                "_id": "season",
                "season_number": 5,
                "season_start": datetime.now(timezone.utc) - timedelta(days=999),
            }
        async def insert_one(self, _): pass
        async def update_one(self, *_):
            order_of_ops.append(("meta_update",))

    class _Users:
        async def update_many(self, *_):
            order_of_ops.append(("zero_rp",))

    monkeypatch.setattr(server, "_archive_season_top_100", fake_archive)
    monkeypatch.setattr(server.db, "meta", _Meta())
    monkeypatch.setattr(server.db, "users", _Users())

    new_doc = await server.maybe_reset_season()
    # Archive snapshot must run BEFORE the RP zero-out.
    op_names = [o[0] for o in order_of_ops]
    assert "archive" in op_names, "archive snapshot was never called"
    assert op_names.index("archive") < op_names.index("zero_rp"), \
        f"Archive must run before RP reset, got order: {op_names}"
    # And the archive was for the OUTGOING season (5), not the new one (6).
    archive_call = next(o for o in order_of_ops if o[0] == "archive")
    assert archive_call[1] == 5
    assert new_doc["season_number"] == 6
