import asyncio
import server as srv


def test_profile_matches_lobby_rank():
    async def run():
        name = srv.DISGUISED_BOT_NAMES[3]
        room = srv.GameRoom(is_ranked=True, match_duration=60.0)
        for tier in (2, 6):
            bot = room.spawn_bot(name, disguised=True, disguise_tier_idx=tier)
            await asyncio.sleep(0.3)
            prof = await srv.public_profile(bot.username, _user={"_id": "viewer"})
            assert prof["rank_points"] == bot.disguise_rank_points
            assert prof["rank_tier"] == bot.rank_tier
            assert prof["level"] == bot.level
        await srv.db.bot_identity.delete_one({"_id": name.lower()})
    asyncio.run(run())
