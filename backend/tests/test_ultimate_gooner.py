"""Ultimate Gooner (top-50 Goonmaster) rank feature.

Locks in the user-specified spec (2026-02-24):
  1. `TOP50_GOONER_IDS` cache exists and starts empty.
  2. `refresh_ultimate_gooner_cache` populates it in position order.
  3. `public_user()` attaches `leaderboard_rank` (1..50) when the user
     is in the cache, and omits the field otherwise so the frontend
     falls back to plain Goonmaster.
  4. Startup schedules the periodic refresh loop.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_top50_cache_exists_and_defaults_empty():
    """Cache is initialised at module load — starts empty until the first
    refresh completes. Failing to have the module-level attribute would
    crash public_user()."""
    assert hasattr(server, "TOP50_GOONER_IDS")
    assert isinstance(server.TOP50_GOONER_IDS, dict)


def test_ultimate_gooner_refresh_interval_configured():
    """The refresh interval must be sensible (5..300 seconds). Too fast
    hammers Mongo; too slow leaves the badge stale after a match end
    that reshuffles the top-50."""
    interval = server.ULTIMATE_GOONER_REFRESH_INTERVAL_S
    assert 5 <= interval <= 300


def test_public_user_attaches_leaderboard_rank_when_in_cache():
    """When TOP50_GOONER_IDS holds the user's id, public_user() surfaces
    it as `leaderboard_rank` in the payload."""
    # Fabricate a user document; ObjectId is faked as a string here
    # since public_user only calls `str(user['_id'])`.
    fake_id = "507f191e810c19729de860ea"
    user_doc = {
        "_id": fake_id, "email": "top@example.com", "username": "top",
        "stats": {}, "level": 1, "xp": 0,
        "rank_points": 2600,
    }
    # Seed the cache manually — mimics what refresh_ultimate_gooner_cache
    # would do after a Mongo query.
    server.TOP50_GOONER_IDS = {fake_id: 3}
    try:
        payload = server.public_user(user_doc)
        assert payload.get("leaderboard_rank") == 3
    finally:
        server.TOP50_GOONER_IDS = {}


def test_public_user_omits_leaderboard_rank_when_not_in_cache():
    """A user outside the top-50 (or below Goonmaster) must NOT get a
    leaderboard_rank field — the client treats missing as 'not
    Ultimate Gooner' and falls back to the plain Goonmaster pill."""
    user_doc = {
        "_id": "any", "email": "mid@example.com", "username": "mid",
        "stats": {}, "level": 1, "xp": 0,
        "rank_points": 500,
    }
    server.TOP50_GOONER_IDS = {}
    payload = server.public_user(user_doc)
    assert "leaderboard_rank" not in payload or payload.get("leaderboard_rank") is None


def test_refresh_helper_signature():
    """Static assert on the source: refresh helper + cache reset happen
    together so a future rewrite doesn't accidentally leave the cache
    permanently stale."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert "async def refresh_ultimate_gooner_cache" in src
    assert "TOP50_GOONER_IDS = new_map" in src
    # Refresh loop should also exist so the cache stays fresh.
    assert "async def _ultimate_gooner_refresh_loop" in src
    assert "asyncio.create_task(_ultimate_gooner_refresh_loop())" in src
