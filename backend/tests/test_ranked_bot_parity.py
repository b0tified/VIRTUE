"""Ranked bot HP + damage parity — ranked bots must have the same HP
pool and damage output as a real player. No difficulty-scaled HP,
no missing distance falloff.

Before this parity fix, a Goonmaster ranked bot had 80×3.7 = 296 HP
(effectively 3 mags to kill vs 4 shots to kill a player) AND dealt full
25 damage at 40m where a player would deal ~13 (falloff). The user
correctly flagged this as unfair — ranked bots should be a mechanical
skill test, not a damage-sponge / falloff-exempt cheese engine.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_ranked_bot_hp_equals_player_hp():
    """Ranked room spawns bots at PLAYER_MAX_HP (100), regardless of
    difficulty. Sweep the full ranked difficulty range."""
    room = server.GameRoom(is_ranked=True)
    for diff in [1.9, 2.2, 2.5, 2.8, 3.1, 3.4, 3.7]:
        bot = room.spawn_bot(f"TestBot-{diff}", difficulty=diff)
        assert bot.max_hp == server.MAX_HP, (
            f"Ranked bot at diff={diff} has max_hp={bot.max_hp}, "
            f"expected {server.MAX_HP} (player's HP)"
        )
        assert bot.hp == server.MAX_HP


def test_casual_bot_hp_still_scales():
    """Casual and offline practice bots should keep the old
    difficulty-scaled HP — they're forgiving practice fodder, not the
    ladder challenge."""
    room = server.GameRoom(is_ranked=False)
    bot = room.spawn_bot("EasyBot", difficulty=1.15)
    # Difficulty 1.15 * BOT_MAX_HP 80 ≈ 92 HP — the old formula.
    assert bot.max_hp == int(server.BOT_MAX_HP * 1.15)


def test_ranked_bot_damage_matches_player_base():
    """Ranked smart bots use `weapon_cfg('ak47')['damage']` (25) — same
    as the player's base damage. Verify the config."""
    cfg = server.weapon_cfg("ak47")
    assert cfg["damage"] == 25
    assert cfg["headshot_mult"] == 2.0  # 25 * 2.0 = 50 head damage (player parity)


def test_ranked_bot_falloff_present_in_code():
    """Read the damage-scaling code back to confirm the falloff block
    was added for ranked bots. Without it, ranked bots would ignore
    distance and out-damage players at range."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # Anchor on the ranked-bot-specific comment inserted with the fix so
    # we're checking THE bot damage block (not an earlier `is_bot`
    # branch used for spread calc).
    marker = "Distance falloff parity with players"
    assert marker in src, (
        "Ranked-bot distance-falloff parity block is missing — bots "
        "will out-damage players at range."
    )
    # Confirm the falloff math itself is present nearby.
    idx = src.find(marker)
    window = src[idx:idx + 800]
    assert "falloff_start" in window and "falloff_end" in window


def test_shots_to_kill_player_and_ranked_bot_match():
    """AK body damage 25 → 4 shots to kill a 100-HP target. Ranked bots
    at any difficulty should be 4-shot-to-kill (same as player)."""
    ak_body_dmg = server.weapon_cfg("ak47")["damage"]
    shots_to_kill_player = -(-server.MAX_HP // ak_body_dmg)  # ceil div
    assert shots_to_kill_player == 4

    room = server.GameRoom(is_ranked=True)
    # Sweep across the ranked difficulty spectrum.
    for diff in [1.9, 2.8, 3.7]:
        bot = room.spawn_bot(f"Bot-{diff}", difficulty=diff)
        stk = -(-bot.max_hp // ak_body_dmg)
        assert stk == shots_to_kill_player, (
            f"Ranked bot at diff={diff} takes {stk} AK body shots to "
            f"kill vs player's {shots_to_kill_player}. Not parity."
        )
