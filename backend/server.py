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
from typing import Optional, Dict, Any, List, Tuple

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
    # Owned skins always include the free Recruit default — keeps the UI
    # simple even for accounts created before skins existed.
    owned = list(user.get("owned_skins", []) or [])
    if "default" not in owned:
        owned = ["default", *owned]
    selected = user.get("selected_skin") or "default"
    if selected not in owned:
        selected = "default"
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
        "coins": int(user.get("coins", 0) or 0),
        "owned_skins": owned,
        "selected_skin": selected,
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

# RP deltas by placement at end of a ranked match. Tiered so that:
#  - Bronze/Silver use the old generous curve (+30/+15/+5/-10).
#  - Gold (idx 2) raises loss to -20.
#  - At Platinum+ (idx >= 3), only 1st place gains RP; 2nd/3rd earn 0,
#    and losses ramp to -40 / -60 / -60 / -60 / -60 (capped at Diamond+).
# `compute_rp_delta(placement, tier_idx)` returns the RP delta a player
# with `tier_idx` rank earns for finishing at `placement` (1-indexed,
# placement is relative to *all participants* including bots).
LOSS_BY_TIER = [-10, -10, -20, -40, -60, -60, -60, -60]


def compute_rp_delta(placement: int, tier_idx: int) -> int:
    """RP delta for a single player finishing at `placement` while sitting
    in `tier_idx` going into the match.

    Above Platinum (tier_idx >= 3) ranked is a "first or nothing" race:
    only 1st place gains points and everyone outside the podium still
    loses the tier's loss amount. Below Platinum, the original podium
    rewards (30/15/5) still apply.
    """
    tier_idx = max(0, min(len(LOSS_BY_TIER) - 1, int(tier_idx)))
    loss = LOSS_BY_TIER[tier_idx]
    if tier_idx >= 3:
        # Platinum and above: only 1st place gains. 2nd & 3rd are "safe"
        # (no loss, no gain). 4th and below take the full tier loss.
        if placement == 1:
            return 30
        if placement in (2, 3):
            return 0
        return loss
    # Bronze, Silver, Gold: classic podium curve.
    if placement == 1:
        return 30
    if placement == 2:
        return 15
    if placement == 3:
        return 5
    return loss


def rank_for_points(points: int):
    idx = 0
    name = RANK_TIERS[0][1]
    for i, (threshold, n) in enumerate(RANK_TIERS):
        if points >= threshold:
            idx = i
            name = n
    return idx, name


# -------------------------------------------------------------------
# Skins + In-Game Currency (COINS)
# -------------------------------------------------------------------
# Coins are earned ONLY via redeem codes + automatic level-up rewards.
# No in-match earning — kills/wins don't grant coins (kept that way so
# the economy can be tuned later via promo events).
COINS_PER_LEVEL = 100  # awarded once per level the player reaches.

# Catalog of player skins. The "default" skin is free + auto-owned by every
# user. All paid skins recolor the humanoid (head/torso/limbs/accent) and
# render an animated aura ring around the player at their feet.
# Aura `mode`s drive the engine's per-frame animation:
#   - "none":   no aura
#   - "pulse":  steady opacity pulse (soft glow)
#   - "spin":   rotating dual-tone ring
#   - "flicker": sharp on/off flicker (ghost effect)
SKINS_CATALOG: List[dict] = [
    # ─── Free / unlock skins ────────────────────────────────────────────
    {"id": "default",  "name": "Recruit",        "price": 0,    "rarity": "common",    "obtain": "free",
     "body": 0xe62429, "leg": 0x1a1a1a, "head": 0xf2c08a, "accent": 0xffd700,
     "helmet": None,    "visor": None,     "shoulder": None,  "stripe": None,    "belt": 0x4a2a0a, "cape": None,
     "aura": 0x000000, "aura_mode": "none"},

    {"id": "mech",     "name": "Mech Recruit",   "price": 0,    "rarity": "rare",      "obtain": "first_match",
     "body": 0x6f7886, "leg": 0x383e48, "head": 0x6f7886, "accent": 0x00e5ff,
     "helmet": 0x4a525c, "visor": 0x00e5ff, "shoulder": 0x383e48, "stripe": 0x00e5ff, "belt": 0x2a2f37, "cape": None,
     "aura": 0x00b8d4, "aura_mode": "pulse"},

    # ─── Common ─────────────────────────────────────────────────────────
    {"id": "azure",    "name": "Azure Ranger",   "price": 200,  "rarity": "common",    "obtain": "shop",
     "body": 0x0055ff, "leg": 0x0a2a6b, "head": 0xf2c08a, "accent": 0x9adcff,
     "helmet": 0x0a2a6b, "visor": 0xffffff, "shoulder": 0x9adcff, "stripe": 0x9adcff, "belt": 0x9adcff, "cape": None,
     "aura": 0x4ab8ff, "aura_mode": "pulse"},

    # ─── Rare ───────────────────────────────────────────────────────────
    {"id": "neon",     "name": "Neon Cyan",      "price": 500,  "rarity": "rare",      "obtain": "shop",
     "body": 0x00cfff, "leg": 0x004b6b, "head": 0xf2c08a, "accent": 0xffffff,
     "helmet": 0x004b6b, "visor": 0xff00d4, "shoulder": 0x00ffff, "stripe": 0xff00d4, "belt": 0x002a3a, "cape": None,
     "aura": 0x00ffff, "aura_mode": "pulse"},

    {"id": "crimson",  "name": "Crimson Rogue",  "price": 800,  "rarity": "rare",      "obtain": "shop",
     "body": 0x6b0010, "leg": 0x1a0306, "head": 0xf2c08a, "accent": 0xff3a3a,
     "helmet": 0x2a0307, "visor": 0xff3a3a, "shoulder": 0xff3a3a, "stripe": 0xff3a3a, "belt": 0x0a0000, "cape": 0x3a0008,
     "aura": 0xff1a1a, "aura_mode": "spin"},

    # ─── Epic ───────────────────────────────────────────────────────────
    {"id": "ghost",    "name": "Ghost White",    "price": 1200, "rarity": "epic",      "obtain": "shop",
     "body": 0xeeeeee, "leg": 0x9aa0a8, "head": 0xeeeeee, "accent": 0x6cb0ff,
     "helmet": 0xc8cdd2, "visor": 0x6cb0ff, "shoulder": 0xffffff, "stripe": 0x6cb0ff, "belt": 0x9aa0a8, "cape": 0xffffff,
     "aura": 0xffffff, "aura_mode": "flicker"},

    {"id": "verdant",  "name": "Verdant Hunter", "price": 1500, "rarity": "epic",      "obtain": "shop",
     "body": 0x1d6b29, "leg": 0x0d3a16, "head": 0xf2c08a, "accent": 0xe8ff7a,
     "helmet": 0x0d3a16, "visor": 0xe8ff7a, "shoulder": 0x6cff5e, "stripe": 0xe8ff7a, "belt": 0x4a3a1a, "cape": 0x2a5a16,
     "aura": 0x6cff5e, "aura_mode": "pulse"},

    # ─── Legendary ──────────────────────────────────────────────────────
    {"id": "void",     "name": "Void Walker",    "price": 2000, "rarity": "legendary", "obtain": "shop",
     "body": 0x14002a, "leg": 0x000000, "head": 0xb88be0, "accent": 0xd400ff,
     "helmet": 0x000000, "visor": 0xd400ff, "shoulder": 0xd400ff, "stripe": 0xd400ff, "belt": 0x05000a, "cape": 0x1a002a,
     "aura": 0xb000ff, "aura_mode": "spin"},

    {"id": "golden",   "name": "Golden Apex",    "price": 3000, "rarity": "legendary", "obtain": "shop",
     "body": 0xffc700, "leg": 0x6b4d00, "head": 0xf2c08a, "accent": 0xffffff,
     "helmet": 0x6b4d00, "visor": 0xffffff, "shoulder": 0xffd700, "stripe": 0xffffff, "belt": 0x4a3500, "cape": 0xffd700,
     "aura": 0xffd700, "aura_mode": "spin"},

    # ─── New animated shop skins ─────────────────────────────────────────
    {"id": "prism",    "name": "Prism Hunter",   "price": 2500, "rarity": "epic",      "obtain": "shop",
     "body": 0xffffff, "leg": 0x222244, "head": 0xf2c08a, "accent": 0xff00ff,
     "helmet": 0x222244, "visor": 0xff00ff, "shoulder": 0x00ffff, "stripe": 0xffff00, "belt": 0x222244, "cape": 0xffffff,
     "aura": 0xff00ff, "aura_mode": "rainbow"},

    {"id": "inferno",  "name": "Inferno Lord",   "price": 4500, "rarity": "legendary", "obtain": "shop",
     "body": 0x6b0010, "leg": 0x2a0000, "head": 0xff8800, "accent": 0xffd700,
     "helmet": 0x3a0000, "visor": 0xff5500, "shoulder": 0xff5500, "stripe": 0xffd700, "belt": 0x1a0000, "cape": 0xff5500,
     "aura": 0xff5500, "aura_mode": "flame"},

    {"id": "glacier",  "name": "Glacier Mage",   "price": 2200, "rarity": "epic",      "obtain": "shop",
     "body": 0x9adcff, "leg": 0x0a2a6b, "head": 0xeaf6ff, "accent": 0xffffff,
     "helmet": 0x0a2a6b, "visor": 0x9adcff, "shoulder": 0xeaf6ff, "stripe": 0xffffff, "belt": 0x0a2a6b, "cape": 0xeaf6ff,
     "aura": 0x9adcff, "aura_mode": "frost"},

    {"id": "toxic",    "name": "Toxic Sniper",   "price": 1100, "rarity": "rare",      "obtain": "shop",
     "body": 0x0d3a16, "leg": 0x05130a, "head": 0xc8ffa8, "accent": 0x6cff5e,
     "helmet": 0x05130a, "visor": 0x6cff5e, "shoulder": 0x6cff5e, "stripe": 0xc8ffa8, "belt": 0x05130a, "cape": None,
     "aura": 0x6cff5e, "aura_mode": "flicker"},

    {"id": "cosmic",   "name": "Cosmic Drift",   "price": 3800, "rarity": "legendary", "obtain": "shop",
     "body": 0x1a0033, "leg": 0x000022, "head": 0xc8a8ff, "accent": 0xff00ff,
     "helmet": 0x000022, "visor": 0x00ffff, "shoulder": 0xff00ff, "stripe": 0x00ffff, "belt": 0x000022, "cape": 0xff00ff,
     "aura": 0xff00ff, "aura_mode": "comet"},

    # ─── Beach / swimsuit drop ───────────────────────────────────────────
    # Male: bare-chested surfer. Body == head skin tone so the torso reads
    # as skin, "leg" is swim trunks, accent is a bright lanyard/tan stripe.
    # No helmet/visor/cape — beach vibes only. Sandy aura.
    {"id": "beach_bro", "name": "Beach Bro",      "price": 900,  "rarity": "rare",      "obtain": "shop",
     "body": 0xf2c08a, "leg": 0xff4a6b, "head": 0xf2c08a, "accent": 0x00d4ff,
     "helmet": None,   "visor": None,    "shoulder": None,  "stripe": 0xffd700,
     "belt": 0xffd700, "cape": None,
     "aura": 0xffd770, "aura_mode": "pulse"},

    # Female: bikini + bare legs + cute sunglasses + long hair. Body =
    # skin tone (bare torso), bikini fabric uses `stripe` colour (pink),
    # accent is the gold bow detail. Visor = sunglasses. Floral aura.
    {"id": "sun_goddess", "name": "Sun Goddess",  "price": 950,  "rarity": "rare",      "obtain": "shop",
     "body": 0xf2c08a, "leg": 0xf2c08a, "head": 0xf2c08a, "accent": 0xffd700,
     "helmet": None,   "visor": 0x1a1a1a, "shoulder": None,  "stripe": 0xff3a6b,
     "belt": 0xff3a6b, "cape": None,
     "hair": 0x6b3a1a, "bikini": True,
     "aura": 0xff80c0, "aura_mode": "spin"},

    # ─── Season-pass exclusive (not in shop) ────────────────────────────
    {"id": "solar",    "name": "Solar Inferno",  "price": 0,    "rarity": "epic",      "obtain": "pass_tier_10",
     "body": 0xff5500, "leg": 0x6b1a00, "head": 0xf2c08a, "accent": 0xffd700,
     "helmet": 0x6b1a00, "visor": 0xffd700, "shoulder": 0xff8a00, "stripe": 0xffd700, "belt": 0x3a0a00, "cape": 0xff8a00,
     "aura": 0xff8a00, "aura_mode": "pulse"},

    {"id": "cyber",    "name": "Cyber Wraith",   "price": 0,    "rarity": "epic",      "obtain": "pass_tier_20",
     "body": 0x1a1a3a, "leg": 0x05051a, "head": 0xbac4d6, "accent": 0x00ffaa,
     "helmet": 0x05051a, "visor": 0x00ffaa, "shoulder": 0x00ffaa, "stripe": 0x00ffaa, "belt": 0x0a0a2a, "cape": 0x00ffaa,
     "aura": 0x00ffaa, "aura_mode": "flicker"},

    {"id": "quantum",  "name": "Quantum Reaver", "price": 0,    "rarity": "legendary", "obtain": "pass_tier_30",
     "body": 0x4b0082, "leg": 0x1a0033, "head": 0xc8a8ff, "accent": 0xffffff,
     "helmet": 0x1a0033, "visor": 0xffffff, "shoulder": 0xff00ff, "stripe": 0xffffff, "belt": 0x4b0082, "cape": 0xff00ff,
     "aura": 0xff00ff, "aura_mode": "spin"},
]
SKINS_BY_ID: Dict[str, dict] = {s["id"]: s for s in SKINS_CATALOG}


def skin_for_user(user: dict) -> dict:
    """Resolve the currently equipped skin definition for `user`.
    Always returns a valid skin (falls back to 'default' if equipped skin
    has been removed from the catalog)."""
    sid = (user or {}).get("selected_skin") or "default"
    return SKINS_BY_ID.get(sid) or SKINS_BY_ID["default"]


async def credit_level_coins(user: dict) -> dict:
    """Auto-grants level-up coins idempotently. Each time the player's
    computed level exceeds `coins_credited_for_level`, we top up by
    `(new_level - prev) * COINS_PER_LEVEL`. Called from auth/me, profile/me,
    and after stat-changing endpoints so the wallet always reflects current
    level milestones. Mutates the in-memory `user` dict and persists."""
    if not user:
        return user
    lvl = compute_level(user.get("stats", {}))["level"]
    credited = int(user.get("coins_credited_for_level", 0) or 0)
    if lvl > credited:
        bonus = (lvl - credited) * COINS_PER_LEVEL
        new_coins = int(user.get("coins", 0) or 0) + bonus
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"coins": new_coins, "coins_credited_for_level": lvl}},
        )
        user["coins"] = new_coins
        user["coins_credited_for_level"] = lvl
    return user


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
    # difficulty=1.15 — buffed from 0.9 (user feedback: still too easy).
    # They now hit harder + react quicker, but stay under the 1.5 smart-AI
    # threshold so ranked bots remain a step above.
    for name in random.sample(DISGUISED_BOT_NAMES, NUM_BOTS):
        game_room.spawn_bot(name, disguised=True, difficulty=1.15)
    # Shared ranked room: 4 disguised bots so the lobby always feels full
    # (was 1 — players reported "empty match"). difficulty=1.9 matches the
    # bronze ranked-bot baseline; per-bot rank disguise is rerolled to the
    # joining player's actual RP in GameRoom.add() so banners line up.
    ranked_room_bot_names = random.sample(BOT_NAMES, 4)
    for nm in ranked_room_bot_names:
        ranked_room.spawn_bot(nm + "-R", disguised=True, difficulty=1.9)
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


def check_ban(user: dict) -> Optional[dict]:
    """If the user is currently banned/suspended, return a JSON-safe payload
    describing the ban. Otherwise return None. A suspension automatically
    expires when datetime.now(UTC) >= ban.until."""
    ban = user.get("ban") or {}
    status = ban.get("status")
    if status not in ("banned", "suspended"):
        return None
    if status == "suspended":
        until = ban.get("until")
        if isinstance(until, datetime):
            # Mongo stores datetimes as naive UTC; coerce so the
            # comparison below doesn't blow up on offset-naive/aware mix.
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) >= until:
                return None  # expired — caller should clear it
    at = ban.get("at")
    until = ban.get("until")
    if isinstance(at, datetime) and at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    if isinstance(until, datetime) and until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return {
        "status": status,
        "reason": ban.get("reason") or "Violation of community guidelines",
        "until": until.isoformat() if isinstance(until, datetime) else until,
        "at": at.isoformat() if isinstance(at, datetime) else at,
        "by": ban.get("by"),
    }


