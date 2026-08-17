"""Regression tests for the admin live-stats "real online" + peak
player-count enhancements.

User request (2026-02-24):
  > Make real online player stat in moderation show people also just
  > in lobby. Add peak playercount to moderation.

Before this fix, `real_online` was `len(ONLINE_USERS)` — only WS-connected
players (in-match). Someone sitting on the lobby screen browsing
challenges or friends never showed up.

The fix introduces `count_real_online()` which UNIONS:
  - `ONLINE_USERS` keys (in-match WS connections)
  - `PRESENCE_HEARTBEAT` keys with a fresh heartbeat (<= HEARTBEAT_TTL)

and side-effects `PEAK_ONLINE` so admins get an all-time high-water
mark in the moderation dashboard.
"""
import sys
import pathlib
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_presence():
    """Every test starts with a fresh presence world so ordering
    doesn't matter."""
    srv.ONLINE_USERS.clear()
    srv.PRESENCE_HEARTBEAT.clear()
    srv.PEAK_ONLINE["value"] = 0
    srv.PEAK_ONLINE["at"] = None
    yield
    srv.ONLINE_USERS.clear()
    srv.PRESENCE_HEARTBEAT.clear()


class TestCountRealOnline:
    def test_ws_users_counted(self):
        srv.ONLINE_USERS["u1"] = 1
        srv.ONLINE_USERS["u2"] = 2
        assert srv.count_real_online() == 2

    def test_lobby_heartbeat_users_counted(self):
        """The exact bug the user reported — lobby users must count."""
        srv.PRESENCE_HEARTBEAT["lobby1"] = time.time()
        srv.PRESENCE_HEARTBEAT["lobby2"] = time.time() - 5   # still fresh
        assert srv.count_real_online() == 2

    def test_union_no_double_count(self):
        """A user with both an active WS AND a heartbeat (edge case
        during tab reload) counts once — this was the trap the naive
        `len(ONLINE_USERS) + len(PRESENCE_HEARTBEAT)` fix would fall
        into, so guard against it explicitly."""
        srv.ONLINE_USERS["shared"] = 1
        srv.PRESENCE_HEARTBEAT["shared"] = time.time()
        srv.ONLINE_USERS["ws_only"] = 1
        srv.PRESENCE_HEARTBEAT["lobby_only"] = time.time()
        assert srv.count_real_online() == 3

    def test_stale_heartbeats_dropped(self):
        """Heartbeats older than TTL don't count AND get GC'd from the
        dict so it doesn't grow unbounded during a long uptime."""
        srv.PRESENCE_HEARTBEAT["stale"] = time.time() - (srv.HEARTBEAT_TTL + 5)
        srv.PRESENCE_HEARTBEAT["fresh"] = time.time()
        assert srv.count_real_online() == 1
        assert "stale" not in srv.PRESENCE_HEARTBEAT
        assert "fresh" in srv.PRESENCE_HEARTBEAT


class TestPeakOnlineTracking:
    def test_peak_updates_when_count_climbs(self):
        srv.ONLINE_USERS["a"] = 1
        srv.count_real_online()
        assert srv.PEAK_ONLINE["value"] == 1
        srv.ONLINE_USERS["b"] = 1
        srv.ONLINE_USERS["c"] = 1
        srv.count_real_online()
        assert srv.PEAK_ONLINE["value"] == 3

    def test_peak_does_not_decrease(self):
        """Once the peak is set, dropping below it keeps the record."""
        srv.ONLINE_USERS["a"] = 1
        srv.ONLINE_USERS["b"] = 1
        srv.count_real_online()
        assert srv.PEAK_ONLINE["value"] == 2
        srv.ONLINE_USERS.pop("b")
        srv.count_real_online()
        assert srv.PEAK_ONLINE["value"] == 2, "Peak must persist across dips"

    def test_peak_stamps_iso_timestamp(self):
        """Admin dashboard shows a human-readable 'peak hit at' time —
        the stored value must be a valid ISO string."""
        from datetime import datetime
        srv.ONLINE_USERS["a"] = 1
        srv.count_real_online()
        at = srv.PEAK_ONLINE["at"]
        assert isinstance(at, str)
        # Parses cleanly as ISO 8601.
        datetime.fromisoformat(at)


def test_admin_live_stats_source_uses_count_real_online():
    """Grep guard on server.py: the admin endpoint must call the new
    helper (not read `len(ONLINE_USERS)` directly) so lobby users are
    counted. Also asserts the payload carries the new peak / split
    fields the frontend now renders."""
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    assert '"real_online": count_real_online()' in src, (
        "admin/live-stats no longer calls count_real_online() — lobby "
        "users will drop out of the count again."
    )
    assert '"peak_online": int(PEAK_ONLINE' in src, (
        "admin/live-stats no longer emits `peak_online` — moderation "
        "dashboard peak tile regressed."
    )
    assert '"real_online_in_lobby":' in src, (
        "admin/live-stats no longer breaks down lobby vs in-match — "
        "the sub-label on the Real Online tile regressed."
    )
