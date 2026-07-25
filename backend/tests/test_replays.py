"""Replays feature — regression tests.

Backend requirements:
  1. `GameRoom.kill_log` accumulates every kill with shooter + victim
     positions/yaw/weapon/headshot.
  2. Match history docs carry a `kill_events` list scoped to that user
     (as shooter OR victim), plus `arena_size` for the top-down.
  3. `/profile/me/history` exposes both new fields.
  4. Retention: the insert path prunes to the 20 most recent matches
     per user_id.
"""
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()


def test_gameroom_has_kill_log_attribute():
    """`GameRoom.__init__` must initialize `self.kill_log = []`."""
    idx = SRC.find("class GameRoom:")
    assert idx >= 0
    block = SRC[idx: idx + 8000]
    assert "self.kill_log: List[dict] = []" in block, (
        "GameRoom must initialize `self.kill_log`."
    )


def test_record_kill_snapshot_helper_exists():
    """Server must have a `_record_kill_snapshot` helper that
    appends shooter/victim positions to `self.kill_log`."""
    assert "def _record_kill_snapshot(" in SRC, (
        "`_record_kill_snapshot` helper missing from GameRoom."
    )
    # Verify the helper captures the core fields.
    idx = SRC.find("def _record_kill_snapshot(")
    block = SRC[idx: idx + 2000]
    for field in (
        '"shooter_x"', '"shooter_z"', '"shooter_yaw"',
        '"victim_x"', '"victim_z"',
        '"weapon"', '"headshot"', '"t_ms"',
    ):
        assert field in block, f"_record_kill_snapshot missing field {field}"


def test_all_kill_paths_call_record_kill_snapshot():
    """The three kill paths (melee, shoot, laser) must each call
    `self._record_kill_snapshot(...)` so no kills are missed."""
    # Count occurrences — we expect at least 3 (melee, shoot, laser).
    n = SRC.count("self._record_kill_snapshot(")
    assert n >= 3, f"expected ≥3 calls to _record_kill_snapshot, got {n}"


def test_match_history_doc_carries_kill_events_and_arena_size():
    """The end_match doc builder must attach `kill_events` and
    `arena_size` to each user's history row."""
    idx = SRC.find('"match_id": match_id,')
    assert idx >= 0, "history doc match_id anchor missing"
    block = SRC[idx: idx + 2000]
    assert '"kill_events":' in block, "history doc must carry `kill_events`."
    assert '"arena_size":' in block, "history doc must carry `arena_size`."


def test_retention_prune_to_20_matches_per_user():
    """The insert path must prune each user's history to the 20 most
    recent rows so replays don't grow unbounded."""
    idx = SRC.find("HISTORY_KEEP = 20")
    assert idx >= 0, "20-match retention cap missing from insert path."
    # Verify it's followed by a delete of older rows.
    block = SRC[idx: idx + 1500]
    assert "delete_many" in block, "retention prune must delete older rows."


def test_profile_history_endpoint_exposes_kill_events():
    """`/profile/me/history` must include `kill_events` and
    `arena_size` in the returned row dicts."""
    idx = SRC.find('"match_id": m.get("match_id")')
    assert idx >= 0
    block = SRC[idx: idx + 800]
    assert '"kill_events"' in block, "history endpoint must expose kill_events."
    assert '"arena_size"' in block, "history endpoint must expose arena_size."
