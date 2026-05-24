from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import asyncio
import json
import logging
import math
import random
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

import bcrypt
import jwt
from bson import ObjectId
from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# -------------------------------------------------------------------
# Setup
# -------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("shooter")

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_ALGORITHM = "HS256"
ACCESS_TTL_MIN = 60 * 24
REFRESH_TTL_DAYS = 7
SEASON_LENGTH_DAYS = 14

app = FastAPI()
api = APIRouter(prefix="/api")


# Track fire-and-forget background tasks (DB stat updates etc.) so they aren't
# garbage-collected mid-await. asyncio holds only weak refs to tasks created
# via create_task — without this, occasional `Task was destroyed` warnings can
# silently drop kill/death increments.
_BG_TASKS: set = set()


def _bg(awaitable):
    """Fire-and-forget a non-critical DB write so it doesn't stall the tick.
    Accepts either a coroutine OR an asyncio.Future (newer Motor versions
    return the latter from update_one/find_one/etc.). The previous version
    only accepted coroutines and crashed the tick on every kill event."""
    try:
        if asyncio.iscoroutine(awaitable):
            t = asyncio.create_task(awaitable)
        elif isinstance(awaitable, asyncio.Future):
            # asyncio.ensure_future wraps the existing Future into a Task
            # we can track + cancel. Pass-through if already a Task.
            t = asyncio.ensure_future(awaitable)
        else:
            return  # unknown awaitable type — nothing to do
        _BG_TASKS.add(t)
        t.add_done_callback(_BG_TASKS.discard)
    except RuntimeError:
        # No running event loop (shouldn't happen in normal flow).
        pass


# -------------------------------------------------------------------
# Helpers - Auth
# -------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MIN),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TTL_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str, remember: bool = True):
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax",
                        max_age=ACCESS_TTL_MIN * 60, path="/")
    # When remember=False, omit max_age so the refresh cookie becomes a session
    # cookie (browser clears it when the tab/browser closes).
    if remember:
        response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax",
                            max_age=REFRESH_TTL_DAYS * 86400, path="/")
    else:
        response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax",
                            path="/")


def compute_level(stats: dict) -> dict:
    """XP + level from kills/wins/matches. Mirrors /app/frontend/src/game/level.js.
    `stats.bonus_xp` is added on top — granted by redeemed promo codes etc."""
    k = int(stats.get("kills", 0) or 0)
    w = int(stats.get("wins", 0) or 0)
    m = int(stats.get("matches", 0) or 0)
    bonus = int(stats.get("bonus_xp", 0) or 0)
    xp = k * 10 + w * 50 + m * 25 + bonus
    level = 1
    accumulated = 0
    while level < 100:
        need = 50 * level * (level + 1)
        if accumulated + need > xp:
            break
        accumulated += need
        level += 1
    xp_for_next = 50 * level * (level + 1)
    xp_into = xp - accumulated
    return {"xp": xp, "level": level, "xp_into_level": xp_into, "xp_for_next": xp_for_next}


def public_user(user: dict) -> dict:
    points = int(user.get("rank_points", 0) or 0)
    peak = int(user.get("peak_rank_points", points) or points)
    if points > peak:
        peak = points
    peak_idx, peak_name = rank_for_points(peak)
    tier_idx, tier_name = rank_for_points(points)
    placement_played = int(user.get("placement_matches_played", 0) or 0)
    stats = user.get("stats", {"kills": 0, "deaths": 0, "matches": 0, "wins": 0})
    lvl = compute_level(stats)
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "username": user.get("username", user["email"].split("@")[0]),
        "role": user.get("role", "user"),
        "avatar": int(user.get("avatar", 0) or 0),
        "banner_icon": int(user.get("banner_icon", 0) or 0),
        "banner_color": int(user.get("banner_color", 0) or 0),
        "banner_animated": bool(user.get("banner_animated", False)),
        "stats": stats,
        "level": lvl["level"],
        "xp": lvl["xp"],
        "xp_into_level": lvl["xp_into_level"],
        "xp_for_next": lvl["xp_for_next"],
        "rank_points": points,
        "rank_tier": tier_idx,
        "rank_name": tier_name,
        "peak_rank_points": peak,
        "peak_rank_tier": peak_idx,
        "peak_rank_name": peak_name,
        "placement_matches_played": placement_played,
        "placement_matches_total": PLACEMENT_MATCHES,
        "in_placements": placement_played < PLACEMENT_MATCHES,
        "created_at": user.get("created_at").isoformat() if isinstance(user.get("created_at"), datetime) else user.get("created_at"),
    }


# -------------------------------------------------------------------
# Season (rank reset every 14 days)
# -------------------------------------------------------------------
async def get_or_init_season() -> dict:
    """Return the current season doc, initializing it on first run."""
    doc = await db.meta.find_one({"_id": "season"})
    now = datetime.now(timezone.utc)
    if not doc:
        doc = {"_id": "season", "season_number": 1, "season_start": now}
        await db.meta.insert_one(doc)
    return doc


async def maybe_reset_season() -> dict:
    """If the season has elapsed, reset ranks for everyone and bump season number."""
    doc = await get_or_init_season()
    start = doc.get("season_start")
    if isinstance(start, datetime) and start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    ends_at = start + timedelta(days=SEASON_LENGTH_DAYS)
    if now >= ends_at:
        next_num = int(doc.get("season_number", 1)) + 1
        # Snapshot current rank into peak_rank_points (only if higher), then reset.
        await db.users.update_many(
            {"rank_points": {"$exists": True}},
            [{
                "$set": {
                    "peak_rank_points": {
                        "$max": [
                            {"$ifNull": ["$peak_rank_points", 0]},
                            {"$ifNull": ["$rank_points", 0]},
                        ]
                    },
                    "rank_points": 0,
                    "placement_matches_played": 0,
                }
            }],
        )
        await db.meta.update_one(
            {"_id": "season"},
            {"$set": {"season_number": next_num, "season_start": now}},
        )
        logger.info("Season reset → S%d", next_num)
        doc = {"_id": "season", "season_number": next_num, "season_start": now}
    return doc


def season_payload(doc: dict) -> dict:
    start = doc.get("season_start")
    if isinstance(start, datetime) and start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    ends_at = start + timedelta(days=SEASON_LENGTH_DAYS)
    now = datetime.now(timezone.utc)
    seconds_left = max(0, int((ends_at - now).total_seconds()))
    return {
        "season_number": int(doc.get("season_number", 1)),
        "season_start": start.isoformat() if start else None,
        "season_ends_at": ends_at.isoformat(),
        "seconds_left": seconds_left,
        "length_days": SEASON_LENGTH_DAYS,
    }


RANK_TIERS = [
    (0,    "BRONZE"),
    (100,  "SILVER"),
    (250,  "GOLD"),
    (500,  "PLATINUM"),
    (800,  "DIAMOND"),
    (1200, "MASTER"),
    (1700, "GRANDMASTER"),
    (2300, "GOONMASTER"),
]


def rank_for_points(points: int):
    idx = 0
    name = RANK_TIERS[0][1]
    for i, (threshold, n) in enumerate(RANK_TIERS):
        if points >= threshold:
            idx = i
            name = n
    return idx, name


async def _user_from_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        return user
    except Exception:
        return None


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await _user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


# -------------------------------------------------------------------
# Schemas
# -------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)
    username: str = Field(min_length=2, max_length=20)


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    remember: bool = True


# -------------------------------------------------------------------
# Startup
# -------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username")
    await db.match_history.create_index([("user_id", 1), ("ended_at", -1)])
    # Friendships: bidirectional pair, status in {pending,accepted,blocked}.
    # Pending: `from_user_id` sent the request; `to_user_id` must accept.
    await db.friendships.create_index([("from_user_id", 1), ("to_user_id", 1)], unique=True)
    await db.friendships.create_index("to_user_id")
    await db.friendships.create_index("from_user_id")
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@shooter.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "username": "Admin",
            "role": "admin",
            "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded admin user")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    # Casual / quick-match bots wear human-looking names and disguise as real
    # players (no BOT badge, no -bot platform). Pick a stable random set.
    for name in random.sample(DISGUISED_BOT_NAMES, NUM_BOTS):
        game_room.spawn_bot(name, disguised=True, difficulty=1.1)
    ranked_room.spawn_bot(BOT_NAMES[0] + "-R", disguised=True, difficulty=1.4)
    # Practice room: 2 docile dummy bots that don't shoot back (max_hp low).
    for name in ["DUMMY-A", "DUMMY-B"]:
        b = practice_room.spawn_bot(name)
        if b is not None:
            b.is_dummy = True
            b.max_hp = 50
            b.hp = 50

    # Initialize season metadata (rank reset every 14 days)
    await get_or_init_season()
    await maybe_reset_season()

    asyncio.create_task(game_room.run())
    asyncio.create_task(ranked_room.run())
    asyncio.create_task(practice_room.run())
    asyncio.create_task(matchmaker_loop())
    asyncio.create_task(season_loop())
    asyncio.create_task(synthetic_online_loop())


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# -------------------------------------------------------------------
# Auth routes
# -------------------------------------------------------------------
@api.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "username": payload.username,
        "role": "user",
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.users.insert_one(doc)
    user = await db.users.find_one({"_id": res.inserted_id})
    access = create_access_token(str(user["_id"]), user["email"])
    refresh = create_refresh_token(str(user["_id"]))
    set_auth_cookies(response, access, refresh)
    return {"user": public_user(user), "access_token": access}


@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(str(user["_id"]), user["email"])
    refresh = create_refresh_token(str(user["_id"]))
    set_auth_cookies(response, access, refresh, remember=bool(payload.remember))
    return {"user": public_user(user), "access_token": access}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


class GoogleCallbackIn(BaseModel):
    session_id: str


@api.post("/auth/google/callback")
async def google_callback(payload: GoogleCallbackIn, response: Response):
    """Exchanges an Emergent OAuth session_id for our normal JWT.
    Creates the user if their Google email is new.
    REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    """
    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": payload.session_id},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as r:
                if r.status != 200:
                    raise HTTPException(status_code=401, detail="Invalid session")
                data = await r.json()
    except aiohttp.ClientError as e:
        logger.warning("Emergent OAuth fetch failed: %s", e)
        raise HTTPException(status_code=502, detail="Auth provider unreachable")

    email = (data.get("email") or "").lower()
    name = data.get("name") or email.split("@")[0]
    if not email:
        raise HTTPException(status_code=401, detail="Google profile missing email")

    user = await db.users.find_one({"email": email})
    if not user:
        # Use a unique-ish username; if the chosen one collides, append suffix.
        base_username = (name.split(" ")[0] if name else email.split("@")[0]).strip()[:24] or "Player"
        username = base_username
        suffix = 1
        while await db.users.find_one({"username": username}):
            suffix += 1
            username = f"{base_username}{suffix}"
        doc = {
            "email": email,
            "username": username,
            "password_hash": "",  # Google-only user — no password
            "role": "user",
            "google": True,
            "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
            "rank_points": 0,
            "created_at": datetime.now(timezone.utc),
        }
        res = await db.users.insert_one(doc)
        user = await db.users.find_one({"_id": res.inserted_id})

    access = create_access_token(str(user["_id"]), user["email"])
    refresh = create_refresh_token(str(user["_id"]))
    set_auth_cookies(response, access, refresh)
    return {"user": public_user(user), "access_token": access}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@api.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    tok = request.cookies.get("refresh_token")
    if not tok:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(tok, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        access = create_access_token(str(user["_id"]), user["email"])
        response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax",
                            max_age=ACCESS_TTL_MIN * 60, path="/")
        return {"access_token": access}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


# -------------------------------------------------------------------
# Stats / Leaderboard
# -------------------------------------------------------------------
@api.get("/leaderboard")
async def leaderboard():
    cursor = db.users.find({}, {"_id": 0, "username": 1, "rank_points": 1, "stats": 1, "email": 1}).sort([("rank_points", -1), ("stats.kills", -1)]).limit(50)
    rows = []
    async for u in cursor:
        s = u.get("stats", {})
        kills = s.get("kills", 0)
        pts = int(u.get("rank_points", 0) or 0)
        idx, name = rank_for_points(pts)
        rows.append({
            "username": u.get("username", u.get("email", "anon")),
            "kills": kills,
            "deaths": s.get("deaths", 0),
            "matches": s.get("matches", 0),
            "rank_points": pts,
            "rank_tier": idx,
            "rank_name": name,
        })
    return rows


@api.get("/profile/me")
async def profile_me(user: dict = Depends(get_current_user)):
    return public_user(user)


class AvatarIn(BaseModel):
    avatar: int = Field(ge=0, le=8)


# Banner customization — 8 icons × 8 colors, displayed on the profile card.
class BannerIn(BaseModel):
    banner_icon: int = Field(ge=0, le=7)
    banner_color: int = Field(ge=0, le=7)
    banner_animated: bool = False


@api.post("/profile/me/banner")
async def set_banner(payload: BannerIn, user: dict = Depends(get_current_user)):
    # Animated banner is gated: Level 10+ OR peak rank tier >= 2 (Gold).
    if payload.banner_animated:
        stats = user.get("stats", {})
        lvl = compute_level(stats)["level"]
        peak_pts = int(user.get("peak_rank_points", user.get("rank_points", 0)) or 0)
        peak_tier, _ = rank_for_points(peak_pts)
        if lvl < 10 and peak_tier < 2:
            raise HTTPException(status_code=403, detail="Animated banner unlocks at Level 10 or Gold peak rank.")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "banner_icon": payload.banner_icon,
            "banner_color": payload.banner_color,
            "banner_animated": payload.banner_animated,
        }},
    )
    user["banner_icon"] = payload.banner_icon
    user["banner_color"] = payload.banner_color
    user["banner_animated"] = payload.banner_animated
    return public_user(user)


@api.post("/profile/me/avatar")
async def set_avatar(payload: AvatarIn, user: dict = Depends(get_current_user)):
    # Animated avatars (idx 6, 7, 8) are gated by level OR peak rank.
    if payload.avatar >= 6:
        stats = user.get("stats", {})
        lvl = compute_level(stats)["level"]
        peak_pts = int(user.get("peak_rank_points", user.get("rank_points", 0)) or 0)
        peak_tier, _ = rank_for_points(peak_pts)
        gates = {
            6: {"level": 5,  "tier": 0},  # Flaming Skull
            7: {"level": 15, "tier": 4},  # Pulsing Diamond
            8: {"level": 25, "tier": 5},  # Swirling Lightning
        }
        g = gates[payload.avatar]
        if lvl < g["level"] and peak_tier < g["tier"]:
            raise HTTPException(
                status_code=403,
                detail=f"This avatar unlocks at Level {g['level']} or tier {g['tier']}.",
            )
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"avatar": payload.avatar}})
    user["avatar"] = payload.avatar
    return public_user(user)


