"""Overwatch-style shooting pipeline tests.

- /api/auth/login returns rank_points / peak_rank_points / in_placements / placement_matches_played
- /api/season returns season_number, seconds_left, length_days=14
- /api/queue/ranked returns bot_fill_seconds=45 (Bronze) and 120 (Master+)
- WS shoot: ammo decrements 25 -> 24, server emits 'shot' event with weapon
- WS shoot: auto-reload triggers at 0 ammo, reloading=true, reload_progress increases, refills after ~1.5s
- WS reload: manual reload starts reloading=true; ignored if mag full
- WS hit events include body_part, damage, headshot fields
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
from pymongo import MongoClient
from bson import ObjectId

LOCAL = "http://localhost:8001"
LOCAL_WS = "ws://localhost:8001"
ADMIN_EMAIL = "admin@shooter.com"
ADMIN_PASSWORD = "admin123"

_mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
_db = _mongo[os.environ.get("DB_NAME", "test_database")]


def _set_rank_points(user_id: str, rp: int):
    _db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"rank_points": rp}})


def _register(suffix: str):
    u = {
        "email": f"TEST_ow_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": f"TESTow{suffix}"[:20],
    }
    r = requests.post(f"{LOCAL}/api/auth/register", json=u)
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": u["email"], "password": u["password"]})
    assert r.status_code == 200, r.text
    return u, r.json()["access_token"]


def _admin_login():
    r = requests.post(f"{LOCAL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


async def _recv_json(ws, timeout=2.0):
    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    return json.loads(raw)


async def _wait_welcome(ws):
    end = time.time() + 4.0
    while time.time() < end:
        try:
            m = await _recv_json(ws, timeout=max(0.1, end - time.time()))
        except asyncio.TimeoutError:
            return None
        if m.get("type") == "welcome":
            return m
    return None


# ---------- /api/auth/login schema ----------
class TestAuthLoginSchema:
    def test_login_includes_rank_and_placement_fields(self):
        u, _ = _register(f"login_{uuid.uuid4().hex[:6]}")
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": u["email"], "password": u["password"]})
        assert r.status_code == 200, r.text
        user = r.json().get("user") or {}
        for k in ("rank_points", "peak_rank_points", "in_placements", "placement_matches_played"):
            assert k in user, f"missing '{k}' in login user: {list(user.keys())}"
        assert isinstance(user["rank_points"], int)
        assert isinstance(user["peak_rank_points"], int)
        assert isinstance(user["in_placements"], bool)
        assert isinstance(user["placement_matches_played"], int)


# ---------- /api/season ----------
class TestSeasonEndpoint:
    def test_season_has_required_fields(self):
        r = requests.get(f"{LOCAL}/api/season")
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("season_number"), int)
        assert isinstance(d.get("seconds_left"), int)
        assert d.get("length_days") == 14, d


# ---------- /api/queue/ranked bot_fill_seconds ----------
class TestQueueBotFillSeconds:
    def test_bronze_admin_returns_20_to_45(self):
        """Bronze bot-fill is now random [20, 45] per 2026-07-01 tuning."""
        admin = _admin_login()
        admin_id = admin["user"]["id"]
        _set_rank_points(admin_id, 0)
        admin = _admin_login()
        headers = {"Authorization": f"Bearer {admin['access_token']}"}
        try:
            r = requests.post(f"{LOCAL}/api/queue/ranked", headers=headers)
            assert r.status_code == 200, r.text
            fill = r.json().get("bot_fill_seconds")
            assert 20 <= fill <= 45, r.json()
        finally:
            requests.delete(f"{LOCAL}/api/queue/ranked", headers=headers)

    def test_master_admin_returns_30_to_180(self):
        """Master bot-fill is now random [30, 180] per 2026-07-01 tuning."""
        admin = _admin_login()
        admin_id = admin["user"]["id"]
        _set_rank_points(admin_id, 1300)
        try:
            admin = _admin_login()
            headers = {"Authorization": f"Bearer {admin['access_token']}"}
            r = requests.post(f"{LOCAL}/api/queue/ranked", headers=headers)
            assert r.status_code == 200, r.text
            fill = r.json().get("bot_fill_seconds")
            assert 30 <= fill <= 180, r.json()
            requests.delete(f"{LOCAL}/api/queue/ranked", headers=headers)
        finally:
            _set_rank_points(admin_id, 0)


# ---------- WS shoot/reload ----------
class TestWSAmmoAndReload:
    def test_shoot_decrements_ammo_and_emits_shot(self):
        async def run():
            _, token = _register(f"a_{uuid.uuid4().hex[:6]}")
            url = f"{LOCAL_WS}/api/ws/game?token={token}&mode=casual"
            async with websockets.connect(url, ping_interval=None) as ws:
                welcome = await _wait_welcome(ws)
                assert welcome is not None
                you = welcome["you"]
                assert you.get("ammo") == 25
                assert you.get("mag_size") == 25

                await ws.send(json.dumps({"type": "shoot", "weapon": "ak47",
                                          "yaw": 0.0, "pitch": 0.0}))
                saw_shot = False
                my_ammo_after = None
                end = time.time() + 4.0
                while time.time() < end:
                    try:
                        m = await _recv_json(ws, timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    if m.get("type") != "state":
                        continue
                    for ev in (m.get("events") or []):
                        if ev.get("type") == "shot" and ev.get("shooter_id") == you["id"]:
                            saw_shot = True
                            assert ev.get("weapon") == "ak47", ev
                    for pl in (m.get("players") or []):
                        if pl["id"] == you["id"]:
                            my_ammo_after = pl["ammo"]
                    if saw_shot and my_ammo_after is not None and my_ammo_after < 25:
                        break
                assert saw_shot, "no 'shot' event seen"
                assert my_ammo_after == 24, f"ammo {my_ammo_after} != 24"
        asyncio.run(run())

    def test_full_mag_drain_triggers_auto_reload_and_refill(self):
        async def run():
            _, token = _register(f"b_{uuid.uuid4().hex[:6]}")
            url = f"{LOCAL_WS}/api/ws/game?token={token}&mode=casual"
            async with websockets.connect(url, ping_interval=None) as ws:
                welcome = await _wait_welcome(ws)
                you_id = welcome["you"]["id"]
                for _ in range(26):
                    await ws.send(json.dumps({"type": "shoot", "weapon": "ak47",
                                              "yaw": 0.0, "pitch": 0.0}))
                    await asyncio.sleep(0.27)
                saw_reloading = False
                saw_progress_increase = False
                prev_prog = -1.0
                refilled = False
                end = time.time() + 4.0
                while time.time() < end:
                    try:
                        m = await _recv_json(ws, timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    if m.get("type") != "state":
                        continue
                    for pl in (m.get("players") or []):
                        if pl["id"] != you_id:
                            continue
                        if pl.get("reloading"):
                            saw_reloading = True
                            rp = float(pl.get("reload_progress", 0))
                            if rp > prev_prog:
                                saw_progress_increase = True
                            prev_prog = rp
                        if pl.get("ammo") == 25 and not pl.get("reloading"):
                            refilled = True
                    if refilled:
                        break
                assert saw_reloading, "never saw reloading=true"
                assert saw_progress_increase, "reload_progress did not increase"
                assert refilled, "ammo did not refill to 25 after reload"
        asyncio.run(run())

    def test_manual_reload_starts_when_not_full(self):
        async def run():
            _, token = _register(f"c_{uuid.uuid4().hex[:6]}")
            url = f"{LOCAL_WS}/api/ws/game?token={token}&mode=casual"
            async with websockets.connect(url, ping_interval=None) as ws:
                welcome = await _wait_welcome(ws)
                you_id = welcome["you"]["id"]
                await ws.send(json.dumps({"type": "shoot", "weapon": "ak47",
                                          "yaw": 0.0, "pitch": 0.0}))
                await asyncio.sleep(0.4)
                await ws.send(json.dumps({"type": "reload", "weapon": "ak47"}))
                saw_reloading = False
                end = time.time() + 2.5
                while time.time() < end:
                    try:
                        m = await _recv_json(ws, timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    if m.get("type") != "state":
                        continue
                    for pl in (m.get("players") or []):
                        if pl["id"] == you_id and pl.get("reloading"):
                            saw_reloading = True
                            break
                    if saw_reloading:
                        break
                assert saw_reloading, "manual reload did not set reloading=true"
        asyncio.run(run())


# ---------- Hit events ----------
class TestHitEvents:
    def test_hit_event_has_body_part_damage_headshot(self):
        async def run():
            _, token = _register(f"h_{uuid.uuid4().hex[:6]}")
            url = f"{LOCAL_WS}/api/ws/game?token={token}&mode=casual"
            async with websockets.connect(url, ping_interval=None) as ws:
                welcome = await _wait_welcome(ws)
                you = welcome["you"]
                you_id = you["id"]
                # Wait for spawn invuln to expire (3s) so our hits register
                await asyncio.sleep(3.2)
                bots = []
                t_end = time.time() + 3.0
                while time.time() < t_end:
                    try:
                        m = await _recv_json(ws, timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    if m.get("type") == "state" and m.get("players"):
                        bots = [p for p in m["players"]
                                if p.get("is_bot") and p.get("alive")
                                and not p.get("invuln")]
                        if bots:
                            break
                assert bots, "no non-invuln bots present"
                target = bots[0]
                my_x, my_z = you["x"], you["z"]

                saw_hit = False
                hit_event = None
                for _ in range(60):
                    # Re-aim each iteration toward most-recent target pos
                    ddx = target["x"] - my_x
                    ddz = target["z"] - my_z
                    yaw = math.atan2(ddx, -ddz)
                    d = math.hypot(ddx, ddz)
                    # Move closer if far (server clamps to 1.2 per input)
                    if d > 4.0:
                        step = 1.0 / d
                        my_x += ddx * step
                        my_z += ddz * step
                    await ws.send(json.dumps({"type": "input", "x": my_x, "z": my_z,
                                              "yaw": yaw, "pitch": 0.0}))
                    await ws.send(json.dumps({"type": "shoot", "weapon": "ak47",
                                              "yaw": yaw, "pitch": 0.0}))
                    end = time.time() + 0.3
                    while time.time() < end:
                        try:
                            m = await _recv_json(ws, timeout=0.25)
                        except asyncio.TimeoutError:
                            break
                        if m.get("type") != "state":
                            continue
                        for ev in (m.get("events") or []):
                            if ev.get("type") == "hit" and ev.get("shooter_id") == you_id:
                                hit_event = ev
                                saw_hit = True
                                break
                        for p in m.get("players", []):
                            if p["id"] == target["id"]:
                                target = p
                        if saw_hit:
                            break
                    if saw_hit:
                        break
                    await asyncio.sleep(0.27)
                assert saw_hit, "did not register a hit on any bot"
                assert hit_event.get("body_part") in ("head", "torso", "legs"), hit_event
                assert isinstance(hit_event.get("damage"), int), hit_event
                assert hit_event["damage"] > 0
                assert "headshot" in hit_event, hit_event
        asyncio.run(run())
