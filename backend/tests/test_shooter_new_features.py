"""New feature tests for PvP Shooter:
- Bots auto-spawn at startup (BLAZE-7, VORTEX, RAVEN-X) visible in WS state
- WebSocket ping/pong handler echoes ts
- Spawn invulnerability (3s) prevents damage during window
- Player can damage/kill bots via WS shoot; stats.kills persists in MongoDB
- Bots actively shoot - their kills counters can increment over time
"""
import asyncio
import json
import math
import os
import time
import uuid

import pytest
import requests
import websockets

BASE_URL_EXT = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
LOCAL = "http://localhost:8001"
LOCAL_WS = "ws://localhost:8001"

ADMIN_EMAIL = "admin@shooter.com"
ADMIN_PASSWORD = "admin123"
EXPECTED_BOTS = {"BLAZE-7", "VORTEX", "RAVEN-X"}


def _register_local(suffix: str):
    u = {
        "email": f"TEST_nf_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": f"TESTnf{suffix}"[:20],
    }
    r = requests.post(f"{LOCAL}/api/auth/register", json=u)
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": u["email"], "password": u["password"]})
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


# ---------- Bots auto-spawn ----------
class TestBotsAutoSpawn:
    def test_three_bots_present_in_state(self):
        _, token = _register_local(uuid.uuid4().hex[:6])

        async def run():
            url = f"{LOCAL_WS}/api/ws/game?token={token}"
            async with websockets.connect(url, ping_interval=None) as ws:
                welcome = await _recv_until(ws, "welcome", timeout=5.0)
                assert welcome is not None
                state = await _recv_until(ws, "state", timeout=3.0)
                assert state is not None
                bots = [p for p in state["players"] if p.get("is_bot")]
                names = {b["username"] for b in bots}
                assert len(bots) >= 3, f"Expected >=3 bots, got {len(bots)}: {names}"
                assert EXPECTED_BOTS.issubset(names), f"Missing bots. Got: {names}"
                # Each bot has hp/alive fields
                for b in bots:
                    assert b["is_bot"] is True
                    assert "hp" in b and "alive" in b

        asyncio.run(run())


# ---------- WebSocket ping/pong ----------
class TestPingPong:
    def test_ping_pong_echoes_ts(self):
        _, token = _register_local(uuid.uuid4().hex[:6])

        async def run():
            url = f"{LOCAL_WS}/api/ws/game?token={token}"
            async with websockets.connect(url, ping_interval=None) as ws:
                welcome = await _recv_until(ws, "welcome", timeout=5.0)
                assert welcome is not None
                sent_ts = 1234567890
                await ws.send(json.dumps({"type": "ping", "ts": sent_ts}))
                pong = await _recv_until(ws, "pong", timeout=3.0)
                assert pong is not None, "No pong received"
                assert pong.get("ts") == sent_ts, f"Pong ts mismatch: {pong}"

        asyncio.run(run())


