"""Iteration-5 backend tests:
   - POST/GET/POST(accept)/POST(decline) /api/party/*
   - GET /api/users/{username}/profile (no email leak)
   - WS party room: 2 humans + 3 disguised bots, same room state
   - Casual disguised bots (is_bot=False, human names, platform pc/mobile, rank not BOT)
   - Ranked / Practice / Offline bots stay non-disguised (is_bot=True)
   - Smoke: friends, profile history, leaderboard still work
"""
import os
import json
import asyncio
import pytest
import requests
import websockets

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


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    t1 = _login(P1)
    t2 = _login(P2)
    return {"t1": t1, "t2": t2}


@pytest.fixture(scope="module", autouse=True)
def ensure_friends(tokens):
    """Make sure player1 and player2 are mutual accepted friends."""
    t1, t2 = tokens["t1"], tokens["t2"]
    # Probe current relationship.
    me1 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(t1), timeout=10).json()
    me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(t2), timeout=10).json()
    u1 = me1["username"]
    u2 = me2["username"]
    fr1 = requests.get(f"{BASE_URL}/api/friends", headers=_h(t1), timeout=10).json()
    accepted = {f["username"] for f in fr1.get("friends", [])}
    if u2 not in accepted:
        # Try fresh request/accept (idempotent on backend)
        requests.post(f"{BASE_URL}/api/friends/request", headers=_h(t1), json={"username": u2}, timeout=10)
        requests.post(f"{BASE_URL}/api/friends/accept", headers=_h(t2), json={"username": u1}, timeout=10)
    yield