@api.get("/profile/me/history")
async def profile_history(user: dict = Depends(get_current_user), limit: int = 10):
    """Last N matches for the current user (newest first). Includes mode, placement, kills/deaths, RP delta."""
    limit = max(1, min(50, int(limit)))
    user_id = str(user["_id"])
    cursor = db.match_history.find(
        {"user_id": user_id},
        {"_id": 0},
    ).sort([("ended_at", -1)]).limit(limit)
    rows = []
    async for m in cursor:
        ts = m.get("ended_at")
        rows.append({
            "mode": m.get("mode", "casual"),
            "kills": int(m.get("kills", 0)),
            "deaths": int(m.get("deaths", 0)),
            "placement": int(m.get("placement", 0)),
            "total_players": int(m.get("total_players", 0)),
            "rp_delta": int(m.get("rp_delta", 0)),
            "rank_points_after": int(m.get("rank_points_after", 0)),
            "rank_name_after": m.get("rank_name_after", "BRONZE"),
            "is_placement": bool(m.get("is_placement", False)),
            "ended_at": ts.isoformat() if isinstance(ts, datetime) else ts,
        })
    return rows


# -------------------------------------------------------------------
# Redeem Codes — promotional codes that grant XP / RP / cosmetics.
# Each code is one-time-per-user (tracked via user.redeemed_codes).
# -------------------------------------------------------------------
class RedeemIn(BaseModel):
    code: str

# Reward shape: {"xp": int, "rp": int, "banner_color": int, "banner_icon": int,
#                "banner_animated": bool, "label": "..."}.
# Codes are case-insensitive; matched against the uppercased value.
REDEEM_CODES: Dict[str, dict] = {
    "VIRTUE2026":  {"xp": 500,                       "label": "+500 XP — Launch Bonus"},
    "BLASTOFF":    {"rp": 75,                        "label": "+75 RP — Welcome Boost"},
    "COMICFAN":    {"xp": 250,                       "label": "+250 XP — Comic Fan"},
    "WELCOME":     {"xp": 150,                       "label": "+150 XP — Welcome to Virtue"},
    "RAINBOW":     {"banner_animated": True,         "label": "Animated Banner Unlock"},
    "FIRSTBLOOD":  {"xp": 100,                       "label": "+100 XP — First Blood"},
    "POW":         {"xp": 50,                        "label": "+50 XP — POW!"},
    "ZAP":         {"xp": 50,                        "label": "+50 XP — ZAP!"},
    "BOOM":        {"rp": 25,                        "label": "+25 RP — BOOM!"},
    # Instant level-5 skip — primarily exists to let players unlock Ranked
    # right away without grinding. `min_level` is a special reward type
    # handled below: it tops up bonus_xp so the player's total XP is at
    # least the threshold for that level.
    "RANKEDREADY": {"min_level": 5,                  "label": "Level 5 Unlocked — Ranked Ready!"},
}


def _xp_required_to_reach(target_level: int) -> int:
    """Accumulated XP needed to be exactly at the start of `target_level`.
    Mirrors the curve in compute_level/level.js: each rank N→N+1 costs
    50*N*(N+1)."""
    n = max(1, min(100, int(target_level)))
    return sum(50 * lv * (lv + 1) for lv in range(1, n))


