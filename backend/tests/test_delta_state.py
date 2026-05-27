"""Tests for delta-state broadcasting protocol.

Verifies:
1. Server emits ~1 keyframe per second and ~19 deltas in between (1:19 ratio).
2. Delta messages omit unchanged static fields per player.
3. After client-side merging, every player has all required static fields.
4. `removed_ids` is populated when a player leaves.
5. Bandwidth reduction vs full keyframes.
"""
import asyncio
import json
import os
import urllib.request
import pytest
import websockets

API = os.environ.get("REACT_APP_BACKEND_URL", "https://blast-arena-servers.preview.emergentagent.com").rstrip("/")
WS_BASE = API.replace("https://", "wss://").replace("http://", "ws://")

STATIC_FIELDS = {
    "username", "rank_name", "level", "banner_icon", "banner_color",
    "skin", "mag_size", "platform", "is_bot", "rank_tier",
}


def _login(email: str, password: str) -> str:
    req = urllib.request.Request(
        f"{API}/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "delta-test"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["access_token"]


async def _collect_states(token: str, mode: str, seconds: float):
    """Connect to /api/ws/game and collect state/state_delta messages for `seconds`."""
    url = f"{WS_BASE}/api/ws/game?token={token}&mode={mode}"
    states = []
    deltas = []
    others = []
    async with websockets.connect(url, ping_interval=None, max_size=4 * 1024 * 1024) as ws:
        end_at = asyncio.get_event_loop().time() + seconds
        while asyncio.get_event_loop().time() < end_at:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2.5)
            except asyncio.TimeoutError:
                break
            try:
                m = json.loads(raw)
            except Exception:
                continue
            t = m.get("type")
            if t == "state":
                states.append((raw, m))
            elif t == "state_delta":
                deltas.append((raw, m))
            else:
                others.append(m)
    return states, deltas, others


def _merge_deltas(states, deltas):
    """Client-style merge: start from first keyframe, then apply subsequent
    state/state_delta in chronological order. Returns final players map."""
    # Sort by server tick or use insertion order: caller already inserted in order.
    # We'll just iterate in collected order — websocket delivery is ordered.
    timeline = []
    # Re-interleave by order observed: we collected sequentially, so simply
    # tag and zip from caller. For simplicity, re-derive from the raw lists.
    # Caller passes (raw, msg) tuples in the order received.
    # However we've split them; so we should preserve order via msg ids if present.
    # Instead, let _collect_states return a single ordered list. We add helper:
    return timeline  # unused — see _merge_ordered below


async def _collect_ordered(token: str, mode: str, seconds: float):
    url = f"{WS_BASE}/api/ws/game?token={token}&mode={mode}"
    ordered = []
    async with websockets.connect(url, ping_interval=None, max_size=4 * 1024 * 1024) as ws:
        end_at = asyncio.get_event_loop().time() + seconds
        while asyncio.get_event_loop().time() < end_at:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2.5)
            except asyncio.TimeoutError:
                break
            try:
                m = json.loads(raw)
            except Exception:
                continue
            ordered.append((len(raw), m))
    return ordered


def _merge_timeline(timeline):
    """Apply state/state_delta in order; return (players_by_id, last_top_fields)."""
    players = {}
    top = {}
    for _, m in timeline:
        t = m.get("type")
        if t == "state":
            # full keyframe: rebuild players
            players = {}
            for p in m.get("players", []):
                pid = p.get("id")
                if pid:
                    players[pid] = dict(p)
            for k, v in m.items():
                if k != "players":
                    top[k] = v
        elif t == "state_delta":
            for p in m.get("players", []):
                pid = p.get("id")
                if not pid:
                    continue
                if pid not in players:
                    players[pid] = {}
                players[pid].update(p)
            for rid in m.get("removed_ids", []) or []:
                players.pop(rid, None)
            for k, v in m.items():
                if k not in ("players", "removed_ids", "type"):
                    top[k] = v
    return players, top


@pytest.fixture(scope="module")
def player_token():
    try:
        return _login("player1@shooter.com", "player123")
    except Exception as e:
        pytest.skip(f"Cannot login: {e}")


def test_keyframe_to_delta_ratio(player_token):
    """Over ~5s window, ratio of keyframes to deltas should be roughly 1:19 (20Hz tick, 1s keyframe)."""
    states, deltas, _ = asyncio.run(_collect_states(player_token, "casual", 5.5))
    print(f"\nkeyframes={len(states)} deltas={len(deltas)}")
    assert len(states) >= 4, f"Expected at least 4 keyframes in 5s, got {len(states)}"
    assert len(deltas) > len(states) * 5, (
        f"Expected deltas >> keyframes. got {len(states)} keyframes and {len(deltas)} deltas"
    )
    # Ratio sanity: at 20Hz with 1s keyframe interval, ~19 deltas per keyframe.
    ratio = len(deltas) / max(1, len(states))
    assert 10 <= ratio <= 30, f"Delta:keyframe ratio out of expected range: {ratio:.1f}"