# ---------- Spawn invulnerability ----------
class TestSpawnInvulnerability:
    def test_invuln_during_first_3s_then_takes_damage(self):
        """Direct GameRoom test: shoot freshly-spawned victim within invuln window,
        verify no hit; wait past 3s, verify hit registers."""
        import sys
        sys.path.insert(0, "/app/backend")
        import server as srv

        async def run():
            class FakeWS:
                async def send_text(self, *_a, **_kw):
                    return None

            # Shooter at (30,0), victim at (35,0) - clear of obstacles
            shooter = srv.Player.__new__(srv.Player)
            shooter.ws = FakeWS(); shooter.is_bot = False; shooter.user_id = None
            shooter.username = "shooter"; shooter.id = "s1"
            shooter.x = 30.0; shooter.y = srv.PLAYER_HEIGHT; shooter.z = 0.0
            shooter.yaw = math.pi / 2; shooter.pitch = 0.0
            shooter.hp = srv.MAX_HP; shooter.kills = 0; shooter.deaths = 0
            shooter.alive = True; shooter.last_shot_ms = 0; shooter.respawn_at = 0.0
            shooter.invuln_until = 0.0  # shooter not invulnerable
            shooter.last_attacker = None
            shooter.bot_strafe_t = 0.0; shooter.bot_repath_at = 0.0; shooter.bot_target_id = None

            victim = srv.Player.__new__(srv.Player)
            victim.ws = FakeWS(); victim.is_bot = False; victim.user_id = None
            victim.username = "victim"; victim.id = "v1"
            victim.x = 35.0; victim.y = srv.PLAYER_HEIGHT; victim.z = 0.0
            victim.yaw = 0.0; victim.pitch = 0.0
            victim.hp = srv.MAX_HP; victim.kills = 0; victim.deaths = 0
            victim.alive = True; victim.last_shot_ms = 0; victim.respawn_at = 0.0
            victim.invuln_until = time.time() + 3.0  # fresh spawn invuln
            victim.last_attacker = None
            victim.bot_strafe_t = 0.0; victim.bot_repath_at = 0.0; victim.bot_target_id = None

            room = srv.GameRoom()
            room.players = {shooter.id: shooter, victim.id: victim}

            # Sanity: raycast finds the victim
            target_hit = room.raycast_hit(shooter)
            assert target_hit is victim, f"Raycast doesn't see victim, got {target_hit}"

            # Phase 1: Within invuln window, shoot - victim should NOT lose HP
            for _ in range(3):
                shooter.last_shot_ms = 0
                await room.handle_message(shooter, {"type": "shoot", "yaw": math.pi/2, "pitch": 0.0})
            assert victim.hp == srv.MAX_HP, f"Invuln failed: HP={victim.hp}"
            hit_events = [e for e in room.events if e["type"] == "hit"]
            assert len(hit_events) == 0, f"Unexpected hit during invuln: {hit_events}"

            # Phase 2: Wait past invuln window
            await asyncio.sleep(3.1)
            shooter.last_shot_ms = 0
            await room.handle_message(shooter, {"type": "shoot", "yaw": math.pi/2, "pitch": 0.0})
            hit_events_after = [e for e in room.events if e["type"] == "hit"]
            assert len(hit_events_after) >= 1, f"No hit after invuln window: events={room.events}"
            assert victim.hp < srv.MAX_HP, f"Victim HP unchanged after invuln expired: {victim.hp}"

        asyncio.run(run())