@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # Block login while banned/suspended. Expired suspensions auto-clear
    # below so the next login attempt succeeds.
    ban = check_ban(user)
    if ban:
        # Surface the ban details so the UI can show "Suspended until …"
        raise HTTPException(status_code=403, detail={"ban": ban, "message": f"Account {ban['status']}"})
    if user.get("ban", {}).get("status") in ("banned", "suspended"):
        # Expired suspension — clear it so future tokens are clean.
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"ban": {"status": "active"}}})
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
    await credit_level_coins(user)
    payload = public_user(user)
    # Surface the player's global leaderboard rank when they're in
    # GOONMASTER (tier 7) — the UI shows it on the lobby PlayerCard.
    # Computed lazily so we don't pay the count for every lower-tier
    # user. The same data is exposed via /api/me/leaderboard_rank for
    # ad-hoc refreshes.
    if payload.get("rank_tier") == 7:
        try:
            higher = await db.users.count_documents({
                "rank_points": {"$gt": int(user.get("rank_points", 0) or 0)}
            })
            payload["leaderboard_rank"] = higher + 1
        except Exception:
            payload["leaderboard_rank"] = None
    return payload


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
    # Same gating as /leaderboard/ranked — exclude players who never
    # touched ranked so the board reflects real ranked activity.
    query = {"placement_matches_played": {"$gte": 1}, "rank_points": {"$gt": 0}}
    cursor = db.users.find(
        query,
        {"username": 1, "rank_points": 1, "stats": 1, "email": 1,
         "placement_matches_played": 1, "is_seeded": 1},
    ).sort([("rank_points", -1), ("stats.kills", -1)]).limit(50)
    # Pseudo-online for seeded accounts: stable 5-minute bucket × username
    # hash. Re-rolls naturally, ~38% appear online at any time.
    import hashlib
    bucket = int(time.time() // 300)
    rows = []
    async for u in cursor:
        s = u.get("stats", {})
        kills = s.get("kills", 0)
        pts = int(u.get("rank_points", 0) or 0)
        idx, name = rank_for_points(pts)
        uid = str(u["_id"])
        username = u.get("username", u.get("email", "anon"))
        # Real players: actual presence. Seeded: deterministic pseudo-online.
        if u.get("is_seeded"):
            h = hashlib.md5(f"{username}:{bucket}".encode()).digest()[0]
            online = h < 97  # ~38% online
            in_match = False
            match_kind = None
        else:
            loc = player_location(uid)
            in_match = loc is not None and loc.get("kind") in ("casual", "ranked", "party")
            match_kind = loc.get("kind") if loc else None
            online = is_online(uid)
        rows.append({
            "id": uid,
            "username": username,
            "kills": kills,
            "deaths": s.get("deaths", 0),
            "matches": s.get("matches", 0),
            "rank_points": pts,
            "rank_tier": idx,
            "rank_name": name,
            "online": online,
            "in_match": in_match,
            "match_kind": match_kind,
        })
    return rows


@api.get("/profile/me")
async def profile_me(user: dict = Depends(get_current_user)):
    await credit_level_coins(user)
    return public_user(user)


# -------------------------------------------------------------------
# Skin Shop — players spend COINS on cosmetic skins.
# -------------------------------------------------------------------
class SkinBuyIn(BaseModel):
    skin_id: str = Field(min_length=1, max_length=64)


class SkinEquipIn(BaseModel):
    skin_id: str = Field(min_length=1, max_length=64)


@api.get("/shop/skins")
async def shop_skins(user: dict = Depends(get_current_user)):
    """Returns the shop-purchasable skin catalog (excludes pass-only and
    other earn-only skins) with ownership flags + the user's coin balance.
    Earn-only skins (mech, season pass tiers) still appear if owned so
    players can equip them, but the shop tab doesn't surface unowned ones
    since they're not buyable here."""
    await credit_level_coins(user)
    owned = set(user.get("owned_skins", []) or [])
    owned.add("default")  # always free
    items = []
    for s in SKINS_CATALOG:
        # Hide unowned non-shop skins from the storefront so they don't
        # look buyable. Earn-only skins (mech, pass_*) only appear after
        # they're owned (then the user can equip them).
        if s.get("obtain") not in ("shop", "free") and s["id"] not in owned:
            continue
        items.append({
            **s,
            "owned": s["id"] in owned,
            "equipped": (user.get("selected_skin") or "default") == s["id"],
        })
    return {
        "coins": int(user.get("coins", 0) or 0),
        "selected_skin": user.get("selected_skin") or "default",
        "items": items,
    }


@api.post("/shop/buy")
async def shop_buy(payload: SkinBuyIn, user: dict = Depends(get_current_user)):
    """Purchase a skin with the player's coin balance. Idempotent: re-buying
    an already-owned skin returns 409. Auto-equips on first purchase so the
    player sees the change immediately."""
    await credit_level_coins(user)
    skin = SKINS_BY_ID.get(payload.skin_id)
    if not skin:
        raise HTTPException(status_code=404, detail="Skin not found.")
    if skin.get("obtain") not in ("shop",):
        # Earn-only skins (mech, season pass) can't be purchased.
        raise HTTPException(status_code=403, detail="This skin can't be purchased.")
    owned = set(user.get("owned_skins", []) or [])
    owned.add("default")
    if skin["id"] in owned:
        raise HTTPException(status_code=409, detail="Already owned.")
    price = int(skin.get("price", 0))
    coins = int(user.get("coins", 0) or 0)
    if coins < price:
        raise HTTPException(status_code=402, detail=f"Not enough coins — needs {price}.")
    new_coins = coins - price
    new_owned = list(owned) + [skin["id"]]
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"coins": new_coins, "owned_skins": new_owned, "selected_skin": skin["id"]}},
    )
    user["coins"] = new_coins
    user["owned_skins"] = new_owned
    user["selected_skin"] = skin["id"]
    return {"ok": True, "skin": skin, "user": public_user(user)}


@api.post("/profile/me/skin")
async def equip_skin(payload: SkinEquipIn, user: dict = Depends(get_current_user)):
    """Equip an already-owned skin. The selected_skin is broadcast in the
    next state tick so other players see the change live."""
    skin = SKINS_BY_ID.get(payload.skin_id)
    if not skin:
        raise HTTPException(status_code=404, detail="Skin not found.")
    owned = set(user.get("owned_skins", []) or [])
    owned.add("default")
    if skin["id"] not in owned:
        raise HTTPException(status_code=403, detail="Skin not owned.")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"selected_skin": skin["id"]}},
    )
    user["selected_skin"] = skin["id"]
    return public_user(user)


# -------------------------------------------------------------------
# Progression: Lifetime Challenges, Daily Challenges, Season Pass
# -------------------------------------------------------------------
# Lifetime challenges (6 big ones) — completion is calculated against
# `stats` so progress is implicit. Each grants a coin reward (and a
# splash of season XP for free) when claimed. Claims are tracked on the
# user under `claimed_challenges`.
LIFETIME_CHALLENGES: List[dict] = [
    {"id": "first_blood",  "name": "First Blood",  "desc": "Get your first kill.",                       "metric": "stats.kills",  "goal": 1,   "coins": 50,   "season_xp": 25},
    {"id": "bloodlust",    "name": "Bloodlust",    "desc": "Eliminate 25 enemies across all matches.",   "metric": "stats.kills",  "goal": 25,  "coins": 200,  "season_xp": 50},
    {"id": "massacre",     "name": "Massacre",     "desc": "Eliminate 100 enemies — true mayhem.",       "metric": "stats.kills",  "goal": 100, "coins": 500,  "season_xp": 100},
    {"id": "veteran",      "name": "Veteran",      "desc": "Play 25 matches to completion.",             "metric": "stats.matches","goal": 25,  "coins": 250,  "season_xp": 75},
    {"id": "champion",     "name": "Champion",     "desc": "Win 5 ranked or quick matches.",             "metric": "stats.wins",   "goal": 5,   "coins": 300,  "season_xp": 75},
    {"id": "apex",         "name": "Apex",         "desc": "Reach account Level 10.",                    "metric": "level",        "goal": 10,  "coins": 1000, "season_xp": 200},
]

# Daily challenge pool. 3 are picked at random per day. Progress is the
# difference between the player's stats today and a snapshot captured when
# the day rolled over. `level` is special-cased (compared to today's start
# level rather than a delta).
DAILY_CHALLENGES_POOL: List[dict] = [
    {"id": "d_kills_5",    "name": "Warm Up",        "desc": "Get 5 kills today.",         "metric": "stats.kills",   "goal": 5,  "coins": 25, "season_xp": 50},
    {"id": "d_kills_10",   "name": "On Fire",        "desc": "Get 10 kills today.",        "metric": "stats.kills",   "goal": 10, "coins": 25, "season_xp": 50},
    {"id": "d_kills_20",   "name": "Rampage",        "desc": "Get 20 kills today.",        "metric": "stats.kills",   "goal": 20, "coins": 25, "season_xp": 50},
    # Stretch kill challenges — bigger goals, juicier rewards.
    {"id": "d_kills_35",   "name": "Massacre",       "desc": "Get 35 kills today.",        "metric": "stats.kills",   "goal": 35, "coins": 40, "season_xp": 80},
    {"id": "d_kills_50",   "name": "Demolition",     "desc": "Get 50 kills today.",        "metric": "stats.kills",   "goal": 50, "coins": 60, "season_xp": 120},
    {"id": "d_match_1",    "name": "Suit Up",        "desc": "Play 1 match today.",        "metric": "stats.matches", "goal": 1,  "coins": 25, "season_xp": 50},
    {"id": "d_match_3",    "name": "Triple Threat",  "desc": "Play 3 matches today.",      "metric": "stats.matches", "goal": 3,  "coins": 25, "season_xp": 50},
    # New match challenges — drives session length.
    {"id": "d_match_5",    "name": "Long Haul",      "desc": "Play 5 matches today.",      "metric": "stats.matches", "goal": 5,  "coins": 35, "season_xp": 70},
    {"id": "d_match_8",    "name": "Iron Will",      "desc": "Play 8 matches today.",      "metric": "stats.matches", "goal": 8,  "coins": 55, "season_xp": 110},
    {"id": "d_win_1",      "name": "Top Frag",       "desc": "Win 1 match today.",         "metric": "stats.wins",    "goal": 1,  "coins": 25, "season_xp": 50},
    # New win challenges — chase the W.
    {"id": "d_win_2",      "name": "Back-to-Back",   "desc": "Win 2 matches today.",       "metric": "stats.wins",    "goal": 2,  "coins": 45, "season_xp": 90},
    {"id": "d_win_3",      "name": "Hat Trick",      "desc": "Win 3 matches today.",       "metric": "stats.wins",    "goal": 3,  "coins": 70, "season_xp": 140},
]
DAILY_PICKS_PER_DAY = 6

# Season pass — 30 tiers. Each tier costs 100 season XP to unlock; rewards
# alternate coin grants with three skin tiers (10/20/30). The track resets
# every season (not implemented yet — for now it's perpetual).
SEASON_XP_PER_TIER = 100
SEASON_MAX_TIER = 30


def _season_tiers() -> List[dict]:
    """Returns the static reward layout for the 30-tier pass. Rebuilt on
    each call so the source of truth lives in code, not the DB."""
    tiers: List[dict] = []
    for i in range(1, SEASON_MAX_TIER + 1):
        if i == 30:
            tiers.append({"tier": i, "reward_type": "skin",  "reward_skin": "quantum", "reward_label": "Quantum Reaver"})
        elif i == 20:
            tiers.append({"tier": i, "reward_type": "skin",  "reward_skin": "cyber",   "reward_label": "Cyber Wraith"})
        elif i == 10:
            tiers.append({"tier": i, "reward_type": "skin",  "reward_skin": "solar",   "reward_label": "Solar Inferno"})
        elif i % 5 == 0:
            tiers.append({"tier": i, "reward_type": "coins", "reward_coins": 500,      "reward_label": "+500 Coins"})
        else:
            tiers.append({"tier": i, "reward_type": "coins", "reward_coins": 100,      "reward_label": "+100 Coins"})
    return tiers


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _challenge_progress(user: dict, ch: dict, snapshot: Optional[dict] = None) -> int:
    """Resolve the current numeric progress of `user` against challenge `ch`.

    For daily challenges, `snapshot` holds the stats values at start-of-day
    and progress = current - snapshot (clamped at 0). For lifetime
    challenges, snapshot is None and progress is the raw metric value.
    """
    metric = ch["metric"]
    if metric == "level":
        cur = compute_level(user.get("stats", {}))["level"]
        return int(cur)
    # stats.X path
    parts = metric.split(".")
    val: Any = user
    for p in parts:
        if isinstance(val, dict):
            val = val.get(p, 0)
        else:
            val = 0
            break
    val = int(val or 0)
    if snapshot is not None:
        snap_val = int((snapshot or {}).get(parts[-1], 0))
        return max(0, val - snap_val)
    return val


async def _ensure_daily_state(user: dict) -> dict:
    """Roll the user's daily-challenge state forward to today if needed.

    Picks `DAILY_PICKS_PER_DAY` distinct challenge IDs, snapshots the
    current stats so progress = today's delta, and persists the bundle.
    Idempotent — re-calls on the same day are no-ops."""
    today = _today_utc()
    ds = user.get("daily_state") or {}
    if ds.get("date") == today and isinstance(ds.get("challenges"), list) and len(ds["challenges"]) == DAILY_PICKS_PER_DAY:
        return ds
    # Roll over: pick fresh challenges + snapshot stats.
    pool_ids = [c["id"] for c in DAILY_CHALLENGES_POOL]
    picks = random.sample(pool_ids, k=min(DAILY_PICKS_PER_DAY, len(pool_ids)))
    stats = user.get("stats", {}) or {}
    snapshot = {
        "kills":   int(stats.get("kills",   0) or 0),
        "deaths":  int(stats.get("deaths",  0) or 0),
        "matches": int(stats.get("matches", 0) or 0),
        "wins":    int(stats.get("wins",    0) or 0),
    }
    new_state = {
        "date": today,
        "challenges": picks,
        "snapshot": snapshot,
        "claimed": {},
    }
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"daily_state": new_state}})
    user["daily_state"] = new_state
    return new_state


async def _grant_first_match_skin(user_id: str) -> None:
    """Awards the free Mech Recruit skin the moment the player records
    their very first match. Idempotent — wrapped in a $addToSet so repeat
    calls are no-ops, and gated on `stats.matches` BEFORE this match was
    booked (the caller does the check)."""
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$addToSet": {"owned_skins": "mech"}},
    )


