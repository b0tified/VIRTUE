# Big FFA ON/OFF switch + per-mode server load + ping comparison (iteration 10)
import os
import json
import time
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
MODES = ["Casual FFA", "TDM", "Ranked", "Big FFA", "Party", "Practice"]


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token") or s.cookies.get("access_token")
    s.token = tok
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@shooter.com", "admin123")


@pytest.fixture(scope="module")
def player():
    return _login("player1@shooter.com", "player123")


@pytest.fixture(scope="module", autouse=True)
def ensure_switch_on(admin):
    admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": True})
    yield
    r = admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": True})
    assert r.json()["enabled"] is True


# Server health payload
class TestServerHealth:
    def test_shape(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/server_health")
        assert r.status_code == 200
        d = r.json()
        assert [m["mode"] for m in d["modes"]] == MODES
        for m in d["modes"]:
            for k in ("matches", "real", "bots", "tick_ms", "tick_ms_max", "kb_per_s"):
                assert k in m and isinstance(m[k], (int, float))
        for k in ("bigffa_on", "bigffa_off"):
            assert k in d["ping_compare"]
            assert set(("avg_ms", "players", "minutes")) <= set(d["ping_compare"][k])
        assert set(("enabled", "changed_at", "changed_by")) <= set(d["bigffa"])

    def test_non_admin_403(self, player):
        assert player.get(f"{BASE_URL}/api/admin/server_health").status_code == 403

    def test_non_admin_switch_403(self, player):
        assert player.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": False}).status_code == 403

    def test_switch_validation(self, admin):
        assert admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={}).status_code == 422


# Switch OFF flow
class TestSwitchFlow:
    def test_off_then_on(self, admin, player):
        # queue first while ON
        player.delete(f"{BASE_URL}/api/queue/bigffa")
        r = player.post(f"{BASE_URL}/api/queue/bigffa", json={})
        assert r.status_code == 200, r.text
        assert player.get(f"{BASE_URL}/api/queue/bigffa").json()["in_queue"] is True
        # OFF
        r = admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": False})
        assert r.status_code == 200
        d = r.json()
        assert d["enabled"] is False and d["changed_by"] == "hi" and d["changed_at"]
        assert player.get(f"{BASE_URL}/api/modes/status").json() == {"bigffa_enabled": False}
        q = player.get(f"{BASE_URL}/api/queue/bigffa").json()
        assert q["in_queue"] is False and q["disabled"] is True
        r = player.post(f"{BASE_URL}/api/queue/bigffa", json={})
        assert r.status_code == 403
        assert r.json()["detail"] == "Big FFA is temporarily unavailable."
        h = admin.get(f"{BASE_URL}/api/admin/server_health").json()
        assert h["bigffa"]["enabled"] is False and h["bigffa"]["changed_by"] == "hi"
        # persistence survives the 30s resync
        time.sleep(1)
        assert player.get(f"{BASE_URL}/api/modes/status").json()["bigffa_enabled"] is False
        # ON again
        r = admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": True})
        assert r.json()["enabled"] is True
        assert player.get(f"{BASE_URL}/api/modes/status").json()["bigffa_enabled"] is True
        r = player.post(f"{BASE_URL}/api/queue/bigffa", json={})
        assert r.status_code == 200
        player.delete(f"{BASE_URL}/api/queue/bigffa")

    def test_modes_status_requires_auth(self):
        assert requests.get(f"{BASE_URL}/api/modes/status").status_code in (401, 403)


async def _ws_try(token, mode):
    url = f"{WS_URL}/api/ws/game?token={token}&mode={mode}"
    msgs, code, err = [], None, None
    try:
        async with websockets.connect(url, open_timeout=10) as ws:
            try:
                while True:
                    m = await asyncio.wait_for(ws.recv(), timeout=6)
                    if isinstance(m, str):
                        msgs.append(json.loads(m))
                    if len(msgs) > 5:
                        break
            except websockets.ConnectionClosed as e:
                code = e.rcvd.code if e.rcvd else None
            except asyncio.TimeoutError:
                pass
    except Exception as e:  # handshake rejected
        err = repr(e)
    return msgs, code, err


# WS gate
class TestWsGate:
    def test_ws_bigffa_rejected_when_off(self, admin, player):
        admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": False})
        try:
            msgs, code, err = asyncio.run(_ws_try(player.token, "bigffa"))
            print("WS OFF result:", msgs[:2], code, err)
            assert err is None, f"handshake failed: {err}"
            assert any(m.get("type") == "mode_unavailable" for m in msgs)
            assert code == 4403
        finally:
            admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": True})

    def test_ws_bigffa_load_when_on(self, admin, player):
        async def run():
            url = f"{WS_URL}/api/ws/game?token={player.token}&mode=bigffa"
            async with websockets.connect(url, open_timeout=10) as ws:
                end = time.time() + 7
                while time.time() < end:
                    try:
                        await asyncio.wait_for(ws.recv(), timeout=1)
                    except asyncio.TimeoutError:
                        pass
                return admin.get(f"{BASE_URL}/api/admin/server_health").json()
        h = asyncio.run(run())
        row = next(m for m in h["modes"] if m["mode"] == "Big FFA")
        print("Big FFA row:", row)
        assert row["matches"] >= 1 and row["real"] >= 1
        assert row["tick_ms"] > 0 and row["kb_per_s"] > 0
