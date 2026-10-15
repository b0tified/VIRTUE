import asyncio
import random
import server as srv


def test_pick_bot_weapon_distribution_scales_with_rank():
    random.seed(1)
    low = [srv.pick_bot_weapon(0, 1.0) for _ in range(4000)]
    high = [srv.pick_bot_weapon(7, 1.0) for _ in range(4000)]
    low_s = low.count("sniper") / 4000
    high_s = high.count("sniper") / 4000
    assert 0.03 < low_s < 0.10
    assert 0.38 < high_s < 0.52
    assert 0.10 < low.count("laser") / 4000 < 0.20
    assert set(low + high) == {"ak47", "sniper", "laser"}


def test_spawned_bots_get_mixed_weapons():
    random.seed(3)
    room = srv.GameRoom(is_ranked=False, match_duration=60.0)
    weapons = [room.spawn_bot(f"b{i}", disguised=True).weapon for i in range(60)]
    assert "sniper" in weapons and "laser" in weapons and "ak47" in weapons


def _duel(weapon):
    room = srv.GameRoom(is_ranked=False, match_duration=60.0)
    shooter = room.spawn_bot("shooter", difficulty=1.2)
    victim = room.spawn_bot("victim", difficulty=1.0)
    shooter.weapon = weapon
    victim.weapon = "ak47"
    victim.difficulty = 0.5
    shooter.x, shooter.z, victim.x, victim.z = 0.0, 30.0, 0.0, 18.0
    shooter.invuln_until = victim.invuln_until = 0.0
    room.match_started = True
    start_hp = victim.hp

    async def run():
        for _ in range(120):
            victim.x, victim.z = 0.0, 18.0
            victim.hp = max(victim.hp, 1)
            victim.alive = True
            victim.invuln_until = 0.0
            if weapon == "laser" and shooter.laser_firing and not shooter.laser_overheated:
                await room._apply_laser_beam(shooter, 0.05)
            await room._update_bots(0.05)
            await asyncio.sleep(0.05)
    asyncio.run(run())
    return start_hp, victim, shooter, room


def test_sniper_bot_fires_sniper_shots():
    _, victim, shooter, room = _duel("sniper")
    assert shooter.last_shot_ms > 0
    assert shooter.weapon == "sniper"


def test_laser_bot_holds_beam():
    _, victim, shooter, room = _duel("laser")
    assert shooter.laser_heat > 0.0 or shooter.laser_overheated
