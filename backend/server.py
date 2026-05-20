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
    tier_idx, tier_name = rank_for_points(points)
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "username": user.get("username", user["email"].split("@")[0]),
        "role": user.get("role", "user"),
        "stats": user.get("stats", {"kills": 0, "deaths": 0, "matches": 0, "wins": 0}),
        "rank_points": points,
        "rank_tier": tier_idx,
        "rank_name": tier_name,
        "created_at": user.get("created_at").isoformat() if isinstance(user.get("created_at"), datetime) else user.get("created_at"),
    }


RANK_TIERS = [
    (0,    "BRONZE"),
    (100,  "SILVER"),
    (250,  "GOLD"),
    (500,  "PLATINUM"),
    (800,  "DIAMOND"),
    (1200, "MASTER"),
    (1700, "GRANDMASTER"),
    (2300, "APEX"),
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

    # Spawn bots in both rooms
    for name in BOT_NAMES[:NUM_BOTS]:
        game_room.spawn_bot(name)
    for name in BOT_NAMES[:NUM_BOTS]:
        ranked_room.spawn_bot(name + "-R")
    asyncio.create_task(game_room.run())
    asyncio.create_task(ranked_room.run())
    asyncio.create_task(matchmaker_loop())


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
LASER_DAMAGE = 35
BOT_SHOT_DAMAGE = 6
MELEE_DAMAGE = 200  # one-shot
MELEE_RANGE = 3.4
MELEE_CONE = 0.95
SHOT_RANGE = 100
SHOT_COOLDOWN_MS = 250
LASER_COOLDOWN_MS = 280
MELEE_COOLDOWN_MS = 600
BOT_SHOT_COOLDOWN_MS = 1400
BOT_AIM_NOISE = 0.20
TICK_RATE = 20
NUM_BOTS = 3
RANKED_MIN_REAL_PLAYERS = 2
BOT_NAMES = ["BLAZE-7", "VORTEX", "RAVEN-X", "GHOST-9", "TITAN", "CYPHER"]


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
        self.players[bot.id] = bot
        logger.info("Bot spawned: %s (%s)", name, bot.id)

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

    def raycast_hit(self, shooter: Player) -> Optional[Player]:
        cp = math.cos(shooter.pitch)
        dx = math.sin(shooter.yaw) * cp
        dy = math.sin(shooter.pitch)
        dz = -math.cos(shooter.yaw) * cp
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
        for p in self.players.values():
            if p.id == shooter.id or not p.alive:
                continue
            # 3-sphere capsule hitbox matching visible humanoid (generous - "bigger hitbox")
            base = p.y - PLAYER_HEIGHT
            spheres = [
                (p.x, base + 1.65, p.z, 0.55),  # head
                (p.x, base + 1.05, p.z, 0.75),  # torso
                (p.x, base + 0.45, p.z, 0.60),  # legs
            ]
            best_part_t = None
            for (cx, cy, cz, r) in spheres:
                t = sphere_t(cx, cy, cz, r)
                if t is not None and (best_part_t is None or t < best_part_t):
                    best_part_t = t
            if best_part_t is None:
                continue
            if best_part_t < best_t and best_part_t < occlusion_t:
                best_t = best_part_t
                best = p
        return best

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

    async def _apply_shoot(self, shooter: Player, damage: int):
        """Resolve a shoot action from shooter: append events + apply damage + persist stats."""
        self.events.append({
            "type": "shot",
            "shooter_id": shooter.id,
            "x": shooter.x, "y": shooter.y, "z": shooter.z,
            "yaw": shooter.yaw, "pitch": shooter.pitch,
            "weapon": getattr(shooter, "weapon", "ak47"),
        })
        hit = self.raycast_hit(shooter)
        if hit and hit.alive:
            # Spawn invulnerability protection
            if time.time() < hit.invuln_until:
                return
            hit.hp -= damage
            hit.last_attacker = shooter.id
            self.events.append({
                "type": "hit",
                "shooter_id": shooter.id,
                "victim_id": hit.id,
                "hp": max(0, hit.hp),
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
                })
                # Persist only for real users
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
        elif mtype == "shoot":
            now_ms = int(time.time() * 1000)
            if not player.alive:
                return
            weapon = msg.get("weapon", "ak47")
            cooldown = LASER_COOLDOWN_MS if weapon == "laser" else SHOT_COOLDOWN_MS
            if now_ms - player.last_shot_ms < cooldown:
                return
            player.last_shot_ms = now_ms
            if "yaw" in msg:
                player.yaw = float(msg["yaw"])
            if "pitch" in msg:
                player.pitch = float(msg["pitch"])
            player.weapon = weapon
            dmg = LASER_DAMAGE if weapon == "laser" else SHOT_DAMAGE
            await self._apply_shoot(player, dmg)
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

    async def _update_bots(self, dt: float):
        now_ms = int(time.time() * 1000)
        for bot in list(self.players.values()):
            if not bot.is_bot or not bot.alive:
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

        # Respawn dead
        for p in self.players.values():
            if not p.alive and now >= p.respawn_at:
                x, z = random_spawn()
                p.x, p.z = float(x), float(z)
                p.y = PLAYER_HEIGHT
                p.hp = p.max_hp
                p.alive = True
                p.invuln_until = now + 3.0
                self.events.append({"type": "respawn", "id": p.id})

        # Bot AI (still runs during queue, just for atmosphere)
        await self._update_bots(dt)

        state = {
            "type": "state",
            "t": int(now * 1000),
            "players": [p.to_state() for p in self.players.values()],
            "events": self.events,
            "is_ranked": self.is_ranked,
            "time_left": max(0.0, self.match_duration - (now - self.match_start)) if (self.is_ranked and not in_queue) else None,
            "in_intermission": self.in_intermission,
            "in_queue": in_queue,
            "real_count": real_count,
            "min_real_players": RANKED_MIN_REAL_PLAYERS,
        }
        self.events = []
        await self.broadcast(state)

    async def end_match(self):
        """End a ranked match: award rank points to real players, broadcast standings, reset."""
        self.in_intermission = True
        real_players = [p for p in self.players.values() if not p.is_bot and p.user_id]
        real_players.sort(key=lambda p: p.kills, reverse=True)
        rewards = [30, 15, 5]
        placements = []
        for i, p in enumerate(real_players):
            if i < len(rewards):
                delta = rewards[i]
            else:
                delta = -10
            new_points = 0
            try:
                udoc = await db.users.find_one({"_id": ObjectId(p.user_id)})
                cur = int((udoc or {}).get("rank_points", 0) or 0)
                new_points = max(0, cur + delta)
                tier_idx, tier_name = rank_for_points(new_points)
                await db.users.update_one(
                    {"_id": ObjectId(p.user_id)},
                    {"$set": {"rank_points": new_points}, "$inc": {"stats.matches": 1}},
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
                "new_points": new_points,
                "rank_tier": tier_idx,
                "rank_name": tier_name,
            })

        payload = {"type": "match_end", "placements": placements, "duration": self.match_duration}
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
                if self.is_ranked and not self.in_intermission:
                    real_count = sum(1 for p in self.players.values() if not p.is_bot)
                    if real_count >= RANKED_MIN_REAL_PLAYERS:
                        if time.time() - self.match_start >= self.match_duration:
                            await self.end_match()
                            continue
                await self.tick()
            except Exception as e:
                logger.exception("tick error: %s", e)
            await asyncio.sleep(interval)


