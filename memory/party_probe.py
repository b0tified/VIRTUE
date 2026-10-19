import asyncio, json, sys, time, requests, websockets
B = sys.argv[1]
WS = B.replace("http", "ws", 1)
def login(e):
    r = requests.post(f"{B}/api/auth/login", json={"email": e, "password": "pw123456"}).json()
    return r.get("token") or r.get("access_token")
L, F = login("partyleader@test.com"), login("partyfollower@test.com")
H = lambda t: {"Authorization": f"Bearer {t}"}
requests.post(f"{B}/api/party/leave", headers=H(L)); requests.post(f"{B}/api/party/leave", headers=H(F))
print("invite", requests.post(f"{B}/api/party/invite", json={"username": "partyfollower"}, headers=H(L)).status_code)
print("accept", requests.post(f"{B}/api/party/accept", json={"username": "partyleader"}, headers=H(F)).status_code)
print("party", requests.get(f"{B}/api/party/me", headers=H(L)).json().get("members"))
print("queue", requests.post(f"{B}/api/queue/casual", json={}, headers=H(L)).json())
for i in range(40):
    a = requests.get(f"{B}/api/queue/casual", headers=H(L)).json(); b = requests.get(f"{B}/api/queue/casual", headers=H(F)).json()
    if a.get("matched") and b.get("matched"): break
    time.sleep(1)
print("leader", {k: a.get(k) for k in ("matched","tdm","match_id")}, "follower", {k: b.get(k) for k in ("matched","tdm","match_id")})
async def join(tok, name):
    ws = await websockets.connect(f"{WS}/api/ws/game?token={tok}&mode=casual", max_size=None)
    ids = None
    t0 = time.time()
    while time.time() - t0 < 6:
        m = json.loads(await asyncio.wait_for(ws.recv(), 6))
        if m.get("type") == "welcome":
            return ws, m
    return ws, None
async def main():
    (wl, ml), (wf, mf) = await asyncio.gather(join(L, "L"), join(F, "F"))
    print("welcome keys:", sorted((ml or {}).keys())[:30])
    def ppl(m): return [(p.get("username"), p.get("team"), p.get("is_bot")) for p in (m or {}).get("players", []) if "party" in (p.get("username") or "")]
    print("L sees:", ppl(ml), "| F sees:", ppl(mf), "| ids", (ml or {}).get("you"), (mf or {}).get("you"))
    await wl.close(); await wf.close()
asyncio.run(main())
requests.post(f"{B}/api/party/leave", headers=H(F))