@api.get("/progression")
async def progression(user: dict = Depends(get_current_user)):
    """Bundle endpoint — returns lifetime challenge progress, today's
    daily challenges, and the 30-tier season pass state in one round-trip.
    The frontend ProgressionModal pulls everything from here."""
    await credit_level_coins(user)
    daily_state = await _ensure_daily_state(user)
    claimed_lifetime: List[str] = list(user.get("claimed_challenges") or [])
    # Lifetime challenges.
    lifetime_out = []
    for ch in LIFETIME_CHALLENGES:
        prog = _challenge_progress(user, ch)
        completed = prog >= ch["goal"]
        claimed = ch["id"] in claimed_lifetime
        lifetime_out.append({**ch, "progress": prog, "completed": completed, "claimed": claimed})
    # Daily challenges (snapshot-relative).
    by_id = {c["id"]: c for c in DAILY_CHALLENGES_POOL}
    claimed_daily = (daily_state.get("claimed") or {})
    daily_out = []
    for cid in daily_state.get("challenges", []):
        ch = by_id.get(cid)
        if not ch:
            continue
        prog = _challenge_progress(user, ch, daily_state.get("snapshot"))
        completed = prog >= ch["goal"]
        daily_out.append({**ch, "progress": prog, "completed": completed, "claimed": bool(claimed_daily.get(cid))})
    # Season pass.
    season_xp = int(user.get("season_xp", 0) or 0)
    season_tier = min(SEASON_MAX_TIER, season_xp // SEASON_XP_PER_TIER)
    season_xp_in_tier = season_xp - season_tier * SEASON_XP_PER_TIER if season_tier < SEASON_MAX_TIER else 0
    tiers = _season_tiers()
    claimed_tiers = set(int(t) for t in (user.get("claimed_season_tiers") or []))
    for t in tiers:
        t["unlocked"] = t["tier"] <= season_tier
        t["claimed"]  = t["tier"] in claimed_tiers
    return {
        "lifetime": lifetime_out,
        "daily": {
            "date": daily_state.get("date"),
            "challenges": daily_out,
        },
        "season": {
            "xp": season_xp,
            "tier": season_tier,
            "xp_in_tier": season_xp_in_tier,
            "xp_per_tier": SEASON_XP_PER_TIER,
            "max_tier": SEASON_MAX_TIER,
            "tiers": tiers,
        },
        "coins": int(user.get("coins", 0) or 0),
    }


class ProgressionClaimIn(BaseModel):
    kind: str = Field(pattern="^(challenge|daily|season)$")
    id: Optional[str] = None
    tier: Optional[int] = None


@api.post("/progression/claim")
async def progression_claim(payload: ProgressionClaimIn, user: dict = Depends(get_current_user)):
    """Claim a completed challenge / daily / season tier and pocket the
    reward. Each claim is one-shot and persisted to the user document so
    re-claims fail with 409."""
    await credit_level_coins(user)
    inc: Dict[str, int] = {}
    set_ops: Dict[str, Any] = {}
    add_to_set: Dict[str, Any] = {}
    label = ""
    granted = {"coins": 0, "season_xp": 0, "skin": None}

    if payload.kind == "challenge":
        ch = next((c for c in LIFETIME_CHALLENGES if c["id"] == payload.id), None)
        if not ch:
            raise HTTPException(status_code=404, detail="Challenge not found.")
        claimed = list(user.get("claimed_challenges") or [])
        if ch["id"] in claimed:
            raise HTTPException(status_code=409, detail="Already claimed.")
        prog = _challenge_progress(user, ch)
        if prog < ch["goal"]:
            raise HTTPException(status_code=400, detail=f"Not yet — {prog}/{ch['goal']}.")
        inc["coins"]     = int(ch.get("coins", 0) or 0)
        inc["season_xp"] = int(ch.get("season_xp", 0) or 0)
        add_to_set["claimed_challenges"] = ch["id"]
        granted["coins"]     = inc["coins"]
        granted["season_xp"] = inc["season_xp"]
        label = f"{ch['name']} — claimed!"

    elif payload.kind == "daily":
        daily_state = await _ensure_daily_state(user)
        cid = payload.id
        if not cid or cid not in (daily_state.get("challenges") or []):
            raise HTTPException(status_code=404, detail="Not one of today's challenges.")
        if (daily_state.get("claimed") or {}).get(cid):
            raise HTTPException(status_code=409, detail="Already claimed.")
        ch = next((c for c in DAILY_CHALLENGES_POOL if c["id"] == cid), None)
        if not ch:
            raise HTTPException(status_code=404, detail="Challenge not found.")
        prog = _challenge_progress(user, ch, daily_state.get("snapshot"))
        if prog < ch["goal"]:
            raise HTTPException(status_code=400, detail=f"Not yet — {prog}/{ch['goal']}.")
        new_state = dict(daily_state)
        new_state["claimed"] = {**(daily_state.get("claimed") or {}), cid: True}
        set_ops["daily_state"] = new_state
        inc["coins"]     = int(ch.get("coins", 0) or 0)
        inc["season_xp"] = int(ch.get("season_xp", 0) or 0)
        granted["coins"]     = inc["coins"]
        granted["season_xp"] = inc["season_xp"]
        label = f"{ch['name']} — daily claimed!"

    elif payload.kind == "season":
        tier = int(payload.tier or 0)
        if tier < 1 or tier > SEASON_MAX_TIER:
            raise HTTPException(status_code=400, detail="Invalid tier.")
        season_xp = int(user.get("season_xp", 0) or 0)
        unlocked = season_xp // SEASON_XP_PER_TIER
        if tier > unlocked:
            raise HTTPException(status_code=400, detail=f"Tier {tier} not unlocked yet.")
        claimed_tiers = set(int(t) for t in (user.get("claimed_season_tiers") or []))
        if tier in claimed_tiers:
            raise HTTPException(status_code=409, detail="Tier already claimed.")
        layout = _season_tiers()
        reward = next((t for t in layout if t["tier"] == tier), None)
        if not reward:
            raise HTTPException(status_code=404, detail="Tier reward missing.")
        if reward["reward_type"] == "coins":
            inc["coins"] = int(reward.get("reward_coins", 0))
            granted["coins"] = inc["coins"]
        elif reward["reward_type"] == "skin":
            sid = reward["reward_skin"]
            add_to_set["owned_skins"] = sid
            granted["skin"] = sid
        label = f"Season Pass Tier {tier} — {reward['reward_label']}"
        # Build the update doc — both 'owned_skins' and 'claimed_season_tiers'
        # go through $addToSet, but Mongo only accepts one $addToSet stage,
        # so we merge them into a single ops object.
        update_ops: Dict[str, Any] = {}
        if inc:
            update_ops["$inc"] = inc
        if set_ops:
            update_ops["$set"] = set_ops
        ats: Dict[str, Any] = {}
        if "owned_skins" in add_to_set:
            ats["owned_skins"] = add_to_set["owned_skins"]
        ats["claimed_season_tiers"] = tier
        update_ops["$addToSet"] = ats
        await db.users.update_one({"_id": user["_id"]}, update_ops)
        fresh = await db.users.find_one({"_id": user["_id"]})
        return {"ok": True, "label": label, "granted": granted, "user": public_user(fresh) if fresh else None}

    # Common write path for challenge + daily.
    update_ops = {}
    if inc:
        update_ops["$inc"] = inc
    if set_ops:
        update_ops["$set"] = set_ops
    if add_to_set:
        update_ops["$addToSet"] = add_to_set
    if update_ops:
        await db.users.update_one({"_id": user["_id"]}, update_ops)
    fresh = await db.users.find_one({"_id": user["_id"]})
    return {"ok": True, "label": label, "granted": granted, "user": public_user(fresh) if fresh else None}



class AvatarIn(BaseModel):
    avatar: int = Field(ge=0, le=11)


# Banner customization — 12 icons × 12 colors, displayed on the profile card.
class BannerIn(BaseModel):
    banner_icon: int = Field(ge=0, le=11)
    banner_color: int = Field(ge=0, le=11)
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
    # Animated avatars (idx 6..11) are gated by level OR peak rank.
    if payload.avatar >= 6:
        stats = user.get("stats", {})
        lvl = compute_level(stats)["level"]
        peak_pts = int(user.get("peak_rank_points", user.get("rank_points", 0)) or 0)
        peak_tier, _ = rank_for_points(peak_pts)
        gates = {
            6:  {"level": 5,  "tier": 0},  # Flaming Skull
            7:  {"level": 15, "tier": 4},  # Pulsing Diamond
            8:  {"level": 25, "tier": 5},  # Swirling Lightning
            9:  {"level": 10, "tier": 0},  # Frost Sigil
            10: {"level": 20, "tier": 4},  # Quantum Core
            11: {"level": 30, "tier": 7},  # All-Seeing Eye
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
    # One-time tier promotion. Tops up RP so the player lands at the bottom
    # of the *next* tier band. Hard-capped at Grandmaster — Goonmaster is
    # earned only and can't be skipped to via code.
    "WARPSPEED":   {"rank_up_tiers": 1,              "label": "Warp Speed — +1 Rank Tier"},
    # Coin grants — the *only* way to earn coins besides level-ups, so
    # codes form the primary economy lever. Three tiers of generosity.
    "COINTOSS":    {"coins": 250,                    "label": "+250 Coins — Coin Toss"},
    "COINSHOWER":  {"coins": 1000,                   "label": "+1,000 Coins — Coin Shower"},
    "JACKPOT":     {"coins": 5000,                   "label": "+5,000 Coins — Jackpot!"},
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
    # Coin grants — straight $inc onto the wallet.
    if reward.get("coins"):
        update_ops.setdefault("$inc", {})["coins"] = int(reward["coins"])
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
    # rank_up_tiers: jump the player N tiers up by topping up RP to the
    # bottom of the target band. Hard-capped at Grandmaster (tier 6) — code
    # can never push into Goonmaster which is earned-only.
    rank_up_payload: Optional[dict] = None
    if reward.get("rank_up_tiers"):
        cur_pts = int(user.get("rank_points", 0) or 0)
        cur_tier_idx, cur_tier_name = rank_for_points(cur_pts)
        steps = max(1, int(reward["rank_up_tiers"]))
        # Cap target at tier 6 (Grandmaster). Tier 7 = Goonmaster, unreachable
        # via code.
        target_tier_idx = min(6, cur_tier_idx + steps)
        if target_tier_idx > cur_tier_idx:
            # Land the player at the *start* of the new tier's band so they
            # have to fight to climb further within it.
            target_pts = RANK_TIERS[target_tier_idx][0]
            rp_grant = max(0, target_pts - cur_pts)
            if rp_grant > 0:
                inc = update_ops.setdefault("$inc", {})
                inc["rank_points"] = int(inc.get("rank_points", 0)) + rp_grant
            # Surface tier-change details so the frontend can trigger the
            # rank-up celebration overlay on a successful redeem.
            rank_up_payload = {
                "prev_tier": {"idx": cur_tier_idx, "name": cur_tier_name},
                "new_tier":  {"idx": target_tier_idx, "name": RANK_TIERS[target_tier_idx][1]},
                "rp_delta":  int(rp_grant),
                "new_points": int(target_pts),
            }
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
        "rank_up": rank_up_payload,
        "user": public_user(fresh) if fresh else None,
    }


# -------------------------------------------------------------------
# Arena
# -------------------------------------------------------------------
# -------------------------------------------------------------------
# Maps — two distinct arena layouts. Rooms pick one at random on init
# and again on each match reset, so the same lobby cycles through both.
# Both maps share the same 50-unit footprint + outer perimeter buildings
# so the skyline reads as the same city; the inner cover layout is what
# changes. The currently-active map is stored on each GameRoom (`self.arena`)
# and shipped to the client via the welcome payload so it can rebuild
# obstacles + healthpacks accordingly.
# -------------------------------------------------------------------

# Outer perimeter buildings — shared by every map for visual continuity.
_PERIMETER_BUILDINGS = [
    {"x": 42,  "z": 42,  "w": 5, "h": 6, "d": 5},
    {"x": -42, "z": 42,  "w": 5, "h": 7, "d": 5},
    {"x": 42,  "z": -42, "w": 5, "h": 5, "d": 5},
    {"x": -42, "z": -42, "w": 5, "h": 8, "d": 5},
    {"x": 12,  "z": 38,  "w": 3, "h": 4, "d": 6},
    {"x": -12, "z": 38,  "w": 3, "h": 5, "d": 6},
    {"x": 12,  "z": -38, "w": 3, "h": 5, "d": 6},
    {"x": -12, "z": -38, "w": 3, "h": 4, "d": 6},
    {"x": 38,  "z": 12,  "w": 6, "h": 4, "d": 3},
    {"x": 38,  "z": -12, "w": 6, "h": 5, "d": 3},
    {"x": -38, "z": 12,  "w": 6, "h": 4, "d": 3},
    {"x": -38, "z": -12, "w": 6, "h": 6, "d": 3},
]

# Map A — "DOWNTOWN" — the OG layout: central mega-tower, 4 small ring
# platforms, asymmetric quadrants, scattered crates. Tight cover near
# the center, longer sightlines toward the edges.
MAP_A = {
    "map_id": "downtown",
    "name": "DOWNTOWN",
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
    ] + _PERIMETER_BUILDINGS,
    "spawn_points": [
        (35, 35), (-35, 35), (35, -35), (-35, -35),
        (0, 40), (0, -40), (40, 0), (-40, 0),
        (22, -2), (-22, 2),
    ],
    "healthpacks": [
        (12.0, 0.0), (-12.0, 0.0), (0.0, 12.0), (0.0, -12.0),
        (8.0, 8.0), (-8.0, -8.0), (8.0, -8.0), (-8.0, 8.0),
    ],
}

# Map B — "CROSSFIRE" — long bisecting corridor walls form a "#"-style
# grid with diagonal pillars in the gaps. Plays very differently from
# DOWNTOWN: longer sightlines along the corridors, choke points at the
# wall ends, big open midfield instead of a central tower.
MAP_B = {
    "map_id": "crossfire",
    "name": "CROSSFIRE",
    "size": 50,
    "obstacles": [
        # Two long N-S corridor walls (left + right of center)
        {"x":  6,  "z":  0,  "w": 2, "h": 4, "d": 20},
        {"x": -6,  "z":  0,  "w": 2, "h": 4, "d": 20},
        # Two long E-W corridor walls
        {"x":  0,  "z":  6,  "w": 20, "h": 4, "d": 2},
        {"x":  0,  "z": -6,  "w": 20, "h": 4, "d": 2},

        # Diagonal pillars in the four corner gaps of the inner grid
        {"x": 12,  "z":  12, "w": 3, "h": 5, "d": 3},
        {"x": -12, "z":  12, "w": 3, "h": 5, "d": 3},
        {"x": 12,  "z": -12, "w": 3, "h": 5, "d": 3},
        {"x": -12, "z": -12, "w": 3, "h": 5, "d": 3},

        # Mid-ring sniper nests (taller, narrower)
        {"x": 22,  "z":  0,  "w": 3, "h": 6, "d": 4},
        {"x": -22, "z":  0,  "w": 3, "h": 6, "d": 4},
        {"x":  0,  "z":  22, "w": 4, "h": 6, "d": 3},
        {"x":  0,  "z": -22, "w": 4, "h": 6, "d": 3},

        # Corner courtyards — L-shaped covers
        {"x":  28, "z":  22, "w": 6, "h": 3, "d": 2},
        {"x":  22, "z":  28, "w": 2, "h": 3, "d": 6},
        {"x": -28, "z":  22, "w": 6, "h": 3, "d": 2},
        {"x": -22, "z":  28, "w": 2, "h": 3, "d": 6},
        {"x":  28, "z": -22, "w": 6, "h": 3, "d": 2},
        {"x":  22, "z": -28, "w": 2, "h": 3, "d": 6},
        {"x": -28, "z": -22, "w": 6, "h": 3, "d": 2},
        {"x": -22, "z": -28, "w": 2, "h": 3, "d": 6},

        # Scattered crates near corridor ends
        {"x":  10, "z":  18, "w": 1.8, "h": 1.8, "d": 1.8},
        {"x": -10, "z":  18, "w": 1.8, "h": 1.8, "d": 1.8},
        {"x":  10, "z": -18, "w": 1.8, "h": 1.8, "d": 1.8},
        {"x": -10, "z": -18, "w": 1.8, "h": 1.8, "d": 1.8},
        {"x":  18, "z":  10, "w": 1.8, "h": 1.8, "d": 1.8},
        {"x":  18, "z": -10, "w": 1.8, "h": 1.8, "d": 1.8},
        {"x": -18, "z":  10, "w": 1.8, "h": 1.8, "d": 1.8},
        {"x": -18, "z": -10, "w": 1.8, "h": 1.8, "d": 1.8},
    ] + _PERIMETER_BUILDINGS,
    "spawn_points": [
        (0, 30),  (0, -30),  (30, 0),  (-30, 0),
        (32, 32), (-32, 32), (32, -32), (-32, -32),
        (16, 0),  (-16, 0),
    ],
    "healthpacks": [
        (0.0, 0.0),   # center plaza
        (15.0, 0.0), (-15.0, 0.0), (0.0, 15.0), (0.0, -15.0),
        (20.0, 20.0), (-20.0, -20.0), (20.0, -20.0), (-20.0, 20.0),
    ],
}

MAPS = [MAP_A, MAP_B]

# Map C — "SHORELINE" — beach theme. Open sandy plaza with two wooden
# piers thrusting in from north/south, four tall lifeguard towers at the
# corners, scattered rock clusters in the midfield, two beach huts on
# the diagonals, and palm-tree pillars dotting the playfield. Plays loose
# and open compared to DOWNTOWN's tight cover and CROSSFIRE's corridors.
MAP_C = {
    "map_id": "shoreline",
    "name": "SHORELINE",
    "size": 50,
    "obstacles": [
        # Two wooden piers extending from N and S — long but narrow ramps
        {"x":  0,  "z":  22, "w": 4, "h": 2, "d": 16},  # north pier
        {"x":  0,  "z": -22, "w": 4, "h": 2, "d": 16},  # south pier
        # Pier-end shacks (short cabins at the seaward ends)
        {"x":  0,  "z":  30, "w": 6, "h": 4, "d": 4},
        {"x":  0,  "z": -30, "w": 6, "h": 4, "d": 4},

        # Four tall lifeguard towers at the inner corners (narrow but tall —
        # great sight-perch but easy to flank around).
        {"x":  20, "z":  20, "w": 2.5, "h": 7, "d": 2.5},
        {"x": -20, "z":  20, "w": 2.5, "h": 7, "d": 2.5},
        {"x":  20, "z": -20, "w": 2.5, "h": 7, "d": 2.5},
        {"x": -20, "z": -20, "w": 2.5, "h": 7, "d": 2.5},

        # Beach huts — wide low cover on the E/W axis
        {"x":  26, "z":  0, "w": 4, "h": 3, "d": 8},
        {"x": -26, "z":  0, "w": 4, "h": 3, "d": 8},

        # Midfield rock clusters (scattered small cubes)
        {"x":  8,  "z":  6,  "w": 1.8, "h": 1.8, "d": 1.8},
        {"x":  -8, "z":  6,  "w": 1.8, "h": 1.8, "d": 1.8},
        {"x":  8,  "z": -6,  "w": 1.8, "h": 1.8, "d": 1.8},
        {"x":  -8, "z": -6,  "w": 1.8, "h": 1.8, "d": 1.8},
        {"x":  12, "z":  0,  "w": 1.6, "h": 1.6, "d": 1.6},
        {"x":  -12, "z":  0, "w": 1.6, "h": 1.6, "d": 1.6},

        # Palm trunks — tall narrow pillars dotting the edges
        {"x":  14, "z":  12, "w": 1.2, "h": 6, "d": 1.2},
        {"x": -14, "z":  12, "w": 1.2, "h": 6, "d": 1.2},
        {"x":  14, "z": -12, "w": 1.2, "h": 6, "d": 1.2},
        {"x": -14, "z": -12, "w": 1.2, "h": 6, "d": 1.2},
        {"x":  6,  "z":  16, "w": 1.2, "h": 6, "d": 1.2},
        {"x": -6,  "z":  16, "w": 1.2, "h": 6, "d": 1.2},
        {"x":  6,  "z": -16, "w": 1.2, "h": 6, "d": 1.2},
        {"x": -6,  "z": -16, "w": 1.2, "h": 6, "d": 1.2},

        # Central "shipwreck" — wide low debris pile players can vault around
        {"x":  0,  "z":  0,  "w": 7, "h": 1.6, "d": 4},
    ] + _PERIMETER_BUILDINGS,
    "spawn_points": [
        (32, 0), (-32, 0), (0, 38), (0, -38),
        (28, 28), (-28, 28), (28, -28), (-28, -28),
        (18, 0), (-18, 0),
    ],
    "healthpacks": [
        (0.0, 8.0), (0.0, -8.0),     # midfield, behind the wreck
        (10.0, 12.0), (-10.0, 12.0), # under the palms
        (10.0, -12.0), (-10.0, -12.0),
        (24.0, 0.0), (-24.0, 0.0),   # behind the beach huts
    ],
}

MAPS = [MAP_A, MAP_B, MAP_C]

