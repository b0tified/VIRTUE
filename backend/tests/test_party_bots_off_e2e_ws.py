"""E2E (HTTP + live WebSocket) verification of the BOTS OFF custom-lobby fix.

Exercises the real runtime path the pytest in
test_party_bots_off_no_autofill.py could not: an actual
/api/ws/game?mode=party connection through the public ingress, watching
several server state broadcasts to prove `_maintain_population` never
backfills bots when the leader picked BOTS OFF.
"""
import asyncio
import json
import os
import time

import pytest
import requests
import websockets
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/game"

LEADER = {"email": "partyleader@test.com", "password": "pw123456", "username": "partyleader"}
FOLLOWER = {"email": "partyfollower@test.com", "password": "pw123456", "username": "partyfollower"}


def _login_or_register(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": creds["email"], "password": creds["password"]}, timeout=20)
    if r.status_code != 200:
        r = s.post(f"{BASE_URL}/api/auth/register", json=creds, timeout=20)
        assert r.status_code in (200, 201), f"register failed {r.status_code} {r.text[:300]}"
    data = r.json()
    token = data.get("access_token")
    assert token, f"no access_token in login response: {data}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s, token


@pytest.fixture(scope="module")
def leader():
    return _login_or_register(LEADER)


@pytest.fixture(scope="module")
def follower():
    return _login_or_register(FOLLOWER)


def _ensure_friends(ls, fs):
    ls.post(f"{BASE_URL}/api/friends/request", json={"username": FOLLOWER["username"]}, timeout=20)
    fs.post(f"{BASE_URL}/api/friends/accept", json={"username": LEADER["username"]}, timeout=20)
    r = ls.get(f"{BASE_URL}/api/friends", timeout=20)
    assert r.status_code == 200
    names = json.dumps(r.json())
    assert FOLLOWER["username"] in names, "leader/follower are not friends; party invite will 403"


def _ensure_party(ls, fs):
    """Leader + follower in one party, leader is leader. Returns party_id."""
    _ensure_friends(ls, fs)
    # Clean slate
    ls.post(f"{BASE_URL}/api/party/leave", timeout=20)
    fs.post(f"{BASE_URL}/api/party/leave", timeout=20)
    r = ls.post(f"{BASE_URL}/api/party/invite", json={"username": FOLLOWER["username"]}, timeout=20)
    assert r.status_code == 200, f"invite failed {r.status_code} {r.text[:300]}"
    party_id = r.json()["party_id"]
    r = fs.post(f"{BASE_URL}/api/party/accept", json={"username": LEADER["username"]}, timeout=20)
    assert r.status_code == 200, f"accept failed {r.status_code} {r.text[:300]}"
    assert len(r.json()["members"]) == 2
    return party_id


# ---------------- HTTP: /party/start flag persistence ----------------

def test_party_start_bots_off_persists(leader, follower):
    ls, _ = leader
    fs, _ = follower
    party_id = _ensure_party(ls, fs)
    r = ls.post(f"{BASE_URL}/api/party/start", json={"bots_enabled": False, "tdm": False}, timeout=20)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["bots_enabled"] is False
    me = ls.get(f"{BASE_URL}/api/party/me", timeout=20)
    assert me.status_code == 200
    body = me.json()
    assert body["party_id"] == party_id
    assert body["bots_enabled"] is False
    assert body["match_starting"] is True
    # Non-leader poll sees the same (auto-nav trigger)
    fme = fs.get(f"{BASE_URL}/api/party/me", timeout=20).json()
    assert fme["match_starting"] is True
    assert fme["bots_enabled"] is False


def test_party_start_bots_on_persists(leader, follower):
    ls, _ = leader
    fs, _ = follower
    _ensure_party(ls, fs)
    r = ls.post(f"{BASE_URL}/api/party/start", json={"bots_enabled": True}, timeout=20)
    assert r.status_code == 200
    assert r.json()["bots_enabled"] is True
    assert ls.get(f"{BASE_URL}/api/party/me", timeout=20).json()["bots_enabled"] is True


def test_party_start_no_body_defaults_true(leader, follower):
    ls, _ = leader
    fs, _ = follower
    _ensure_party(ls, fs)
    r = ls.post(f"{BASE_URL}/api/party/start", timeout=20)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["bots_enabled"] is True


def test_non_leader_cannot_start(leader, follower):
    ls, _ = leader
    fs, _ = follower
    _ensure_party(ls, fs)
    r = fs.post(f"{BASE_URL}/api/party/start", json={"bots_enabled": False}, timeout=20)
    assert r.status_code == 403, f"expected 403 for non-leader, got {r.status_code} {r.text[:200]}"


# ---------------- WebSocket runtime behaviour ----------------

HUMAN_USERNAMES = {LEADER["username"], FOLLOWER["username"]}


async def _observe(url, seconds=12.0):
    """Connect, send `loaded` (required to start the match / broadcasts),
    then collect roster snapshots. Returns list of (total, non_human).

    NOTE: casual/party fill bots are `disguised` so `to_state()` reports
    is_bot=False. We therefore classify any player whose username is not
    one of our real test accounts as a bot.
    """
    snapshots = []
    roster = {}
    deadline = time.time() + seconds
    async with websockets.connect(url, open_timeout=25, close_timeout=5) as ws:
        await ws.send(json.dumps({"type": "loaded"}))
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(1.0, deadline - time.time()))
            except asyncio.TimeoutError:
                break
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            mtype = msg.get("type")
            if mtype == "state":
                roster = {p["id"]: (p.get("username") not in HUMAN_USERNAMES) for p in msg.get("players", [])}
            elif mtype == "state_delta":
                for p in msg.get("players", []):
                    if "username" in p:
                        roster[p["id"]] = p.get("username") not in HUMAN_USERNAMES
                    else:
                        roster.setdefault(p["id"], False)
                for rid in msg.get("removed_ids", []) or []:
                    roster.pop(rid, None)
            else:
                continue
            snapshots.append((len(roster), sum(1 for v in roster.values() if v)))
    return snapshots


