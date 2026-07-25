"""Regression: `random_spawn()` must never return a point inside an
obstacle. Previously hardcoded spawn points that overlapped a
crate/wall would drop the player directly into it, resulting in the
player being stuck / depenetrated into weird positions."""
import math
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def _point_in_any_obstacle(arena, x, z, radius=None):
    """Mirror server._spawn_point_safe's obstacle check for use in tests.
    Skips floating obstacles (`y_base > 0` — e.g. mezzanine geometry on
    the HOTEL map) since those don't block ground-level movement."""
    r = server.PLAYER_RADIUS if radius is None else radius
    for ob in arena.get("obstacles", []):
        if ob.get("y_base", 0) > 0:
            continue
        hx = ob["w"] / 2 + r
        hz = ob["d"] / 2 + r
        if abs(x - ob["x"]) < hx and abs(z - ob["z"]) < hz:
            return True
    return False


def test_random_spawn_never_lands_inside_an_obstacle_all_maps():
    """For every arena in MAPS, run random_spawn 100 times and
    assert the returned point is never inside an obstacle."""
    for arena in server.MAPS:
        arena_id = arena["map_id"]
        for _ in range(100):
            x, z = server.random_spawn(arena)
            assert not _point_in_any_obstacle(arena, x, z), (
                f"map {arena_id!r}: spawn ({x:.2f}, {z:.2f}) is inside an obstacle"
            )
            # Also enforce arena bounds (mirrors GameRoom.collides_obstacle wall check).
            s = arena["size"]
            assert -s + server.PLAYER_RADIUS <= x <= s - server.PLAYER_RADIUS
            assert -s + server.PLAYER_RADIUS <= z <= s - server.PLAYER_RADIUS


def test_random_spawn_rescues_a_broken_spawn_point():
    """If a map's spawn points somehow overlap an obstacle, the
    rescue path in `random_spawn` finds a nearby safe alternative."""
    arena = {
        "size": 30,
        "spawn_points": [(0.0, 0.0)],   # exactly inside the crate below
        "obstacles": [{"x": 0.0, "z": 0.0, "w": 4.0, "d": 4.0, "h": 3.0}],
    }
    x, z = server.random_spawn(arena)
    # Rescue should have moved us clear of the 4x4 crate at origin.
    assert not _point_in_any_obstacle(arena, x, z), (
        f"rescue path failed — spawned at ({x:.2f}, {z:.2f}) still inside obstacle"
    )
    # And the rescue should stay close (within max_radius = 6.0m).
    assert math.hypot(x, z) <= 6.5


def test_spawn_point_safe_helper_matches_gameroom_check():
    """Sanity: `_spawn_point_safe` matches the existing
    GameRoom.collides_obstacle logic — a point that passes here
    should not be depenetrated by the movement tick."""
    arena = server.ARENA
    # Test several corners + centre for both APIs.
    room = server.GameRoom()
    room.arena = arena
    for x in (-40, -10, 0, 10, 40):
        for z in (-40, -10, 0, 10, 40):
            safe = server._spawn_point_safe(arena, x, z)
            collides = room.collides_obstacle(x, z)
            assert safe != collides, f"mismatch at ({x},{z}): safe={safe} collides={collides}"
