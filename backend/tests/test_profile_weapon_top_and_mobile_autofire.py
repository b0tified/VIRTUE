"""Regression grep-guards for the 2026-02-24 UX changes:

  1. Weapon Loadout picker moved to the TOP of the Profile page.
  2. Mobile auto-fire triggers whenever the crosshair passes over an
     enemy — no fire button needed.

These are JSX/JS behaviours we can't fully unit-test in pytest, so we
grep the source for the required anchors instead. A future refactor
that moves the picker back down or removes the touch auto-fire block
fails these tests loudly.
"""
import pathlib


PROFILE = pathlib.Path("/app/frontend/src/pages/Profile.jsx")
ENGINE = pathlib.Path("/app/frontend/src/game/engine.js")


class TestProfileWeaponPickerAtTop:
    def test_weapon_section_precedes_rank_section(self):
        """The Weapon Loadout section must appear BEFORE the Your Rank
        section in the JSX (top-to-bottom order = render order)."""
        src = PROFILE.read_text(encoding="utf-8")
        weapon_idx = src.find('title="Weapon Loadout"')
        rank_idx = src.find('title="Your Rank"')
        customize_idx = src.find('title="Customize"')
        assert weapon_idx > 0, "Profile no longer has a Weapon Loadout section"
        assert rank_idx > 0, "Profile no longer has a Your Rank section"
        assert weapon_idx < rank_idx, (
            "Weapon Loadout must render ABOVE Your Rank per user "
            f"request. Found weapon@{weapon_idx}, rank@{rank_idx}."
        )
        assert weapon_idx < customize_idx, (
            "Weapon Loadout was moved OUT of Customize — must not be "
            "re-embedded there."
        )

    def test_weapon_picker_still_wired_to_refresh(self):
        """The picker must still trigger a refresh so the change
        propagates to other views (lobby loadout tag, etc.)."""
        src = PROFILE.read_text(encoding="utf-8")
        assert "onChange={() => refreshMe?.()}" in src, (
            "WeaponLoadoutPicker no longer wired to refreshMe — "
            "post-swap the lobby loadout badge would go stale."
        )


class TestMobileAutoFireOnCrosshair:
    def test_engine_has_touch_autofire_block(self):
        src = ENGINE.read_text(encoding="utf-8")
        # Anchor on the specific comment we wrote so future edits
        # can't silently drop the auto-fire block.
        assert "Mobile \"auto-fire on target\"" in src, (
            "Touch auto-fire-on-crosshair block missing from _update()."
        )

    def test_touch_autofire_uses_hasEnemyInCrosshair(self):
        src = ENGINE.read_text(encoding="utf-8")
        assert "if (this.hasEnemyInCrosshair())" in src, (
            "Touch auto-fire no longer gates on hasEnemyInCrosshair() — "
            "would fire endlessly on empty sky drags."
        )

    def test_touch_autofire_gated_on_touch_active(self):
        """The block MUST be touch-only — never trigger on desktop
        where hover isn't a valid trigger."""
        src = ENGINE.read_text(encoding="utf-8")
        # Anchor: the guard line is exactly this shape.
        assert "if (this.touchActive && this.alive && !this.localReloading" in src

    def test_touch_autofire_respects_cooldown(self):
        """Rate-limit MUST be applied so a slow drag past a target
        doesn't produce more than one shot per cooldown window."""
        src = ENGINE.read_text(encoding="utf-8")
        assert "now - (this._lastTouchAutoFireMs || 0) >= cd" in src

    def test_lastTouchAutoFireMs_initialised(self):
        src = ENGINE.read_text(encoding="utf-8")
        assert "this._lastTouchAutoFireMs = 0;" in src, (
            "_lastTouchAutoFireMs not initialised — first-frame gate "
            "may misbehave on some browsers."
        )

    def test_ak_hold_tick_also_gates_on_crosshair_when_touch(self):
        """The existing AK hold-to-fire tick must ALSO gate on
        crosshair when in touch mode, so touch AK doesn't drain the
        mag while dragging past enemies on empty sky."""
        src = ENGINE.read_text(encoding="utf-8")
        assert "(!this.touchActive || this.hasEnemyInCrosshair())" in src, (
            "AK hold-to-fire tick lost the touch-mode crosshair gate."
        )