@pytest.mark.asyncio
async def test_ws_party_bots_off_never_backfills(leader, follower):
    ls, ltoken = leader
    fs, _ = follower
    party_id = _ensure_party(ls, fs)
    r = ls.post(f"{BASE_URL}/api/party/start", json={"bots_enabled": False, "tdm": False}, timeout=20)
    assert r.status_code == 200 and r.json()["bots_enabled"] is False

    url = f"{WS_BASE}?mode=party&party_id={party_id}&token={ltoken}"
    snaps = await _observe(url, seconds=25.0)
    assert snaps, "no state broadcasts received on party WS"
    max_bots = max(b for _, b in snaps)
    assert max_bots == 0, f"BOTS OFF party room contained bots: snapshots={snaps[:10]} ... max_bots={max_bots}"
    assert max(t for t, _ in snaps) == 1, f"expected only the single human in room, snapshots={snaps[:10]}"


@pytest.mark.asyncio
async def test_ws_party_bots_on_fills(leader, follower):
    ls, ltoken = leader
    fs, _ = follower
    party_id = _ensure_party(ls, fs)
    r = ls.post(f"{BASE_URL}/api/party/start", json={"bots_enabled": True, "tdm": False}, timeout=20)
    assert r.status_code == 200 and r.json()["bots_enabled"] is True

    url = f"{WS_BASE}?mode=party&party_id={party_id}&token={ltoken}"
    snaps = await _observe(url, seconds=20.0)
    assert snaps, "no state broadcasts received on party WS"
    max_bots = max(b for _, b in snaps)
    assert max_bots >= 1, f"BOTS ON party room had no bots (regression): snapshots={snaps[:10]}"


@pytest.mark.asyncio
async def test_ws_casual_still_autofills(leader):
    _, ltoken = leader
    url = f"{WS_BASE}?mode=casual&token={ltoken}"
    snaps = await _observe(url, seconds=12.0)
    assert snaps, "no state broadcasts received on casual WS"
    max_total = max(t for t, _ in snaps)
    max_bots = max(b for _, b in snaps)
    assert max_bots >= 1, f"casual quick-match auto-fill regressed: snapshots={snaps[:10]}"
    assert max_total >= 4, f"casual lobby did not reach FFA_LOBBY_SIZE: snapshots={snaps[:10]}"