# Map D — "CRASHSITE" — meteor-impact theme. A massive central crater
# (ringed by tilted earthworks), shattered fragments of a glowing meteor
# strewn through the field, three burnt-out outposts on the corners, and
# a perimeter of cracked rock pillars. Plays elevated and uneven — lots
# of natural cover lines pointing toward the central crater, encouraging
# hot-zone fights and crater-edge peeking.
MAP_D = {
    "map_id": "crashsite",
    "name": "CRASHSITE",
    "size": 50,
    "obstacles": [
        # ---- Central meteor & crater rim ------------------------------------
        # The meteor itself — wide low boulder at dead centre (vault-cover).
        {"x":  0,   "z":  0,   "w": 7,   "h": 2.4, "d": 7},
        # Crater rim — 6 angled wedge-walls forming a rough hexagon around
        # the meteor. Provides peek-and-duck cover in every direction.
        {"x":  9,   "z":  0,   "w": 1.8, "h": 1.6, "d": 5},
        {"x": -9,   "z":  0,   "w": 1.8, "h": 1.6, "d": 5},
        {"x":  4.5, "z":  7.8, "w": 5,   "h": 1.6, "d": 1.8},
        {"x": -4.5, "z":  7.8, "w": 5,   "h": 1.6, "d": 1.8},
        {"x":  4.5, "z": -7.8, "w": 5,   "h": 1.6, "d": 1.8},
        {"x": -4.5, "z": -7.8, "w": 5,   "h": 1.6, "d": 1.8},
        # ---- Shattered meteor shards (medium scattered cover) ---------------
        {"x":  14,  "z":  14,  "w": 2.4, "h": 2.2, "d": 2.4},
        {"x": -14,  "z":  14,  "w": 2.4, "h": 2.2, "d": 2.4},
        {"x":  14,  "z": -14,  "w": 2.4, "h": 2.2, "d": 2.4},
        {"x": -14,  "z": -14,  "w": 2.4, "h": 2.2, "d": 2.4},
        {"x":  18,  "z":  6,   "w": 2.0, "h": 1.8, "d": 2.0},
        {"x": -18,  "z":  6,   "w": 2.0, "h": 1.8, "d": 2.0},
        {"x":  18,  "z": -6,   "w": 2.0, "h": 1.8, "d": 2.0},
        {"x": -18,  "z": -6,   "w": 2.0, "h": 1.8, "d": 2.0},
        # ---- Burnt-out outposts at the corners ------------------------------
        # Wide low-walled cover with a tall back wall — like wrecked
        # research stations evacuated when the meteor hit.
        {"x":  25,  "z":  25,  "w": 6,   "h": 4,   "d": 2},
        {"x": -25,  "z":  25,  "w": 6,   "h": 4,   "d": 2},
        {"x":  25,  "z": -25,  "w": 6,   "h": 4,   "d": 2},
        {"x": -25,  "z": -25,  "w": 6,   "h": 4,   "d": 2},
        # Side walls for each outpost (rotated 90° — short stubs).
        {"x":  22,  "z":  22,  "w": 2,   "h": 4,   "d": 3},
        {"x": -22,  "z":  22,  "w": 2,   "h": 4,   "d": 3},
        {"x":  22,  "z": -22,  "w": 2,   "h": 4,   "d": 3},
        {"x": -22,  "z": -22,  "w": 2,   "h": 4,   "d": 3},
        # ---- Tall jagged rock pillars dotting the mid-field -----------------
        {"x":  0,   "z":  18,  "w": 1.4, "h": 5,   "d": 1.4},
        {"x":  0,   "z": -18,  "w": 1.4, "h": 5,   "d": 1.4},
        {"x":  18,  "z":  0,   "w": 1.4, "h": 5,   "d": 1.4},
        {"x": -18,  "z":  0,   "w": 1.4, "h": 5,   "d": 1.4},
        # Small rock clusters along the diagonal routes.
        {"x":  10,  "z":  16,  "w": 1.5, "h": 1.5, "d": 1.5},
        {"x": -10,  "z":  16,  "w": 1.5, "h": 1.5, "d": 1.5},
        {"x":  10,  "z": -16,  "w": 1.5, "h": 1.5, "d": 1.5},
        {"x": -10,  "z": -16,  "w": 1.5, "h": 1.5, "d": 1.5},
    ] + _PERIMETER_BUILDINGS,
    "spawn_points": [
        (28, 28), (-28, 28), (28, -28), (-28, -28),
        (32, 0), (-32, 0), (0, 32), (0, -32),
        (20, 12), (-20, 12), (20, -12), (-20, -12),
    ],
    "healthpacks": [
        (0.0, 14.0), (0.0, -14.0),    # mid-field, near the rim pillars
        (16.0, 0.0), (-16.0, 0.0),
        (24.0, 18.0), (-24.0, 18.0),  # behind the outposts
        (24.0, -18.0), (-24.0, -18.0),
    ],
}

MAPS = [MAP_A, MAP_B, MAP_C, MAP_D]

def random_map() -> dict:
    """Pick a random map for a new match. All maps are equally likely."""
    return random.choice(MAPS)

def get_map_by_id(map_id: Optional[str]) -> Optional[dict]:
    """Look up a map by id. Returns None if not found or input falsy."""
    if not map_id:
        return None
    for m in MAPS:
        if m.get("map_id") == map_id:
            return m
    return None

# Default ARENA stays defined as MAP_A for any legacy code paths that
# still reference the module-level constant (e.g. early-tier helpers).
# Rooms always read from `self.arena` instead.
ARENA = MAP_A

PLAYER_RADIUS = 0.5
PLAYER_HEIGHT = 1.8
MAX_HP = 100
BOT_MAX_HP = 80

# Out-of-combat health regeneration. Once a player has gone
# `HEALTH_REGEN_DELAY` seconds without taking damage, they tick back up
# at `HEALTH_REGEN_PER_SEC` HP/s until full. Reset on any damage source.
HEALTH_REGEN_DELAY = 5.0      # seconds since last hit
HEALTH_REGEN_PER_SEC = 18.0   # ~5.6s to full from 0

# Healthpack pickups — server-spawned static entities at fixed map
# positions. When a player walks within `HEALTHPACK_PICKUP_RADIUS` of
# an *available* pack while not at full HP, the pack is consumed,
# the player gains `HEALTHPACK_HEAL` HP (capped at max_hp), and the
# pack respawns after `HEALTHPACK_RESPAWN_SECONDS`.
HEALTHPACK_HEAL = 50
HEALTHPACK_PICKUP_RADIUS = 1.4
HEALTHPACK_RESPAWN_SECONDS = 20.0
# Kill-streak heal — every kill instantly restores HP to the attacker
# (capped at max_hp). Bodyshot kills heal 50, headshot kills heal a full
# 100 (effectively a top-up). Melee/laser kills count as bodyshot unless
# the final hit landed on the head. Rewards aggressive play + precision.
HEAL_ON_KILL_BODY = 50
HEAL_ON_KILL_HEAD = 100
# Back-compat alias for any legacy tooling that still imports the old
# name. New code should pass `headshot=` to `_award_kill_heal`.
HEAL_ON_KILL = HEAL_ON_KILL_BODY
# Per-map healthpack spawn positions are now defined inside each map dict
# (MAP_A/MAP_B). The module-level constant is kept only as a legacy fallback
# for any callsite that still imports it; rooms read from `self.arena`.
HEALTHPACK_POSITIONS: List[tuple] = MAP_A["healthpacks"]
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
QUEUE_BOT_FILL_SEC_GOONMASTER = 210.0  # Goonmaster (7) waits ~3.5 minutes
# Randomization window applied on top of the base — so the actual wait
# lands somewhere in 2-5 minutes (120-300s) rather than always exactly
# 210s. Re-rolled per join via `bot_fill_seconds_for_tier()`.
QUEUE_BOT_FILL_GOONMASTER_MIN = 120.0
QUEUE_BOT_FILL_GOONMASTER_MAX = 300.0
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
    # GOONMASTER (tier 7): the highest tier still gets a real-vs-real shot
    # but can't be stuck queueing forever. Per user request, the wait is
    # randomised in the **2-5 minute** band (120s-300s) — narrower than the
    # old fixed 10-minute wait so games happen more often.
    if tier_idx >= 7:
        return random.uniform(QUEUE_BOT_FILL_GOONMASTER_MIN, QUEUE_BOT_FILL_GOONMASTER_MAX)
    return QUEUE_BOT_FILL_SEC_HIGH if tier_idx >= QUEUE_HIGH_TIER_MIN else QUEUE_BOT_FILL_SEC


def bot_fill_seconds_for_tier_api(tier_idx: int) -> int:
    """JSON-safe version: returns -1 when the tier never bot-fills (currently unused — kept for backwards compat)."""
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


