"""Regression test — 2026-02-25.

User report: "Sometimes on the castle guard map [ROYAL GUARD, map_id=
`hotel`] random boxes will appear on screen and walls flicker when
moving."

Root cause: two separate rendering issues stacked on the same map:

1. **Depth-buffer z-fight** — the camera was `near=0.05, far=500`. That
   10,000:1 ratio starves the 24-bit depth buffer of precision, so the
   comic-outline shells (BackSide, 1.05x scale) plus the 0.011m
   face-decal offsets flickered against their parent walls as the
   player moved. Fix: bump near to `0.15` (still small enough that a
   full-sprint player never clips a wall, big enough to give the
   depth buffer 3x more precision).

2. **Coplanar geometry** — the second-story mezzanine walkway ring has
   its top face at exactly `y=8.8` (y_base=8 + h=0.8). The 4 railings
   AND the 6 doorway lintels used to sit at `y_base=8.8` as well, so
   their bottom faces were coplanar with the walkway top. Any camera
   angle that crossed that plane z-fought regardless of buffer
   precision. Fix: shift the railings + lintels to `y_base=8.85`
   (5 cm gap, invisible in-game).

Both symptoms are hotel-only because ROYAL GUARD is the only map with
stacked floating geometry (mezzanine + railings + lintels + ceiling).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


# ---------- backend / map geometry -------------------------------------


def _hotel_map():
    m = srv.get_map_by_id("hotel")
    assert m is not None, "ROYAL GUARD (hotel) map missing from MAPS list."
    return m


def test_hotel_walkway_top_and_railing_bottom_are_not_coplanar():
    """The mezzanine walkway top face sits at y_base+h = 8+0.8 = 8.8.
    Railings and lintels must NOT anchor at 8.8 or their bottom face
    coincides with the walkway top — visible as flickering z-fight
    every time the camera crosses that plane on ROYAL GUARD."""
    obstacles = _hotel_map()["obstacles"]
    # Walkway ring: 4 pieces with y_base=8 and h=0.8.
    walkways = [o for o in obstacles if o.get("y_base") == 8 and o.get("h") == 0.8]
    assert len(walkways) == 4, (
        f"Expected 4 mezzanine walkway segments, found {len(walkways)}."
    )
    walkway_top = 8 + 0.8  # = 8.8
    # Any floating obstacle above the ground whose bottom face lands
    # EXACTLY at the walkway top is a z-fight candidate.
    coplanar = [
        o for o in obstacles
        if o.get("y_base") == walkway_top
    ]
    assert coplanar == [], (
        "Floating obstacles must not have `y_base == 8.8` — that value "
        "is coplanar with the mezzanine walkway top face and produces "
        "z-fighting on ROYAL GUARD. Offenders: "
        + str([{k: o.get(k) for k in ("x", "z", "w", "h", "d", "y_base")} for o in coplanar])
    )


def test_hotel_railings_and_lintels_still_lifted_5cm_above_walkway():
    """The specific fix: railings + lintels moved from y_base=8.8 →
    y_base=8.85 (5 cm lift). Assert both groups landed at the new
    height so a later refactor can't accidentally revert either."""
    obstacles = _hotel_map()["obstacles"]
    # Railings: 4 short vertical walls (h=1.6) on the mezzanine ring.
    railings = [
        o for o in obstacles
        if o.get("h") == 1.6 and (o.get("w") == 0.4 or o.get("d") == 0.4)
    ]
    assert len(railings) == 4, f"Expected 4 mezzanine railings, found {len(railings)}."
    for r in railings:
        assert r.get("y_base") == 8.85, (
            f"Railing at (x={r.get('x')}, z={r.get('z')}) is at "
            f"y_base={r.get('y_base')} — must be 8.85 to clear the "
            "walkway top."
        )
    # Lintels: 6 doorway facades (h=3, d=0.4) along the east + west walls.
    lintels = [
        o for o in obstacles
        if o.get("h") == 3 and o.get("d") == 0.4 and o.get("w") == 2
    ]
    assert len(lintels) == 6, f"Expected 6 mezzanine lintels, found {len(lintels)}."
    for l in lintels:
        assert l.get("y_base") == 8.85, (
            f"Lintel at (x={l.get('x')}, z={l.get('z')}) is at "
            f"y_base={l.get('y_base')} — must be 8.85 to clear the "
            "walkway top."
        )


# ---------- frontend / camera near plane -------------------------------


def test_engine_camera_near_plane_gives_sane_depth_precision():
    """A 10000:1 far/near ratio pushes the depth buffer past its
    precision limit, producing z-fight flicker even without coplanar
    geometry. Bumping near from 0.05 to at least 0.1 restores usable
    depth precision at typical FPS-arena distances (0-100m)."""
    src = pathlib.Path("/app/frontend/src/game/engine.js").read_text(encoding="utf-8")
    marker = "this.camera = new THREE.PerspectiveCamera"
    assert marker in src
    line = src.split(marker, 1)[1].split(";", 1)[0]
    # Extract the near value — the 3rd numeric argument, e.g.
    # `(78, canvas.clientWidth / canvas.clientHeight, 0.15, 500);`
    # We split on commas at the top level and parse the third arg.
    inner = line.split("(", 1)[1].rsplit(")", 1)[0]
    parts = [p.strip() for p in inner.split(",")]
    # Layout: [fov, aspect, near, far] — near is index 2.
    near = float(parts[2])
    far = float(parts[3])
    assert near >= 0.1, (
        f"Camera near={near} — must be >= 0.1 to avoid the depth-buffer "
        "starvation that manifested as flicker + phantom boxes on "
        "ROYAL GUARD."
    )
    # Belt-and-suspenders — flag a regression to the 10000:1 ratio.
    ratio = far / near
    assert ratio <= 5000, (
        f"far/near ratio {ratio:.0f} is too aggressive for the WebGL "
        "depth buffer; expect z-fight artifacts."
    )
