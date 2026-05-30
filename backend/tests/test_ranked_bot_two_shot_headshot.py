"""Regression: ranked smart bots fire with full AK weapon damage so a
landed headshot 2-shots a full-HP player. Casual/offline bots keep
their gentler difficulty-scaled damage curve."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_ak_two_shot_headshot_math():
    """Two ranked-bot AK headshots must totally exceed 100 HP (kill).
    A single body shot must NOT kill (so the bot still feels fair)."""
    cfg = server.WEAPON_CONFIGS["ak47"]
    body = cfg["damage"]
    head = int(round(cfg["damage"] * cfg["headshot_mult"]))
    assert head >= 50, f"AK headshot must be >=50, got {head}"
    assert 2 * head >= 100, f"Two AK headshots must kill: {2 * head}"
    assert body < 100, f"Single AK body shot must NOT kill, got {body}"


def test_bot_damage_branch_uses_weapon_mults_when_flag_set():
    """Source-level: the _apply_shoot bot branch must reference the
    `_apply_weapon_mults` flag — that's how ranked smart bots opt in
    to the headshot/legs multipliers."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    apply_idx = src.index("async def _apply_shoot")
    chunk = src[apply_idx : apply_idx + 3500]
    assert "_apply_weapon_mults" in chunk, \
        "_apply_shoot must check the _apply_weapon_mults flag to enable headshot multipliers on ranked bots."


def test_fire_control_sets_flag_only_for_ranked_smart_bots():
    """Source-level: the fire-control block must:
       (a) set _apply_weapon_mults=True ONLY when ranked AND smart, and
       (b) use AK cfg damage as base for those bots, not BOT_SHOT_DAMAGE.
    """
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # The combined assignment ("smart and self.is_ranked" → cfg-damage)
    assert "if smart and self.is_ranked:" in src
    assert "bot._apply_weapon_mults = True" in src
    assert "weapon_cfg(\"ak47\")[\"damage\"]" in src
    # Non-ranked branch must explicitly reset the flag so a bot doesn't
    # carry over a True from a prior tick after a context switch.
    assert "bot._apply_weapon_mults = False" in src
