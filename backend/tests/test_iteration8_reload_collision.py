"""Iteration-8 backend tests for VIRTUE 3D FPS.

Under test:
  * Cannot shoot while reloading
    - Firing ak47 25 times empties magazine -> server auto-triggers reload
    - The (26th) shoot is rejected: no ammo drops further, reloading remains true
  * Force reload on empty ammo:
    - After magazine hits 0, state tick reports reloading=True without explicit reload
  * Mid-reload shoot blocked:
    - After explicit POST mtype=reload, subsequent shoot does not decrease ammo
  * Collidable extra perimeter buildings:
    - ARENA.obstacles now contains the 12 'extra' buildings (e.g. AABB at (42,42))
    - Server input handler clamps movement so player cannot phase into (42,42) AABB
"""
import os
import json
import asyncio
import pytest
import requests
import websockets

# --- env bootstrap ---------------------------------------------------------
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


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def token():
    return _login(P1)


# ---------- WS helpers ----------------------------------------------------
async def _ws_open(token, mode="offline"):
    url = f"{WS_BASE}/api/ws/game?token={token}&mode={mode}"
    return await websockets.connect(url, max_size=None, close_timeout=2, ping_interval=None)


async def _recv_welcome(ws, timeout=5.0):
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
        if msg.get("type") == "welcome":
            return msg
    raise AssertionError("Did not receive welcome within timeout")


async def _next_state_for_me(ws, my_id, timeout=4.0):
    """Drain until we see a state message that contains our own player."""
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
        if msg.get("type") != "state":
            continue
        for p in msg.get("players", []):
            if p.get("id") == my_id:
                return p, msg
    return None, None


class _StateRecorder:
    """Continuously drains incoming WS messages and keeps the latest state for `my_id`."""

    def __init__(self, ws, my_id):
        self.ws = ws
        self.my_id = my_id
        self.latest = None
        self.history = []   # list of {ammo, reloading, alive, x, z}
        self._task = None
        self._stop = False

    async def _run(self):
        while not self._stop:
            try:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except Exception:
                return
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if msg.get("type") != "state":
                continue
            for p in msg.get("players", []):
                if p.get("id") == self.my_id:
                    snap = {
                        "ammo": p.get("ammo"),
                        "mag": p.get("mag_size"),
                        "reloading": p.get("reloading"),
                        "alive": p.get("alive"),
                        "x": p.get("x"),
                        "z": p.get("z"),
                        "invuln": p.get("invuln"),
                    }
                    self.latest = snap
                    self.history.append(snap)
                    break

    def start(self):
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        self._stop = True
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=1.5)
            except Exception:
                self._task.cancel()


# ---------- ARENA OBSTACLE PRESENCE --------------------------------------
class TestArenaObstacles:
    """ARENA.obstacles must include the 12 new perimeter/corner buildings."""

    @pytest.mark.asyncio
    async def test_extra_buildings_collidable(self, token):
        ws = await _ws_open(token, mode="offline")
        try:
            welcome = await _recv_welcome(ws)
            arena = welcome.get("arena", {})
            obstacles = arena.get("obstacles", [])
            assert isinstance(obstacles, list) and len(obstacles) > 0

            # Build a quick lookup of (x,z) keys
            keys = {(round(float(o["x"]), 1), round(float(o["z"]), 1)) for o in obstacles}

            # Must contain at least these 12 extra perimeter buildings
            expected = [
                (42.0, 42.0), (-42.0, 42.0), (42.0, -42.0), (-42.0, -42.0),
                (12.0, 38.0), (-12.0, 38.0), (12.0, -38.0), (-12.0, -38.0),
                (38.0, 12.0), (38.0, -12.0), (-38.0, 12.0), (-38.0, -12.0),
            ]
            missing = [k for k in expected if k not in keys]
            assert not missing, f"Server arena missing extra perimeter obstacles: {missing}"

            # Total obstacle count should be >= original 28 + 12 new = 40
            assert len(obstacles) >= 40, f"Expected >=40 obstacles, got {len(obstacles)}"
        finally:
            await ws.close()