def random_spawn(arena: Optional[dict] = None, *, occupants: Optional[List["Player"]] = None, min_dist: float = 14.0):
    """Return a random (x, z) spawn point for the given arena (or the
    legacy global ARENA when not supplied).

    When `occupants` is provided we score every spawn point by its
    distance to the nearest live opponent and pick a point that's at
    least `min_dist` metres away. If no point meets the threshold we
    fall back to the *farthest* available point — never the closest —
    so respawning into a face-full of bullets stops happening."""
    points = (arena or ARENA).get("spawn_points") or ARENA["spawn_points"]
    if not occupants:
        return random.choice(points)
    # Score each point by min-distance to any living, non-spectator opponent.
    live = [p for p in occupants if getattr(p, "alive", False) and not getattr(p, "is_spectator", False)]
    if not live:
        return random.choice(points)
    scored = []
    for (sx, sz) in points:
        nearest = min(math.hypot(p.x - sx, p.z - sz) for p in live)
        scored.append((nearest, sx, sz))
    # Candidates that satisfy min_dist — pick one at random for variety.
    safe = [(n, x, z) for (n, x, z) in scored if n >= min_dist]
    if safe:
        n, x, z = random.choice(safe)
        return (x, z)
    # No safe point — pick the farthest one we have so respawn isn't right
    # in someone's lap.
    scored.sort(reverse=True)
    return (scored[0][1], scored[0][2])


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
            # Bots show a random level 5-11 on their banner so they read
            # like established players, not fresh smurfs. Picked once at
            # spawn time and stays stable for the match.
            self.level = random.randint(5, 11)
            # Bots pick a random non-default skin to add visual variety
            # to lobbies; biased toward the cheaper tiers so legendary
            # skins still feel rare among bots.
            self.selected_skin = random.choice([
                "default", "azure", "neon", "crimson", "verdant", "ghost",
            ])
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
            self.selected_skin = user.get("selected_skin") or "default"
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
        # Smart-AI bookkeeping (used when difficulty >= 1.5):
        # - target_locked_until: avoid switching targets every frame
        # - last_damaged_by: remember who hurt us so we can prioritise them
        # - target prev pos cache for velocity-based lead aim
        self.bot_target_locked_until: float = 0.0
        self.bot_burst_cooldown_until: int = 0
        self.bot_target_prev_pos: Optional[Tuple[float, float, float]] = None
        self.bot_target_prev_ts: float = 0.0
        # Weapon state (Overwatch-style)
        self.weapon = "ak47"
        self.ammo: Dict[str, int] = {
            "ak47": WEAPON_CONFIGS["ak47"]["mag_size"],
            "laser": WEAPON_CONFIGS["laser"]["mag_size"],
        }
        self.reload_until_ms: Dict[str, int] = {"ak47": 0, "laser": 0}
        self.spread: float = 0.0  # current cone radius in radians
        self.is_ads: bool = False
        # Out-of-combat regen tracker — `last_damage_at` is bumped to
        # `time.time()` every time the player takes any damage (bullet,
        # melee, laser). After `HEALTH_REGEN_DELAY` seconds without a
        # hit, the tick loop slowly tops the player back up.
        self.last_damage_at: float = 0.0
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
            "skin": getattr(self, "selected_skin", "default") or "default",
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
        # User ids that already received the live match_end broadcast for the
        # current intermission. Used by add()'s replay branch to avoid
        # double-showing the overlay to a player who finished a match,
        # exited to lobby, and re-joined quick-play during the same
        # intermission — they had already seen it.
        self.last_match_end_recipients: set[str] = set()
        # Incremented each time end_match runs. Stamped on each joining player
        # as `joined_match_num` so we can target match_end broadcasts at only
        # the players who actually participated in that match — joining
        # quick-play seconds before match_end no longer dumps the overlay
        # on a fresh player.
        self.match_num = 0
        # Per-room arena. Picked at init from MAPS and rerolled on each
        # match reset so the same lobby cycles through the available maps.
        # Shipped to clients in the welcome payload + via the next match_start.
        self.arena: dict = random_map()
        # Healthpack state — one entry per map healthpack position.
        self.healthpacks: List[dict] = self._build_healthpacks()
        # Delta-broadcast state. Each tick we either emit a full `state`
        # snapshot (keyframe, ~1s cadence) or a `state_delta` containing
        # only fields that changed per-player. `_last_sent_state_by_pid`
        # caches the last full per-player dict that was sent, so we can
        # diff against it on subsequent ticks. `_last_keyframe_at` tracks
        # when we last sent a full snapshot so we can force one at the
        # interval. Saves ~50% JSON/CPU on large rooms because static
        # fields (username, rank_name, level, banner, skin, mag_size,
        # platform, etc.) don't get serialised every tick.
        self._last_sent_state_by_pid: Dict[str, dict] = {}
        self._last_keyframe_at: float = 0.0
        self._keyframe_interval: float = 1.0
        self._last_sent_top: Dict[str, object] = {}

    def _build_healthpacks(self) -> List[dict]:
        """(Re)build healthpack state from the current arena. Used on init
        and on each match reset (so a map change spawns fresh packs)."""
        return [
            {"id": f"hp_{i}", "x": float(x), "z": float(z), "available": True, "respawn_at": 0.0}
            for i, (x, z) in enumerate(self.arena.get("healthpacks") or HEALTHPACK_POSITIONS)
        ]

    def spawn_bot(self, name: str, *, disguised: bool = False, difficulty: float = 1.0, disguise_tier_idx: Optional[int] = None, disguise_rank_points: Optional[int] = None):
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
            elif disguise_rank_points is not None:
                # Player's exact-RP disguise. Each bot picks a value within
                # ±20 of the queueing player so the lobby looks like a
                # tightly-MMR-matched real game ("DIAMOND 1750" vs your
                # "DIAMOND 1745") rather than identical numbers (also
                # uncanny). Clamp to the tier band so we never spill
                # into the next/prev tier visually.
                ti = max(0, min(len(RANK_TIERS) - 1, int(disguise_tier_idx)))
                low = RANK_TIERS[ti][0]
                high = (RANK_TIERS[ti + 1][0] - 1) if (ti + 1 < len(RANK_TIERS)) else (low + 400)
                jitter = random.randint(-20, 20)
                pts = max(low, min(high, int(disguise_rank_points) + jitter))
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
        # Reposition the bot to a spawn from THIS room's arena — avoid
        # placing it right on top of an existing player/bot.
        bx, bz = random_spawn(self.arena, occupants=list(self.players.values()))
        bot.x = float(bx)
        bot.z = float(bz)
        self.players[bot.id] = bot
        logger.info("Bot spawned: %s (%s) diff=%.2f%s%s", name, bot.id, bot.difficulty,
                    " [disguised]" if disguised else "",
                    f" tier={disguise_tier_idx}" if (disguised and disguise_tier_idx is not None) else "")
        return bot

    async def add(self, player: Player):
        # Reposition the player onto a spawn point from THIS room's arena —
        # Player.__init__ used the global default spawn list, which may not
        # exist on the room's current map. Pass occupants so the chosen
        # spawn is at least 14m from every live opponent.
        if not getattr(player, "is_spectator", False):
            sx, sz = random_spawn(self.arena, occupants=list(self.players.values()))
            player.x = float(sx)
            player.z = float(sz)
        async with self.lock:
            # Detect whether the room had any real, non-spectator players
            # BEFORE this add. Used to restart the match clock so the very
            # first player of a freshly-spawned (or long-idle) casual room
            # doesn't get an instant match_end from accumulated idle time.
            had_real_players = any(
                (not p.is_bot) and (not getattr(p, "is_spectator", False))
                for p in self.players.values()
            )
            self.players[player.id] = player
        # Restart the match clock if this is the first real player to join
        # an empty (or bots-only) room while a match is supposedly in
        # progress. Otherwise the tick loop's `now - match_start >= duration`
        # check fires immediately and broadcasts match_end before the new
        # player has done anything — the "instant defeat on Quick Play" bug.
        if (
            not had_real_players
            and not player.is_bot
            and not getattr(player, "is_spectator", False)
            and not self.in_intermission
        ):
            self.match_start = time.time()
            # Bots have been farming each other while the room was idle.
            # Reset every bot's scoreline so the joining player doesn't
            # walk into a lobby with bots already at double-digit kills.
            for bot in self.players.values():
                if bot.is_bot:
                    bot.kills = 0
                    bot.deaths = 0
        # Stamp the match this player will participate in. During intermission,
        # the upcoming match is match_num + 1 (current match is over). This
        # lets end_match target its broadcast precisely so late joiners don't
        # see the previous match's "MATCH OVER" overlay.
        player.joined_match_num = self.match_num + (1 if self.in_intermission else 0)
        # Shared ranked_room: when a real player joins and they're the only
        # human, re-disguise the room's bots to match their actual rank
        # (so opponent banners read e.g. DIAMOND when a DIAMOND player joins,
        # not the default BRONZE). Avoids re-rolling mid-match if multiple
        # real players are already there (their ranks may differ).
        if (
            self.is_ranked
            and not getattr(self, "is_ranked_bot", False)
            and not player.is_bot
            and not getattr(player, "is_spectator", False)
            and not had_real_players
        ):
            try:
                rp = int(getattr(player, "rank_points", 0) or 0)
                t_idx, _ = rank_for_points(rp)
                self._ranked_bot_tier = t_idx
                self._ranked_bot_player_rp = rp
                self._reroll_ranked_bots()
            except Exception:
                pass
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
            PLAYER_LOCATION[player.user_id] = {
                "kind": kind,
                "party_id": getattr(self, "party_id", None),
                "ranked_bot_key": getattr(self, "ranked_bot_key", None),
            }
        await self._send(player, {
            "type": "welcome",
            "you": player.to_state(),
            "arena": self.arena,
            "is_ranked": self.is_ranked,
            "match_duration": self.match_duration if self.is_ranked else None,
            "match_start": self.match_start if self.is_ranked else None,
            "spectator": bool(getattr(player, "is_spectator", False)),
            "spectate_target_id": getattr(player, "spectate_target_id", None),
        })
        if not getattr(player, "is_spectator", False):
            await self.broadcast({"type": "join", "player": player.to_state()})
        # Replay the last match_end payload ONLY to players who were
        # actually in that match (i.e. their user_id appears in the
        # placements) AND who didn't already receive the live broadcast
        # in this same intermission. Without the second check a player
        # who finished a match, exited to lobby, and re-clicked Quick
        # Play during the 10s intermission would get the overlay again
        # ("instant defeat" bug) even though they already saw it.
        if (
            self.last_match_end_payload
            and self.in_intermission
            and not player.is_bot
            and player.user_id
            and str(player.user_id) not in self.last_match_end_recipients
        ):
            placements = (self.last_match_end_payload or {}).get("placements", []) or []
            played_in = any(
                isinstance(p, dict) and str(p.get("user_id") or "") == str(player.user_id)
                for p in placements
            )
            if played_in:
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
        s = self.arena["size"]
        if x < -s + PLAYER_RADIUS or x > s - PLAYER_RADIUS:
            return True
        if z < -s + PLAYER_RADIUS or z > s - PLAYER_RADIUS:
            return True
        for ob in self.arena["obstacles"]:
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
            for ob in self.arena["obstacles"]:
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
        for ob in self.arena["obstacles"]:
            t = aabb_t(ob)
            if t is not None and t < occlusion_t:
                occlusion_t = t

        def sphere_t(cx, cy, cz, r):
            """Returns (t_surface, t_center) — the ray's distance to where
            it first enters the sphere AND the projection of the sphere's
            centre onto the ray. The center distance is what we use for
            occlusion checks so a sphere whose body sits behind a wall
            (but whose front rim pokes through) is still occluded. Returns
            None if the ray misses the sphere entirely."""
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
            return t, -b

        best_t = SHOT_RANGE
        best: Optional[Player] = None
        best_part: Optional[str] = None
        for p in self.players.values():
            if p.id == shooter.id or not p.alive:
                continue
            # 3-sphere capsule hitbox — bigger + taller per user request.
            # Head radius 0.55→0.70, sits higher (1.65→1.85) so even tall
            # players in jump animations get clipped. Torso 0.65→0.85,
            # centred slightly higher (1.05→1.20). Legs 0.55→0.80, lower
            # centre (0.45→0.40) so the capsule actually reaches the floor.
            # Net effect: thicker silhouette overall + about 0.4m taller
            # total capsule. Headshot calling still works because the head
            # sphere is the topmost and still tightest of the three.
            base = p.y - PLAYER_HEIGHT
            spheres = [
                ("head",  p.x, base + 1.85, p.z, 0.70),
                ("torso", p.x, base + 1.20, p.z, 0.85),
                ("legs",  p.x, base + 0.40, p.z, 0.80),
            ]
            for (label, cx, cy, cz, r) in spheres:
                res = sphere_t(cx, cy, cz, r)
                if res is None:
                    continue
                t, t_center = res
                # Occlude on the CENTER of the sphere, not just first
                # surface touch. Prevents shots from clipping through walls
                # when a target stands close behind cover — their hitbox
                # rim used to poke through and register as a hit.
                if t < best_t and t_center < occlusion_t:
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
            best.last_damage_at = time.time()
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
                self._award_kill_heal(attacker, headshot=False)
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

    def _award_kill_heal(self, killer: Player, *, headshot: bool = False) -> None:
        """Restore HP to the killer (capped at max_hp). Emits a `kill_heal`
        event so the client can play a green flash. Headshot kills heal
        the full HEAL_ON_KILL_HEAD; bodyshot kills (and melee) heal
        HEAL_ON_KILL_BODY. No-op for spectators or already-full players."""
        if not killer.alive:
            return
        amount_max = HEAL_ON_KILL_HEAD if headshot else HEAL_ON_KILL_BODY
        prev = int(killer.hp)
        killer.hp = min(killer.max_hp, prev + amount_max)
        # Reset out-of-combat regen so the player doesn't get an immediate
        # second tick on top of the kill bonus.
        killer.last_damage_at = 0.0
        amount = killer.hp - prev
        if amount > 0:
            self.events.append({
                "type": "kill_heal",
                "player_id": killer.id,
                "hp": int(killer.hp),
                "amount": amount,
                "headshot": headshot,
            })

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
            hit.last_damage_at = time.time()
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
                self._award_kill_heal(shooter, headshot=(body_part == "head" and not shooter.is_bot))
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

    def _laser_autoaim_lock(self, shooter: Player, *, max_range: float = 22.0, cone_rad: float = 1.05) -> Optional[Tuple[float, float]]:
        """Close-range aim-assist for the laser. Snaps the beam to the nearest
        living opponent that is (1) within `max_range` metres (22m default),
        (2) inside a cone of half-angle `cone_rad` from the shooter's forward
        (60° default — generous), and (3) not behind an obstacle (LOS clear
        via the existing 2D step-walk). Returns `(yaw, pitch)` aimed at the
        target's chest, or `None` if no eligible target exists — in which
        case the laser falls back to manual aim. The cone widens further at
        very short range (<8m) so point-blank fights basically always lock
        on, no matter how rough the player's manual aim is.

        Cone math mirrors the camera convention used elsewhere: forward is
        `(-sin(yaw), -cos(yaw))` on the XZ plane.
        """
        fx = -math.sin(shooter.yaw)
        fz = -math.cos(shooter.yaw)
        # Pre-compute cos thresholds for the two distance bands.
        cos_cone = math.cos(cone_rad)
        cos_cone_close = math.cos(min(math.pi - 0.01, cone_rad + 0.45))  # +25° at <8m
        best: Optional[Player] = None
        best_d = max_range
        for p in self.players.values():
            if p is shooter or not p.alive:
                continue
            if getattr(p, "is_spectator", False):
                continue
            if p.id == shooter.id:
                continue
            if time.time() < p.invuln_until:
                continue
            dx = p.x - shooter.x
            dz = p.z - shooter.z
            d = math.hypot(dx, dz)
            if d < 0.3 or d > max_range:
                continue
            dot = (dx * fx + dz * fz) / d
            cone_thresh = cos_cone_close if d < 8.0 else cos_cone
            if dot < cone_thresh:
                continue
            if not self._has_los(shooter, p):
                continue
            if d < best_d:
                best_d = d
                best = p
        if best is None:
            return None
        # Aim at target chest (y - 0.2 mirrors raycast capsule math).
        dx = best.x - shooter.x
        dz = best.z - shooter.z
        dist = math.hypot(dx, dz)
        dy = (best.y - 0.2) - shooter.y
        yaw = math.atan2(-dx, -dz)
        pitch = max(-1.0, min(1.0, math.atan2(dy, max(0.01, dist))))
        return yaw, pitch

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
        # Close-range aim assist. Snaps to nearest enemy within 15m + ~25°
        # cone. Beam events still report the snapped yaw/pitch so the beam
        # visually goes where it actually hits.
        aim = self._laser_autoaim_lock(shooter)
        beam_yaw = aim[0] if aim else shooter.yaw
        beam_pitch = aim[1] if aim else shooter.pitch
        # Raycast (no spread)
        hit, body_part, dist = self.raycast_hit(shooter, yaw_override=beam_yaw, pitch_override=beam_pitch)
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
                "yaw": beam_yaw, "pitch": beam_pitch,
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
        hit.last_damage_at = time.time()
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
            self._award_kill_heal(shooter, headshot=(body_part == "head"))
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

    def _reroll_ranked_bots(self):
        """Pick a fresh set of unique names (and re-randomise avatar +
        disguise RP within the tier band) for every bot in the room.

        Called between matches in `is_ranked_bot` rooms so the queueing
        player never sees the same bot identity twice in a row."""
        tier_idx = int(getattr(self, "_ranked_bot_tier", 0) or 0)
        player_rp = getattr(self, "_ranked_bot_player_rp", None)
        bots = [p for p in self.players.values() if p.is_bot]
        if not bots:
            return
        # Build the candidate name pool from the tier list (falls back to
        # BOT_NAMES). Exclude names currently in use AND each bot's prior
        # match name so we never repeat or accidentally swap names within
        # the room.
        pool = list(TIERED_BOT_NAMES.get(tier_idx) or BOT_NAMES)
        current_names = {b.username for b in bots}
        candidates = [n for n in pool if n not in current_names]
        if len(candidates) < len(bots):
            # Pool exhausted — fall back to the full BOT_NAMES list minus
            # current names (still avoids same-match repeats).
            extra = [n for n in BOT_NAMES if n not in current_names and n not in candidates]
            candidates.extend(extra)
        random.shuffle(candidates)
        # Compute the tier RP band once.
        ti = max(0, min(len(RANK_TIERS) - 1, tier_idx))
        low = RANK_TIERS[ti][0]
        high = (RANK_TIERS[ti + 1][0] - 1) if (ti + 1 < len(RANK_TIERS)) else (low + 400)
        for bot in bots:
            if candidates:
                bot.username = candidates.pop()
            # Re-roll cosmetic disguise so each match feels fresh.
            bot.avatar = random.randint(0, 4)
            bot.level = random.randint(5, 11)
            if player_rp is not None:
                jitter = random.randint(-20, 20)
                pts = max(low, min(high, int(player_rp) + jitter))
            else:
                pts = random.randint(low, max(low, high))
            t_idx, t_name = rank_for_points(pts)
            bot.disguise_rank_points = pts
            bot.disguise_rank_name = t_name
            bot.rank_tier = t_idx

    async def _update_bots(self, dt: float):
        now_ms = int(time.time() * 1000)
        now_s = time.time()
        for bot in list(self.players.values()):
            if not bot.is_bot or not bot.alive:
                continue
            # Practice dummies are stationary targets — no movement.
            if getattr(bot, "is_dummy", False):
                continue
            difficulty = float(getattr(bot, "difficulty", 1.0))
            smart = difficulty >= 1.5  # ranked-only AI enhancements

            # --- Target selection ---------------------------------------------------
            # Smart bots lock onto a target for 1.5s before re-evaluating,
            # and prefer wounded targets / recent attackers over the
            # closest opponent. Casual bots stick with closest-target.
            target: Optional[Player] = None
            if smart and bot.bot_target_id and now_s < bot.bot_target_locked_until:
                t = self.players.get(bot.bot_target_id)
                if t and t.alive and not getattr(t, "is_spectator", False):
                    target = t

            if target is None:
                best_score = -1.0
                for p in self.players.values():
                    if p is bot or not p.alive:
                        continue
                    if getattr(p, "is_spectator", False):
                        continue
                    d = math.hypot(p.x - bot.x, p.z - bot.z)
                    if d < 0.5:
                        continue
                    if smart:
                        # Higher score = better target. Closer = better,
                        # wounded = much better, recent attacker = priority.
                        score = 100.0 / max(2.0, d)
                        if p.hp < 60:
                            score *= 1.6
                        if p.hp < 30:
                            score *= 1.4
                        if bot.last_attacker and bot.last_attacker == p.id:
                            score *= 1.8
                        # Slightly prefer humans over other bots so ranked
                        # bots actually pressure the player.
                        if not p.is_bot:
                            score *= 1.15
                    else:
                        score = 1000.0 - d  # casual: closest wins
                    if score > best_score:
                        best_score = score
                        target = p
                if target is not None:
                    bot.bot_target_id = target.id
                    bot.bot_target_locked_until = now_s + (1.5 if smart else 0.5)
                    bot.bot_target_prev_pos = None  # reset velocity cache
                    bot.bot_target_prev_ts = 0.0
                else:
                    bot.bot_target_id = None

            if target is None:
                # Wander toward arena centre rather than oscillate in place.
                bot.bot_strafe_t += dt
                cx, cz = 0.0, 0.0
                dx0, dz0 = cx - bot.x, cz - bot.z
                dist0 = math.hypot(dx0, dz0)
                if dist0 > 1.0:
                    wx = (dx0 / dist0) * 1.5 * dt
                    wz = (dz0 / dist0) * 1.5 * dt
                else:
                    wx = math.cos(bot.bot_strafe_t * 0.4) * 2 * dt
                    wz = math.sin(bot.bot_strafe_t * 0.4) * 2 * dt
                if not self.collides_obstacle(bot.x + wx, bot.z):
                    bot.x += wx
                if not self.collides_obstacle(bot.x, bot.z + wz):
                    bot.z += wz
                continue

            # --- Aim (with optional lead) -------------------------------------------
            tx, tz, ty = target.x, target.z, target.y - 0.2
            # Smart bots lead the target based on its velocity over the
            # last frame interval. Bullets are effectively instant so the
            # lead is small but enough to punish strafing players.
            # Bumped lead constant 0.12→0.18 and cap 1.5→2.0 — high-tier
            # bots now lead by ~270ms of motion (was ~180ms), making it
            # very hard to dodge with sustained strafe.
            if smart and bot.bot_target_prev_pos and bot.bot_target_prev_ts > 0:
                ddt = max(0.05, now_s - bot.bot_target_prev_ts)
                vx_t = (target.x - bot.bot_target_prev_pos[0]) / ddt
                vz_t = (target.z - bot.bot_target_prev_pos[2]) / ddt
                lead_t = 0.18 * min(2.0, (difficulty - 1.4))
                tx = target.x + vx_t * lead_t
                tz = target.z + vz_t * lead_t
            bot.bot_target_prev_pos = (target.x, target.y, target.z)
            bot.bot_target_prev_ts = now_s

            dx = tx - bot.x
            dz = tz - bot.z
            dist = math.hypot(dx, dz)
            if dist > 0.01:
                # Match Three.js camera convention used by the raycast.
                bot.yaw = math.atan2(-dx, -dz)
            dy = ty - bot.y
            bot.pitch = max(-1.0, min(1.0, math.atan2(dy, dist) if dist > 0.01 else 0))

            # --- Movement -----------------------------------------------------------
            bot.bot_strafe_t += dt
            move_speed = (5.0 if smart else 4.0) * dt
            mx_, mz_ = 0.0, 0.0
            # Cover-seeking: smart bots head behind the nearest obstacle to
            # break LOS when they're hurt or just took damage. They peek out
            # to shoot, then duck back. Falls back to the normal range
            # control when no cover is found.
            seeking_cover = False
            if smart and (bot.hp < 45 or (bot.last_damage_at and (now_s - bot.last_damage_at) < 0.6)):
                best_cov = None
                best_cov_d = 1e9
                for ob in self.arena["obstacles"]:
                    ox_, oz_ = ob["x"], ob["z"]
                    # Skip obstacles that are too small to hide behind.
                    if ob["w"] < 1.0 and ob["d"] < 1.0:
                        continue
                    # Cover anchor = obstacle centre offset away from target
                    # by (half-extent + 1m) so the bot ends up shielded.
                    tdx, tdz = ox_ - target.x, oz_ - target.z
                    td = math.hypot(tdx, tdz)
                    if td < 0.1:
                        continue
                    off = max(ob["w"], ob["d"]) * 0.5 + 1.2
                    cx_ = ox_ + (tdx / td) * off
                    cz_ = oz_ + (tdz / td) * off
                    d_bot = math.hypot(cx_ - bot.x, cz_ - bot.z)
                    if d_bot < best_cov_d:
                        best_cov_d = d_bot
                        best_cov = (cx_, cz_)
                if best_cov is not None and best_cov_d > 0.6:
                    cdx = best_cov[0] - bot.x
                    cdz = best_cov[1] - bot.z
                    cd = math.hypot(cdx, cdz)
                    if cd > 0.01:
                        mx_, mz_ = cdx / cd, cdz / cd
                        seeking_cover = True
            # Smart bots prefer mid-close range (10-14m) for the AK; old
            # value 14 made them too easy to long-poke from corners.
            desired = 12.0 if smart else 14.0
            if not seeking_cover:
                if dist > desired + 2:
                    if dist > 0.01:
                        mx_, mz_ = dx / dist, dz / dist
                elif dist < desired - 4:
                    if dist > 0.01:
                        mx_, mz_ = -dx / dist, -dz / dist
            # Strafe — smart bots strafe faster and less predictably.
            # Buffed: cover-aware ranked bots strafe harder (1.2 amp / 2.6 hz)
            # so they're never sitting ducks even while peeking from cover.
            strafe_freq = 2.6 if smart else 1.4
            strafe_amp  = 1.15 if smart else 0.7
            # Dodge-on-damage: if a smart bot just took damage in the
            # last ~250ms, briefly multiply strafe amplitude so it lunges
            # out of the line of fire instead of trading shots in place.
            if smart and bot.last_damage_at and (now_s - bot.last_damage_at) < 0.25:
                strafe_amp *= 2.2
            # While actively repositioning to cover, dampen the strafe so the
            # bot actually reaches its cover point instead of oscillating.
            if seeking_cover:
                strafe_amp *= 0.35
            strafe = math.sin(bot.bot_strafe_t * strafe_freq) * strafe_amp
            if dist > 0.01:
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
                    bot.bot_strafe_t += 0.5  # flip strafe direction sooner
                if not self.collides_obstacle(bot.x, nz):
                    bot.z = nz
                else:
                    bot.bot_strafe_t += 0.5
                # Ranked bots forfeit spawn immunity the moment they start
                # moving — players were complaining that fresh ranked
                # bots could push into a fight invulnerable. Casual bots
                # keep the 3s safety net so the lobby still feels chill.
                if smart and self.is_ranked and bot.invuln_until > now_s and move_speed > 0:
                    bot.invuln_until = 0.0

            # --- Fire control -------------------------------------------------------
            difficulty = float(getattr(bot, "difficulty", 1.0))
            # Ranked-only reaction nerf: tack a small extra cooldown onto
            # ranked smart bots (the casual / offline ones are unaffected).
            # Net effect: they pull the trigger ~80ms slower than before
            # the nerf, which gives a fast-strafing player a real chance
            # to break LOS before bullets start landing.
            effective_cd = BOT_SHOT_COOLDOWN_MS / max(0.5, difficulty)
            if smart and self.is_ranked:
                effective_cd += 80
            in_burst_cooldown = smart and now_ms < bot.bot_burst_cooldown_until
            if not in_burst_cooldown and now_ms - bot.last_shot_ms >= effective_cd:
                if self._has_los(bot, target):
                    # Firing also forfeits spawn immunity on ranked bots.
                    if smart and self.is_ranked and bot.invuln_until > now_s:
                        bot.invuln_until = 0.0
                    bot.last_shot_ms = now_ms
                    orig_yaw, orig_pitch = bot.yaw, bot.pitch
                    noise = BOT_AIM_NOISE / max(0.5, difficulty)
                    # Ranked-only accuracy nerf: widen the aim cone by 35%.
                    # Keeps top-tier ranked bots threatening without their
                    # shots feeling like aimbot.
                    if smart and self.is_ranked:
                        noise *= 1.35
                    # Smart bots tighten the cone even more when standing
                    # still (they're "ADS-ing"). Stricter than before:
                    # 60% → 45% of base noise.
                    if smart and L < 0.05:
                        noise *= 0.45
                    # Ranked headshot bias — at high diff, ~30% of shots
                    # explicitly aim at the target's head height instead
                    # of chest. Nerfed by reducing the probability slope
                    # (0.35 → 0.22) and cap (0.45 → 0.30).
                    aim_at_head = smart and difficulty >= 2.2 and random.random() < min(0.30, (difficulty - 2.0) * 0.22)
                    if aim_at_head:
                        dy_head = (target.y + 0.4) - bot.y  # target.y - 0.2 was chest; +0.4 from chest = head
                        bot.pitch = max(-1.0, min(1.0, math.atan2(dy_head, max(0.01, dist))))
                    bot.yaw += random.uniform(-noise, noise)
                    bot.pitch += random.uniform(-noise * 0.7, noise * 0.7)
                    dmg = int(BOT_SHOT_DAMAGE * (0.7 + 0.4 * difficulty))
                    await self._apply_shoot(bot, dmg)
                    bot.yaw, bot.pitch = orig_yaw, orig_pitch
                    # Smart bots fire in 3-5 round bursts then pause
                    # 200-330ms (was 250-400) to let recoil reset — even
                    # more lethal cadence at the top tiers.
                    if smart:
                        if not hasattr(bot, "_burst_left"):
                            bot._burst_left = random.randint(3, 5)
                        bot._burst_left -= 1
                        if bot._burst_left <= 0:
                            bot.bot_burst_cooldown_until = now_ms + random.randint(200, 330)
                            bot._burst_left = random.randint(3, 5)

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
                # Respawn far from every other living player so they
                # don't drop straight into someone's crosshair.
                x, z = random_spawn(self.arena, occupants=list(self.players.values()))
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
                self.events.append({"type": "respawn", "id": p.id, "x": p.x, "y": p.y, "z": p.z})
            if not p.is_bot and p.alive:
                # Decay spread when not firing (Overwatch-style recoil recovery)
                cfg = weapon_cfg(p.weapon)
                p.spread = max(0.0, p.spread - cfg["spread_decay"] * dt)
                # Spread floor depends on weapon (so cone is never below base)
                if p.spread < cfg["spread_base"]:
                    p.spread = cfg["spread_base"]
                p.finish_reload_if_due()
            # Out-of-combat health regen — alive players (real or bot)
            # who haven't taken damage in `HEALTH_REGEN_DELAY` seconds
            # tick back up at `HEALTH_REGEN_PER_SEC` HP/s. Spawn-invuln
            # gold dot ticks the same way (we still respect invuln).
            if p.alive and p.hp < p.max_hp:
                last_hit = float(getattr(p, "last_damage_at", 0.0) or 0.0)
                if (now - last_hit) >= HEALTH_REGEN_DELAY:
                    new_hp = min(p.max_hp, int(p.hp + HEALTH_REGEN_PER_SEC * dt))
                    if new_hp != p.hp:
                        p.hp = new_hp
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

        # ------------------------------------------------------------------
        # Delta-broadcast state assembly.
        #   - Full keyframe (`type: "state"`) once per `_keyframe_interval`
        #     (and whenever the cache is empty — e.g. fresh room or after
        #     a match reset). Carries every field of every player.
        #   - Otherwise emit a `state_delta` that only contains players
        #     whose serialised dict differs from the last broadcast, with
        #     only their changed fields included (plus `id`). Players who
        #     left the room since the last broadcast appear in
        #     `removed_ids`. Top-level fields are likewise diffed.
        # Net effect: static fields (username, rank_*, level, banner_*,
        # skin, mag_size, platform, max_hp, is_bot) only go over the wire
        # ~1Hz instead of 20Hz, cutting JSON size + CPU dramatically on
        # full lobbies.
        # ------------------------------------------------------------------
        current_states = [p.to_state() for p in self.players.values() if not getattr(p, "is_spectator", False)]
        current_by_id = {s["id"]: s for s in current_states}

        time_left = max(0.0, self.match_duration - (now - self.match_start)) if (not in_queue) else None
        top_full = {
            "t": int(now * 1000),
            "events": self.events,
            "is_ranked": self.is_ranked,
            "time_left": time_left,
            "in_intermission": self.in_intermission,
            "in_queue": in_queue,
            "real_count": real_count,
            "min_real_players": RANKED_MIN_REAL_PLAYERS,
        }

        needs_keyframe = (
            not self._last_sent_state_by_pid
            or (now - self._last_keyframe_at) >= self._keyframe_interval
        )

        if needs_keyframe:
            state = {"type": "state", "players": current_states, **top_full}
            # Reset caches so subsequent diffs use this snapshot as their baseline.
            self._last_sent_state_by_pid = {pid: dict(s) for pid, s in current_by_id.items()}
            self._last_sent_top = dict(top_full)
            # Strip `events` from the cached top — events fire-and-forget,
            # they never appear in deltas as "unchanged".
            self._last_sent_top.pop("events", None)
            self._last_keyframe_at = now
        else:
            delta_players: List[dict] = []
            for pid, st in current_by_id.items():
                prev = self._last_sent_state_by_pid.get(pid)
                if prev is None:
                    # New player since last broadcast — send the full payload
                    # so the client can build their entry from scratch.
                    delta_players.append(st)
                    self._last_sent_state_by_pid[pid] = dict(st)
                    continue
                diff: Dict[str, object] = {}
                for k, v in st.items():
                    if prev.get(k) != v:
                        diff[k] = v
                if diff:
                    diff["id"] = pid
                    delta_players.append(diff)
                    # Roll the cache forward only for the changed fields so
                    # untouched values stay anchored to the last keyframe.
                    for k, v in diff.items():
                        prev[k] = v
            removed_ids = [pid for pid in list(self._last_sent_state_by_pid.keys()) if pid not in current_by_id]
            for pid in removed_ids:
                self._last_sent_state_by_pid.pop(pid, None)

            # Top-level diff — only include fields that changed (except for
            # `events`, which always go in full so kill-feeds / shots fire
            # exactly once on the receiving client).
            top_diff: Dict[str, object] = {"t": top_full["t"], "events": self.events}
            for k, v in top_full.items():
                if k in ("t", "events"):
                    continue
                if self._last_sent_top.get(k) != v:
                    top_diff[k] = v
                    self._last_sent_top[k] = v

            state = {"type": "state_delta", "players": delta_players, **top_diff}
            if removed_ids:
                state["removed_ids"] = removed_ids

        self.events = []
        await self.broadcast(state)

    async def end_match(self):
        """End a match: for ranked, award rank points; for casual, just show standings.
        Broadcasts a match_end payload, then resets the room after a 10s intermission."""
        self.in_intermission = True
        # Include all participants (real + bots) for placement ordering so
        # the match history shows the true total_players count. Real-player
        # RP updates still only target real_players further down.
        all_participants = [p for p in self.players.values() if not getattr(p, "is_spectator", False)]
        all_participants.sort(key=lambda p: p.kills, reverse=True)
        real_players = [p for p in all_participants if not p.is_bot and p.user_id]
        # Map each real player to their placement *among all participants*.
        placement_of = {p.id: idx + 1 for idx, p in enumerate(all_participants)}
        total_with_bots = len(all_participants)
        placements = []
        if self.is_ranked:
            # Ranked scoring is tier-gated:
            #  - High tiers (Platinum / Diamond / Master / Grandmaster /
            #    Goonmaster, idx >= 3): only 1st place gains RP. 2nd/3rd
            #    earn nothing (no loss), 4th+ lose. Forces top players to
            #    actually win, not coast.
            #  - Loss magnitude scales with tier so falling out of higher
            #    ranks hurts more (capped at -60 for Diamond+).
            for p in real_players:
                # Resolve placement vs the full lobby (so a real player
                # ranking behind 4 bots still loses RP).
                placement = placement_of.get(p.id, len(real_players))
                new_points = 0
                placement_played_before = 0
                is_placement = False
                delta = 0
                prev_tier_idx, prev_tier_name = 0, "BRONZE"
                rank_change = 0
                try:
                    udoc = await db.users.find_one({"_id": ObjectId(p.user_id)})
                    cur = int((udoc or {}).get("rank_points", 0) or 0)
                    cur_tier_idx, _ = rank_for_points(cur)
                    placement_played_before = int((udoc or {}).get("placement_matches_played", 0) or 0)
                    is_placement = placement_played_before < PLACEMENT_MATCHES
                    if is_placement:
                        # Placement matches: hard "win or lose 100" rule.
                        # Only 1st place earns RP (+100); every other
                        # placement loses 100. No tier scaling, no podium
                        # softening — placement is meant to anchor the
                        # player's true skill ceiling within the first few
                        # ranked matches.
                        if placement == 1:
                            delta = 100
                        else:
                            delta = -100
                        base_delta = delta
                    else:
                        base_delta = compute_rp_delta(placement, cur_tier_idx)
                        delta = base_delta
                    new_points = max(0, cur + delta)
                    tier_idx, tier_name = rank_for_points(new_points)
                    # Tier delta for the rank-up overlay: rank_change > 0
                    # means the player gained a tier this match.
                    prev_tier_idx, prev_tier_name = rank_for_points(cur)
                    rank_change = tier_idx - prev_tier_idx
                    prev_peak = int((udoc or {}).get("peak_rank_points", 0) or 0)
                    new_peak = max(prev_peak, new_points)
                    update_set = {"rank_points": new_points}
                    if new_peak > prev_peak:
                        update_set["peak_rank_points"] = new_peak
                    # First-place finish = a "win" for daily/lifetime
                    # challenge tracking (`stats.wins`). Without this,
                    # `stats.wins` stays at 0 forever, which is why the
                    # "Win N matches today" / "Champion" challenges never
                    # tick. Players at any placement still get +1 matches.
                    inc_doc = {"stats.matches": 1, "placement_matches_played": 1}
                    if placement == 1:
                        inc_doc["stats.wins"] = 1
                    await db.users.update_one(
                        {"_id": ObjectId(p.user_id)},
                        {"$set": update_set, "$inc": inc_doc},
                    )
                except Exception as e:
                    logger.warning("rank update failed: %s", e)
                    tier_idx, tier_name = rank_for_points(new_points)
                    prev_tier_idx, prev_tier_name = tier_idx, tier_name
                    rank_change = 0
                    base_delta = delta
                placements.append({
                    "id": p.id,
                    "user_id": p.user_id,
                    "username": p.username,
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "delta": delta,
                    "base_delta": base_delta,
                    "new_points": new_points,
                    "rank_tier": tier_idx,
                    "rank_name": tier_name,
                    # Previous tier + change so the client can play the
                    # rank-up / rank-down overlay only for actual transitions.
                    "prev_rank_tier": prev_tier_idx,
                    "prev_rank_name": prev_tier_name,
                    "rank_change": rank_change,
                    "is_placement": is_placement,
                    "placement_match_number": placement_played_before + 1 if is_placement else None,
                    "placement_matches_total": PLACEMENT_MATCHES,
                })
            # Append bot rows so the match-end overlay shows the full lobby
            # in ranked mode too. Bots earn no RP but their kills/deaths +
            # disguised rank label appear on the scoreboard.
            for p in all_participants:
                if not p.is_bot:
                    continue
                bot_placement = placement_of.get(p.id, total_with_bots)
                bot_tier_idx = int(getattr(p, "rank_tier", 0) or 0)
                bot_tier_name = getattr(p, "disguise_rank_name", None) or "BRONZE"
                placements.append({
                    "id": p.id,
                    "user_id": "",
                    "username": p.username or p.bot_name or "BOT",
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "delta": 0,
                    "base_delta": 0,
                    "new_points": 0,
                    "rank_tier": bot_tier_idx,
                    "rank_name": bot_tier_name,
                    "prev_rank_tier": bot_tier_idx,
                    "prev_rank_name": bot_tier_name,
                    "rank_change": 0,
                    "is_placement": False,
                    "placement_match_number": None,
                    "placement_matches_total": PLACEMENT_MATCHES,
                    "placement": bot_placement,
                })
            # Re-sort by kills so the bot rows interleave with real-player
            # rows by placement, not appended at the bottom.
            placements.sort(key=lambda r: (-r.get("kills", 0), r.get("deaths", 0)))
        else:
            # Casual: no RP. Build placements for ALL participants (bots
            # included) so the match-end overlay shows the full lobby's
            # kill counts — without this, only the real player's row was
            # appended and bot kills appeared to be "missing" from the
            # scoreboard.
            for p in all_participants:
                placement = placement_of.get(p.id, total_with_bots)
                if p.is_bot:
                    # Bots: zero-RP rows, no DB write. Show their disguised
                    # rank label if one was assigned (matches the in-match
                    # leaderboard widget). Avoid leaking is_bot to the
                    # client so they look like real opponents.
                    tier_idx = int(getattr(p, "rank_tier", 0) or 0)
                    tier_name = getattr(p, "disguise_rank_name", None) or "BRONZE"
                    placements.append({
                        "id": p.id,
                        "user_id": "",
                        "username": p.username or p.bot_name or "BOT",
                        "kills": p.kills,
                        "deaths": p.deaths,
                        "delta": 0,
                        "base_delta": 0,
                        "new_points": 0,
                        "rank_tier": tier_idx,
                        "rank_name": tier_name,
                        "prev_rank_tier": tier_idx,
                        "prev_rank_name": tier_name,
                        "rank_change": 0,
                        "is_placement": False,
                        "placement_match_number": None,
                        "placement_matches_total": PLACEMENT_MATCHES,
                        "placement": placement,
                    })
                    continue
                cur_points = 0
                tier_idx, tier_name = 0, "BRONZE"
                try:
                    udoc = await db.users.find_one({"_id": ObjectId(p.user_id)})
                    cur_points = int((udoc or {}).get("rank_points", 0) or 0)
                    tier_idx, tier_name = rank_for_points(cur_points)
                    # First-place finish in a casual match also counts as
                    # a win for daily/lifetime challenges. See ranked
                    # branch above — same rationale.
                    inc_doc = {"stats.matches": 1}
                    if placement == 1:
                        inc_doc["stats.wins"] = 1
                    await db.users.update_one(
                        {"_id": ObjectId(p.user_id)},
                        {"$inc": inc_doc},
                    )
                except Exception:
                    pass
                placements.append({
                    "id": p.id,
                    "user_id": p.user_id,
                    "username": p.username,
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "delta": 0,
                    "base_delta": 0,
                    "new_points": cur_points,
                    "rank_tier": tier_idx,
                    "rank_name": tier_name,
                    "prev_rank_tier": tier_idx,
                    "prev_rank_name": tier_name,
                    "rank_change": 0,
                    "is_placement": False,
                    "placement_match_number": None,
                    "placement_matches_total": PLACEMENT_MATCHES,
                    "placement": placement,
                })

        payload = {
            "type": "match_end",
            "placements": placements,
            "duration": self.match_duration,
            "is_ranked": self.is_ranked,
        }
        self.last_match_end_payload = payload
        # Snapshot the match number BEFORE the broadcast so we can scope it
        # to exactly the players who joined this match. Late joiners (joining
        # quick-play in the last few seconds) have a higher joined_match_num
        # and will get match_start cleanly without seeing the prior overlay.
        ended_match_num = self.match_num

        # Persist per-player match history (newest first via index on ended_at desc).
        # Offline rooms set self.is_offline=True; we tag those for filtering.
        # `placement` is the player's rank among *all* participants (bots
        # included) so the match card reflects what actually happened on
        # the scoreboard. `total_players` likewise counts bots.
        try:
            if real_players:
                now = datetime.now(timezone.utc)
                mode = "ranked" if self.is_ranked else ("offline" if getattr(self, "is_offline", False) else "casual")
                # Index placements by user_id so each real player gets paired
                # with their OWN placement entry. Previously we did
                # `zip(placements, real_players)` — but `placements` is sorted
                # by kills and contains both real-player AND bot rows mixed
                # together, so a real player who lost RP could end up paired
                # with a bot entry whose delta=0 → their match history
                # silently dropped the RP loss (showed "—" instead of "-60").
                placements_by_uid = {
                    entry.get("user_id"): entry
                    for entry in placements
                    if entry.get("user_id")
                }
                docs = []
                first_match_grants: List[str] = []
                for pl in real_players:
                    entry = placements_by_uid.get(pl.user_id) or {}
                    docs.append({
                        "user_id": pl.user_id,
                        "username": pl.username,
                        "mode": mode,
                        "kills": int(entry.get("kills", pl.kills) or 0),
                        "deaths": int(entry.get("deaths", pl.deaths) or 0),
                        "placement": placement_of.get(pl.id, 1),
                        "total_players": total_with_bots,
                        "rp_delta": int(entry.get("delta", 0) or 0),
                        "rank_points_after": int(entry.get("new_points", 0) or 0),
                        "rank_name_after": entry.get("rank_name") or "BRONZE",
                        "is_placement": bool(entry.get("is_placement", False)),
                        "ended_at": now,
                    })
                    # Free Mech skin grant — fires when the player's matches
                    # count was still 0 going into this match. The stats.matches
                    # $inc was already issued above, so we re-read via the doc.
                    try:
                        udoc = await db.users.find_one(
                            {"_id": ObjectId(pl.user_id)},
                            {"stats.matches": 1, "owned_skins": 1},
                        )
                        prior_matches = int(((udoc or {}).get("stats") or {}).get("matches", 0) or 0)
                        owned = set((udoc or {}).get("owned_skins") or [])
                        # `stats.matches` was incremented to N this round, so
                        # this was the player's first match if N == 1.
                        if prior_matches == 1 and "mech" not in owned:
                            first_match_grants.append(pl.user_id)
                    except Exception:
                        pass
                if docs:
                    await db.match_history.insert_many(docs)
                # Issue mech-skin grants outside the doc loop so failures
                # don't roll back the match record.
                for uid in first_match_grants:
                    try:
                        await _grant_first_match_skin(uid)
                    except Exception:
                        pass
        except Exception as e:
            logger.warning("match_history insert failed: %s", e)

        # Targeted broadcast: only players who joined this match get the
        # match_end overlay. Bots are skipped naturally (no ws). Spectators
        # also receive it so their UI can show the final standings. Track
        # the user ids we broadcast to so add()'s welcome-replay branch
        # doesn't double-show the overlay to a player who comes back via
        # the lobby during the same intermission.
        recipients = [
            p for p in self.players.values()
            if (
                getattr(p, "is_spectator", False)
                or getattr(p, "joined_match_num", ended_match_num) == ended_match_num
            )
        ]
        for p in recipients:
            if not p.is_bot and p.user_id:
                self.last_match_end_recipients.add(str(p.user_id))
        await asyncio.gather(*(self._send(p, payload) for p in recipients), return_exceptions=True)

        # Intermission: 10s
        await asyncio.sleep(10.0)

        # Pick a new map for the next match so the same lobby cycles
        # through the available arenas. Rebuild healthpacks from it.
        self.arena = random_map()
        self.healthpacks = self._build_healthpacks()

        # Reset for next match — assign spawn points round-robin from a
        # shuffled copy of the arena's spawn list so no two players land
        # on the same point and consecutive players are spread out.
        spawn_pool = list((self.arena or ARENA).get("spawn_points") or ARENA["spawn_points"])
        random.shuffle(spawn_pool)
        spawn_idx = 0
        for p in self.players.values():
            p.kills = 0
            p.deaths = 0
            sx, sz = spawn_pool[spawn_idx % len(spawn_pool)]
            spawn_idx += 1
            p.x, p.z = float(sx), float(sz)
            p.y = PLAYER_HEIGHT
            p.hp = p.max_hp
            p.alive = True
            p.invuln_until = time.time() + 3.0
            p.last_attacker = None
            # All current players are now participating in the next match.
            p.joined_match_num = self.match_num + 1
        self.match_start = time.time()
        self.in_intermission = False
        self.last_match_end_payload = None
        self.last_match_end_recipients.clear()
        self.match_num += 1

        # Ranked-bot rooms reroll bot disguises (name, avatar, rank) on
        # every new match so the player never faces "Stryker" twice in a
        # row. Names are sampled without replacement from the tier pool
        # and explicitly differ from each bot's previous match name.
        if getattr(self, "is_ranked_bot", False):
            self._reroll_ranked_bots()
        # Ship the new arena alongside match_start so clients can rebuild
        # the world geometry before the round begins.
        await self.broadcast({
            "type": "match_start",
            "duration": self.match_duration,
            "arena": self.arena,
        })

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


