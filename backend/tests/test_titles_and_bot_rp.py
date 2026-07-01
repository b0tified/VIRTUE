"""Past-season peak-rank title + bot RP snap tests.

Two 2026-07-01 features under test:
  1. `maybe_reset_season` stamps a `past_seasons[]` entry on every user
     with `rank_points > 0` at rollover: `{season, tier, tier_name, rp}`.
     The user can then pick which one to display via
     `POST /profile/me/title` and it renders as "S2 · DIAMOND" alongside
     their banner.
  2. `Room.spawn_bot(disguised=True, ...)` now snaps every disguise RP
     to the ranked match grid (multiples of 15) so bot RP numbers match
     what real players would see on the leaderboard.
"""
import sys
import pathlib
from datetime import datetime, timezone, timedelta

import pytest
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


# ─────────────────────────────────────────────────────────────────────
# Bot RP snapping
# ─────────────────────────────────────────────────────────────────────
class _RoomStub:
    """Minimal shim that exercises `spawn_bot`'s RP-assignment logic
    without pulling in the full Room class (which owns matchmaking +
    tick loops + team assignment). Uses the same `spawn_bot` method by
    name-binding the function to the stub. This keeps the test purely
    focused on the RP-snap behaviour."""
    def __init__(self):
        self.arena = server.MAP_A   # any map works
        self.players = {}
        self.game_mode = "ffa"
        self.tdm_team_size = 3

    # spawn_bot expects a few internal helpers on the Room —
    # `_assign_team` (no-op in FFA) and access to `self.players`.
    def _assign_team(self, p):
        p.team = None


def _bind_spawn_bot(stub):
    """Attach the real `spawn_bot` method to our stub instance so it
    runs against the stub's players dict."""
    from types import MethodType
    stub.spawn_bot = MethodType(server.GameRoom.spawn_bot, stub)


def test_ranked_bot_disguise_rp_is_snapped_to_grid():
    """Bots spawned into a ranked room MUST have RP that's a multiple
    of 15 — matches the ranked match delta grid so a real player
    couldn't tell the disguised bot's RP apart from any live player's."""
    stub = _RoomStub()
    _bind_spawn_bot(stub)
    # Try every real tier 0..6 (Goonmaster/7 is a special one-off).
    for tier in range(7):
        for _ in range(30):
            bot = stub.spawn_bot(
                "test", disguised=True, difficulty=1.0,
                disguise_tier_idx=tier,
            )
            pts = bot.disguise_rank_points
            assert pts % 15 == 0, f"tier {tier}: got RP {pts}, expected multiple of 15"


def test_ranked_bot_disguise_rp_stays_inside_tier_band():
    """After snapping we must still land inside the tier's band so
    the rank icon matches the RP."""
    stub = _RoomStub()
    _bind_spawn_bot(stub)
    for tier in range(7):
        low = server.RANK_TIERS[tier][0]
        high = (server.RANK_TIERS[tier + 1][0] - 1) if (tier + 1 < len(server.RANK_TIERS)) else (low + 400)
        for _ in range(30):
            bot = stub.spawn_bot(
                "test", disguised=True, difficulty=1.0,
                disguise_tier_idx=tier,
            )
            pts = bot.disguise_rank_points
            assert low <= pts <= high, (
                f"tier {tier}: got RP {pts}, expected inside [{low}, {high}]"
            )
            # And the resolved tier idx must match the requested one.
            resolved_ti, _ = server.rank_for_points(pts)
            assert resolved_ti == tier


def test_casual_bot_disguise_rp_is_also_snapped():
    """Casual (no tier requested) disguises still get their RP snapped
    to the match grid — same rationale, just no tier-band constraint."""
    stub = _RoomStub()
    _bind_spawn_bot(stub)
    for _ in range(100):
        bot = stub.spawn_bot("test", disguised=True, difficulty=1.0)
        # Casual disguises store RP too — must be grid-aligned.
        pts = bot.disguise_rank_points
        assert pts % 15 == 0


def test_player_aligned_disguise_rp_is_snapped():
    """The player-aligned path (± 20 RP jitter around the queuing
    player) should also snap to the grid."""
    stub = _RoomStub()
    _bind_spawn_bot(stub)
    for player_rp in (450, 810, 1230, 1720):
        tier_idx, _ = server.rank_for_points(player_rp)
        for _ in range(30):
            bot = stub.spawn_bot(
                "test", disguised=True, difficulty=1.0,
                disguise_tier_idx=tier_idx,
                disguise_rank_points=player_rp,
            )
            assert bot.disguise_rank_points % 15 == 0


# ─────────────────────────────────────────────────────────────────────
# Past-season title endpoint
# ─────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_set_title_rejects_seasons_the_user_did_not_finish():
    """The endpoint must 404 when the user tries to equip a season
    that's not in their past_seasons list — otherwise a naughty client
    could just POST `{season: 99}` and self-award "SEASON 99 · GOONMASTER"."""
    if server.db is None:
        pytest.skip("No mongo")
    marker = "titletest"
    doc = {
        "_id": ObjectId(),
        "email": "tt@t.test",
        "username": "tt_user",
        "password_hash": "x",
        "past_seasons": [
            {"season": 1, "tier": 3, "tier_name": "PLATINUM", "rp": 620},
        ],
        "_test_marker": marker,
    }
    await server.db.users.insert_one(doc)
    try:
        # Legitimate season → 200.
        out = await server.set_title(
            server.TitleIn(season=1),  # type: ignore
            user=doc,
        )
        assert out.get("title_season") == 1
        # Bogus season → 404.
        try:
            await server.set_title(
                server.TitleIn(season=99),
                user=doc,
            )
            raise AssertionError("expected HTTPException 404")
        except server.HTTPException as e:
            assert e.status_code == 404
        # Clearing (None) → 200 with title_season=None.
        out = await server.set_title(
            server.TitleIn(season=None),
            user=doc,
        )
        assert out.get("title_season") is None
    finally:
        await server.db.users.delete_many({"_test_marker": marker})


@pytest.mark.asyncio
async def test_public_user_exposes_past_seasons_and_title_season():
    """The `public_user` DTO used by /auth/me + friend endpoints must
    include past_seasons + title_season so the client can render the
    banner title text and populate the picker."""
    user = {
        "_id": ObjectId(),
        "email": "pu@t.test",
        "username": "pu",
        "past_seasons": [
            {"season": 1, "tier": 4, "tier_name": "DIAMOND", "rp": 900},
            {"season": 2, "tier": 6, "tier_name": "GRANDMASTER", "rp": 1900},
        ],
        "title_season": 2,
        "stats": {"kills": 10, "deaths": 5, "matches": 8, "wins": 4},
        "rank_points": 400,
    }
    out = server.public_user(user)
    assert out["past_seasons"] == user["past_seasons"]
    assert out["title_season"] == 2
