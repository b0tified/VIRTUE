"""Ranked early-leave penalty tests.

When a real player disconnects from an in-progress ranked match,
`GameRoom.remove` stamps `ranked_ban_until = now + 10min` on their
user doc via `_apply_ranked_leave_penalty`. The `/queue/ranked`
endpoint then 403s while the ban is active (with the remaining
seconds in the error detail). Pre-match countdown leaves + post-match
intermission leaves are exempt — only ACTIVELY-LIVE ranked rooms
penalize.
"""
import sys
import pathlib
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


class _FakeUsers:
    def __init__(self):
        self.updates = []
    async def update_one(self, filt, ops):
        self.updates.append((dict(filt), {k: dict(v) for k, v in ops.items()}))


class _FakePlayer:
    def __init__(self, pid, is_bot=False):
        self.id = pid
        from collections import deque
        self.user_id = None if is_bot else f"u_{pid}"
        self.username = pid
        self.is_bot = is_bot
        self.is_spectator = False
        self.is_loaded = bool(is_bot)
        self.ws = None
        self.alive = True
        self.x = 0.0; self.y = 0.0; self.z = 0.0
        self.pos_history = deque(maxlen=16)


def _make_ranked_room(monkeypatch):
    r = server.GameRoom()
    r.is_ranked = True
    r.match_started = True
    r.in_intermission = False
    # No-op broadcast — tests don't care about chat fanout.
    async def fake_broadcast(_):
        pass
    r.broadcast = fake_broadcast
    fake_users = _FakeUsers()
    monkeypatch.setattr(server.db, "users", fake_users)
    return r, fake_users


@pytest.mark.asyncio
async def test_leaving_live_ranked_match_stamps_ban(monkeypatch):
    r, fake_users = _make_ranked_room(monkeypatch)
    # Patch ObjectId to a passthrough so we don't need a real 24-hex id.
    monkeypatch.setattr(server, "ObjectId", lambda s: s)
    p = _FakePlayer("alice")
    r.players = {p.id: p}
    await r.remove(p)
    # First write must carry both the ban timestamp AND the -30 RP $inc.
    target = next(u for u in fake_users.updates if "ranked_ban_until" in u[1].get("$set", {}))
    ban_until = target[1]["$set"]["ranked_ban_until"]
    now = datetime.now(timezone.utc)
    delta = (ban_until - now).total_seconds()
    expected = server.RANKED_LEAVE_BAN_MINUTES * 60
    assert abs(delta - expected) < 10, f"ban delta {delta}s vs expected {expected}s"
    assert target[1]["$set"].get("ranked_ban_reason") == "left_match"
    # Verify the $inc deducts the configured RP loss (default 30).
    assert target[1].get("$inc", {}).get("rank_points") == -server.RANKED_LEAVE_RP_LOSS
    # And a second write should be the floor-at-0 follow-up, scoped
    # to docs where rank_points went negative.
    floor_writes = [u for u in fake_users.updates if u[0].get("rank_points") == {"$lt": 0}]
    assert len(floor_writes) == 1
    assert floor_writes[0][1]["$set"]["rank_points"] == 0


@pytest.mark.asyncio
async def test_leaving_during_intermission_does_not_ban(monkeypatch):
    r, fake_users = _make_ranked_room(monkeypatch)
    monkeypatch.setattr(server, "ObjectId", lambda s: s)
    r.in_intermission = True  # post-match victory screen state
    p = _FakePlayer("bob")
    r.players = {p.id: p}
    await r.remove(p)
    assert all(
        "ranked_ban_until" not in u[1].get("$set", {})
        for u in fake_users.updates
    )


@pytest.mark.asyncio
async def test_leaving_during_prematch_freeze_does_not_ban(monkeypatch):
    r, fake_users = _make_ranked_room(monkeypatch)
    monkeypatch.setattr(server, "ObjectId", lambda s: s)
    r.match_started = False  # still in 3-2-1 countdown
    p = _FakePlayer("carol")
    r.players = {p.id: p}
    await r.remove(p)
    assert all(
        "ranked_ban_until" not in u[1].get("$set", {})
        for u in fake_users.updates
    )


@pytest.mark.asyncio
async def test_leaving_casual_does_not_ban(monkeypatch):
    r, fake_users = _make_ranked_room(monkeypatch)
    monkeypatch.setattr(server, "ObjectId", lambda s: s)
    r.is_ranked = False  # casual room
    p = _FakePlayer("dan")
    r.players = {p.id: p}
    await r.remove(p)
    assert all(
        "ranked_ban_until" not in u[1].get("$set", {})
        for u in fake_users.updates
    )


@pytest.mark.asyncio
async def test_bot_disconnect_never_bans(monkeypatch):
    r, fake_users = _make_ranked_room(monkeypatch)
    monkeypatch.setattr(server, "ObjectId", lambda s: s)
    bot = _FakePlayer("aux_bot", is_bot=True)
    r.players = {bot.id: bot}
    await r.remove(bot)
    assert fake_users.updates == []


def test_public_user_exposes_ranked_ban_seconds():
    """`public_user` carries `ranked_ban_seconds` so the lobby can
    render a countdown without a separate endpoint. 0 when unbanned."""
    # Unbanned baseline.
    u = {
        "_id": "u1", "email": "a@b.com", "username": "a",
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "rank_points": 0,
    }
    out = server.public_user(u)
    assert out["ranked_ban_seconds"] == 0
    # Banned for ~5 minutes.
    u["ranked_ban_until"] = datetime.now(timezone.utc) + timedelta(minutes=5)
    out = server.public_user(u)
    assert 270 <= out["ranked_ban_seconds"] <= 310, out["ranked_ban_seconds"]
    # Expired ban → reported as 0 (we don't surface negatives).
    u["ranked_ban_until"] = datetime.now(timezone.utc) - timedelta(minutes=1)
    out = server.public_user(u)
    assert out["ranked_ban_seconds"] == 0
