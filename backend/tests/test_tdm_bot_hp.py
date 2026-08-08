"""TDM bot HP: every bot spawned into a TDM room must get 100 HP
(same pool as human players) regardless of difficulty.

Ranked bots were already normalized to 100 HP a few iterations back
(so aim/positioning, not damage-sponge HP, made high-tier bots
threatening). This test extends that guarantee to TDM — quick-match
TDM, practice TDM, and per-party TDM rooms.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _make_tdm_room():
    return server.GameRoom(is_ranked=False, match_duration=60.0, game_mode="tdm")


def _make_ffa_room():
    return server.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")


def test_tdm_bots_have_full_100_hp_regardless_of_difficulty():
    """The pre-fill difficulty (1.45) and the practice-TDM difficulty
    (1.2) both used to yield inflated HP (80 * diff). After this fix
    every TDM bot must equal MAX_HP == 100."""
    room = _make_tdm_room()
    for diff in (0.6, 1.0, 1.2, 1.45, 1.9, 2.5):
        bot = room.spawn_bot("t", disguised=True, difficulty=diff)
        assert bot.max_hp == server.MAX_HP == 100, (
            f"TDM bot @ difficulty {diff} got max_hp={bot.max_hp}, expected 100"
        )
        assert bot.hp == bot.max_hp


def test_ffa_casual_bots_keep_scaled_hp():
    """Regression guard — non-ranked FFA bots keep the classic
    BOT_MAX_HP * difficulty scaling so practice / casual play stays
    forgiving. Only ranked + TDM get the 100-HP normalization."""
    room = _make_ffa_room()
    bot = room.spawn_bot("f", disguised=False, difficulty=1.0)
    # 80 * 1.0 = 80
    assert bot.max_hp == server.BOT_MAX_HP


def test_ranked_bots_still_have_100_hp():
    """The pre-existing ranked HP normalization must remain intact."""
    room = server.GameRoom(is_ranked=True, match_duration=300.0, game_mode="ffa")
    bot = room.spawn_bot("r", disguised=True, difficulty=1.9)
    assert bot.max_hp == server.MAX_HP == 100
