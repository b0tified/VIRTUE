"""Sniper weapon + loadout endpoint contract tests.

Locks in the CURRENT sniper spec (rework 2026-02):
  1. Sniper weapon config: 50 body damage, 2-round mag, 1.5s reload,
     ads_only=False (hip-fire allowed), 2.0x headshot for 1-shot HS.
  2. Player's ammo dict initialises with a sniper key = 2 so switching
     to sniper doesn't produce undefined ammo.
  3. `PRIMARY_WEAPON_CHOICES` accepts only "ak47" and "sniper".
  4. `public_user()` exposes `primary_weapon` so the lobby loadout
     picker can render the current selection.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_sniper_config_two_shot_body_one_shot_head():
    """Sniper does 50 body damage (2-shot body kill) with a 2.0x
    headshot multiplier (1-shot head kill on 100 HP)."""
    cfg = server.weapon_cfg("sniper")
    assert cfg["damage"] == 50
    # 2 body shots must kill a full-HP player.
    assert cfg["damage"] * 2 >= server.MAX_HP
    # 1 headshot must kill.
    assert cfg["damage"] * cfg["headshot_mult"] >= server.MAX_HP


def test_sniper_two_rounds_and_reload():
    """2 bullets before mandatory reload, 1.5s reload timer."""
    cfg = server.weapon_cfg("sniper")
    assert cfg["mag_size"] == 2
    assert cfg["reload_ms"] == 1500


def test_sniper_hipfire_allowed():
    """`ads_only=False` — sniper can hip-fire per the rework."""
    cfg = server.weapon_cfg("sniper")
    assert cfg.get("ads_only") is False
    assert not server.weapon_cfg("ak47").get("ads_only")


def test_player_ammo_dict_includes_sniper():
    """A freshly-constructed Player must have a sniper ammo entry equal
    to the current mag_size (2). Without this, switching to sniper
    would read ammo=undefined and the client's fire prediction would
    misbehave — and starting with ammo=1 would trigger a premature
    reload after the very first shot."""
    p = server.Player(ws=None, is_bot=True, bot_name="TestBot")
    assert "sniper" in p.ammo
    assert p.ammo["sniper"] == 2


def test_primary_weapon_choices_locked():
    """The set of allowed choices for /profile/me/weapon."""
    assert server.PRIMARY_WEAPON_CHOICES == {"ak47", "sniper"}


def test_public_user_exposes_primary_weapon_default():
    """Legacy accounts without a `primary_weapon` field default to
    'ak47' in the public payload (so the lobby loadout picker shows
    AK-47 pre-selected on first login)."""
    user_doc = {
        "_id": "u1", "email": "test@x.com", "username": "test",
        "stats": {}, "level": 1, "xp": 0,
    }
    payload = server.public_user(user_doc)
    assert payload["primary_weapon"] == "ak47"


def test_public_user_reflects_saved_weapon():
    """Saved 'sniper' is reflected in the public payload."""
    user_doc = {
        "_id": "u1", "email": "test@x.com", "username": "test",
        "stats": {}, "level": 1, "xp": 0,
        "primary_weapon": "sniper",
    }
    payload = server.public_user(user_doc)
    assert payload["primary_weapon"] == "sniper"


def test_weapon_choice_endpoint_persists_choice():
    """The /profile/me/weapon endpoint updates user.primary_weapon.
    Read the source to confirm the write happens (avoids a full
    HTTP integration test)."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    marker = 'async def set_primary_weapon'
    assert marker in src
    idx = src.find(marker)
    window = src[idx:idx + 800]
    assert '"primary_weapon": choice' in window
    assert 'PRIMARY_WEAPON_CHOICES' in window
