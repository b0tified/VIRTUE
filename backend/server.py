from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import asyncio
import json
import logging
import math
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
ACCESS_TTL_MIN = 60 * 24  # 1 day so WS doesn't expire mid-match
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
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "username": user.get("username", user["email"].split("@")[0]),
        "role": user.get("role", "user"),
        "stats": user.get("stats", {"kills": 0, "deaths": 0, "matches": 0, "wins": 0}),
        "created_at": user.get("created_at").isoformat() if isinstance(user.get("created_at"), datetime) else user.get("created_at"),
    }


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
    # Seed admin
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

    # Start game loop
    asyncio.create_task(game_room.run())


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
    cursor = db.users.find({}, {"_id": 0, "username": 1, "stats": 1, "email": 1}).sort([("stats.kills", -1)]).limit(50)
    rows = []
    async for u in cursor:
        s = u.get("stats", {})
        kills = s.get("kills", 0)
        deaths = s.get("deaths", 0)
        rows.append({
            "username": u.get("username", u.get("email", "anon")),
            "kills": kills,
            "deaths": deaths,
            "matches": s.get("matches", 0),
            "wins": s.get("wins", 0),
            "kd": round(kills / deaths, 2) if deaths > 0 else float(kills),
        })
    return rows


@api.get("/profile/me")
async def profile_me(user: dict = Depends(get_current_user)):
    return public_user(user)


# -------------------------------------------------------------------
# Game Server (Free-For-All Deathmatch)
# -------------------------------------------------------------------
ARENA = {
    "size": 50,  # half-extent: arena spans -50..50 on x/z
    "obstacles": [
        # (x, z, w, h, d)
        {"x": 0, "z": 0, "w": 6, "h": 4, "d": 6},
        {"x": 15, "z": 10, "w": 4, "h": 3, "d": 8},
        {"x": -15, "z": -10, "w": 8, "h": 3, "d": 4},
        {"x": -18, "z": 15, "w": 4, "h": 5, "d": 4},
        {"x": 20, "z": -18, "w": 6, "h": 4, "d": 4},
        {"x": -5, "z": 20, "w": 10, "h": 3, "d": 3},
        {"x": 8, "z": -22, "w": 3, "h": 6, "d": 3},
        {"x": -25, "z": 0, "w": 3, "h": 4, "d": 10},
        {"x": 25, "z": 5, "w": 3, "h": 4, "d": 10},
    ]
}

SPAWN_POINTS = [
    (30, 30), (-30, 30), (30, -30), (-30, -30),
    (0, 35), (0, -35), (35, 0), (-35, 0),
]

PLAYER_RADIUS = 0.5
PLAYER_HEIGHT = 1.8
MAX_HP = 100
SHOT_DAMAGE = 25
SHOT_RANGE = 100
SHOT_COOLDOWN_MS = 250
TICK_RATE = 20  # Hz


def random_spawn():
    import random
    return random.choice(SPAWN_POINTS)


class Player:
    def __init__(self, ws: WebSocket, user: dict):
        self.ws = ws
        self.user_id = str(user["_id"])
        self.username = user.get("username", user["email"].split("@")[0])
        self.id = uuid.uuid4().hex
        x, z = random_spawn()
        self.x = float(x)
        self.y = PLAYER_HEIGHT
        self.z = float(z)
        self.yaw = 0.0
        self.pitch = 0.0
        self.hp = MAX_HP
        self.kills = 0
        self.deaths = 0
        self.alive = True
        self.last_shot_ms = 0
        self.respawn_at = 0.0
        self.last_attacker: Optional[str] = None

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
        }