game_room = GameRoom(is_ranked=False, match_duration=60.0)  # 1 minute Quick Match
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
    # All ranked-vs-bots rooms now spawn 4 bots regardless of tier so the
    # lobby always looks like a full 5-player FFA (player + 4 opponents).
    # Higher tiers used to only spawn 1, which felt empty.
    return 4


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


async def get_or_create_ranked_bot_room(user_id: str, tier_idx: int, *, player_rank_points: Optional[int] = None) -> "GameRoom":
    """Per-user ranked-vs-bots room — bot count scales with tier (3 for Bronze..Diamond, 1 for Master/GM).

    When `player_rank_points` is provided, every bot's disguise rank is
    seeded around that value (±20 RP) so the bot banner shows a rank
    that matches the queueing player's actual rank instead of a random
    point inside the tier band."""
    room = RANKED_BOT_ROOMS.get(user_id)
    if room is not None:
        return room
    room = GameRoom(is_ranked=True, match_duration=120.0)
    room.is_ranked_bot = True
    room.ranked_bot_key = user_id
    room._ranked_bot_tier = int(tier_idx)
    room._ranked_bot_player_rp = player_rank_points
    bot_count = ranked_bot_count_for_tier(tier_idx)
    # Ranked bot difficulty scales aggressively with the player's tier so the
    # ladder actually feels harder as you climb: Bronze 1.4 → Grandmaster 2.6.
    # (Higher diff = faster reactions, better aim, more accurate fire — see
    # the bot tick in GameRoom.tick().)
    # Buffed base 1.4→1.6 and per-tier scaling 0.2→0.25 — ranked bots now
    # range 1.60 (Bronze) → 3.10 (Grandmaster/Goonmaster). Earlier players
    # found them too easy at higher tiers.
    # Buffed difficulty curve — quickplay was easy, ranked at low tiers was
    # too forgiving. Base 1.6→1.9 and per-tier scaling 0.25→0.30 — ranked
    # bots now range **1.90 (Bronze) → 3.70 (Grandmaster/Goonmaster)**.
    ranked_difficulty = 1.9 + min(6, tier_idx) * 0.30
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
        # of obvious BRONZE placeholders. `disguise_rank_points`, when
        # provided, seeds the visible RP around the queueing player's
        # actual RP so the bot banner reads ~the same rank, not "DIAMOND
        # 1820" when the player is "DIAMOND 1750".
        room.spawn_bot(
            name,
            disguised=True,
            difficulty=ranked_difficulty,
            disguise_tier_idx=tier_idx,
            disguise_rank_points=player_rank_points,
        )
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
    return max(1, int(round(fill)))