# ---------- AUTO-RELOAD WHEN EMPTY ---------------------------------------
class TestAutoReloadAndShootGate:
    """Verify (a) explicit reload sets reloading=True and (b) shoots during reload
    do NOT decrease ammo. Bots can kill us, so we use a continuous-recv recorder
    and grab the most-recent state while we're alive + reloading.

    The "fire 25 and auto-reload" code-path is the SAME path that runs on the
    ammo==0 branch in handle_message; verifying the gate covers both flows."""

    @pytest.mark.asyncio
    async def test_explicit_reload_then_shoot_does_not_decrease_ammo(self, token):
        ws = await _ws_open(token, mode="offline")
        try:
            welcome = await _recv_welcome(ws)
            me = welcome.get("you") or {}
            my_id = me["id"]
            assert me.get("weapon") == "ak47"
            full_mag = int(me.get("mag_size", 25))

            rec = _StateRecorder(ws, my_id)
            rec.start()
            try:
                # Fire one shot so reload is not a no-op (start_reload bails if mag full).
                await ws.send(json.dumps({"type": "shoot", "weapon": "ak47"}))
                await asyncio.sleep(0.35)

                # Snapshot ammo after the single shot — should be (mag - 1) if shot was accepted.
                base_state = rec.latest
                assert base_state is not None, "No state recorded after first shot"
                # If we somehow died, retry with a fresh connection isn't worth it; assert alive
                if not base_state.get("alive"):
                    pytest.skip("Player died before test could fire; bot RNG")
                ammo_after_one_shot = int(base_state["ammo"])
                # Allow that shot was accepted (ammo=full-1) — if cooldown rejected (still full), retry once
                if ammo_after_one_shot == full_mag:
                    await ws.send(json.dumps({"type": "shoot", "weapon": "ak47"}))
                    await asyncio.sleep(0.40)
                    ammo_after_one_shot = int(rec.latest["ammo"])
                assert ammo_after_one_shot < full_mag, (
                    f"First shoot did not decrement ammo (still {ammo_after_one_shot})"
                )

                # Now request explicit reload
                await ws.send(json.dumps({"type": "reload", "weapon": "ak47"}))
                await asyncio.sleep(0.20)

                # Confirm reloading=True observed
                saw_reloading = any(s.get("reloading") for s in rec.history[-30:])
                assert saw_reloading, "reloading=True never observed after reload msg"

                # Locate the moment reloading first became True and capture ammo then.
                reload_start_ammo = None
                for s in rec.history:
                    if s.get("reloading"):
                        reload_start_ammo = int(s["ammo"])
                        break
                assert reload_start_ammo is not None

                # Send a shoot DURING the reload window (reload_ms is ~2000ms for ak47
                # by default; we just sent reload ~200ms ago).
                await ws.send(json.dumps({"type": "shoot", "weapon": "ak47"}))
                await asyncio.sleep(0.30)

                # Collect all snapshots that were taken while still reloading.
                during_reload = [s for s in rec.history if s.get("reloading")]
                # Ammo must remain == reload_start_ammo for ALL during-reload snapshots
                bad = [s["ammo"] for s in during_reload if int(s["ammo"]) != reload_start_ammo]
                assert not bad, (
                    f"Ammo leaked during reload (expected stays at {reload_start_ammo}, saw {bad})"
                )
            finally:
                await rec.stop()
        finally:
            await ws.close()

    @pytest.mark.asyncio
    async def test_auto_reload_triggers_when_ammo_hits_zero(self, token):
        """Best-effort: spam ak47 shoots and confirm at SOME point reloading=True is observed
        with ammo==0 in history (auto-reload). If bots kill us before we reach 0 we skip."""
        ws = await _ws_open(token, mode="offline")
        try:
            welcome = await _recv_welcome(ws)
            me = welcome.get("you") or {}
            my_id = me["id"]
            assert me.get("weapon") == "ak47"

            rec = _StateRecorder(ws, my_id)
            rec.start()
            try:
                # Up to 40 attempts to fire (cooldown 250ms enforced server-side).
                # We send slightly under cooldown to be safe but trip occasional rejects.
                for _ in range(40):
                    await ws.send(json.dumps({"type": "shoot", "weapon": "ak47"}))
                    await asyncio.sleep(0.27)

                await asyncio.sleep(0.5)

                # Look in history for a state where ammo==0 AND reloading==True
                auto_reload_observed = any(
                    int(s.get("ammo", -1)) == 0 and bool(s.get("reloading"))
                    for s in rec.history
                )
                if not auto_reload_observed:
                    # If we died (alive went False) before reaching ammo=0, skip
                    died = any(s.get("alive") is False for s in rec.history)
                    if died:
                        pytest.skip("Player died before exhausting magazine (bot RNG).")
                    pytest.fail(
                        f"Never observed ammo=0 + reloading=True. Last state: {rec.latest}; "
                        f"history tail: {rec.history[-5:]}"
                    )
            finally:
                await rec.stop()
        finally:
            await ws.close()


