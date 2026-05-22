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


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax",
                        max_age=ACCESS_TTL_MIN * 60, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax",
                        max_age=REFRESH_TTL_DAYS * 86400, path="/")


def public_user(user: dict) -> dict:
    points = int(user.get("rank_points", 0) or 0)
    peak = int(user.get("peak_rank_points", points) or points)
    if points > peak:
        peak = points
    peak_idx, peak_name = rank_for_points(peak)
    tier_idx, tier_name = rank_for_points(points)
    placement_played = int(user.get("placement_matches_played", 0) or 0)
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "username": user.get("username", user["email"].split("@")[0]),
        "role": user.get("role", "user"),
        "stats": user.get("stats", {"kills": 0, "deaths": 0, "matches": 0, "wins": 0}),
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


# -------------------------------------------------------------------
# Startup
# -------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username")
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

    # Spawn bots in casual room. Ranked room gets exactly 1 permanent bot.
    for name in BOT_NAMES[:NUM_BOTS]:
        game_room.spawn_bot(name)
    ranked_room.spawn_bot(BOT_NAMES[0] + "-R")
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
    set_auth_cookies(response, access, refresh)
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
BOT_MAX_HP = 25
SHOT_DAMAGE = 25
LASER_DAMAGE = 8
BOT_SHOT_DAMAGE = 6
MELEE_DAMAGE = 200
MELEE_RANGE = 3.4
MELEE_CONE = 0.95
SHOT_RANGE = 100
SHOT_COOLDOWN_MS = 250
LASER_COOLDOWN_MS = 90
MELEE_COOLDOWN_MS = 600
BOT_SHOT_COOLDOWN_MS = 1400
BOT_AIM_NOISE = 0.20
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
        "cooldown_ms": LASER_COOLDOWN_MS,
        "mag_size": 60,
        "reload_ms": 1800,
        "headshot_mult": 1.5,
        "legs_mult": 0.9,
        "falloff_start": 25.0,
        "falloff_end": 70.0,
        "min_damage_mult": 0.6,
        "spread_base": 0.0,     # laser stays pinpoint
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
        else:
            self.user_id = str(user["_id"])
            self.username = user.get("username", user["email"].split("@")[0])
            self.max_hp = MAX_HP
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
            "is_bot": self.is_bot,
            "invuln": time.time() < self.invuln_until,
            "weapon": self.weapon,
            "ammo": self.cur_ammo(),
            "mag_size": self.mag_size(),
            "reloading": self.is_reloading(),
            "reload_progress": round(self.reload_progress(), 3),
            "spread": round(self.spread, 4),
            "platform": self.platform,
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

    def spawn_bot(self, name: str):
        bot = Player(ws=None, is_bot=True, bot_name=name)
        bot.is_dummy = False
        self.players[bot.id] = bot
        logger.info("Bot spawned: %s (%s)", name, bot.id)
        return bot

    async def add(self, player: Player):
        async with self.lock:
            self.players[player.id] = player
        await self._send(player, {
            "type": "welcome",
            "you": player.to_state(),
            "arena": ARENA,
            "is_ranked": self.is_ranked,
            "match_duration": self.match_duration if self.is_ranked else None,
            "match_start": self.match_start if self.is_ranked else None,
        })
        await self.broadcast({"type": "join", "player": player.to_state()})
        # If we just ended a match and a player joins, send them the placements
        if self.last_match_end_payload and self.in_intermission:
            await self._send(player, self.last_match_end_payload)

    async def remove(self, player: Player):
        async with self.lock:
            self.players.pop(player.id, None)
        await self.broadcast({"type": "leave", "id": player.id})

    async def _send(self, player: Player, msg: dict):
        if player.is_bot or player.ws is None:
            return
        try:
            await player.ws.send_text(json.dumps(msg))
        except Exception:
            pass

    async def broadcast(self, msg: dict):
        data = json.dumps(msg)
        dead = []
        for p in list(self.players.values()):
            if p.is_bot or p.ws is None:
                continue
            try:
                await p.ws.send_text(data)
            except Exception:
                dead.append(p)
        for p in dead:
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
        dx = math.sin(yaw) * cp
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
                ("head",  p.x, base + 1.65, p.z, 0.45),
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
        dx = math.sin(attacker.yaw) * cp
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
                    "shooter_id": attacker.id,
                    "shooter_name": attacker.username,
                    "victim_id": best.id,
                    "victim_name": best.username,
                    "melee": True,
                    "weapon": "katana",
                })
                if not attacker.is_bot and attacker.user_id:
                    try:
                        await db.users.update_one({"_id": ObjectId(attacker.user_id)}, {"$inc": {"stats.kills": 1}})
                    except Exception:
                        pass
                if not best.is_bot and best.user_id:
                    try:
                        await db.users.update_one({"_id": ObjectId(best.user_id)}, {"$inc": {"stats.deaths": 1}})
                    except Exception:
                        pass

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
                    "shooter_id": shooter.id,
                    "shooter_name": shooter.username,
                    "victim_id": hit.id,
                    "victim_name": hit.username,
                    "weapon": getattr(shooter, "weapon", "ak47"),
                    "headshot": body_part == "head" and not shooter.is_bot,
                })
                if not shooter.is_bot and shooter.user_id:
                    try:
                        await db.users.update_one({"_id": ObjectId(shooter.user_id)}, {"$inc": {"stats.kills": 1}})
                    except Exception:
                        pass
                if not hit.is_bot and hit.user_id:
                    try:
                        await db.users.update_one({"_id": ObjectId(hit.user_id)}, {"$inc": {"stats.deaths": 1}})
                    except Exception:
                        pass

    async def handle_message(self, player: Player, msg: dict):
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
        elif mtype == "shoot":
            now_ms = int(time.time() * 1000)
            if not player.alive:
                return
            weapon = msg.get("weapon", "ak47")
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
                bot.yaw = math.atan2(dx, -dz)
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
            # Dummy bots (practice range) never shoot back.
            if getattr(bot, "is_dummy", False):
                continue
            if now_ms - bot.last_shot_ms >= BOT_SHOT_COOLDOWN_MS:
                if self._has_los(bot, target):
                    bot.last_shot_ms = now_ms
                    orig_yaw, orig_pitch = bot.yaw, bot.pitch
                    bot.yaw += random.uniform(-BOT_AIM_NOISE, BOT_AIM_NOISE)
                    bot.pitch += random.uniform(-BOT_AIM_NOISE * 0.7, BOT_AIM_NOISE * 0.7)
                    await self._apply_shoot(bot, BOT_SHOT_DAMAGE)
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
                self.events.append({"type": "respawn", "id": p.id})
            if not p.is_bot and p.alive:
                # Decay spread when not firing (Overwatch-style recoil recovery)
                cfg = weapon_cfg(p.weapon)
                p.spread = max(0.0, p.spread - cfg["spread_decay"] * dt)
                # Spread floor depends on weapon (so cone is never below base)
                if p.spread < cfg["spread_base"]:
                    p.spread = cfg["spread_base"]
                p.finish_reload_if_due()

        # Bot AI (still runs during queue, just for atmosphere)
        await self._update_bots(dt)

        state = {
            "type": "state",
            "t": int(now * 1000),
            "players": [p.to_state() for p in self.players.values()],
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
        real_players = [p for p in self.players.values() if not p.is_bot and p.user_id]
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
ranked_room = GameRoom(is_ranked=True, match_duration=50.0)
practice_room = GameRoom(is_ranked=False, match_duration=99999.0)  # Practice never ends
practice_room.is_practice = True

# -------------------------------------------------------------------
# Ranked Matchmaking Queue
# -------------------------------------------------------------------
QUEUE_LOCK = asyncio.Lock()
RANKED_QUEUE: Dict[int, List[dict]] = {i: [] for i in range(len(RANK_TIERS))}
MATCHED_USERS: Dict[str, dict] = {}  # user_id -> {match_id, tier}


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


@api.post("/queue/ranked")
async def queue_ranked_join(user: dict = Depends(get_current_user)):
    user_id = str(user["_id"])
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
                    return {"in_queue": True, "tier": tier_idx, "tier_name": tier_name, "position": q.index(e) + 1, "tier_size": len(q), "wait_seconds": int(now_ts - e["joined_at"]), "bot_fill_seconds": fill}
        RANKED_QUEUE[tier_idx].append({
            "user_id": user_id,
            "username": user.get("username", ""),
            "joined_at": now_ts,
        })
    return {"in_queue": True, "tier": tier_idx, "tier_name": tier_name, "position": len(RANKED_QUEUE[tier_idx]), "tier_size": len(RANKED_QUEUE[tier_idx]), "wait_seconds": 0, "bot_fill_seconds": fill}


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
                return {"in_queue": True, "tier": ti, "tier_name": tier_name, "position": i + 1, "tier_size": len(q), "wait_seconds": int(now_ts - e["joined_at"]), "bot_fill_seconds": bot_fill_seconds_for_tier_api(ti)}
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
# WebSocket endpoint
# -------------------------------------------------------------------
@api.websocket("/ws/game")
async def ws_game(websocket: WebSocket, token: Optional[str] = Query(default=None), mode: Optional[str] = Query(default="casual")):
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
        room = ranked_room
    elif mode == "practice":
        room = practice_room
    else:
        room = game_room
    await websocket.accept()
    player = Player(websocket, user=user, is_bot=False)
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


@api.get("/")
async def root():
    return {
        "message": "Shooter PvP API",
        "casual_players": len(game_room.players),
        "ranked_players": len(ranked_room.players),
    }


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
