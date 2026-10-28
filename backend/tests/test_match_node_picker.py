# Match server node picker: /api/cluster/nodes, /api/ws/nodeping, /api/ws/game node gate
import os
import json
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")


@pytest.fixture(scope="module")
def token():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "player1@shooter.com", "password": "player123"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    t = s.cookies.get("access_token") or r.json().get("access_token") or r.json().get("token")
    assert t
    return t


@pytest.fixture(scope="module")
def node_code(token):
    r = requests.get(f"{BASE_URL}/api/cluster/nodes", headers={"Authorization": f"Bearer {token}"}, cookies={"access_token": token})
    assert r.status_code == 200
    return r.json()["nodes"][0]["code"]


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


# --- cluster nodes endpoint
def test_cluster_nodes_shape(token):
    r = requests.get(f"{BASE_URL}/api/cluster/nodes", cookies={"access_token": token})
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d["nodes"], list) and len(d["nodes"]) >= 1
    for n in d["nodes"]:
        assert isinstance(n["code"], str) and len(n["code"]) == 6
        assert isinstance(n["hosts_matches"], bool)
    assert d["leader"] in [n["code"] for n in d["nodes"]]
    assert sum(n["hosts_matches"] for n in d["nodes"]) == 1


def test_cluster_nodes_requires_auth():
    r = requests.get(f"{BASE_URL}/api/cluster/nodes")
    assert r.status_code in (401, 403)


# --- nodeping
def test_nodeping_correct_node(node_code):
    async def go():
        async with websockets.connect(f"{WS_BASE}/api/ws/nodeping?node={node_code}&node_try=0", open_timeout=10) as ws:
            info = json.loads(await asyncio.wait_for(ws.recv(), 5))
            assert info["type"] == "node_info" and info["landed"] is True and info["node"] == node_code
            assert "relayed" in info
            for i in range(3):
                await ws.send(f"p{i}")
                assert await asyncio.wait_for(ws.recv(), 5) == f"p{i}"
    run(go())


def test_nodeping_wrong_node_rejected():
    async def go():
        with pytest.raises(Exception) as e:
            async with websockets.connect(f"{WS_BASE}/api/ws/nodeping?node=ZZZZZZ&node_try=0", open_timeout=10):
                pass
        print("reject:", repr(e.value))
        assert "403" in str(e.value) or "rejected" in str(e.value).lower()
    run(go())


def test_nodeping_wrong_node_try6_accepted_landed_false():
    async def go():
        async with websockets.connect(f"{WS_BASE}/api/ws/nodeping?node=ZZZZZZ&node_try=6", open_timeout=10) as ws:
            info = json.loads(await asyncio.wait_for(ws.recv(), 5))
            assert info["type"] == "node_info" and info["landed"] is False
            await ws.send("x")
            assert await asyncio.wait_for(ws.recv(), 5) == "x"
    run(go())


def test_nodeping_closes_after_12():
    async def go():
        async with websockets.connect(f"{WS_BASE}/api/ws/nodeping?node=auto&node_try=0", open_timeout=10) as ws:
            info = json.loads(await asyncio.wait_for(ws.recv(), 5))
            assert info["landed"] is True
            for i in range(12):
                await ws.send("a")
                await asyncio.wait_for(ws.recv(), 5)
            with pytest.raises(websockets.ConnectionClosed):
                await asyncio.wait_for(ws.recv(), 5)
    run(go())


# --- game ws
async def _game_frames(url, n=4):
    frames = []
    async with websockets.connect(url, open_timeout=10, max_size=None) as ws:
        while len(frames) < n:
            m = await asyncio.wait_for(ws.recv(), 10)
            if isinstance(m, bytes):
                continue
            try:
                frames.append(json.loads(m))
            except Exception:
                continue
    return frames


def test_game_ws_pinned_node(token, node_code):
    fr = run(_game_frames(f"{WS_BASE}/api/ws/game?token={token}&mode=practice&node={node_code}&node_try=0"))
    print([f.get("type") for f in fr])
    assert fr[0]["type"] == "node_info" and fr[0]["landed"] is True
    assert fr[1]["type"] != "node_info"
    assert any(f.get("type") == "welcome" for f in fr)


def test_game_ws_auto(token):
    fr = run(_game_frames(f"{WS_BASE}/api/ws/game?token={token}&mode=practice&node=auto&node_try=0"))
    print([f.get("type") for f in fr])
    assert fr[0]["type"] == "node_info" and fr[0]["landed"] is True
    assert any(f.get("type") == "welcome" for f in fr)


def test_game_ws_no_node(token):
    fr = run(_game_frames(f"{WS_BASE}/api/ws/game?token={token}&mode=practice"))
    print([f.get("type") for f in fr])
    assert all(f.get("type") != "node_info" for f in fr)
    assert any(f.get("type") == "welcome" for f in fr)


def test_game_ws_wrong_node_rejected(token):
    async def go():
        with pytest.raises(Exception) as e:
            async with websockets.connect(f"{WS_BASE}/api/ws/game?token={token}&mode=practice&node=ZZZZZZ&node_try=3", open_timeout=10):
                pass
        assert "403" in str(e.value)
    run(go())


def test_game_ws_wrong_node_try6(token):
    fr = run(_game_frames(f"{WS_BASE}/api/ws/game?token={token}&mode=practice&node=ZZZZZZ&node_try=6"))
    assert fr[0]["type"] == "node_info" and fr[0]["landed"] is False
    assert any(f.get("type") == "welcome" for f in fr)


def test_game_ws_bad_node_try_value(token):
    # non-numeric node_try should not crash the server (expect rejection or accept, not hang)
    async def go():
        try:
            async with websockets.connect(f"{WS_BASE}/api/ws/game?token={token}&mode=practice&node=ZZZZZZ&node_try=abc", open_timeout=10):
                return "open"
        except Exception as e:
            return repr(e)
    res = run(go())
    print("bad node_try:", res)