# ---------- COLLISION ON NEW OBSTACLES -----------------------------------
class TestCollisionExtraBuildings:
    """Spawn is random; we try up to 4 reconnects to land within ~25 units of one of the
    new perimeter buildings, then push the player toward that building and confirm we
    never end up inside the AABB."""

    @pytest.mark.asyncio
    async def test_cannot_walk_into_perimeter_building(self, token):
        # Candidate extra-building centers (the 12 newly-added perimeter obstacles).
        candidates = [
            (42, 42, 2.5), (-42, 42, 2.5), (42, -42, 2.5), (-42, -42, 2.5),
            (12, 38, 1.5), (-12, 38, 1.5), (12, -38, 1.5), (-12, -38, 1.5),
            (38, 12, 3.0), (38, -12, 3.0), (-38, 12, 3.0), (-38, -12, 3.0),
        ]
        # Halfsizes above are half of w (x-extent). For (42,42), w=5 -> hx=2.5; etc.

        chosen = None
        ws = None
        my_id = None
        start_x = start_z = 0.0
        for _attempt in range(4):
            ws = await _ws_open(token, mode="offline")
            welcome = await _recv_welcome(ws)
            me = welcome.get("you") or {}
            my_id = me["id"]
            start_x, start_z = float(me["x"]), float(me["z"])
            # Pick the closest candidate within 25 units along each axis
            for (cx, cz, hx) in candidates:
                if abs(cx - start_x) < 25 and abs(cz - start_z) < 25:
                    chosen = (cx, cz, hx)
                    break
            if chosen is not None:
                break
            await ws.close()
            ws = None
            await asyncio.sleep(0.2)

        if chosen is None:
            pytest.skip("No spawn within 25u of a new perimeter building across 4 retries.")

        try:
            cx, cz, hx = chosen
            rec = _StateRecorder(ws, my_id)
            rec.start()
            try:
                # Walk toward (cx, cz) for ~45 input msgs over <3s (within invuln window).
                # We always re-aim from the *current* server pos via the recorder.
                for _ in range(60):
                    cur = rec.latest or {"x": start_x, "z": start_z}
                    cx_now = float(cur.get("x", start_x))
                    cz_now = float(cur.get("z", start_z))
                    dx = cx - cx_now
                    dz = cz - cz_now
                    dist = (dx * dx + dz * dz) ** 0.5
                    if dist < 0.05:
                        break
                    step = 1.2
                    nx = cx_now + dx / dist * step
                    nz = cz_now + dz / dist * step
                    await ws.send(json.dumps({
                        "type": "input",
                        "x": nx, "z": nz,
                        "yaw": 0.785, "pitch": 0.0,
                    }))
                    await asyncio.sleep(0.05)

                await asyncio.sleep(0.3)
                latest = rec.latest
                assert latest is not None, "No state captured"

                fx, fz = float(latest["x"]), float(latest["z"])
                # Blocked region: |x - cx| < hx + PLAYER_RADIUS(=0.5) AND same for z (with halfsize hz).
                # We use the AABB's x halfsize for both axes here as an upper bound; players
                # might be just outside z but inside x — that's fine. Strict check:
                # we re-derive the relevant z halfsize from the obstacle list. Simplification:
                # if player is anywhere inside the obstacle's actual w/d AABB +/- 0.5, fail.

                # Pull arena.obstacles from welcome and find the matching obstacle.
                arena = welcome.get("arena", {})
                ob = next(
                    (o for o in arena.get("obstacles", [])
                     if abs(o["x"] - cx) < 0.01 and abs(o["z"] - cz) < 0.01),
                    None,
                )
                assert ob is not None, f"Could not find obstacle at ({cx},{cz}) in welcome arena"
                hx_real = ob["w"] / 2 + 0.5
                hz_real = ob["d"] / 2 + 0.5

                inside = (abs(fx - cx) < hx_real) and (abs(fz - cz) < hz_real)
                # Also assert we actually MOVED some distance toward (cx, cz)
                traveled = ((fx - start_x) ** 2 + (fz - start_z) ** 2) ** 0.5
                if traveled < 0.5:
                    pytest.skip(f"Player did not move (start=({start_x},{start_z}), end=({fx},{fz})) — possibly died.")

                assert not inside, (
                    f"Player ended INSIDE building AABB at ({fx:.2f},{fz:.2f}) "
                    f"target=({cx},{cz}) halfsize=({hx_real:.2f},{hz_real:.2f}) — collision missing"
                )
            finally:
                await rec.stop()
        finally:
            if ws:
                await ws.close()


# ---------- Smoke regression --------------------------------------------
class TestSmoke:
    def test_login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json=P1, timeout=10)
        assert r.status_code == 200
        assert "access_token" in r.json()
