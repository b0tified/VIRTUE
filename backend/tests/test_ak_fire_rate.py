"""AK fire rate contract — verifies the AK cooldown is set to the new
slower value (400ms) so hold-to-fire on the client feels weighty and
the server enforces the cadence.

If someone later restores the fast 250ms cooldown, this test fires
first — the client's per-frame hold-to-fire tick is tuned to the 400ms
cadence and a mismatch would cause snap-back on optimistic ammo.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_ak_cooldown_is_slow():
    """SHOT_COOLDOWN_MS drives the AK fire rate. Anything faster than
    380ms makes the weapon feel like the old 240 RPM laser-hose."""
    assert server.SHOT_COOLDOWN_MS >= 380, (
        f"AK cooldown regressed to {server.SHOT_COOLDOWN_MS}ms — "
        "the client hold-to-fire is tuned for ~400ms; anything faster "
        "will cause optimistic-ammo flicker as server drops shots."
    )
    # AK weapon config reads SHOT_COOLDOWN_MS directly.
    cfg = server.weapon_cfg("ak47")
    assert cfg["cooldown_ms"] == server.SHOT_COOLDOWN_MS


def test_bot_cooldown_scales_with_ak():
    """Bots must not out-DPS players. Their cooldown scales with the
    AK cadence."""
    assert server.BOT_SHOT_COOLDOWN_MS >= server.SHOT_COOLDOWN_MS, (
        f"Bots (cooldown {server.BOT_SHOT_COOLDOWN_MS}ms) firing faster "
        f"than the player AK ({server.SHOT_COOLDOWN_MS}ms) is a "
        "balance regression."
    )


def test_laser_cooldown_unchanged():
    """The AK slowdown must not affect the laser's much faster tick
    rate (it's a continuous beam @ 90ms cooldown for DPS)."""
    assert server.LASER_COOLDOWN_MS == 90