async def matchmaker_loop():
    while True:
        try:
            now = time.time()
            async with QUEUE_LOCK:
                # Pair entries (each entry can hold 1 user or a whole party).
                # We match two entries head-to-head; every user_id in either
                # entry is tagged MATCHED with the same match_id so all
                # party-mates enter the ranked room together.
                for tier_idx, q in RANKED_QUEUE.items():
                    while len(q) >= 2:
                        a = q.pop(0)
                        b = q.pop(0)
                        mid = uuid.uuid4().hex[:10]
                        a_uids = a.get("user_ids") or ([a["user_id"]] if a.get("user_id") else [])
                        b_uids = b.get("user_ids") or ([b["user_id"]] if b.get("user_id") else [])
                        for uid in a_uids + b_uids:
                            MATCHED_USERS[uid] = {"match_id": mid, "tier": tier_idx, "matched_at": now}
                        # Record wait-to-match for the ETA estimator. Using max
                        # of both entries' waits = the longer wait, which is
                        # what new entrants will most likely experience.
                        RECENT_MATCH_WAITS[tier_idx].append(max(now - a["joined_at"], now - b["joined_at"]))
                        logger.info(
                            "Matched tier=%d entryA=%s (party=%s) vs entryB=%s (party=%s) mid=%s",
                            tier_idx, ",".join(a.get("usernames") or [a.get("username", "?")]),
                            bool(a.get("is_party")),
                            ",".join(b.get("usernames") or [b.get("username", "?")]),
                            bool(b.get("is_party")),
                            mid,
                        )
                # Bot-fill: an entry queued longer than the tier-specific
                # timeout gets matched against bots. Works the same for
                # parties — the entire entry's user_ids get matched.
                # Goonmaster (tier 7) has timeout=inf — unreachable here.
                for tier_idx, q in RANKED_QUEUE.items():
                    tier_timeout = bot_fill_seconds_for_tier(tier_idx)
                    if tier_timeout == float("inf"):
                        continue
                    while q and (now - q[0]["joined_at"]) >= tier_timeout:
                        a = q.pop(0)
                        mid = uuid.uuid4().hex[:10]
                        a_uids = a.get("user_ids") or ([a["user_id"]] if a.get("user_id") else [])
                        # For party bot-fills, every member must join the *same*
                        # private bot room — key it by the first user (leader)
                        # so all followers resolve to the same GameRoom.
                        shared_key = a_uids[0] if a_uids else None
                        for uid in a_uids:
                            MATCHED_USERS[uid] = {"match_id": mid, "tier": tier_idx, "matched_at": now, "vs_bot": True, "room_key": shared_key}
                        RECENT_MATCH_WAITS[tier_idx].append(now - a["joined_at"])
                        logger.info(
                            "Bot-filled tier=%d entry=%s (party=%s, %d users) after %ds queue",
                            tier_idx,
                            ",".join(a.get("usernames") or [a.get("username", "?")]),
                            bool(a.get("is_party")), len(a_uids), int(tier_timeout),
                        )
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


async def _party_for_user(user_id: str) -> Optional[dict]:
    """Look up the user's current party (if any). Returns the party dict
    from PARTIES or None. Wraps PARTY_MEMBER_INDEX for callers that don't
    need to import the global directly."""
    pid = PARTY_MEMBER_INDEX.get(user_id)
    if not pid:
        return None
    return PARTIES.get(pid)


async def _max_party_tier(party: dict) -> tuple[int, str, str]:
    """Resolve the highest rank tier across `party`'s members.

    Returns `(tier_idx, tier_name, highest_member_username)`. Used by the
    party-ranked queue to lock the whole party into the leader's strongest
    tier so the group can't dodge into a softer bracket by inviting a
    low-ranked friend.
    """
    best_pts = -1
    best_tier_idx = 0
    best_user = ""
    for uid in party.get("members", []):
        try:
            doc = await db.users.find_one({"_id": ObjectId(uid)}, {"rank_points": 1, "username": 1})
            pts = int((doc or {}).get("rank_points", 0) or 0)
            if pts > best_pts:
                best_pts = pts
                ti, _ = rank_for_points(pts)
                best_tier_idx = ti
                best_user = (doc or {}).get("username", "")
        except Exception:
            continue
    if best_pts < 0:
        best_pts = 0
    _, best_name = rank_for_points(best_pts)
    return best_tier_idx, best_name, best_user


def _remove_user_from_ranked_queue(user_id: str) -> Optional[dict]:
    """Remove every queue entry that contains `user_id` from RANKED_QUEUE
    (lock must be held by caller). Returns the removed entry (the first
    one found) so callers can mirror MATCHED_USERS cleanup for any other
    party-mate that was tagged together.

    With party support, an entry can hold multiple user_ids — yanking it
    out for any one user effectively un-queues the whole party.
    """
    removed: Optional[dict] = None
    for q in RANKED_QUEUE.values():
        keep: List[dict] = []
        for e in q:
            uids = e.get("user_ids") or ([e["user_id"]] if e.get("user_id") else [])
            if user_id in uids:
                if removed is None:
                    removed = e
                continue
            keep.append(e)
        q[:] = keep
    return removed


@api.post("/queue/ranked")
async def queue_ranked_join(user: dict = Depends(get_current_user)):
    """Enqueue the caller for ranked. If they're in a party, the whole
    party queues together at the *highest* member's tier; only the leader
    can press the button. Solo players are unchanged."""
    user_id = str(user["_id"])
    # Gate: Ranked locks until Level 5 — protects new players + their MMR.
    user_level = compute_level(user.get("stats", {}))["level"]
    if user_level < RANKED_MIN_LEVEL:
        raise HTTPException(
            status_code=403,
            detail=f"Ranked unlocks at Level {RANKED_MIN_LEVEL}. You are Level {user_level}.",
        )
    party = await _party_for_user(user_id)
    is_party = bool(party)
    if is_party and party.get("leader_id") != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the party leader can queue ranked.",
        )
    # Resolve tier — party uses max(members.rank_tier).
    if is_party:
        # Every party member must be eligible — block the entry if any
        # member is below RANKED_MIN_LEVEL. Prevents using low-level alts
        # to game the tier calculation (their points are 0 but they could
        # still drag the group into a match they can't survive).
        for uid in party["members"]:
            mdoc = await db.users.find_one({"_id": ObjectId(uid)}, {"stats": 1, "username": 1})
            mlvl = compute_level((mdoc or {}).get("stats", {}))["level"]
            if mlvl < RANKED_MIN_LEVEL:
                raise HTTPException(
                    status_code=403,
                    detail=f"Party member {(mdoc or {}).get('username', '?')} is Level {mlvl} (Ranked needs L{RANKED_MIN_LEVEL}).",
                )
        tier_idx, tier_name, top_user = await _max_party_tier(party)
        member_ids = list(party["members"])
        usernames = []
        for uid in member_ids:
            mdoc = await db.users.find_one({"_id": ObjectId(uid)}, {"username": 1})
            usernames.append((mdoc or {}).get("username", "?"))
        logger.info(
            "Party-ranked queue join: party=%s leader=%s tier=%d (%s, anchored by %s) members=%d",
            party.get("party_id") or party.get("_id") or "?",
            user.get("username", "?"),
            tier_idx, tier_name, top_user, len(member_ids),
        )
    else:
        points = int(user.get("rank_points", 0) or 0)
        tier_idx, tier_name = rank_for_points(points)
        member_ids = [user_id]
        usernames = [user.get("username", "")]
    fill = bot_fill_seconds_for_tier_api(tier_idx)
    now_ts = time.time()
    async with QUEUE_LOCK:
        # If any of the resolved member ids is already matched, surface that.
        for mid in member_ids:
            if mid in MATCHED_USERS:
                m = MATCHED_USERS[mid]
                return {"matched": True, "match_id": m["match_id"], "tier": m["tier"], "tier_name": tier_name, "wait_seconds": 0, "bot_fill_seconds": fill}
        # If anyone is already queued, return that state (idempotent).
        for q in RANKED_QUEUE.values():
            for e in q:
                uids = e.get("user_ids") or ([e["user_id"]] if e.get("user_id") else [])
                if any(mid in uids for mid in member_ids):
                    elapsed = now_ts - e["joined_at"]
                    return {"in_queue": True, "tier": tier_idx, "tier_name": tier_name, "position": q.index(e) + 1, "tier_size": len(q), "wait_seconds": int(elapsed), "bot_fill_seconds": fill, "estimated_wait_seconds": estimate_wait_seconds(tier_idx, elapsed), "is_party": is_party, "party_size": len(member_ids)}
        RANKED_QUEUE[tier_idx].append({
            "user_ids": member_ids,
            "usernames": usernames,
            # Back-compat: keep `user_id`/`username` populated with the
            # primary user (caller). Older code paths still read these.
            "user_id": user_id,
            "username": user.get("username", ""),
            "joined_at": now_ts,
            "is_party": is_party,
            "party_id": (party or {}).get("party_id") if is_party else None,
        })
    return {"in_queue": True, "tier": tier_idx, "tier_name": tier_name, "position": len(RANKED_QUEUE[tier_idx]), "tier_size": len(RANKED_QUEUE[tier_idx]), "wait_seconds": 0, "bot_fill_seconds": fill, "estimated_wait_seconds": estimate_wait_seconds(tier_idx, 0.0), "is_party": is_party, "party_size": len(member_ids)}


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
            uids = e.get("user_ids") or ([e["user_id"]] if e.get("user_id") else [])
            if user_id in uids:
                elapsed = now_ts - e["joined_at"]
                return {
                    "in_queue": True, "tier": ti, "tier_name": tier_name,
                    "position": i + 1, "tier_size": len(q),
                    "wait_seconds": int(elapsed),
                    "bot_fill_seconds": bot_fill_seconds_for_tier_api(ti),
                    "estimated_wait_seconds": estimate_wait_seconds(ti, elapsed),
                    "is_party": bool(e.get("is_party")),
                    "party_size": len(uids),
                }
    return {"in_queue": False, "matched": False, "tier": tier_idx, "tier_name": tier_name, "wait_seconds": 0, "bot_fill_seconds": fill}


@api.delete("/queue/ranked")
async def queue_ranked_leave(user: dict = Depends(get_current_user)):
    """Leave the ranked queue. For party queues, this dequeues every
    member of the party so the group can't be 'half-queued' (which would
    desync everyone's state)."""
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        removed = _remove_user_from_ranked_queue(user_id)
        # Clear MATCHED_USERS for everyone in the removed entry — if they
        # got matched mid-leave, that ack is now stale.
        cleared = set([user_id])
        if removed:
            for uid in (removed.get("user_ids") or []):
                cleared.add(uid)
        for uid in cleared:
            MATCHED_USERS.pop(uid, None)
    return {"ok": True}


@api.post("/queue/ranked/ack")
async def queue_ranked_ack(user: dict = Depends(get_current_user)):
    """Called by client after entering the ranked match to clear matched state."""
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        MATCHED_USERS.pop(user_id, None)
    return {"ok": True}


