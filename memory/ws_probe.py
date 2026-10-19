import asyncio, json, sys, time, websockets
async def m(port, tok):
    async with websockets.connect(f"ws://localhost:{port}/api/ws/game?token={tok}&mode=casual", max_size=None) as ws:
        types=set(); t0=time.time(); rtt=None; sent=None
        while time.time()-t0<6:
            try:
                m=json.loads(await asyncio.wait_for(ws.recv(),2))
            except asyncio.TimeoutError:
                break
            types.add(m.get("type"))
            if sent is None:
                await ws.send(json.dumps({"type":"ping","ts":1})); sent=time.perf_counter()
            if m.get("type")=="pong" and rtt is None: rtt=(time.perf_counter()-sent)*1000
        print(port, "types:", sorted(t for t in types if t)[:10], "pong ms:", rtt and round(rtt,1))
asyncio.run(m(int(sys.argv[1]), sys.argv[2]))
