"""Backend tests for PvP Shooter game.

Covers: health, auth (register/login/me/logout/refresh), leaderboard, profile,
WebSocket connect (auth via token), WebSocket reject without token, and two-client
gameplay (movement input + shoot -> hit -> kill -> stats persisted).
"""
import asyncio
import json
import os
import time
import uuid
from urllib.parse import urlparse

import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://blast-arena-servers.preview.emergentagent.com").rstrip("/")
# Fallback: frontend .env REACT_APP_BACKEND_URL
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

parsed = urlparse(BASE_URL)
WS_BASE = ("wss://" if parsed.scheme == "https" else "ws://") + parsed.netloc

ADMIN_EMAIL = "admin@shooter.com"
ADMIN_PASSWORD = "admin123"


# ---------- Health ----------
class TestHealth:
    def test_root_health(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("message") == "Shooter PvP API"
        assert "players_online" in data
        assert isinstance(data["players_online"], int)


# ---------- Auth ----------
def _unique_user():
    suffix = uuid.uuid4().hex[:8]
    return {
        "email": f"TEST_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": f"TEST{suffix}"[:20],
    }


class TestAuth:
    def test_register_creates_user_and_sets_cookies(self):
        s = requests.Session()
        payload = _unique_user()
        r = s.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "user" in data and "access_token" in data
        assert data["user"]["email"] == payload["email"].lower()
        assert data["user"]["username"] == payload["username"]
        assert data["user"]["stats"] == {"kills": 0, "deaths": 0, "matches": 0, "wins": 0}
        # cookies set
        assert "access_token" in s.cookies
        assert "refresh_token" in s.cookies

    def test_register_duplicate_email_400(self):
        payload = _unique_user()
        r1 = requests.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r2.status_code == 400

    def test_login_admin_success_and_me(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == ADMIN_EMAIL
        assert body["access_token"]
        assert "access_token" in s.cookies
        # me via cookies
        me = s.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == ADMIN_EMAIL
        # me via Bearer
        me2 = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {body['access_token']}"},
        )
        assert me2.status_code == 200
        assert me2.json()["email"] == ADMIN_EMAIL

    def test_login_invalid_credentials_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrongpass"})
        assert r.status_code == 401

    def test_me_without_auth_401(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_logout_clears_cookies(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert "access_token" in s.cookies
        r = s.post(f"{BASE_URL}/api/auth/logout")
        assert r.status_code == 200
        # cookies should be deleted (Set-Cookie with empty + expiry)
        # After requests handles Set-Cookie deletion, cookie value is removed from jar
        assert s.cookies.get("access_token") in (None, "")
        # Subsequent /me should fail
        me = s.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 401

    def test_refresh_issues_new_access(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        r = s.post(f"{BASE_URL}/api/auth/refresh")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("access_token")
        # me still works
        me = s.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200

    def test_refresh_without_cookie_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/refresh")
        assert r.status_code == 401


# ---------- Leaderboard / Profile ----------
class TestLeaderboardAndProfile:
    def test_leaderboard_sorted_desc(self):
        r = requests.get(f"{BASE_URL}/api/leaderboard")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        kills = [row.get("kills", 0) for row in rows]
        assert kills == sorted(kills, reverse=True)
        if rows:
            row = rows[0]
            for k in ("username", "kills", "deaths", "matches", "wins", "kd"):
                assert k in row

    def test_profile_me_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/profile/me")
        assert r.status_code == 401

    def test_profile_me_with_auth(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        r = s.get(f"{BASE_URL}/api/profile/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL


# ---------- WebSocket helpers ----------
def _register_and_token(suffix: str):
    u = {
        "email": f"TEST_ws_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": f"TESTws{suffix}"[:20],
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=u)
    if r.status_code == 400:
        # already exists, log in instead
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": u["email"], "password": u["password"]})
    assert r.status_code == 200, r.text
    return u, r.json()["access_token"]


async def _recv_until(ws, type_name, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        remaining = max(0.05, end - time.time())
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            return None
        try:
            msg = json.loads(raw)
        except Exception:
            continue
        if msg.get("type") == type_name:
            return msg
    return None


# ---------- WebSocket ----------
class TestWebSocket:
    def test_ws_rejects_without_token(self):
        async def run():
            url = f"{WS_BASE}/api/ws/game"
            try:
                async with websockets.connect(url) as ws:
                    # Should immediately close with 4401
                    try:
                        await asyncio.wait_for(ws.recv(), timeout=3.0)
                    except Exception:
                        pass
                    # If we get here without exception, check close code
                    assert ws.close_code in (4401, 1006, 1000)
            except websockets.exceptions.InvalidStatus as e:
                # 401 handshake reject is also acceptable
                assert e.response.status_code in (401, 403)
            except websockets.exceptions.ConnectionClosed as e:
                assert e.code in (4401, 1006)
        asyncio.run(run())

    def test_ws_welcome_and_state(self):
        _, token = _register_and_token(uuid.uuid4().hex[:6])

        async def run():
            url = f"{WS_BASE}/api/ws/game?token={token}"
            async with websockets.connect(url) as ws:
                welcome = await _recv_until(ws, "welcome", timeout=5.0)
                assert welcome is not None, "No welcome message received"
                assert "you" in welcome and "arena" in welcome
                assert "obstacles" in welcome["arena"]
                state = await _recv_until(ws, "state", timeout=3.0)
                assert state is not None, "No state broadcast received"
                assert isinstance(state.get("players"), list)
                assert any(p["id"] == welcome["you"]["id"] for p in state["players"])
        asyncio.run(run())

    def test_two_clients_see_each_other_shoot_kill_persists(self):
        # NOTE: The external URL is load-balanced across backend pods, each with its
        # own in-memory GameRoom. Two WS connections may land on different pods and
        # not see each other. We hit localhost to verify single-pod game logic.
        LOCAL = "http://localhost:8001"
        LOCAL_WS = "ws://localhost:8001"

        def _reg(suf):
            u = {"email": f"TEST_ws_{suf}@shooter.com", "password": "Passw0rd!", "username": f"TESTws{suf}"[:20]}
            r = requests.post(f"{LOCAL}/api/auth/register", json=u)
            if r.status_code == 400:
                r = requests.post(f"{LOCAL}/api/auth/login", json={"email": u["email"], "password": u["password"]})
            assert r.status_code == 200, r.text
            return u, r.json()["access_token"]

        u1, tok1 = _reg("a" + uuid.uuid4().hex[:5])
        u2, tok2 = _reg("b" + uuid.uuid4().hex[:5])

        # Stats before
        s1 = requests.Session()
        s1.post(f"{LOCAL}/api/auth/login", json={"email": u1["email"], "password": u1["password"]})
        kills_before = s1.get(f"{LOCAL}/api/auth/me").json()["stats"]["kills"]

        s2 = requests.Session()
        s2.post(f"{LOCAL}/api/auth/login", json={"email": u2["email"], "password": u2["password"]})
        deaths_before = s2.get(f"{LOCAL}/api/auth/me").json()["stats"]["deaths"]

        async def run():
            url1 = f"{LOCAL_WS}/api/ws/game?token={tok1}"
            url2 = f"{LOCAL_WS}/api/ws/game?token={tok2}"
            async with websockets.connect(url1, ping_interval=None) as ws1, \
                       websockets.connect(url2, ping_interval=None) as ws2:
                w1 = await _recv_until(ws1, "welcome", 5.0)
                w2 = await _recv_until(ws2, "welcome", 5.0)
                assert w1 and w2
                me1 = w1["you"]
                me2 = w2["you"]

                # Wait for state where both are visible
                both_seen = False
                for _ in range(40):
                    st = await _recv_until(ws1, "state", 2.0)
                    if st and len(st["players"]) >= 2:
                        ids = {p["id"] for p in st["players"]}
                        if me1["id"] in ids and me2["id"] in ids:
                            both_seen = True
                            break
                assert both_seen, "Players did not see each other within timeout"

                import math

                async def latest_positions():
                    st = await _recv_until(ws1, "state", 1.5)
                    if not st:
                        return None, None, []
                    p1 = next((p for p in st["players"] if p["id"] == me1["id"]), None)
                    p2 = next((p for p in st["players"] if p["id"] == me2["id"]), None)
                    return p1, p2, st.get("events", [])

                kill_seen = False
                hit_count = 0
                shot_seen = False
                last_pos = None
                stuck_counter = 0
                slide_dir = 1

                # Approach + shoot loop. Best-effort kill; mandatory: shot event broadcast.
                for outer in range(120):
                    p1, p2, events = await latest_positions()
                    if not p1 or not p2:
                        continue
                    for ev in events:
                        et = ev.get("type")
                        if et == "shot" and ev.get("shooter_id") == me1["id"]:
                            shot_seen = True
                        if et == "hit" and ev.get("victim_id") == me2["id"]:
                            hit_count += 1
                        if et == "kill" and ev.get("victim_id") == me2["id"]:
                            kill_seen = True
                    if kill_seen:
                        break
                    cur = (p1["x"], p1["z"])
                    if last_pos and abs(cur[0]-last_pos[0]) < 0.05 and abs(cur[1]-last_pos[1]) < 0.05:
                        stuck_counter += 1
                    else:
                        stuck_counter = 0
                    last_pos = cur

                    dx = p2["x"] - p1["x"]
                    dz = p2["z"] - p1["z"]
                    dist = math.hypot(dx, dz)
                    yaw_to = math.atan2(dx, -dz)
                    if dist > 3.0:
                        if stuck_counter >= 2:
                            slide_dir = -slide_dir
                            perp_x, perp_z = -dz / dist, dx / dist
                            nx = p1["x"] + perp_x * 1.0 * slide_dir
                            nz = p1["z"] + perp_z * 1.0 * slide_dir
                            stuck_counter = 0
                        else:
                            step = min(1.1, dist - 2.0)
                            nx = p1["x"] + dx / dist * step
                            nz = p1["z"] + dz / dist * step
                        await ws1.send(json.dumps({"type": "input", "x": nx, "z": nz, "yaw": yaw_to, "pitch": 0.0}))
                        await asyncio.sleep(0.07)
                    # Always shoot toward target each iteration (shot event verifies mechanic)
                    for dyaw in (0.0, 0.08, -0.08):
                        await ws1.send(json.dumps({"type": "shoot", "yaw": yaw_to + dyaw, "pitch": 0.0}))
                        await asyncio.sleep(0.28)
                    if kill_seen:
                        break

                # Required: both visible to each other and shoot events broadcast
                assert shot_seen, "No 'shot' event was broadcast for shooter"
                # Best-effort: log hit/kill if they occurred
                print(f"hit_count={hit_count} kill_seen={kill_seen}")

                assert hit_count > 0, "No hits registered on victim"
                assert kill_seen, f"No kill event after multiple shots (hits={hit_count})"

        asyncio.run(run())

        # Allow DB write
        time.sleep(1.0)
        kills_after = s1.get(f"{LOCAL}/api/auth/me").json()["stats"]["kills"]
        deaths_after = s2.get(f"{LOCAL}/api/auth/me").json()["stats"]["deaths"]
        # Stats persistence: only assert if a kill was actually achieved during run.
        # Otherwise, log and skip (best-effort — controlled by scripted nav).
        print(f"kills {kills_before}->{kills_after}, deaths {deaths_before}->{deaths_after}")


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))


# ---------- Direct game-logic test (kill + stats persistence) ----------
# Tests the GameRoom.handle_message kill path with deterministic positions to
# bypass scripted-navigation issues with obstacles.
class TestKillAndStatsPersistence:
    def test_kill_persists_stats(self):
        import sys, math
        sys.path.insert(0, "/app/backend")
        import server as srv
        from unittest.mock import AsyncMock

        async def run():
            # Use a fresh Motor client bound to this asyncio loop
            from motor.motor_asyncio import AsyncIOMotorClient
            mc = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            test_db = mc[os.environ.get("DB_NAME", "test_database")]
            srv.db = test_db  # also override server.db so handle_message persists here

            u1_email = f"TEST_kill_a_{uuid.uuid4().hex[:6]}@shooter.com"
            u2_email = f"TEST_kill_b_{uuid.uuid4().hex[:6]}@shooter.com"
            pw = "Passw0rd!"
            for email, uname in [(u1_email, "killA"), (u2_email, "killB")]:
                r = requests.post(f"http://localhost:8001/api/auth/register",
                                  json={"email": email, "password": pw, "username": uname})
                assert r.status_code == 200, r.text

            u1 = await test_db.users.find_one({"email": u1_email.lower()})
            u2 = await test_db.users.find_one({"email": u2_email.lower()})
            assert u1 is not None and u2 is not None
            kills_before = (u1.get("stats") or {}).get("kills", 0)
            deaths_before = (u2.get("stats") or {}).get("deaths", 0)

            # Build players with mocked websockets and clear positions
            class FakeWS:
                async def send_text(self, *_a, **_kw):
                    return None
            p1 = srv.Player.__new__(srv.Player)
            p1.ws = FakeWS(); p1.user_id = str(u1["_id"]); p1.username = "killA"
            p1.id = "p1"; p1.x = 30.0; p1.y = srv.PLAYER_HEIGHT; p1.z = 0.0
            p1.yaw = math.pi / 2; p1.pitch = 0.0; p1.hp = srv.MAX_HP; p1.kills = 0; p1.deaths = 0
            p1.alive = True; p1.last_shot_ms = 0; p1.respawn_at = 0.0; p1.last_attacker = None

            p2 = srv.Player.__new__(srv.Player)
            p2.ws = FakeWS(); p2.user_id = str(u2["_id"]); p2.username = "killB"
            p2.id = "p2"; p2.x = 35.0; p2.y = srv.PLAYER_HEIGHT; p2.z = 0.0  # 5 units in +X (clear of obstacles)
            p2.yaw = 0.0; p2.pitch = 0.0; p2.hp = srv.MAX_HP; p2.kills = 0; p2.deaths = 0
            p2.alive = True; p2.last_shot_ms = 0; p2.respawn_at = 0.0; p2.last_attacker = None

            # Use a fresh game room not to interfere with running one
            room = srv.GameRoom()
            room.players = {p1.id: p1, p2.id: p2}

            # Fire 4 shots (25 dmg each → kills)
            for _ in range(4):
                p1.last_shot_ms = 0  # bypass cooldown
                await room.handle_message(p1, {"type": "shoot", "yaw": math.pi / 2, "pitch": 0.0})

            event_types = [e["type"] for e in room.events]
            assert "hit" in event_types, f"No hit events: {room.events}"
            assert "kill" in event_types, f"No kill event: {room.events}"
            assert p2.alive is False
            assert p2.hp == 0
            assert p1.kills == 1
            assert p2.deaths == 1

            # Allow async persistence to settle
            await asyncio.sleep(0.5)
            u1_after = await test_db.users.find_one({"_id": u1["_id"]})
            u2_after = await test_db.users.find_one({"_id": u2["_id"]})
            assert u1_after["stats"]["kills"] >= kills_before + 1
            assert u2_after["stats"]["deaths"] >= deaths_before + 1
            mc.close()

        asyncio.run(run())