@api.get("/queue/casual/status")
async def queue_casual_status(user: dict = Depends(get_current_user)):
    """Live count of real (non-spectator, non-bot) players currently in
    the shared casual room. Used by the lobby's Quick Match countdown to
    show "X PLAYER(S) FOUND" before bot-fill takes over. Excludes the
    caller themselves so the indicator reads as 'other humans found'."""
    user_id = str(user["_id"])
    real_count = 0
    for p in game_room.players.values():
        if p.is_bot or getattr(p, "is_spectator", False):
            continue
        if p.user_id and str(p.user_id) == user_id:
            continue
        real_count += 1
    return {"real_players": real_count, "total_players": len(game_room.players)}


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
    members = [await _party_card(uid) for uid in p["members"]]
    # Surface the tier the party would queue ranked at (max across members)
    # so the lobby button can show "RANKED MATCH · PLATINUM" before the
    # leader presses it. Cheap because we already loaded each member.
    best_pts = 0
    best_tier_idx = 0
    best_user = ""
    for m in members:
        if int(m.get("rank_points", 0) or 0) >= best_pts:
            best_pts = int(m.get("rank_points", 0) or 0)
            best_tier_idx = int(m.get("rank_tier", 0) or 0)
            best_user = m.get("username", "")
    _, best_tier_name = rank_for_points(best_pts)
    return {
        "party_id": party_id,
        "leader_id": p["leader_id"],
        "members": members,
        "match_starting": bool(p.get("match_starting", False)),
        "max_size": MAX_PARTY_SIZE,
        "ranked_tier": best_tier_idx,
        "ranked_tier_name": best_tier_name,
        "ranked_anchored_by": best_user,
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
    uid = str(u["_id"])
    # `in_queue` checks the ranked matchmaker dict — friend rows surface a
    # small "QUEUEING…" badge when a friend is waiting for ranked.
    in_queue = False
    queue_tier = None
    try:
        for ti, q in RANKED_QUEUE.items():
            for e in q:
                uids = e.get("user_ids") or ([e["user_id"]] if e.get("user_id") else [])
                if uid in uids:
                    in_queue = True
                    queue_tier = ti
                    break
            if in_queue:
                break
    except Exception:
        pass
    return {
        "id": uid,
        "username": u.get("username", ""),
        "avatar": int(u.get("avatar", 0) or 0),
        "rank_points": pts,
        "rank_tier": t_idx,
        "rank_name": t_name,
        "level": lvl["level"],
        "banner_icon": int(u.get("banner_icon", 0) or 0),
        "banner_color": int(u.get("banner_color", 0) or 0),
        "banner_animated": bool(u.get("banner_animated", False)),
        "online": is_online(uid),
        "in_match": loc is not None and loc.get("kind") in ("casual", "ranked", "party", "offline"),
        "match_kind": loc.get("kind") if loc else None,
        "in_queue": in_queue,
        "queue_tier": queue_tier,
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


# ─── Player reports ─────────────────────────────────────────────────────
# Players can flag opponents from the in-match scoreboard. Reports are
# stored in the `reports` collection and rate-limited per (reporter,
# reported, reason) tuple to 1 / hour to prevent spam. Admin review UX is
# out of scope here — this just gives players an outlet.
REPORT_REASONS = {"cheating", "harassment", "griefing", "offensive_name", "other"}


class PlayerReportIn(BaseModel):
    reported_username: str = Field(min_length=2, max_length=30)
    reason: str = Field(min_length=2, max_length=30)
    note: Optional[str] = Field(default=None, max_length=500)


@api.post("/reports/player")
async def report_player(payload: PlayerReportIn, user: dict = Depends(get_current_user)):
    """File a moderation report against another player. Idempotent within
    1 hour for the same reporter/reported/reason combo (returns the
    existing entry instead of inserting a duplicate)."""
    reason = payload.reason.strip().lower()
    if reason not in REPORT_REASONS:
        raise HTTPException(status_code=400, detail=f"Invalid reason. Must be one of: {sorted(REPORT_REASONS)}")
    reported_username = payload.reported_username.strip()
    if reported_username.lower() == (user.get("username") or "").lower():
        raise HTTPException(status_code=400, detail="You can't report yourself.")
    target = await db.users.find_one(
        {"username": {"$regex": f"^{reported_username}$", "$options": "i"}},
        {"_id": 1, "username": 1},
    )
    if not target:
        # Allow bot reports (no DB row) — they still count toward feedback
        # signal even though there's nothing for admins to action.
        target = {"_id": None, "username": reported_username}
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)
    # Idempotency: if same reporter / target / reason within last hour,
    # return existing.
    existing = await db.reports.find_one({
        "reporter_id": str(user["_id"]),
        "reported_username": target["username"],
        "reason": reason,
        "created_at": {"$gte": one_hour_ago},
    }, {"_id": 0})
    if existing:
        return {"ok": True, "deduped": True, "report": {
            "reported_username": existing["reported_username"],
            "reason": existing["reason"],
            "created_at": existing["created_at"].isoformat() if isinstance(existing.get("created_at"), datetime) else existing.get("created_at"),
        }}
    doc = {
        "reporter_id": str(user["_id"]),
        "reporter_username": user.get("username", ""),
        "reported_user_id": str(target["_id"]) if target.get("_id") else None,
        "reported_username": target["username"],
        "reason": reason,
        "note": (payload.note or "").strip() or None,
        "created_at": now,
        "status": "open",
    }
    await db.reports.insert_one(doc)
    logger.info(
        "Player report filed: reporter=%s target=%s reason=%s",
        user.get("username"), target["username"], reason,
    )
    return {"ok": True, "deduped": False, "report": {
        "reported_username": doc["reported_username"],
        "reason": doc["reason"],
        "created_at": doc["created_at"].isoformat(),
    }}


@api.get("/reports/player")
async def list_reports(
    user: dict = Depends(get_current_user),
    status: Optional[str] = None,
    limit: int = 50,
):
    """List filed player reports. Admin-only (role=='admin'). Returns the
    most-recent N reports (optionally filtered by status), plus a summary
    of the most-reported usernames and each reported player's current ban
    status. Reports include their MongoDB id so they can be closed."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    limit = max(1, min(200, int(limit)))
    query: dict = {}
    if status:
        query["status"] = status
    cursor = db.reports.find(query).sort("created_at", -1).limit(limit)
    rows = []
    usernames_seen = set()
    async for r in cursor:
        r["id"] = str(r.pop("_id"))
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
        if isinstance(r.get("closed_at"), datetime):
            r["closed_at"] = r["closed_at"].isoformat()
        usernames_seen.add(r.get("reported_username"))
        rows.append(r)

    # Aggregate count per reported username (top 20) — used by the
    # dashboard's "Most-Reported" widget.
    pipeline = [
        {"$group": {"_id": "$reported_username", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 20},
    ]
    summary = []
    async for s in db.reports.aggregate(pipeline):
        usernames_seen.add(s["_id"])
        summary.append({"reported_username": s["_id"], "count": s["count"]})

    # Resolve each unique reported user's current ban status so the UI
    # can show "BANNED" / "SUSPENDED UNTIL …" / "ACTIVE" badges without a
    # second round-trip per row.
    bans: dict[str, dict] = {}
    if usernames_seen:
        async for u in db.users.find(
            {"username": {"$in": list(usernames_seen)}},
            {"username": 1, "ban": 1, "_id": 0},
        ):
            b = check_ban(u) if u.get("ban") else None
            if b:
                bans[u["username"]] = b
            else:
                bans[u["username"]] = {"status": "active"}
    return {"reports": rows, "summary": summary, "total": len(rows), "bans": bans}


class BanUserIn(BaseModel):
    duration_hours: Optional[int] = Field(default=None, ge=1, le=24 * 365)  # None = permanent
    reason: str = Field(min_length=2, max_length=500)
    report_id: Optional[str] = None  # if set, close that report at the same time


@api.post("/admin/users/{username}/ban")
async def admin_ban_user(
    username: str,
    payload: BanUserIn,
    user: dict = Depends(get_current_user),
):
    """Issue a permanent ban (duration_hours=None) or temporary suspension.
    Admin-only. If `report_id` is provided, that report is marked
    `closed` with the resulting action attached so the audit trail
    matches the moderation decision."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    target = await db.users.find_one({"username": username})
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Refusing to ban another admin.")
    now = datetime.now(timezone.utc)
    until = now + timedelta(hours=payload.duration_hours) if payload.duration_hours else None
    ban_doc = {
        "status": "suspended" if until else "banned",
        "reason": payload.reason.strip(),
        "at": now,
        "until": until,
        "by": user.get("username"),
    }
    await db.users.update_one({"_id": target["_id"]}, {"$set": {"ban": ban_doc}})
    # Optionally close the report that triggered this action.
    if payload.report_id:
        try:
            from bson import ObjectId
            await db.reports.update_one(
                {"_id": ObjectId(payload.report_id)},
                {"$set": {
                    "status": "closed",
                    "closed_at": now,
                    "closed_by": user.get("username"),
                    "action": ban_doc["status"],
                    "action_until": until,
                }},
            )
        except Exception as e:
            logger.warning("Failed to close report %s after ban: %s", payload.report_id, e)
    logger.info(
        "Admin %s issued %s on %s reason=%s until=%s",
        user.get("username"), ban_doc["status"], username, ban_doc["reason"], until,
    )
    return {"ok": True, "ban": {**ban_doc, "at": ban_doc["at"].isoformat(), "until": until.isoformat() if until else None}}


@api.post("/admin/users/{username}/unban")
async def admin_unban_user(username: str, user: dict = Depends(get_current_user)):
    """Clear any active ban/suspension on the target user."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    target = await db.users.find_one({"username": username})
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    await db.users.update_one({"_id": target["_id"]}, {"$set": {"ban": {"status": "active"}}})
    logger.info("Admin %s unbanned %s", user.get("username"), username)
    return {"ok": True}


@api.post("/admin/reports/{report_id}/close")
async def admin_close_report(report_id: str, user: dict = Depends(get_current_user)):
    """Mark a single report as closed without taking a ban action — used
    for false-positive / no-action-needed cases."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    try:
        from bson import ObjectId
        oid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report id.")
    now = datetime.now(timezone.utc)
    res = await db.reports.update_one(
        {"_id": oid},
        {"$set": {"status": "closed", "closed_at": now, "closed_by": user.get("username"), "action": "dismissed"}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Report not found.")
    return {"ok": True}


# Seed-veteran name pool — cosmetic, used only by the admin seed endpoint
# below. Mixed style: gamer tags, single-word handles, and a few "esports
# pro" sounding aliases so the leaderboard reads as a real competitive
# scene instead of obviously-fake entries.
_SEED_VETERAN_HANDLES = [
    # Goonmaster / Grandmaster — top-tier pro / streamer feel
    "Vyperr", "OmegaZion", "Apex.Velox", "Nyxenith", "Korvax_TV",
    "Zephyr0", "Hydra_x", "Maelstr0m", "Phantasm", "Eclipse_FN",
    # Master / Diamond — competitive grinders
    "neonRipper", "tilted_AI", "icefall42", "Quill.OP", "Shroud_clone",
    "Cobalt_Rage", "Lunarus", "voidwxlk", "GhostByte", "Karasu_zX",
    # Platinum / Gold — solid mid-ranked
    "wraithlight", "VelvetVx", "noctilune", "kestrel.99", "RustClad",
    "amber_ix", "hexProwler", "Crimson_M", "DustWxlf", "syntaxia",
    # Silver / lower Gold — sprinkle a few approachable handles
    "tinytim_xd", "BoxFrag", "QuickJab", "saltyMVP", "rookie__",
]


class SeedVeteransIn(BaseModel):
    # Optional: caller can ask for a specific count, default 25. Capped to
    # avoid runaway DB writes if someone retries the call by accident.
    count: int = Field(default=25, ge=1, le=120)
    # Reset existing seeded accounts first? When True we wipe every doc
    # tagged `is_seeded=True` before inserting fresh ones, so re-running
    # the endpoint doesn't pile up stale handles.
    reset: bool = False
    # Floor for Goonmaster (tier 7) seeds — guarantees the top of the
    # ladder has at least this many accounts regardless of how the
    # weighted distribution shakes out. Default 4.
    min_goonmasters: int = Field(default=4, ge=0, le=20)
    # Floor applied per-tier index (0=Bronze .. 7=Goonmaster). Skipped
    # tiers default to 0. Used to top off any thin buckets after the
    # random fill so the board feels populated.
    min_per_tier: Dict[int, int] = Field(default_factory=dict)


@api.post("/admin/seed/veterans")
async def admin_seed_veterans(payload: SeedVeteransIn, user: dict = Depends(get_current_user)):
    """Seed the leaderboard with N pretend-veteran accounts spanning the
    full rank ladder (Bronze..Goonmaster). All seeded docs are tagged
    `is_seeded=True` so they can be cleaned up later. RP per account is
    drawn from a hand-tuned distribution: heavy mid-game (Plat..Diamond),
    a healthy Master+ population, and a small Goonmaster elite tip so the
    top of the board doesn't sit empty. Each account also receives a
    plausible K/D, match count, and `placement_matches_played` so the
    leaderboard filter `placement_matches_played >= 1 AND rank_points > 0`
    actually catches them. Admin-only."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    if payload.reset:
        await db.users.delete_many({"is_seeded": True})

    # RP buckets: (low, high, weight). The weights add up to 100 and
    # produce a long-tail distribution that looks like a real ladder —
    # most players sit Gold/Plat/Diamond, fewer climb to Master+, only a
    # handful reach Goonmaster.
    buckets = [
        (40,   95,   8),   # late Bronze
        (110,  240,  12),  # Silver
        (260,  490,  18),  # Gold
        (520,  790,  22),  # Platinum
        (820, 1190,  20),  # Diamond
        (1220, 1690, 12),  # Master
        (1720, 2290,  6),  # Grandmaster
        (2300, 3200,  2),  # Goonmaster
    ]
    weights = [b[2] for b in buckets]
    # Build a shuffled deck of handle suffixes so duplicates within a
    # single seed run are extremely unlikely.
    suffix_pool = list(range(100, 999))
    random.shuffle(suffix_pool)

    inserted: List[dict] = []
    now = datetime.now(timezone.utc)

    # Per-tier RP windows so the "top off" pass can pick a realistic RP
    # for a specific rank without consulting the weighted bucket list.
    TIER_RP_WINDOWS = {
        0: (40,   95),
        1: (110,  240),
        2: (260,  490),
        3: (520,  790),
        4: (820, 1190),
        5: (1220, 1690),
        6: (1720, 2290),
        7: (2300, 3200),
    }

    async def _build_and_insert(rp: int):
        """Build one realistic veteran doc with the given RP and insert
        it. Returns the inserted-username summary or None on duplicate."""
        base = random.choice(_SEED_VETERAN_HANDLES)
        if random.random() < 0.4 or any(d["username"] == base for d in inserted) or await db.users.find_one({"username": base}):
            if not suffix_pool:
                return None
            username = f"{base}{suffix_pool.pop()}"
        else:
            username = base
        rank_idx, _name = rank_for_points(rp)
        matches = random.randint(15 + rank_idx * 10, 40 + rank_idx * 35)
        kills = int(matches * random.uniform(2.5 + rank_idx * 0.4, 4.0 + rank_idx * 0.55))
        deaths = max(1, int(kills / random.uniform(0.95 + rank_idx * 0.12, 1.45 + rank_idx * 0.18)))
        wins = max(0, int(matches * random.uniform(0.35 + rank_idx * 0.03, 0.5 + rank_idx * 0.04)))
        doc = {
            "email": f"seed_{username.lower()}_{int(now.timestamp())}_{len(inserted)}@virtue.seed",
            "password_hash": "",
            "username": username,
            "role": "user",
            "is_seeded": True,
            "stats": {"kills": kills, "deaths": deaths, "matches": matches, "wins": wins},
            "rank_points": rp,
            "placement_matches_played": PLACEMENT_MATCHES,
            "level": random.randint(5, 28 + rank_idx * 4),
            "xp": 0,
            "created_at": now - timedelta(days=random.randint(7, 120)),
        }
        try:
            await db.users.insert_one(doc)
            inserted.append({"username": username, "rank_points": rp, "rank_tier": rank_idx})
            return inserted[-1]
        except Exception:
            return None

    # ---- Main weighted fill ------------------------------------------------
    for _ in range(payload.count):
        lo, hi, _w = random.choices(buckets, weights=weights, k=1)[0]
        rp = random.randint(lo, hi)
        await _build_and_insert(rp)

    # ---- Floor-top-off pass ------------------------------------------------
    # Combine `min_goonmasters` (tier 7 shortcut) with `min_per_tier` so
    # the caller can either set just the Goonmaster floor or specify a
    # per-tier minimum across the board.
    floors = {7: payload.min_goonmasters}
    for tier_idx, count_min in (payload.min_per_tier or {}).items():
        floors[int(tier_idx)] = max(floors.get(int(tier_idx), 0), int(count_min))
    for tier_idx, need in floors.items():
        if need <= 0 or tier_idx not in TIER_RP_WINDOWS:
            continue
        have = sum(1 for d in inserted if d["rank_tier"] == tier_idx)
        for _ in range(max(0, need - have)):
            lo, hi = TIER_RP_WINDOWS[tier_idx]
            await _build_and_insert(random.randint(lo, hi))

    return {"ok": True, "inserted": len(inserted), "preview": inserted[:10]}



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
            room.spawn_bot(name, disguised=True, difficulty=1.15)
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
        # Even with no party association, scrub them from the ranked queue
        # — defensive against stale state.
        async with QUEUE_LOCK:
            _remove_user_from_ranked_queue(user_id)
            MATCHED_USERS.pop(user_id, None)
        return
    party = PARTIES[party_id]
    # If the party is currently in the ranked queue, dequeue the whole
    # entry so the remaining members aren't stuck in a half-broken group.
    # This mirrors the explicit /queue/ranked DELETE behavior.
    async with QUEUE_LOCK:
        removed = _remove_user_from_ranked_queue(user_id)
        cleared = set([user_id])
        if removed:
            for uid in (removed.get("user_ids") or []):
                cleared.add(uid)
        for uid in cleared:
            MATCHED_USERS.pop(uid, None)
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
            # For party bot-fills, every member resolves to the leader's
            # private room via the shared room_key. Solo bot-fills fall back
            # to the caller's own id (same as before).
            shared_key = matched.get("room_key") or u_id
            # Pass the queueing player's exact rank_points so the bot
            # disguise banner matches their real rank (±20) instead of a
            # random pick from the tier band.
            room = await get_or_create_ranked_bot_room(
                shared_key,
                int(matched.get("tier", 0)),
                player_rank_points=int(user.get("rank_points", 0) or 0),
            )
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
            bot_key = loc.get("ranked_bot_key")
            if bot_key and bot_key in RANKED_BOT_ROOMS:
                room = RANKED_BOT_ROOMS[bot_key]
            elif str(target_user["_id"]) in RANKED_BOT_ROOMS:
                room = RANKED_BOT_ROOMS[str(target_user["_id"])]
            else:
                room = ranked_room
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
            # Use the room's actual key (leader id for party bot-fills,
            # solo player id otherwise) so cleanup matches the room map.
            await cleanup_ranked_bot_room_if_empty(getattr(room, "ranked_bot_key", str(user["_id"])))


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
    # Only include players who have actually played at least one ranked
    # match this season. We track that via `placement_matches_played` —
    # incremented on every completed ranked match (see end_match flow).
    # Players who have only ever played Casual/Practice/Offline are
    # excluded so the board reflects real ranked activity. We also gate
    # on `rank_points > 0` as a belt-and-suspenders filter for any legacy
    # accounts that may have been seeded with a non-zero RP without the
    # placement counter ever firing.
    query = {
        "placement_matches_played": {"$gte": 1},
        "rank_points": {"$gt": 0},
    }
    cursor = db.users.find(
        query,
        {"_id": 1, "username": 1, "rank_points": 1, "stats": 1, "email": 1,
         "placement_matches_played": 1, "is_seeded": 1},
    ).sort([("rank_points", -1)]).limit(50)
    # Time-bucketed pseudo-online for seeded accounts: stable for
    # ~5 minutes (so the same names stay green if a user refreshes), then
    # rotates naturally. Hash-mixing the bucket with the username keeps
    # the pattern deterministic per-account without storing state. ~38%
    # of seeded names appear online at any given moment.
    bucket = int(time.time() // 300)
    rows = []
    async for u in cursor:
        s = u.get("stats", {})
        pts = int(u.get("rank_points", 0) or 0)
        idx, name = rank_for_points(pts)
        username = u.get("username", u.get("email", "anon"))
        user_id = str(u.get("_id"))
        if u.get("is_seeded"):
            # Pseudo-online flag. hash() is randomized per-process, so we
            # use a stable hash that survives across workers.
            import hashlib
            h = hashlib.md5(f"{username}:{bucket}".encode()).digest()[0]
            online = h < 97  # ~38% online (97/256)
        else:
            online = is_online(user_id)
        rows.append({
            "username": username,
            "rank_points": pts,
            "rank_tier": idx,
            "rank_name": name,
            "kills": s.get("kills", 0),
            "deaths": s.get("deaths", 0),
            "online": online,
            # in_match flag is reserved for true players currently
            # connected to a ranked room — seeded accounts never appear
            # in-match (they can't be spectated, the endpoint would 404).
            "in_match": False,
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