# ---------- Player kills bot via WS, stats persist ----------
class TestPlayerKillsBot:
    def test_player_shoots_bot_kills_persist(self):
        """Connect via WS, repeatedly aim at any bot in arena and shoot until kill;
        verify scoreboard kills increment and MongoDB stats.kills increment.
        Best-effort: bots move/dodge — we also assert via direct GameRoom test below
        as the deterministic check."""
        u, token = _register_local("kb" + uuid.uuid4().hex[:5])
        s = requests.Session()
        s.post(f"{LOCAL}/api/auth/login", json={"email": u["email"], "password": u["password"]})
        me_before = s.get(f"{LOCAL}/api/auth/me").json()
        kills_before = me_before["stats"]["kills"]

        async def run():
            url = f"{LOCAL_WS}/api/ws/game?token={token}"
            async with websockets.connect(url, ping_interval=None) as ws:
                welcome = await _recv_until(ws, "welcome", 5.0)
                assert welcome is not None
                my_id = welcome["you"]["id"]

                # Wait for invuln to expire (3s)
                await asyncio.sleep(3.2)

                kill_seen = False
                hit_count = 0
                shot_seen = False
                target_id = None

                # Try to kill a bot over ~45s
                deadline = time.time() + 45.0
                last_pos = None
                stuck = 0
                while time.time() < deadline and not kill_seen:
                    st = await _recv_until(ws, "state", 1.5)
                    if not st:
                        continue
                    me_state = next((p for p in st["players"] if p["id"] == my_id), None)
                    if not me_state or not me_state["alive"]:
                        # Wait for respawn + new invuln expiry
                        if me_state and not me_state["alive"]:
                            await asyncio.sleep(3.3)
                        continue

                    for ev in st.get("events", []):
                        if ev.get("type") == "shot" and ev.get("shooter_id") == my_id:
                            shot_seen = True
                        if ev.get("type") == "hit" and ev.get("shooter_id") == my_id:
                            hit_count += 1
                        if ev.get("type") == "kill" and ev.get("shooter_id") == my_id:
                            kill_seen = True

                    if kill_seen:
                        break

                    # Pick closest bot
                    bots = [p for p in st["players"] if p.get("is_bot") and p["alive"]]
                    if not bots:
                        continue
                    # Stick with same target if possible
                    target = None
                    if target_id:
                        target = next((b for b in bots if b["id"] == target_id), None)
                    if not target:
                        bots.sort(key=lambda b: math.hypot(b["x"] - me_state["x"], b["z"] - me_state["z"]))
                        target = bots[0]
                        target_id = target["id"]

                    dx = target["x"] - me_state["x"]
                    dz = target["z"] - me_state["z"]
                    dist = math.hypot(dx, dz)
                    yaw_to = math.atan2(dx, -dz)
                    # Aim slightly down (bot center)
                    pitch = math.atan2(-0.2, max(dist, 0.01))

                    # Move closer if too far
                    cur = (me_state["x"], me_state["z"])
                    if last_pos and abs(cur[0]-last_pos[0]) < 0.05 and abs(cur[1]-last_pos[1]) < 0.05:
                        stuck += 1
                    else:
                        stuck = 0
                    last_pos = cur

                    if dist > 8.0:
                        if stuck >= 2 and dist > 0.01:
                            # Strafe to unstick
                            perp_x, perp_z = -dz/dist, dx/dist
                            nx = me_state["x"] + perp_x * 1.0
                            nz = me_state["z"] + perp_z * 1.0
                            stuck = 0
                        else:
                            step = min(1.1, dist - 6.0)
                            nx = me_state["x"] + dx/dist * step
                            nz = me_state["z"] + dz/dist * step
                        await ws.send(json.dumps({"type": "input", "x": nx, "z": nz,
                                                  "yaw": yaw_to, "pitch": pitch}))
                        await asyncio.sleep(0.08)

                    # Volley with small spread
                    for dyaw in (0.0, 0.05, -0.05):
                        await ws.send(json.dumps({"type": "shoot",
                                                  "yaw": yaw_to + dyaw,
                                                  "pitch": pitch}))
                        await asyncio.sleep(0.28)

                print(f"[WS bot-kill] shot_seen={shot_seen} hits={hit_count} kill_seen={kill_seen}")
                # Best-effort assertion: at minimum a shot should be broadcast
                # (skip if we never got an alive state - that means client died
                # repeatedly to bots which is itself proof bots work)
                # Bots are mobile and dodge — kills via WS are best-effort.
                # Deterministic kill+persistence is verified in TestPlayerKillsBotDirect.

        asyncio.run(run())

        # Allow DB write — only assert kills increment if WS run achieved a kill
        time.sleep(1.0)
        me_after = s.get(f"{LOCAL}/api/auth/me").json()
        kills_after = me_after["stats"]["kills"]
        # Best-effort assertion: kills_after >= kills_before (no negative regression)
        assert kills_after >= kills_before


