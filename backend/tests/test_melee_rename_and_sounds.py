"""Regression test — 2026-02-25.

User request bundle:
  - "change kitana name to melee"
  - "give melee punch sound effect make other player be able to hear
     it while they are close"
  - "laser doesnt make sound to other players"
"""
import pathlib


AUDIO = pathlib.Path("/app/frontend/src/game/audio.js").read_text(encoding="utf-8")
ENGINE = pathlib.Path("/app/frontend/src/game/engine.js").read_text(encoding="utf-8")
GAME = pathlib.Path("/app/frontend/src/pages/Game.jsx").read_text(encoding="utf-8")
HUD = pathlib.Path("/app/frontend/src/components/Hud.jsx").read_text(encoding="utf-8")


# ─── "change kitana name to melee" ─────────────────────────────────────


def test_no_user_facing_katana_labels_remain():
    """The player-visible label must read 'MELEE' everywhere the
    UI historically said 'KATANA'. Internal ids (weapon: "katana"
    in kill records) can stay so we don't invalidate historical
    match_history entries."""
    hud = HUD
    assert 'label: "MELEE"' in hud, (
        "Hud.jsx WEAPON_META for the melee weapon must display 'MELEE'."
    )
    assert 'label: "KATANA"' not in hud
    # Selected-weapon HUD label switch — the ternary for
    # `hud.weapon === "secondary"` must resolve to "MELEE".
    assert '"MELEE" :' in hud, (
        "Hud.jsx selected-weapon label must render 'MELEE' for "
        "secondary (was 'KATANA')."
    )
    # Advanced controls / rebind panel — the row for weapon slot 2.
    adv = pathlib.Path("/app/frontend/src/components/AdvancedControls.jsx").read_text(encoding="utf-8")
    assert "Weapon 2 (Melee)" in adv
    assert "Weapon 2 (Katana)" not in adv
    # Profile kill-feed weapon glyph label.
    prof = pathlib.Path("/app/frontend/src/pages/Profile.jsx").read_text(encoding="utf-8")
    assert '"MELEE"' in prof
    assert '"KATANA"' not in prof


# ─── "give melee punch sound effect" ───────────────────────────────────


def test_audio_bus_has_punch_swing():
    assert "_punchSwing(shooterId, vol, out)" in AUDIO, (
        "audio.js must define `_punchSwing` — the melee weapon's new "
        "sound effect. A short body-thump + noise crack that reads "
        "as 'fist meets chest'."
    )
    # gunshot() router must dispatch weapon:"melee" (and the legacy
    # id "katana") to the new punch SFX.
    body = AUDIO.split("gunshot(shooterId", 1)[1][:1400]
    assert 'weapon === "melee" || weapon === "katana"' in body, (
        "gunshot() dispatch must route BOTH the new `melee` id and "
        "the legacy `katana` id to _punchSwing."
    )
    assert "this._punchSwing" in body


def test_local_melee_swing_triggers_local_sound():
    """The fire() melee path used to just set pendingMelee and return
    silently — no local audio feedback. Now it must also call
    `this.onShoot?.()` so the local player hears their own punch
    right when they click, without waiting for a server round-trip."""
    fire_body = ENGINE.split("// melee path", 1)[1][:600]
    assert "this.onShoot?.()" in fire_body, (
        "engine.js fire() melee branch must call `this.onShoot?.()` "
        "so the local swing plays the punch SFX immediately."
    )
    # Game.jsx's onShoot handler must route currentWeapon===`secondary`
    # (melee) to weapon:"melee" so audioBus picks _punchSwing.
    onshoot = GAME.split("engine.onShoot", 1)[1][:800]
    assert '"secondary"' in onshoot and '"melee"' in onshoot, (
        "Game.jsx onShoot handler must map `currentWeapon === "
        "\"secondary\"` to weapon:\"melee\" for the audio bus."
    )


# ─── "make other player be able to hear it while they are close" ───────


def test_remote_melee_broadcasts_punch_sound_to_nearby_players():
    """The server already emits `melee` events for every swing (with
    the shooter's x/y/z). The engine's remote-event handler must
    forward those to the `remote-shot` sound path so nearby players
    hear the punch, distance-attenuated by audioBus._distVolume."""
    # The old handler was just `this._spawnMeleeArc(ev);` — no audio.
    # Now it must also call onLocalUpdate with weapon:"melee".
    melee_handler = ENGINE.split('ev.type === "melee"', 1)[1][:800]
    assert 'this.onLocalUpdate({ type: "remote-shot"' in melee_handler
    assert 'weapon: "melee"' in melee_handler, (
        "Melee remote-event handler must dispatch a remote-shot with "
        "weapon:\"melee\" so nearby players hear the punch."
    )
    # And it must skip the local shooter (they already played their
    # own punch in the fire() path).
    assert "ev.shooter_id !== this.youId" in melee_handler


# ─── "laser doesnt make sound to other players" ───────────────────────


def test_remote_laser_beam_now_broadcasts_shot_sound():
    """Laser used to only broadcast `beam` events (visual). The
    engine now also forwards each beam packet to the `remote-shot`
    sound path (throttled naturally by the server's ~4Hz beam rate)
    so nearby players actually hear the zap."""
    beam_handler = ENGINE.split('ev.type === "beam"', 1)[1][:1500]
    assert 'this.onLocalUpdate({ type: "remote-shot"' in beam_handler
    assert 'weapon: "laser"' in beam_handler, (
        "Beam handler must dispatch remote-shot with weapon:\"laser\" "
        "so remote laser fire is audible."
    )
    # Also gated on non-local shooter — otherwise we'd double-play
    # over the local beam start/stop.
    assert "ev.shooter_id !== this.youId" in beam_handler