@api.post("/codes/redeem")
async def redeem_code(payload: RedeemIn, user: dict = Depends(get_current_user)):
    # Normalize: codes are case-insensitive, whitespace-trimmed.
    code = (payload.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Enter a code.")
    reward = REDEEM_CODES.get(code)
    if not reward:
        raise HTTPException(status_code=404, detail="Invalid code.")
    redeemed = list(user.get("redeemed_codes", []) or [])
    if code in redeemed:
        raise HTTPException(status_code=409, detail="Code already redeemed.")
    # Apply the reward atomically. XP goes into stats.bonus_xp; RP into the
    # ranked-points pool (clamped to 7500 so a code can't shortcut someone
    # into Goonmaster — that tier is earned only).
    update_ops: Dict[str, dict] = {"$push": {"redeemed_codes": code}}
    if reward.get("xp"):
        update_ops.setdefault("$inc", {})["stats.bonus_xp"] = int(reward["xp"])
    # min_level: top up bonus_xp so the player's total XP reaches the start
    # of the requested level. No-op if they already qualify naturally.
    if reward.get("min_level"):
        stats = user.get("stats", {}) or {}
        cur_xp = (
            int(stats.get("kills", 0) or 0) * 10
            + int(stats.get("wins", 0) or 0) * 50
            + int(stats.get("matches", 0) or 0) * 25
            + int(stats.get("bonus_xp", 0) or 0)
        )
        target_xp = _xp_required_to_reach(int(reward["min_level"]))
        deficit = max(0, target_xp - cur_xp)
        if deficit > 0:
            update_ops.setdefault("$inc", {}).setdefault("stats.bonus_xp", 0)
            update_ops["$inc"]["stats.bonus_xp"] = (
                int(update_ops["$inc"].get("stats.bonus_xp", 0)) + deficit
            )
    if reward.get("rp"):
        cur_pts = int(user.get("rank_points", 0) or 0)
        rp_grant = min(int(reward["rp"]), max(0, 7500 - cur_pts))
        if rp_grant > 0:
            update_ops.setdefault("$inc", {})["rank_points"] = rp_grant
    sets: Dict[str, object] = {}
    if reward.get("banner_animated"):
        sets["banner_animated"] = True
    if reward.get("banner_color") is not None:
        sets["banner_color"] = int(reward["banner_color"])
    if reward.get("banner_icon") is not None:
        sets["banner_icon"] = int(reward["banner_icon"])
    if sets:
        update_ops.setdefault("$set", {}).update(sets)
    await db.users.update_one({"_id": user["_id"]}, update_ops)
    fresh = await db.users.find_one({"_id": user["_id"]})
    return {
        "ok": True,
        "reward": reward,
        "label": reward.get("label", "Reward granted"),
        "user": public_user(fresh) if fresh else None,
    }


# -------------------------------------------------------------------
# Arena
# -------------------------------------------------------------------
ARENA = {
    "size": 50,
    "obstacles": [
        # Center mega tower + ring of low platforms
        {"x": 0, "z": 0, "w": 6, "h": 8, "d": 6},
        {"x": 9, "z": 0, "w": 3, "h": 1.2, "d": 3},
        {"x": -9, "z": 0, "w": 3, "h": 1.2, "d": 3},
        {"x": 0, "z": 9, "w": 3, "h": 1.2, "d": 3},
        {"x": 0, "z": -9, "w": 3, "h": 1.2, "d": 3},

        # NE quadrant
        {"x": 18, "z": 14, "w": 4, "h": 3, "d": 8},
        {"x": 26, "z": 24, "w": 6, "h": 4, "d": 3},
        {"x": 14, "z": 28, "w": 3, "h": 5, "d": 3},
        {"x": 30, "z": 12, "w": 3, "h": 3, "d": 5},

        # SW quadrant
        {"x": -18, "z": -14, "w": 8, "h": 3, "d": 4},
        {"x": -26, "z": -24, "w": 3, "h": 4, "d": 8},
        {"x": -10, "z": -28, "w": 6, "h": 3, "d": 3},
        {"x": -30, "z": -12, "w": 3, "h": 3, "d": 5},

        # NW quadrant
        {"x": -18, "z": 14, "w": 4, "h": 5, "d": 4},
        {"x": -28, "z": 20, "w": 3, "h": 4, "d": 6},
        {"x": -5, "z": 22, "w": 10, "h": 3, "d": 3},
        {"x": -32, "z": 5, "w": 3, "h": 4, "d": 4},

        # SE quadrant
        {"x": 20, "z": -18, "w": 6, "h": 4, "d": 4},
        {"x": 28, "z": -22, "w": 3, "h": 5, "d": 8},
        {"x": 8, "z": -22, "w": 3, "h": 6, "d": 3},
        {"x": 32, "z": -5, "w": 3, "h": 4, "d": 4},

        # Outer screening walls (close to borders, leave gaps)
        {"x": -35, "z": 30, "w": 8, "h": 4, "d": 2},
        {"x": 35, "z": -30, "w": 8, "h": 4, "d": 2},
        {"x": -38, "z": -35, "w": 2, "h": 4, "d": 8},
        {"x": 38, "z": 35, "w": 2, "h": 4, "d": 8},

        # Small crates (barrels)
        {"x": 4, "z": 14, "w": 1.6, "h": 1.6, "d": 1.6},
        {"x": -4, "z": -14, "w": 1.6, "h": 1.6, "d": 1.6},
        {"x": 14, "z": -4, "w": 1.6, "h": 1.6, "d": 1.6},
        {"x": -14, "z": 4, "w": 1.6, "h": 1.6, "d": 1.6},

        # Perimeter / corner buildings (used to be visual-only client extras —
        # now collidable on both ends so players can't phase through them).
        {"x": 42, "z": 42, "w": 5, "h": 6, "d": 5},
        {"x": -42, "z": 42, "w": 5, "h": 7, "d": 5},
        {"x": 42, "z": -42, "w": 5, "h": 5, "d": 5},
        {"x": -42, "z": -42, "w": 5, "h": 8, "d": 5},
        {"x": 12, "z": 38, "w": 3, "h": 4, "d": 6},
        {"x": -12, "z": 38, "w": 3, "h": 5, "d": 6},
        {"x": 12, "z": -38, "w": 3, "h": 5, "d": 6},
        {"x": -12, "z": -38, "w": 3, "h": 4, "d": 6},
        {"x": 38, "z": 12, "w": 6, "h": 4, "d": 3},
        {"x": 38, "z": -12, "w": 6, "h": 5, "d": 3},
        {"x": -38, "z": 12, "w": 6, "h": 4, "d": 3},
        {"x": -38, "z": -12, "w": 6, "h": 6, "d": 3},
    ],
}

SPAWN_POINTS = [
    (35, 35), (-35, 35), (35, -35), (-35, -35),
    (0, 40), (0, -40), (40, 0), (-40, 0),
    (22, -2), (-22, 2),
]

PLAYER_RADIUS = 0.5
PLAYER_HEIGHT = 1.8
MAX_HP = 100
BOT_MAX_HP = 80
SHOT_DAMAGE = 25
LASER_DAMAGE = 8
BOT_SHOT_DAMAGE = 16
MELEE_DAMAGE = 200
MELEE_RANGE = 3.4
MELEE_CONE = 0.95
SHOT_RANGE = 100
SHOT_COOLDOWN_MS = 250
LASER_COOLDOWN_MS = 90
MELEE_COOLDOWN_MS = 600
BOT_SHOT_COOLDOWN_MS = 600
BOT_AIM_NOISE = 0.10
TICK_RATE = 20
NUM_BOTS = 3
RANKED_MIN_REAL_PLAYERS = 1
QUEUE_BOT_FILL_SEC = 45.0
QUEUE_BOT_FILL_SEC_HIGH = 120.0  # Master tier (5) and above wait longer
QUEUE_HIGH_TIER_MIN = 5  # tier index 5 = MASTER

# -------------------------------------------------------------------
# Overwatch-style weapon configs (hitscan + falloff + spread + reload)
# -------------------------------------------------------------------
WEAPON_CONFIGS = {
    "ak47":  {
        "damage": SHOT_DAMAGE,
        "cooldown_ms": SHOT_COOLDOWN_MS,
        "mag_size": 25,
        "reload_ms": 1500,
        "headshot_mult": 2.0,
        "legs_mult": 0.85,
        "falloff_start": 15.0,  # m — full damage before this
        "falloff_end": 40.0,    # m — 50% damage at/after this
        "min_damage_mult": 0.5,
        "spread_base": 0.005,   # rad
        "spread_per_shot": 0.030,
        "spread_max": 0.16,
        "spread_decay": 4.0,    # per second
        "ads_spread_mult": 0.25,
    },
    "laser": {
        "damage": LASER_DAMAGE,
        "dps": 60,                 # continuous beam — damage per second
        "cooldown_ms": LASER_COOLDOWN_MS,
        "mag_size": 60,
        "reload_ms": 1800,
        "headshot_mult": 1.5,
        "legs_mult": 0.9,
        "falloff_start": 25.0,
        "falloff_end": 70.0,
        "min_damage_mult": 0.6,
        "spread_base": 0.0,
        "spread_per_shot": 0.0,
        "spread_max": 0.0,
        "spread_decay": 1.0,
        "ads_spread_mult": 1.0,
    },
}


def weapon_cfg(name: str) -> dict:
    return WEAPON_CONFIGS.get(name, WEAPON_CONFIGS["ak47"])


def bot_fill_seconds_for_tier(tier_idx: int) -> float:
    # GOONMASTER (tier 7) is real-vs-real only — never bot-fill, queue stays
    # open until two same-tier players are found.
    if tier_idx >= 7:
        return float("inf")
    return QUEUE_BOT_FILL_SEC_HIGH if tier_idx >= QUEUE_HIGH_TIER_MIN else QUEUE_BOT_FILL_SEC


def bot_fill_seconds_for_tier_api(tier_idx: int) -> int:
    """JSON-safe version: returns -1 when the tier never bot-fills (e.g. Goonmaster)."""
    v = bot_fill_seconds_for_tier(tier_idx)
    return -1 if v == float("inf") else int(v)
BOT_NAMES = ["BLAZE-7", "VORTEX", "RAVEN-X", "GHOST-9", "TITAN", "CYPHER"]
# Casual-mode bots wear these human-looking names so they blend in.
DISGUISED_BOT_NAMES = [
    "n3onGhost42", "ShadowKnife", "BlitzReaper", "x_zenith_x", "PixelPunk",
    "Krypt0nite", "0verkill", "RogueByte", "FlareStorm", "VoltKid", "Mute_Echo",
    "QwiKshot", "redhatcat", "vp1r3lord", "TheSarcophagus",
]
# Tier-aligned bot name pools. As the player climbs the ladder, the bots
# they encounter use progressively longer / more "tryhard" handles — long
# emote names, smurf suffixes, streamer tags. Adds soul to the disguise.
TIERED_BOT_NAMES: Dict[int, List[str]] = {
    # Bronze — humble, slightly broken handles
    0: ["smallchunkz", "lagspike", "TumbleweedJoe", "FluffyPanic", "newbnoodle",
        "DustBunni", "potato_mode", "GrillMaster", "wallpeeker", "snorkelboy"],
    # Silver — typical mid-game gamer names
    1: ["RogueByte", "n3onGhost42", "BlitzReaper", "FlareStorm", "PixelPunk",
        "VoltKid", "ShadowKnife", "x_zenith_x", "RiptideRyan", "QwiKshot"],
    # Gold — more confident handles
    2: ["KryptoKid", "DOOMscroll", "0verkill", "ScopeDaddy", "ironwingX",
        "MetaSlash", "ChromeFang", "neonpalm", "lightswitch_", "trapcardOG"],
    # Platinum — "decent player" energy
    3: ["FrostByte_TV", "CinderSnake", "EchoVibes", "phantomThief.exe",
        "BurnoutBeam", "PixelDealer", "vorpalcat", "MidnightCarmine",
        "duskhowl", "rampage_arc"],
    # Diamond — long-game, branded usernames
    4: ["DarkVoyager_TTV", "NorthStarz0", "DriftWolf-9", "PrismRiderX",
        "vexnight_", "AmberStrike77", "wickedhalo_TV", "lonestar.os",
        "VelvetVoltage", "HellsBellsHQ"],
    # Master — competitive feel, sponsors, tournament tags
    5: ["Vexnight_TTV", "ApexLumen_T1", "SilverFang_GG", "ArcanePulse_TV",
        "NocturnaRift", "ScarletPhase_LFT", "Vespera_Origin", "OnyxRevenant",
        "RyuKaiser_LFG", "Mistral_Onyx"],
    # Grandmaster — pro / staff tags, sponsor-suffixed
    6: ["FrostKnight_Origin", "Vespera_Pro", "ZephyrTKO_EU", "K1ngslayer.gg",
        "OnyxRevenant_T1", "MidnightProtocol", "NocturneApex_FNT",
        "VelourSavant_T1", "Mistral_Chrono", "DraconisGG.TV"],
    # Goonmaster — only one slot, never actually bot-fills, but seed for completeness
    7: ["GOONFATHER", "TheLastGoon", "GoonLord_404"],
}
PLACEMENT_MATCHES = 5
PLACEMENT_MULTIPLIER = 2


def random_spawn():
    return random.choice(SPAWN_POINTS)


# -------------------------------------------------------------------
# Player & Bot
# -------------------------------------------------------------------
class Player:
    def __init__(self, ws: Optional[WebSocket], user: Optional[dict] = None, is_bot: bool = False, bot_name: str = ""):
        self.ws = ws
        self.is_bot = is_bot
        if is_bot:
            self.user_id = None
            self.username = bot_name
            self.max_hp = BOT_MAX_HP
            self.avatar = 0
            self.rank_tier = 0
            self.rank_name = "BOT"
            self.rank_points = 0
            self.peak_rank_tier = 0
            self.banner_icon = 0
            self.banner_color = 0
            self.banner_animated = False
            self.level = 1
        else:
            self.user_id = str(user["_id"])
            self.username = user.get("username", user["email"].split("@")[0])
            self.max_hp = MAX_HP
            self.avatar = int(user.get("avatar", 0) or 0)
            pts = int(user.get("rank_points", 0) or 0)
            t_idx, t_name = rank_for_points(pts)
            self.rank_tier = t_idx
            self.rank_name = t_name
            self.rank_points = pts
            self.peak_rank_tier = int(user.get("peak_rank_tier", t_idx) or t_idx)
            self.banner_icon = int(user.get("banner_icon", 0) or 0)
            self.banner_color = int(user.get("banner_color", 0) or 0)
            self.banner_animated = bool(user.get("banner_animated", False))
            self.level = compute_level(user.get("stats", {}))["level"]
        self.id = ("bot_" if is_bot else "p_") + uuid.uuid4().hex[:10]
        x, z = random_spawn()
        self.x = float(x)
        self.y = PLAYER_HEIGHT
        self.z = float(z)
        self.yaw = 0.0
        self.pitch = 0.0
        self.hp = self.max_hp
        self.kills = 0
        self.deaths = 0
        self.alive = True
        self.last_shot_ms = 0
        self.last_melee_ms = 0
        self.respawn_at = 0.0
        self.invuln_until = time.time() + 3.0
        self.last_attacker: Optional[str] = None
        self.bot_strafe_t = random.uniform(0, 6.28)
        self.bot_repath_at = 0.0
        self.bot_target_id: Optional[str] = None
        # Weapon state (Overwatch-style)
        self.weapon = "ak47"
        self.ammo: Dict[str, int] = {
            "ak47": WEAPON_CONFIGS["ak47"]["mag_size"],
            "laser": WEAPON_CONFIGS["laser"]["mag_size"],
        }
        self.reload_until_ms: Dict[str, int] = {"ak47": 0, "laser": 0}
        self.spread: float = 0.0  # current cone radius in radians
        self.is_ads: bool = False
        # Laser beam state — continuous-fire weapon with heat instead of ammo.
        # heat: 0.0..1.0 (1.0 = overheated, locks fire until full cooldown).
        self.laser_heat: float = 0.0
        self.laser_overheated: bool = False
        self.laser_firing: bool = False
        # Input platform — "pc", "mobile", "controller" — set by client after connect.
        self.platform: str = "bot" if is_bot else "pc"

    def cur_ammo(self) -> int:
        return self.ammo.get(self.weapon, 0)

    def mag_size(self) -> int:
        return weapon_cfg(self.weapon)["mag_size"]

    def is_reloading(self) -> bool:
        return int(time.time() * 1000) < self.reload_until_ms.get(self.weapon, 0)

    def reload_progress(self) -> float:
        cfg = weapon_cfg(self.weapon)
        end = self.reload_until_ms.get(self.weapon, 0)
        now_ms = int(time.time() * 1000)
        if now_ms >= end or cfg["reload_ms"] <= 0:
            return 1.0
        return max(0.0, 1.0 - (end - now_ms) / cfg["reload_ms"])

    def start_reload(self):
        if self.is_bot:
            return
        cfg = weapon_cfg(self.weapon)
        if self.ammo.get(self.weapon, 0) >= cfg["mag_size"]:
            return
        if self.is_reloading():
            return
        now_ms = int(time.time() * 1000)
        self.reload_until_ms[self.weapon] = now_ms + cfg["reload_ms"]

    def finish_reload_if_due(self):
        """Called from tick — completes any expired reload by refilling the magazine."""
        now_ms = int(time.time() * 1000)
        for w, end in list(self.reload_until_ms.items()):
            if end > 0 and now_ms >= end:
                self.ammo[w] = WEAPON_CONFIGS.get(w, WEAPON_CONFIGS["ak47"])["mag_size"]
                self.reload_until_ms[w] = 0

    def to_state(self):
        # `disguised` bots (casual quick-match) appear as real players in the
        # state payload so the scoreboard's BOT badge doesn't give them away.
        # The flag is set at spawn-time by GameRoom.spawn_bot in casual mode.
        disguised = bool(getattr(self, "disguised", False)) and self.is_bot
        return {
            "id": self.id,
            "username": self.username,
            "x": round(self.x, 3),
            "y": round(self.y, 3),
            "z": round(self.z, 3),
            "yaw": round(self.yaw, 3),
            "pitch": round(self.pitch, 3),
            "hp": self.hp,
            "kills": self.kills,
            "deaths": self.deaths,
            "alive": self.alive,
            "is_bot": False if disguised else self.is_bot,
            "invuln": time.time() < self.invuln_until,
            "weapon": self.weapon,
            "ammo": self.cur_ammo(),
            "mag_size": self.mag_size(),
            "reloading": self.is_reloading(),
            "reload_progress": round(self.reload_progress(), 3),
            "spread": round(self.spread, 4),
            "laser_heat": round(self.laser_heat, 3),
            "laser_overheated": bool(self.laser_overheated),
            "laser_firing": bool(self.laser_firing),
            "platform": self.platform if not disguised else getattr(self, "disguise_platform", "pc"),
            "avatar": int(getattr(self, "avatar", 0) or 0),
            "rank_tier": int(getattr(self, "rank_tier", 0) or 0),
            "rank_name": getattr(self, "rank_name", "BRONZE") if not disguised else getattr(self, "disguise_rank_name", "BRONZE"),
            "rank_points": int(getattr(self, "rank_points", 0) or 0) if not disguised else int(getattr(self, "disguise_rank_points", 0) or 0),
            "level": int(getattr(self, "level", 1) or 1),
            "banner_icon": int(getattr(self, "banner_icon", 0) or 0),
            "banner_color": int(getattr(self, "banner_color", 0) or 0),
            "banner_animated": bool(getattr(self, "banner_animated", False)),
        }

    def shooter_payload(self) -> dict:
        """Fields embedded in `kill` events for the killer's PlayerCard. Hides
        bot identity when disguised (no BOT badge after killing a player)."""
        disguised = bool(getattr(self, "disguised", False)) and self.is_bot
        return {
            "shooter_id": self.id,
            "shooter_name": self.username,
            "shooter_avatar": int(getattr(self, "avatar", 0) or 0),
            "shooter_rank_tier": int(getattr(self, "rank_tier", 0) or 0),
            "shooter_rank_name": (
                getattr(self, "rank_name", "BRONZE")
                if not disguised
                else getattr(self, "disguise_rank_name", "BRONZE")
            ),
            "shooter_rank_points": (
                int(getattr(self, "rank_points", 0) or 0)
                if not disguised
                else int(getattr(self, "disguise_rank_points", 0) or 0)
            ),
            "shooter_peak_rank_tier": int(getattr(self, "peak_rank_tier", getattr(self, "rank_tier", 0)) or 0),
            "shooter_banner_icon": int(getattr(self, "banner_icon", 0) or 0),
            "shooter_banner_color": int(getattr(self, "banner_color", 0) or 0),
            "shooter_banner_animated": bool(getattr(self, "banner_animated", False)),
            "shooter_level": int(getattr(self, "level", 1) or 1),
            # Disguised bots report as human in the kill banner.
            "shooter_is_bot": False if disguised else bool(self.is_bot),
        }


class GameRoom:
    def __init__(self, is_ranked: bool = False, match_duration: float = 300.0):
        self.players: Dict[str, Player] = {}
        self.events: List[dict] = []
        self.lock = asyncio.Lock()
        self._last_tick = time.time()
        self.is_ranked = is_ranked
        self.match_duration = match_duration
        self.match_start = time.time()
        self.in_intermission = False
        self.last_match_end_payload: Optional[dict] = None

    def spawn_bot(self, name: str, *, disguised: bool = False, difficulty: float = 1.0, disguise_tier_idx: Optional[int] = None):
        bot = Player(ws=None, is_bot=True, bot_name=name)
        bot.is_dummy = False
        # Difficulty scales HP, aim accuracy and fire rate at runtime (see _tick_bots).
        bot.difficulty = max(0.5, float(difficulty))
        bot.max_hp = int(BOT_MAX_HP * bot.difficulty)
        bot.hp = bot.max_hp
        if disguised:
            bot.disguised = True
            # Match a real-player-looking platform + avatar + tier-aligned rank.
            bot.disguise_platform = random.choice(["pc", "mobile", "pc", "pc"])
            bot.avatar = random.randint(0, 4)
            if disguise_tier_idx is None:
                # Casual / generic disguise — keep the original low-rank look so
                # quick-match bots blend in with new players.
                pts = random.randint(0, 850)
            else:
                # Tier-aligned disguise: pick a random point value INSIDE the
                # band for the given tier. Used by ranked-vs-bots rooms so the
                # bot's rank icon matches what real players would see at that
                # lobby's tier (e.g. Diamond room → bot card says DIAMOND).
                ti = max(0, min(len(RANK_TIERS) - 1, int(disguise_tier_idx)))
                low = RANK_TIERS[ti][0]
                # Upper bound: one less than next tier's threshold (or +400
                # for the top tier so we still vary slightly).
                high = (RANK_TIERS[ti + 1][0] - 1) if (ti + 1 < len(RANK_TIERS)) else (low + 400)
                pts = random.randint(low, max(low, high))
            t_idx, t_name = rank_for_points(pts)
            bot.disguise_rank_points = pts
            bot.disguise_rank_name = t_name
            bot.rank_tier = t_idx
        self.players[bot.id] = bot
        logger.info("Bot spawned: %s (%s) diff=%.2f%s%s", name, bot.id, bot.difficulty,
                    " [disguised]" if disguised else "",
                    f" tier={disguise_tier_idx}" if (disguised and disguise_tier_idx is not None) else "")
        return bot

    async def add(self, player: Player):
        async with self.lock:
            self.players[player.id] = player
        # Track non-spectator real players' location for spectate discovery.
        if not player.is_bot and not getattr(player, "is_spectator", False) and player.user_id:
            kind = "ranked" if self.is_ranked else "casual"
            if getattr(self, "is_practice", False):
                kind = "practice"
            elif getattr(self, "is_offline", False):
                kind = "offline"
            elif getattr(self, "is_party", False):
                kind = "party"
            elif getattr(self, "is_ranked_bot", False):
                kind = "ranked"
            PLAYER_LOCATION[player.user_id] = {"kind": kind, "party_id": getattr(self, "party_id", None)}
        await self._send(player, {
            "type": "welcome",
            "you": player.to_state(),
            "arena": ARENA,
            "is_ranked": self.is_ranked,
            "match_duration": self.match_duration if self.is_ranked else None,
            "match_start": self.match_start if self.is_ranked else None,
            "spectator": bool(getattr(player, "is_spectator", False)),
            "spectate_target_id": getattr(player, "spectate_target_id", None),
        })
        if not getattr(player, "is_spectator", False):
            await self.broadcast({"type": "join", "player": player.to_state()})
        if self.last_match_end_payload and self.in_intermission:
            await self._send(player, self.last_match_end_payload)

    async def remove(self, player: Player):
        async with self.lock:
            self.players.pop(player.id, None)
        if not player.is_bot and not getattr(player, "is_spectator", False) and player.user_id:
            PLAYER_LOCATION.pop(player.user_id, None)
        if not getattr(player, "is_spectator", False):
            await self.broadcast({"type": "leave", "id": player.id})

    async def _send(self, player: Player, msg: dict):
        if player.is_bot or player.ws is None:
            return
        try:
            # Per-client send timeout — a wedged TCP send buffer used to stall
            # the entire 20Hz tick (gather() in broadcast() awaits all sends).
            # 1.5s is well above a healthy round-trip and well below "frozen".
            await asyncio.wait_for(player.ws.send_text(json.dumps(msg)), timeout=1.5)
        except (Exception, asyncio.TimeoutError):
            # Drop the slow/dead socket so we don't keep blocking on it.
            try:
                await player.ws.close()
            except Exception:
                pass
            player.ws = None

    async def broadcast(self, msg: dict):
        data = json.dumps(msg)
        # Fan out concurrently — a single slow client used to block the entire
        # 20Hz tick because each send_text was awaited sequentially. Using
        # gather() lets fast clients receive their state while slow ones are
        # still flushing. return_exceptions=True so one failure doesn't cancel
        # the whole group, and each individual send is wrapped in a tight
        # timeout so a wedged socket can't block the tick.
        targets = [p for p in list(self.players.values()) if not p.is_bot and p.ws is not None]
        if not targets:
            return

        async def _send_one(ws):
            # 1.5s send budget per client. Anything slower means TCP backpressure
            # — drop the socket instead of stalling everyone else's gameplay.
            return await asyncio.wait_for(ws.send_text(data), timeout=1.5)

        results = await asyncio.gather(
            *[_send_one(p.ws) for p in targets],
            return_exceptions=True,
        )
        for p, res in zip(targets, results):
            if isinstance(res, Exception):
                # Close the socket so the player's WS receive task unwinds and
                # we don't try to send to it again on the next tick.
                try:
                    if p.ws is not None:
                        await p.ws.close()
                except Exception:
                    pass
                p.ws = None
                self.players.pop(p.id, None)

    def collides_obstacle(self, x: float, z: float) -> bool:
        s = ARENA["size"]
        if x < -s + PLAYER_RADIUS or x > s - PLAYER_RADIUS:
            return True
        if z < -s + PLAYER_RADIUS or z > s - PLAYER_RADIUS:
            return True
        for ob in ARENA["obstacles"]:
            hx, hz = ob["w"] / 2 + PLAYER_RADIUS, ob["d"] / 2 + PLAYER_RADIUS
            if abs(x - ob["x"]) < hx and abs(z - ob["z"]) < hz:
                return True
        return False

    def _has_los(self, shooter: Player, target: Player) -> bool:
        """Cheap line-of-sight check (2D over obstacles full-height assumption)."""
        ox, oz = shooter.x, shooter.z
        tx, tz = target.x, target.z
        dx, dz = tx - ox, tz - oz
        dist = math.hypot(dx, dz)
        if dist < 0.01:
            return True
        nx, nz = dx / dist, dz / dist
        steps = max(2, int(dist / 0.6))
        for i in range(1, steps):
            px = ox + nx * (i * 0.6)
            pz = oz + nz * (i * 0.6)
            for ob in ARENA["obstacles"]:
                hx = ob["w"] / 2
                hz = ob["d"] / 2
                if abs(px - ob["x"]) < hx and abs(pz - ob["z"]) < hz:
                    return False
        return True

    def raycast_hit(self, shooter: Player, yaw_override: Optional[float] = None, pitch_override: Optional[float] = None):
        """Returns (hit_player, body_part, distance) where body_part in {'head','torso','legs'} or (None, None, None)."""
        yaw = shooter.yaw if yaw_override is None else yaw_override
        pitch = shooter.pitch if pitch_override is None else pitch_override
        cp = math.cos(pitch)
        # NOTE: client uses Three.js camera Euler with rotation.y = yaw and
        # default forward (0,0,-1). After Ry(yaw) the effective forward is
        # (-sin(yaw)*cp, sin(pitch), -cos(yaw)*cp) — so the X sign is
        # *opposite* to the naive `sin(yaw)*cp`. Always use -sin to match
        # the camera convention or shots will fly sideways/backwards.
        dx = -math.sin(yaw) * cp
        dy = math.sin(pitch)
        dz = -math.cos(yaw) * cp
        ox, oy, oz = shooter.x, shooter.y, shooter.z

        def aabb_t(ob):
            mn = (ob["x"] - ob["w"] / 2, 0.0, ob["z"] - ob["d"] / 2)
            mx = (ob["x"] + ob["w"] / 2, ob["h"], ob["z"] + ob["d"] / 2)
            tmin = 0.0
            tmax = SHOT_RANGE
            for o, d, lo, hi in [
                (ox, dx, mn[0], mx[0]),
                (oy, dy, mn[1], mx[1]),
                (oz, dz, mn[2], mx[2]),
            ]:
                if abs(d) < 1e-6:
                    if o < lo or o > hi:
                        return None
                else:
                    t1 = (lo - o) / d
                    t2 = (hi - o) / d
                    if t1 > t2:
                        t1, t2 = t2, t1
                    if t1 > tmin:
                        tmin = t1
                    if t2 < tmax:
                        tmax = t2
                    if tmin > tmax:
                        return None
            return tmin if tmin >= 0 else None

        occlusion_t = SHOT_RANGE
        for ob in ARENA["obstacles"]:
            t = aabb_t(ob)
            if t is not None and t < occlusion_t:
                occlusion_t = t

        def sphere_t(cx, cy, cz, r):
            mx_, my_, mz_ = ox - cx, oy - cy, oz - cz
            b = mx_ * dx + my_ * dy + mz_ * dz
            c = mx_ * mx_ + my_ * my_ + mz_ * mz_ - r * r
            disc = b * b - c
            if disc < 0:
                return None
            t = -b - math.sqrt(disc)
            if t < 0:
                t = -b + math.sqrt(disc)
            if t < 0 or t > SHOT_RANGE:
                return None
            return t

        best_t = SHOT_RANGE
        best: Optional[Player] = None
        best_part: Optional[str] = None
        for p in self.players.values():
            if p.id == shooter.id or not p.alive:
                continue
            # 3-sphere capsule hitbox: head, torso, legs (each with its own label)
            base = p.y - PLAYER_HEIGHT
            spheres = [
                ("head",  p.x, base + 1.65, p.z, 0.55),
                ("torso", p.x, base + 1.05, p.z, 0.65),
                ("legs",  p.x, base + 0.45, p.z, 0.55),
            ]
            for (label, cx, cy, cz, r) in spheres:
                t = sphere_t(cx, cy, cz, r)
                if t is not None and t < best_t and t < occlusion_t:
                    best_t = t
                    best = p
                    best_part = label
        return (best, best_part, best_t if best is not None else None)

    async def _apply_melee(self, attacker: Player):
        """Resolve a melee swing: cone in front of attacker, range MELEE_RANGE."""
        cp = math.cos(attacker.pitch)
        # Same Three.js camera convention as raycast_hit above — X sign flipped.
        dx = -math.sin(attacker.yaw) * cp
        dz = -math.cos(attacker.yaw) * cp
        self.events.append({
            "type": "melee",
            "shooter_id": attacker.id,
            "x": attacker.x, "y": attacker.y, "z": attacker.z,
            "yaw": attacker.yaw, "pitch": attacker.pitch,
        })
        # Find closest victim within range + cone
        best = None
        best_d = MELEE_RANGE
        for p in self.players.values():
            if p.id == attacker.id or not p.alive:
                continue
            if time.time() < p.invuln_until:
                continue
            vx = p.x - attacker.x
            vz = p.z - attacker.z
            d = math.hypot(vx, vz)
            if d > MELEE_RANGE or d < 0.05:
                continue
            # Angle between attacker forward and target direction
            dot = (vx * dx + vz * dz) / d
            if dot < math.cos(MELEE_CONE):
                continue
            if d < best_d:
                best_d = d
                best = p
        if best is not None:
            best.hp -= MELEE_DAMAGE
            best.last_attacker = attacker.id
            self.events.append({
                "type": "hit",
                "shooter_id": attacker.id,
                "victim_id": best.id,
                "hp": max(0, best.hp),
                "melee": True,
            })
            if best.hp <= 0:
                best.alive = False
                best.hp = 0
                best.deaths += 1
                attacker.kills += 1
                best.respawn_at = time.time() + 3.0
                self.events.append({
                    "type": "kill",
                    **attacker.shooter_payload(),
                    "victim_id": best.id,
                    "victim_name": best.username,
                    "melee": True,
                    "weapon": "katana",
                })
                if not attacker.is_bot and attacker.user_id:
                    _bg(db.users.update_one({"_id": ObjectId(attacker.user_id)}, {"$inc": {"stats.kills": 1}}))
                if not best.is_bot and best.user_id:
                    _bg(db.users.update_one({"_id": ObjectId(best.user_id)}, {"$inc": {"stats.deaths": 1}}))

    async def _apply_shoot(self, shooter: Player, base_damage: int):
        """Overwatch-style shot resolution: spread cone + falloff + headshot multiplier.
        Bots use base_damage directly; real players use weapon config."""
        cfg = weapon_cfg(getattr(shooter, "weapon", "ak47"))
        # Compute effective spread (ADS tightens). Bots have no spread.
        if shooter.is_bot:
            spread = 0.0
        else:
            spread = shooter.spread * (cfg["ads_spread_mult"] if shooter.is_ads else 1.0)
        # Randomized aim deviation within a cone of half-angle `spread`.
        yaw = shooter.yaw
        pitch = shooter.pitch
        if spread > 0.0:
            ang = random.uniform(0, 2 * math.pi)
            r = spread * math.sqrt(random.random())
            yaw = shooter.yaw + math.cos(ang) * r
            pitch = max(-1.5, min(1.5, shooter.pitch + math.sin(ang) * r))
        self.events.append({
            "type": "shot",
            "shooter_id": shooter.id,
            "x": shooter.x, "y": shooter.y, "z": shooter.z,
            "yaw": yaw, "pitch": pitch,
            "weapon": getattr(shooter, "weapon", "ak47"),
        })
        # Increase shooter's accumulated spread (recoil) for next shot.
        if not shooter.is_bot:
            shooter.spread = min(cfg["spread_max"], shooter.spread + cfg["spread_per_shot"])
        hit, body_part, dist = self.raycast_hit(shooter, yaw_override=yaw, pitch_override=pitch)
        if hit and hit.alive:
            if time.time() < hit.invuln_until:
                return
            # Damage scaling
            if shooter.is_bot:
                damage = base_damage
            else:
                damage = cfg["damage"]
                if body_part == "head":
                    damage *= cfg["headshot_mult"]
                elif body_part == "legs":
                    damage *= cfg["legs_mult"]
                # Distance falloff
                if dist is not None:
                    fs, fe, mn = cfg["falloff_start"], cfg["falloff_end"], cfg["min_damage_mult"]
                    if dist > fs:
                        t = min(1.0, (dist - fs) / max(0.001, fe - fs))
                        damage *= 1.0 - t * (1.0 - mn)
                damage = int(round(damage))
            hit.hp -= damage
            hit.last_attacker = shooter.id
            self.events.append({
                "type": "hit",
                "shooter_id": shooter.id,
                "victim_id": hit.id,
                "hp": max(0, hit.hp),
                "body_part": body_part,
                "damage": damage,
                "headshot": body_part == "head" and not shooter.is_bot,
            })
            if hit.hp <= 0:
                hit.alive = False
                hit.hp = 0
                hit.deaths += 1
                shooter.kills += 1
                hit.respawn_at = time.time() + 3.0
                self.events.append({
                    "type": "kill",
                    **shooter.shooter_payload(),
                    "victim_id": hit.id,
                    "victim_name": hit.username,
                    "weapon": getattr(shooter, "weapon", "ak47"),
                    "headshot": body_part == "head" and not shooter.is_bot,
                })
                if not shooter.is_bot and shooter.user_id:
                    _bg(db.users.update_one({"_id": ObjectId(shooter.user_id)}, {"$inc": {"stats.kills": 1}}))
                if not hit.is_bot and hit.user_id:
                    _bg(db.users.update_one({"_id": ObjectId(hit.user_id)}, {"$inc": {"stats.deaths": 1}}))

    async def _apply_laser_beam(self, shooter: Player, dt: float):
        """Continuous laser beam — applies damage per tick while firing.
        No recoil/spread; one persistent beam-event broadcast at start, hits
        per tick produce 'hit' events. Heat ramps up while firing; overheat
        triggers a forced cooldown."""
        # Damage per second for laser. cfg["damage"] is per-shot in legacy
        # mode (9 dmg @ 14 fps ≈ 126 dps); keep a similar feel: 60 dps clean.
        cfg = weapon_cfg("laser")
        dps = cfg.get("dps", 60)
        damage_this_tick = max(1, int(round(dps * dt)))
        # Heat ramp: 0 → 1 in 3 s of continuous firing, cool: 1 → 0 in 4 s.
        shooter.laser_heat = min(1.0, shooter.laser_heat + dt / 3.0)
        # Raycast (no spread)
        hit, body_part, dist = self.raycast_hit(shooter, yaw_override=shooter.yaw, pitch_override=shooter.pitch)
        # Emit a continuous beam event so clients can render the beam tracer.
        # The 'beam' type is throttled to once per ~6 ticks (300ms) to keep
        # bandwidth down — the client extrapolates between updates.
        last = getattr(shooter, "_last_beam_emit_ms", 0)
        now_ms = int(time.time() * 1000)
        if now_ms - last >= 250:
            shooter._last_beam_emit_ms = now_ms
            self.events.append({
                "type": "beam",
                "shooter_id": shooter.id,
                "x": shooter.x, "y": shooter.y, "z": shooter.z,
                "yaw": shooter.yaw, "pitch": shooter.pitch,
                "weapon": "laser",
                "hit_dist": dist,
            })
        if not hit or not hit.alive:
            return
        if time.time() < hit.invuln_until:
            return
        damage = damage_this_tick
        if body_part == "head":
            damage = int(round(damage * cfg.get("headshot_mult", 1.5)))
        hit.hp -= damage
        hit.last_attacker = shooter.id
        # Throttle hit events for the beam too — only emit when victim drops a
        # noticeable chunk OR died (else we'd flood the wire at 20 Hz).
        emit_hit = (hit.hp <= 0) or ((int(hit.hp) // 10) != ((int(hit.hp) + damage) // 10))
        if emit_hit:
            self.events.append({
                "type": "hit",
                "shooter_id": shooter.id,
                "victim_id": hit.id,
                "hp": max(0, hit.hp),
                "body_part": body_part,
                "damage": damage,
                "headshot": body_part == "head",
                "weapon": "laser",
            })
        if hit.hp <= 0:
            hit.alive = False
            hit.hp = 0
            hit.deaths += 1
            shooter.kills += 1
            hit.respawn_at = time.time() + 3.0
            self.events.append({
                "type": "kill",
                **shooter.shooter_payload(),
                "victim_id": hit.id,
                "victim_name": hit.username,
                "weapon": "laser",
                "headshot": body_part == "head",
            })
            if not shooter.is_bot and shooter.user_id:
                _bg(db.users.update_one({"_id": ObjectId(shooter.user_id)}, {"$inc": {"stats.kills": 1}}))
            if not hit.is_bot and hit.user_id:
                _bg(db.users.update_one({"_id": ObjectId(hit.user_id)}, {"$inc": {"stats.deaths": 1}}))

    async def handle_message(self, player: Player, msg: dict):
        # Spectators are read-only — ignore all gameplay messages.
        if getattr(player, "is_spectator", False):
            return
        mtype = msg.get("type")
        if mtype == "ping":
            await self._send(player, {"type": "pong", "ts": msg.get("ts", 0)})
            return
        if mtype == "input":
            x = float(msg.get("x", player.x))
            z = float(msg.get("z", player.z))
            yaw = float(msg.get("yaw", player.yaw))
            pitch = float(msg.get("pitch", player.pitch))
            max_delta = 1.2
            if not player.alive:
                return
            dx = x - player.x
            dz = z - player.z
            dist = math.hypot(dx, dz)
            if dist > max_delta:
                scale = max_delta / dist
                x = player.x + dx * scale
                z = player.z + dz * scale
            if not self.collides_obstacle(x, z):
                player.x = x
                player.z = z
            player.yaw = yaw
            player.pitch = max(-1.5, min(1.5, pitch))
            if "ads" in msg:
                player.is_ads = bool(msg["ads"])
            # Client tells us its currently-equipped weapon every input tick
            # so we can correctly resolve continuous-fire (laser) and hit-scan.
            # Without this the server never sees a weapon switch from the
            # client (discrete 'shoot' messages set it, but laser fire is
            # continuous and goes via 'input' only).
            if "weapon" in msg:
                w = msg.get("weapon")
                if w in WEAPON_CONFIGS:
                    player.weapon = w
            if "laser_firing" in msg:
                # Stop the beam server-side if the client lets go; tick()
                # handles the per-tick damage + heat ramp when firing == True.
                # We only require player.weapon == "laser" *after* the weapon
                # field above has been processed.
                player.laser_firing = (
                    bool(msg["laser_firing"])
                    and player.weapon == "laser"
                    and not player.laser_overheated
                )
        elif mtype == "shoot":
            now_ms = int(time.time() * 1000)
            if not player.alive:
                return
            weapon = msg.get("weapon", "ak47")
            # Laser is continuous-fire — discrete shoot messages are ignored
            # (client sends 'laser_firing' on input instead).
            if weapon == "laser":
                return
            cfg = weapon_cfg(weapon)
            cooldown = cfg["cooldown_ms"]
            if now_ms - player.last_shot_ms < cooldown:
                return
            player.weapon = weapon
            # Reject if reloading or out of ammo (auto-trigger reload when empty).
            if player.is_reloading():
                return
            if player.ammo.get(weapon, 0) <= 0:
                player.start_reload()
                return
            player.last_shot_ms = now_ms
            player.ammo[weapon] = max(0, player.ammo.get(weapon, 0) - 1)
            if "yaw" in msg:
                player.yaw = float(msg["yaw"])
            if "pitch" in msg:
                player.pitch = float(msg["pitch"])
            await self._apply_shoot(player, cfg["damage"])
            # Auto-reload when magazine hits zero
            if player.ammo.get(weapon, 0) == 0:
                player.start_reload()
        elif mtype == "reload":
            if not player.alive or player.is_bot:
                return
            weapon = msg.get("weapon", player.weapon)
            player.weapon = weapon if weapon in WEAPON_CONFIGS else player.weapon
            player.start_reload()
        elif mtype == "melee":
            now_ms = int(time.time() * 1000)
            if not player.alive:
                return
            if now_ms - player.last_melee_ms < MELEE_COOLDOWN_MS:
                return
            player.last_melee_ms = now_ms
            if "yaw" in msg:
                player.yaw = float(msg["yaw"])
            if "pitch" in msg:
                player.pitch = float(msg["pitch"])
            await self._apply_melee(player)
        elif mtype == "set_platform":
            plat = str(msg.get("platform", "pc")).lower()
            if plat in ("pc", "mobile", "controller"):
                player.platform = plat
        elif mtype == "chat":
            text = (msg.get("text") or "").strip()
            if not text:
                return
            text = text[:140]
            now_ms = int(time.time() * 1000)
            # Per-player rate-limit: max 1 message per 1.2s
            last = getattr(player, "last_chat_ms", 0)
            if now_ms - last < 1200:
                return
            player.last_chat_ms = now_ms
            await self.broadcast({
                "type": "chat",
                "id": player.id,
                "username": player.username,
                "is_bot": player.is_bot,
                "text": text,
                "ts": now_ms,
            })

    async def _update_bots(self, dt: float):
        now_ms = int(time.time() * 1000)
        for bot in list(self.players.values()):
            if not bot.is_bot or not bot.alive:
                continue
            # Practice dummies are stationary targets — no movement.
            if getattr(bot, "is_dummy", False):
                continue
            # Find target = closest alive other player
            target: Optional[Player] = None
            best = float("inf")
            for p in self.players.values():
                if p is bot or not p.alive:
                    continue
                d = math.hypot(p.x - bot.x, p.z - bot.z)
                if d < best:
                    best = d
                    target = p
            if target is None:
                # Wander
                bot.bot_strafe_t += dt
                wx = math.cos(bot.bot_strafe_t * 0.4) * 2 * dt
                wz = math.sin(bot.bot_strafe_t * 0.4) * 2 * dt
                nx, nz = bot.x + wx, bot.z + wz
                if not self.collides_obstacle(nx, bot.z):
                    bot.x = nx
                if not self.collides_obstacle(bot.x, nz):
                    bot.z = nz
                continue

            # Aim at target (head height ~1.6)
            tx, tz = target.x, target.z
            ty = target.y - 0.2
            dx = tx - bot.x
            dz = tz - bot.z
            dist = math.hypot(dx, dz)
            if dist > 0.01:
                # Match Three.js camera convention used by the raycast — yaw=0 → look -Z, yaw=-π/2 → look +X.
                bot.yaw = math.atan2(-dx, -dz)
            dy = ty - bot.y
            bot.pitch = max(-1.0, min(1.0, math.atan2(dy, dist) if dist > 0.01 else 0))

            # Move: keep desired distance 12-16
            bot.bot_strafe_t += dt
            move_speed = 4.0 * dt
            mx_, mz_ = 0.0, 0.0
            desired = 14.0
            if dist > desired + 2:
                # approach
                if dist > 0.01:
                    mx_, mz_ = dx / dist, dz / dist
            elif dist < desired - 4:
                # back off
                if dist > 0.01:
                    mx_, mz_ = -dx / dist, -dz / dist
            # strafe
            strafe = math.sin(bot.bot_strafe_t * 1.4) * 0.7
            if dist > 0.01:
                # perpendicular dir
                px, pz = -dz / dist, dx / dist
                mx_ += px * strafe
                mz_ += pz * strafe
            L = math.hypot(mx_, mz_)
            if L > 0:
                mx_ /= L
                mz_ /= L
                nx = bot.x + mx_ * move_speed
                nz = bot.z + mz_ * move_speed
                if not self.collides_obstacle(nx, bot.z):
                    bot.x = nx
                else:
                    # try sideways
                    bot.bot_strafe_t += 0.3
                if not self.collides_obstacle(bot.x, nz):
                    bot.z = nz
                else:
                    bot.bot_strafe_t += 0.3

            # Shoot when ready & LoS — with small aim noise (bots are less accurate)
            # Dummy bots (practice range) never shoot back. Higher-difficulty bots
            # shoot more frequently AND aim more precisely.
            if getattr(bot, "is_dummy", False):
                continue
            difficulty = float(getattr(bot, "difficulty", 1.0))
            # Diff 1.0 → 600ms cooldown, 1.5 → 400ms, 2.0 → 300ms.
            effective_cd = BOT_SHOT_COOLDOWN_MS / max(0.5, difficulty)
            if now_ms - bot.last_shot_ms >= effective_cd:
                if self._has_los(bot, target):
                    bot.last_shot_ms = now_ms
                    orig_yaw, orig_pitch = bot.yaw, bot.pitch
                    # Diff 1.0 → full noise, 1.5 → 0.66x noise, 2.0 → 0.5x noise.
                    noise = BOT_AIM_NOISE / max(0.5, difficulty)
                    bot.yaw += random.uniform(-noise, noise)
                    bot.pitch += random.uniform(-noise * 0.7, noise * 0.7)
                    # Damage also scales modestly with difficulty (capped to not one-shot).
                    dmg = int(BOT_SHOT_DAMAGE * (0.7 + 0.4 * difficulty))
                    await self._apply_shoot(bot, dmg)
                    bot.yaw, bot.pitch = orig_yaw, orig_pitch

    async def tick(self):
        now = time.time()
        dt = max(0.0, now - self._last_tick)
        self._last_tick = now

        # Ranked queueing: if not enough real players, pause the match timer
        real_count = sum(1 for p in self.players.values() if not p.is_bot)
        in_queue = self.is_ranked and real_count < RANKED_MIN_REAL_PLAYERS
        if in_queue:
            self.match_start = now  # freeze timer

        # Respawn dead + decay weapon spread + complete reloads
        for p in self.players.values():
            if getattr(p, "is_spectator", False):
                p.alive = False
                continue
            if not p.alive and now >= p.respawn_at:
                x, z = random_spawn()
                p.x, p.z = float(x), float(z)
                p.y = PLAYER_HEIGHT
                p.hp = p.max_hp
                p.alive = True
                p.invuln_until = now + 3.0
                # Refill ammo on respawn (cancel any pending reloads)
                for w in p.ammo.keys():
                    p.ammo[w] = WEAPON_CONFIGS.get(w, WEAPON_CONFIGS["ak47"])["mag_size"]
                    p.reload_until_ms[w] = 0
                p.spread = 0.0
                p.is_ads = False
                # Reset laser beam state on respawn — otherwise a player who
                # died while overheated stays unable to fire on respawn, and a
                # client that died mid-beam-hold can keep `laser_firing=True`
                # on the server forever.
                p.laser_heat = 0.0
                p.laser_overheated = False
                p.laser_firing = False
                self.events.append({"type": "respawn", "id": p.id})
            if not p.is_bot and p.alive:
                # Decay spread when not firing (Overwatch-style recoil recovery)
                cfg = weapon_cfg(p.weapon)
                p.spread = max(0.0, p.spread - cfg["spread_decay"] * dt)
                # Spread floor depends on weapon (so cone is never below base)
                if p.spread < cfg["spread_base"]:
                    p.spread = cfg["spread_base"]
                p.finish_reload_if_due()
            # Laser beam tick — apply continuous damage + heat ramp, or cool off.
            if p.alive and not p.is_bot:
                if p.laser_firing and p.weapon == "laser" and not p.laser_overheated:
                    await self._apply_laser_beam(p, dt)
                    if p.laser_heat >= 1.0:
                        # Forced overheat — must fully cool down before firing again.
                        p.laser_firing = False
                        p.laser_overheated = True
                        self.events.append({"type": "overheat", "shooter_id": p.id})
                else:
                    # Cool down (1.0 → 0 over 4 s while not firing).
                    p.laser_heat = max(0.0, p.laser_heat - dt / 4.0)
                    if p.laser_overheated and p.laser_heat <= 0.0:
                        p.laser_overheated = False

        # Bot AI (still runs during queue, just for atmosphere)
        await self._update_bots(dt)

        state = {
            "type": "state",
            "t": int(now * 1000),
            "players": [p.to_state() for p in self.players.values() if not getattr(p, "is_spectator", False)],
            "events": self.events,
            "is_ranked": self.is_ranked,
            "time_left": max(0.0, self.match_duration - (now - self.match_start)) if (not in_queue) else None,
            "in_intermission": self.in_intermission,
            "in_queue": in_queue,
            "real_count": real_count,
            "min_real_players": RANKED_MIN_REAL_PLAYERS,
        }
        self.events = []
        await self.broadcast(state)

    async def end_match(self):
        """End a match: for ranked, award rank points; for casual, just show standings.
        Broadcasts a match_end payload, then resets the room after a 10s intermission."""
        self.in_intermission = True
        real_players = [p for p in self.players.values() if not p.is_bot and p.user_id and not getattr(p, "is_spectator", False)]
        real_players.sort(key=lambda p: p.kills, reverse=True)
        placements = []
        if self.is_ranked:
            rewards = [30, 15, 5]
            for i, p in enumerate(real_players):
                base_delta = rewards[i] if i < len(rewards) else -10
                new_points = 0
                placement_played_before = 0
                is_placement = False
                delta = base_delta
                try:
                    udoc = await db.users.find_one({"_id": ObjectId(p.user_id)})
                    cur = int((udoc or {}).get("rank_points", 0) or 0)
                    placement_played_before = int((udoc or {}).get("placement_matches_played", 0) or 0)
                    is_placement = placement_played_before < PLACEMENT_MATCHES
                    if is_placement:
                        delta = base_delta * PLACEMENT_MULTIPLIER if base_delta > 0 else 0
                    new_points = max(0, cur + delta)
                    tier_idx, tier_name = rank_for_points(new_points)
                    prev_peak = int((udoc or {}).get("peak_rank_points", 0) or 0)
                    new_peak = max(prev_peak, new_points)
                    update_set = {"rank_points": new_points}
                    if new_peak > prev_peak:
                        update_set["peak_rank_points"] = new_peak
                    await db.users.update_one(
                        {"_id": ObjectId(p.user_id)},
                        {"$set": update_set, "$inc": {"stats.matches": 1, "placement_matches_played": 1}},
                    )
                except Exception as e:
                    logger.warning("rank update failed: %s", e)
                    tier_idx, tier_name = rank_for_points(new_points)
                placements.append({
                    "id": p.id,
                    "username": p.username,
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "delta": delta,
                    "base_delta": base_delta,
                    "new_points": new_points,
                    "rank_tier": tier_idx,
                    "rank_name": tier_name,
                    "is_placement": is_placement,
                    "placement_match_number": placement_played_before + 1 if is_placement else None,
                    "placement_matches_total": PLACEMENT_MATCHES,
                })
        else:
            # Casual: no RP, just record the match in stats so K/D analytics still work.
            for p in real_players:
                cur_points = 0
                tier_idx, tier_name = 0, "BRONZE"
                try:
                    udoc = await db.users.find_one({"_id": ObjectId(p.user_id)})
                    cur_points = int((udoc or {}).get("rank_points", 0) or 0)
                    tier_idx, tier_name = rank_for_points(cur_points)
                    await db.users.update_one(
                        {"_id": ObjectId(p.user_id)},
                        {"$inc": {"stats.matches": 1}},
                    )
                except Exception:
                    pass
                placements.append({
                    "id": p.id,
                    "username": p.username,
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "delta": 0,
                    "base_delta": 0,
                    "new_points": cur_points,
                    "rank_tier": tier_idx,
                    "rank_name": tier_name,
                    "is_placement": False,
                    "placement_match_number": None,
                    "placement_matches_total": PLACEMENT_MATCHES,
                })

        payload = {
            "type": "match_end",
            "placements": placements,
            "duration": self.match_duration,
            "is_ranked": self.is_ranked,
        }
        self.last_match_end_payload = payload

        # Persist per-player match history (newest first via index on ended_at desc).
        # Offline rooms set self.is_offline=True; we tag those for filtering.
        try:
            if real_players:
                now = datetime.now(timezone.utc)
                mode = "ranked" if self.is_ranked else ("offline" if getattr(self, "is_offline", False) else "casual")
                docs = []
                for entry, pl in zip(placements, real_players):
                    docs.append({
                        "user_id": pl.user_id,
                        "username": pl.username,
                        "mode": mode,
                        "kills": entry["kills"],
                        "deaths": entry["deaths"],
                        "placement": placements.index(entry) + 1,
                        "total_players": len(placements),
                        "rp_delta": entry["delta"],
                        "rank_points_after": entry["new_points"],
                        "rank_name_after": entry["rank_name"],
                        "is_placement": entry.get("is_placement", False),
                        "ended_at": now,
                    })
                if docs:
                    await db.match_history.insert_many(docs)
        except Exception as e:
            logger.warning("match_history insert failed: %s", e)

        await self.broadcast(payload)

        # Intermission: 10s
        await asyncio.sleep(10.0)

        # Reset for next match
        for p in self.players.values():
            p.kills = 0
            p.deaths = 0
            x, z = random_spawn()
            p.x, p.z = float(x), float(z)
            p.y = PLAYER_HEIGHT
            p.hp = p.max_hp
            p.alive = True
            p.invuln_until = time.time() + 3.0
            p.last_attacker = None
        self.match_start = time.time()
        self.in_intermission = False
        self.last_match_end_payload = None
        await self.broadcast({"type": "match_start", "duration": self.match_duration})

    async def run(self):
        interval = 1.0 / TICK_RATE
        while True:
            try:
                if not self.in_intermission:
                    real_count = sum(1 for p in self.players.values() if not p.is_bot)
                    has_min = real_count >= (RANKED_MIN_REAL_PLAYERS if self.is_ranked else 1)
                    if has_min and time.time() - self.match_start >= self.match_duration:
                        await self.end_match()
                        continue
                await self.tick()
            except Exception as e:
                logger.exception("tick error: %s", e)
            await asyncio.sleep(interval)


game_room = GameRoom(is_ranked=False, match_duration=300.0)  # 5 minute Quick Match
ranked_room = GameRoom(is_ranked=True, match_duration=120.0)  # 2 minute Ranked
practice_room = GameRoom(is_ranked=False, match_duration=99999.0)  # Practice never ends
practice_room.is_practice = True

# Offline-vs-AI: one private room per user, spawned on demand.
OFFLINE_ROOMS: Dict[str, "GameRoom"] = {}
OFFLINE_ROOM_TASKS: Dict[str, asyncio.Task] = {}
# Ranked-vs-bots: one private RANKED room per user when bot-fill triggers.
# Low-tier (Bronze..Diamond, idx 0-4) → 3 combat bots. Master/GM (5-6) → 1 bot.
# Goonmaster (7) never bot-fills.
RANKED_BOT_ROOMS: Dict[str, "GameRoom"] = {}
RANKED_BOT_ROOM_TASKS: Dict[str, asyncio.Task] = {}


def ranked_bot_count_for_tier(tier_idx: int) -> int:
    if tier_idx >= 7:
        return 0  # never reached — Goonmaster doesn't bot-fill
    if tier_idx >= 5:
        return 1  # Master / Grandmaster
    return 3  # Bronze..Diamond


async def get_or_create_offline_room(user_id: str) -> "GameRoom":
    """Returns a private 5-min FFA room for the user, with 3 combat bots."""
    room = OFFLINE_ROOMS.get(user_id)
    if room is not None:
        return room
    room = GameRoom(is_ranked=False, match_duration=300.0)
    room.is_offline = True
    # Spawn 3 combat bots (same names as casual; suffix makes them unique per room).
    for name in BOT_NAMES[:NUM_BOTS]:
        room.spawn_bot(f"{name}-O")
    OFFLINE_ROOMS[user_id] = room
    OFFLINE_ROOM_TASKS[user_id] = asyncio.create_task(room.run())
    logger.info("Offline room spawned for user=%s", user_id)
    return room


async def cleanup_offline_room_if_empty(user_id: str):
    """If no real players remain, destroy the room and cancel its task."""
    room = OFFLINE_ROOMS.get(user_id)
    if room is None:
        return
    if any(not p.is_bot for p in room.players.values()):
        return
    task = OFFLINE_ROOM_TASKS.pop(user_id, None)
    if task and not task.done():
        task.cancel()
    OFFLINE_ROOMS.pop(user_id, None)
    logger.info("Offline room destroyed for user=%s", user_id)


async def get_or_create_ranked_bot_room(user_id: str, tier_idx: int) -> "GameRoom":
    """Per-user ranked-vs-bots room — bot count scales with tier (3 for Bronze..Diamond, 1 for Master/GM)."""
    room = RANKED_BOT_ROOMS.get(user_id)
    if room is not None:
        return room
    room = GameRoom(is_ranked=True, match_duration=120.0)
    room.is_ranked_bot = True
    bot_count = ranked_bot_count_for_tier(tier_idx)
    # Ranked bot difficulty scales aggressively with the player's tier so the
    # ladder actually feels harder as you climb: Bronze 1.4 → Grandmaster 2.6.
    # (Higher diff = faster reactions, better aim, more accurate fire — see
    # the bot tick in GameRoom.tick().)
    ranked_difficulty = 1.4 + min(6, tier_idx) * 0.2
    # Tier-aligned name pool — higher tiers get longer / more "competitive"
    # handles (sponsor tags, TTV suffixes, etc.). Falls back to BOT_NAMES if
    # the tier has no custom pool seeded.
    name_pool = TIERED_BOT_NAMES.get(tier_idx) or BOT_NAMES
    chosen_names = random.sample(name_pool, k=min(bot_count, len(name_pool)))
    # If somehow the pool was smaller than bot_count (shouldn't happen for the
    # current sizes 1..3), pad with BOT_NAMES so the room still fills up.
    while len(chosen_names) < bot_count:
        chosen_names.append(BOT_NAMES[len(chosen_names) % len(BOT_NAMES)])
    for name in chosen_names:
        # `disguised=True` makes ranked bots appear as real players in the
        # scoreboard, kill-feed, and the death overlay's "killed by" card — no
        # BOT badge after they kill you. They keep their bot AI internally.
        # `disguise_tier_idx` aligns the bot's visible rank to the lobby's
        # tier so a Diamond player sees DIAMOND-ranked "opponents" instead
        # of obvious BRONZE placeholders.
        room.spawn_bot(name, disguised=True, difficulty=ranked_difficulty, disguise_tier_idx=tier_idx)
    RANKED_BOT_ROOMS[user_id] = room
    RANKED_BOT_ROOM_TASKS[user_id] = asyncio.create_task(room.run())
    logger.info("Ranked-bot room spawned for user=%s tier=%d bots=%d", user_id, tier_idx, bot_count)
    return room


async def cleanup_ranked_bot_room_if_empty(user_id: str):
    room = RANKED_BOT_ROOMS.get(user_id)
    if room is None:
        return
    if any(not p.is_bot for p in room.players.values()):
        return
    task = RANKED_BOT_ROOM_TASKS.pop(user_id, None)
    if task and not task.done():
        task.cancel()
    RANKED_BOT_ROOMS.pop(user_id, None)
    logger.info("Ranked-bot room destroyed for user=%s", user_id)

# -------------------------------------------------------------------
# Ranked Matchmaking Queue
# -------------------------------------------------------------------
QUEUE_LOCK = asyncio.Lock()
RANKED_QUEUE: Dict[int, List[dict]] = {i: [] for i in range(len(RANK_TIERS))}
MATCHED_USERS: Dict[str, dict] = {}  # user_id -> {match_id, tier}

# Rolling window (last 10) of how long each match took to fill, per tier.
# Used by the queue API to give players an estimated wait time. Empty until
# the matchmaker has seen at least one match in a tier.
from collections import deque
RECENT_MATCH_WAITS: Dict[int, "deque[float]"] = {i: deque(maxlen=10) for i in range(len(RANK_TIERS))}


def estimate_wait_seconds(tier_idx: int, current_wait: float) -> int:
    """Return a friendly "ETA to match" in seconds for the queue overlay.

    Priority: rolling avg of recent matches in this tier → bot-fill timeout
    → 30s sane default. Stays still while the player is queued (`current_wait`
    is intentionally ignored) — the live timer already counts up next to it,
    so a second decrementing value made the UI feel jittery."""
    waits = RECENT_MATCH_WAITS.get(tier_idx)
    if waits and len(waits) > 0:
        avg = sum(waits) / len(waits)
        return max(1, int(round(avg)))
    fill = bot_fill_seconds_for_tier(tier_idx)
    if fill == float("inf"):
        return 30  # Goonmaster never bot-fills; show a placeholder.
    return max(1, int(round(fill)))


async def matchmaker_loop():
    while True:
        try:
            now = time.time()
            async with QUEUE_LOCK:
                # Pair real-vs-real players in same tier
                for tier_idx, q in RANKED_QUEUE.items():
                    while len(q) >= 2:
                        a = q.pop(0)
                        b = q.pop(0)
                        mid = uuid.uuid4().hex[:10]
                        MATCHED_USERS[a["user_id"]] = {"match_id": mid, "tier": tier_idx, "matched_at": now}
                        MATCHED_USERS[b["user_id"]] = {"match_id": mid, "tier": tier_idx, "matched_at": now}
                        # Record wait-to-match for the ETA estimator. Using max
                        # of both players' waits = the longer wait, which is
                        # what new entrants will most likely experience.
                        RECENT_MATCH_WAITS[tier_idx].append(max(now - a["joined_at"], now - b["joined_at"]))
                        logger.info("Matched tier=%d %s vs %s (mid=%s)", tier_idx, a["username"], b["username"], mid)
                # Bot-fill: any player queued for > tier-specific timeout gets matched against bots.
                # Goonmaster (tier 7) has timeout=inf — the loop body is unreachable for that tier.
                for tier_idx, q in RANKED_QUEUE.items():
                    tier_timeout = bot_fill_seconds_for_tier(tier_idx)
                    if tier_timeout == float("inf"):
                        continue
                    while q and (now - q[0]["joined_at"]) >= tier_timeout:
                        a = q.pop(0)
                        mid = uuid.uuid4().hex[:10]
                        MATCHED_USERS[a["user_id"]] = {"match_id": mid, "tier": tier_idx, "matched_at": now, "vs_bot": True}
                        RECENT_MATCH_WAITS[tier_idx].append(now - a["joined_at"])
                        logger.info("Bot-filled %s after %ds queue (tier=%d)", a["username"], int(tier_timeout), tier_idx)
        except Exception as e:
            logger.warning("matchmaker error: %s", e)
        await asyncio.sleep(0.5)


async def season_loop():
    """Periodically checks if the season has elapsed and resets ranks if so."""
    while True:
        try:
            await maybe_reset_season()
        except Exception as e:
            logger.warning("season_loop error: %s", e)
        await asyncio.sleep(60.0)


@api.get("/season")
async def season_status():
    doc = await maybe_reset_season()
    return season_payload(doc)


RANKED_MIN_LEVEL = 5


@api.post("/queue/ranked")
async def queue_ranked_join(user: dict = Depends(get_current_user)):
    user_id = str(user["_id"])
    # Gate: Ranked locks until Level 5 — protects new players + their MMR.
    user_level = compute_level(user.get("stats", {}))["level"]
    if user_level < RANKED_MIN_LEVEL:
        raise HTTPException(
            status_code=403,
            detail=f"Ranked unlocks at Level {RANKED_MIN_LEVEL}. You are Level {user_level}.",
        )
    points = int(user.get("rank_points", 0) or 0)
    tier_idx, tier_name = rank_for_points(points)
    fill = bot_fill_seconds_for_tier_api(tier_idx)
    now_ts = time.time()
    async with QUEUE_LOCK:
        if user_id in MATCHED_USERS:
            m = MATCHED_USERS[user_id]
            return {"matched": True, "match_id": m["match_id"], "tier": m["tier"], "tier_name": tier_name, "wait_seconds": 0, "bot_fill_seconds": fill}
        for q in RANKED_QUEUE.values():
            for e in q:
                if e["user_id"] == user_id:
                    elapsed = now_ts - e["joined_at"]
                    return {"in_queue": True, "tier": tier_idx, "tier_name": tier_name, "position": q.index(e) + 1, "tier_size": len(q), "wait_seconds": int(elapsed), "bot_fill_seconds": fill, "estimated_wait_seconds": estimate_wait_seconds(tier_idx, elapsed)}
        RANKED_QUEUE[tier_idx].append({
            "user_id": user_id,
            "username": user.get("username", ""),
            "joined_at": now_ts,
        })
    return {"in_queue": True, "tier": tier_idx, "tier_name": tier_name, "position": len(RANKED_QUEUE[tier_idx]), "tier_size": len(RANKED_QUEUE[tier_idx]), "wait_seconds": 0, "bot_fill_seconds": fill, "estimated_wait_seconds": estimate_wait_seconds(tier_idx, 0.0)}


@api.get("/queue/ranked")
async def queue_ranked_status(user: dict = Depends(get_current_user)):
    user_id = str(user["_id"])
    points = int(user.get("rank_points", 0) or 0)
    tier_idx, tier_name = rank_for_points(points)
    fill = bot_fill_seconds_for_tier_api(tier_idx)
    now_ts = time.time()
    if user_id in MATCHED_USERS:
        m = MATCHED_USERS[user_id]
        return {"matched": True, "match_id": m["match_id"], "tier": m["tier"], "tier_name": tier_name, "wait_seconds": int(now_ts - m.get("matched_at", now_ts)), "bot_fill_seconds": fill}
    for ti, q in RANKED_QUEUE.items():
        for i, e in enumerate(q):
            if e["user_id"] == user_id:
                elapsed = now_ts - e["joined_at"]
                return {"in_queue": True, "tier": ti, "tier_name": tier_name, "position": i + 1, "tier_size": len(q), "wait_seconds": int(elapsed), "bot_fill_seconds": bot_fill_seconds_for_tier_api(ti), "estimated_wait_seconds": estimate_wait_seconds(ti, elapsed)}
    return {"in_queue": False, "matched": False, "tier": tier_idx, "tier_name": tier_name, "wait_seconds": 0, "bot_fill_seconds": fill}


@api.delete("/queue/ranked")
async def queue_ranked_leave(user: dict = Depends(get_current_user)):
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        for q in RANKED_QUEUE.values():
            q[:] = [e for e in q if e["user_id"] != user_id]
        MATCHED_USERS.pop(user_id, None)
    return {"ok": True}


@api.post("/queue/ranked/ack")
async def queue_ranked_ack(user: dict = Depends(get_current_user)):
    """Called by client after entering the ranked match to clear matched state."""
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        MATCHED_USERS.pop(user_id, None)
    return {"ok": True}


# -------------------------------------------------------------------
# Party invites & persistent party state.
#
# In-lobby party: leader can invite friends, members can leave, leader can
# press Quick Match to start. The party room (mode=party&party_id) is created
# lazily when the leader presses START; until then the party is just a roster
# in PARTIES.
#
# Bot fill: party_room spawns enough disguised bots to bring total players
# (real + bots) to MAX_PARTY_SIZE. Casual queue matchmaking is not implemented
# for parties — they always play their own private party room (with bots).
# -------------------------------------------------------------------
MAX_PARTY_SIZE = 4
PARTY_INVITES: Dict[str, List[dict]] = {}  # to_user_id -> [{from_user_id, ...}]
# Persistent party state:
PARTIES: Dict[str, dict] = {}              # party_id -> {leader_id, members:[user_id], created_at, match_starting:bool}
PARTY_MEMBER_INDEX: Dict[str, str] = {}    # user_id -> party_id (1 party per user)
# Lazy-spawned rooms when the leader presses START:
PARTY_ROOMS: Dict[str, "GameRoom"] = {}
PARTY_ROOM_TASKS: Dict[str, asyncio.Task] = {}
# DEPRECATED legacy alias retained for the existing room-spawn function.
PARTY_OWNERS: Dict[str, str] = {}  # party_id -> leader_user_id (mirror of PARTIES[*].leader_id)


def _gc_invites():
    """Drop expired invites from PARTY_INVITES."""
    now = time.time()
    for to_id in list(PARTY_INVITES.keys()):
        kept = [inv for inv in PARTY_INVITES[to_id] if inv["expires_at"] > now]
        if kept:
            PARTY_INVITES[to_id] = kept
        else:
            PARTY_INVITES.pop(to_id, None)


def _party_state_for(party_id: str) -> Optional[dict]:
    return PARTIES.get(party_id)


async def _party_card(user_id: str) -> dict:
    u = await db.users.find_one({"_id": ObjectId(user_id)})
    if not u:
        return {"id": user_id, "username": "(unknown)", "avatar": 0, "rank_name": "BRONZE", "rank_points": 0, "online": False}
    return _friend_card(u)


async def _party_payload(party_id: str) -> dict:
    p = PARTIES[party_id]
    return {
        "party_id": party_id,
        "leader_id": p["leader_id"],
        "members": [await _party_card(uid) for uid in p["members"]],
        "match_starting": bool(p.get("match_starting", False)),
        "max_size": MAX_PARTY_SIZE,
    }


# -------------------------------------------------------------------
# Friends list — send / accept / decline / block / unfriend, + online status
# Schema: db.friendships = { from_user_id, to_user_id, status, created_at }
#   status ∈ {"pending","accepted","blocked"}
#   "blocked" rows are stored from blocker → blocked (one direction).
#   "pending"/"accepted" rows are also one direction; we union both sides
#   when listing.
# -------------------------------------------------------------------
ONLINE_USERS: Dict[str, int] = {}  # user_id -> open WS connection count
# Lobby presence — user_id -> last heartbeat unix ts. Users in the lobby (no WS)
# ping POST /api/presence/heartbeat every ~20s; we treat them as online for the
# next HEARTBEAT_TTL seconds.
PRESENCE_HEARTBEAT: Dict[str, float] = {}
HEARTBEAT_TTL = 45.0
# Where each player currently is (lobby/match). Set by GameRoom.add/remove.
# Value example: {"kind": "casual"} | {"kind": "party", "party_id": "..."}
PLAYER_LOCATION: Dict[str, dict] = {}


def is_online(user_id: str) -> bool:
    if ONLINE_USERS.get(user_id, 0) > 0:
        return True
    ts = PRESENCE_HEARTBEAT.get(user_id)
    if ts is None:
        return False
    if (time.time() - ts) > HEARTBEAT_TTL:
        PRESENCE_HEARTBEAT.pop(user_id, None)
        return False
    return True


def player_location(user_id: str) -> Optional[dict]:
    """Public-facing — what mode/room a user is currently playing in (or None)."""
    return PLAYER_LOCATION.get(user_id)


class FriendActionIn(BaseModel):
    username: str = Field(min_length=2, max_length=30)


def _friend_card(u: dict) -> dict:
    """Compact public view for friend rows (with online + location + last-seen)."""
    pts = int(u.get("rank_points", 0) or 0)
    t_idx, t_name = rank_for_points(pts)
    loc = player_location(str(u["_id"]))
    last_seen = u.get("last_seen_at")
    lvl = compute_level(u.get("stats", {}))
    return {
        "id": str(u["_id"]),
        "username": u.get("username", ""),
        "avatar": int(u.get("avatar", 0) or 0),
        "rank_points": pts,
        "rank_tier": t_idx,
        "rank_name": t_name,
        "level": lvl["level"],
        "banner_icon": int(u.get("banner_icon", 0) or 0),
        "banner_color": int(u.get("banner_color", 0) or 0),
        "banner_animated": bool(u.get("banner_animated", False)),
        "online": is_online(str(u["_id"])),
        "in_match": loc is not None and loc.get("kind") in ("casual", "ranked", "party", "offline"),
        "match_kind": loc.get("kind") if loc else None,
        "last_seen_at": float(last_seen) if last_seen else None,
    }


async def _find_user_by_username(username: str) -> Optional[dict]:
    return await db.users.find_one({"username": {"$regex": f"^{username}$", "$options": "i"}})


@api.post("/presence/heartbeat")
async def presence_heartbeat(user: dict = Depends(get_current_user)):
    """Lobby clients ping this every ~20s so they show as online to friends.
    Also stamps `last_seen_at` in the user doc so offline friends can show a
    'last seen N min ago' label.
    Returns the current online state for the caller (sanity)."""
    uid = str(user["_id"])
    PRESENCE_HEARTBEAT[uid] = time.time()
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_seen_at": time.time()}})
    return {"online": True, "ttl": HEARTBEAT_TTL}


@api.get("/friends")
async def friends_list(user: dict = Depends(get_current_user)):
    """Returns the user's accepted friends + pending incoming + pending outgoing + blocked."""
    me_id = str(user["_id"])
    # Accepted: either side of the row matches me
    accepted_cur = db.friendships.find({
        "status": "accepted",
        "$or": [{"from_user_id": me_id}, {"to_user_id": me_id}],
    })
    accepted_ids = []
    async for f in accepted_cur:
        other = f["to_user_id"] if f["from_user_id"] == me_id else f["from_user_id"]
        accepted_ids.append(other)
    incoming_cur = db.friendships.find({"status": "pending", "to_user_id": me_id})
    incoming = []
    async for f in incoming_cur:
        incoming.append(f["from_user_id"])
    outgoing_cur = db.friendships.find({"status": "pending", "from_user_id": me_id})
    outgoing = []
    async for f in outgoing_cur:
        outgoing.append(f["to_user_id"])
    blocked_cur = db.friendships.find({"status": "blocked", "from_user_id": me_id})
    blocked = []
    async for f in blocked_cur:
        blocked.append(f["to_user_id"])

    async def hydrate(ids):
        out = []
        for uid in ids:
            try:
                u = await db.users.find_one({"_id": ObjectId(uid)})
                if u:
                    out.append(_friend_card(u))
            except Exception:
                pass
        out.sort(key=lambda r: (not r["online"], r["username"].lower()))
        return out

    return {
        "friends": await hydrate(accepted_ids),
        "incoming": await hydrate(incoming),
        "outgoing": await hydrate(outgoing),
        "blocked": await hydrate(blocked),
    }


@api.post("/friends/request")
async def friends_request(payload: FriendActionIn, user: dict = Depends(get_current_user)):
    me_id = str(user["_id"])
    target = await _find_user_by_username(payload.username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    t_id = str(target["_id"])
    if t_id == me_id:
        raise HTTPException(status_code=400, detail="Cannot friend yourself")
    # Block check: either direction
    blocked = await db.friendships.find_one({
        "status": "blocked",
        "$or": [
            {"from_user_id": me_id, "to_user_id": t_id},
            {"from_user_id": t_id, "to_user_id": me_id},
        ],
    })
    if blocked:
        raise HTTPException(status_code=403, detail="Blocked")
    # Already friends?
    existing = await db.friendships.find_one({
        "status": {"$in": ["accepted", "pending"]},
        "$or": [
            {"from_user_id": me_id, "to_user_id": t_id},
            {"from_user_id": t_id, "to_user_id": me_id},
        ],
    })
    if existing:
        # If they sent us a pending request first, auto-accept.
        if existing.get("status") == "pending" and existing.get("from_user_id") == t_id:
            await db.friendships.update_one({"_id": existing["_id"]}, {"$set": {"status": "accepted"}})
            return {"status": "accepted", "user": _friend_card(target)}
        return {"status": existing["status"], "user": _friend_card(target)}
    await db.friendships.insert_one({
        "from_user_id": me_id,
        "to_user_id": t_id,
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
    })
    return {"status": "pending", "user": _friend_card(target)}


@api.post("/friends/accept")
async def friends_accept(payload: FriendActionIn, user: dict = Depends(get_current_user)):
    me_id = str(user["_id"])
    sender = await _find_user_by_username(payload.username)
    if not sender:
        raise HTTPException(status_code=404, detail="User not found")
    r = await db.friendships.update_one(
        {"from_user_id": str(sender["_id"]), "to_user_id": me_id, "status": "pending"},
        {"$set": {"status": "accepted"}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="No pending request from that user")
    return {"status": "accepted", "user": _friend_card(sender)}


@api.post("/friends/decline")
async def friends_decline(payload: FriendActionIn, user: dict = Depends(get_current_user)):
    me_id = str(user["_id"])
    sender = await _find_user_by_username(payload.username)
    if not sender:
        raise HTTPException(status_code=404, detail="User not found")
    await db.friendships.delete_one({
        "from_user_id": str(sender["_id"]), "to_user_id": me_id, "status": "pending",
    })
    return {"ok": True}


@api.delete("/friends/{username}")
async def friends_remove(username: str, user: dict = Depends(get_current_user)):
    """Unfriend or cancel-outgoing-request."""
    me_id = str(user["_id"])
    other = await _find_user_by_username(username)
    if not other:
        raise HTTPException(status_code=404, detail="User not found")
    o_id = str(other["_id"])
    await db.friendships.delete_many({
        "status": {"$in": ["accepted", "pending"]},
        "$or": [
            {"from_user_id": me_id, "to_user_id": o_id},
            {"from_user_id": o_id, "to_user_id": me_id},
        ],
    })
    return {"ok": True}


@api.post("/friends/block")
async def friends_block(payload: FriendActionIn, user: dict = Depends(get_current_user)):
    me_id = str(user["_id"])
    target = await _find_user_by_username(payload.username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    t_id = str(target["_id"])
    if t_id == me_id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    # Wipe any prior relationship rows between us, then insert one-way block.
    await db.friendships.delete_many({
        "$or": [
            {"from_user_id": me_id, "to_user_id": t_id},
            {"from_user_id": t_id, "to_user_id": me_id},
        ],
    })
    await db.friendships.insert_one({
        "from_user_id": me_id,
        "to_user_id": t_id,
        "status": "blocked",
        "created_at": datetime.now(timezone.utc),
    })
    return {"status": "blocked", "user": _friend_card(target)}


@api.post("/friends/unblock")
async def friends_unblock(payload: FriendActionIn, user: dict = Depends(get_current_user)):
    me_id = str(user["_id"])
    target = await _find_user_by_username(payload.username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.friendships.delete_one({
        "from_user_id": me_id, "to_user_id": str(target["_id"]), "status": "blocked",
    })
    return {"ok": True}


@api.get("/users/search")
async def users_search(q: str, user: dict = Depends(get_current_user), limit: int = 10):
    """Username prefix search (case-insensitive) for the Friends modal."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    limit = max(1, min(20, int(limit)))
    cursor = db.users.find(
        {"username": {"$regex": f"^{q}", "$options": "i"}, "_id": {"$ne": user["_id"]}},
        {"_id": 1, "username": 1, "avatar": 1, "rank_points": 1},
    ).limit(limit)
    rows = []
    async for u in cursor:
        rows.append(_friend_card(u))
    return rows


# Party endpoints (require friendship; backed by in-memory PARTY_* state above).
class PartyInviteIn(BaseModel):
    username: str = Field(min_length=2, max_length=30)


async def get_or_create_party_room(party_id: str) -> "GameRoom":
    room = PARTY_ROOMS.get(party_id)
    if room is not None:
        return room
    # 5-minute private FFA. Bot-fill to MAX_PARTY_SIZE so a duo gets 2 bots,
    # a solo party-leader gets 3 bots, a full 4-party gets 0 bots.
    party = PARTIES.get(party_id)
    member_count = len(party["members"]) if party else 1
    bot_count = max(0, MAX_PARTY_SIZE - member_count)
    room = GameRoom(is_ranked=False, match_duration=300.0)
    room.is_party = True
    room.party_id = party_id
    if bot_count > 0:
        for name in random.sample(DISGUISED_BOT_NAMES, bot_count):
            room.spawn_bot(name, disguised=True, difficulty=1.1)
    PARTY_ROOMS[party_id] = room
    PARTY_ROOM_TASKS[party_id] = asyncio.create_task(room.run())
    logger.info("Party room spawned id=%s members=%d bots=%d", party_id, member_count, bot_count)
    return room


async def cleanup_party_room_if_empty(party_id: str):
    room = PARTY_ROOMS.get(party_id)
    if room is None:
        return
    if any(not p.is_bot for p in room.players.values()):
        return
    task = PARTY_ROOM_TASKS.pop(party_id, None)
    if task and not task.done():
        task.cancel()
    PARTY_ROOMS.pop(party_id, None)
    # Clear match_starting flag when the room dies so the lobby panel re-resets.
    party = PARTIES.get(party_id)
    if party:
        party["match_starting"] = False
    logger.info("Party room destroyed id=%s", party_id)


async def _leave_party_internal(user_id: str):
    party_id = PARTY_MEMBER_INDEX.pop(user_id, None)
    if not party_id or party_id not in PARTIES:
        return
    party = PARTIES[party_id]
    if user_id in party["members"]:
        party["members"].remove(user_id)
    if party["leader_id"] == user_id:
        if party["members"]:
            party["leader_id"] = party["members"][0]
            PARTY_OWNERS[party_id] = party["leader_id"]
        else:
            PARTIES.pop(party_id, None)
            PARTY_OWNERS.pop(party_id, None)
            return
    if not party["members"]:
        PARTIES.pop(party_id, None)
        PARTY_OWNERS.pop(party_id, None)


@api.post("/party/invite")
async def party_invite(payload: PartyInviteIn, user: dict = Depends(get_current_user)):
    """Send a party invite to a friend. Auto-creates a party with the inviter
    as leader if they don't already have one. Returns the (now updated) party
    state so the inviter's lobby panel can refresh immediately."""
    me_id = str(user["_id"])
    target = await _find_user_by_username(payload.username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    t_id = str(target["_id"])
    if t_id == me_id:
        raise HTTPException(status_code=400, detail="Cannot invite yourself")
    friend = await db.friendships.find_one({
        "status": "accepted",
        "$or": [
            {"from_user_id": me_id, "to_user_id": t_id},
            {"from_user_id": t_id, "to_user_id": me_id},
        ],
    })
    if not friend:
        raise HTTPException(status_code=403, detail="Only friends can be invited")
    party_id = PARTY_MEMBER_INDEX.get(me_id)
    if party_id and party_id in PARTIES and PARTIES[party_id]["leader_id"] != me_id:
        raise HTTPException(status_code=400, detail="Leave your current party before inviting others")
    if party_id is None:
        party_id = uuid.uuid4().hex[:10]
        PARTIES[party_id] = {
            "leader_id": me_id,
            "members": [me_id],
            "created_at": datetime.now(timezone.utc),
            "match_starting": False,
        }
        PARTY_MEMBER_INDEX[me_id] = party_id
        PARTY_OWNERS[party_id] = me_id
    if len(PARTIES[party_id]["members"]) >= MAX_PARTY_SIZE:
        raise HTTPException(status_code=400, detail=f"Party is full (max {MAX_PARTY_SIZE})")
    if t_id in PARTY_MEMBER_INDEX:
        raise HTTPException(status_code=400, detail="That user is already in a party")
    _gc_invites()
    arr = PARTY_INVITES.setdefault(t_id, [])
    arr[:] = [inv for inv in arr if inv["from_user_id"] != me_id]
    arr.append({
        "from_user_id": me_id,
        "from_username": user.get("username", ""),
        "from_avatar": int(user.get("avatar", 0) or 0),
        "party_id": party_id,
        "expires_at": time.time() + 60.0,
    })
    return await _party_payload(party_id)


@api.get("/party/invites")
async def party_invites_list(user: dict = Depends(get_current_user)):
    """Poll endpoint: returns invites pending for the calling user."""
    _gc_invites()
    me_id = str(user["_id"])
    return PARTY_INVITES.get(me_id, [])


@api.post("/party/accept")
async def party_accept(payload: PartyInviteIn, user: dict = Depends(get_current_user)):
    """Accept an invite — joins the persistent party in the lobby."""
    me_id = str(user["_id"])
    sender = await _find_user_by_username(payload.username)
    if not sender:
        raise HTTPException(status_code=404, detail="User not found")
    s_id = str(sender["_id"])
    _gc_invites()
    arr = PARTY_INVITES.get(me_id, [])
    inv = next((i for i in arr if i["from_user_id"] == s_id), None)
    if not inv:
        raise HTTPException(status_code=404, detail="No active invite from that user")
    PARTY_INVITES[me_id] = [i for i in arr if i["from_user_id"] != s_id]
    party_id = inv["party_id"]
    party = PARTIES.get(party_id)
    if not party:
        raise HTTPException(status_code=404, detail="Party no longer exists")
    if me_id in PARTY_MEMBER_INDEX and PARTY_MEMBER_INDEX[me_id] != party_id:
        await _leave_party_internal(me_id)
    if len(party["members"]) >= MAX_PARTY_SIZE:
        raise HTTPException(status_code=400, detail="Party is full")
    if me_id not in party["members"]:
        party["members"].append(me_id)
        PARTY_MEMBER_INDEX[me_id] = party_id
    return await _party_payload(party_id)


@api.post("/party/decline")
async def party_decline(payload: PartyInviteIn, user: dict = Depends(get_current_user)):
    me_id = str(user["_id"])
    sender = await _find_user_by_username(payload.username)
    if not sender:
        raise HTTPException(status_code=404, detail="User not found")
    s_id = str(sender["_id"])
    arr = PARTY_INVITES.get(me_id, [])
    PARTY_INVITES[me_id] = [i for i in arr if i["from_user_id"] != s_id]
    return {"ok": True}


@api.post("/party/leave")
async def party_leave(user: dict = Depends(get_current_user)):
    me_id = str(user["_id"])
    await _leave_party_internal(me_id)
    return {"ok": True}


@api.get("/party/me")
async def party_me(user: dict = Depends(get_current_user)):
    """Current party state (or {party_id: null} if not in a party)."""
    me_id = str(user["_id"])
    party_id = PARTY_MEMBER_INDEX.get(me_id)
    if not party_id or party_id not in PARTIES:
        return {"party_id": None}
    return await _party_payload(party_id)


@api.post("/party/start")
async def party_start(user: dict = Depends(get_current_user)):
    """Leader flags the party as match_starting; all members poll & auto-nav."""
    me_id = str(user["_id"])
    party_id = PARTY_MEMBER_INDEX.get(me_id)
    if not party_id or party_id not in PARTIES:
        raise HTTPException(status_code=404, detail="No party")
    party = PARTIES[party_id]
    if party["leader_id"] != me_id:
        raise HTTPException(status_code=403, detail="Only the leader can start")
    party["match_starting"] = True
    return {"party_id": party_id}


@api.get("/spectate/{username}/info")
async def spectate_info(username: str, _user: dict = Depends(get_current_user)):
    """Returns whether the target can be spectated right now."""
    u = await _find_user_by_username(username)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    loc = player_location(str(u["_id"]))
    return {
        "username": u.get("username", ""),
        "online": is_online(str(u["_id"])),
        "in_match": loc is not None and loc.get("kind") in ("casual", "ranked", "party", "offline"),
        "match_kind": loc.get("kind") if loc else None,
    }


@api.get("/users/{username}/profile")
async def public_profile(username: str, _user: dict = Depends(get_current_user)):
    """Public view of any user's profile — username, avatar, stats, rank,
    peak rank, last 10 matches. Email is intentionally excluded."""
    u = await _find_user_by_username(username)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    pts = int(u.get("rank_points", 0) or 0)
    peak = int(u.get("peak_rank_points", pts) or pts)
    if pts > peak:
        peak = pts
    t_idx, t_name = rank_for_points(pts)
    p_idx, p_name = rank_for_points(peak)
    user_id = str(u["_id"])
    cursor = db.match_history.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort([("ended_at", -1)]).limit(10)
    history = []
    async for m in cursor:
        ts = m.get("ended_at")
        history.append({
            "mode": m.get("mode", "casual"),
            "kills": int(m.get("kills", 0)),
            "deaths": int(m.get("deaths", 0)),
            "placement": int(m.get("placement", 0)),
            "total_players": int(m.get("total_players", 0)),
            "rp_delta": int(m.get("rp_delta", 0)),
            "rank_name_after": m.get("rank_name_after", "BRONZE"),
            "is_placement": bool(m.get("is_placement", False)),
            "ended_at": ts.isoformat() if isinstance(ts, datetime) else ts,
        })
    return {
        "id": user_id,
        "username": u.get("username", ""),
        "avatar": int(u.get("avatar", 0) or 0),
        "stats": u.get("stats", {"kills": 0, "deaths": 0, "matches": 0, "wins": 0}),
        "rank_points": pts,
        "rank_tier": t_idx,
        "rank_name": t_name,
        "peak_rank_points": peak,
        "peak_rank_tier": p_idx,
        "peak_rank_name": p_name,
        # Level + banner cosmetics so the public profile modal can render the
        # same card visuals (with LV chip) as the lobby header.
        "level": compute_level(u.get("stats", {}))["level"],
        "banner_icon": int(u.get("banner_icon", 0) or 0),
        "banner_color": int(u.get("banner_color", 0) or 0),
        "banner_animated": bool(u.get("banner_animated", False)),
        "online": is_online(user_id),
        "history": history,
    }


# -------------------------------------------------------------------
@api.websocket("/ws/game")
async def ws_game(websocket: WebSocket, token: Optional[str] = Query(default=None), mode: Optional[str] = Query(default="casual"), party_id: Optional[str] = Query(default=None), target: Optional[str] = Query(default=None)):
    auth_token = token
    if not auth_token:
        auth_token = websocket.cookies.get("access_token")
    if not auth_token:
        await websocket.close(code=4401)
        return
    user = await _user_from_token(auth_token)
    if not user:
        await websocket.close(code=4401)
        return

    if mode == "ranked":
        # Block under-leveled players from joining ranked games entirely.
        if compute_level(user.get("stats", {}))["level"] < RANKED_MIN_LEVEL:
            await websocket.close(code=4403)
            return
        # If the user was bot-filled by the matchmaker, spawn a private ranked-bot
        # room sized by their tier (3 bots for <Master, 1 for Master/GM).
        # Goonmaster never bot-fills, so it always goes through the shared real-vs-real room.
        u_id = str(user["_id"])
        matched = MATCHED_USERS.get(u_id, {})
        if matched.get("vs_bot"):
            room = await get_or_create_ranked_bot_room(u_id, int(matched.get("tier", 0)))
        else:
            room = ranked_room
    elif mode == "practice":
        room = practice_room
    elif mode == "offline":
        room = await get_or_create_offline_room(str(user["_id"]))
    elif mode == "party":
        if not party_id:
            await websocket.close(code=4400)
            return
        room = await get_or_create_party_room(party_id)
    elif mode == "spectate":
        # Spectate a friend's match: find their current room and join read-only.
        if not target:
            await websocket.close(code=4400)
            return
        target_user = await _find_user_by_username(target)
        if not target_user:
            await websocket.close(code=4404)
            return
        loc = player_location(str(target_user["_id"]))
        if not loc:
            await websocket.close(code=4404)
            return
        kind = loc.get("kind")
        if kind == "casual":
            room = game_room
        elif kind == "ranked":
            # Real-vs-real ranked room; ranked-bot rooms are private — match by per-user key.
            room = await get_or_create_ranked_bot_room(str(target_user["_id"]), int(target_user.get("rank_tier", 0))) if str(target_user["_id"]) in RANKED_BOT_ROOMS else ranked_room
        elif kind == "party" and loc.get("party_id"):
            room = await get_or_create_party_room(loc["party_id"])
        elif kind == "offline":
            room = await get_or_create_offline_room(str(target_user["_id"]))
        elif kind == "practice":
            room = practice_room
        else:
            await websocket.close(code=4404)
            return
    else:
        room = game_room
    await websocket.accept()
    u_id_str = str(user["_id"])
    ONLINE_USERS[u_id_str] = ONLINE_USERS.get(u_id_str, 0) + 1
    # Stamp last_seen on connect — also covered on disconnect below — so the
    # friends-list "last seen N min ago" stays accurate without heartbeat.
    try:
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_seen_at": time.time()}})
    except Exception:
        pass
    player = Player(websocket, user=user, is_bot=False)
    if mode == "spectate":
        player.is_spectator = True
        # Find target's Player.id inside the room for camera-follow on the client.
        target_player = next((p for p in room.players.values() if p.user_id == str(target_user["_id"])), None)
        player.spectate_target_id = target_player.id if target_player else None
        player.alive = False
        player.hp = 0
    await room.add(player)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            await room.handle_message(player, msg)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("ws error: %s", e)
    finally:
        await room.remove(player)
        ONLINE_USERS[u_id_str] = max(0, ONLINE_USERS.get(u_id_str, 1) - 1)
        if ONLINE_USERS.get(u_id_str, 0) == 0:
            ONLINE_USERS.pop(u_id_str, None)
        # Stamp last_seen on disconnect so "last seen" timer starts from now.
        try:
            await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_seen_at": time.time()}})
        except Exception:
            pass
        if mode == "offline":
            await cleanup_offline_room_if_empty(str(user["_id"]))
        elif mode == "party" and party_id:
            await cleanup_party_room_if_empty(party_id)
        elif mode == "ranked" and getattr(room, "is_ranked_bot", False):
            await cleanup_ranked_bot_room_if_empty(str(user["_id"]))


@api.get("/")
async def root():
    return {
        "message": "Shooter PvP API",
        "casual_players": len(game_room.players),
        "ranked_players": len(ranked_room.players),
        # Single, server-driven "Players online" value — all clients see the
        # same number, and it drifts slowly server-side (see
        # synthetic_online_loop). Keeps a believable sense of activity even
        # when real session counts are low.
        "players_online": SYNTHETIC_ONLINE["value"],
    }


# Server-authoritative synthetic player-count. Drifts every ~10s in [3, 35]
# so every connected client sees the same value.
SYNTHETIC_ONLINE: Dict[str, int] = {"value": 12}


async def synthetic_online_loop():
    while True:
        try:
            cur = SYNTHETIC_ONLINE["value"]
            big = random.random() < 0.10
            if big:
                step = random.choice([-1, 1]) * random.randint(3, 6)
            else:
                step = random.randint(-2, 2)
            nxt = cur + step
            if nxt < 3:
                nxt = 3 + random.randint(0, 1)
            elif nxt > 35:
                nxt = 35 - random.randint(0, 1)
            SYNTHETIC_ONLINE["value"] = nxt
        except Exception as e:
            logger.warning("synthetic_online_loop error: %s", e)
        await asyncio.sleep(10.0)


@api.get("/leaderboard/ranked")
async def leaderboard_ranked():
    cursor = db.users.find({}, {"_id": 0, "username": 1, "rank_points": 1, "stats": 1, "email": 1}).sort([("rank_points", -1)]).limit(50)
    rows = []
    async for u in cursor:
        s = u.get("stats", {})
        pts = int(u.get("rank_points", 0) or 0)
        idx, name = rank_for_points(pts)
        rows.append({
            "username": u.get("username", u.get("email", "anon")),
            "rank_points": pts,
            "rank_tier": idx,
            "rank_name": name,
            "kills": s.get("kills", 0),
            "deaths": s.get("deaths", 0),
        })
    return rows


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
