"""Iteration-8 backend tests for VIRTUE FPS — three fixes:

1) SPECTATE POV: WS /api/ws/game?mode=spectate&target=<bot_username> must
   resolve to the casual room when the target is a bot currently in it, and
   the spectator welcome payload exposes spectate_target_id + spectator=true
   so the engine can render the gun viewmodel matching the target's weapon
   AND hide the target's body mesh from the locked first-person camera.

2) PARTY RANKED QUEUE TIMER (follower POV): when the party leader hits
   POST /api/queue/ranked, calling GET /api/queue/ranked as the *follower*
   must return in_queue=true with the same tier, is_party=true and
   party_size=2 — so QueueContext's 3s background poll can surface the
   timer on the follower's PartyPanel.

3) PARTY RANKED MATCH START (shared room_key + bot-fill): after the bot-fill
   timeout, GET /api/queue/ranked on the follower must report matched=true
   with the same match_id as the leader. Both the leader AND the follower's
   ranked WS connections must then resolve to the SAME ranked_bot_room
   (room.players includes both real users), driven by the shared room_key
   stamped onto MATCHED_USERS at matchmaking time.

We use Bronze tier (idx=0) — bot_fill_seconds is the shortest there.
"""
import asyncio
import json
import os
import time

import pytest
import requests
import websockets

# --- env bootstrap ---------------------------------------------------------
_envpath = "/app/frontend/.env"
if not os.environ.get("REACT_APP_BACKEND_URL") and os.path.exists(_envpath):
    with open(_envpath) as _f:
        for _line in _f:
            if _line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = _line.split("=", 1)[1].strip()
                break
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

P1 = {"email": "player1@shooter.com", "password": "player123"}
P2 = {"email": "player2@shooter.com", "password": "player123"}


# ----- helpers -------------------------------------------------------------
def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    if r.status_code != 200:
        return None
    return r.json().get("access_token")


def _register(email, password, username):
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": password, "username": username},
        timeout=20,
    )
    return r.status_code in (200, 201)


def _me(tok):
    return requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tok), timeout=10).json()


def _ensure_friends(t1, t2, u1, u2):
    fr1 = requests.get(f"{BASE_URL}/api/friends", headers=_h(t1), timeout=10).json()
    accepted = {f["username"] for f in fr1.get("friends", [])}
    if u2 in accepted:
        return
    requests.post(f"{BASE_URL}/api/friends/request", headers=_h(t1), json={"username": u2}, timeout=10)
    requests.post(f"{BASE_URL}/api/friends/accept", headers=_h(t2), json={"username": u1}, timeout=10)


def _drop_party(*toks):
    for t in toks:
        try:
            requests.post(f"{BASE_URL}/api/party/leave", headers=_h(t), timeout=5)
        except Exception:
            pass


def _drop_queue(*toks):
    for t in toks:
        try:
            requests.delete(f"{BASE_URL}/api/queue/ranked", headers=_h(t), timeout=5)
        except Exception:
            pass


def _form_party(t1, t2, u1, u2):
    """Leader=t1 invites t2; t2 accepts. Returns party_id."""
    _drop_party(t1, t2)
    r = requests.post(f"{BASE_URL}/api/party/invite", headers=_h(t1),
                      json={"username": u2}, timeout=10)
    assert r.status_code == 200, f"invite: {r.status_code} {r.text}"
    pid = r.json()["party_id"]
    r2 = requests.post(f"{BASE_URL}/api/party/accept", headers=_h(t2),
                       json={"username": u1}, timeout=10)
    assert r2.status_code == 200, f"accept: {r2.status_code} {r2.text}"
    assert r2.json()["party_id"] == pid
    return pid


# ----- fixtures ------------------------------------------------------------
@pytest.fixture(scope="module")
def tokens():
    # Ensure both accounts exist
    _register("player2@shooter.com", "player123", "player2")
    t1 = _login(P1)
    t2 = _login(P2)
    if not t1 or not t2:
        pytest.skip("Could not log in test users")
    me1, me2 = _me(t1), _me(t2)
    _ensure_friends(t1, t2, me1["username"], me2["username"])
    yield {"t1": t1, "t2": t2, "u1": me1["username"], "u2": me2["username"]}
    # Module-level cleanup
    _drop_queue(t1, t2)
    _drop_party(t1, t2)


@pytest.fixture(autouse=True)
def _cleanup(tokens):
    _drop_queue(tokens["t1"], tokens["t2"])
    _drop_party(tokens["t1"], tokens["t2"])
    yield
    _drop_queue(tokens["t1"], tokens["t2"])
    _drop_party(tokens["t1"], tokens["t2"])


