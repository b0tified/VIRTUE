"""Tests for new features (Iteration N):
- Placement match streak (PLACEMENT_MATCHES=5, 2x RP, no loss)
- Kill event 'weapon' field (ak47/laser for shoot, katana for melee)
- public_user() exposes placement_matches_played/total/in_placements
- Ranked queue endpoints still return expected payloads
"""
import asyncio
import math
import os
import time
import uuid

import pytest
import requests
from bson import ObjectId

BASE_URL_EXT = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
LOCAL = "http://localhost:8001"


def _register(suffix: str):
    body = {
        "email": f"TEST_pl_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": f"TESTpl{suffix}"[:20],
    }
    r = requests.post(f"{LOCAL}/api/auth/register", json=body)
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": body["email"], "password": body["password"]})
    assert r.status_code == 200, r.text
    return body, r.json()


# ---------- public_user / auth responses ----------
class TestPlacementFieldsInAuth:
    def test_register_returns_placement_fields(self):
        body, payload = _register("reg" + uuid.uuid4().hex[:6])
        user = payload["user"]
        assert "placement_matches_played" in user
        assert "placement_matches_total" in user
        assert "in_placements" in user
        assert user["placement_matches_total"] == 5
        assert user["placement_matches_played"] == 0
        assert user["in_placements"] is True

    def test_login_returns_placement_fields(self):
        body, _ = _register("lg" + uuid.uuid4().hex[:6])
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": body["email"], "password": body["password"]})
        assert r.status_code == 200
        user = r.json()["user"]
        assert user["placement_matches_total"] == 5
        assert user["in_placements"] is True

    def test_me_returns_placement_fields_via_public_url(self):
        body, payload = _register("me" + uuid.uuid4().hex[:6])
        token = payload["access_token"]
        # also try external URL to ensure ingress passes through
        url = (BASE_URL_EXT or LOCAL) + "/api/auth/me"
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["placement_matches_total"] == 5
        assert u["placement_matches_played"] == 0
        assert u["in_placements"] is True