# ---------------- Party endpoints ----------------
class TestPartyEndpoints:
    def test_invite_unknown_user_404(self, tokens):
        r = requests.post(f"{BASE_URL}/api/party/invite", headers=_h(tokens["t1"]),
                          json={"username": "no_such_user_zz_zz_zz"}, timeout=10)
        assert r.status_code == 404, r.text

    def test_invite_self_400(self, tokens):
        me1 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t1"]), timeout=10).json()
        r = requests.post(f"{BASE_URL}/api/party/invite", headers=_h(tokens["t1"]),
                          json={"username": me1["username"]}, timeout=10)
        assert r.status_code == 400, r.text

    def test_invite_friend_returns_party_id(self, tokens):
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t2"]), timeout=10).json()
        r = requests.post(f"{BASE_URL}/api/party/invite", headers=_h(tokens["t1"]),
                          json={"username": me2["username"]}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "party_id" in body and isinstance(body["party_id"], str) and len(body["party_id"]) >= 6

    def test_invitee_sees_invite_in_list(self, tokens):
        me1 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t1"]), timeout=10).json()
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t2"]), timeout=10).json()
        # invite again to be sure
        inv = requests.post(f"{BASE_URL}/api/party/invite", headers=_h(tokens["t1"]),
                            json={"username": me2["username"]}, timeout=10).json()
        r = requests.get(f"{BASE_URL}/api/party/invites", headers=_h(tokens["t2"]), timeout=10)
        assert r.status_code == 200
        invites = r.json()
        assert isinstance(invites, list) and len(invites) >= 1
        match = next((i for i in invites if i["from_username"] == me1["username"]), None)
        assert match is not None
        assert match["party_id"] == inv["party_id"]
        for k in ("from_user_id", "from_username", "from_avatar", "party_id", "expires_at"):
            assert k in match, f"missing key {k}"

    def test_accept_returns_same_party_id(self, tokens):
        me1 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t1"]), timeout=10).json()
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t2"]), timeout=10).json()
        inv = requests.post(f"{BASE_URL}/api/party/invite", headers=_h(tokens["t1"]),
                            json={"username": me2["username"]}, timeout=10).json()
        r = requests.post(f"{BASE_URL}/api/party/accept", headers=_h(tokens["t2"]),
                         json={"username": me1["username"]}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["party_id"] == inv["party_id"]

    def test_accept_with_no_active_invite_404(self, tokens):
        # After previous accept consumed it.
        me1 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t1"]), timeout=10).json()
        r = requests.post(f"{BASE_URL}/api/party/accept", headers=_h(tokens["t2"]),
                         json={"username": me1["username"]}, timeout=10)
        assert r.status_code == 404, r.text

    def test_decline_clears_invite(self, tokens):
        me1 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t1"]), timeout=10).json()
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t2"]), timeout=10).json()
        requests.post(f"{BASE_URL}/api/party/invite", headers=_h(tokens["t1"]),
                      json={"username": me2["username"]}, timeout=10)
        r = requests.post(f"{BASE_URL}/api/party/decline", headers=_h(tokens["t2"]),
                         json={"username": me1["username"]}, timeout=10)
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        # invite list should not contain p1 anymore
        invites = requests.get(f"{BASE_URL}/api/party/invites", headers=_h(tokens["t2"]), timeout=10).json()
        assert all(i["from_username"] != me1["username"] for i in invites)


# ---------------- Public profile ----------------
class TestPublicProfile:
    def test_profile_no_email_leak(self, tokens):
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t2"]), timeout=10).json()
        r = requests.get(f"{BASE_URL}/api/users/{me2['username']}/profile",
                        headers=_h(tokens["t1"]), timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # Hard requirement: no email field anywhere
        assert "email" not in data, f"email LEAKED: {data}"
        # Also ensure no email-like value sneaked in any string field at top level
        raw_text = json.dumps(data)
        assert "@shooter.com" not in raw_text, f"email leaked in body: {raw_text}"
        for key in ("username", "avatar", "stats", "rank_points", "rank_tier", "rank_name",
                    "peak_rank_points", "peak_rank_tier", "peak_rank_name", "online", "history"):
            assert key in data, f"missing key {key}"
        assert isinstance(data["history"], list)
        assert isinstance(data["stats"], dict)
        for s in ("kills", "deaths", "matches"):
            assert s in data["stats"]

    def test_profile_unknown_404(self, tokens):
        r = requests.get(f"{BASE_URL}/api/users/__no_such_user__/profile",
                        headers=_h(tokens["t1"]), timeout=10)
        assert r.status_code == 404


# ---------------- Disguised bots — casual ----------------
DISGUISED_NAMES = {
    "n3onGhost42", "ShadowKnife", "BlitzReaper", "x_zenith_x", "PixelPunk",
    "Krypt0nite", "0verkill", "RogueByte", "FlareStorm", "VoltKid", "Mute_Echo",
    "QwiKshot", "redhatcat", "vp1r3lord", "TheSarcophagus",
}


async def _ws_connect_get_state(token, mode, party_id=None, timeout=8.0):
    """Connect to WS, return first `state` payload."""
    qp = f"token={token}&mode={mode}"
    if party_id:
        qp += f"&party_id={party_id}"
    url = f"{WS_BASE}/api/ws/game?{qp}"
    state = None
    async with websockets.connect(url, max_size=2**22) as ws:
        end = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            except asyncio.TimeoutError:
                continue
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if msg.get("type") == "state":
                state = msg
                break
        return state


class TestDisguisedBots:
    async def test_casual_bots_disguised(self, tokens):
        st = await _ws_connect_get_state(tokens["t1"], "casual")
        assert st is not None, "no state from casual room"
        players = st.get("players", [])
        assert len(players) >= 2, f"too few players: {players}"
        # Identify bots — disguised => is_bot False but username matches DISGUISED_NAMES
        suspected_bots = [p for p in players if p["username"] in DISGUISED_NAMES]
        assert len(suspected_bots) >= 1, f"no disguised bots found: {[p['username'] for p in players]}"
        for b in suspected_bots:
            assert b["is_bot"] is False, f"casual disguised bot should report is_bot=False: {b}"
            assert b["platform"] in ("pc", "mobile"), f"bad platform {b}"
            assert b["rank_name"] != "BOT", f"rank_name should not be BOT: {b}"

    async def test_practice_bots_remain_real_bots(self, tokens):
        st = await _ws_connect_get_state(tokens["t1"], "practice")
        assert st is not None
        bots = [p for p in st["players"] if p["username"].startswith("DUMMY")]
        assert bots, f"no DUMMY bots in practice: {st['players']}"
        for b in bots:
            assert b["is_bot"] is True, f"DUMMY bots must remain is_bot=True: {b}"

    async def test_offline_bots_remain_real_bots(self, tokens):
        st = await _ws_connect_get_state(tokens["t1"], "offline")
        assert st is not None
        bots = [p for p in st["players"] if p["username"].endswith("-O")]
        assert bots, f"no -O bots in offline: {st['players']}"
        for b in bots:
            assert b["is_bot"] is True

    async def test_ranked_room_bot_not_disguised(self, tokens):
        st = await _ws_connect_get_state(tokens["t1"], "ranked")
        assert st is not None
        bots = [p for p in st["players"] if p["username"].endswith("-R") or p["username"].endswith("-RB")]
        # the global ranked_room has BLAZE-7-R; per-user ranked-bot room is separate. Accept either.
        if bots:
            for b in bots:
                assert b["is_bot"] is True


# ---------------- Party WS room ----------------
class TestPartyRoom:
    async def test_party_room_shared_state_with_3_bots(self, tokens):
        me1 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t1"]), timeout=10).json()
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(tokens["t2"]), timeout=10).json()
        inv = requests.post(f"{BASE_URL}/api/party/invite", headers=_h(tokens["t1"]),
                            json={"username": me2["username"]}, timeout=10).json()
        pid = inv["party_id"]
        ack = requests.post(f"{BASE_URL}/api/party/accept", headers=_h(tokens["t2"]),
                            json={"username": me1["username"]}, timeout=10).json()
        assert ack["party_id"] == pid

        url_a = f"{WS_BASE}/api/ws/game?token={tokens['t1']}&mode=party&party_id={pid}"
        url_b = f"{WS_BASE}/api/ws/game?token={tokens['t2']}&mode=party&party_id={pid}"

        async def collect_state(ws, deadline):
            st = None
            while asyncio.get_event_loop().time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                except asyncio.TimeoutError:
                    continue
                try:
                    m = json.loads(raw)
                except Exception:
                    continue
                if m.get("type") == "state":
                    st = m
                    if len(st.get("players", [])) >= 5:
                        return st
            return st

        async with websockets.connect(url_a, max_size=2**22) as ws_a:
            async with websockets.connect(url_b, max_size=2**22) as ws_b:
                # both clients should reach a 5-player state (2 humans + 3 bots).
                end = asyncio.get_event_loop().time() + 8.0
                st_a, st_b = await asyncio.gather(
                    collect_state(ws_a, end),
                    collect_state(ws_b, end),
                )
                assert st_a is not None and st_b is not None, "no state received"
                ids_a = {p["id"] for p in st_a["players"]}
                ids_b = {p["id"] for p in st_b["players"]}
                # Both clients should see the same set of player IDs.
                assert ids_a == ids_b, f"player id mismatch: a={ids_a} b={ids_b}"
                assert len(ids_a) == 5, f"expected 5 (2 humans + 3 bots), got {len(ids_a)}: {[p['username'] for p in st_a['players']]}"
                # 3 disguised bots
                disguised = [p for p in st_a["players"] if p["username"] in DISGUISED_NAMES]
                assert len(disguised) == 3, f"expected 3 disguised bots, got {len(disguised)}"
                for b in disguised:
                    assert b["is_bot"] is False
                    assert b["platform"] in ("pc", "mobile")
                    assert b["rank_name"] != "BOT"


# ---------------- Smoke tests for prior endpoints ----------------
class TestSmokeRegression:
    def test_friends_endpoint_ok(self, tokens):
        r = requests.get(f"{BASE_URL}/api/friends", headers=_h(tokens["t1"]), timeout=10)
        assert r.status_code == 200
        body = r.json()
        for k in ("friends", "incoming", "outgoing", "blocked"):
            assert k in body

    def test_profile_me_history_ok(self, tokens):
        r = requests.get(f"{BASE_URL}/api/profile/me/history?limit=5", headers=_h(tokens["t1"]), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, list) or ("history" in body)

    def test_leaderboard_ok(self):
        r = requests.get(f"{BASE_URL}/api/leaderboard", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
