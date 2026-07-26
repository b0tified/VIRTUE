"""Royal Guard (hotel) — 3D LOS regression.

Confirms that `_has_los` uses proper 3D obstacle slabs so:
- Eye-level (y≈1.7) shots pass OVER short cover (tables at h=0.9)
- Horizontal eye-level shots are NOT blocked by the high ceiling at y_base=14
- Tall obstacles (columns h=8 from ground) still block LOS
"""
import sys, pathlib, types
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _hotel_room():
    room = server.GameRoom()
    room.arena = next(m for m in server.MAPS if m.get("map_id") == "hotel")
    return room


def _mk_player(x, y, z):
    """Minimal shim exposing .x .y .z for _has_los."""
    p = types.SimpleNamespace()
    p.x, p.y, p.z = float(x), float(y), float(z)
    return p


def test_los_passes_over_short_table():
    """Table at (20, 25) has h=0.9. Two players at eye-level y=1.7 on
    opposite sides must SEE each other — the ray at 1.7 sails above."""
    room = _hotel_room()
    shooter = _mk_player(18, 1.7, 25)
    target = _mk_player(22, 1.7, 25)
    assert room._has_los(shooter, target), (
        "Eye-level shot should pass OVER short cover (h=0.9) at (20,25)"
    )


def test_los_not_blocked_by_ceiling():
    """Ceiling plane at y_base=14 spans 100x100 — a horizontal
    ground-level shot at y=1.7 must NOT be blocked."""
    room = _hotel_room()
    shooter = _mk_player(-10, 1.7, 0)
    target = _mk_player(10, 1.7, 0)
    assert room._has_los(shooter, target), (
        "Ceiling at y_base=14 must not block a y=1.7 horizontal ray"
    )


def test_los_blocked_by_tall_column():
    """A marble column at (12, 12) h=8 sits between two players — it
    must still block the shot."""
    room = _hotel_room()
    shooter = _mk_player(6, 1.7, 12)
    target = _mk_player(18, 1.7, 12)
    assert not room._has_los(shooter, target), (
        "Full-height column at (12,12) must block eye-level LOS"
    )
