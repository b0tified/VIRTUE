"""Backend tests for the Feb-2026 Mobile-Only Matchmaking feature.

Contract:
  - Queue-join POSTs (casual/ranked/bigffa) accept an optional
    `{is_mobile, mobile_only}` body.
  - The matchmaker pairs/dispatches respect `_platforms_compatible`:
    an entry with `mobile_only=True` can only cohort with `is_mobile=True`
    entries.
"""
import time
import uuid

import pytest
import requests

LOCAL = "http://localhost:8001"


def _register(suffix: str) -> tuple[str, str, str]:
    """Register/login a throwaway user; returns (email, username, token)."""
    email = f"TEST_mm_{suffix}@shooter.com"
    username = f"TESTmm{suffix}"[:20]
    r = requests.post(f"{LOCAL}/api/auth/register",
                      json={"email": email, "password": "Passw0rd!", "username": username})
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": email, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    return email, username, r.json()["access_token"]


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# --- Endpoint payload acceptance ----------------------------------

def test_casual_accepts_mobile_flags():
    _, _, tok = _register(uuid.uuid4().hex[:6])
    hdr = _auth(tok)
    requests.delete(f"{LOCAL}/api/queue/casual", headers=hdr)
    r = requests.post(f"{LOCAL}/api/queue/casual", json={"is_mobile": True, "mobile_only": True}, headers=hdr)
    assert r.status_code == 200, r.text
    requests.delete(f"{LOCAL}/api/queue/casual", headers=hdr)


def test_bigffa_accepts_mobile_flags():
    _, _, tok = _register(uuid.uuid4().hex[:6])
    hdr = _auth(tok)
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    r = requests.post(f"{LOCAL}/api/queue/bigffa", json={"is_mobile": True, "mobile_only": True}, headers=hdr)
    assert r.status_code == 200, r.text
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)


def test_queue_endpoints_still_accept_empty_body():
    """Legacy clients (no payload) must still work — default flags are False."""
    _, _, tok = _register(uuid.uuid4().hex[:6])
    hdr = _auth(tok)
    requests.delete(f"{LOCAL}/api/queue/casual", headers=hdr)
    r = requests.post(f"{LOCAL}/api/queue/casual", headers=hdr)
    assert r.status_code == 200
    requests.delete(f"{LOCAL}/api/queue/casual", headers=hdr)


# --- `_platforms_compatible` unit tests ---------------------------

def test_platforms_compat_unit():
    """Direct unit test on the helper: mobile-only can't cohort with a
    desktop entry, but two mobile entries (regardless of flag combo)
    always can, and two desktop entries always can."""
    import importlib
    server = importlib.import_module("server")
    compat = server._platforms_compatible
    # Both desktop, no restrictions → compatible.
    assert compat({"is_mobile": False, "mobile_only": False},
                  {"is_mobile": False, "mobile_only": False}) is True
    # Mobile-only vs desktop → incompatible.
    assert compat({"is_mobile": True, "mobile_only": True},
                  {"is_mobile": False, "mobile_only": False}) is False
    # Reverse: desktop vs mobile-only mobile → incompatible.
    assert compat({"is_mobile": False, "mobile_only": False},
                  {"is_mobile": True, "mobile_only": True}) is False
    # Two mobile players, one restricted, one not → still compatible.
    assert compat({"is_mobile": True, "mobile_only": True},
                  {"is_mobile": True, "mobile_only": False}) is True
    # Two mobile-only mobile players → compatible.
    assert compat({"is_mobile": True, "mobile_only": True},
                  {"is_mobile": True, "mobile_only": True}) is True
    # Non-mobile-only mobile user vs desktop → compatible (they don't care).
    assert compat({"is_mobile": True, "mobile_only": False},
                  {"is_mobile": False, "mobile_only": False}) is True


# --- BigFFA dispatch respects platform preference -----------------

