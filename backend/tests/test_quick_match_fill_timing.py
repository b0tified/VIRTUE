"""Quick Match bot-fill timing: 6s not 10s.

User asked: "Make the quick play queue more likely to find a game
before the 11 second mark." Dropped CASUAL_BOT_FILL_SEC from 10s to 6s
so a solo-queued player (no human opponent found) gets a bot-filled
match in ~6s + the 3-2-1 overlay (~9s total to in-game) instead of
~10s + 3s (~13s total) which routinely crested past 11s.

Keep this guard in place so a future tuning pass doesn't silently
bump the constant back up and reintroduce the slow-queue complaint.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_casual_bot_fill_under_11s_budget():
    """Total time-to-in-game = CASUAL_BOT_FILL_SEC + ~3s match-found
    countdown. Must stay <= 10s so a solo queuer always lands under
    the 11s mark that the user flagged."""
    assert server.CASUAL_BOT_FILL_SEC + 3 <= 10, (
        f"Quick Match total time budget blown — bot_fill={server.CASUAL_BOT_FILL_SEC}s + 3s "
        f"countdown = {server.CASUAL_BOT_FILL_SEC + 3}s. Keep under 10s so solo queuers "
        f"always see a match-found before the 11s mark the user complained about."
    )


def test_casual_bot_fill_is_six_seconds():
    """Specific pin: 6s is the tuned sweet spot — leaves room for two
    humans to queue within the window (so head-to-head still fires)
    but is tight enough that solo queuers never notice."""
    assert server.CASUAL_BOT_FILL_SEC == 6.0


def test_api_response_surfaces_new_bot_fill_to_client():
    """The GET /queue/casual response must carry `bot_fill_seconds`
    so the client's countdown overlay auto-adjusts without a
    hard-coded fallback diverging."""
    import inspect
    src = inspect.getsource(server.queue_casual_state)
    assert '"bot_fill_seconds": int(CASUAL_BOT_FILL_SEC)' in src, (
        "queue_casual_state must pass CASUAL_BOT_FILL_SEC through to the client — "
        "otherwise the client's hard-coded fallback (10) will mismatch the server timer."
    )
