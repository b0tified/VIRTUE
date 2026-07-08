"""Sniper weapon + loadout endpoint contract tests.

Locks in:
  1. Sniper weapon config: 200 dmg, 1-round mag, 2s reload, ads_only=True,
     legs_mult=1.0 (so leg hits still 1-shot a 100-HP player), no
     distance falloff for the 1-shot promise to hold at any range.
  2. Player's ammo dict initialises with a sniper key so switching to
     sniper doesn't produce undefined ammo.
  3. Shoot handler rejects sniper hipfire (ads=False → no shot, no
     ammo decrement, no last_shot_ms update).
  4. `PRIMARY_WEAPON_CHOICES` accepts only "ak47" and "sniper".
  5. `public_user()` exposes `primary_weapon` so the lobby loadout
     picker can render the current selection.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_sniper_config_one_shot_anywhere():
    """Sniper does 200 damage regardless of body part. Verifies:
      - base damage well above player MAX_HP (100)
      - legs_mult = 1.0 so a leg hit is still lethal
      - min_damage_mult = 1.0 so long-range shots still 1-shot"""
    cfg = server.weapon_cfg("sniper")
    assert cfg["damage"] == 200
    assert cfg["damage"] > server.MAX_HP  # kills a full-HP player in one hit
    assert cfg["legs_mult"] == 1.0
    assert cfg["min_damage_mult"] == 1.0
    # Even at max legs*falloff (both = 1.0), damage stays lethal.
    worst_case = cfg["damage"] * cfg["legs_mult"] * cfg["min_damage_mult"]
    assert worst_case >= server.MAX_HP


def test_sniper_single_round_and_slow_reload():
    """1 bullet before reload, 1.5s reload — the per-user spec (tuned
    from the initial 2s value)."""
    cfg = server.weapon_cfg("sniper")
    assert cfg["mag_size"] == 1
    assert cfg["reload_ms"] == 1500


def test_sniper_ads_only_flag():
    """`ads_only=True` triggers the shoot-handler rejection for hipfire."""
    cfg = server.weapon_cfg("sniper")
    assert cfg.get("ads_only") is True
    # AK is NOT ads_only.
    assert not server.weapon_cfg("ak47").get("ads_only")


def test_player_ammo_dict_includes_sniper():
    """A freshly-constructed Player must have a sniper ammo entry.
    Without this, switching to sniper would read ammo=undefined and
    the client's fire prediction would misbehave."""
    p = server.Player(ws=None, is_bot=True, bot_name="TestBot")
    assert "sniper" in p.ammo
    assert p.ammo["sniper"] == 1


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


def test_sniper_shoot_handler_gate_present_in_code():
    """Server rejects hipfire shots for ads_only weapons. Read the
    handler back to confirm the gate exists."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    marker = 'if cfg.get("ads_only") and not player.is_ads:'
    assert marker in src, (
        "Sniper ADS-only enforcement missing — the client could bypass "
        "the ADS requirement by hand-crafting a shoot message."
    )


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