# ---------- Queue endpoints ----------
class TestQueueEndpoints:
    def test_queue_join_get_delete(self):
        body, payload = _register("q" + uuid.uuid4().hex[:6])
        token = payload["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        # Join queue
        r = requests.post(f"{LOCAL}/api/queue/ranked", headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        # Response is either {matched:True, match_id, tier, tier_name}
        # or {in_queue:True, tier, tier_name, position, tier_size}
        assert "tier" in d and "tier_name" in d, d
        assert d.get("matched") or d.get("in_queue"), d
        if d.get("in_queue"):
            assert "position" in d and "tier_size" in d, d

        # Get status
        r = requests.get(f"{LOCAL}/api/queue/ranked", headers=h)
        assert r.status_code == 200
        d = r.json()
        assert "tier" in d and "tier_name" in d, d

        # Delete (leave)
        r = requests.delete(f"{LOCAL}/api/queue/ranked", headers=h)
        assert r.status_code in (200, 204)


# ---------- Kill event weapon field (deterministic GameRoom test) ----------
class TestKillEventWeapon:
    def test_shoot_kill_event_has_weapon_ak47(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import server as srv

        async def run():
            class FakeWS:
                async def send_text(self, *_a, **_kw):
                    return None

            shooter = srv.Player.__new__(srv.Player)
            shooter.ws = FakeWS(); shooter.is_bot = False; shooter.user_id = None
            shooter.username = "shooter"; shooter.id = "s1"
            shooter.x = 30.0; shooter.y = srv.PLAYER_HEIGHT; shooter.z = 0.0
            shooter.yaw = math.pi / 2; shooter.pitch = 0.0
            shooter.hp = srv.MAX_HP; shooter.kills = 0; shooter.deaths = 0
            shooter.alive = True; shooter.last_shot_ms = 0; shooter.respawn_at = 0.0
            shooter.invuln_until = 0.0; shooter.last_attacker = None
            shooter.bot_strafe_t = 0.0; shooter.bot_repath_at = 0.0; shooter.bot_target_id = None
            shooter.weapon = "ak47"
            shooter.max_hp = srv.MAX_HP

            victim = srv.Player.__new__(srv.Player)
            victim.ws = FakeWS(); victim.is_bot = True; victim.user_id = None
            victim.username = "BOT-1"; victim.id = "v1"
            victim.x = 35.0; victim.y = srv.PLAYER_HEIGHT; victim.z = 0.0
            victim.yaw = 0.0; victim.pitch = 0.0
            victim.hp = 1  # near-dead so 1 shot kills
            victim.kills = 0; victim.deaths = 0; victim.alive = True
            victim.last_shot_ms = 0; victim.respawn_at = 0.0
            victim.invuln_until = 0.0; victim.last_attacker = None
            victim.bot_strafe_t = 0.0; victim.bot_repath_at = 0.0; victim.bot_target_id = None
            victim.weapon = "ak47"
            victim.max_hp = srv.BOT_MAX_HP

            room = srv.GameRoom()
            room.players = {shooter.id: shooter, victim.id: victim}
            assert room.raycast_hit(shooter) is victim
            await room._apply_shoot(shooter, srv.SHOT_DAMAGE)
            kills = [e for e in room.events if e["type"] == "kill"]
            assert kills, f"No kill event: {room.events}"
            assert kills[0].get("weapon") == "ak47", kills[0]

        asyncio.run(run())

    def test_melee_kill_event_has_weapon_katana(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import server as srv

        async def run():
            class FakeWS:
                async def send_text(self, *_a, **_kw):
                    return None

            attacker = srv.Player.__new__(srv.Player)
            attacker.ws = FakeWS(); attacker.is_bot = False; attacker.user_id = None
            attacker.username = "atk"; attacker.id = "a1"
            attacker.x = 30.0; attacker.y = srv.PLAYER_HEIGHT; attacker.z = 0.0
            attacker.yaw = math.pi / 2; attacker.pitch = 0.0
            attacker.hp = srv.MAX_HP; attacker.kills = 0; attacker.deaths = 0
            attacker.alive = True; attacker.last_shot_ms = 0; attacker.respawn_at = 0.0
            attacker.invuln_until = 0.0; attacker.last_attacker = None
            attacker.bot_strafe_t = 0.0; attacker.bot_repath_at = 0.0; attacker.bot_target_id = None
            attacker.weapon = "ak47"
            attacker.max_hp = srv.MAX_HP

            victim = srv.Player.__new__(srv.Player)
            victim.ws = FakeWS(); victim.is_bot = True; victim.user_id = None
            victim.username = "BOT-2"; victim.id = "v2"
            victim.x = 32.0; victim.y = srv.PLAYER_HEIGHT; victim.z = 0.0
            victim.yaw = 0.0; victim.pitch = 0.0
            victim.hp = 1; victim.kills = 0; victim.deaths = 0; victim.alive = True
            victim.last_shot_ms = 0; victim.respawn_at = 0.0
            victim.invuln_until = 0.0; victim.last_attacker = None
            victim.bot_strafe_t = 0.0; victim.bot_repath_at = 0.0; victim.bot_target_id = None
            victim.weapon = "ak47"
            victim.max_hp = srv.BOT_MAX_HP

            room = srv.GameRoom()
            room.players = {attacker.id: attacker, victim.id: victim}
            await room._apply_melee(attacker)
            kills = [e for e in room.events if e["type"] == "kill"]
            assert kills, f"No melee kill event: {room.events}"
            assert kills[0].get("weapon") == "katana"
            assert kills[0].get("melee") is True


        asyncio.run(run())


# ---------- end_match placement RP logic ----------
class TestEndMatchPlacementRP:
    def test_placement_doubles_positive_and_zeros_negative(self):
        """Run end_match on a fresh user (in_placements). Verify:
        - delta is doubled (60 vs 30 for 1st)
        - placement_matches_played incremented
        - is_placement, placement_match_number in payload
        """
        import sys
        sys.path.insert(0, "/app/backend")
        import server as srv
        from motor.motor_asyncio import AsyncIOMotorClient

        async def run():
            mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
            test_db = mc[os.environ["DB_NAME"]]
            srv.db = test_db

            email = f"TEST_endm_{uuid.uuid4().hex[:6]}@shooter.com"
            r = requests.post(f"{LOCAL}/api/auth/register",
                              json={"email": email, "password": "Passw0rd!", "username": "endM"})
            assert r.status_code == 200
            udoc = await test_db.users.find_one({"email": email.lower()})
            assert udoc is not None
            uid = str(udoc["_id"])

            # Build a single real player with 5 kills (so first place delta=30 base)
            class FakeWS:
                async def send_text(self, *_a, **_kw):
                    return None

            p = srv.Player.__new__(srv.Player)
            p.ws = FakeWS(); p.is_bot = False; p.user_id = uid
            p.username = "endM"; p.id = "ep1"
            p.x = 0; p.y = srv.PLAYER_HEIGHT; p.z = 0
            p.yaw = 0; p.pitch = 0
            p.hp = srv.MAX_HP; p.kills = 5; p.deaths = 0; p.alive = True
            p.last_shot_ms = 0; p.respawn_at = 0.0
            p.invuln_until = 0.0; p.last_attacker = None
            p.bot_strafe_t = 0.0; p.bot_repath_at = 0.0; p.bot_target_id = None
            p.weapon = "ak47"
            p.max_hp = srv.MAX_HP

            room = srv.GameRoom()
            room.players = {p.id: p}
            room.is_ranked = True
            room.match_duration = 1.0
            room.match_start = time.time()
            room.last_match_end_payload = None

            # end_match awaits asyncio.sleep(10) and then nulls payload — run
            # concurrently and capture right after broadcast.
            task = asyncio.create_task(room.end_match())
            # Poll until payload is set
            for _ in range(50):
                if room.last_match_end_payload is not None:
                    break
                await asyncio.sleep(0.05)
            payload = room.last_match_end_payload
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, BaseException):
                pass
            assert payload is not None, "match_end payload not set"
            placements = payload["placements"]
            assert len(placements) == 1
            pl = placements[0]
            assert pl["base_delta"] == 30
            # Placement multiplier 2x => 60
            assert pl["delta"] == 60, pl
            assert pl["is_placement"] is True
            assert pl["placement_match_number"] == 1
            assert pl["placement_matches_total"] == 5

            # Verify DB increment
            udoc_after = await test_db.users.find_one({"_id": ObjectId(uid)})
            assert udoc_after["placement_matches_played"] == 1
            assert udoc_after["rank_points"] == 60

            mc.close()

        asyncio.run(run())

    def test_placement_zeros_negative_loss(self):
        """A user in 4th place with base_delta=-10 should get 0 during placements."""
        import sys
        sys.path.insert(0, "/app/backend")
        import server as srv
        from motor.motor_asyncio import AsyncIOMotorClient

        async def run():
            mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
            test_db = mc[os.environ["DB_NAME"]]
            srv.db = test_db

            # Register 4 users
            users = []
            for i in range(4):
                email = f"TEST_neg_{uuid.uuid4().hex[:5]}_{i}@shooter.com"
                r = requests.post(f"{LOCAL}/api/auth/register",
                                  json={"email": email, "password": "Passw0rd!", "username": f"neg{i}"})
                assert r.status_code == 200, r.text
                doc = await test_db.users.find_one({"email": email.lower()})
                users.append(doc)

            class FakeWS:
                async def send_text(self, *_a, **_kw):
                    return None

            players = []
            for idx, u in enumerate(users):
                p = srv.Player.__new__(srv.Player)
                p.ws = FakeWS(); p.is_bot = False; p.user_id = str(u["_id"])
                p.username = u["username"]; p.id = f"np{idx}"
                p.x = 0; p.y = srv.PLAYER_HEIGHT; p.z = 0
                p.yaw = 0; p.pitch = 0
                p.hp = srv.MAX_HP
                p.kills = 10 - idx  # idx0=10, idx3=7 (last place gets -10 base)
                p.deaths = 0; p.alive = True
                p.last_shot_ms = 0; p.respawn_at = 0.0
                p.invuln_until = 0.0; p.last_attacker = None
                p.bot_strafe_t = 0.0; p.bot_repath_at = 0.0; p.bot_target_id = None
                p.weapon = "ak47"
                p.max_hp = srv.MAX_HP
                players.append(p)

            room = srv.GameRoom()
            room.players = {p.id: p for p in players}
            room.is_ranked = True
            room.match_duration = 1.0
            room.match_start = time.time()
            room.last_match_end_payload = None

            task = asyncio.create_task(room.end_match())
            for _ in range(50):
                if room.last_match_end_payload is not None:
                    break
                await asyncio.sleep(0.05)
            payload = room.last_match_end_payload
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, BaseException):
                pass
            assert payload is not None
            placements = payload["placements"]
            assert len(placements) == 4
            # Last place
            last = placements[3]
            assert last["base_delta"] == -10
            assert last["delta"] == 0, f"Expected 0 during placements, got {last}"
            assert last["is_placement"] is True

            # 1st place doubled
            first = placements[0]
            assert first["base_delta"] == 30
            assert first["delta"] == 60

            mc.close()

        asyncio.run(run())


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