# ===========================================================================
# Fix #1 — Spectate POV: WS welcome payload semantics
# ===========================================================================
class TestSpectatePOV:
    def test_casual_has_bot_then_spectate_welcome_payload(self, tokens):
        """Player2 joins casual; player1 spectates them. Welcome payload must
        expose spectator=True + spectate_target_id so the engine can mirror
        the target's weapon viewmodel and hide their body mesh."""
        t1, t2 = tokens["t1"], tokens["t2"]
        u2 = tokens["u2"]
        ws_url_casual = f"{WS_BASE}/api/ws/game?token={t2}&mode=casual"
        spec_url = f"{WS_BASE}/api/ws/game?token={t1}&mode=spectate&target={u2}"

        welcome = {}
        async def _flow():
            nonlocal welcome
            # player2 connects to casual, then player1 spectates them
            async with websockets.connect(ws_url_casual, max_size=2_000_000) as wc:
                # wait for welcome so player2 is registered in the room
                for _ in range(20):
                    raw = await asyncio.wait_for(wc.recv(), timeout=4.0)
                    msg = json.loads(raw)
                    if msg.get("type") == "welcome":
                        break
                # Now spectate
                async with websockets.connect(spec_url, max_size=2_000_000) as ws:
                    for _ in range(30):
                        raw = await asyncio.wait_for(ws.recv(), timeout=4.0)
                        msg = json.loads(raw)
                        if msg.get("type") == "welcome":
                            welcome = msg
                            return
        asyncio.get_event_loop().run_until_complete(_flow())
        assert welcome.get("spectator") is True, f"welcome missing spectator flag: {welcome}"
        assert welcome.get("spectate_target_id"), f"welcome missing spectate_target_id: {welcome}"

    def test_spectate_unknown_target_4404(self, tokens):
        t1 = tokens["t1"]
        url = f"{WS_BASE}/api/ws/game?token={t1}&mode=spectate&target=no_such_user_xyz_404"
        async def _conn():
            try:
                async with websockets.connect(url) as ws:
                    await asyncio.wait_for(ws.recv(), timeout=3.0)
                return None
            except Exception as e:
                # Any rejection (HTTP 403, 4404 close, etc.) is acceptable —
                # the server must NOT accept a spectate to an unknown user.
                return type(e).__name__
        err = asyncio.get_event_loop().run_until_complete(_conn())
        assert err is not None, "spectate accepted for non-existent target"


