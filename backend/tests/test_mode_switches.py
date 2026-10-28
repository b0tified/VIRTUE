# Mode Switches (iteration_35): admin per-mode on/off switches, queue gates, WS gate, legacy bigffa switch
import os
import json
import time
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/game"
MODES = ["casual_ffa", "casual_tdm", "ranked", "bigffa", "party", "practice"]


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    s.token = s.cookies.get("access_token")
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@shooter.com", "admin123")


@pytest.fixture(scope="module")
def p1():
    return _login("player1@shooter.com", "player123")


@pytest.fixture(scope="module")
def leader():
    return _login("partyleader@test.com", "pw123456")


@pytest.fixture(autouse=True)
def all_on(admin, p1):
    admin.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": False})
    for q in ("casual", "ranked", "bigffa"):
        p1.delete(f"{BASE_URL}/api/queue/{q}")
        admin.delete(f"{BASE_URL}/api/queue/{q}")
    yield
    for q in ("casual", "ranked", "bigffa"):
        p1.delete(f"{BASE_URL}/api/queue/{q}")
        admin.delete(f"{BASE_URL}/api/queue/{q}")
    admin.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": False})


def _set(admin, mode, enabled):
    r = admin.post(f"{BASE_URL}/api/admin/mode_switches", json={"mode": mode, "enabled": enabled})
    assert r.status_code == 200, r.text
    return r.json()


async def _ws_probe(token, mode, extra=""):
    url = f"{WS_URL}?token={token}&mode={mode}{extra}"
    msgs = []
    code = None
    try:
        async with websockets.connect(url, open_timeout=10) as ws:
            try:
                for _ in range(3):
                    m = await asyncio.wait_for(ws.recv(), timeout=4)
                    msgs.append(json.loads(m) if isinstance(m, str) else m)
                    if isinstance(msgs[-1], dict) and msgs[-1].get("type") == "mode_unavailable":
                        break
            except websockets.ConnectionClosed as e:
                code = e.code if hasattr(e, "code") else (e.rcvd.code if e.rcvd else None)
            except asyncio.TimeoutError:
                pass
            if code is None:
                try:
                    await asyncio.wait_for(ws.recv(), timeout=3)
                except websockets.ConnectionClosed as e:
                    code = e.rcvd.code if e.rcvd else None
                except asyncio.TimeoutError:
                    pass
    except Exception as e:
        msgs.append({"error": str(e)})
    return msgs, code


