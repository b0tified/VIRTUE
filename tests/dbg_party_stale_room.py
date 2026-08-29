"""Diagnostics:
A) BOTS OFF with BOTH humans connected -> room must hold exactly 2 humans, 0 bots.
B) Stale-room case: room created with BOTS ON stays alive (follower connected);
   leader then re-starts with BOTS OFF and joins -> does the cached room honour
   the new flag?
"""
import asyncio, json, time
import requests, websockets
from dotenv import dotenv_values

BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
WS = BASE.replace("https://", "wss://") + "/api/ws/game"
L = {"email": "partyleader@test.com", "password": "pw123456", "username": "partyleader"}
F = {"email": "partyfollower@test.com", "password": "pw123456", "username": "partyfollower"}
HUMANS = {L["username"], F["username"]}


def login(c):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": c["email"], "password": c["password"]}, timeout=20)
    t = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {t}"})
    return s, t


def setup_party(ls, fs):
    ls.post(f"{BASE}/api/party/leave", timeout=20)
    fs.post(f"{BASE}/api/party/leave", timeout=20)
    r = ls.post(f"{BASE}/api/party/invite", json={"username": F["username"]}, timeout=20)
    pid = r.json()["party_id"]
    fs.post(f"{BASE}/api/party/accept", json={"username": L["username"]}, timeout=20)
    return pid


async def watch(ws, seconds):
    roster = {}
    snaps = []
    end = time.time() + seconds
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.5, end - time.time()))
        except asyncio.TimeoutError:
            break
        m = json.loads(raw)
        t = m.get("type")
        if t == "state":
            roster = {p["id"]: (p.get("username") not in HUMANS, p.get("username")) for p in m.get("players", [])}
        elif t == "state_delta":
            for p in m.get("players", []):
                if "username" in p:
                    roster[p["id"]] = (p["username"] not in HUMANS, p["username"])
                else:
                    roster.setdefault(p["id"], (False, "?"))
            for rid in m.get("removed_ids", []) or []:
                roster.pop(rid, None)
        else:
            continue
        snaps.append((len(roster), sum(1 for v, _ in roster.values() if v)))
    return snaps, sorted(n for _, n in roster.values())


async def main():
    ls, lt = login(L)
    fs, ft = login(F)

    # ---- A: both humans, BOTS OFF ----
    pid = setup_party(ls, fs)
    print("A start:", ls.post(f"{BASE}/api/party/start", json={"bots_enabled": False, "tdm": False}, timeout=20).text)
    async with websockets.connect(f"{WS}?mode=party&party_id={pid}&token={lt}", open_timeout=25) as w1:
        await w1.send(json.dumps({"type": "loaded"}))
        async with websockets.connect(f"{WS}?mode=party&party_id={pid}&token={ft}", open_timeout=25) as w2:
            await w2.send(json.dumps({"type": "loaded"}))
            snaps, names = await watch(w1, 18)
            print("A snapshots(sample):", snaps[:5], "...", snaps[-3:] if snaps else None)
            print("A final roster:", names)
    await asyncio.sleep(3)

    # ---- B: stale cached room with BOTS ON then re-start with BOTS OFF ----
    pid = setup_party(ls, fs)
    print("B start1:", ls.post(f"{BASE}/api/party/start", json={"bots_enabled": True, "tdm": False}, timeout=20).text)
    async with websockets.connect(f"{WS}?mode=party&party_id={pid}&token={ft}", open_timeout=25) as wf:
        await wf.send(json.dumps({"type": "loaded"}))
        await asyncio.sleep(8)  # room now alive with bots, follower holds it open
        print("B start2 (BOTS OFF):", ls.post(f"{BASE}/api/party/start", json={"bots_enabled": False, "tdm": False}, timeout=20).text)
        async with websockets.connect(f"{WS}?mode=party&party_id={pid}&token={lt}", open_timeout=25) as wl:
            await wl.send(json.dumps({"type": "loaded"}))
            snaps, names = await watch(wl, 15)
            print("B snapshots(sample):", snaps[:5], "...", snaps[-3:] if snaps else None)
            print("B final roster:", names)

asyncio.run(main())