game_room = GameRoom(is_ranked=False)
ranked_room = GameRoom(is_ranked=True, match_duration=300.0)

# -------------------------------------------------------------------
# Ranked Matchmaking Queue
# -------------------------------------------------------------------
QUEUE_LOCK = asyncio.Lock()
RANKED_QUEUE: Dict[int, List[dict]] = {i: [] for i in range(len(RANK_TIERS))}
MATCHED_USERS: Dict[str, dict] = {}  # user_id -> {match_id, tier}


async def matchmaker_loop():
    while True:
        try:
            async with QUEUE_LOCK:
                for tier_idx, q in RANKED_QUEUE.items():
                    while len(q) >= 2:
                        a = q.pop(0)
                        b = q.pop(0)
                        mid = uuid.uuid4().hex[:10]
                        MATCHED_USERS[a["user_id"]] = {"match_id": mid, "tier": tier_idx, "matched_at": time.time()}
                        MATCHED_USERS[b["user_id"]] = {"match_id": mid, "tier": tier_idx, "matched_at": time.time()}
                        logger.info("Matched tier=%d %s vs %s (mid=%s)", tier_idx, a["username"], b["username"], mid)
        except Exception as e:
            logger.warning("matchmaker error: %s", e)
        await asyncio.sleep(0.5)


@api.post("/queue/ranked")
async def queue_ranked_join(user: dict = Depends(get_current_user)):
    user_id = str(user["_id"])
    points = int(user.get("rank_points", 0) or 0)
    tier_idx, tier_name = rank_for_points(points)
    async with QUEUE_LOCK:
        if user_id in MATCHED_USERS:
            m = MATCHED_USERS[user_id]
            return {"matched": True, "match_id": m["match_id"], "tier": m["tier"], "tier_name": tier_name}
        for q in RANKED_QUEUE.values():
            for e in q:
                if e["user_id"] == user_id:
                    return {"in_queue": True, "tier": tier_idx, "tier_name": tier_name, "position": q.index(e) + 1, "tier_size": len(q)}
        RANKED_QUEUE[tier_idx].append({
            "user_id": user_id,
            "username": user.get("username", ""),
            "joined_at": time.time(),
        })
    return {"in_queue": True, "tier": tier_idx, "tier_name": tier_name, "position": len(RANKED_QUEUE[tier_idx]), "tier_size": len(RANKED_QUEUE[tier_idx])}


@api.get("/queue/ranked")
async def queue_ranked_status(user: dict = Depends(get_current_user)):
    user_id = str(user["_id"])
    points = int(user.get("rank_points", 0) or 0)
    tier_idx, tier_name = rank_for_points(points)
    if user_id in MATCHED_USERS:
        m = MATCHED_USERS[user_id]
        return {"matched": True, "match_id": m["match_id"], "tier": m["tier"], "tier_name": tier_name}
    for ti, q in RANKED_QUEUE.items():
        for i, e in enumerate(q):
            if e["user_id"] == user_id:
                return {"in_queue": True, "tier": ti, "tier_name": tier_name, "position": i + 1, "tier_size": len(q)}
    return {"in_queue": False, "matched": False, "tier": tier_idx, "tier_name": tier_name}


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

    room = ranked_room if mode == "ranked" else game_room
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