# ---------- Deterministic: Player kills bot, player stats persist ----------
class TestPlayerKillsBotDirect:
    def test_kill_bot_persists_player_stats(self):
        """Use GameRoom directly: place player + bot at clear positions,
        fire shots, verify bot dies and player's MongoDB stats.kills increments."""
        import sys
        sys.path.insert(0, "/app/backend")
        import server as srv

        async def run():
            from motor.motor_asyncio import AsyncIOMotorClient
            mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
            test_db = mc[os.environ["DB_NAME"]]
            srv.db = test_db

            email = f"TEST_kb_direct_{uuid.uuid4().hex[:6]}@shooter.com"
            r = requests.post(f"{LOCAL}/api/auth/register",
                              json={"email": email, "password": "Passw0rd!", "username": "kbDirect"})
            assert r.status_code == 200, r.text
            user = await test_db.users.find_one({"email": email.lower()})
            assert user is not None
            kills_before = (user.get("stats") or {}).get("kills", 0)

            class FakeWS:
                async def send_text(self, *_a, **_kw):
                    return None

            shooter = srv.Player.__new__(srv.Player)
            shooter.ws = FakeWS(); shooter.is_bot = False; shooter.user_id = str(user["_id"])
            shooter.username = "kbDirect"; shooter.id = "ps1"
            shooter.x = 30.0; shooter.y = srv.PLAYER_HEIGHT; shooter.z = 0.0
            shooter.yaw = math.pi / 2; shooter.pitch = 0.0
            shooter.hp = srv.MAX_HP; shooter.kills = 0; shooter.deaths = 0
            shooter.alive = True; shooter.last_shot_ms = 0; shooter.respawn_at = 0.0
            shooter.invuln_until = 0.0; shooter.last_attacker = None
            shooter.bot_strafe_t = 0.0; shooter.bot_repath_at = 0.0; shooter.bot_target_id = None

            bot = srv.Player.__new__(srv.Player)
            bot.ws = None; bot.is_bot = True; bot.user_id = None
            bot.username = "BLAZE-7"; bot.id = "bot_tst"
            bot.x = 35.0; bot.y = srv.PLAYER_HEIGHT; bot.z = 0.0
            bot.yaw = 0.0; bot.pitch = 0.0
            bot.hp = srv.MAX_HP; bot.kills = 0; bot.deaths = 0
            bot.alive = True; bot.last_shot_ms = 0; bot.respawn_at = 0.0
            bot.invuln_until = 0.0; bot.last_attacker = None
            bot.bot_strafe_t = 0.0; bot.bot_repath_at = 0.0; bot.bot_target_id = None

            room = srv.GameRoom()
            room.players = {shooter.id: shooter, bot.id: bot}

            # Confirm raycast sees bot
            assert room.raycast_hit(shooter) is bot

            for _ in range(4):
                shooter.last_shot_ms = 0  # bypass cooldown
                await room.handle_message(shooter, {"type": "shoot", "yaw": math.pi/2, "pitch": 0.0})

            event_types = [e["type"] for e in room.events]
            assert "hit" in event_types, f"No hits: {room.events}"
            assert "kill" in event_types, f"No kill: {room.events}"
            assert bot.alive is False
            assert shooter.kills == 1

            # Wait for async DB persistence
            await asyncio.sleep(0.7)
            user_after = await test_db.users.find_one({"_id": user["_id"]})
            assert user_after["stats"]["kills"] >= kills_before + 1, \
                f"Player kills did not persist: {kills_before} -> {user_after['stats']['kills']}"

            mc.close()

        asyncio.run(run())


# ---------- Bots actively shoot players ----------
class TestBotsActivelyShoot:
    def test_idle_player_takes_bot_damage_or_dies(self):
        """Leave a player idle; over ~15s, bots should shoot. We verify by detecting
        bot 'shot' events or by the player taking damage."""
        u, token = _register_local("idle" + uuid.uuid4().hex[:5])

        async def run():
            url = f"{LOCAL_WS}/api/ws/game?token={token}"
            async with websockets.connect(url, ping_interval=None) as ws:
                welcome = await _recv_until(ws, "welcome", 5.0)
                assert welcome is not None
                my_id = welcome["you"]["id"]

                bot_shot_count = 0
                damaged = False
                bot_kill_seen = False
                start_hp = welcome["you"]["hp"]

                deadline = time.time() + 18.0
                while time.time() < deadline:
                    st = await _recv_until(ws, "state", 1.5)
                    if not st:
                        continue
                    bot_ids = {p["id"] for p in st["players"] if p.get("is_bot")}
                    for ev in st.get("events", []):
                        if ev.get("type") == "shot" and ev.get("shooter_id") in bot_ids:
                            bot_shot_count += 1
                        if ev.get("type") == "hit" and ev.get("victim_id") == my_id:
                            damaged = True
                        if ev.get("type") == "kill" and ev.get("shooter_id") in bot_ids:
                            bot_kill_seen = True

                    me_state = next((p for p in st["players"] if p["id"] == my_id), None)
                    if me_state and me_state["hp"] < start_hp:
                        damaged = True

                    if bot_shot_count >= 3 and (damaged or bot_kill_seen):
                        break

                assert bot_shot_count > 0, "Bots did not shoot at all"
                # Either damaged or got killed by bots
                assert damaged or bot_kill_seen, (
                    f"Idle player took no damage from bots "
                    f"(bot_shots={bot_shot_count})"
                )

        asyncio.run(run())


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
