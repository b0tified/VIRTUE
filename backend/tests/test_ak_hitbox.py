"""Regression test for the AK "bigger bullets" buff.

User request:
  > Make the ak bullets bigger so they are easier to hit

Implementation under test:
  - `WEAPON_CONFIGS["ak47"]` gains a `projectile_thickness` field (metres).
  - `GameRoom.raycast_hit` reads the shooter's weapon thickness and
    inflates every target hitbox sphere radius by that amount, turning
    the ray into a fat cylinder. Sniper / laser stay pinpoint (thickness
    defaults to 0).
"""
import sys

import pytest

sys.path.insert(0, "/app/backend")
import server as srv  # noqa: E402


def _make_room():
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")
    # Strip obstacles so nothing occludes the clean -Z aim line.
    room.arena = {"size": 200, "obstacles": [], "spawn_points": [(0.0, 0.0)]}
    return room


def _shooter(weapon: str):
    p = srv.Player(ws=None, is_bot=True, bot_name="shooter")
    p.is_bot = False
    p.user_id = "u-shooter"
    p.username = "shooter"
    p.alive = True
    p.hp = p.max_hp
    p.x, p.y, p.z = 0.0, srv.PLAYER_HEIGHT, 0.0
    p.yaw = 0.0
    p.pitch = 0.0
    p.invuln_until = 0.0
    p.last_ping_ms = 0
    p.weapon = weapon
    return p


def _target_at(x, z):
    p = srv.Player(ws=None, is_bot=True, bot_name="target")
    p.alive = True
    p.x, p.y, p.z = float(x), srv.PLAYER_HEIGHT, float(z)
    p.invuln_until = 0.0
    return p


def test_ak_has_projectile_thickness_config():
    """AK must expose a positive `projectile_thickness` for the raycast
    inflation path to kick in."""
    cfg = srv.WEAPON_CONFIGS["ak47"]
    assert "projectile_thickness" in cfg, "AK must declare projectile_thickness"
    assert cfg["projectile_thickness"] > 0.0


def test_sniper_and_laser_stay_pinpoint():
    """Precision weapons must NOT inherit the AK's fat-bullet treatment."""
    assert srv.WEAPON_CONFIGS["sniper"].get("projectile_thickness", 0.0) == 0.0
    assert srv.WEAPON_CONFIGS["laser"].get("projectile_thickness", 0.0) == 0.0


def test_ak_hits_wider_near_miss_than_sniper():
    """A target offset laterally from the aim line that the sniper would
    MISS should be registered as a hit by the (thicker) AK ray."""
    room = _make_room()
    # Torso sphere radius is 0.85. Sniper (r=0.85) misses at 1.10m lateral
    # offset; AK's 0.45 thickness inflates to r=1.30, so 1.10m still hits.
    lateral = 1.10

    shooter_snip = _shooter("sniper")
    target_snip = _target_at(lateral, -8.0)
    room.players = {shooter_snip.id: shooter_snip, target_snip.id: target_snip}
    hit_snip, _, _ = room.raycast_hit(shooter_snip)
    assert hit_snip is None, (
        f"Sniper should miss at {lateral}m lateral offset (torso r=0.85)"
    )

    room2 = _make_room()
    shooter_ak = _shooter("ak47")
    target_ak = _target_at(lateral, -8.0)
    room2.players = {shooter_ak.id: shooter_ak, target_ak.id: target_ak}
    hit_ak, part_ak, _ = room2.raycast_hit(shooter_ak)
    assert hit_ak is target_ak, (
        f"AK should HIT at {lateral}m lateral offset thanks to projectile_thickness"
    )
    assert part_ak in ("head", "torso", "legs")


def test_ak_still_misses_when_target_is_far_off_line():
    """Buff has bounds — a target 2.5m off the aim line still misses the
    AK's fat ray, or the game becomes an auto-aim cannon."""
    room = _make_room()
    shooter = _shooter("ak47")
    target = _target_at(2.5, -8.0)
    room.players = {shooter.id: shooter, target.id: target}
    hit, _, _ = room.raycast_hit(shooter)
    assert hit is None, "AK should still miss well outside the inflated hitbox"


def test_ak_direct_hit_still_lands():
    """Sanity: a dead-on shot with AK still registers (the thickness math
    must only INFLATE the sphere, never shrink or offset it)."""
    room = _make_room()
    shooter = _shooter("ak47")
    target = _target_at(0.0, -8.0)
    room.players = {shooter.id: shooter, target.id: target}
    hit, part, dist = room.raycast_hit(shooter)
    assert hit is target
    assert part in ("head", "torso", "legs")
    assert 5.0 < dist < 10.0
