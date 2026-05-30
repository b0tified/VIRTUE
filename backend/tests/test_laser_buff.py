"""Regression test for the laser buff. Locks in the post-buff numbers so
a future careless tweak doesn't silently revert the weapon to its old
under-performing config."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_laser_buffed_config():
    cfg = server.WEAPON_CONFIGS["laser"]
    # DPS bumped 60 -> 90 (50% damage uplift)
    assert cfg["dps"] == 90
    # Headshot multiplier bumped to reward aim
    assert cfg["headshot_mult"] == 1.75
    # Range extended
    assert cfg["falloff_start"] == 30.0
    assert cfg["falloff_end"] == 85.0
    assert cfg["min_damage_mult"] == 0.65
    # Heat behaviour — longer sustain, faster recovery
    assert cfg["heat_ramp_seconds"] == 4.0
    assert cfg["heat_cool_seconds"] == 3.0


def test_laser_autoaim_range_buffed():
    import inspect
    sig = inspect.signature(server.GameRoom._laser_autoaim_lock)
    # max_range default is 26.0 after the buff (was 22.0)
    assert sig.parameters["max_range"].default == 26.0


def test_laser_still_weaker_than_ak_burst_dps():
    """Sanity: AK still out-DPSes laser body-shot for body-shots, so the
    buff doesn't make the laser strictly better than the assault rifle
    on every axis. AK = 25 dmg @ 250ms = 100 dps body; laser = 90 dps."""
    ak = server.WEAPON_CONFIGS["ak47"]
    laser = server.WEAPON_CONFIGS["laser"]
    ak_dps = (ak["damage"] * 1000.0) / ak["cooldown_ms"]
    assert ak_dps > laser["dps"], (
        f"AK body-dps ({ak_dps}) should still exceed laser dps ({laser['dps']}) "
        "post-buff or the laser becomes a strict upgrade."
    )