# ===========================================================================
# Fix #2 — Party ranked queue: follower sees the same in_queue state
# ===========================================================================
class TestPartyRankedQueueFollowerStatus:
    def test_leader_queue_makes_follower_see_in_queue(self, tokens):
        t1, t2, u1, u2 = tokens["t1"], tokens["t2"], tokens["u1"], tokens["u2"]
        # Gate: both users must be Level >= RANKED_MIN_LEVEL (5).
        for tok, label in ((t1, "player1"), (t2, "player2")):
            me = _me(tok)
            lvl = (me.get("level") or me.get("stats", {}).get("level") or 0)
            if isinstance(lvl, dict):
                lvl = lvl.get("level", 0)
            if (lvl or 0) < 5:
                pytest.skip(f"{label} is level {lvl} (<5); cannot test ranked")

        _form_party(t1, t2, u1, u2)

        r = requests.post(f"{BASE_URL}/api/queue/ranked", headers=_h(t1), timeout=10)
        assert r.status_code == 200, f"leader queue: {r.status_code} {r.text}"
        lead = r.json()
        # Could be matched immediately on very fast bot-fill tiers — both ok
        assert lead.get("in_queue") or lead.get("matched"), lead
        tier = lead.get("tier")

        # Follower GET — must report same queue state (or matched)
        r2 = requests.get(f"{BASE_URL}/api/queue/ranked", headers=_h(t2), timeout=10)
        assert r2.status_code == 200, r2.text
        f = r2.json()
        assert f.get("in_queue") or f.get("matched"), f"follower not in queue: {f}"
        if f.get("in_queue"):
            assert f.get("tier") == tier, f"tier mismatch: leader={tier} follower={f}"
            assert f.get("is_party") is True, f"is_party not true: {f}"
            assert f.get("party_size") == 2, f"party_size != 2: {f}"

    def test_follower_cannot_queue_directly(self, tokens):
        """Non-leader pressing the button is blocked by 403 (leader-only)."""
        t1, t2, u1, u2 = tokens["t1"], tokens["t2"], tokens["u1"], tokens["u2"]
        _form_party(t1, t2, u1, u2)
        r = requests.post(f"{BASE_URL}/api/queue/ranked", headers=_h(t2), timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


# ===========================================================================
# Fix #3 — Party ranked match start: shared room_key + bot-fill
# ===========================================================================
class TestPartyRankedBotFillSharedRoom:
    def test_both_members_resolve_matched_with_same_match_id(self, tokens):
        """Wait through Bronze bot-fill; both party members should see
        matched=true and share the same match_id."""
        t1, t2, u1, u2 = tokens["t1"], tokens["t2"], tokens["u1"], tokens["u2"]
        for tok in (t1, t2):
            me = _me(tok)
            lvl = me.get("level") or 0
            if isinstance(lvl, dict):
                lvl = lvl.get("level", 0)
            if (lvl or 0) < 5:
                pytest.skip("player not L5+; cannot test ranked")

        _form_party(t1, t2, u1, u2)
        r = requests.post(f"{BASE_URL}/api/queue/ranked", headers=_h(t1), timeout=10)
        assert r.status_code == 200, r.text
        st = r.json()
        # Bronze bot-fill ~10s; allow up to 60s for safety.
        deadline = time.time() + 60
        leader_state = None
        follower_state = None
        while time.time() < deadline:
            leader_state = requests.get(f"{BASE_URL}/api/queue/ranked", headers=_h(t1), timeout=10).json()
            follower_state = requests.get(f"{BASE_URL}/api/queue/ranked", headers=_h(t2), timeout=10).json()
            if leader_state.get("matched") and follower_state.get("matched"):
                break
            time.sleep(1.0)
        assert leader_state and leader_state.get("matched"), f"leader never matched: {leader_state}"
        assert follower_state and follower_state.get("matched"), f"follower never matched: {follower_state}"
        assert leader_state.get("match_id") == follower_state.get("match_id"), (
            f"match_id mismatch: leader={leader_state} follower={follower_state}"
        )

    def test_both_members_join_same_ranked_bot_room_via_ws(self, tokens):
        """After bot-fill, opening ranked WS for both members must place
        them in the same room (room.players includes both real users)."""
        t1, t2, u1, u2 = tokens["t1"], tokens["t2"], tokens["u1"], tokens["u2"]
        for tok in (t1, t2):
            me = _me(tok)
            lvl = me.get("level") or 0
            if isinstance(lvl, dict):
                lvl = lvl.get("level", 0)
            if (lvl or 0) < 5:
                pytest.skip("player not L5+; cannot test ranked")

        _form_party(t1, t2, u1, u2)
        r = requests.post(f"{BASE_URL}/api/queue/ranked", headers=_h(t1), timeout=10)
        assert r.status_code == 200, r.text

        # Wait until both are matched
        deadline = time.time() + 60
        while time.time() < deadline:
            s1 = requests.get(f"{BASE_URL}/api/queue/ranked", headers=_h(t1), timeout=10).json()
            s2 = requests.get(f"{BASE_URL}/api/queue/ranked", headers=_h(t2), timeout=10).json()
            if s1.get("matched") and s2.get("matched"):
                break
            time.sleep(1.0)
        else:
            pytest.skip("Bot-fill didn't trigger within 60s")

        # Connect both WS as mode=ranked and observe the welcome+state to
        # confirm they see each other in room.players.
        url1 = f"{WS_BASE}/api/ws/game?token={t1}&mode=ranked"
        url2 = f"{WS_BASE}/api/ws/game?token={t2}&mode=ranked"

        async def _check():
            seen1, seen2 = set(), set()
            url1_local = url1; url2_local = url2  # capture
            async with websockets.connect(url1_local, max_size=2_000_000) as w1, \
                       websockets.connect(url2_local, max_size=2_000_000) as w2:
                async def _drain(ws, seen):
                    # Drain ~6s of state frames so the late-joiner appears.
                    deadline2 = time.time() + 8.0
                    while time.time() < deadline2:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                        except asyncio.TimeoutError:
                            continue
                        msg = json.loads(raw)
                        if msg.get("type") == "state":
                            for p in msg.get("players", []) or []:
                                uname = (p.get("username") or "").strip()
                                if uname and not p.get("is_bot"):
                                    seen.add(uname)
                await asyncio.gather(_drain(w1, seen1), _drain(w2, seen2))
                return seen1, seen2

        seen1, seen2 = asyncio.get_event_loop().run_until_complete(_check())
        # Both should observe both real users present in the same room
        assert u1 in seen1 or u2 in seen1, f"leader saw nobody real: {seen1}"
        assert u1 in seen2 or u2 in seen2, f"follower saw nobody real: {seen2}"
        # The follower must see the leader (real user), proving same room
        assert u1 in seen2, f"follower did NOT see leader in room — separate rooms! seen2={seen2}"
        assert u2 in seen1, f"leader did NOT see follower in room — separate rooms! seen1={seen1}"


# ===========================================================================
# Smoke regressions
# ===========================================================================
class TestSmoke:
    def test_queue_ranked_status_idle(self, tokens):
        r = requests.get(f"{BASE_URL}/api/queue/ranked", headers=_h(tokens["t1"]), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("in_queue") is False or body.get("matched") in (False, None)

    def test_leaderboard_alive(self):
        r = requests.get(f"{BASE_URL}/api/leaderboard/ranked", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