def test_bigffa_mobile_only_gets_own_match():
    """A mobile-only mobile user in the bigffa queue does NOT get
    dispatched into the same match as a desktop-only queuer, even after
    the 60s timeout elapses. Each ends up with a distinct `match_id`."""
    _, _, tok_mobile = _register(uuid.uuid4().hex[:6])
    _, _, tok_desktop = _register(uuid.uuid4().hex[:6])
    hdr_m = _auth(tok_mobile)
    hdr_d = _auth(tok_desktop)
    # Clean any stale state.
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr_m)
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr_d)
    # Mobile-only enqueues first.
    r_m = requests.post(f"{LOCAL}/api/queue/bigffa",
                       json={"is_mobile": True, "mobile_only": True},
                       headers=hdr_m)
    assert r_m.status_code == 200
    # Desktop queues right after.
    r_d = requests.post(f"{LOCAL}/api/queue/bigffa",
                       json={"is_mobile": False, "mobile_only": False},
                       headers=hdr_d)
    assert r_d.status_code == 200
    # Poll both for up to 75s. Both should eventually get `matched:true`
    # via the BIGFFA_BOT_FILL_SEC timeout, and their match_ids must differ.
    mid_m: str | None = None
    mid_d: str | None = None
    deadline = time.monotonic() + 75
    while time.monotonic() < deadline and (mid_m is None or mid_d is None):
        if mid_m is None:
            j = requests.get(f"{LOCAL}/api/queue/bigffa", headers=hdr_m).json()
            if j.get("matched"):
                mid_m = j.get("match_id")
        if mid_d is None:
            j = requests.get(f"{LOCAL}/api/queue/bigffa", headers=hdr_d).json()
            if j.get("matched"):
                mid_d = j.get("match_id")
        time.sleep(2)
    # Clean up matched state.
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr_m)
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr_d)
    assert mid_m is not None, "mobile-only queuer never got matched"
    assert mid_d is not None, "desktop queuer never got matched"
    assert mid_m != mid_d, (
        f"mobile-only + desktop ended up in the same match ({mid_m}) — "
        "platform partition failed"
    )


# --- Mobile mode: weakened bots + phone icon (Feb-2026, part 2) ----

def test_room_has_mobile_only_players_helper():
    """`has_mobile_only_players` is the single source of truth for the
    room's mobile-mode nerf. False when the room is empty; True once a
    real player with `is_mobile_only=True` joins; False again after
    they leave."""
    import importlib
    server = importlib.import_module("server")
    room = server.bigffa_room
    # Clear-slate assertion (may be True if a lingering test player is present).
    baseline = room.has_mobile_only_players()

    # Manually add a synthetic real player marked mobile-only.
    fake = server.Player(ws=None, user={"_id": "test", "username": "MobFake", "email": "mob@x.com"}, is_bot=False)
    fake.is_mobile_only = True
    room.players[fake.id] = fake
    try:
        assert room.has_mobile_only_players() is True
    finally:
        room.players.pop(fake.id, None)

    assert room.has_mobile_only_players() == baseline  # restored


def test_bot_spawned_in_mobile_room_is_nerfed_and_tagged():
    """`spawn_bot` in a room with a mobile-only player scales difficulty
    × 0.45 AND flips the (disguised) bot's platform to `mobile` so the
    scoreboard renders the phone icon."""
    import importlib
    server = importlib.import_module("server")
    room = server.bigffa_room
    fake = server.Player(ws=None, user={"_id": "test2", "username": "MobFake2", "email": "mob2@x.com"}, is_bot=False)
    fake.is_mobile_only = True
    room.players[fake.id] = fake
    try:
        prev_ids = set(room.players.keys())
        # Spawn a disguised smurf-tier bot (raw diff 2.0 → nerfed to 0.9).
        room.spawn_bot("MobNerfTest",
                      disguised=True,
                      difficulty=2.0,
                      disguise_tier_idx=5,
                      disguise_rank_points=1600)
        added = [pid for pid in room.players.keys() if pid not in prev_ids]
        assert added, "spawn_bot did not add the bot"
        bot = room.players[added[0]]
        try:
            # 2.0 * 0.45 = 0.90 → still ≥ the 0.5 floor in Player init.
            assert abs(bot.difficulty - 0.9) < 0.01, f"bot.difficulty={bot.difficulty}"
            assert bot.disguise_platform == "mobile"
        finally:
            room.players.pop(added[0], None)
    finally:
        room.players.pop(fake.id, None)


def test_bot_spawned_in_normal_room_is_not_nerfed():
    """Sanity control: when NO mobile-only player is in the room, bots
    keep their vanilla difficulty and the disguise platform can be
    non-mobile (random). Verifies the mobile-mode branch is properly
    gated."""
    import importlib
    server = importlib.import_module("server")
    room = server.game_room  # casual room — should not have any mobile-only players
    # Skip if a lingering test polluted the room.
    if room.has_mobile_only_players():
        pytest.skip("casual room currently hosts a mobile-only player")
    prev_ids = set(room.players.keys())
    room.spawn_bot("NoNerfTest", disguised=True, difficulty=2.0,
                  disguise_tier_idx=5, disguise_rank_points=1600)
    added = [pid for pid in room.players.keys() if pid not in prev_ids]
    assert added
    bot = room.players[added[0]]
    try:
        assert abs(bot.difficulty - 2.0) < 0.01, f"bot.difficulty={bot.difficulty}"
    finally:
        room.players.pop(added[0], None)
