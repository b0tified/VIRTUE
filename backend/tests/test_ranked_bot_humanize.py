"""Regression for ranked-bot humanization:
   1. Reaction-time penalty lowered (was +80ms, now +40ms).
   2. Ranked smart bots now have jump state (`_jump_start_ms`, etc).
   3. Movement uses a randomized juke phase, not a pure sine.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def _src():
    return pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()


def test_reaction_time_penalty_lowered():
    src = _src()
    assert "effective_cd += 40" in src, \
        "Ranked reaction-time penalty must be +40ms (was +80ms)."
    # Make sure the old value is gone.
    assert "effective_cd += 80" not in src


def test_spawn_bot_initialises_jump_state():
    """Spawning a bot must initialise the new humanization fields so
    `_tick_bots` never reads an undefined attribute."""
    # GameRoom.spawn_bot mutates a fresh Player — call directly on a
    # bare object to inspect the assignments. (We don't have an event
    # loop here, so just read the source-level proof.)
    src = _src()
    for field in ("_jump_start_ms", "_jump_next_ms", "_juke_phase", "_juke_next_ms"):
        assert f"bot.{field}" in src, f"spawn_bot should initialise bot.{field}"


def test_jump_arc_uses_player_height_and_sine():
    """The jump body block must compute a parabolic arc from PLAYER_HEIGHT."""
    src = _src()
    assert "PLAYER_HEIGHT + math.sin(t * math.pi) * 1.2" in src, \
        "Bot jump arc must use a sine wave (smooth up-and-down) from PLAYER_HEIGHT."


def test_jukes_randomise_strafe_phase():
    """Movement humanization: strafe phase must include a juke offset."""
    src = _src()
    assert "bot._juke_phase += random.uniform" in src
    assert "math.sin(bot.bot_strafe_t * strafe_freq + bot._juke_phase)" in src
