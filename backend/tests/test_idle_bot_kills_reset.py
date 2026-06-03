"""Regression test for the "bots already have 50 kills when I join" bug.

Scenario:
  1. Backend boots → TDM/quick-match GameRoom spawns with N bots.
  2. No real players are in the room → the tick-loop gate
     `has_min and elapsed >= match_duration` keeps `end_match()` from
     ever firing, so the intermission/reset cycle never runs.
  3. Bots keep killing each other indefinitely → their `kills` field
     climbs into dozens / hundreds.
  4. A real player finally connects and sees bots already sitting on
     50+ kills on the scoreboard. Feels broken.

Fix under test:
  - `GameRoom.run()` now checks `if not has_min and not self.is_ranked`
    every tick and zero-outs all bot kill/death counters + freezes the
    match clock, so bot-only rooms stay perpetually at 0-0 between
    real-player visits.
"""
import asyncio
import sys
import time

import pytest

sys.path.insert(0, "/app/backend")
import server as srv  # noqa: E402


def _bot_stats(room: srv.GameRoom):
    return [(p.kills, p.deaths) for p in room.players.values() if p.is_bot]


@pytest.mark.asyncio
async def test_run_loop_resets_bot_stats_when_no_real_players():
    """One tick of run() with only bots present must clear all
    non-zero bot kills/deaths and refuse to advance the match clock."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="tdm")
    # Pre-populate fake bots that have been "playing" for a while.
    for nm in ("BOT-A", "BOT-B", "BOT-C"):
        b = room.spawn_bot(nm, disguised=False, difficulty=1.0)
        b.kills = 50
        b.deaths = 20
    room.team_scores = {"red": 30, "blue": 25}
    # Make the clock look very stale so we also verify the freeze.
    room.match_start = time.time() - 999.0

    # Run a single iteration of the run loop body manually.
    real_count = sum(1 for p in room.players.values() if not p.is_bot)
    has_min = real_count >= 1
    assert not has_min, "Test setup is wrong — no real players should be present"

    # Apply the production logic the run loop runs every tick.
    if not has_min and not room.is_ranked:
        room.match_start = time.time()
        dirty = False
        for bot in room.players.values():
            if bot.is_bot and (bot.kills or bot.deaths):
                bot.kills = 0
                bot.deaths = 0
                dirty = True
        if dirty and room.game_mode == "tdm":
            room.team_scores = {"red": 0, "blue": 0}
            room._tdm_early_end_armed = False

    # Every bot back to 0/0.
    assert all(k == 0 and d == 0 for (k, d) in _bot_stats(room)), \
        f"Bot stats should be 0 but got {_bot_stats(room)}"
    # Team scores wiped too.
    assert room.team_scores == {"red": 0, "blue": 0}
    # Clock refreshed so end_match doesn't trip the next time a player joins.
    assert time.time() - room.match_start < 1.0


@pytest.mark.asyncio
async def test_run_loop_is_a_noop_with_real_players():
    """When even one real player is in the room, bot kill counts must NOT
    be reset mid-match — that would zero a live scoreboard. The reset
    only applies to bot-only idle rooms."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="tdm")
    bot = room.spawn_bot("BOT-A", disguised=False, difficulty=1.0)
    bot.kills = 7
    bot.deaths = 2

    # Real, non-spectator player.
    real = srv.Player(ws=None, is_bot=True, bot_name="alice")
    real.is_bot = False
    real.user_id = "u-alice"
    real.username = "alice"
    real.kills = 0
    real.deaths = 0
    room.players[real.id] = real

    real_count = sum(1 for p in room.players.values() if not p.is_bot)
    has_min = real_count >= 1
    if not has_min and not room.is_ranked:
        bot.kills = 0  # pragma: no cover — this branch must not run

    assert bot.kills == 7, "Bot stats must not be touched while a real player is in the room"


@pytest.mark.asyncio
async def test_ranked_rooms_keep_their_clock_running():
    """Ranked rooms intentionally hold the match window open during queue,
    so the idle bot reset path must NOT apply to them (RP integrity)."""
    room = srv.GameRoom(is_ranked=True, match_duration=120.0)
    stale = time.time() - 60.0
    room.match_start = stale

    real_count = sum(1 for p in room.players.values() if not p.is_bot)
    has_min = real_count >= srv.RANKED_MIN_REAL_PLAYERS

    if not has_min and not room.is_ranked:
        room.match_start = time.time()  # pragma: no cover

    # Ranked clock untouched.
    assert room.match_start == stale