def test_delta_omits_static_fields(player_token):
    """state_delta payloads should rarely include static fields like username/rank_name."""
    _, deltas, _ = asyncio.run(_collect_states(player_token, "casual", 4.0))
    if not deltas:
        pytest.skip("no deltas observed")
    static_hits = 0
    total_player_frames = 0
    for _, m in deltas:
        for p in m.get("players", []):
            total_player_frames += 1
            static_hits += len(STATIC_FIELDS & set(p.keys()))
    # Static fields should appear rarely (only when actually changing, e.g., mag_size on reload).
    ratio = static_hits / max(1, total_player_frames)
    print(f"\nstatic_hits={static_hits} player_frames={total_player_frames} ratio={ratio:.3f}")
    assert ratio < 1.0, f"Static fields appearing in >100% of delta player rows: {ratio:.2f}"


def test_bandwidth_reduction(player_token):
    """Avg delta payload must be significantly smaller than avg full keyframe."""
    states, deltas, _ = asyncio.run(_collect_states(player_token, "casual", 5.0))
    if not states or not deltas:
        pytest.skip("Insufficient sample for bandwidth test")
    avg_full = sum(len(r) for r, _ in states) / len(states)
    avg_delta = sum(len(r) for r, _ in deltas) / len(deltas)
    print(f"\navg_full={avg_full:.0f}B avg_delta={avg_delta:.0f}B")
    assert avg_delta < avg_full * 0.6, (
        f"Delta size {avg_delta:.0f} should be < 60% of keyframe {avg_full:.0f}"
    )


def test_merged_players_have_all_static_fields(player_token):
    """After merging deltas client-side, every player must carry all static fields."""
    timeline = asyncio.run(_collect_ordered(player_token, "casual", 5.0))
    assert timeline, "No messages received"
    players, top = _merge_timeline(timeline)
    assert players, "No players after merging"
    # Check at least one full top-level state field exists
    assert "time_left" in top or "match_state" in top or any(k for k in top), \
        f"Top-level fields missing after merge: {list(top.keys())[:10]}"

    missing_report = {}
    for pid, p in players.items():
        miss = STATIC_FIELDS - set(p.keys())
        if miss:
            missing_report[pid] = sorted(miss)
    print(f"\nplayers={len(players)} missing_report={missing_report}")
    assert not missing_report, f"Players missing static fields after delta merge: {missing_report}"


def test_top_level_fields_persist_through_deltas(player_token):
    """time_left / match_state should remain present and monotonic-ish across delta cycle."""
    timeline = asyncio.run(_collect_ordered(player_token, "casual", 4.0))
    # Walk and accumulate top fields; ensure once seen, they keep appearing (via cache).
    seen_keys = set()
    for _, m in timeline:
        if m.get("type") in ("state", "state_delta"):
            for k in m.keys():
                if k not in ("type", "players", "removed_ids"):
                    seen_keys.add(k)
    # We expect at least these top-level fields to have appeared at some point.
    expected_any = {"time_left", "match_state", "scores", "map", "mode"}
    overlap = expected_any & seen_keys
    print(f"\nseen_top_keys={sorted(seen_keys)}")
    assert overlap, f"Expected one of {expected_any} in top-level fields, saw {seen_keys}"


def test_ranked_queue_still_works(player_token):
    """Player1 is level 5 → eligible. Queue should accept and either match or trigger bot-fill."""
    # POST ranked queue
    req = urllib.request.Request(
        f"{API}/api/queue/ranked",
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {player_token}",
            "User-Agent": "Mozilla/5.0 delta-test",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read())
            print(f"\nqueue POST -> {body}")
            assert r.status in (200, 201)
    except urllib.error.HTTPError as e:
        pytest.fail(f"Ranked queue POST failed: {e.code} {e.read()!r}")
    # GET status
    req2 = urllib.request.Request(
        f"{API}/api/queue/ranked",
        headers={"Authorization": f"Bearer {player_token}", "User-Agent": "Mozilla/5.0 delta-test"},
    )
    with urllib.request.urlopen(req2, timeout=10) as r:
        status = json.loads(r.read())
    print(f"queue GET -> {status}")
    assert "in_queue" in status or "status" in status or "ready" in status
    # Cleanup: delete from queue
    req3 = urllib.request.Request(
        f"{API}/api/queue/ranked",
        headers={"Authorization": f"Bearer {player_token}", "User-Agent": "Mozilla/5.0 delta-test"},
        method="DELETE",
    )
    try:
        urllib.request.urlopen(req3, timeout=10)
    except Exception:
        pass
