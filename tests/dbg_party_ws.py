import asyncio, json, os, time
import requests, websockets
from dotenv import dotenv_values

BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
WS = BASE.replace("https://", "wss://") + "/api/ws/game"
L = {"email": "partyleader@test.com", "password": "pw123456", "username": "partyleader"}
F = {"email": "partyfollower@test.com", "password": "pw123456", "username": "partyfollower"}


def login(c):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": c["email"], "password": c["password"]}, timeout=20)
    t = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {t}"})
    return s, t


async def main():
    ls, lt = login(L)
    fs, ft = login(F)
    ls.post(f"{BASE}/api/party/leave", timeout=20)
    fs.post(f"{BASE}/api/party/leave", timeout=20)
    ls.post(f"{BASE}/api/friends/request", json={"username": F["username"]}, timeout=20)
    fs.post(f"{BASE}/api/friends/accept", json={"username": L["username"]}, timeout=20)
    r = ls.post(f"{BASE}/api/party/invite", json={"username": F["username"]}, timeout=20)
    print("invite", r.status_code, r.text[:200])
    pid = r.json()["party_id"]
    print("accept", fs.post(f"{BASE}/api/party/accept", json={"username": L["username"]}, timeout=20).status_code)
    r = ls.post(f"{BASE}/api/party/start", json={"bots_enabled": False, "tdm": False}, timeout=20)
    print("start", r.status_code, r.text[:200])
    url = f"{WS}?mode=party&party_id={pid}&token={lt}"
    try:
        async with websockets.connect(url, open_timeout=25) as ws:
            print("connected")
            end = time.time() + 12
            counts = {}
            while time.time() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=3)
                except asyncio.TimeoutError:
                    print("recv timeout")
                    continue
                m = json.loads(raw)
                t = m.get("type")
                counts[t] = counts.get(t, 0) + 1
                if t in ("state", "init") and counts[t] <= 2:
                    print(t, "players:", [(p.get("username"), p.get("is_bot")) for p in m.get("players", [])])
                elif t not in ("state", "state_delta"):
                    print("MSG", json.dumps(m)[:300])
            print("type counts", counts)
    except Exception as e:
        print("WS ERROR", type(e).__name__, e)

asyncio.run(main())
