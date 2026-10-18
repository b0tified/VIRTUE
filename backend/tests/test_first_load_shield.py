import asyncio
import time
from bson import ObjectId

import server

LOOP = asyncio.new_event_loop()


def _user():
    return {"_id": ObjectId(), "email": "shield@test.com", "username": "shieldtest", "stats": {}}


async def _joined(room):
    p = server.Player(None, _user())
    await room.add(p)
    room.match_started = True
    return p


def test_first_load_shield_survives_movement_and_ends_on_shot():
    async def run():
        room = server.GameRoom(is_ranked=False)
        p = await _joined(room)
        assert p.spawn_shield and p.invuln_until > time.time() + 9
        await room.handle_message(p, {"type": "input", "x": p.x + 0.3, "z": p.z, "yaw": 0, "pitch": 0})
        assert p.invuln_until > time.time() + 8
        await room.handle_message(p, {"type": "shoot", "yaw": 0, "pitch": 0})
        assert p.invuln_until == 0.0
    LOOP.run_until_complete(run())


def test_shield_restarts_when_countdown_ends():
    async def run():
        room = server.GameRoom(is_ranked=False)
        p = server.Player(None, _user())
        await room.add(p)
        room.match_started = False
        async def _noop(*a, **k):
            return None
        room.broadcast = _noop
        p.invuln_until = time.time() + 1
        await room._begin_match_now()
        assert p.invuln_until > time.time() + 9
    LOOP.run_until_complete(run())


def test_no_first_load_shield_in_practice():
    async def run():
        room = server.GameRoom(is_ranked=False)
        room.is_offline = True
        p = await _joined(room)
        assert not p.spawn_shield and p.invuln_until < time.time() + 4
    LOOP.run_until_complete(run())
