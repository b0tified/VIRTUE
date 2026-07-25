"""Sniper rework:
  - Mag: 1 → 2 shots before reload
  - Body damage: 200 → 50 (needs 2 body shots to down a 100 HP target)
  - Headshot mult: 1.0 → 2.0 (50 × 2 = 100 = 1-shot headshot kill)
  - Hip fire: now allowed (ads_only False)
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_sniper_mag_size_is_2():
    assert server.WEAPON_CONFIGS["sniper"]["mag_size"] == 2, (
        "sniper mag must be 2 (up from 1) per user request."
    )


def test_sniper_body_damage_is_50():
    assert server.WEAPON_CONFIGS["sniper"]["damage"] == 50, (
        "sniper body damage must be 50 so 2 body shots = 100 HP = lethal."
    )


def test_sniper_headshot_still_1shots():
    cfg = server.WEAPON_CONFIGS["sniper"]
    body = cfg["damage"]
    hs = body * cfg["headshot_mult"]
    assert hs >= server.MAX_HP, (
        f"sniper headshot ({hs}) must still one-shot MAX_HP ({server.MAX_HP})."
    )
    assert cfg["headshot_mult"] == 2.0


def test_sniper_can_hip_fire():
    """`ads_only` must be False so the server no longer rejects sniper
    shots from the hip."""
    assert server.WEAPON_CONFIGS["sniper"].get("ads_only", True) is False, (
        "sniper hip-fire lockout removed per user request."
    )


def test_sniper_body_shot_needs_two_hits_to_kill():
    """Two body shots equal MAX_HP exactly — one body shot leaves the
    target on life-support (50 HP)."""
    body = server.WEAPON_CONFIGS["sniper"]["damage"]
    assert body < server.MAX_HP, "1 body shot must NOT kill (was previously 200 dmg)."
    assert body * 2 >= server.MAX_HP, "2 body shots must kill outright."