class GameRoom:
    def __init__(self):
        self.players: Dict[str, Player] = {}
        self.events: List[dict] = []  # kill feed / shot events broadcast each tick
        self.lock = asyncio.Lock()

    async def add(self, player: Player):
        async with self.lock:
            self.players[player.id] = player
        await self._send(player, {"type": "welcome", "you": player.to_state(), "arena": ARENA})
        await self.broadcast({"type": "join", "player": player.to_state()})

    async def remove(self, player: Player):
        async with self.lock:
            self.players.pop(player.id, None)
        await self.broadcast({"type": "leave", "id": player.id})

    async def _send(self, player: Player, msg: dict):
        try:
            await player.ws.send_text(json.dumps(msg))
        except Exception:
            pass

    async def broadcast(self, msg: dict):
        data = json.dumps(msg)
        dead = []
        for p in list(self.players.values()):
            try:
                await p.ws.send_text(data)
            except Exception:
                dead.append(p)
        for p in dead:
            self.players.pop(p.id, None)

    def collides_obstacle(self, x: float, z: float) -> bool:
        # Bounds
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

    def raycast_hit(self, shooter: Player) -> Optional[Player]:
        """Find first player hit by ray from shooter pos along shooter.yaw/pitch."""
        # Ray direction
        cp = math.cos(shooter.pitch)
        dx = math.sin(shooter.yaw) * cp
        dy = math.sin(shooter.pitch)
        dz = -math.cos(shooter.yaw) * cp  # forward = -Z when yaw=0
        ox, oy, oz = shooter.x, shooter.y, shooter.z

        # Compute t-distance to obstacles (AABBs) for occlusion
        def aabb_t(ob):
            # Box from min to max
            mn = (ob["x"] - ob["w"] / 2, 0.0, ob["z"] - ob["d"] / 2)
            mx = (ob["x"] + ob["w"] / 2, ob["h"], ob["z"] + ob["d"] / 2)
            tmin = 0.0
            tmax = SHOT_RANGE
            for i, (o, d, lo, hi) in enumerate([
                (ox, dx, mn[0], mx[0]),
                (oy, dy, mn[1], mx[1]),
                (oz, dz, mn[2], mx[2]),
            ]):
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

        # For each other player, check ray-sphere
        best_t = SHOT_RANGE
        best: Optional[Player] = None
        for p in self.players.values():
            if p.id == shooter.id or not p.alive:
                continue
            # Sphere center at player position (mid body)
            cx, cy, cz = p.x, p.y - PLAYER_HEIGHT / 2 + 0.9, p.z
            mx, my, mz = ox - cx, oy - cy, oz - cz
            b = mx * dx + my * dy + mz * dz
            c = mx * mx + my * my + mz * mz - (PLAYER_RADIUS + 0.3) ** 2
            disc = b * b - c
            if disc < 0:
                continue
            t = -b - math.sqrt(disc)
            if t < 0:
                t = -b + math.sqrt(disc)
            if t < 0 or t > SHOT_RANGE:
                continue
            if t < best_t and t < occlusion_t:
                best_t = t
                best = p
        return best

    async def handle_message(self, player: Player, msg: dict):
        mtype = msg.get("type")
        if mtype == "input":
            # Movement: server-authoritative, validate distance
            x = float(msg.get("x", player.x))
            z = float(msg.get("z", player.z))
            yaw = float(msg.get("yaw", player.yaw))
            pitch = float(msg.get("pitch", player.pitch))
            # cap movement delta per tick (~ max sprint 8 units/s * 1/20 + slack)
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
            if now_ms - player.last_shot_ms < SHOT_COOLDOWN_MS:
                return
            player.last_shot_ms = now_ms
            # Use latest yaw/pitch from client if present
            if "yaw" in msg:
                player.yaw = float(msg["yaw"])
            if "pitch" in msg:
                player.pitch = float(msg["pitch"])
            self.events.append({
                "type": "shot",
                "shooter_id": player.id,
                "x": player.x, "y": player.y, "z": player.z,
                "yaw": player.yaw, "pitch": player.pitch,
            })
            hit = self.raycast_hit(player)
            if hit and hit.alive:
                hit.hp -= SHOT_DAMAGE
                hit.last_attacker = player.id
                self.events.append({
                    "type": "hit",
                    "shooter_id": player.id,
                    "victim_id": hit.id,
                    "hp": max(0, hit.hp),
                })
                if hit.hp <= 0:
                    hit.alive = False
                    hit.hp = 0
                    hit.deaths += 1
                    player.kills += 1
                    hit.respawn_at = time.time() + 3.0
                    self.events.append({
                        "type": "kill",
                        "shooter_id": player.id,
                        "shooter_name": player.username,
                        "victim_id": hit.id,
                        "victim_name": hit.username,
                    })
                    # Persist stats
                    try:
                        await db.users.update_one({"_id": ObjectId(player.user_id)}, {"$inc": {"stats.kills": 1}})
                        await db.users.update_one({"_id": ObjectId(hit.user_id)}, {"$inc": {"stats.deaths": 1}})
                    except Exception:
                        pass

    async def tick(self):
        # Respawn dead players
        now = time.time()
        for p in self.players.values():
            if not p.alive and now >= p.respawn_at:
                x, z = random_spawn()
                p.x, p.z = float(x), float(z)
                p.y = PLAYER_HEIGHT
                p.hp = MAX_HP
                p.alive = True
                self.events.append({"type": "respawn", "id": p.id})

        state = {
            "type": "state",
            "t": int(now * 1000),
            "players": [p.to_state() for p in self.players.values()],
            "events": self.events,
        }
        self.events = []
        await self.broadcast(state)

    async def run(self):
        interval = 1.0 / TICK_RATE
        while True:
            try:
                await self.tick()
            except Exception as e:
                logger.exception("tick error: %s", e)
            await asyncio.sleep(interval)


game_room = GameRoom()


# -------------------------------------------------------------------
# WebSocket endpoint
# -------------------------------------------------------------------
@api.websocket("/ws/game")
async def ws_game(websocket: WebSocket, token: Optional[str] = Query(default=None)):
    # Auth: try cookie first, then token query param
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

    await websocket.accept()
    player = Player(websocket, user)
    await game_room.add(player)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            await game_room.handle_message(player, msg)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("ws error: %s", e)
    finally:
        await game_room.remove(player)


@api.get("/")
async def root():
    return {"message": "Shooter PvP API", "players_online": len(game_room.players)}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
