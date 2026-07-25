"""New HOTEL map — regression tests.

Verifies:
  - Registered in `server.MAPS` alongside the 5 pre-existing maps.
  - Has a full spawn-point set (all provably safe) + healthpacks.
  - Includes floating (`y_base > 0`) obstacles that represent the
    mezzanine + ceiling.
  - Ground-level collision (`GameRoom.collides_obstacle`) ignores
    floating obstacles so players walk under the mezzanine.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _hotel():
    m = next((m for m in server.MAPS if m.get("map_id") == "hotel"), None)
    assert m is not None, "HOTEL map missing from server.MAPS"
    return m


def test_hotel_map_registered():
    hotel = _hotel()
    assert hotel["name"] == "GRAND HOTEL"
    assert hotel["size"] == 50
    assert len(hotel["spawn_points"]) >= 8, "need at least 8 spawn points for FFA"
    assert len(hotel["healthpacks"]) >= 4


def test_hotel_map_has_mezzanine_geometry():
    """The map must include obstacles with `y_base > 0` — the floating
    mezzanine ring + ceiling that give the "two-story" feel."""
    hotel = _hotel()
    floating = [o for o in hotel["obstacles"] if o.get("y_base", 0) > 0]
    assert len(floating) >= 6, (
        f"expected ≥6 floating (y_base>0) obstacles, got {len(floating)}"
    )
    # Verify a ceiling plane exists (large, near-flat, high up).
    ceiling = [o for o in floating if o.get("y_base", 0) >= 12 and o["w"] >= 40 and o["d"] >= 40]
    assert ceiling, "hotel needs a large ceiling plane at y_base >= 12"


def test_hotel_spawn_points_all_safe():
    hotel = _hotel()
    for sp in hotel["spawn_points"]:
        assert server._spawn_point_safe(hotel, sp[0], sp[1]), (
            f"HOTEL spawn point {sp} is not safe"
        )


def test_ground_collision_ignores_floating_obstacles():
    """A player standing directly under the ceiling plane at (0,0)
    must NOT collide — the ceiling is at y_base=14 and doesn't block
    ground movement. The center of the lobby is now open (no fountain)
    so (0,0) itself is walkable."""
    room = server.GameRoom()
    room.arena = _hotel()
    # Center of the lobby — no fountain any more, must be clear.
    assert not room.collides_obstacle(0, 0), (
        "the center of the hotel lobby should be OPEN (no fountain)"
    )
    # (5, 5) is between the marble columns — should also be clear.
    assert not room.collides_obstacle(5, 5), (
        "(5, 5) is under the mezzanine, not overlapping any ground "
        "obstacle — must NOT collide."
    )