# --- Admin endpoints ---
class TestAdminEndpoints:
    def test_get_admin_mode_switches(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/mode_switches")
        assert r.status_code == 200
        d = r.json()
        assert set(MODES) <= set(d["modes"].keys())
        for k in MODES:
            assert {"enabled", "changed_at", "changed_by", "label"} <= set(d["modes"][k].keys())
            assert d["modes"][k]["enabled"] is True
        assert "maintenance" in d and d["maintenance"]["active"] is False

    def test_non_admin_403(self, p1):
        assert p1.get(f"{BASE_URL}/api/admin/mode_switches").status_code == 403
        assert p1.post(f"{BASE_URL}/api/admin/mode_switches", json={"mode": "ranked", "enabled": False}).status_code == 403
        assert p1.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": True}).status_code == 403

    def test_unknown_mode_400(self, admin):
        r = admin.post(f"{BASE_URL}/api/admin/mode_switches", json={"mode": "nope", "enabled": False})
        assert r.status_code == 400

    def test_toggle_single_and_status(self, admin, p1):
        d = _set(admin, "ranked", False)
        assert d["modes"]["ranked"]["enabled"] is False
        assert d["modes"]["ranked"]["changed_by"] == "admin" or d["modes"]["ranked"]["changed_by"]
        s = p1.get(f"{BASE_URL}/api/modes/status").json()
        assert s["modes"]["ranked"] is False and s["modes"]["casual_ffa"] is True
        assert "maintenance" in s and "bigffa_enabled" in s

    def test_all_off_with_message_then_on(self, admin, p1):
        r = admin.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": True, "message": "TEST_ back soon"})
        assert r.status_code == 200
        d = r.json()
        assert all(d["modes"][k]["enabled"] is False for k in MODES)
        assert d["maintenance"] == {"active": True, "message": "TEST_ back soon"}
        s = p1.get(f"{BASE_URL}/api/modes/status").json()
        assert all(v is False for v in s["modes"].values())
        assert s["maintenance"]["message"] == "TEST_ back soon" and s["bigffa_enabled"] is False
        r = admin.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": False})
        d = r.json()
        assert all(d["modes"][k]["enabled"] is True for k in MODES)
        assert d["maintenance"]["active"] is False

    def test_modes_status_unauth(self):
        assert requests.get(f"{BASE_URL}/api/modes/status").status_code in (401, 403)

    def test_legacy_bigffa_switch(self, admin):
        r = admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": False})
        assert r.status_code == 200 and r.json()["enabled"] is False
        assert admin.get(f"{BASE_URL}/api/admin/mode_switches").json()["modes"]["bigffa"]["enabled"] is False
        r = admin.post(f"{BASE_URL}/api/admin/bigffa_switch", json={"enabled": True})
        assert admin.get(f"{BASE_URL}/api/admin/mode_switches").json()["modes"]["bigffa"]["enabled"] is True


# --- Queue gates ---
class TestQueueGates:
    def test_casual_both_off_403(self, admin, p1):
        _set(admin, "casual_ffa", False)
        _set(admin, "casual_tdm", False)
        r = p1.post(f"{BASE_URL}/api/queue/casual", json={})
        assert r.status_code == 403
        assert p1.get(f"{BASE_URL}/api/queue/casual").json().get("disabled") is True

    def test_only_tdm_off_coerces_ffa(self, admin, p1):
        _set(admin, "casual_tdm", False)
        r = p1.post(f"{BASE_URL}/api/queue/casual", json={"mode_pref": "tdm"})
        assert r.status_code == 200, r.text
        matched = None
        for _ in range(20):
            time.sleep(1)
            g = p1.get(f"{BASE_URL}/api/queue/casual").json()
            if g.get("matched"):
                matched = g
                break
        assert matched, "never matched within 20s"
        print("matched:", matched)
        assert matched["tdm"] is False

    def test_ranked_off(self, admin, p1):
        _set(admin, "ranked", False)
        assert p1.post(f"{BASE_URL}/api/queue/ranked", json={}).status_code == 403
        assert p1.get(f"{BASE_URL}/api/queue/ranked").json().get("disabled") is True

    def test_bigffa_off(self, admin, p1):
        _set(admin, "bigffa", False)
        assert p1.post(f"{BASE_URL}/api/queue/bigffa", json={}).status_code == 403
        assert p1.get(f"{BASE_URL}/api/queue/bigffa").json().get("disabled") is True

    def test_queued_removed_when_off(self, admin, p1):
        # ranked
        r = p1.post(f"{BASE_URL}/api/queue/ranked", json={})
        assert r.status_code == 200, r.text
        _set(admin, "ranked", False)
        g = p1.get(f"{BASE_URL}/api/queue/ranked").json()
        assert g.get("in_queue") is not True and g.get("disabled") is True, g
        # bigffa
        r = p1.post(f"{BASE_URL}/api/queue/bigffa", json={})
        assert r.status_code == 200, r.text
        _set(admin, "bigffa", False)
        g = p1.get(f"{BASE_URL}/api/queue/bigffa").json()
        assert g.get("in_queue") is not True and g.get("disabled") is True, g
        # casual
        r = p1.post(f"{BASE_URL}/api/queue/casual", json={})
        assert r.status_code == 200, r.text
        _set(admin, "casual_ffa", False)
        _set(admin, "casual_tdm", False)
        g = p1.get(f"{BASE_URL}/api/queue/casual").json()
        assert g.get("in_queue") is not True and g.get("matched") is not True and g.get("disabled") is True, g

    def test_party_off_403(self, admin, leader):
        _set(admin, "party", False)
        r = leader.post(f"{BASE_URL}/api/party/start", json={})
        print("party start:", r.status_code, r.text[:200])
        assert r.status_code == 403

    def test_admin_bypass(self, admin):
        admin.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": True, "message": ""})
        for q in ("ranked", "bigffa", "casual"):
            r = admin.post(f"{BASE_URL}/api/queue/{q}", json={})
            assert r.status_code == 200, f"{q}: {r.status_code} {r.text}"
            admin.delete(f"{BASE_URL}/api/queue/{q}")
        assert admin.get(f"{BASE_URL}/api/queue/ranked").json().get("disabled") is False


# --- WS gate ---
class TestWsGate:
    @pytest.mark.parametrize("mode,key,extra", [
        ("casual", "casual_ffa", "&mode_pref=ffa"),
        ("ranked", "ranked", ""),
        ("bigffa", "bigffa", ""),
        ("practice", "practice", ""),
        ("offline", "practice", ""),
    ])
    def test_ws_blocked_for_player(self, admin, p1, mode, key, extra):
        admin.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": True, "message": ""})
        msgs, code = asyncio.run(_ws_probe(p1.token, mode, extra))
        print(mode, msgs[:2], code)
        assert any(isinstance(m, dict) and m.get("type") == "mode_unavailable" for m in msgs), msgs
        assert code == 4403

    def test_ws_party_blocked(self, admin, leader):
        admin.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": True, "message": ""})
        msgs, code = asyncio.run(_ws_probe(leader.token, "party", "&party_id=TEST_none"))
        print("party", msgs[:2], code)
        assert any(isinstance(m, dict) and m.get("type") == "mode_unavailable" for m in msgs) or code is not None

    def test_ws_admin_allowed(self, admin):
        admin.post(f"{BASE_URL}/api/admin/mode_switches/all", json={"active": True, "message": ""})
        msgs, code = asyncio.run(_ws_probe(admin.token, "practice"))
        print("admin practice", [m.get("type") if isinstance(m, dict) else m for m in msgs[:3]], code)
        assert not any(isinstance(m, dict) and m.get("type") == "mode_unavailable" for m in msgs)
        assert code != 4403
