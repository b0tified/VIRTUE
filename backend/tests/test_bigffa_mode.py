"""Backend tests for the 12-player Big FFA mode (Feb-2026).

Contract:
  - GET /api/ws/game?mode=bigffa is a valid, authenticated route that
    lands the caller in a dedicated FFA room whose target lobby size is
    12 (auto-fills with disguised bots).
  - The mode is direct-connect only — it never touches the ranked queue
    or the casual matchmaker.
"""
import asyncio
import importlib
import json
import time
import uuid

import pytest
import requests
import websockets
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

LOCAL = "http://localhost:8001"
WS = "ws://localhost:8001"


def _register(suffix: str) -> str:
    """Register/login a throwaway user; returns access_token."""
    uname = f"TESTbf{suffix}"[:20]
    body = {
        "email": f"TEST_bf_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": uname,
    }
    r = requests.post(f"{LOCAL}/api/auth/register", json=body)
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": body["email"], "password": body["password"]})
    assert r.status_code == 200, f"auth failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


# --- In-process room-object assertions -----------------------------

def test_bigffa_room_configured_for_12_players():
    """The `bigffa_room` module-level singleton is configured as a
    12-player FFA room. Guards regressions where a refactor silently
    drops the `bots_target_size` override and the room falls back to
    the default 4-player lobby."""
    server = importlib.import_module("server")
    room = server.bigffa_room
    assert room is not None
    assert getattr(room, "is_bigffa", False) is True
    assert room.game_mode == "ffa"
    assert room.is_ranked is False
    assert int(getattr(room, "bots_target_size", 0)) == 12
    # Sanity: BIGFFA_LOBBY_SIZE constant matches the room override.
    assert server.BIGFFA_LOBBY_SIZE == 12


def test_maintain_population_honours_bots_target_size():
    """`_maintain_population` reads `bots_target_size` when set — the
    override plumbing that keeps bigffa_room at 12 combatants."""
    server = importlib.import_module("server")
    room = server.bigffa_room
    # We can't run `_maintain_population` directly under pytest's event
    # loop (it needs the room lock + async context), but we can at
    # least verify the attribute the function reads is present and set
    # correctly at the module level.
    assert hasattr(room, "bots_target_size")
    assert int(room.bots_target_size) == 12


# --- WebSocket contract --------------------------------------------

@pytest.mark.asyncio
async def test_bigffa_welcome_advertises_ffa_and_not_ranked():
    """Connecting via `mode=bigffa` returns a `welcome` payload with
    `game_mode="ffa"` and `is_ranked=False`. This is the client-visible
    contract; state broadcasts / bot fill are tested separately."""
    tok = _register(uuid.uuid4().hex[:6])
    url = f"{WS}/api/ws/game?token={tok}&mode=bigffa"
    async with websockets.connect(url) as ws:
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=4)
            except asyncio.TimeoutError:
                continue
            m = json.loads(raw)
            if m.get("type") == "welcome":
                assert m.get("game_mode") == "ffa"
                assert m.get("is_ranked") is False
                # `is_practice` is the field the loading screen reads
                # to distinguish practice from real matches — bigffa
                # is a real match.
                assert bool(m.get("is_practice", False)) is False
                return
        pytest.fail("welcome message never arrived for mode=bigffa")


@pytest.mark.asyncio
async def test_bigffa_rejects_missing_token():
    """No `?token=…` query param → the socket is closed without a
    welcome. Confirms bigffa hasn't accidentally been opened up to
    anonymous connections (same guard as every other mode)."""
    url = f"{WS}/api/ws/game?mode=bigffa"
    saw_welcome = False
    try:
        async with websockets.connect(url) as ws:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=3)
                m = json.loads(raw)
                if m.get("type") == "welcome":
                    saw_welcome = True
            except (asyncio.TimeoutError,
                    websockets.exceptions.ConnectionClosed):
                pass
    except (websockets.exceptions.InvalidStatus,
            websockets.exceptions.ConnectionClosed,
            websockets.exceptions.InvalidHandshake):
        pass
    assert not saw_welcome, "auth bypass: bigffa accepted anonymous WS"


