import asyncio
from datetime import datetime, timedelta, timezone
from bson import ObjectId

import server

LOOP = asyncio.new_event_loop()


def test_match_coin_reward_formula_and_multiplier():
    server.COIN_CONFIG.update(server.COIN_CONFIG_DEFAULTS)
    assert server.match_coin_reward(5, False) == 10 + 5 * 2
    assert server.match_coin_reward(5, True) == 10 + 10 + 25
    assert server.match_coin_reward(999, False) == 10 + 30 * 2
    server.COIN_CONFIG["multiplier"] = 2.0
    assert server.match_coin_reward(0, False) == 20
    server.COIN_CONFIG["multiplier_until"] = 1.0
    assert server.coin_multiplier() == 1.0
    server.COIN_CONFIG.update(server.COIN_CONFIG_DEFAULTS)


def test_daily_streak_state():
    today = datetime.now(timezone.utc).date()
    assert server._daily_state({})["next_day"] == 1
    y = (today - timedelta(days=1)).isoformat()
    assert server._daily_state({"daily_last_claim": y, "daily_streak": 3})["next_day"] == 4
    assert server._daily_state({"daily_last_claim": y, "daily_streak": 7})["next_day"] == 1
    old = (today - timedelta(days=3)).isoformat()
    assert server._daily_state({"daily_last_claim": old, "daily_streak": 5})["next_day"] == 1
    assert server._daily_state({"daily_last_claim": today.isoformat(), "daily_streak": 2})["claimable"] is False


def test_casual_match_end_awards_coins():
    async def run():
        uid = ObjectId()
        await server.db.users.insert_one({"_id": uid, "email": f"coin_{uid}@t.com", "username": f"coin{str(uid)[-5:]}", "coins": 0, "stats": {}})
        try:
            room = server.GameRoom(is_ranked=False)
            sent = []
            async def _bc(msg, *a, **k):
                sent.append(msg)
            room.broadcast = _bc
            room._send = lambda *a, **k: asyncio.sleep(0)
            p = server.Player(None, await server.db.users.find_one({"_id": uid}))
            room.players[p.id] = p
            p.kills = 4
            for b in list(room.players.values()):
                if b.is_bot:
                    b.kills = 0
            room.game_mode = "ffa"
            try:
                await asyncio.wait_for(room.end_match(), timeout=5)
            except asyncio.TimeoutError:
                pass
            doc = await server.db.users.find_one({"_id": uid})
            assert doc["coins"] == 10 + 4 * 2 + 25
        finally:
            await server.db.users.delete_one({"_id": uid})
            await server.db.match_history.delete_many({"user_id": str(uid)})
    LOOP.run_until_complete(run())
