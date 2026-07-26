"""Regression tests for the CRASHSITE (meteor crashsite) map."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_crashsite_in_rotation():
    ids = [m["map_id"] for m in server.MAPS]
    assert "crashsite" in ids, f"crashsite not in MAPS rotation: {ids}"
    # The full rotation grew as new maps were added — keep the earlier
    # 5 maps in stable order and simply require any additional maps
    # (e.g. hotel/Royal Guard) to follow.
    assert ids[:5] == ["downtown", "crossfire", "shoreline", "crashsite", "tundra"], ids


def test_crashsite_shape():
    m = server.MAP_D
    assert m["map_id"] == "crashsite"
    assert m["name"] == "CRASHSITE"
    assert m["size"] == 50
    # Has meaningful obstacle / spawn / healthpack counts
    assert len(m["obstacles"]) >= 25, "too few obstacles for a full arena"
    assert len(m["spawn_points"]) >= 8
    assert len(m["healthpacks"]) >= 6
    # Central meteor boulder exists at origin
    centre = [o for o in m["obstacles"] if o["x"] == 0 and o["z"] == 0]
    assert centre, "missing central meteor boulder at (0,0)"


def test_get_map_by_id_crashsite():
    m = server.get_map_by_id("crashsite")
    assert m is not None
    assert m["map_id"] == "crashsite"


def test_random_map_can_pick_crashsite():
    seen = {server.random_map()["map_id"] for _ in range(400)}
    assert "crashsite" in seen, f"random_map never returned crashsite: {seen}"
