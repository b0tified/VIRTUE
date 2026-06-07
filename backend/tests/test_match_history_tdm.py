"""Match-history TDM rendering tests.

When a player finishes a TDM (3v3) match, the persisted
`match_history` row must carry the team scoreline, the player's team
color, and a precomputed `team_outcome` (win/loss/draw) so the Profile
UI can render a "WIN 12 — 10" card instead of the FFA "Nth of M"
placement card. FFA rows must remain backwards-compatible (no TDM
fields leaked onto them).
"""
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


@pytest.mark.asyncio
async def test_profile_history_passes_through_tdm_fields(monkeypatch):
    """`/profile/me/history` must surface `game_mode`, `team`,
    `team_score`, `enemy_team_score`, `team_outcome` whenever a stored
    match doc has `game_mode == 'tdm'`."""
    fake_docs = [
        {  # TDM win
            "user_id": "u1", "mode": "casual", "game_mode": "tdm",
            "team": "red", "team_score": 12, "enemy_team_score": 9,
            "team_outcome": "win",
            "kills": 7, "deaths": 4, "placement": 1, "total_players": 6,
            "rp_delta": 0, "rank_points_after": 0, "rank_name_after": "BRONZE",
            "is_placement": False, "ended_at": None,
        },
        {  # TDM draw
            "user_id": "u1", "mode": "casual", "game_mode": "tdm",
            "team": "blue", "team_score": 10, "enemy_team_score": 10,
            "team_outcome": "draw",
            "kills": 6, "deaths": 6, "placement": 3, "total_players": 6,
            "rp_delta": 0, "rank_points_after": 0, "rank_name_after": "BRONZE",
            "is_placement": False, "ended_at": None,
        },
        {  # Plain FFA — must NOT receive TDM fields in the response
            "user_id": "u1", "mode": "casual", "game_mode": "ffa",
            "kills": 5, "deaths": 3, "placement": 2, "total_players": 4,
            "rp_delta": 0, "rank_points_after": 0, "rank_name_after": "BRONZE",
            "is_placement": False, "ended_at": None,
        },
    ]

    class _Cursor:
        def __init__(self, docs): self.docs = list(docs)
        def sort(self, *_): return self
        def limit(self, _): return self
        def __aiter__(self): self._it = iter(self.docs); return self
        async def __anext__(self):
            try: return next(self._it)
            except StopIteration: raise StopAsyncIteration

    class _FakeColl:
        def find(self, _q, _proj):
            return _Cursor(fake_docs)

    monkeypatch.setattr(server.db, "match_history", _FakeColl())

    # Call the endpoint function directly with a fake user.
    fake_user = {"_id": "u1"}
    rows = await server.profile_history(user=fake_user, limit=10)

    assert len(rows) == 3
    # TDM win row.
    assert rows[0]["game_mode"] == "tdm"
    assert rows[0]["team"] == "red"
    assert rows[0]["team_score"] == 12
    assert rows[0]["enemy_team_score"] == 9
    assert rows[0]["team_outcome"] == "win"
    # TDM draw row.
    assert rows[1]["game_mode"] == "tdm"
    assert rows[1]["team_outcome"] == "draw"
    assert rows[1]["team_score"] == rows[1]["enemy_team_score"] == 10
    # FFA row — TDM keys MUST be absent (leak check).
    assert rows[2]["game_mode"] == "ffa"
    assert "team" not in rows[2]
    assert "team_score" not in rows[2]
    assert "enemy_team_score" not in rows[2]
    assert "team_outcome" not in rows[2]


@pytest.mark.asyncio
async def test_profile_history_defaults_legacy_rows_to_ffa(monkeypatch):
    """Match-history docs created BEFORE the `game_mode` field existed
    (no `game_mode` key on the Mongo doc) should be returned as `ffa`
    by default — otherwise the Profile UI would have to special-case
    `undefined` to avoid rendering an empty TDM card on every legacy
    row."""
    legacy_docs = [
        {
            "user_id": "u1", "mode": "casual",
            # No `game_mode` field (pre-feature insert).
            "kills": 3, "deaths": 2, "placement": 1, "total_players": 4,
            "rp_delta": 0, "rank_points_after": 0, "rank_name_after": "BRONZE",
            "is_placement": False, "ended_at": None,
        },
    ]

    class _Cursor:
        def __init__(self, docs): self.docs = list(docs)
        def sort(self, *_): return self
        def limit(self, _): return self
        def __aiter__(self): self._it = iter(self.docs); return self
        async def __anext__(self):
            try: return next(self._it)
            except StopIteration: raise StopAsyncIteration

    class _FakeColl:
        def find(self, *_, **__):
            return _Cursor(legacy_docs)

    monkeypatch.setattr(server.db, "match_history", _FakeColl())

    rows = await server.profile_history(user={"_id": "u1"}, limit=10)
    assert len(rows) == 1
    assert rows[0]["game_mode"] == "ffa"
    # TDM-only keys absent because the row defaults to FFA.
    assert "team" not in rows[0]