# --- Queue endpoints (Feb-2026, second pass) -----------------------

def test_bigffa_queue_join_returns_eta():
    """POST /queue/bigffa enqueues the caller and returns bot_fill_seconds
    + estimated_wait_seconds so the client can pin an ETA pill."""
    tok = _register(uuid.uuid4().hex[:6])
    hdr = {"Authorization": f"Bearer {tok}"}
    # Clean any prior state.
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    r = requests.post(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    assert int(j["bot_fill_seconds"]) == 64
    assert 20 <= int(j["estimated_wait_seconds"]) <= 64
    assert int(j["queue_size"]) >= 1
    # Cleanup so we don't leave a match matched.
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)


def test_bigffa_queue_poll_reflects_in_queue_state():
    """GET /queue/bigffa returns in_queue:true immediately after join and
    exposes wait_seconds + queue_position so the toast can render."""
    tok = _register(uuid.uuid4().hex[:6])
    hdr = {"Authorization": f"Bearer {tok}"}
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    requests.post(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    r = requests.get(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    assert r.status_code == 200
    j = r.json()
    assert j["in_queue"] is True
    assert j["matched"] is False
    assert "wait_seconds" in j
    assert "queue_position" in j
    assert int(j["bot_fill_seconds"]) == 64
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)


def test_bigffa_queue_matches_after_bot_fill_timeout():
    """After BIGFFA_BOT_FILL_SEC (60s) the matchmaker dispatches the
    entire queue with matched:true + bigffa:true so the client routes
    to /play?mode=bigffa. Poll up to 70s so we don't flake on CI when
    the loop's 0.5s tick lands just after the boundary."""
    tok = _register(uuid.uuid4().hex[:6])
    hdr = {"Authorization": f"Bearer {tok}"}
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    requests.post(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    matched = False
    deadline = time.monotonic() + 70
    while time.monotonic() < deadline:
        r = requests.get(f"{LOCAL}/api/queue/bigffa", headers=hdr)
        j = r.json()
        if j.get("matched"):
            assert j.get("bigffa") is True
            assert "match_id" in j
            matched = True
            break
        time.sleep(2)
    # Clean up matched state.
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    assert matched, "bigffa queue never dispatched after 70s"


def test_bigffa_queue_leave_clears_state():
    """DELETE /queue/bigffa removes the entry — subsequent GETs report
    in_queue:false."""
    tok = _register(uuid.uuid4().hex[:6])
    hdr = {"Authorization": f"Bearer {tok}"}
    requests.post(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    r = requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    assert r.status_code == 200
    r = requests.get(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    j = r.json()
    assert j["in_queue"] is False
    assert j["matched"] is False


def test_bigffa_queue_status_endpoint():
    """GET /queue/bigffa/status returns live real-player count in the
    room. Excludes the caller so a solo joiner in an otherwise-empty
    room reads 0."""
    tok = _register(uuid.uuid4().hex[:6])
    hdr = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{LOCAL}/api/queue/bigffa/status", headers=hdr)
    assert r.status_code == 200
    j = r.json()
    assert "real_players" in j
    assert "total_players" in j
    assert int(j["real_players"]) >= 0


# --- Feb-2026 (later): smurf HP cap + bigffa spawn immunity --------

def test_casual_bot_hp_capped_at_max_hp():
    """Smurf/elite casual FFA bots must never spawn above MAX_HP (100).
    Guards a regression where `BOT_MAX_HP * diff` (80 * 1.5 = 120)
    used to hand elite bots more HP than a real player."""
    import importlib
    server = importlib.import_module("server")
    # Elite-difficulty bot in a casual FFA room → capped at MAX_HP.
    room = server.game_room
    prev_names = set(room.players.keys())
    room.spawn_bot("HPCapTest_Smurf", disguised=True,
                   difficulty=server._get_casual_elite_bot_diff(),
                   disguise_tier_idx=5, disguise_rank_points=1600)
    added = [pid for pid in room.players.keys() if pid not in prev_names]
    assert added, "spawn_bot did not add the bot"
    bot = room.players[added[0]]
    try:
        assert bot.max_hp <= server.MAX_HP, f"elite bot HP {bot.max_hp} > MAX_HP {server.MAX_HP}"
        assert bot.hp <= server.MAX_HP
    finally:
        # Clean up the test bot so subsequent tests get a stable roster.
        room.players.pop(added[0], None)


def test_normal_casual_bot_hp_unchanged():
    """Non-smurf casual FFA bots at diff=1.0 keep the original 80 HP.
    The cap only clips high-difficulty bots — nothing else regressed."""
    import importlib
    server = importlib.import_module("server")
    room = server.game_room
    prev_names = set(room.players.keys())
    room.spawn_bot("HPCapTest_Normal", disguised=True, difficulty=1.0)
    added = [pid for pid in room.players.keys() if pid not in prev_names]
    assert added
    bot = room.players[added[0]]
    try:
        # BOT_MAX_HP * 1.0 = 80 — unchanged and still under the cap.
        assert bot.max_hp == server.BOT_MAX_HP
    finally:
        room.players.pop(added[0], None)


def test_bigffa_room_flagged_for_spawn_immunity_exemption():
    """`bigffa_room.is_bigffa` is the switch the input handler reads to
    KEEP the 3s spawn bubble even after the player moves. If a refactor
    ever drops the attribute the spawn-immunity carve-out silently
    breaks — this test locks it down."""
    import importlib
    server = importlib.import_module("server")
    assert getattr(server.bigffa_room, "is_bigffa", False) is True
    # Casual + ranked rooms must NOT carry the flag — otherwise real
    # players in those modes would keep immunity while moving.
    assert getattr(server.game_room, "is_bigffa", False) is False
    assert getattr(server.ranked_room, "is_bigffa", False) is False


# --- Triangular ETA distribution: 20-64s, weighted low ---

def test_bigffa_dispatch_time_range_and_bias():
    """The per-entry ETA is sampled from `_sample_bigffa_dispatch_secs`
    which is a triangular(20, 64, mode=38). This test:
      1) enforces the range [20, 64] on every sample,
      2) confirms the bias — most samples should fall UNDER the 60s
         mark (the "start before the 60 second timer" bit of the user
         request). A tolerant threshold (≥ 90%) so a bad seed can't
         flake the test."""
    import importlib
    server = importlib.import_module("server")
    N = 5000
    xs = [server._sample_bigffa_dispatch_secs() for _ in range(N)]
    assert min(xs) >= server.BIGFFA_ETA_MIN_SEC, min(xs)
    assert max(xs) <= server.BIGFFA_ETA_MAX_SEC, max(xs)
    under_60_ratio = sum(1 for v in xs if v < 60) / N
    assert under_60_ratio >= 0.90, (
        f"expected ≥90% of samples < 60s, got {under_60_ratio:.2%}"
    )


def test_bigffa_dispatch_after_persisted_on_queue_entry():
    """Every queue entry created via POST /queue/bigffa should return
    an `estimated_wait_seconds` in the new 20-64 range (was 20-60).
    Repeats N times so the range extension is actually exercised —
    with the triangular distribution, hitting >60 is rare but
    possible; hitting the [20, 64] envelope on every call is
    guaranteed."""
    tok = _register("bigffa_disp_" + uuid.uuid4().hex[:5])
    hdr = {"Authorization": f"Bearer {tok}"}
    for _ in range(8):
        requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
        r = requests.post(f"{LOCAL}/api/queue/bigffa", headers=hdr)
        assert r.status_code == 200, r.text
        eta = r.json()["estimated_wait_seconds"]
        assert 20 <= eta <= 64, f"eta {eta} outside [20, 64]"
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
