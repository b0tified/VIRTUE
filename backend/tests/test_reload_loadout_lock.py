"""Regression test for the "sniper randomly becomes AK" bug.

Root cause: the client's reload-pressed handler used to hardcode
`weapon: "ak47"` for the primary slot. The server's reload handler
then set `player.weapon = "ak47"` — even if the player's loadout
was actually `sniper`. The very next state broadcast then reported
`p.weapon = "ak47"` back to the client, which mirrored it into
`primaryWeaponId` and swapped the visible viewmodel to the AK.

Fix (defense in depth on the server): the reload handler now uses
the same "snap back to `_primary_loadout`" logic as the input tick
and shoot handler, so a stale/malicious client can't flip loadouts
through the reload path either.
"""
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()


def test_reload_handler_snaps_back_to_loaded_primary():
    """The reload branch must reference `_primary_loadout` before
    setting `player.weapon`, otherwise a client sending
    `{type: 'reload', weapon: 'ak47'}` while loaded as sniper would
    flip the server-side weapon."""
    # Find the reload handler block.
    marker = 'elif mtype == "reload":'
    idx = SRC.find(marker)
    assert idx >= 0, "reload handler missing"
    block = SRC[idx: idx + 900]
    # Must consult the loadout before writing player.weapon.
    assert "_primary_loadout" in block, (
        "reload handler must snap back to `_primary_loadout` — otherwise "
        "clients hardcoding weapon='ak47' will overwrite a sniper loadout."
    )
    # Must gate on the primary set specifically so laser reloads still work.
    assert '("ak47", "sniper")' in block, "reload handler must guard the ak47/sniper pair"


def test_input_tick_still_guards_loadout():
    """The pre-existing input-tick loadout guard must still be present
    (this bug was previously fixed there; the reload path was the last
    channel that could bypass it)."""
    idx = SRC.find('if mtype == "input":')
    assert idx >= 0
    block = SRC[idx: idx + 3000]
    assert "_primary_loadout" in block, "input tick loadout guard regressed"


def test_shoot_handler_still_guards_loadout():
    """Same for the shoot handler."""
    idx = SRC.find('elif mtype == "shoot":')
    assert idx >= 0
    block = SRC[idx: idx + 2500]
    assert "_primary_loadout" in block, "shoot handler loadout guard regressed"
