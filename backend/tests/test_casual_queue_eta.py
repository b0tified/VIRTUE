"""Quick-play (casual) queue ETA tests.

Per user request, the Quick Play queue toast now shows an estimated
wait time — sampled once at join (3-12s window) and preserved across
polls by the client-side lock. This file guards:
  • POST /queue/casual returns `estimated_wait_seconds` (int, 3-12).
  • GET  /queue/casual returns the SAME value stored on the queue
    entry so multiple polls read a consistent number.
  • DELETE /queue/casual cleans up the entry.
"""
import sys
import pathlib
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _user(uid: str) -> dict:
    return {
        "_id": uid,
        "email": f"{uid}@t.test",
        "username": uid,
        "stats": {"kills": 5, "deaths": 3, "matches": 4, "wins": 2},
        "rank_points": 0,
    }


@pytest.fixture(autouse=True)
def _reset_casual():
    server.CASUAL_QUEUE.clear()
    server.MATCHED_USERS.clear()
    yield
    server.CASUAL_QUEUE.clear()
    server.MATCHED_USERS.clear()


@pytest.mark.asyncio
async def test_join_returns_estimated_wait_seconds_in_valid_range():
    """POST /queue/casual must return an integer ETA sampled in the
    3-12s window per the tuning in server.py."""
    for _ in range(60):
        server.CASUAL_QUEUE.clear()
        u = _user("eta_u")
        out = await server.queue_casual_join(user=u)
        assert out.get("ok") is True
        eta = out.get("estimated_wait_seconds")
        assert isinstance(eta, int)
        assert 3 <= eta <= 12, f"eta={eta} outside 3-12 window"


@pytest.mark.asyncio
async def test_get_returns_same_eta_as_stored_on_queue_entry():
    """The GET response must reflect the SAME estimated wait that was
    stamped on the entry at join time — otherwise the client lock is
    pointless (the number would still swing per poll)."""
    u = _user("eta_stable")
    out = await server.queue_casual_join(user=u)
    stamped = int(out["estimated_wait_seconds"])
    # Poll a few times — every poll must return the exact same value.
    for _ in range(5):
        s = await server.queue_casual_state(user=u)
        assert s.get("in_queue") is True
        assert int(s.get("estimated_wait_seconds", -1)) == stamped


@pytest.mark.asyncio
async def test_leave_clears_queue_entry():
    """DELETE /queue/casual removes the entry so a re-join re-rolls
    the ETA (rather than reusing a stale one)."""
    u = _user("eta_leaver")
    out1 = await server.queue_casual_join(user=u)
    eta1 = out1["estimated_wait_seconds"]
    await server.queue_casual_leave(user=u)
    s = await server.queue_casual_state(user=u)
    assert s.get("in_queue") is False
    # Re-join; per RNG we'd occasionally match by coincidence, but the
    # doc definitely needs a fresh (re-sampled) ETA field.
    out2 = await server.queue_casual_join(user=u)
    assert "estimated_wait_seconds" in out2
    # Value MAY be equal by chance — assert the field exists rather
    # than force inequality (would flake ~1/9 runs).
    assert isinstance(out2["estimated_wait_seconds"], int)
    del eta1  # silence unused warning
