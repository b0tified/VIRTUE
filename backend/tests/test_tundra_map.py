"""Tundra map tests.

Ensures the frozen arctic arena is registered in the map rotation,
has the expected topology (frozen pond centre, ice shards, snowdrifts,
research outposts), and can be selected via `get_map_by_id`.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_tundra_in_rotation():
    ids = [m["map_id"] for m in server.MAPS]
    assert "tundra" in ids, f"tundra not in MAPS rotation: {ids}"
    # Tundra should be the 5th (newest) entry.
    assert ids[-1] == "tundra"


def test_tundra_shape():
    m = server.get_map_by_id("tundra")
    assert m is not None
    assert m["map_id"] == "tundra"
    assert m["name"] == "TUNDRA"
    assert m["size"] == 50
    # A full-sized arena needs at least the ring + drifts + perimeter buildings.
    assert len(m["obstacles"]) >= 25, "too few obstacles for a full arena"
    assert len(m["spawn_points"]) >= 8
    assert len(m["healthpacks"]) >= 6
    # Frozen central pond at (0, 0) — flat wide low box (h ~ 0.3).
    centre = [o for o in m["obstacles"] if o["x"] == 0 and o["z"] == 0]
    assert centre, "missing frozen pond at (0,0)"
    assert centre[0]["h"] < 1.0, "central pond should be a low flat surface"


def test_get_map_by_id_tundra():
    m = server.get_map_by_id("tundra")
    assert m is not None
    assert m["map_id"] == "tundra"


def test_random_map_can_pick_tundra():
    # Deterministic-ish: sample 200 times, expect at least one tundra roll
    # (uniform over 5 maps → prob of missing 200 times ≈ 0.8^200 ≈ 10^-19).
    import random as _rnd
    _rnd.seed(1234)
    seen = {server.random_map()["map_id"] for _ in range(200)}
    assert "tundra" in seen, f"random_map never returned tundra: {seen}"
