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
import re
import time
import uuid
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple

import bcrypt
import jwt
from bson import ObjectId
from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# Pure-logic helpers extracted into `_lib/` during the 2026-02-24
# maintainability refactor. Every symbol is re-exported below so
# existing callers (`server.RANK_TIERS`, `server.hash_password`, ...)
# and the entire pytest suite keep working unchanged.
from _lib.ranks import (  # noqa: F401 — re-exported public API
    RANK_TIERS,
    MASTERS_TIER_IDX,
    PLACEMENT_PERF_BONUS_CAP,
    PLACEMENT_PERF_PENALTY_CAP,
    PLACEMENT_HIGH_TIER_WIN_CAP,
    rank_for_points,
    rank_division_for_points,
    rank_division_roman,
    compute_rp_delta,
    compute_placement_delta,
)
from _lib.security import (  # noqa: F401 — re-exported public API
    JWT_ALGORITHM,
    ACCESS_TTL_MIN,
    REFRESH_TTL_DAYS,
    hash_password,
    verify_password,
    get_jwt_secret,
    create_access_token,
    create_refresh_token,
    set_auth_cookies,
)

# -------------------------------------------------------------------
# Setup
# -------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("shooter")

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT_ALGORITHM / ACCESS_TTL_MIN / REFRESH_TTL_DAYS are re-exported
# from `_lib.security` (see the top-of-file import block).
SEASON_LENGTH_DAYS = 30

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
# `hash_password`, `verify_password`, `get_jwt_secret`,
# `create_access_token`, `create_refresh_token`, `set_auth_cookies`
# are all re-exported from `_lib.security` (see top-of-file import).
# The pieces that need `db` (`_user_from_token`, `get_current_user`)
# stay below.
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


def xp_threshold_for_level(level: int) -> int:
    """Cumulative XP required to REACH the given level (i.e., the XP the
    user needs to display at exactly `level` with 0 XP into it). Used by
    the seeded-bot pipeline to pin their displayed level via `bonus_xp`.

    Mirrors the `while` loop in `compute_level`:
      threshold(L) = Σ (50 * i * (i+1))  for i in 1..L-1
                   = 50 * (L-1) * L * (L+1) / 3
    """
    L = max(1, int(level))
    if L <= 1:
        return 0
    return 50 * (L - 1) * L * (L + 1) // 3


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
    # Ultimate Gooner: attach leaderboard_rank from the cached top-50
    # map so scoreboards / kill feed / friends list can render the
    # flame + #N badge on any Ultimate Gooner (not just the requesting
    # user). Outside of top-50 the field stays absent — the client
    # treats missing/null as "not Ultimate Gooner".
    uid_str = str(user.get("_id", ""))
    ultimate_pos = TOP50_GOONER_IDS.get(uid_str)
    payload_extras = {"leaderboard_rank": ultimate_pos} if ultimate_pos else {}
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "username": user.get("username", user["email"].split("@")[0]),
        "role": user.get("role", "user"),
        "avatar": int(user.get("avatar", 0) or 0),
        "banner_icon": int(user.get("banner_icon", 0) or 0),
        "banner_color": int(user.get("banner_color", 0) or 0),
        "banner_animated": bool(user.get("banner_animated", False)),
        # Past-season peak titles — array of {season, tier, tier_name, rp}
        # stamped at each `maybe_reset_season` rollover. `title_season`
        # is the currently-equipped title's season number (or null).
        "past_seasons": list(user.get("past_seasons") or []),
        "title_season": (int(user["title_season"]) if isinstance(user.get("title_season"), (int, float)) else None),
        # `title_ultimate` — when True the player has equipped the
        # "ULTIMATE GOONER" banner title. Only valid when they're
        # currently in the top-50 GOONMASTER cache; renderers verify
        # `leaderboard_rank` before actually displaying it so a stale
        # flag left over from dropping out of top-50 is a no-op.
        "title_ultimate": bool(user.get("title_ultimate", False)),
        "stats": stats,
        "level": lvl["level"],
        "xp": lvl["xp"],
        "xp_into_level": lvl["xp_into_level"],
        "xp_for_next": lvl["xp_for_next"],
        "rank_points": points,
        "rank_tier": tier_idx,
        "rank_name": tier_name,
        "rank_division": rank_division_for_points(points, tier_idx),
        "peak_rank_points": peak,
        "peak_rank_tier": peak_idx,
        "peak_rank_name": peak_name,
        "peak_rank_division": rank_division_for_points(peak, peak_idx),
        "profile_private": bool(user.get("profile_private", False)),
        "placement_matches_played": placement_played,
        "placement_matches_total": PLACEMENT_MATCHES,
        "in_placements": placement_played < PLACEMENT_MATCHES,
        "coins": int(user.get("coins", 0) or 0),
        "xp_boost_seconds_remaining": xp_boost_remaining_seconds(user),
        "xp_boost_multiplier": xp_boost_active_multiplier(user),
        # Absolute epoch seconds for the boost expiry so the client
        # can tick a live countdown (Date.now()) without re-fetching
        # /auth/me every second. Zero when no boost is active.
        "xp_boost_until": float(user.get("xp_boost_until", 0) or 0),
        "owned_skins": owned,
        "selected_skin": selected,
        # Primary-weapon loadout choice. Persisted via /profile/me/weapon.
        # Defaults to "ak47" for legacy accounts. Read at WS connect to
        # seed `player.weapon` so the match starts with the chosen gun.
        "primary_weapon": (user.get("primary_weapon") or "ak47"),
        # Security-question presence marker for the profile UI. We
        # never return the answer hash (obviously). The UI uses this
        # to decide whether to show "Set" vs "Update" copy.
        "security_question": user.get("security_question") or None,
        # Ranked early-leave penalty timer (epoch seconds remaining).
        # 0 when not banned — lobby UI hides the lock pill in that
        # case. Returned as an int so a quick client-side countdown
        # is trivial (`Math.max(0, remaining - secondsSinceFetch)`).
        "ranked_ban_seconds": _ranked_ban_seconds(user),
        "created_at": user.get("created_at").isoformat() if isinstance(user.get("created_at"), datetime) else user.get("created_at"),
        **payload_extras,
    }


def _ranked_ban_seconds(user: dict) -> int:
    """Seconds remaining on this user's ranked-leave penalty, or 0
    if not currently banned. Treats naive datetimes as UTC for the
    handful of legacy docs that predate timezone awareness."""
    raw = user.get("ranked_ban_until")
    if not isinstance(raw, datetime):
        return 0
    if raw.tzinfo is None:
        raw = raw.replace(tzinfo=timezone.utc)
    delta = raw - datetime.now(timezone.utc)
    return max(0, int(delta.total_seconds()))


# -------------------------------------------------------------------
# Season (rank reset every SEASON_LENGTH_DAYS)
# -------------------------------------------------------------------
async def get_or_init_season() -> dict:
    """Return the current season doc, initializing it on first run.

    The `_id` field here is the literal string "season" (not an ObjectId)
    so the doc is JSON-safe to return as-is. We strip it anyway because
    callers only use the season_number / season_start fields and the
    linter's "don't return raw find_one docs" heuristic flags any direct
    return."""
    doc = await db.meta.find_one({"_id": "season"})
    now = datetime.now(timezone.utc)
    if not doc:
        doc = {"_id": "season", "season_number": 1, "season_start": now}
        await db.meta.insert_one(doc)
    return {
        "season_number": int(doc.get("season_number", 1) or 1),
        "season_start": doc.get("season_start"),
    }


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
        # Archive the top-100 ranked players' final standings for this
        # season BEFORE zeroing everyone's RP. The snapshot doc lives in
        # `season_archive` keyed by `{season_number}` so a future
        # "/leaderboard/archive/:N" endpoint can read it back without
        # ever touching the live users collection.
        await _archive_season_top_100(int(doc.get("season_number", 1)), start, now)
        # Snapshot current rank into peak_rank_points (only if higher), then
        # apply the soft reset: drop everyone 9 sub-tiers (= 900 RP, since
        # each sub-tier is exactly 100 RP wide), clamped at 0. This keeps
        # established players in the upper half of the ladder so they
        # don't have to grind back through Bronze every month, while
        # still rewarding new-season activity.
        # Pass progression (`season_xp` + `claimed_season_tiers`) is ALSO
        # wiped here so every player starts the new season at Pass Tier 0
        # with no claimed rewards — without this the pass UI would keep
        # showing last-season's level + greyed-out "already claimed"
        # buttons in the new season. Skins that were already granted
        # stay in `owned_skins` (append-only) so players keep cosmetics
        # they earned last season.
        # Season reset math per-tier:
        #   - Diamond+ (RP ≥ 1500) hard-land at EMERALD III (1200 RP).
        #     Rationale: seeding the new EMERALD tier with returning
        #     high-tier veterans so it has population from day one of
        #     the new season, instead of leaving it empty until natural
        #     climbers reach 1200 RP. This replaces the previous
        #     "Goonmasters land at Diamond III" rule — Diamond, Master,
        #     Grandmaster, and Goonmaster all converge to the Emerald
        #     floor now.
        #   - Everyone else drops SEASON_RESET_RP_DROP (900 RP = 3
        #     sub-tiers) with a floor of 0.
        SEASON_RESET_RP_DROP = 900  # 3 sub-tiers × 300 RP soft reset
        DIAMOND_FLOOR_RP = RANK_TIERS[5][0]      # 1500 — Diamond III entry (the threshold that flags a "Diamond+" player)
        EMERALD_III_RP = RANK_TIERS[4][0]        # 1200 — Emerald III entry (season-reset landing spot for Diamond+)

        # Roll-back helper — mirrors the aggregation logic in the
        # `update_many` below so seeded bots use the SAME rules as real
        # players.
        def _rollback_rp(rp: int) -> int:
            if rp >= DIAMOND_FLOOR_RP:
                return EMERALD_III_RP
            return max(0, rp - SEASON_RESET_RP_DROP)
        finishing_season = int(doc.get("season_number", 1))
        # Refresh the cached prev-season number so newly-created bots
        # stamp their titles with the freshly-completed season.
        _CACHED_PREV_SEASON_NUMBER[0] = int(finishing_season)
        # Stamp a past-season entry on every user who reached at least
        # Bronze this season. `past_seasons` is an append-only array of
        # `{season, tier, tier_name}` dicts consumed by the banner "title"
        # picker so players can flex "SEASON 2 · DIAMOND" long after
        # rollover wipes their live RP. Uses the FINAL rank_points (still
        # in place at this point — we drop RP in the next update_many).
        # Note: we can't compute tier inline via a Mongo pipeline
        # (rank thresholds live in Python), so this is a discrete cursor
        # pass. Rank tier is computed from the pre-reset RP.
        try:
            # Pull the just-archived top-50 into a user_id → rank map so
            # the past_seasons entry can carry the player's leaderboard
            # position ("#7 GOONMASTER") — surfaces on the title picker
            # in Profile and on the banner in-game. Kept in-memory for
            # the rollover pass so we don't re-query per user.
            rank_by_uid: Dict[str, int] = {}
            try:
                arc = await db.season_archive.find_one(
                    {"season_number": finishing_season},
                    {"top_100": 1, "_id": 0},
                )
                for row in (arc or {}).get("top_100", []):
                    uid = str(row.get("user_id") or "")
                    pos = int(row.get("rank", 0) or 0)
                    if uid and 1 <= pos <= 50:
                        rank_by_uid[uid] = pos
            except Exception as e:
                logger.warning("past_seasons rank lookup failed S%d: %s", finishing_season, e)
            cursor = db.users.find(
                {"rank_points": {"$gt": 0}},
                {"_id": 1, "rank_points": 1, "past_seasons": 1},
            )
            async for u in cursor:
                pts = int(u.get("rank_points", 0) or 0)
                t_idx, t_name = rank_for_points(pts)
                past = list(u.get("past_seasons") or [])
                # Idempotent — if we're re-running rollover for the same
                # season number (shouldn't happen, but safe), skip.
                if any(int(e.get("season", -1)) == finishing_season for e in past):
                    continue
                entry = {
                    "season": finishing_season,
                    "tier": int(t_idx),
                    "tier_name": t_name,
                    "rp": pts,
                }
                # Attach the top-50 placement so the title picker can
                # render "#7 GOONMASTER" — the Ultimate Gooner call-out
                # the user asked for.
                pos = rank_by_uid.get(str(u["_id"]))
                if pos:
                    entry["leaderboard_rank"] = int(pos)
                past.append(entry)
                await db.users.update_one(
                    {"_id": u["_id"]},
                    {"$set": {"past_seasons": past}},
                )
        except Exception as e:
            logger.warning("past_seasons stamp failed at S%d rollover: %s", finishing_season, e)

        await db.users.update_many(
            {"rank_points": {"$exists": True}, "is_seeded": {"$ne": True}},
            [{
                "$set": {
                    "peak_rank_points": {
                        "$max": [
                            {"$ifNull": ["$peak_rank_points", 0]},
                            {"$ifNull": ["$rank_points", 0]},
                        ]
                    },
                    "rank_points": {
                        # $cond: if the player was Diamond+ (RP ≥ 1500),
                        # snap them to Emerald III floor (1200) so the
                        # new EMERALD tier is populated from day one.
                        # Otherwise apply the standard -900 soft reset
                        # with a 0 floor.
                        "$cond": [
                            {"$gte": [{"$ifNull": ["$rank_points", 0]}, DIAMOND_FLOOR_RP]},
                            EMERALD_III_RP,
                            {
                                "$max": [
                                    0,
                                    {"$subtract": [{"$ifNull": ["$rank_points", 0]}, SEASON_RESET_RP_DROP]},
                                ]
                            },
                        ]
                    },
                    "placement_matches_played": 0,
                    "season_xp": 0,
                    "claimed_season_tiers": [],
                }
            }],
        )

        # Seeded leaderboard bots — separate pass so they get ROLLED BACK
        # instead of the full-reset-to-0 they'd suffer if we let the
        # `seeded_climb_loop` (which drives `rank_points = seed_target_rp
        # * frac_elapsed`) rebuild them from `frac=0` at the start of
        # the new season. That was leaving the leaderboard empty for
        # the first few days of every season.
        #
        # Behaviour now (per user request "keep it full"):
        #   1) `seed_start_rp` is set to the rolled-back RP using the
        #      same rules as real players (Goonmaster→Diamond3 or −900
        #      floor 0). This becomes the bot's baseline for the new
        #      season's climb.
        #   2) `rank_points` snaps to `seed_start_rp` immediately so the
        #      leaderboard reflects the rolled-back values right after
        #      rollover.
        #   3) `seed_target_rp` is retained — bots continue climbing
        #      back toward their end-of-last-season target across the
        #      new season, so the leaderboard stays populated and grows
        #      as the season progresses.
        # The climb-loop lerp is updated below to interpolate from
        # `seed_start_rp` instead of 0.
        try:
            seeded_cursor = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": True, "$gt": 0}},
                {"_id": 1, "seed_target_rp": 1, "rank_points": 1, "peak_rank_points": 1},
            )
            async for u in seeded_cursor:
                # Use the bot's END-OF-SEASON target as the "final RP"
                # to roll back — this is where they actually ended (or
                # were headed) even if the mid-season snapshot in
                # `rank_points` was lower.
                end_rp = int(u.get("seed_target_rp", 0) or 0)
                start_rp = _rollback_rp(end_rp)
                cur_peak = int(u.get("peak_rank_points", 0) or 0)
                await db.users.update_one(
                    {"_id": u["_id"]},
                    {"$set": {
                        "seed_start_rp": start_rp,
                        "rank_points": start_rp,
                        # Stamp peak from the end-of-season target if
                        # higher than what's on file (they earned it).
                        "peak_rank_points": max(cur_peak, end_rp),
                        "placement_matches_played": 0,
                        "season_xp": 0,
                        "claimed_season_tiers": [],
                    }},
                )
        except Exception as e:
            logger.warning("Seeded-bot rollback failed at S%d rollover: %s", finishing_season, e)
        await db.meta.update_one(
            {"_id": "season"},
            {"$set": {"season_number": next_num, "season_start": now}},
        )
        logger.info("Season reset → S%d", next_num)
        doc = {"_id": "season", "season_number": next_num, "season_start": now}
    return doc


async def _archive_season_top_100(season_number: int, started_at: datetime, ended_at: datetime) -> None:
    """Snapshot the top-100 ranked players' final standings for `season_number`
    into the `season_archive` collection.

    Each archived player row carries name/avatar/rank/RP/match-count at the
    moment of rollover. Idempotent — re-running on the same season number
    replaces the existing snapshot rather than appending duplicates.
    """
    # Only include players who finished at least one placement and have RP > 0
    # (matches the live leaderboard filter so the archive looks consistent
    # with what people saw the day before rollover).
    cursor = db.users.find(
        {"placement_matches_played": {"$gte": 1}, "rank_points": {"$gt": 0}},
        {
            "username": 1, "rank_points": 1, "stats": 1,
            "avatar": 1, "banner_icon": 1, "banner_color": 1,
            "selected_skin": 1,
        },
    ).sort([("rank_points", -1), ("stats.kills", -1)]).limit(100)
    rows: List[dict] = []
    rank = 0
    async for u in cursor:
        rank += 1
        pts = int(u.get("rank_points", 0) or 0)
        tier_idx, tier_name = rank_for_points(pts)
        stats = u.get("stats") or {}
        rows.append({
            "rank": rank,
            "username": u.get("username") or "Player",
            "rank_points": pts,
            "rank_tier": tier_idx,
            "rank_name": tier_name,
            "kills": int(stats.get("kills", 0) or 0),
            "matches": int(stats.get("matches", 0) or 0),
            "wins": int(stats.get("wins", 0) or 0),
            "avatar": int(u.get("avatar", 0) or 0),
            "banner_icon": int(u.get("banner_icon", 0) or 0),
            "banner_color": int(u.get("banner_color", 0) or 0),
            "selected_skin": u.get("selected_skin") or "default",
            "user_id": str(u.get("_id")),
        })
    # Replace-on-conflict so an admin who manually fires `start_new_season`
    # multiple times against the same season doesn't accumulate stale rows.
    await db.season_archive.update_one(
        {"_id": int(season_number)},
        {"$set": {
            "season_number": int(season_number),
            "started_at": started_at,
            "ended_at": ended_at,
            "total_players": len(rows),
            "top_100": rows,
        }},
        upsert=True,
    )
    logger.info("Season %d archived → %d player rows", season_number, len(rows))


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


# `RANK_TIERS` is imported from `_lib.ranks` at the top of this file.
# Keeping the source of truth in one place — any ladder shuffle now
# touches only `_lib/ranks.py`.



# ─── Ultimate Gooner cache ───────────────────────────────────────────────
# The top-50 GOONMASTER players (globally, by rank_points) get a special
# "ULTIMATE GOONER" display tier — a flame icon with their leaderboard
# number overlaid. This cache maps user_id -> position (1..50) so that
# every `public_user()` payload (scoreboard, kill feed, friends list,
# match state) can flag the top-50 without paying a count_documents
# query per user. Refreshed by `refresh_ultimate_gooner_cache()` at
# startup + every 30s from the tick loop.
TOP50_GOONER_IDS: Dict[str, int] = {}
_ULTIMATE_GOONER_REFRESHED_AT: float = 0.0
ULTIMATE_GOONER_REFRESH_INTERVAL_S = 30.0


async def refresh_ultimate_gooner_cache() -> None:
    """Recompute the top-50 GOONMASTER user_id → position map from Mongo.
    Cheap ($sort + $limit(50) on an already-indexed rank_points field)
    so it's safe to call every 30s from the background tick loop.
    On DB failure the previous cache is preserved — we'd rather show a
    slightly-stale badge than a wrong one."""
    global TOP50_GOONER_IDS, _ULTIMATE_GOONER_REFRESHED_AT
    try:
        # Only GOONMASTER (rank_points >= 2100) can be Ultimate Gooner.
        cursor = db.users.find(
            {"rank_points": {"$gte": RANK_TIERS[-1][0]}},
            {"_id": 1, "rank_points": 1},
        ).sort("rank_points", -1).limit(50)
        new_map: Dict[str, int] = {}
        pos = 0
        async for doc in cursor:
            pos += 1
            new_map[str(doc["_id"])] = pos
        TOP50_GOONER_IDS = new_map
        _ULTIMATE_GOONER_REFRESHED_AT = time.time()
    except Exception as e:
        logger.warning("ultimate-gooner refresh failed: %s", e)

# Rank + placement math (RANK_TIERS, MASTERS_TIER_IDX, rank_for_points,
# rank_division_for_points, rank_division_roman, compute_rp_delta,
# compute_placement_delta, PLACEMENT_* caps) all live in
# `_lib/ranks.py` and are re-exported at the top of this file. This
# comment block used to hold ~100 lines of pure math — now the
# math lives in one place and any future ladder tweak (e.g. rescaling
# every RP band) is a single-file change.


# -------------------------------------------------------------------
# Skins + In-Game Currency (COINS)
# -------------------------------------------------------------------
# Coins are earned ONLY via redeem codes + automatic level-up rewards.
# No in-match earning — kills/wins don't grant coins (kept that way so
# the economy can be tuned later via promo events).
COINS_PER_LEVEL = 100  # awarded once per level the player reaches.

# XP Boost store items — coin-only consumables that grant a 2x XP
# multiplier for a set duration. Applied at end_match: bonus_xp is
# credited equal to the natural stats-derived XP earned that match,
# so a player with a 2x boost effectively earns double. Stacking
# purchases EXTEND the timer (max(now, prev_until) + duration) so
# players never "waste" the tail of an old boost.
BOOSTS_CATALOG: List[dict] = [
    {
        "id": "boost_1h",
        "name": "1-Hour XP Boost",
        "duration_sec": 60 * 60,
        "multiplier": 2.0,
        "price": 300,
        "rarity": "common",
        "tagline": "2x XP for 60 minutes",
    },
    {
        "id": "boost_24h",
        "name": "1-Day XP Boost",
        "duration_sec": 24 * 60 * 60,
        "multiplier": 2.0,
        "price": 800,
        "rarity": "rare",
        "tagline": "2x XP for a full day",
    },
    {
        "id": "boost_7d",
        "name": "1-Week XP Boost",
        "duration_sec": 7 * 24 * 60 * 60,
        "multiplier": 2.0,
        "price": 3000,
        "rarity": "epic",
        "tagline": "2x XP for seven days — best value",
    },
]
BOOSTS_BY_ID: Dict[str, dict] = {b["id"]: b for b in BOOSTS_CATALOG}


def xp_boost_bonus_for_match(user: dict, kills: int, placement: int) -> int:
    """Bonus XP to credit at match end, on top of the natural stats-
    derived XP, when the caller has an active XP boost.

    Natural XP contributions for a single match are:
      - 25 XP per match played
      - 50 XP per win (placement == 1)
      - 10 XP per kill
    We mirror those numbers here and multiply by (mult - 1) so a 2x
    boost effectively DOUBLES the earned XP without touching the
    stats-derived path (compute_level stays a pure function of stats).
    """
    if xp_boost_remaining_seconds(user) <= 0:
        return 0
    mult = xp_boost_active_multiplier(user)
    if mult <= 1.0:
        return 0
    natural = 25 + (50 if placement == 1 else 0) + max(0, int(kills)) * 10
    return int(round(natural * (mult - 1.0)))



def xp_boost_remaining_seconds(user: dict) -> int:
    """Seconds of 2x XP left on this user's active boost. Zero when no
    boost is active or the timer has elapsed. Read on public_user +
    end_match; the frontend uses it to render the countdown pill."""
    until = float(user.get("xp_boost_until", 0) or 0)
    now = time.time()
    if until <= now:
        return 0
    return int(until - now)


def xp_boost_active_multiplier(user: dict) -> float:
    """Effective XP multiplier right now (1.0 when no active boost).
    Kept as a float so a future 1.5x / 3x product can be added by
    tweaking BOOSTS_CATALOG alone."""
    if xp_boost_remaining_seconds(user) <= 0:
        return 1.0
    return float(user.get("xp_boost_multiplier", 2.0) or 2.0)


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

    # ─── Astronaut — detailed shop skin with custom render hooks ────────
    # Triggered client-side by `id === "astronaut"` in `_buildHumanoid`:
    # adds a life-support backpack, twin animated thruster cones, a
    # mission patch, pulsing status LED, antenna, and a sweeping visor
    # reflection. Server-side just records the price + rarity so the
    # shop "Owned / Buy" gate and skin grants work like any other entry.
    {"id": "astronaut", "name": "Lunar Pioneer", "price": 4200, "rarity": "legendary", "obtain": "shop",
     "body": 0xF5F5F5, "leg": 0xEAEAEA, "head": 0xF2C08A, "accent": 0xD0D0D0,
     "helmet": 0xF5F5F5, "visor": 0x0A1A38, "shoulder": 0xD8D8D8, "stripe": 0xC1322B,
     "belt": 0x6A6A6A, "cape": None,
     "aura": 0xBFE8FF, "aura_mode": "pulse"},

    # ─── Legacy pass skins — retained for existing owners ───────────────
    # These were the Season 1 pass rewards (tiers 10/20/30) until the
    # meteor lineup replaced them in 2026-06. The catalog keeps them so
    # players who already unlocked them still render correctly; the
    # `_legacy` suffix on `obtain` tells the UI to display them as a
    # historical/retired badge rather than a current pass reward.
    {"id": "solar",    "name": "Solar Inferno",  "price": 0,    "rarity": "epic",      "obtain": "pass_tier_10_legacy",
     "body": 0xff5500, "leg": 0x6b1a00, "head": 0xf2c08a, "accent": 0xffd700,
     "helmet": 0x6b1a00, "visor": 0xffd700, "shoulder": 0xff8a00, "stripe": 0xffd700, "belt": 0x3a0a00, "cape": 0xff8a00,
     "aura": 0xff8a00, "aura_mode": "pulse"},

    {"id": "cyber",    "name": "Cyber Wraith",   "price": 0,    "rarity": "epic",      "obtain": "pass_tier_20_legacy",
     "body": 0x1a1a3a, "leg": 0x05051a, "head": 0xbac4d6, "accent": 0x00ffaa,
     "helmet": 0x05051a, "visor": 0x00ffaa, "shoulder": 0x00ffaa, "stripe": 0x00ffaa, "belt": 0x0a0a2a, "cape": 0x00ffaa,
     "aura": 0x00ffaa, "aura_mode": "flicker"},

    {"id": "quantum",  "name": "Quantum Reaver", "price": 0,    "rarity": "legendary", "obtain": "pass_tier_30_legacy",
     "body": 0x4b0082, "leg": 0x1a0033, "head": 0xc8a8ff, "accent": 0xffffff,
     "helmet": 0x1a0033, "visor": 0xffffff, "shoulder": 0xff00ff, "stripe": 0xffffff, "belt": 0x4b0082, "cape": 0xff00ff,
     "aura": 0xff00ff, "aura_mode": "spin"},

    # ─── Meteor / Space lineup — formerly Season 2 pass; now SHOP only
    #     (2026-06-29 pass is coins-only). Existing owners keep them. ───
    {"id": "stardust", "name": "Stardust Drifter", "price": 2800, "rarity": "epic",      "obtain": "shop",
     # Deep space drifter — twilight body with starfield glints. Soft
     # nebula-violet → indigo gradient feel, silver accents.
     "body": 0x1a1538, "leg": 0x0b0a22, "head": 0xb0a8d8, "accent": 0xc8d4ff,
     "helmet": 0x0b0a22, "visor": 0x88e0ff, "shoulder": 0x4a3d7a, "stripe": 0x88e0ff, "belt": 0x1a1538, "cape": 0x4a3d7a,
     "aura": 0x88e0ff, "aura_mode": "flicker"},

    {"id": "crater",   "name": "Crater Forged",   "price": 3200, "rarity": "epic",      "obtain": "shop",
     # Forged-from-meteor-rock — scorched basalt body, molten orange seams.
     # Reads as a survivor of the impact, armor still smouldering.
     "body": 0x2a1b14, "leg": 0x110a06, "head": 0xa07a5a, "accent": 0xff6420,
     "helmet": 0x110a06, "visor": 0xff8a40, "shoulder": 0x5a2a14, "stripe": 0xff6420, "belt": 0x110a06, "cape": 0xff4a10,
     "aura": 0xff5a1a, "aura_mode": "pulse"},

    {"id": "meteor",   "name": "Meteor Ascendant", "price": 5500, "rarity": "legendary", "obtain": "shop",
     # Cosmic ascension — supernova gold against deep indigo, halo flares
     # in the legendary slot. The "after-the-impact-came-the-rebirth" vibe.
     "body": 0x2a1058, "leg": 0x10042a, "head": 0xffe0a8, "accent": 0xffd24a,
     "helmet": 0x10042a, "visor": 0xffd24a, "shoulder": 0xffaa20, "stripe": 0xffd24a, "belt": 0x4a1a78, "cape": 0xffd24a,
     "aura": 0xffd24a, "aura_mode": "spin"},

    # ─── 2026-06-29 expansion — 5 new high-detail shop skins ────────────
    # Layered palettes with cape + helmet + visor + stripe + accent all
    # tuned for crisp contrast at small avatar sizes. Each has a unique
    # aura mode so they feel distinct in motion.

    # Samurai — ronin red lacquer + obsidian inner armor, gold filigree
    # accent on the cape. The Inferno Lord's hot brother, less chaos.
    {"id": "ronin",     "name": "Crimson Ronin",   "price": 3600, "rarity": "epic",      "obtain": "shop",
     "body": 0xa3001a, "leg": 0x1a0a0a, "head": 0xf2c08a, "accent": 0xffd700,
     "helmet": 0x0a0a0a, "visor": 0xff1a1a, "shoulder": 0xffd700, "stripe": 0x0a0a0a, "belt": 0xffd700, "cape": 0x6b0010,
     "aura": 0xff3a3a, "aura_mode": "spin"},

    # Royal — emerald velvet + ivory trim + gold crown accent. Cape is
    # full-length for a regal silhouette.
    {"id": "monarch",   "name": "Emerald Monarch", "price": 4200, "rarity": "epic",      "obtain": "shop",
     "body": 0x0d6b3a, "leg": 0x052a16, "head": 0xf2c08a, "accent": 0xffd700,
     "helmet": 0xffd700, "visor": 0xffe066, "shoulder": 0xffd700, "stripe": 0xfafafa, "belt": 0xffd700, "cape": 0x062a18,
     "aura": 0xffd700, "aura_mode": "pulse"},

    # Cyber-knight — chrome blue + neon magenta seams + holographic cape.
    # The Cyber Wraith's evolved cousin, more saturated.
    {"id": "neonknight", "name": "Neon Knight",    "price": 4800, "rarity": "legendary", "obtain": "shop",
     "body": 0x0a0a3a, "leg": 0x05051a, "head": 0xc8d4ff, "accent": 0xff00aa,
     "helmet": 0x0a0a3a, "visor": 0xff00ff, "shoulder": 0x00d4ff, "stripe": 0xff00aa, "belt": 0x05051a, "cape": 0x6b00aa,
     "aura": 0xff00ff, "aura_mode": "rainbow"},

    # Phoenix — molten orange body + crimson accents + flame-gold cape
    # that reads as a tail of fire. Pairs with the existing inferno aura.
    {"id": "phoenix",   "name": "Phoenix Rebirth", "price": 5200, "rarity": "legendary", "obtain": "shop",
     "body": 0xff5500, "leg": 0x6b1a00, "head": 0xffaa70, "accent": 0xffd700,
     "helmet": 0x6b1a00, "visor": 0xffd700, "shoulder": 0xff8a00, "stripe": 0xffd700, "belt": 0x3a0a00, "cape": 0xff2a00,
     "aura": 0xff5a00, "aura_mode": "flame"},

    # Stealth ninja — flat black with neon-mint stripe + visor + cape.
    # Reads as a high-end "agent" silhouette. Spin aura for the energy
    # wash around movement.
    {"id": "shadowblade", "name": "Shadowblade",   "price": 3400, "rarity": "epic",      "obtain": "shop",
     "body": 0x0a0a0a, "leg": 0x000000, "head": 0xf2c08a, "accent": 0x00ffaa,
     "helmet": 0x000000, "visor": 0x00ffaa, "shoulder": 0x1a1a1a, "stripe": 0x00ffaa, "belt": 0x000000, "cape": 0x1a1a1a,
     "aura": 0x00ffaa, "aura_mode": "flicker"},

    # ─── 2026-02 knight — detailed shop skin with custom render hooks ─────
    # Triggered client-side by `id === "knight"` in `_buildHumanoid`:
    # adds a closed pointed-top helmet with an eye slit, a tall red plume,
    # pauldrons + gorget plating detail on the shoulders/neck, a wide
    # metallic belt buckle, and a full kite shield with a golden cross
    # mounted on the back. Palette leans polished silver / royal red /
    # brass gold so the silhouette reads instantly as a classic knight.
    {"id": "knight",    "name": "Silver Sentinel", "price": 5000, "rarity": "legendary", "obtain": "shop",
     "body": 0xC8CBD1, "leg": 0xA8ABB1, "head": 0xF2C08A, "accent": 0xE6C74A,
     "helmet": 0xC8CBD1, "visor": 0x1a1a1a, "shoulder": 0xB8BBC1, "stripe": 0xB80020, "belt": 0x8B6914, "cape": 0xB80020,
     "aura": 0xE6C74A, "aura_mode": "pulse"},

    # ─── 2026-02 nurse — SILENT TOWN horror crossover, custom render hooks ─
    # Triggered client-side by `id === "nurse"` in `_buildHumanoid`:
    # Silent Hill 2 tribute — a bandage-wrapped nurse in a blood-stained
    # short white dress. The head is entirely wound in bloody gauze so no
    # face is visible (matches the source-material silhouette). Bare pale
    # arms with blood streaks, white knee-high stockings, dark low-heeled
    # shoes, and a small white nurse cap with a red cross. Slight twitch
    # in idle animation + a low-lying red flicker aura. Colors below are
    # the palette base (dress cream, stockings ivory, bandage tan, deep
    # blood red); most of the horror detail is drawn by the render hook.
    {"id": "nurse",     "name": "Nurse",           "price": 5500, "rarity": "legendary", "obtain": "shop",
     "body": 0xdfd0b8, "leg": 0xe8dcbb, "head": 0xc8b09a, "accent": 0x8b0d0d,
     "helmet": 0xf0e6d0, "visor": 0x5a1010, "shoulder": 0xdfd0b8, "stripe": 0x6b0808, "belt": 0xe8dcbb, "cape": None,
     "aura": 0x8b0d0d, "aura_mode": "flicker"},
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
        # Detach from the find_one cursor result so callers (and the
        # linter) treat this like any other dict. `_id` is still an
        # ObjectId — callers handle that via `_clean_user_for_response`
        # before any HTTP response is built.
        return None if user is None else {**user}
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
# Security-question presets. The user picks ONE at registration (or
# adds it later via /profile/me/security-question). Answer is hashed
# with bcrypt after lower-strip normalisation so verification is
# case/whitespace insensitive but the plaintext is never stored.
SECURITY_QUESTIONS = [
    "What was the name of your first pet?",
    "What city were you born in?",
    "What is your mother's maiden name?",
    "What was the make of your first car?",
    "What was the name of your primary school?",
]


def _norm_answer(a: str) -> str:
    return (a or "").strip().lower()


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)
    username: str = Field(min_length=2, max_length=20)
    # Optional at register (backwards compat with legacy clients that
    # don't collect the question). If present, we hash the answer and
    # store both fields; if absent the user can add them later.
    security_question: Optional[str] = None
    security_answer: Optional[str] = Field(default=None, min_length=2, max_length=100)


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    remember: bool = True


class ForgotPasswordChallengeIn(BaseModel):
    email: EmailStr


class ForgotPasswordResetIn(BaseModel):
    email: EmailStr
    answer: str = Field(min_length=1, max_length=100)
    new_password: str = Field(min_length=6, max_length=100)


class SetSecurityQuestionIn(BaseModel):
    question: str
    answer: str = Field(min_length=2, max_length=100)


class UsernameChangeIn(BaseModel):
    username: str = Field(min_length=2, max_length=20)


# -------------------------------------------------------------------
# Startup
# -------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username")
    # rank_points is queried both by the top-50 Ultimate Gooner refresh
    # and by any global leaderboard endpoints — index it descending.
    await db.users.create_index([("rank_points", -1)])
    await db.match_history.create_index([("user_id", 1), ("ended_at", -1)])
    # Prime the Ultimate Gooner cache once at boot so the very first
    # /auth/me response after a restart carries the correct badge for
    # any top-50 player. Subsequent refreshes are triggered by the
    # background tick loop every ULTIMATE_GOONER_REFRESH_INTERVAL_S.
    try:
        await refresh_ultimate_gooner_cache()
    except Exception as e:
        logger.warning("initial ultimate-gooner cache prime failed: %s", e)
    # Friendships: bidirectional pair, status in {pending,accepted,blocked}.
    # Pending: `from_user_id` sent the request; `to_user_id` must accept.
    await db.friendships.create_index([("from_user_id", 1), ("to_user_id", 1)], unique=True)
    await db.friendships.create_index("to_user_id")
    await db.friendships.create_index("from_user_id")
    # News-post like tracking. Compound unique index enforces the
    # one-like-per-user rule cheaply, and the secondary lookup (list_news
    # batch-fetching the caller's likes) uses the same prefix.
    await db.news_post_likes.create_index(
        [("user_id", 1), ("post_id", 1)], unique=True
    )
    await db.news_post_likes.create_index("post_id")

    # One-time migration: backfill `expires_at` on legacy admin-created
    # redeem codes that pre-date the expiry/cap feature. Default cutoff
    # is `created_at + 30 days` (or now+30d if `created_at` is missing).
    # Idempotent — only touches docs missing `expires_at`.
    try:
        default_window = timedelta(days=30)
        async for doc in db.redeem_codes.find({"expires_at": {"$exists": False}}):
            base = doc.get("created_at")
            if not isinstance(base, datetime):
                base = datetime.now(timezone.utc)
            await db.redeem_codes.update_one(
                {"_id": doc["_id"]},
                {"$set": {"expires_at": base + default_window}},
            )
    except Exception as _migrate_err:
        logger.warning("redeem_codes expires_at migration failed: %s", _migrate_err)
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
    # difficulty=0.9 — nerfed from 1.15 per user request. Sub-Platinum
    # players are the ones meeting casual bots (the ranked matchmaker
    # pulls Plat+ players away), so keep this forgiving. Ranked bots
    # (below) stay at 1.9 for the real challenge.
    for name in random.sample(DISGUISED_BOT_NAMES, NUM_BOTS):
        game_room.spawn_bot(name, disguised=True, difficulty=0.9)
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
    # TDM quick-match room: pre-fill with 8 disguised smart bots so the
    # room is permanently at 4v4 strength even with zero real players.
    # `_maintain_tdm_population` (called on every join/leave) will swap
    # bots in/out 1-for-1 as humans arrive and depart. Disguised=True so
    # the lobby reads as a 4v4 of "real" people (DISGUISED_BOT_NAMES are
    # realistic handles; the BOT badge is suppressed in TDM scoreboard).
    tdm_bot_names = random.sample(DISGUISED_BOT_NAMES, TDM_TEAM_SIZE * 2)
    for nm in tdm_bot_names:
        tdm_room.spawn_bot(nm, disguised=True, difficulty=1.45)
    # TDM practice room: same disguised pre-fill so practice mirrors the
    # quick-match feel exactly (a bored player solo-grinding bots still
    # sees 4v4 of "humans" in the scoreboard).
    practice_tdm_bot_names = random.sample(DISGUISED_BOT_NAMES, TDM_TEAM_SIZE * 2)
    for nm in practice_tdm_bot_names:
        practice_tdm_room.spawn_bot(nm, disguised=True, difficulty=1.2)

    # Initialize season metadata (rank reset every SEASON_LENGTH_DAYS)
    await get_or_init_season()
    await maybe_reset_season()

    asyncio.create_task(game_room.run())
    asyncio.create_task(tdm_room.run())
    asyncio.create_task(ranked_room.run())
    asyncio.create_task(practice_room.run())
    asyncio.create_task(practice_tdm_room.run())
    asyncio.create_task(bigffa_room.run())
    asyncio.create_task(matchmaker_loop())
    asyncio.create_task(season_loop())
    asyncio.create_task(seeded_climb_loop())
    asyncio.create_task(synthetic_online_loop())
    asyncio.create_task(_backfill_past_seasons_once())
    asyncio.create_task(_backfill_past_seasons_leaderboard_rank_once())
    asyncio.create_task(_ultimate_gooner_refresh_loop())


async def _ultimate_gooner_refresh_loop():
    """Refresh the top-50 GOONMASTER cache every 30s. Runs forever.
    Failures inside `refresh_ultimate_gooner_cache` are already logged
    + swallowed so we can't kill this loop by throwing."""
    while True:
        await asyncio.sleep(ULTIMATE_GOONER_REFRESH_INTERVAL_S)
        try:
            await refresh_ultimate_gooner_cache()
        except Exception as e:
            logger.warning("ultimate-gooner loop tick failed: %s", e)


async def _backfill_past_seasons_once():
    """One-shot backfill so existing accounts with a `peak_rank_points`
    from previous seasons get a `past_seasons[]` entry too. Without
    this, the "past-season peak-rank title" feature would only work
    for players who go through a NEW season rollover after this deploy
    — anyone who peaked at Diamond in Season 1 would see an empty
    picker forever.

    Rules:
      • Real accounts with `peak_rank_points > 0` and no past_seasons →
        stamp ONE synthetic entry for the previous season using their
        all-time peak.
      • Seeded leaderboard bots (`is_seeded: True`) → stamp a past-
        season entry based on their `seed_target_rp` so their public
        profile also flexes a title like "S1 · GRANDMASTER", and equip
        it via `title_season`. Seeded bots don't have `peak_rank_points`
        set (their RP lerps toward `seed_target_rp` over the season)
        so this branch is separate.

    Idempotent — the second run finds no matches. Doesn't touch users
    who already have a past-season array from the forward-going
    rollover code.
    """
    try:
        # Small delay so the season doc + climb loop init have settled.
        await asyncio.sleep(1.0)
        season_doc = await db.season.find_one({"_id": "current"})
        cur = int((season_doc or {}).get("season_number", 1))
        prev_season = max(1, cur - 1)
        # Cache for the synchronous seed-endpoint path so newly-inserted
        # bots also get past-season titles keyed to the right season.
        _CACHED_PREV_SEASON_NUMBER[0] = prev_season
        # -----------------------------------------------------------
        # Real-user backfill (peak-based)
        # -----------------------------------------------------------
        cursor = db.users.find(
            {
                "is_seeded": {"$ne": True},
                "peak_rank_points": {"$gt": 0},
                "$or": [
                    {"past_seasons": {"$exists": False}},
                    {"past_seasons": {"$size": 0}},
                ],
            },
            {"_id": 1, "peak_rank_points": 1, "peak_rank_name": 1},
        )
        touched = 0
        async for u in cursor:
            pts = int(u.get("peak_rank_points", 0) or 0)
            t_idx, t_name = rank_for_points(pts)
            entry = {
                "season": prev_season,
                "tier": int(t_idx),
                "tier_name": u.get("peak_rank_name") or t_name,
                "rp": pts,
            }
            await db.users.update_one(
                {"_id": u["_id"]},
                {"$set": {"past_seasons": [entry]}},
            )
            touched += 1
        if touched:
            logger.info("past_seasons backfill (real): stamped %d users with S%d entry", touched, prev_season)
        # -----------------------------------------------------------
        # Seeded-bot backfill (target-RP-based) — every seeded bot
        # gets a past-season entry at their target tier and equips it
        # so a Grandmaster bot's public profile reads "S1 · GRANDMASTER".
        # Some bots optionally get TWO entries (previous season + one
        # older) so the picker on their public profile shows history
        # too, adding to the illusion of veteran players.
        # -----------------------------------------------------------
        bot_cursor = db.users.find(
            {
                "is_seeded": True,
                "seed_target_rp": {"$exists": True, "$gt": 0},
                "$or": [
                    {"past_seasons": {"$exists": False}},
                    {"past_seasons": {"$size": 0}},
                ],
            },
            {"_id": 1, "seed_target_rp": 1, "rank_points": 1},
        )
        bot_touched = 0
        async for u in bot_cursor:
            target = int(u.get("seed_target_rp", 0) or 0)
            t_idx, t_name = rank_for_points(target)
            past = [{
                "season": prev_season,
                "tier": int(t_idx),
                "tier_name": t_name,
                "rp": target,
            }]
            # ~50% of bots also get an OLDER (season-1) entry at one
            # tier lower — a subtle "they've been climbing" story.
            if prev_season >= 2 and random.random() < 0.5:
                older_tier = max(0, t_idx - 1)
                older_low = RANK_TIERS[older_tier][0]
                older_high = (RANK_TIERS[older_tier + 1][0] - 1) if (older_tier + 1 < len(RANK_TIERS)) else (older_low + 400)
                older_rp = _snap_rp_to_match_grid(random.randint(older_low, older_high))
                _, older_name = rank_for_points(older_rp)
                past.insert(0, {
                    "season": max(1, prev_season - 1),
                    "tier": int(older_tier),
                    "tier_name": older_name,
                    "rp": older_rp,
                })
            await db.users.update_one(
                {"_id": u["_id"]},
                {"$set": {
                    "past_seasons": past,
                    # Auto-equip the most recent (highest-tier) entry so
                    # the bot's banner shows the title without a real
                    # player having to do the picker click.
                    "title_season": int(prev_season),
                }},
            )
            bot_touched += 1
        if bot_touched:
            logger.info("past_seasons backfill (bots): stamped %d seeded bots with S%d title", bot_touched, prev_season)
    except Exception as e:
        logger.warning("past_seasons backfill failed: %s", e)


async def _backfill_past_seasons_leaderboard_rank_once():
    """One-shot backfill so past_seasons entries that already exist
    on user documents get their `leaderboard_rank` populated from the
    season_archive top-100 snapshots.

    Why this exists: the rollover code was recently updated to stamp
    `leaderboard_rank` on new past_seasons entries (so the title
    picker can render "#7 GOONMASTER"), but every user who went
    through a rollover BEFORE that deploy has entries without the
    field. This scan reads each archived season's `top_100` array,
    builds `user_id → rank`, and pushes `leaderboard_rank` into
    matching past_seasons entries where it's missing.

    Idempotent — the second run finds no matches (all entries
    already carry the field). Users who finished outside top-50 in
    a given season are left untouched (the field stays absent, which
    the frontend reads as "not an Ultimate Gooner that season").
    """
    try:
        await asyncio.sleep(2.0)  # let the primary backfill run first
        touched = 0
        # Iterate every archived season → build rank map → push field.
        async for arc in db.season_archive.find({}, {"season_number": 1, "top_100": 1, "_id": 0}):
            season = int(arc.get("season_number", 0) or 0)
            top = arc.get("top_100") or []
            if not season or not top:
                continue
            # Only top-50 finishers become Ultimate Gooner call-outs.
            rank_by_uid: Dict[str, int] = {}
            for row in top:
                uid = str(row.get("user_id") or "")
                pos = int(row.get("rank", 0) or 0)
                if uid and 1 <= pos <= 50:
                    rank_by_uid[uid] = pos
            if not rank_by_uid:
                continue
            # For each qualifying user, patch their matching entry.
            for uid, pos in rank_by_uid.items():
                try:
                    _oid = ObjectId(uid)
                except Exception:
                    continue
                u = await db.users.find_one({"_id": _oid}, {"past_seasons": 1})
                if not u:
                    continue
                past = list(u.get("past_seasons") or [])
                dirty = False
                for entry in past:
                    if int(entry.get("season", -1)) == season and not entry.get("leaderboard_rank"):
                        entry["leaderboard_rank"] = int(pos)
                        dirty = True
                if dirty:
                    await db.users.update_one(
                        {"_id": _oid},
                        {"$set": {"past_seasons": past}},
                    )
                    touched += 1
        if touched:
            logger.info("past_seasons leaderboard_rank backfill: patched %d users", touched)
    except Exception as e:
        logger.warning("past_seasons leaderboard_rank backfill failed: %s", e)


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# -------------------------------------------------------------------
# Auth routes
# -------------------------------------------------------------------
@api.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    # Trim whitespace so " ada " and "ada" collide on the uniqueness check.
    new_name = (payload.username or "").strip()
    # Format guard — mirrors `/profile/me/username` so a name that would
    # be rejected on rename is also rejected at registration. Without
    # this, users could sign up with e.g. "!!hi!!" then be locked into
    # a name the rename endpoint won't let them change to anything.
    if not USERNAME_PATTERN.match(new_name):
        raise HTTPException(400, detail="Username must be 2-20 chars: letters, digits, _ . -")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    # Case-insensitive username uniqueness — same rule the rename
    # endpoint enforces. Blocks "Ada" from registering when "ada"
    # already exists so the kill feed, friends list, and leaderboard
    # can't have visually-identical rows.
    dup = await db.users.find_one({
        "username": {"$regex": f"^{re.escape(new_name)}$", "$options": "i"},
    })
    if dup:
        raise HTTPException(status_code=409, detail="That username is taken.")
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "username": new_name,
        "role": "user",
        "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0},
        "created_at": datetime.now(timezone.utc),
    }
    # Optional security-question setup at register time. Answer stored
    # as bcrypt(norm(answer)); never plaintext. If absent the user
    # can set it later via /profile/me/security-question.
    if payload.security_question and payload.security_answer:
        if payload.security_question not in SECURITY_QUESTIONS:
            raise HTTPException(400, detail="Invalid security question")
        doc["security_question"] = payload.security_question
        doc["security_answer_hash"] = hash_password(_norm_answer(payload.security_answer))
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
    # GOONMASTER (top tier) — the UI shows it on the lobby PlayerCard.
    # Computed lazily so we don't pay the count for every lower-tier
    # user. The same data is exposed via /api/me/leaderboard_rank for
    # ad-hoc refreshes.
    if payload.get("rank_tier") == len(RANK_TIERS) - 1:
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


# ─────────────────────────────────────────────────────────────────────
# Forgot-password (security-question flow) + username change
# ─────────────────────────────────────────────────────────────────────
# In-memory rate limiter for forgot-password/reset attempts, keyed by
# email. 5 attempts per hour then locked out. Small dict; server-wide
# concurrency is not the concern (auth requests are cheap and any
# real DDoS would hit the ingress first).
FORGOT_PW_ATTEMPTS: Dict[str, List[float]] = {}
FORGOT_PW_MAX_ATTEMPTS = 5
FORGOT_PW_WINDOW_S = 3600


def _consume_forgot_pw_attempt(email: str) -> bool:
    """Return True if this attempt is allowed, False if the address is
    currently rate-limited. Always records the timestamp."""
    now = time.time()
    lst = FORGOT_PW_ATTEMPTS.setdefault(email, [])
    # Prune old entries.
    FORGOT_PW_ATTEMPTS[email] = [t for t in lst if now - t < FORGOT_PW_WINDOW_S]
    if len(FORGOT_PW_ATTEMPTS[email]) >= FORGOT_PW_MAX_ATTEMPTS:
        return False
    FORGOT_PW_ATTEMPTS[email].append(now)
    return True


@api.get("/auth/security-questions")
async def security_questions():
    """List the available preset questions. Used by both the register
    form and the profile settings pane."""
    return {"questions": SECURITY_QUESTIONS}


@api.post("/auth/forgot-password/challenge")
async def forgot_password_challenge(payload: ForgotPasswordChallengeIn):
    """Step 1: user submits their email; server returns their security
    question so they can answer it. Returns a generic 'no question set'
    for users who never configured one (identical response shape whether
    the email exists or not — email-enumeration protection)."""
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    q = None
    if user:
        q = user.get("security_question")
    if not q:
        # Same shape regardless of existence so attackers can't tell.
        return {"question": None, "message": "No security question is set for that account."}
    return {"question": q}


@api.post("/auth/forgot-password/reset")
async def forgot_password_reset(payload: ForgotPasswordResetIn):
    """Step 2: user submits email + answer + new password. Rate-limited
    to 5 attempts per hour per email. Never leaks whether the email
    exists — always returns the same generic result on failure."""
    email = payload.email.lower()
    if not _consume_forgot_pw_attempt(email):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")
    user = await db.users.find_one({"email": email})
    generic_fail = HTTPException(status_code=400, detail="Invalid email or security answer.")
    if not user:
        raise generic_fail
    answer_hash = user.get("security_answer_hash")
    if not answer_hash:
        raise generic_fail
    if not verify_password(_norm_answer(payload.answer), answer_hash):
        raise generic_fail
    # Success — update password. Clear the rate-limit bucket so a
    # legitimate user isn't locked out immediately after resetting.
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    FORGOT_PW_ATTEMPTS.pop(email, None)
    return {"ok": True, "message": "Password reset successful. Please sign in with your new password."}


@api.post("/profile/me/security-question")
async def set_security_question(payload: SetSecurityQuestionIn, user: dict = Depends(get_current_user)):
    """Set or update the security question + answer while signed in.
    Required before forgot-password/reset will work for the account."""
    if payload.question not in SECURITY_QUESTIONS:
        raise HTTPException(400, detail="Invalid security question")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "security_question": payload.question,
            "security_answer_hash": hash_password(_norm_answer(payload.answer)),
        }},
    )
    return {"ok": True, "message": "Security question updated."}


# Username-change constants + validator. 7-day cooldown per user's
# spec; historical entries (kill feed, match archives, leaderboard
# snapshots) keep the old name (immutable audit trail).
USERNAME_CHANGE_COOLDOWN_S = 7 * 24 * 3600
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{2,20}$")


@api.post("/profile/me/username")
async def change_username(payload: UsernameChangeIn, user: dict = Depends(get_current_user)):
    """Change the signed-in user's username. Enforces:
      - format: 2-20 chars, [A-Za-z0-9_.-] only
      - uniqueness (case-insensitive) across all users
      - 7-day cooldown from the last change
    Historical kill-feed / archive entries keep the OLD name intact —
    only `user.username` and `user.username_changed_at` mutate."""
    new_name = (payload.username or "").strip()
    if not USERNAME_PATTERN.match(new_name):
        raise HTTPException(400, detail="Username must be 2-20 chars: letters, digits, _ . -")
    # Cooldown check.
    last_change = user.get("username_changed_at")
    if isinstance(last_change, datetime):
        # Coerce to UTC-aware (Mongo can hand back naive datetimes).
        if last_change.tzinfo is None:
            last_change = last_change.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - last_change).total_seconds()
        if elapsed < USERNAME_CHANGE_COOLDOWN_S:
            remaining = USERNAME_CHANGE_COOLDOWN_S - elapsed
            days_left = max(1, round(remaining / 86400))
            raise HTTPException(
                status_code=429,
                detail=f"You can only change your username once every 7 days. Try again in ~{days_left}d.",
            )
    # No-op if the new name matches the current (case-sensitive).
    if new_name == user.get("username"):
        return public_user(user)
    # Case-insensitive uniqueness check (excluding self).
    conflict = await db.users.find_one({
        "username": {"$regex": f"^{re.escape(new_name)}$", "$options": "i"},
        "_id": {"$ne": user["_id"]},
    })
    if conflict:
        raise HTTPException(409, detail="That username is taken.")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "username": new_name,
            "username_changed_at": datetime.now(timezone.utc),
            "previous_username": user.get("username"),
        }},
    )
    fresh = await db.users.find_one({"_id": user["_id"]})
    return public_user(fresh)


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
            in_match = loc is not None and loc.get("kind") in ("casual", "bigffa", "ranked", "party")
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
            "rank_division": rank_division_for_points(pts, idx),
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


# ---------------------------------------------------------------------
# XP Boost store — consumable items that grant 2x XP for a duration.
# Uses the same coin wallet as skins. Stacks by extending the timer.
# ---------------------------------------------------------------------
class BoostBuyIn(BaseModel):
    boost_id: str = Field(min_length=1, max_length=32)


@api.get("/shop/boosts")
async def shop_boosts(user: dict = Depends(get_current_user)):
    """Storefront payload for the XP Boost tab. Returns the catalog +
    the caller's coin balance + the current active-boost countdown so
    the client can render "ACTIVE · 42m LEFT" pills without a second
    round-trip."""
    await credit_level_coins(user)
    return {
        "coins": int(user.get("coins", 0) or 0),
        "boosts": BOOSTS_CATALOG,
        "active_seconds_remaining": xp_boost_remaining_seconds(user),
        "active_multiplier": xp_boost_active_multiplier(user),
    }


@api.post("/shop/boost/purchase")
async def shop_boost_purchase(payload: BoostBuyIn, user: dict = Depends(get_current_user)):
    """Deduct coins and (re)arm the XP-boost timer.

    Stacking rule: buying while a boost is already active EXTENDS the
    timer instead of resetting it — the new duration is added to the
    remaining time so the player never loses coins to a shorter
    overlap. Multiplier follows the newly-bought SKU (all current
    boosts are 2x so this is a no-op today, but keeps the schema
    forward-compatible with future 1.5x / 3x SKUs).
    """
    await credit_level_coins(user)
    boost = BOOSTS_BY_ID.get(payload.boost_id)
    if not boost:
        raise HTTPException(status_code=404, detail="Boost not found.")
    price = int(boost.get("price", 0))
    coins = int(user.get("coins", 0) or 0)
    if coins < price:
        raise HTTPException(status_code=402, detail=f"Not enough coins — needs {price}.")
    now = time.time()
    prev_until = float(user.get("xp_boost_until", 0) or 0)
    # Extend from whichever is later — a stale timer that already
    # elapsed shouldn't add to the new one.
    base = prev_until if prev_until > now else now
    new_until = base + float(boost["duration_sec"])
    new_coins = coins - price
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "coins": new_coins,
            "xp_boost_until": new_until,
            "xp_boost_multiplier": float(boost["multiplier"]),
        }},
    )
    user["coins"] = new_coins
    user["xp_boost_until"] = new_until
    user["xp_boost_multiplier"] = float(boost["multiplier"])
    logger.info(
        "Boost purchased user=%s sku=%s +%ds -> until=%.0f (%ds remaining)",
        user.get("_id"), boost["id"], int(boost["duration_sec"]),
        new_until, xp_boost_remaining_seconds(user),
    )
    return {
        "ok": True,
        "boost": boost,
        "user": public_user(user),
    }


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


# Allowed primary-weapon choices. The client sends one of these strings
# to /profile/me/weapon; the server stores it on the user doc and reads
# it back at WS connect to initialise `player.weapon`.
PRIMARY_WEAPON_CHOICES = {"ak47", "sniper"}


class WeaponChoiceIn(BaseModel):
    weapon: str


@api.post("/profile/me/weapon")
async def set_primary_weapon(payload: WeaponChoiceIn, user: dict = Depends(get_current_user)):
    """Persist the player's primary-weapon loadout choice ("ak47" or
    "sniper"). Read back at WS connect (`ws_game`) to seed
    `player.weapon`. Returns the updated public user payload so the
    lobby UI can refresh from the response."""
    choice = (payload.weapon or "").strip().lower()
    if choice not in PRIMARY_WEAPON_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid weapon. Must be one of: {sorted(PRIMARY_WEAPON_CHOICES)}",
        )
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"primary_weapon": choice}},
    )
    user["primary_weapon"] = choice
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


def _season_tiers(season_number: int = 1) -> List[dict]:
    """Returns the static 30-tier reward layout.

    2026-06-29 update: the pass is now **coins-only**. Tier 10/20/30 used
    to grant the meteor lineup skins (Stardust / Crater / Meteor); those
    have been retired from the pass and exist purely as cosmetic shop
    items moving forward. Existing owners keep them in `owned_skins`
    (skin grants are append-only). Milestone tiers (10/20/30) now grant
    big coin payouts so the climb still feels rewarding.

    Reward schedule:
      • Tier 10: 2000 coins (was Stardust Drifter)
      • Tier 20: 3500 coins (was Crater Forged)
      • Tier 30: 6000 coins (was Meteor Ascendant)
      • Other multiples of 5 (5, 15, 25): 500 coins
      • Every other tier: 100 coins
    """
    MILESTONE_PAYOUTS = {10: 2000, 20: 3500, 30: 6000}
    tiers: List[dict] = []
    for i in range(1, SEASON_MAX_TIER + 1):
        if i in MILESTONE_PAYOUTS:
            coins = MILESTONE_PAYOUTS[i]
            label = f"+{coins:,} Coins"
        elif i % 5 == 0:
            coins = 500
            label = "+500 Coins"
        else:
            coins = 100
            label = "+100 Coins"
        tiers.append({"tier": i, "reward_type": "coins", "reward_coins": coins, "reward_label": label})
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


async def _auto_claim_completed_dailies(user: dict, daily_state: dict) -> List[dict]:
    """Sweep today's dailies and claim any that are completed-but-not-
    yet-claimed. Credits the user's `coins` + `season_xp` in a single
    `$inc` and stamps the `daily_state.claimed` map.

    Returns a list of `{id, name, coins, season_xp}` for each freshly
    claimed challenge so callers (the `/progression` endpoint) can
    return them to the client for an inline toast like
    `"Massacre — +50 coins, +30 XP"`. When no challenge becomes newly
    claimed this returns `[]` and no DB write happens (the call is a
    cheap pure read).

    `daily_state` is mutated in-place so the calling code can keep
    using it after the sweep — the freshly-claimed map is reflected
    without re-fetching the doc.
    """
    if not daily_state:
        return []
    claimed_map = dict(daily_state.get("claimed") or {})
    snapshot = daily_state.get("snapshot")
    by_id = {c["id"]: c for c in DAILY_CHALLENGES_POOL}
    newly: List[dict] = []
    coins_inc = 0
    xp_inc = 0
    for cid in daily_state.get("challenges", []):
        if claimed_map.get(cid):
            continue
        ch = by_id.get(cid)
        if not ch:
            continue
        prog = _challenge_progress(user, ch, snapshot)
        if prog < ch["goal"]:
            continue
        # Mark claimed and accumulate the inc deltas. We batch all
        # newly-claimed dailies into a single Mongo update so a player
        # who logs in to N completed dailies pays for 1 write, not N.
        claimed_map[cid] = True
        coins = int(ch.get("coins", 0) or 0)
        xp = int(ch.get("season_xp", 0) or 0)
        coins_inc += coins
        xp_inc += xp
        newly.append({
            "id": cid,
            "name": ch.get("name", cid),
            "coins": coins,
            "season_xp": xp,
        })
    if not newly:
        return []
    new_state = dict(daily_state)
    new_state["claimed"] = claimed_map
    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {"daily_state": new_state},
            "$inc": {"coins": coins_inc, "season_xp": xp_inc},
        },
    )
    # Mirror the mutations onto the cached user / state dicts the caller
    # already holds so the rest of /progression sees the post-claim
    # numbers without a re-fetch.
    daily_state["claimed"] = claimed_map
    user["coins"] = int(user.get("coins", 0) or 0) + coins_inc
    user["season_xp"] = int(user.get("season_xp", 0) or 0) + xp_inc
    return newly


@api.get("/progression")
async def progression(user: dict = Depends(get_current_user)):
    """Bundle endpoint — returns lifetime challenge progress, today's
    daily challenges, and the 30-tier season pass state in one round-trip.
    The frontend ProgressionModal pulls everything from here.

    Side effect: auto-claims any completed-but-unclaimed daily
    challenges before computing the response (see
    `_auto_claim_completed_dailies`). This way the player never has to
    tap a Claim button — finishing a match credits the coin/XP rewards
    on the next progression refresh."""
    await credit_level_coins(user)
    # Roll the season forward if the timer elapsed — this is what makes
    # the new pass go live exactly when the countdown hits zero (no
    # manual swap, no deploy required).
    season_doc = await maybe_reset_season()
    season_number = int(season_doc.get("season_number", 1))
    daily_state = await _ensure_daily_state(user)
    # Auto-claim sweep happens AFTER daily_state is hydrated so the
    # helper can mutate the same dict and so the rest of this function
    # reads the freshly-credited state.
    auto_claimed = await _auto_claim_completed_dailies(user, daily_state)
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
    tiers = _season_tiers(season_number)
    claimed_tiers = set(int(t) for t in (user.get("claimed_season_tiers") or []))
    for t in tiers:
        t["unlocked"] = t["tier"] <= season_tier
        t["claimed"]  = t["tier"] in claimed_tiers
    return {
        "lifetime": lifetime_out,
        "daily": {
            "date": daily_state.get("date"),
            "challenges": daily_out,
            # Surfaces freshly auto-claimed dailies from THIS request so
            # the lobby UI can toast "+50 coins · +30 XP — Massacre!"
            # immediately. Empty list when nothing was newly claimed.
            "auto_claimed": auto_claimed,
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
        layout = _season_tiers(int((await maybe_reset_season()).get("season_number", 1)))
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
    # 22 avatar slots total (idx 0-21). Idx 6-11 are the original animated
    # specials with level/tier gates; 12-21 are the 2026-06-29 expansion
    # (5 static + 5 animated) which are ungated (available to everyone).
    # Bumping this cap without expanding the gate map on the backend
    # would still work — the gate check only fires for indices present
    # in `gates`.
    avatar: int = Field(ge=0, le=21)


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


class TitleIn(BaseModel):
    """Past-season title selector. `season` is either the number of the
    past season the player wants displayed on their banner, or `None`
    to clear the title entirely. `ultimate=True` equips the special
    "ULTIMATE GOONER" title (only valid when the caller is currently
    in the top-50 GOONMASTER leaderboard cache) — it is mutually
    exclusive with `season`."""
    season: Optional[int] = Field(default=None)
    ultimate: Optional[bool] = Field(default=None)


@api.post("/profile/me/title")
async def set_title(payload: TitleIn, user: dict = Depends(get_current_user)):
    """Equip / clear the past-season peak-rank title shown alongside the
    banner. Only seasons the player actually finished (present in their
    `past_seasons` array) can be equipped — protects against a client
    stamping "SEASON 99 · GOONMASTER" on themselves. The special
    ULTIMATE GOONER title is gated on live top-50 membership."""
    # ── ULTIMATE GOONER path ──────────────────────────────────────
    # `ultimate=True` → equip the Ultimate title (must be in top-50).
    # `ultimate=False` explicitly clears just the flag, useful when
    # the client wants to remove the Ultimate title but preserve the
    # season pick. Any `season` value is ignored in that clear case.
    if payload.ultimate is True:
        uid_str = str(user["_id"])
        if uid_str not in TOP50_GOONER_IDS:
            raise HTTPException(status_code=403, detail="You must be a top-50 Goonmaster to equip this title.")
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"title_ultimate": True, "title_season": None}},
        )
        user["title_ultimate"] = True
        user["title_season"] = None
        return public_user(user)
    if payload.ultimate is False:
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"title_ultimate": False}},
        )
        user["title_ultimate"] = False
        return public_user(user)

    # ── Season path (unchanged, plus title_ultimate reset) ─────────
    if payload.season is None:
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"title_season": None, "title_ultimate": False}},
        )
        user["title_season"] = None
        user["title_ultimate"] = False
        return public_user(user)
    past = list(user.get("past_seasons") or [])
    found = next((e for e in past if int(e.get("season", -1)) == int(payload.season)), None)
    if not found:
        raise HTTPException(status_code=404, detail="You didn't finish that season — nothing to display.")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"title_season": int(payload.season), "title_ultimate": False}},
    )
    user["title_season"] = int(payload.season)
    user["title_ultimate"] = False
    return public_user(user)


@api.post("/profile/me/avatar")
async def set_avatar(payload: AvatarIn, user: dict = Depends(get_current_user)):
    # Animated avatars (idx 6..11) are gated by level OR peak rank. The
    # newer 12..21 additions are ungated on both sides — same visual
    # tier system, but they cost nothing to try. Only apply the gate
    # when the picked index actually has an entry in the map.
    gates = {
        6:  {"level": 5,  "tier": 0},  # Flaming Skull
        7:  {"level": 15, "tier": 5},  # Pulsing Diamond — Diamond+ gate
        8:  {"level": 25, "tier": 6},  # Swirling Lightning — Master+ gate
        9:  {"level": 10, "tier": 0},  # Frost Sigil
        10: {"level": 20, "tier": 5},  # Quantum Core — Diamond+ gate
        11: {"level": 30, "tier": 8},  # All-Seeing Eye — Goonmaster gate
    }
    if payload.avatar in gates:
        stats = user.get("stats", {})
        lvl = compute_level(stats)["level"]
        peak_pts = int(user.get("peak_rank_points", user.get("rank_points", 0)) or 0)
        peak_tier, _ = rank_for_points(peak_pts)
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
        row = {
            "mode": m.get("mode", "casual"),
            "game_mode": m.get("game_mode", "ffa"),
            "kills": int(m.get("kills", 0)),
            "deaths": int(m.get("deaths", 0)),
            "placement": int(m.get("placement", 0)),
            "total_players": int(m.get("total_players", 0)),
            "rp_delta": int(m.get("rp_delta", 0)),
            "rank_points_after": int(m.get("rank_points_after", 0)),
            "rank_name_after": m.get("rank_name_after", "BRONZE"),
            "is_placement": bool(m.get("is_placement", False)),
            "ended_at": ts.isoformat() if isinstance(ts, datetime) else ts,
            # Full match roster + composite match id for the click-to-open
            # scoreboard modal. Empty list on legacy rows that pre-date the
            # roster snapshot (the UI hides the click affordance in that case).
            "match_id": m.get("match_id"),
            "players": list(m.get("players") or []),
            # Per-player kill replays + arena size for the top-down
            # inline expandable killcam in the match history UI.
            "kill_events": list(m.get("kill_events") or []),
            "arena_size": int(m.get("arena_size") or 40),
            "arena_map_id": m.get("arena_map_id"),
        }
        # TDM rows carry the team scoreline + outcome so the UI can
        # render "WIN 12 — 10" instead of an FFA placement card.
        if m.get("game_mode") == "tdm":
            row["team"] = m.get("team")
            row["team_score"] = int(m.get("team_score", 0))
            row["enemy_team_score"] = int(m.get("enemy_team_score", 0))
            row["team_outcome"] = m.get("team_outcome", "draw")
        rows.append(row)
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
    # Look up in the hardcoded catalog first, then fall back to the
    # admin-created dynamic codes collection. Dynamic codes are tracked
    # so the admin dashboard can show redemption counts.
    reward = REDEEM_CODES.get(code)
    is_dynamic = False
    dyn_doc: Optional[dict] = None
    if not reward:
        dyn_doc = await db.redeem_codes.find_one({"code": code})
        if dyn_doc:
            # Enforce expiry + redemption cap. Both checks intentionally
            # collapse into the same generic 404 so the surface UX stays
            # "Invalid or expired code." for any failure mode.
            now = datetime.now(timezone.utc)
            exp = dyn_doc.get("expires_at")
            # Mongo returns naive datetimes; coerce to UTC so the compare
            # against `now` (tz-aware) doesn't TypeError.
            if isinstance(exp, datetime) and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if isinstance(exp, datetime) and exp <= now:
                raise HTTPException(status_code=404, detail="Invalid or expired code.")
            max_red = dyn_doc.get("max_redemptions")
            if max_red is not None and int(dyn_doc.get("redeemed_count", 0) or 0) >= int(max_red):
                raise HTTPException(status_code=404, detail="Invalid or expired code.")
            reward = dyn_doc.get("reward") or {}
            # Ensure a human-readable label survives the round trip.
            if not reward.get("label") and dyn_doc.get("label"):
                reward = {**reward, "label": dyn_doc.get("label")}
            is_dynamic = True
    if not reward:
        raise HTTPException(status_code=404, detail="Invalid or expired code.")
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
    if reward.get("rank_up_tiers"):
        cur_pts = int(user.get("rank_points", 0) or 0)
        cur_tier_idx, _ = rank_for_points(cur_pts)
        steps = max(1, int(reward["rank_up_tiers"]))
        # Cap target at Grandmaster (last-1). Goonmaster is earned-only
        # so a code redemption can't teleport a player straight to the
        # top tier.
        target_tier_idx = min(len(RANK_TIERS) - 2, cur_tier_idx + steps)
        if target_tier_idx > cur_tier_idx:
            # Land the player at the *start* of the new tier's band so they
            # have to fight to climb further within it.
            target_pts = RANK_TIERS[target_tier_idx][0]
            # Stack on top of any RP grant already in this update — a code
            # that grants both `rp` and `rank_up_tiers` should still hit
            # the tier floor.
            already_granted = int(update_ops.get("$inc", {}).get("rank_points", 0) or 0)
            rp_grant = max(0, target_pts - cur_pts - already_granted)
            if rp_grant > 0:
                inc = update_ops.setdefault("$inc", {})
                inc["rank_points"] = int(inc.get("rank_points", 0)) + rp_grant

    # Unified rank-up detection — fires the celebration for ANY code
    # whose net RP change crosses a tier OR division boundary, not just
    # the `rank_up_tiers` reward type. A raw `rp` code that pushes
    # Bronze I → Silver III now correctly triggers the big tier
    # celebration; a smaller RP grant that bumps Silver III → Silver II
    # triggers the lighter division "PROMOTED" variant.
    rank_up_payload: Optional[dict] = None
    inc_rp = int(update_ops.get("$inc", {}).get("rank_points", 0) or 0)
    if inc_rp > 0:
        cur_pts = int(user.get("rank_points", 0) or 0)
        target_pts = min(7500, cur_pts + inc_rp)
        cur_tier_idx, cur_tier_name = rank_for_points(cur_pts)
        target_tier_idx, target_tier_name = rank_for_points(target_pts)
        cur_div = rank_division_for_points(cur_pts, cur_tier_idx)
        target_div = rank_division_for_points(target_pts, target_tier_idx)
        tier_crossed = target_tier_idx > cur_tier_idx
        # Division numbering is inverted — lower number = higher division
        # (III=3 is entry, I=1 is the top). A promotion means the new
        # division is a SMALLER number than the previous one.
        division_crossed = (not tier_crossed) and (target_div > 0 and cur_div > 0 and target_div < cur_div)
        if tier_crossed or division_crossed:
            rank_up_payload = {
                "prev_tier": {"idx": cur_tier_idx, "name": cur_tier_name, "division": cur_div},
                "new_tier":  {"idx": target_tier_idx, "name": target_tier_name, "division": target_div},
                "rp_delta":  int(target_pts - cur_pts),
                "new_points": int(target_pts),
                # Explicit kind so the client uses the beefier "tier"
                # celebration for boundary crossings and the lighter
                # "division" one for a same-tier bump.
                "kind": "tier" if tier_crossed else "division",
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
    # Track redemption count on dynamic admin-created codes so the admin
    # dashboard can show how popular each code is.
    if is_dynamic:
        try:
            await db.redeem_codes.update_one(
                {"code": code},
                {"$inc": {"redeemed_count": 1}, "$set": {"last_redeemed_at": datetime.now(timezone.utc)}},
            )
        except Exception:
            pass
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

MAP_E = {
    "map_id": "tundra",
    "name": "TUNDRA",
    "size": 50,
    "obstacles": [
        # ---- Frozen central pond & ice-shard ring -----------------------------
        # A wide frozen pond (very short cover) at dead centre — visually
        # distinct rink you can slide across; hitboxes are tiny so it plays
        # mostly as open ground with a subtle line-of-sight ridge.
        {"x":  0,   "z":  0,   "w": 8,   "h": 0.3, "d": 8},
        # Six angled ice shards jutting up around the pond rim — tall thin
        # walls to peek around from any approach angle.
        {"x":  7.5, "z":  4.5, "w": 1.4, "h": 3.2, "d": 3.4},
        {"x": -7.5, "z":  4.5, "w": 1.4, "h": 3.2, "d": 3.4},
        {"x":  7.5, "z": -4.5, "w": 1.4, "h": 3.2, "d": 3.4},
        {"x": -7.5, "z": -4.5, "w": 1.4, "h": 3.2, "d": 3.4},
        {"x":  0,   "z":  8.5, "w": 3.4, "h": 3.2, "d": 1.4},
        {"x":  0,   "z": -8.5, "w": 3.4, "h": 3.2, "d": 1.4},
        # ---- Snowdrift mid-cover (scattered) ---------------------------------
        # Long low banks — belly-cover you can vault over but not stand in.
        {"x":  15,  "z":  0,   "w": 2.2, "h": 1.2, "d": 6},
        {"x": -15,  "z":  0,   "w": 2.2, "h": 1.2, "d": 6},
        {"x":  0,   "z":  15,  "w": 6,   "h": 1.2, "d": 2.2},
        {"x":  0,   "z": -15,  "w": 6,   "h": 1.2, "d": 2.2},
        # Rounded diagonal snow humps at intermediate distances.
        {"x":  11,  "z":  11,  "w": 3.0, "h": 1.4, "d": 3.0},
        {"x": -11,  "z":  11,  "w": 3.0, "h": 1.4, "d": 3.0},
        {"x":  11,  "z": -11,  "w": 3.0, "h": 1.4, "d": 3.0},
        {"x": -11,  "z": -11,  "w": 3.0, "h": 1.4, "d": 3.0},
        # ---- Frozen pine stumps (short pillars) -------------------------------
        {"x":  6,   "z":  20,  "w": 1.2, "h": 2.0, "d": 1.2},
        {"x": -6,   "z":  20,  "w": 1.2, "h": 2.0, "d": 1.2},
        {"x":  6,   "z": -20,  "w": 1.2, "h": 2.0, "d": 1.2},
        {"x": -6,   "z": -20,  "w": 1.2, "h": 2.0, "d": 1.2},
        {"x":  20,  "z":  6,   "w": 1.2, "h": 2.0, "d": 1.2},
        {"x":  20,  "z": -6,   "w": 1.2, "h": 2.0, "d": 1.2},
        {"x": -20,  "z":  6,   "w": 1.2, "h": 2.0, "d": 1.2},
        {"x": -20,  "z": -6,   "w": 1.2, "h": 2.0, "d": 1.2},
        # ---- Wrecked research outposts at corners -----------------------------
        # Long tall walls with cover slits — like collapsed field stations
        # from a shuttered arctic expedition.
        {"x":  26,  "z":  26,  "w": 7,   "h": 4,   "d": 1.8},
        {"x": -26,  "z":  26,  "w": 7,   "h": 4,   "d": 1.8},
        {"x":  26,  "z": -26,  "w": 7,   "h": 4,   "d": 1.8},
        {"x": -26,  "z": -26,  "w": 7,   "h": 4,   "d": 1.8},
        {"x":  22,  "z":  22,  "w": 1.8, "h": 4,   "d": 3.2},
        {"x": -22,  "z":  22,  "w": 1.8, "h": 4,   "d": 3.2},
        {"x":  22,  "z": -22,  "w": 1.8, "h": 4,   "d": 3.2},
        {"x": -22,  "z": -22,  "w": 1.8, "h": 4,   "d": 3.2},
    ] + _PERIMETER_BUILDINGS,
    "spawn_points": [
        (28, 28), (-28, 28), (28, -28), (-28, -28),
        (32, 0), (-32, 0), (0, 32), (0, -32),
        (18, 14), (-18, 14), (18, -14), (-18, -14),
    ],
    "healthpacks": [
        (0.0, 0.0),                     # centre of the frozen pond
        (18.0, 0.0), (-18.0, 0.0),
        (0.0, 18.0), (0.0, -18.0),
        (24.0, 24.0), (-24.0, 24.0),
        (24.0, -24.0), (-24.0, -24.0),
    ],
}

MAPS = [MAP_A, MAP_B, MAP_C, MAP_D, MAP_E]

# Map F — "HOTEL" — indoor two-story lobby. All cover is at floor
# level; the second story is represented by a floating MEZZANINE RING
# + supporting columns + a ceiling plane, all lifted by `y_base` so
# they don't block ground movement. Server collision (`collides_obstacle`)
# and `_spawn_point_safe` skip any obstacle with `y_base > 0` so the
# floating geometry is purely visual — players walk under the mezzanine
# and see the "second story" overhead, giving the two-story vibe the
# game engine can't otherwise support (server is 2D).
# Visual palette (client-side): warm marble creams, rich burgundy, brass
# gold, deep walnut. Set in engine.js `_currentMapId === "hotel"`.
MAP_F = {
    "map_id": "hotel",
    "name": "ROYAL GUARD",
    "size": 50,
    "obstacles": [
        # ---- INDOOR PERIMETER WALLS ----
        # Solid continuous walls at ±48 form the hotel's exterior wall
        # (from the players' interior POV). Fully seals the arena so
        # there is no "outside" visible — the map reads as a proper
        # indoor lobby rather than an outdoor city block.
        {"x": 0,   "z": -48, "w": 96, "h": 8, "d": 2},
        {"x": 0,   "z":  48, "w": 96, "h": 8, "d": 2},
        {"x": 48,  "z":  0,  "w": 2,  "h": 8, "d": 96},
        {"x": -48, "z":  0,  "w": 2,  "h": 8, "d": 96},

        # ---- STRUCTURAL SUPPORT COLUMNS ----
        # Load-bearing columns that visually replace the exterior
        # perimeter buildings the other maps use. Corner + mid-wall
        # supports, spaced along the perimeter, tall (h=8) so they
        # reach the ceiling and read as structural.
        {"x":  40, "z":  40, "w": 2, "h": 8, "d": 2},
        {"x": -40, "z":  40, "w": 2, "h": 8, "d": 2},
        {"x":  40, "z": -40, "w": 2, "h": 8, "d": 2},
        {"x": -40, "z": -40, "w": 2, "h": 8, "d": 2},
        {"x":  40, "z":  14, "w": 2, "h": 8, "d": 2},
        {"x":  40, "z": -14, "w": 2, "h": 8, "d": 2},
        {"x": -40, "z":  14, "w": 2, "h": 8, "d": 2},
        {"x": -40, "z": -14, "w": 2, "h": 8, "d": 2},
        {"x":  14, "z":  40, "w": 2, "h": 8, "d": 2},
        {"x": -14, "z":  40, "w": 2, "h": 8, "d": 2},
        {"x":  14, "z": -40, "w": 2, "h": 8, "d": 2},
        {"x": -14, "z": -40, "w": 2, "h": 8, "d": 2},

        # ---- GROUND FLOOR COVER ----
        # Reception desk — long L-shape at the north end.
        {"x": 0,   "z": -18, "w": 22, "h": 1.2, "d": 2.0},
        {"x": 11,  "z": -14, "w": 2.0, "h": 1.2, "d": 6.0},
        # Bell-desk / concierge stand — small counter, south end.
        {"x": -18, "z": 18, "w": 6.0, "h": 1.1, "d": 2.0},
        # Central marble columns — 4 square columns supporting the
        # mezzanine above. Solid ground-floor cover that visually
        # anchors the mezzanine ring.
        {"x":  12, "z":  12, "w": 2.5, "h": 8, "d": 2.5},
        {"x": -12, "z":  12, "w": 2.5, "h": 8, "d": 2.5},
        {"x":  12, "z": -12, "w": 2.5, "h": 8, "d": 2.5},
        {"x": -12, "z": -12, "w": 2.5, "h": 8, "d": 2.5},
        # NOTE: The center of the lobby (0, 0) is now WIDE OPEN — no
        # fountain. Players can push through the middle for aggressive
        # plays. The four marble columns still frame the central
        # atrium so long sightlines are broken by cover.

        # Elevator bank — two tall thin rectangles on the east wall.
        {"x": 30, "z": -6, "w": 2.0, "h": 6, "d": 4.0},
        {"x": 30, "z":  6, "w": 2.0, "h": 6, "d": 4.0},
        # Staircase to mezzanine — two flights, visual only.
        {"x": -30, "z":  8, "w": 2.0, "h": 3, "d": 6.0},
        {"x": -30, "z": -8, "w": 2.0, "h": 4, "d": 6.0},
        # Lounge seating cluster — small platforms grouped in twos.
        {"x":  6, "z":  22, "w": 3.0, "h": 1.0, "d": 2.0},
        {"x": -6, "z":  22, "w": 3.0, "h": 1.0, "d": 2.0},
        {"x":  6, "z": -24, "w": 3.0, "h": 1.0, "d": 2.0},
        {"x": -6, "z": -24, "w": 3.0, "h": 1.0, "d": 2.0},
        # Corridor walls partitioning the west wing into "rooms".
        {"x": -22, "z":  0,  "w": 2.0, "h": 4, "d": 10.0},
        {"x": -22, "z": -22, "w": 2.0, "h": 4, "d": 6.0},
        {"x": -34, "z":  0,  "w": 2.0, "h": 4, "d": 10.0},
        # Grand piano — small square in the south lounge.
        {"x":  0, "z":  30, "w": 3.5, "h": 1.4, "d": 2.0},
        # Luggage carts / crates.
        {"x":   8, "z":   4, "w": 1.6, "h": 1.4, "d": 1.6},
        {"x":  -8, "z":  -4, "w": 1.6, "h": 1.4, "d": 1.6},
        {"x":  16, "z":  -3, "w": 1.6, "h": 1.4, "d": 1.6},
        {"x": -16, "z":   3, "w": 1.6, "h": 1.4, "d": 1.6},

        # ---- LOBBY TABLES ----
        # Waist-high café/lounge tables scattered around the lobby.
        # Short (h=0.9) so they only provide crouch-height cover — the
        # eye-level sightlines stay open, keeping the arena feeling
        # spacious. Placed away from spawn points and columns so they
        # don't accidentally block key routes.
        {"x":  20, "z":  25, "w": 1.4, "h": 0.9, "d": 1.4},
        {"x": -20, "z":  25, "w": 1.4, "h": 0.9, "d": 1.4},
        {"x":  20, "z": -25, "w": 1.4, "h": 0.9, "d": 1.4},
        {"x": -20, "z": -25, "w": 1.4, "h": 0.9, "d": 1.4},
        {"x":  32, "z":  32, "w": 1.4, "h": 0.9, "d": 1.4},
        {"x": -32, "z":  32, "w": 1.4, "h": 0.9, "d": 1.4},
        {"x":  32, "z": -32, "w": 1.4, "h": 0.9, "d": 1.4},
        {"x": -32, "z": -32, "w": 1.4, "h": 0.9, "d": 1.4},

        # ---- SECOND STORY (floating, `y_base` = 8 = above the columns) ----
        # Mezzanine ring — 4 walkway segments floating overhead.
        {"x":  20, "z": 0,   "w": 3, "h": 0.8, "d": 26, "y_base": 8},
        {"x": -20, "z": 0,   "w": 3, "h": 0.8, "d": 26, "y_base": 8},
        {"x":   0, "z":  20, "w": 26, "h": 0.8, "d": 3, "y_base": 8},
        {"x":   0, "z": -20, "w": 26, "h": 0.8, "d": 3, "y_base": 8},
        # Mezzanine railing — short vertical walls sitting ON the ring.
        # NOTE: `y_base` is 8.85 (not 8.8) — the walkway ring above has
        # its TOP face at exactly y=8.8, so anchoring the railings at
        # 8.8 puts their bottom face coplanar with the walkway top and
        # z-fights every time the camera moves. 0.05m lift is invisible
        # in-game but breaks the coplanar tie. Fixes the "random boxes
        # appearing + walls flickering" report on ROYAL GUARD.
        {"x":  18.5, "z":  0,  "w": 0.4, "h": 1.6, "d": 26, "y_base": 8.85},
        {"x": -18.5, "z":  0,  "w": 0.4, "h": 1.6, "d": 26, "y_base": 8.85},
        {"x":  0, "z":  18.5, "w": 26, "h": 1.6, "d": 0.4, "y_base": 8.85},
        {"x":  0, "z": -18.5, "w": 26, "h": 1.6, "d": 0.4, "y_base": 8.85},
        # Ceiling coffer — extended to cover the FULL 100x100 arena
        # (matches the floor size) so no matter where a player looks up
        # they see ceiling, not sky. Non-collidable (y_base > 0).
        {"x": 0, "z": 0, "w": 100, "h": 0.6, "d": 100, "y_base": 14},
        # Second-story doorway lintels — three "hotel room door" facades
        # along the west + east mezzanine walls.
        # `y_base` 8.85 (not 8.8) — matches the railing lift above so the
        # lintel bottom face isn't coplanar with the mezzanine walkway top
        # (both used to sit at exactly y=8.8, producing z-fight flicker
        # any time the camera crossed that plane).
        {"x": -17, "z":  10, "w": 2, "h": 3, "d": 0.4, "y_base": 8.85},
        {"x": -17, "z":   0, "w": 2, "h": 3, "d": 0.4, "y_base": 8.85},
        {"x": -17, "z": -10, "w": 2, "h": 3, "d": 0.4, "y_base": 8.85},
        {"x":  17, "z":  10, "w": 2, "h": 3, "d": 0.4, "y_base": 8.85},
        {"x":  17, "z":   0, "w": 2, "h": 3, "d": 0.4, "y_base": 8.85},
        {"x":  17, "z": -10, "w": 2, "h": 3, "d": 0.4, "y_base": 8.85},
    ],
    "spawn_points": [
        (35, 35), (-35, 35), (35, -35), (-35, -35),
        (0, 38), (0, -38), (38, 0), (-38, 0),
        (26, 20), (-26, 20), (26, -20), (-26, -20),
    ],
    "healthpacks": [
        (0.0, 8.0), (0.0, -8.0),
        (14.0, 0.0), (-14.0, 0.0),
        (20.0, 20.0), (-20.0, -20.0),
        (20.0, -20.0), (-20.0, 20.0),
    ],
}

MAPS = [MAP_A, MAP_B, MAP_C, MAP_D, MAP_E, MAP_F]

# Map G — "SILENT TOWN" — foggy, stormy swamp + woods. Dense outer ring of
# tall dead trees to break long sightlines, three raised islands with
# stone-ruin cover in the middle of murky bog "water", scattered fallen
# logs for chest-height cover, and small mossy boulders as crouch cover.
# Server-side we only store the collision rectangles; the client's swamp
# theme paints trees, hanging moss, water, mist, and a stormy overcast
# sky on top. Playable feel: close-quarters with lots of hip-height cover
# and a couple of long "corridors" between the water pools.
MAP_G = {
    "map_id": "swamp",
    "name": "SILENT TOWN",
    "size": 50,
    "obstacles": [
        # ---- Central raised stone platform (ruined altar/dock) ---------------
        # Wide low stone base + 4 broken column stubs marking a defensible
        # island in the middle of the bog. Fights over the centre pull two
        # teams toward each other because the platform's a natural chokepoint.
        {"x": 0,   "z": 0,   "w": 8,   "h": 0.8, "d": 8},        # stone slab
        {"x":  3.2, "z":  3.2, "w": 1.4, "h": 2.6, "d": 1.4},    # NE column stub
        {"x": -3.2, "z":  3.2, "w": 1.4, "h": 2.6, "d": 1.4},    # NW column stub
        {"x":  3.2, "z": -3.2, "w": 1.4, "h": 2.6, "d": 1.4},    # SE column stub
        {"x": -3.2, "z": -3.2, "w": 1.4, "h": 2.6, "d": 1.4},    # SW column stub

        # ---- Two flanking bog islands with cover -----------------------------
        # East + west "dry" islands players can push through — small stone
        # walls give hard cover and force peekers to commit.
        {"x":  20, "z":  0,   "w": 5,   "h": 3.2, "d": 1.2},     # E ruin wall
        {"x":  20, "z":  3.5, "w": 1.2, "h": 2.2, "d": 2.4},     # E buttress
        {"x": -20, "z":  0,   "w": 5,   "h": 3.2, "d": 1.2},     # W ruin wall
        {"x": -20, "z": -3.5, "w": 1.2, "h": 2.2, "d": 2.4},     # W buttress

        # ---- Fallen dead trees (long low logs) -------------------------------
        # Vault-height so you can crouch behind them but shoot over standing.
        # Angled placements suggest storm damage — trees fell radially.
        {"x":  10, "z":  14,  "w": 6,   "h": 1.0, "d": 1.1},
        {"x": -12, "z":  14,  "w": 5.5, "h": 1.0, "d": 1.1},
        {"x":  12, "z": -16,  "w": 5,   "h": 1.0, "d": 1.1},
        {"x": -10, "z": -14,  "w": 6,   "h": 1.0, "d": 1.1},
        # A pair of logs stacked "X" at the north/south approaches.
        {"x":  0,  "z":  16,  "w": 1.1, "h": 1.0, "d": 6.5},
        {"x":  0,  "z": -16,  "w": 1.1, "h": 1.0, "d": 6.5},

        # ---- Standing dead trees (thin tall pillars) -------------------------
        # Cluster around the middle-ring: full-height cover to peek around.
        # Deliberately staggered so no single line sees more than two.
        {"x":  8,  "z":  8,   "w": 1.0, "h": 5.5, "d": 1.0},
        {"x": -8,  "z":  8,   "w": 1.0, "h": 5.5, "d": 1.0},
        {"x":  8,  "z": -8,   "w": 1.0, "h": 5.5, "d": 1.0},
        {"x": -8,  "z": -8,   "w": 1.0, "h": 5.5, "d": 1.0},
        {"x":  14, "z":  6,   "w": 1.0, "h": 5.0, "d": 1.0},
        {"x": -14, "z":  6,   "w": 1.0, "h": 5.0, "d": 1.0},
        {"x":  14, "z": -6,   "w": 1.0, "h": 5.0, "d": 1.0},
        {"x": -14, "z": -6,   "w": 1.0, "h": 5.0, "d": 1.0},
        {"x":  6,  "z":  20,  "w": 1.0, "h": 5.5, "d": 1.0},
        {"x": -6,  "z":  20,  "w": 1.0, "h": 5.5, "d": 1.0},
        {"x":  6,  "z": -20,  "w": 1.0, "h": 5.5, "d": 1.0},
        {"x": -6,  "z": -20,  "w": 1.0, "h": 5.5, "d": 1.0},

        # ---- Mossy boulders (crouch-height rocks) ----------------------------
        {"x":  18, "z":  18,  "w": 2.2, "h": 1.4, "d": 2.2},
        {"x": -18, "z":  18,  "w": 2.2, "h": 1.4, "d": 2.2},
        {"x":  18, "z": -18,  "w": 2.2, "h": 1.4, "d": 2.2},
        {"x": -18, "z": -18,  "w": 2.2, "h": 1.4, "d": 2.2},
        {"x":  26, "z":  10,  "w": 1.8, "h": 1.2, "d": 1.8},
        {"x": -26, "z":  10,  "w": 1.8, "h": 1.2, "d": 1.8},
        {"x":  26, "z": -10,  "w": 1.8, "h": 1.2, "d": 1.8},
        {"x": -26, "z": -10,  "w": 1.8, "h": 1.2, "d": 1.8},

        # ---- Corner ruin clusters --------------------------------------------
        # Broken watchtower foundations in each corner — long stone walls +
        # a column stub. Give snipers a corner nest but not a full closed room.
        {"x":  30, "z":  30,  "w": 6,   "h": 3.6, "d": 1.4},
        {"x":  33, "z":  27,  "w": 1.4, "h": 3.6, "d": 4.0},
        {"x": -30, "z":  30,  "w": 6,   "h": 3.6, "d": 1.4},
        {"x": -33, "z":  27,  "w": 1.4, "h": 3.6, "d": 4.0},
        {"x":  30, "z": -30,  "w": 6,   "h": 3.6, "d": 1.4},
        {"x":  33, "z": -27,  "w": 1.4, "h": 3.6, "d": 4.0},
        {"x": -30, "z": -30,  "w": 6,   "h": 3.6, "d": 1.4},
        {"x": -33, "z": -27,  "w": 1.4, "h": 3.6, "d": 4.0},
    ] + _PERIMETER_BUILDINGS,
    "spawn_points": [
        (28, 28), (-28, 28), (28, -28), (-28, -28),
        (32, 0), (-32, 0), (0, 32), (0, -32),
        (18, 12), (-18, 12), (18, -12), (-18, -12),
    ],
    "healthpacks": [
        (0.0, 0.0),                    # centre ruin — contested
        (20.0, 0.0), (-20.0, 0.0),     # flanking bog islands
        (0.0, 20.0), (0.0, -20.0),
        (24.0, 24.0), (-24.0, 24.0),
        (24.0, -24.0), (-24.0, -24.0),
    ],
}

MAPS = [MAP_A, MAP_B, MAP_C, MAP_D, MAP_E, MAP_F, MAP_G]

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
LASER_DAMAGE = 5           # nerfed from 8 — laser was outpacing AK at close range
BOT_SHOT_DAMAGE = 16
MELEE_DAMAGE = 200
MELEE_RANGE = 3.4
MELEE_CONE = 0.95
SHOT_RANGE = 100
# AK is full-auto (hold to fire). Fire rate: 320ms per shot (~187 RPM) —
# slower than the original 250ms tap-fire so held-down fire feels
# controllable, but faster than the initial 400ms slowdown so the burst
# feels responsive. Bot cooldown scales up in the same ratio so bots
# don't out-DPS players on the player cadence.
SHOT_COOLDOWN_MS = 320
LASER_COOLDOWN_MS = 90
MELEE_COOLDOWN_MS = 600
BOT_SHOT_COOLDOWN_MS = 620
BOT_AIM_NOISE = 0.10
TICK_RATE = 20
NUM_BOTS = 3
# FFA quick-match / ranked / practice rooms cap the active lobby at this
# many combat players (incl. bots). Caller adds/removes bots as humans
# join/leave so the player never walks into a 5- or 6-bot lobby.
FFA_LOBBY_SIZE = 4
RANKED_MIN_REAL_PLAYERS = 1
# TDM mode constants
TDM_KILL_TARGET = 30        # first team to N kills wins instantly
TDM_TEAM_SIZE = 4           # each team's max size (4v4)
TDM_QUICK_MATCH_ROLL = 0.50  # 50% of quick-match rooms become TDM
QUEUE_BOT_FILL_SEC = 45.0
QUEUE_BOT_FILL_SEC_HIGH = 120.0  # Master tier (5) and above wait longer
QUEUE_BOT_FILL_SEC_GOONMASTER = 210.0  # (legacy — no longer used, kept for backwards compat)
# High-tier randomization window (Master / Grandmaster / Goonmaster):
# random 30 seconds → 3 minutes so climbing the ladder feels slower
# but never gets stuck for double-digit minutes. Re-rolled per join.
QUEUE_BOT_FILL_HIGH_MIN = 30.0
QUEUE_BOT_FILL_HIGH_MAX = 180.0
QUEUE_BOT_FILL_GOONMASTER_MIN = 30.0
QUEUE_BOT_FILL_GOONMASTER_MAX = 180.0
# Bronze → Diamond (tiers 0-4) — everything up through mid-ladder gets
# the 20-45s window so ranked feels snappy end-to-end. Re-rolled per join.
QUEUE_BOT_FILL_LOW_MIN = 20.0
QUEUE_BOT_FILL_LOW_MAX = 45.0
QUEUE_LOW_TIER_MAX = 5  # tiers 0..5 = BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND
QUEUE_HIGH_TIER_MIN = 5  # tier index 5 = MASTER

# -------------------------------------------------------------------
# Overwatch-style weapon configs (hitscan + falloff + spread + reload)
# -------------------------------------------------------------------
# Casual FFA "smurf" bot ratio + difficulty — the fraction of fill
# bots in casual quick-match that get a Diamond+ disguise, and how
# sharp their AI feels. Both held in the state dict so
# `/api/admin/settings/smurf` can mutate them at runtime without a
# redeploy. Defaults: 0.15 ratio (~1 in 7 bots), diff 1.7 (clears the
# 1.5 "smart" threshold so the smurf feels sharper without matching
# full ranked 1.9).
_CASUAL_ELITE_BOT_STATE = {"ratio": 0.15, "diff": 1.7}


def _get_casual_elite_bot_ratio() -> float:
    """Live-tunable smurf ratio. Read through this helper (not the
    module constant) inside the spawn loop so runtime edits from
    `/api/admin/settings/smurf` take effect immediately on the next
    fill. Kept for backwards-compat as `CASUAL_ELITE_BOT_RATIO` below."""
    return float(_CASUAL_ELITE_BOT_STATE.get("ratio", 0.15))


def _get_casual_elite_bot_diff() -> float:
    """Live-tunable smurf difficulty. Same design as the ratio helper —
    the spawn loop reads through this so slider changes are visible
    on the next fill."""
    return float(_CASUAL_ELITE_BOT_STATE.get("diff", 1.7))


# Module attributes — read at TEST time via `srv.CASUAL_ELITE_BOT_RATIO`
# / `srv.CASUAL_ELITE_BOT_DIFF` so existing pytest assertions still
# see the current values. Kept in sync inside the setter endpoint.
CASUAL_ELITE_BOT_RATIO = _get_casual_elite_bot_ratio()
CASUAL_ELITE_BOT_DIFF = _get_casual_elite_bot_diff()

WEAPON_CONFIGS = {
    "ak47":  {
        "damage": SHOT_DAMAGE,
        # Small fire-rate buff per user request: 320ms → 285ms
        # (~12% faster cadence, ~3.5 shots/s → ~3.9 shots/s). Kept as
        # a local override rather than moving SHOT_COOLDOWN_MS so the
        # sniper/laser cooldowns don't drift with future AK tweaks.
        "cooldown_ms": 285,
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
        # AK "fat bullets" — inflates every player hitbox sphere by
        # this many metres when the AK is the active weapon. Bumped
        # 0.45 → 0.55 per user request for a second buff pass —
        # noticeable near-miss forgiveness without turning the ray
        # into an aim-bot. Sniper/laser stay pinpoint (default 0.0).
        "projectile_thickness": 0.55,
    },
    "sniper": {
        # Bolt-action-style precision rifle. Two-shot mag with a
        # heavy body-shot damage (50) that needs 2 hits to down a
        # 100-HP target, but a full 2.0x headshot mult that keeps
        # 1-tap headshots on the table (50 × 2 = 100 = lethal). Hip
        # fire is now allowed — the previous ads_only lockout was
        # frustrating in close-range engagements.
        "damage": 50,              # per-shot body damage (was 200 — 1-shot anywhere)
        "cooldown_ms": 250,        # brief post-shot lockout (matches AK's old cd)
        "mag_size": 2,             # up from 1: two shots before mandatory reload
        "reload_ms": 1500,         # per-user tune: sniper reload feels snappier at 1.5s
        "headshot_mult": 2.0,      # 50 × 2 = 100 → 1-shot headshot kills, exactly
        "legs_mult": 0.85,         # leg hits do ~42.5 dmg → still 2-shot lethal on 100HP
        "falloff_start": 200.0,    # effectively no falloff — range weapon
        "falloff_end": 300.0,
        "min_damage_mult": 1.0,
        "spread_base": 0.0,
        "spread_per_shot": 0.0,
        "spread_max": 0.0,
        "spread_decay": 1.0,
        "ads_spread_mult": 1.0,
        "ads_only": False,         # per-user request: sniper can now hip-fire
    },
    "laser": {
        "damage": LASER_DAMAGE,
        "dps": 55,                 # nerfed from 90 — laser was too dominant on hold-fire
        "cooldown_ms": LASER_COOLDOWN_MS,
        "mag_size": 60,
        "reload_ms": 1800,
        "headshot_mult": 1.35,     # nerfed from 1.75 — still rewards aim, less brutal
        "legs_mult": 0.9,
        "falloff_start": 15.0,     # nerfed from 30m — laser is now a close-range weapon
        "falloff_end": 40.0,       # nerfed from 85m — hard drop-off past mid-range
        "min_damage_mult": 0.30,   # nerfed from 0.65 — far-range shots barely tickle
        "spread_base": 0.0,
        "spread_per_shot": 0.0,
        "spread_max": 0.0,
        "spread_decay": 1.0,
        "ads_spread_mult": 1.0,
        # Heat behaviour (seconds). Ramp = how long continuous fire takes
        # to reach overheat (1.0); cool = how long forced cooldown takes
        # to return to 0.0 from full overheat. Buffed for longer sustain
        # and faster recovery.
        "heat_ramp_seconds": 4.0,  # was 3.0 — more sustained fire
        "heat_cool_seconds": 3.0,  # was 4.0 — faster recovery
    },
}


def weapon_cfg(name: str) -> dict:
    return WEAPON_CONFIGS.get(name, WEAPON_CONFIGS["ak47"])


def bot_fill_seconds_for_tier(tier_idx: int) -> float:
    # High tiers (Master / Grandmaster / Goonmaster, 5-7): random 30-180s
    # per join — the ladder gets slower to climb but never stalls out for
    # >3 minutes. Re-rolled every /queue/ranked POST.
    if tier_idx >= QUEUE_HIGH_TIER_MIN:
        return random.uniform(QUEUE_BOT_FILL_HIGH_MIN, QUEUE_BOT_FILL_HIGH_MAX)
    # Bronze → Diamond (0-4): random 20-45s so ranked feels snappy at the
    # low-to-mid ladder without becoming instant-pop.
    return random.uniform(QUEUE_BOT_FILL_LOW_MIN, QUEUE_BOT_FILL_LOW_MAX)


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
    # Goonmaster — the pinnacle tier. Expanded pool so a Goonmaster-heavy
    # leaderboard doesn't rely on the same 3 names + numeric suffixes. Mix
    # of ominous / legend / pro-scene handles.
    7: ["GOONFATHER", "TheLastGoon", "GoonLord_404", "GoonEmpress",
        "GoonSaintNyx", "OverlordVii", "TheGoonEternal", "GoonKing_Ω",
        "GoonMonarch", "GoonWraithZ9", "TheGoonSovereign", "GoonPhantasm",
        "GoonReaperUltra", "GoonHydra_Prime", "GoonCipher_R1",
        "Goon_Aeternum", "Goonlyth", "GoonAlpha_Ω9", "GoonPrimarch",
        "GoonAvatar_X"],
}
PLACEMENT_MATCHES = 5
# Ranked early-leave penalty — quitting an in-progress ranked match
# stamps `ranked_ban_until = now + N minutes` on the user, and the
# /queue/ranked POST handler 403s until it elapses (with the remaining
# seconds in `detail` so the client can render a countdown).
RANKED_LEAVE_BAN_MINUTES = 10
# Ranked early-leave RP loss (in addition to the 10-min queue ban).
# Treated as a first-place loss for the deserter.
RANKED_LEAVE_RP_LOSS = 30
PLACEMENT_MULTIPLIER = 2


def _spawn_point_safe(arena: dict, x: float, z: float) -> bool:
    """Return True if (x, z) is a valid spawn location within `arena` —
    inside the play field and not overlapping any obstacle. Uses the
    same PLAYER_RADIUS margin as GameRoom.collides_obstacle so a spawn
    that passes here won't immediately get depenetrated by the movement
    tick."""
    s = arena.get("size")
    if s is None:
        return True
    if x < -s + PLAYER_RADIUS or x > s - PLAYER_RADIUS:
        return False
    if z < -s + PLAYER_RADIUS or z > s - PLAYER_RADIUS:
        return False
    for ob in arena.get("obstacles", []):
        # Skip floating obstacles (`y_base > 0`) — they're mezzanine
        # geometry, not ground-level cover, so spawning "in" one is fine.
        if ob.get("y_base", 0) > 0:
            continue
        hx = ob["w"] / 2 + PLAYER_RADIUS
        hz = ob["d"] / 2 + PLAYER_RADIUS
        if abs(x - ob["x"]) < hx and abs(z - ob["z"]) < hz:
            return False
    return True


def _find_nearest_safe_point(arena: dict, x: float, z: float, max_radius: float = 6.0):
    """Spiral outward from (x, z) looking for a nearby (nx, nz) that's
    not inside an obstacle. Used as a rescue path when a hardcoded
    spawn point ends up inside a re-positioned obstacle. Returns the
    original point if nothing safe is found within `max_radius` (caller
    can fall back to global search)."""
    if _spawn_point_safe(arena, x, z):
        return (x, z)
    # 8 rays × 6 rings = 48 candidates, plenty to escape any obstacle.
    step = 1.0
    for r in [1.0, 1.75, 2.5, 3.5, 4.5, max_radius]:
        for i in range(8):
            ang = (i / 8.0) * math.tau
            nx = x + math.cos(ang) * r
            nz = z + math.sin(ang) * r
            if _spawn_point_safe(arena, nx, nz):
                return (nx, nz)
        step *= 1.4
    return (x, z)


def random_spawn(arena: Optional[dict] = None, *, occupants: Optional[List["Player"]] = None, min_dist: float = 14.0):
    """Return a random (x, z) spawn point for the given arena (or the
    legacy global ARENA when not supplied).

    Spawn selection is filtered to only points that don't overlap any
    obstacle (see `_spawn_point_safe`) so players never spawn inside a
    crate/wall. When `occupants` is provided we further score every
    remaining spawn by its distance to the nearest live opponent and
    pick a point that's at least `min_dist` metres away. If no point
    meets the distance threshold we fall back to the *farthest*
    available safe point — never the closest — so respawning into a
    face-full of bullets stops happening.

    If a map's hardcoded spawn points ALL overlap obstacles (edge case
    for a broken map file), we nudge each one to the nearest clear
    spot so gameplay isn't blocked."""
    a = arena or ARENA
    raw_points = a.get("spawn_points") or ARENA["spawn_points"]
    # Filter to spawn points that are actually safe. If a map is broken
    # (all points inside obstacles), rescue them with a nearest-safe
    # search so we always have candidates to pick from.
    points = []
    for (sx, sz) in raw_points:
        if _spawn_point_safe(a, sx, sz):
            points.append((sx, sz))
        else:
            rescued = _find_nearest_safe_point(a, sx, sz)
            # Only include the rescue if it actually cleared the obstacle
            # (otherwise we'd re-introduce the "spawn inside a wall" bug).
            if _spawn_point_safe(a, rescued[0], rescued[1]):
                points.append(rescued)
    if not points:
        # Last-ditch fallback: pick a random raw point rather than crash.
        # Shouldn't happen with any shipped map (all have >=8 clear spawns).
        points = list(raw_points)
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
        # Jump state — set by the client-initiated `{"type": "jump"}`
        # WS message. `_jump_start_ms` is the wall-clock t=0 of the
        # current arc (0 when grounded). Height is computed on-demand
        # in `to_state()` so other players see the arc, and remote
        # clients smoothly interpolate the Y with the animator.
        self._jump_start_ms: int = 0
        # Weapon state (Overwatch-style)
        self.weapon = "ak47"
        self.ammo: Dict[str, int] = {
            "ak47": WEAPON_CONFIGS["ak47"]["mag_size"],
            "sniper": WEAPON_CONFIGS["sniper"]["mag_size"],
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
        # TDM team — "red", "blue", or None for FFA. Set by GameRoom on join
        # when the room is in TDM mode; ignored by FFA logic everywhere else.
        self.team: Optional[str] = None
        # Lag-compensation position history. Each tick appends a snapshot
        # (timestamp, x, y, z, alive) so `raycast_hit` can rewind every
        # target's position to the moment the shot was fired on the
        # client. Capacity 16 = ~800ms at 20Hz — comfortably covers the
        # 0..300ms RTT window we accept from clients.
        self.pos_history: deque = deque(maxlen=16)
        # Last client-reported RTT (ms). Updated whenever the client sends
        # a `ping_ms` value on a shoot message. Clamped 0..300ms to keep
        # bad actors from rewinding the world half a second.
        self.last_ping_ms: int = 0
        # Pre-match readiness flag. Bots are always loaded (no client to
        # wait for); real players flip this to True when their client
        # finishes the loading screen and sends `{type: "loaded"}`. The
        # room's pre-match freeze stays active until every real player
        # has reported in (or a 30s safety fallback elapses).
        self.is_loaded: bool = bool(is_bot)

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
        # Apply jump arc for HUMAN players (bots update y directly in
        # `_tick_bots`). Same 650ms sin arc + 1.2m peak the ranked bots
        # use — keeps the visual language consistent across all
        # jumpers. If the arc has expired, snap back to ground so the
        # next jump starts from PLAYER_HEIGHT.
        if not self.is_bot and self._jump_start_ms > 0:
            now_ms = int(time.time() * 1000)
            elapsed = now_ms - self._jump_start_ms
            if elapsed < 650:
                self.y = PLAYER_HEIGHT + math.sin((elapsed / 650.0) * math.pi) * 1.2
            else:
                self.y = PLAYER_HEIGHT
                self._jump_start_ms = 0
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
            "rank_division": rank_division_for_points(
                int(getattr(self, "rank_points", 0) or 0) if not disguised else int(getattr(self, "disguise_rank_points", 0) or 0),
                int(getattr(self, "rank_tier", 0) or 0),
            ),
            "level": int(getattr(self, "level", 1) or 1),
            "banner_icon": int(getattr(self, "banner_icon", 0) or 0),
            "banner_color": int(getattr(self, "banner_color", 0) or 0),
            "banner_animated": bool(getattr(self, "banner_animated", False)),
            "skin": getattr(self, "selected_skin", "default") or "default",
            # TDM only — frontend ignores when null.
            "team": self.team,
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
    def __init__(self, is_ranked: bool = False, match_duration: float = 300.0, game_mode: str = "ffa"):
        self.players: Dict[str, Player] = {}
        self.events: List[dict] = []
        # Kill log — every kill during the match with shooter/victim
        # positions + yaw + weapon, keyed to the match timeline for
        # the "click a match, replay each kill" feature. Reset in
        # `start_match`. Capped at 400 entries per match so an
        # extreme session can't balloon memory (well above the ~120
        # kill limit of a 5-minute TDM).
        self.kill_log: List[dict] = []
        self.lock = asyncio.Lock()
        self._last_tick = time.time()
        self.is_ranked = is_ranked
        self.match_duration = match_duration
        self.match_start = time.time()
        self.in_intermission = False
        self.last_match_end_payload: Optional[dict] = None
        # Game mode — "ffa" (free-for-all, default) or "tdm" (team
        # deathmatch 4v4). TDM enables team assignment + friendly-fire
        # blocking + team scoreboard. Ranked rooms stay FFA only.
        self.game_mode: str = game_mode if game_mode in ("ffa", "tdm") else "ffa"
        # Per-team kill totals — populated only in TDM. First team to
        # `TDM_KILL_TARGET` ends the match instantly; ties broken by
        # match-time-up score.
        self.team_scores: Dict[str, int] = {"red": 0, "blue": 0}
        # One-shot latch so the early-end compression in `_on_team_kill`
        # only fires once per match. Reset at every `end_match`.
        self._tdm_early_end_armed: bool = False
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
        # Pre-match freeze / countdown state. When a room is created (or
        # reset between matches) `match_started` is False and every real
        # player is movement/shoot-locked until the countdown elapses.
        # `countdown_until` is the absolute timestamp the countdown ends
        # at; before all real players report `is_loaded=True` it stays
        # None (no visible counter yet). `_countdown_grace_start` is a
        # 30s safety fallback so a client that never sends `loaded` can't
        # softlock the room.
        self.match_started: bool = False
        self.countdown_until: Optional[float] = None
        self.countdown_seconds: float = 3.0
        self._countdown_grace_start: float = time.time()
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
        # When False, `_maintain_population` skips auto-filling with bots
        # entirely — used exclusively by private "Custom Lobby" party
        # rooms where the leader picked BOTS OFF. Every other room type
        # (casual, ranked, TDM, practice, offline) keeps the default
        # True so match-flow bot-fill behaviour is unchanged.
        self.bots_enabled: bool = True

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
        # Difficulty scales aim accuracy and fire rate at runtime (see _tick_bots).
        bot.difficulty = max(0.5, float(difficulty))
        # HP: Ranked bots + all TDM bots share the player's HP pool
        # (100) — no difficulty scaling. High-tier bots stay threatening
        # via aim/movement/positioning, not by being HP-inflated damage
        # sponges. Casual FFA / offline bots keep the difficulty-scaled
        # HP for practice-friendliness, BUT the total is capped at
        # MAX_HP (100) so smurf/elite bots (diff ≥ 1.25) never exceed
        # a real player's HP pool.
        if self.is_ranked or self.game_mode == "tdm":
            bot.max_hp = MAX_HP
        else:
            bot.max_hp = min(MAX_HP, int(BOT_MAX_HP * bot.difficulty))
        bot.hp = bot.max_hp
        # Human-like jump state (used only for smart ranked bots — see
        # `_tick_bots`). `_jump_start_ms` is the t=0 of the current jump
        # arc; `_jump_next_ms` is the wall-clock time of the next eligible
        # jump (drawn from a randomized cadence so jumps don't fire on a
        # robotic interval). `_juke_next_ms` controls movement direction
        # flips for the same human-feel reason.
        bot._jump_start_ms = 0
        bot._jump_next_ms = 0
        bot._juke_phase = 0.0
        bot._juke_next_ms = 0
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
            # Snap to the ranked match grid (multiples of 15) — matches how
            # the leaderboard seeds render, and guarantees the displayed RP
            # is a value reachable through real +30/+15/0/-30/-60 match
            # deltas. Without this a disguised bot could show RP like
            # 1743, which no real player could ever land on.
            pts = _snap_rp_to_match_grid(pts)
            # For tier-aligned disguises (ranked bots) the snap may have
            # dipped below the tier's floor (e.g. Silver low=110 → snap
            # to 105). Nudge back onto the nearest grid inside the band.
            if disguise_tier_idx is not None:
                ti = max(0, min(len(RANK_TIERS) - 1, int(disguise_tier_idx)))
                _low = RANK_TIERS[ti][0]
                _high = (RANK_TIERS[ti + 1][0] - 1) if (ti + 1 < len(RANK_TIERS)) else (_low + 400)
                if pts < _low:
                    pts = _snap_rp_to_match_grid(_low + 14)  # first grid ≥ low
                elif pts > _high:
                    pts = _snap_rp_to_match_grid(_high)
            t_idx, t_name = rank_for_points(pts)
            bot.disguise_rank_points = pts
            bot.disguise_rank_name = t_name
            bot.rank_tier = t_idx
        # Reposition the bot to a spawn from THIS room's arena — avoid
        # placing it right on top of an existing player/bot.
        bx, bz = random_spawn(self.arena, occupants=list(self.players.values()))
        bot.x = float(bx)
        bot.z = float(bz)
        # TDM team for bots — assigned the same way as real players so
        # the room balances naturally as bots are filled in.
        self._assign_team(bot)
        self.players[bot.id] = bot
        logger.info("Bot spawned: %s (%s) diff=%.2f%s%s", name, bot.id, bot.difficulty,
                    " [disguised]" if disguised else "",
                    f" tier={disguise_tier_idx}" if (disguised and disguise_tier_idx is not None) else "")
        return bot

    def _assign_team(self, player: Player) -> None:
        """In TDM, balance new joins onto the smaller team. Falls back to
        random when both teams are equal. No-op in FFA — `player.team`
        stays None and downstream logic treats every player as an enemy."""
        if self.game_mode != "tdm":
            player.team = None
            return
        # Count current live (non-spectator) members per team.
        red  = sum(1 for p in self.players.values() if p.team == "red"  and not getattr(p, "is_spectator", False))
        blue = sum(1 for p in self.players.values() if p.team == "blue" and not getattr(p, "is_spectator", False))
        if red < blue:
            player.team = "red"
        elif blue < red:
            player.team = "blue"
        else:
            player.team = random.choice(("red", "blue"))

    def _rebalance_teams(self) -> None:
        """At the start of each TDM match, reassign teams from scratch
        so an uneven join history doesn't lock the next round into 4v2.
        Splits players alternately by current position so the layout
        feels fresh without massive shuffling."""
        if self.game_mode != "tdm":
            return
        order = list(self.players.values())
        random.shuffle(order)
        for i, p in enumerate(order):
            p.team = "red" if i % 2 == 0 else "blue"

    def _maintain_population(self) -> None:
        """Keep the room at its target lobby size by swapping bots in/out
        as real players come and go.

          - TDM rooms target TDM_TEAM_SIZE * 2 = 8 combat players (4v4).
          - FFA rooms (casual, ranked, practice) target FFA_LOBBY_SIZE
            = 4 so the player isn't drowned in bots.

        Spectators are ignored. Practice-room "dummy" bots are kept last
        so the user always has the docile target to shoot at. Caller
        must hold `self.lock` to keep the head-count consistent with
        concurrent add/remove operations."""
        if self.game_mode == "tdm":
            target_total = TDM_TEAM_SIZE * 2
        else:
            # `bots_target_size` lets specific FFA rooms (e.g. the dedicated
            # 12-player Big FFA room) opt out of the default 4-player lobby
            # target while still using the same fill/despawn logic.
            target_total = int(getattr(self, "bots_target_size", None) or FFA_LOBBY_SIZE)
        combat = [p for p in self.players.values() if not getattr(p, "is_spectator", False)]
        n = len(combat)
        if n > target_total:
            # Despawn the surplus. Sort key picks bots LAST among combat
            # entries (real players stay), and within bots:
            #   - In TDM: prefer the team that's now oversized.
            #   - In FFA: prefer non-dummy combat bots over dummies so the
            #     practice room's training targets always survive.
            excess = n - target_total
            bots = [p for p in combat if p.is_bot]
            if self.game_mode == "tdm":
                red_count  = sum(1 for p in combat if p.team == "red")
                blue_count = sum(1 for p in combat if p.team == "blue")
                bots.sort(key=lambda b: -(red_count if b.team == "red" else blue_count))
            else:
                # Dummies last (highest score → despawned last).
                bots.sort(key=lambda b: 0 if getattr(b, "is_dummy", False) else -1)
            for bot in bots[:excess]:
                self.players.pop(bot.id, None)
                logger.info(
                    "Auto-balance (%s): despawned bot %s team=%s total=%d→%d",
                    self.game_mode, bot.username, getattr(bot, "team", None),
                    n, n - 1,
                )
                n -= 1
        elif n < target_total:
            # Only repopulate combat-style rooms — practice + offline FFA
            # rooms have fixed bot fills (dummies / per-user roster) that
            # we don't want to top off automatically. TDM uses the
            # disguised pool; FFA quick-match uses the same.
            if self.game_mode != "tdm" and getattr(self, "is_practice", False):
                return
            # Private "Custom Lobby" party rooms that opted OUT of bots
            # (leader clicked BOTS OFF in the PartyPanel) must stay
            # human-only for 1v1 / 2v2 duels. Skip the fill entirely.
            if not self.bots_enabled:
                return
            deficit = target_total - n
            in_use = {p.username for p in self.players.values()}
            pool = [nm for nm in DISGUISED_BOT_NAMES if nm not in in_use]
            random.shuffle(pool)
            # Difficulty inherited from the room's seed bots.
            if self.game_mode == "tdm":
                diff = 1.2 if getattr(self, "is_practice", False) else 1.45
            elif self.is_ranked:
                diff = 1.9
            else:
                # Casual FFA — nerfed 1.15 → 0.9 per user request:
                # players below Platinum should meet forgiving bots so
                # the on-boarding curve feels good. `spawn_bot` clamps
                # to a min of 0.5 so we still get some target practice.
                diff = 0.9
            for i in range(deficit):
                name = pool[i] if i < len(pool) else f"shadow_{random.randint(100, 999)}"
                # "Smurf" spawn: in casual FFA, ~15% of fill bots are
                # disguised as DIAMOND II (tier=5, points inside the
                # Diamond band) with elite AI (diff=1.7). This gives
                # casual players an occasional "high-rank stranger"
                # opponent — matches the user's request for higher-
                # ranked bots to appear in casual sometimes. Ranked
                # and TDM rooms opt out (they already have tier-
                # calibrated disguises).
                is_smurf = (
                    self.game_mode == "ffa"
                    and not self.is_ranked
                    and random.random() < _get_casual_elite_bot_ratio()
                )
                if is_smurf:
                    # Anchor RP inside Diamond II (1600 mid-band).
                    self.spawn_bot(
                        name,
                        disguised=True,
                        difficulty=_get_casual_elite_bot_diff(),
                        disguise_tier_idx=5,
                        disguise_rank_points=random.randint(1550, 1690),
                    )
                    logger.info(
                        "Auto-balance (%s): spawned SMURF bot %s (Diamond+ disguise, diff=%.2f) total=%d→%d",
                        self.game_mode, name, _get_casual_elite_bot_diff(), n, n + 1,
                    )
                else:
                    self.spawn_bot(name, disguised=True, difficulty=diff)
                    logger.info(
                        "Auto-balance (%s): spawned bot %s total=%d→%d",
                        self.game_mode, name, n, n + 1,
                    )
                n += 1

    # Backwards-compatible alias. Older tests reference the TDM-only name.
    def _maintain_tdm_population(self) -> None:
        if self.game_mode != "tdm":
            return
        self._maintain_population()

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
            # First real player joining an idle room (practice / offline
            # / quick-match between rounds) — reset every player's
            # per-match counters so they don't see bots with 50 kills
            # accumulated from previous sessions. Practice rooms have a
            # 99999s match length and never call `end_match`, so this is
            # their ONLY reset path.
            if not player.is_bot and not had_real_players:
                for p in self.players.values():
                    p.kills = 0
                    p.deaths = 0
                self.team_scores = {"red": 0, "blue": 0}
                self._tdm_early_end_armed = False
            # Assign a team (TDM only). Done while holding the lock so a
            # burst of simultaneous joins can't race the head-count.
            self._assign_team(player)
            self.players[player.id] = player
            # 1-for-1 bot swap: a real-player join displaces one bot so
            # the room stays at its target lobby size (TDM=8, FFA=4).
            # Skipped for offline rooms (per-user roster) and bot joins.
            if (
                not player.is_bot
                and not getattr(player, "is_spectator", False)
                and not getattr(self, "is_offline", False)
            ):
                self._maintain_population()
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
            elif getattr(self, "is_bigffa", False):
                kind = "bigffa"
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
            # Server-confirmed game mode ("ffa" / "tdm"). Quick-match can
            # roll either one, so the client only knows for sure after
            # welcome — the loading screen uses this to swap its subtitle
            # from "DEPLOYING..." to the actual FFA/TDM label.
            "game_mode": self.game_mode,
            "is_practice": bool(getattr(self, "is_practice", False)),
            "match_duration": self.match_duration if self.is_ranked else None,
            "match_start": self.match_start if self.is_ranked else None,
            "spectator": bool(getattr(player, "is_spectator", False)),
            "spectate_target_id": getattr(player, "spectate_target_id", None),
            # Pre-match freeze state — clients render a "3-2-1" overlay
            # while `match_started` is false. `countdown_until` is the
            # absolute server timestamp the countdown ends at (clients
            # convert to local seconds-remaining each frame). On a
            # late join (mid-match) `match_started` is true and there's
            # no countdown to render.
            "match_started": bool(self.match_started),
            "countdown_until": self.countdown_until,
            "countdown_seconds": self.countdown_seconds,
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
            # 1-for-1 swap: when a real player leaves, spawn a replacement
            # bot so the room stays at its target lobby size (TDM=8,
            # FFA=4) for whoever's left. Offline rooms keep their fixed
            # per-user roster.
            if (
                not player.is_bot
                and not getattr(player, "is_spectator", False)
                and not getattr(self, "is_offline", False)
            ):
                self._maintain_population()
        if not player.is_bot and not getattr(player, "is_spectator", False) and player.user_id:
            PLAYER_LOCATION.pop(player.user_id, None)
            # Ranked early-leave penalty. If a real player disconnects
            # from a ranked match BEFORE the match has ended, stamp a
            # 10-minute ranked-queue ban on their user doc so they
            # can't requeue immediately. We only apply the penalty
            # while the match is actively in-progress (`match_started`
            # true and `in_intermission` false) — bailing during the
            # pre-match countdown or after the WIN/LOSS overlay
            # already showed is fair game.
            if (
                self.is_ranked
                and self.match_started
                and not getattr(self, "in_intermission", False)
            ):
                await self._apply_ranked_leave_penalty(player.user_id)
        if not getattr(player, "is_spectator", False):
            await self.broadcast({"type": "leave", "id": player.id})

    async def _apply_ranked_leave_penalty(self, user_id: str):
        """Lock the user out of ranked queue for 10 minutes AND deduct
        30 RP on top — leaving a live ranked match is treated as a
        full first-place loss for the deserter. The queue endpoint
        reads `ranked_ban_until` and 403s until it elapses, with the
        remaining seconds in the error detail. Idempotent — a second
        leave just refreshes the timer (but the -30 RP only applies
        ONCE per disconnect, not on every retry).

        We $inc rank_points by -30 (not $set) so a leave from a player
        already at 0 RP doesn't go negative — the $max stage clamps
        the result to 0 in a second pass since Mongo doesn't combine
        $inc and $max on the same path in one update."""
        try:
            ban_until = datetime.now(timezone.utc) + timedelta(minutes=RANKED_LEAVE_BAN_MINUTES)
            await db.users.update_one(
                {"_id": ObjectId(user_id)},
                {
                    "$set": {"ranked_ban_until": ban_until, "ranked_ban_reason": "left_match"},
                    "$inc": {"rank_points": -RANKED_LEAVE_RP_LOSS},
                },
            )
            # Floor at 0 in a follow-up write — keeps the docs clean
            # without conditional aggregation pipelines on every leave.
            await db.users.update_one(
                {"_id": ObjectId(user_id), "rank_points": {"$lt": 0}},
                {"$set": {"rank_points": 0}},
            )
        except Exception as e:
            logger.warning("ranked leave penalty write failed for %s: %s", user_id, e)

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
            # Floating obstacles (mezzanine ceiling on HOTEL) don't
            # block ground movement — players walk under them.
            if ob.get("y_base", 0) > 0:
                continue
            hx, hz = ob["w"] / 2 + PLAYER_RADIUS, ob["d"] / 2 + PLAYER_RADIUS
            if abs(x - ob["x"]) < hx and abs(z - ob["z"]) < hz:
                return True
        return False

    def _has_los(self, shooter: Player, target: Player) -> bool:
        """3D line-of-sight check. Steps along the shooter→target line
        and rejects if any obstacle's XZ footprint overlaps the sample
        AND the ray's Y at that step falls inside the obstacle's Y
        slab (`y_base` .. `y_base + h`). Short cover like tables and
        the mezzanine walkway ring no longer block sightlines when the
        players' eye-level ray passes safely above them.
        """
        ox, oy, oz = shooter.x, shooter.y, shooter.z
        tx, ty, tz = target.x, target.y, target.z
        dx, dy, dz = tx - ox, ty - oy, tz - oz
        dist = math.hypot(dx, dz)
        if dist < 0.01:
            return True
        nx, nz = dx / dist, dz / dist
        # Height slope (dy per unit horizontal distance) so we can
        # interpolate the eye-line elevation at each sample step.
        ny = dy / dist if dist > 0 else 0.0
        steps = max(2, int(dist / 0.6))
        for i in range(1, steps):
            step_dist = i * 0.6
            px = ox + nx * step_dist
            pz = oz + nz * step_dist
            py = oy + ny * step_dist
            for ob in self.arena["obstacles"]:
                hx = ob["w"] / 2
                hz = ob["d"] / 2
                if abs(px - ob["x"]) < hx and abs(pz - ob["z"]) < hz:
                    y0 = float(ob.get("y_base", 0))
                    y1 = y0 + float(ob["h"])
                    if y0 <= py <= y1:
                        return False
        return True

    def raycast_hit(self, shooter: Player, yaw_override: Optional[float] = None, pitch_override: Optional[float] = None, at_time: Optional[float] = None):
        """Returns (hit_player, body_part, distance) where body_part in {'head','torso','legs'} or (None, None, None).

        When `at_time` is provided, every potential target is rewound to
        its position at that timestamp using `pos_history`. This is the
        "favor the shooter" lag compensation path: shots are resolved
        against what the shooter actually saw on screen, not the (~80-
        150ms) newer state the server now believes."""
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

        # Per-weapon projectile "thickness" — inflates the target hitbox
        # spheres so certain guns (AK) get near-miss forgiveness while
        # precision weapons (sniper/laser) stay pinpoint. Zero by default.
        thickness = float(weapon_cfg(getattr(shooter, "weapon", "ak47")).get("projectile_thickness", 0.0))

        def aabb_t(ob):
            # Respect `y_base` so floating obstacles (mezzanine walkways
            # and the hotel ceiling) are treated as being UP in the air,
            # not sitting at ground level. Without this, a ceiling at
            # y_base=14 gets its AABB at y=[0, 0.6] and blocks any shot
            # aimed slightly downward at ground targets.
            y0 = float(ob.get("y_base", 0))
            mn = (ob["x"] - ob["w"] / 2, y0, ob["z"] - ob["d"] / 2)
            mx = (ob["x"] + ob["w"] / 2, y0 + ob["h"], ob["z"] + ob["d"] / 2)
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
            # Lag-compensation: rewind this target's position to `at_time`
            # using its pos_history snapshot. Falls back to the current
            # position when at_time is None or the buffer is empty.
            tx, ty, tz, t_alive = p.x, p.y, p.z, p.alive
            if at_time is not None and p.pos_history:
                # Find the newest snapshot whose timestamp is <= at_time
                # (binary search isn't worth the imports for a 16-deep
                # ring buffer — linear scan from the front is fine).
                for snap_ts, sx, sy, sz, salive in p.pos_history:
                    if snap_ts <= at_time:
                        tx, ty, tz, t_alive = sx, sy, sz, salive
                    else:
                        break
            # The target must have been alive at the shot time, not just now.
            if not t_alive:
                continue
            # 3-sphere capsule hitbox — bigger + taller per user request.
            # Head radius 0.55→0.70, sits higher (1.65→1.85) so even tall
            # players in jump animations get clipped. Torso 0.65→0.85,
            # centred slightly higher (1.05→1.20). Legs 0.55→0.80, lower
            # centre (0.45→0.40) so the capsule actually reaches the floor.
            # Net effect: thicker silhouette overall + about 0.4m taller
            # total capsule. Headshot calling still works because the head
            # sphere is the topmost and still tightest of the three.
            base = ty - PLAYER_HEIGHT
            spheres = [
                ("head",  tx, base + 1.85, tz, 0.70 + thickness),
                ("torso", tx, base + 1.20, tz, 0.85 + thickness),
                ("legs",  tx, base + 0.40, tz, 0.80 + thickness),
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
            # TDM friendly-fire — same-team allies can't be melee'd.
            if self.game_mode == "tdm" and attacker.team and p.team and attacker.team == p.team:
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
                self._on_team_kill(attacker)
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
                self._record_kill_snapshot(attacker, best, "katana", headshot=False, melee=True)
                if not attacker.is_bot and attacker.user_id:
                    _bg(db.users.update_one({"_id": ObjectId(attacker.user_id)}, {"$inc": {"stats.kills": 1}}))
                if not best.is_bot and best.user_id:
                    _bg(db.users.update_one({"_id": ObjectId(best.user_id)}, {"$inc": {"stats.deaths": 1}}))


    def _record_kill_snapshot(self, shooter: Player, victim: Player, weapon: str, headshot: bool, melee: bool = False) -> None:
        """Append a compact kill record to `self.kill_log` for later
        replay. Called from every kill path (shoot / laser / melee).
        Bots' user_ids stay None so the frontend can skip profile
        links; usernames are always captured. Position is snapped to
        1 decimal to keep the persisted payload small."""
        try:
            t_ms = int((time.time() - self.match_start) * 1000)
        except Exception:
            t_ms = 0
        self.kill_log.append({
            "t_ms": max(0, t_ms),
            "shooter_id": shooter.user_id if not shooter.is_bot else None,
            "shooter_name": shooter.username,
            "shooter_is_bot": bool(shooter.is_bot),
            "shooter_x": round(shooter.x, 1),
            "shooter_z": round(shooter.z, 1),
            "shooter_yaw": round(shooter.yaw, 3),
            "victim_id": victim.user_id if not victim.is_bot else None,
            "victim_name": victim.username,
            "victim_is_bot": bool(victim.is_bot),
            "victim_x": round(victim.x, 1),
            "victim_z": round(victim.z, 1),
            "weapon": weapon,
            "headshot": bool(headshot),
            "melee": bool(melee),
        })
        # Safety cap so a long TDM can't balloon memory.
        if len(self.kill_log) > 400:
            self.kill_log = self.kill_log[-400:]

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

    def _on_team_kill(self, killer: Player) -> None:
        """TDM only — credit the killer's team and arm an early match end
        if their team hit `TDM_KILL_TARGET`. No-op in FFA."""
        if self.game_mode != "tdm" or not killer.team:
            return
        self.team_scores[killer.team] = self.team_scores.get(killer.team, 0) + 1
        if self.team_scores[killer.team] >= TDM_KILL_TARGET and not self._tdm_early_end_armed:
            self._tdm_early_end_armed = True
            # Compress the remaining match time so the existing tick-loop
            # `match_end` path fires within ~0.5s — no separate code path
            # needed for the early end, the rest of the game-over plumbing
            # (placements, broadcasts, intermission) still runs cleanly.
            self.match_start = time.time() - (self.match_duration - 0.5)

    async def _apply_shoot(self, shooter: Player, base_damage: int):
        """Overwatch-style shot resolution: spread cone + falloff + headshot multiplier.
        Bots use base_damage directly; real players use weapon config.

        Real-player shots are lag-compensated: every target's position is
        rewound by (half-RTT + 50ms client interp) to the moment the
        shooter actually clicked. Bots fire instantly and don't need it."""
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
        # Lag-compensation lookback for real-player shots only. Half RTT
        # accounts for the network delay between the client clicking and
        # the server resolving; +50ms covers the client's interp/render
        # lag (the player sees the world ~one server tick behind). Bots
        # have zero RTT so we skip the rewind for them.
        at_time = None
        if not shooter.is_bot:
            ping_ms = max(0, min(300, int(getattr(shooter, "last_ping_ms", 0) or 0)))
            lookback = (ping_ms / 1000.0) / 2.0 + 0.05
            at_time = time.time() - lookback
        hit, body_part, dist = self.raycast_hit(shooter, yaw_override=yaw, pitch_override=pitch, at_time=at_time)
        if hit and hit.alive:
            if time.time() < hit.invuln_until:
                return
            # TDM friendly fire — same-team hits deal no damage and emit
            # nothing (no hit feedback, no kill credit). Bullets pass
            # through teammates so a player isn't penalised for spraying
            # into a friendly's back during a chaotic peek.
            if self.game_mode == "tdm" and shooter.team and hit.team and shooter.team == hit.team:
                return
            # Damage scaling
            if shooter.is_bot:
                damage = base_damage
                # Ranked smart bots apply the weapon's headshot/legs
                # multipliers so a precision shot is actually rewarded.
                # Casual/offline bots stay flat — they're meant to be
                # forgiving practice opponents.
                if getattr(shooter, "_apply_weapon_mults", False):
                    if body_part == "head":
                        damage *= cfg["headshot_mult"]
                    elif body_part == "legs":
                        damage *= cfg["legs_mult"]
                    # Distance falloff parity with players — a ranked
                    # bot sniping from long range should deal the same
                    # reduced damage a player would from the same
                    # distance. Without this, ranked bots effectively
                    # got a "no-scope" damage advantage the player
                    # never had.
                    if dist is not None:
                        fs, fe, mn = cfg["falloff_start"], cfg["falloff_end"], cfg["min_damage_mult"]
                        if dist > fs:
                            t = min(1.0, (dist - fs) / max(0.001, fe - fs))
                            damage *= 1.0 - t * (1.0 - mn)
                    damage = int(round(damage))
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
            # Mark headshot in the hit/kill events when:
            #   • shooter is a real player landing on the head, OR
            #   • shooter is a ranked smart bot (i.e. `_apply_weapon_mults`)
            #     landing on the head — so the victim's HUD shows the
            #     proper headshot indicator + screen flash.
            head_hit = body_part == "head" and (not shooter.is_bot or getattr(shooter, "_apply_weapon_mults", False))
            self.events.append({
                "type": "hit",
                "shooter_id": shooter.id,
                "victim_id": hit.id,
                "hp": max(0, hit.hp),
                "body_part": body_part,
                "damage": damage,
                "headshot": head_hit,
            })
            if hit.hp <= 0:
                hit.alive = False
                hit.hp = 0
                hit.deaths += 1
                shooter.kills += 1
                self._on_team_kill(shooter)
                self._award_kill_heal(shooter, headshot=head_hit)
                hit.respawn_at = time.time() + 3.0
                self.events.append({
                    "type": "kill",
                    **shooter.shooter_payload(),
                    "victim_id": hit.id,
                    "victim_name": hit.username,
                    "weapon": getattr(shooter, "weapon", "ak47"),
                    "headshot": head_hit,
                })
                self._record_kill_snapshot(shooter, hit, getattr(shooter, "weapon", "ak47"), headshot=head_hit)
                if not shooter.is_bot and shooter.user_id:
                    _bg(db.users.update_one({"_id": ObjectId(shooter.user_id)}, {"$inc": {"stats.kills": 1}}))
                if not hit.is_bot and hit.user_id:
                    _bg(db.users.update_one({"_id": ObjectId(hit.user_id)}, {"$inc": {"stats.deaths": 1}}))

    def _laser_autoaim_lock(self, shooter: Player, *, max_range: float = 26.0, cone_rad: float = 1.05) -> Optional[Tuple[float, float]]:
        """Close-range aim-assist for the laser. Snaps the beam to the nearest
        living opponent that is (1) within `max_range` metres (26m default —
        bumped with the laser buff so mid-range duels track better),
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
        # Heat ramp — configurable per-weapon. Default 4s to overheat.
        ramp_s = max(0.5, float(cfg.get("heat_ramp_seconds", 4.0)))
        shooter.laser_heat = min(1.0, shooter.laser_heat + dt / ramp_s)
        # Close-range aim assist. Snaps to nearest enemy within 15m + ~25°
        # cone. Beam events still report the snapped yaw/pitch so the beam
        # visually goes where it actually hits.
        aim = self._laser_autoaim_lock(shooter)
        beam_yaw = aim[0] if aim else shooter.yaw
        beam_pitch = aim[1] if aim else shooter.pitch
        # Raycast (no spread). Lag-compensated for real-player beams so
        # tracking moving targets through latency still registers.
        at_time = None
        if not shooter.is_bot:
            ping_ms = max(0, min(300, int(getattr(shooter, "last_ping_ms", 0) or 0)))
            at_time = time.time() - ((ping_ms / 1000.0) / 2.0 + 0.05)
        hit, body_part, dist = self.raycast_hit(shooter, yaw_override=beam_yaw, pitch_override=beam_pitch, at_time=at_time)
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
        # TDM friendly-fire suppression — same-team beams cannot damage.
        if self.game_mode == "tdm" and shooter.team and hit.team and shooter.team == hit.team:
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
            self._on_team_kill(shooter)
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
            self._record_kill_snapshot(shooter, hit, "laser", headshot=(body_part == "head"))
            if not shooter.is_bot and shooter.user_id:
                _bg(db.users.update_one({"_id": ObjectId(shooter.user_id)}, {"$inc": {"stats.kills": 1}}))
            if not hit.is_bot and hit.user_id:
                _bg(db.users.update_one({"_id": ObjectId(hit.user_id)}, {"$inc": {"stats.deaths": 1}}))

    async def _maybe_start_countdown(self):
        """Start the pre-match 3-2-1 countdown the moment every real
        player in the room has reported `is_loaded=True`. Idempotent —
        safe to call from every `loaded` message + every player join.
        No-op once the countdown is already running or the match has
        already started (late joiners skip straight into the live game).
        """
        if self.match_started or self.countdown_until is not None:
            return
        real_players = [
            p for p in self.players.values()
            if not p.is_bot and not getattr(p, "is_spectator", False)
        ]
        if not real_players:
            return  # bots-only room — wait for the real player to actually join
        if not all(p.is_loaded for p in real_players):
            return
        now = time.time()
        self.countdown_until = now + self.countdown_seconds
        # Push match_start out to the moment the countdown ends so the
        # match-duration timer doesn't burn down during the freeze.
        self.match_start = self.countdown_until
        await self.broadcast({
            "type": "match_countdown",
            "countdown_until": self.countdown_until,
            "seconds": self.countdown_seconds,
        })

    async def _begin_match_now(self, forced: bool = False):
        """Flip the room out of the pre-match freeze. Called when the
        countdown elapses OR (safety) when the 30s grace window expires
        because somebody's client never sent `loaded`. Resets
        `match_start` so the duration timer counts from this exact
        moment instead of including the frozen seconds."""
        if self.match_started:
            return
        self.match_started = True
        self.countdown_until = None
        self.match_start = time.time()
        # New match — flush any stale kill snapshots from a prior match
        # in the same room (persistent rooms hold multiple matches).
        self.kill_log = []
        await self.broadcast({"type": "match_go", "forced": bool(forced)})

    async def handle_message(self, player: Player, msg: dict):
        # Spectators are read-only — ignore all gameplay messages.
        if getattr(player, "is_spectator", False):
            return
        mtype = msg.get("type")
        if mtype == "ping":
            await self._send(player, {"type": "pong", "ts": msg.get("ts", 0)})
            return
        if mtype == "loaded":
            # Client finished its loading screen and is ready for the
            # countdown. Bots come pre-loaded; this branch is real-player
            # only. The check inside `_maybe_start_countdown` is the
            # one that actually fires the 3-2-1.
            if not player.is_loaded:
                player.is_loaded = True
                await self._maybe_start_countdown()
            return
        # Block every gameplay-affecting input during the pre-match
        # freeze. We still let yaw/pitch updates through on `input` so
        # players can look around while staring at the countdown — feels
        # better than a fully locked camera. Shoots, melees, and x/z
        # movement are all silently dropped until `match_started`.
        if not self.match_started and mtype in ("shoot", "melee"):
            return
        if mtype == "input":
            x = float(msg.get("x", player.x))
            z = float(msg.get("z", player.z))
            yaw = float(msg.get("yaw", player.yaw))
            pitch = float(msg.get("pitch", player.pitch))
            max_delta = 1.2
            if not player.alive:
                return
            # Pre-match freeze: ignore x/z movement (player can still
            # turn the camera via yaw/pitch below). We `return` after
            # applying yaw/pitch so the rest of the input handler — ADS,
            # weapon-switch, laser_firing — also stays a no-op during
            # the countdown.
            if not self.match_started:
                player.yaw = yaw
                player.pitch = max(-1.5, min(1.5, pitch))
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
                # Spawn immunity is forfeited the moment the player
                # actually moves. Any non-zero delta (`dist > 0.02`
                # ignores idle joystick jitter) burns the 3s bubble so
                # players can't push into fights invulnerable. Applies
                # to every mode EXCEPT `bigffa` — the 12-player deathmatch
                # gives real players the full 3s regardless of movement
                # so a fresh spawn isn't a free frag in a crowded lobby.
                if (
                    dist > 0.02
                    and player.invuln_until > time.time()
                    and not getattr(self, "is_bigffa", False)
                ):
                    player.invuln_until = 0.0
            player.yaw = yaw
            player.pitch = max(-1.5, min(1.5, pitch))
            if "ads" in msg:
                player.is_ads = bool(msg["ads"])
            # Client tells us its currently-equipped weapon every input
            # tick so we can correctly resolve continuous-fire (laser)
            # vs primary hit-scan. Loadout swaps (ak47 ↔ sniper) are
            # LOBBY-scoped — the primary weapon is seeded from the
            # user doc at WS connect (`saved_weapon`) and MUST NOT
            # change mid-match via input ticks (that was the bug the
            # sniper feature exposed: hardcoded 'ak47' in the input
            # tick clobbered the server-side sniper seed). So we only
            # let the client toggle between laser and their loaded
            # primary — never between ak47 and sniper.
            if "weapon" in msg:
                w = msg.get("weapon")
                if w == "laser":
                    player.weapon = "laser"
                elif w in ("ak47", "sniper"):
                    # Snap back to whichever primary the player
                    # actually loaded (from PRIMARY_WEAPON_CHOICES).
                    # If the seed matches `w`, no-op; if it doesn't,
                    # we IGNORE the client's value to prevent
                    # mid-match loadout swaps.
                    saved = player._primary_loadout if hasattr(player, "_primary_loadout") else player.weapon
                    if player.weapon not in ("ak47", "sniper"):
                        # Just came off laser — restore the loaded primary.
                        player.weapon = saved
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
            # Per-shot ADS mirror. The client echoes its `ads` state on
            # every shoot message so a right-click-then-immediate-fire
            # sequence isn't rejected while the 20Hz input tick's
            # `ads: true` is still in-flight. Only applied when the
            # value is present; missing = fall through to whatever the
            # last input tick set.
            if "ads" in msg:
                player.is_ads = bool(msg["ads"])
            cfg = weapon_cfg(weapon)
            # ADS-only weapons (currently the sniper) cannot hip-fire.
            # Server rejects any shoot message that arrives while the
            # player's `is_ads` flag is False. Prevents the client from
            # working around the "must be scoped" restriction. Falls
            # through cleanly for AK etc which don't set `ads_only`.
            if cfg.get("ads_only") and not player.is_ads:
                return
            cooldown = cfg["cooldown_ms"]
            if now_ms - player.last_shot_ms < cooldown:
                return
            # Defence-in-depth: refuse to accept a primary-weapon swap
            # via a shoot message. Loadout is lobby-scoped and frozen
            # at WS connect (`_primary_loadout`). Same rationale as
            # the input-tick guard above — closes off the last channel
            # a malicious client could use to flip ak47↔sniper
            # mid-match. If the shoot message specifies a primary that
            # doesn't match the loaded one, snap back before applying.
            if weapon in ("ak47", "sniper"):
                loaded = getattr(player, "_primary_loadout", None) or player.weapon
                if loaded in ("ak47", "sniper") and weapon != loaded:
                    weapon = loaded
                    cfg = weapon_cfg(weapon)
                    if cfg.get("ads_only") and not player.is_ads:
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
            # Stash the client-reported RTT so `_apply_shoot` knows how
            # far back to rewind targets for lag compensation. Clamped
            # downstream (0..300ms) so a bad actor can't ask the server
            # to rewind half a second.
            if "ping_ms" in msg:
                try:
                    player.last_ping_ms = int(msg["ping_ms"])
                except (TypeError, ValueError):
                    pass
            await self._apply_shoot(player, cfg["damage"])
            # Auto-reload when magazine hits zero
            if player.ammo.get(weapon, 0) == 0:
                player.start_reload()
        elif mtype == "reload":
            if not player.alive or player.is_bot:
                return
            weapon = msg.get("weapon", player.weapon)
            # Reload is LOBBY-scoped just like shoot/input: never allow
            # the client to swap ak47 ↔ sniper via a stale reload
            # payload. Snap back to the loaded primary if the client
            # sends the wrong primary id (fixes: hardcoded 'ak47' in
            # older clients flipping sniper users on every reload).
            if weapon in ("ak47", "sniper"):
                loaded = getattr(player, "_primary_loadout", None) or player.weapon
                if loaded in ("ak47", "sniper") and weapon != loaded:
                    weapon = loaded
            player.weapon = weapon if weapon in WEAPON_CONFIGS else player.weapon
            player.start_reload()
        elif mtype == "jump":
            # Broadcast a client-visible jump — sets the arc start time
            # so `to_state()` returns lifted Y for the next ~650ms.
            # Ignored while already mid-air or dead so a spamming client
            # can't hover indefinitely.
            if not player.alive:
                return
            now_ms = int(time.time() * 1000)
            if player._jump_start_ms > 0 and (now_ms - player._jump_start_ms) < 650:
                return
            player._jump_start_ms = now_ms
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
            if player_rp is not None:
                jitter = random.randint(-20, 20)
                pts = max(low, min(high, int(player_rp) + jitter))
            else:
                pts = random.randint(low, max(low, high))
            t_idx, t_name = rank_for_points(pts)
            bot.disguise_rank_points = pts
            bot.disguise_rank_name = t_name
            bot.rank_tier = t_idx
            # Higher displayed level for disguised bots — scales with the
            # pretend tier so a "Goonmaster" bot doesn't read as a level
            # 8 rookie. Rough shape: Bronze ~10-20, Diamond ~35-70,
            # Goonmaster ~50-99. Base is 10, adds 5 per tier low and
            # 10 per tier high.
            _lvl_lo = 10 + t_idx * 5
            _lvl_hi = min(99, 20 + t_idx * 10)
            bot.level = random.randint(_lvl_lo, _lvl_hi)

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
            # High-tier smart bots (disguised as DIAMOND or above,
            # tier index >= 5) get extra behavioural intelligence
            # WITHOUT any damage / HP buff — per user request:
            #   - faster target-lock refresh (0.8s vs 1.5s)
            #   - cover-seek kicks in earlier (HP < 65 vs < 45)
            #   - longer lead prediction against strafers
            #   - tighter mid-range preference
            # `bot.rank_tier` is set by the disguise pass in
            # `spawn_bot`; for undisguised ranked bots it defaults to
            # 0 so this whole block is a no-op there.
            elite = smart and int(getattr(bot, "rank_tier", 0) or 0) >= 5

            # --- Target selection ---------------------------------------------------
            # Smart bots lock onto a target for 1.5s before re-evaluating,
            # and prefer wounded targets / recent attackers over the
            # closest opponent. Casual bots stick with closest-target.
            # In TDM, teammates are NEVER eligible targets (friendly fire is
            # already blocked at the damage layer, but a bot aiming at its
            # own teammate still wastes ammo and reads as broken AI).
            target: Optional[Player] = None
            is_tdm = self.game_mode == "tdm"
            if smart and bot.bot_target_id and now_s < bot.bot_target_locked_until:
                t = self.players.get(bot.bot_target_id)
                if t and t.alive and not getattr(t, "is_spectator", False):
                    if not (is_tdm and bot.team and t.team and bot.team == t.team):
                        target = t

            if target is None:
                best_score = -1.0
                for p in self.players.values():
                    if p is bot or not p.alive:
                        continue
                    if getattr(p, "is_spectator", False):
                        continue
                    # TDM: skip same-team allies so bots only engage enemies.
                    if is_tdm and bot.team and p.team and bot.team == p.team:
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
                    # Elite (Diamond+) bots refresh their target more
                    # often so they can switch focus to a wounded new
                    # threat instead of tunnel-visioning. 0.8s lock
                    # vs 1.5s standard smart lock.
                    lock_dur = 0.8 if elite else (1.5 if smart else 0.5)
                    bot.bot_target_locked_until = now_s + lock_dur
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
                x_ok = not self.collides_obstacle(bot.x + wx, bot.z)
                z_ok = not self.collides_obstacle(bot.x, bot.z + wz)
                if x_ok:
                    bot.x += wx
                if z_ok:
                    bot.z += wz
                # Same anti-stuck fallback as the pursuit branch —
                # if the wander vector is pinned against a corner,
                # try a perpendicular slide so the bot doesn't
                # freeze in front of a box waiting for a target.
                if not x_ok and not z_ok:
                    mag = math.hypot(wx, wz) or 1.0
                    perp_x, perp_z = -wz / mag, wx / mag
                    step = 1.5 * dt
                    for sign in (1.0, -1.0):
                        sx = bot.x + perp_x * sign * step
                        sz = bot.z + perp_z * sign * step
                        if not self.collides_obstacle(sx, sz):
                            bot.x, bot.z = sx, sz
                            break
                    else:
                        bot.bot_strafe_t += 1.5   # rotate the wander phase
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
                # Elite (Diamond+) bots lead ~50% further, punishing
                # sustained strafing much harder without giving them
                # extra damage or hitscan tightness.
                lead_scale = 0.27 if elite else 0.18
                lead_t = lead_scale * min(2.0, (difficulty - 1.4))
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
            # Elite (Diamond+) bots start looking for cover at a
            # higher HP threshold (65 vs 45) — they preserve HP more
            # strategically instead of trading shots to the death.
            cover_hp = 65 if elite else 45
            if smart and (bot.hp < cover_hp or (bot.last_damage_at and (now_s - bot.last_damage_at) < 0.6)):
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
            # Human-like juke: every 1.5-3s ranked smart bots flip strafe
            # phase by a random offset so the side-to-side pattern doesn't
            # read as a pure sine wave. Real players don't strafe in a
            # metronome — they fake one way then snap the other.
            if smart and self.is_ranked:
                if now_ms >= bot._juke_next_ms:
                    bot._juke_phase += random.uniform(math.pi * 0.6, math.pi * 1.4)
                    bot._juke_next_ms = now_ms + random.randint(1500, 3000)
            strafe = math.sin(bot.bot_strafe_t * strafe_freq + bot._juke_phase) * strafe_amp
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
                x_ok = not self.collides_obstacle(nx, bot.z)
                z_ok = not self.collides_obstacle(bot.x, nz)
                if x_ok:
                    bot.x = nx
                if z_ok:
                    bot.z = nz
                # Anti-stuck: if BOTH axes were blocked the bot is
                # pinned against a corner or wedged into an obstacle
                # and would freeze without a slide. Try both
                # perpendicular slide directions (right-hand and
                # left-hand along the movement vector) — whichever
                # opens up first wins. Also flip strafe phase so the
                # subsequent frames pull the bot along the wall
                # instead of back into it. Fixes the "bots freeze
                # against boxes / walls" complaint.
                elif not x_ok and not z_ok:
                    # Perpendicular unit vector to the blocked movement.
                    perp_x, perp_z = -mz_, mx_
                    slid = False
                    for sign in (1.0, -1.0):
                        sx = bot.x + perp_x * sign * move_speed
                        sz = bot.z + perp_z * sign * move_speed
                        if not self.collides_obstacle(sx, sz):
                            bot.x, bot.z = sx, sz
                            slid = True
                            break
                    if not slid:
                        # Fully cornered — nudge yaw so the next frame
                        # picks a different heading. Cheap, robust.
                        bot.bot_strafe_t += 1.2
                elif not x_ok:
                    bot.bot_strafe_t += 0.5  # flip strafe direction sooner
                elif not z_ok:
                    bot.bot_strafe_t += 0.5
                # Bots forfeit spawn immunity the moment they actually
                # start moving — universal across every game-mode (casual,
                # ranked, bigffa, party, practice). Players used to complain
                # that fresh bots could push into a fight invulnerable; the
                # earlier ranked-only carve-out has been removed so casual
                # and bigffa lobbies get the same fairness rule.
                if bot.invuln_until > now_s and move_speed > 0:
                    bot.invuln_until = 0.0

            # --- Human-like jumping (ranked smart bots only) ----------------------
            # Players bunny-hop and juke-jump constantly in 1v1s — make
            # ranked bots do the same. Jump arc duration ~650ms, peak
            # height ~1.2m. Cadence: every 1-3s when LOS is hot, longer
            # when out of range. A reactive jump also triggers when the
            # bot takes a hit (to dodge follow-up rounds).
            if smart and self.is_ranked and bot.alive:
                in_jump = bot._jump_start_ms > 0 and (now_ms - bot._jump_start_ms) < 650
                if in_jump:
                    # Parabolic arc — sin gives a smooth up-and-down with no
                    # discontinuity. Caps at +1.2m above the player's normal Y.
                    t = (now_ms - bot._jump_start_ms) / 650.0
                    bot.y = PLAYER_HEIGHT + math.sin(t * math.pi) * 1.2
                else:
                    # Settle back to ground if we were mid-jump and the
                    # window expired (e.g. after a respawn or stun).
                    if bot.y != PLAYER_HEIGHT:
                        bot.y = PLAYER_HEIGHT
                    if bot._jump_start_ms > 0:
                        bot._jump_start_ms = 0
                    # Re-roll the next jump time. Closer fights → more
                    # frequent hops (1-2s); long-range → calmer (2-4s).
                    # Damage in the last 0.3s also forces a quick juke
                    # jump regardless of the cooldown clock.
                    just_hit = bot.last_damage_at and (now_s - bot.last_damage_at) < 0.3
                    if just_hit or now_ms >= bot._jump_next_ms:
                        if just_hit or dist < 18.0:
                            bot._jump_start_ms = now_ms
                            bot._jump_next_ms = now_ms + random.randint(900, 2400)
                        else:
                            # Out of effective range — just push the next
                            # window forward without jumping so we don't
                            # check this every tick.
                            bot._jump_next_ms = now_ms + random.randint(2000, 4000)

            # --- Fire control -------------------------------------------------------
            difficulty = float(getattr(bot, "difficulty", 1.0))
            # Ranked-only reaction nerf: tack a small extra cooldown onto
            # ranked smart bots (the casual / offline ones are unaffected).
            # Net effect: they pull the trigger ~80ms slower than before
            # the nerf, which gives a fast-strafing player a real chance
            # to break LOS before bullets start landing.
            effective_cd = BOT_SHOT_COOLDOWN_MS / max(0.5, difficulty)
            # Ranked-only reaction nerf — kept just to give players a brief
            # window to break LOS, but trimmed to +40ms (was +80ms) per
            # user feedback that ranked bots felt sluggish.
            if smart and self.is_ranked:
                effective_cd += 40
                # Floor ranked bot fire rate at the player's AK cadence.
                # Without this, high-tier ranked bots (Diamond+, diff ≥
                # 2.8) end up firing at ~200-260ms — significantly FASTER
                # than the player's 320ms hold-to-fire cooldown. The
                # ladder should scale via bot AIM and MOVEMENT, not by
                # letting bots trigger-hack. Match the player's cadence
                # so a good bot's edge is smarter positioning, not raw
                # DPS the player can never match.
                effective_cd = max(effective_cd, float(SHOT_COOLDOWN_MS))
            in_burst_cooldown = smart and now_ms < bot.bot_burst_cooldown_until
            if not in_burst_cooldown and now_ms - bot.last_shot_ms >= effective_cd:
                if self._has_los(bot, target):
                    # Firing forfeits spawn immunity on all bots (all modes).
                    if bot.invuln_until > now_s:
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
                    # Damage: casual/offline bots use BOT_SHOT_DAMAGE on
                    # a difficulty curve (gentle for practice). RANKED
                    # smart bots use the full AK body damage (25) and
                    # also get the weapon's headshot multiplier applied
                    # downstream — together with the ~30% head-aim bias
                    # above, a head shot lands for 25 × 2.0 = 50 damage
                    # → an aimed AK 2-shots a full-HP player. Body shots
                    # stay at 25 (4-shot kill) — slower than a real
                    # player can manage with perfect tracking, so the
                    # bot is a credible threat without being aimbot.
                    if smart and self.is_ranked:
                        bot._apply_weapon_mults = True
                        dmg = int(weapon_cfg("ak47")["damage"])
                    else:
                        bot._apply_weapon_mults = False
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

        # Pre-match freeze gate. While `match_started` is False nothing
        # should move, shoot, take damage, or respawn — the room is just
        # holding the camera + HUD steady while clients render the 3-2-1.
        # The countdown auto-ends when `countdown_until` elapses, or
        # (safety) the 30s grace window expires for clients that never
        # sent `loaded`. We still record lag-comp snapshots above this
        # gate so the first post-countdown shoot has a valid history.
        if not self.match_started:
            for p in self.players.values():
                p.pos_history.append((now, p.x, p.y, p.z, p.alive))
            if self.countdown_until is not None and now >= self.countdown_until:
                await self._begin_match_now()
            elif self.countdown_until is None and (now - self._countdown_grace_start) >= 30.0:
                # Safety fallback: nobody ever sent `loaded`. Force-start
                # by marking every real player loaded and re-running the
                # check — this triggers the normal countdown path so the
                # client still sees a 3-2-1 even though we synthesised it.
                for p in self.players.values():
                    if not p.is_bot:
                        p.is_loaded = True
                await self._maybe_start_countdown()
            return

        # Lag-compensation snapshot — record every player's current
        # position so a shot we resolve in N ms can rewind each target's
        # position to the moment the shooter actually clicked. The
        # history deque is bounded (maxlen=16) so this stays O(players).
        for p in self.players.values():
            p.pos_history.append((now, p.x, p.y, p.z, p.alive))

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
                    # Cool down — configurable per-weapon (default 3 s).
                    cool_s = max(0.5, float(weapon_cfg("laser").get("heat_cool_seconds", 3.0)))
                    p.laser_heat = max(0.0, p.laser_heat - dt / cool_s)
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
            # TDM-only fields. Frontend ignores when game_mode is "ffa".
            "game_mode": self.game_mode,
            "team_scores": dict(self.team_scores) if self.game_mode == "tdm" else None,
            "tdm_kill_target": TDM_KILL_TARGET if self.game_mode == "tdm" else None,
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
                        # Placement matches: hard "win or lose 100" rule
                        # PLUS a performance modifier on top so a
                        # dominant carry doesn't earn the same as a
                        # lucky 1st place, and a hard-throw doesn't
                        # slip through with the same soft −100 as a
                        # near-miss 2nd place. See `compute_placement_delta`
                        # (top of file) for the full formula + caps.
                        delta = compute_placement_delta(
                            kills=p.kills,
                            deaths=p.deaths,
                            placement=placement,
                            cur_tier_idx=cur_tier_idx,
                        )
                        base_delta = delta
                    else:
                        # Non-placement ranked match — performance-scaled
                        # RP delta so a dominant carry gets a real bump
                        # over a lucky 1st place and a hard-throw pays
                        # for it beyond the flat base.
                        #
                        # Formula:
                        #   base    = compute_rp_delta(placement, tier_idx)
                        #             (podium curve — see _lib/ranks.py)
                        #   perf    = kills * 3 − deaths * 5
                        #   Master (tier 6):  perf → perf * 0.55 − 15   ("Master tax")
                        #   GM+   (tier 7+):  perf → perf * 0.4  − 20   ("GM+ tax")
                        #   max_gain = 35 uniformly across all tiers
                        #   delta    = clamp(base + perf, −60, 35)
                        #
                        # Master+ tiers CAN still hit +35 per user request
                        # — just significantly harder. A middle-of-pack
                        # game at Master no longer lands at +35 the way
                        # it would at Silver; only a dominant carry hits
                        # the cap. Loss side unchanged so falling out of
                        # the top tiers still hurts. GM+ is the toughest
                        # to milk: even a 20/5 game only nets a modest
                        # positive delta unless the player wins outright.
                        #
                        # Sanity checks:
                        #   27 K / 3 D + 1st, Silver:   base 30 + perf 66              → +35 (cap)
                        #   27 K / 3 D + 1st, Master:   base 30 + (66*0.55 − 15 = 21)   → +35 (cap, tight)
                        #   15 K / 5 D + 1st, Master:   base 30 + (20*0.55 − 15 = −4)   → +26
                        #   27 K / 3 D + 1st, GM+:      base 30 + (66*0.4  − 20 = 6)    → +35 (cap, VERY tight)
                        #   15 K / 5 D + 1st, GM+:      base 30 + (20*0.4  − 20 = −12)  → +18
                        #   3 K / 9 D + 4th, Silver:    base −30 + perf −36            → −60 (cap)
                        base_delta = compute_rp_delta(placement, cur_tier_idx)
                        raw_perf = p.kills * 3 - p.deaths * 5
                        if cur_tier_idx >= MASTERS_TIER_IDX + 1:
                            # GM+ tax — perf scaled 0.4 then a −20 flat.
                            perf_delta = int(raw_perf * 0.4) - 20
                        elif cur_tier_idx >= MASTERS_TIER_IDX:
                            # Master tax — perf scaled 0.55 then a −15 flat.
                            perf_delta = int(raw_perf * 0.55) - 15
                        else:
                            perf_delta = raw_perf
                        max_gain = 35   # Uniform cap; the Master+ tax gates the ceiling.
                        delta = max(-60, min(max_gain, base_delta + perf_delta))
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
                    # XP Boost: if the player has an active 2x boost, credit
                    # the same amount of `bonus_xp` that this match would
                    # naturally earn, effectively doubling their XP for the
                    # match. Read the fresh udoc (it holds `xp_boost_until`).
                    boost_bonus = xp_boost_bonus_for_match(udoc or {}, p.kills, placement)
                    if boost_bonus > 0:
                        inc_doc["stats.bonus_xp"] = boost_bonus
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
                    "rank_division": rank_division_for_points(new_points, tier_idx),
                    # Previous tier + change so the client can play the
                    # rank-up / rank-down overlay only for actual transitions.
                    "prev_rank_tier": prev_tier_idx,
                    "prev_rank_name": prev_tier_name,
                    "prev_rank_division": rank_division_for_points(max(0, new_points - delta), prev_tier_idx),
                    "rank_change": rank_change,
                    "is_placement": is_placement,
                    "placement_match_number": placement_played_before + 1 if is_placement else None,
                    "placement_matches_total": PLACEMENT_MATCHES,
                })
            # Append bot rows so the match-end overlay shows the full lobby
            # in ranked mode too. Bots' RP is purely cosmetic for the
            # scoreboard — they don't have a real account, but we compute
            # a plausible delta from their disguised tier + placement so
            # the scoreboard reads like a real ranked lobby (every line
            # shows +N / -N, not just the player).
            for p in all_participants:
                if not p.is_bot:
                    continue
                bot_placement = placement_of.get(p.id, total_with_bots)
                bot_tier_idx = int(getattr(p, "rank_tier", 0) or 0)
                bot_tier_name = getattr(p, "disguise_rank_name", None) or "BRONZE"
                # Include the disguised division so the end-match
                # scoreboard renders "DIAMOND II" / "GOLD III" for bots
                # instead of just "DIAMOND" / "GOLD" — matches the
                # in-match leaderboard widget and real-player rows.
                bot_disguise_rp = int(getattr(p, "disguise_rank_points", 0) or 0)
                bot_tier_division = rank_division_for_points(bot_disguise_rp, bot_tier_idx)
                bot_delta = compute_rp_delta(bot_placement, bot_tier_idx)
                placements.append({
                    "id": p.id,
                    "user_id": "",
                    "username": p.username or p.bot_name or "BOT",
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "delta": bot_delta,
                    "base_delta": bot_delta,
                    "new_points": 0,
                    "rank_tier": bot_tier_idx,
                    "rank_name": bot_tier_name,
                    "rank_division": bot_tier_division,
                    "prev_rank_tier": bot_tier_idx,
                    "prev_rank_name": bot_tier_name,
                    "prev_rank_division": bot_tier_division,
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
                    # rank label + division ("DIAMOND II") if one was
                    # assigned (matches the in-match leaderboard widget +
                    # ranked scoreboard). Avoid leaking is_bot to the
                    # client so they look like real opponents.
                    tier_idx = int(getattr(p, "rank_tier", 0) or 0)
                    tier_name = getattr(p, "disguise_rank_name", None) or "BRONZE"
                    disguise_rp = int(getattr(p, "disguise_rank_points", 0) or 0)
                    tier_division = rank_division_for_points(disguise_rp, tier_idx)
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
                        "rank_division": tier_division,
                        "prev_rank_tier": tier_idx,
                        "prev_rank_name": tier_name,
                        "prev_rank_division": tier_division,
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
                    # XP Boost: credit bonus_xp same as ranked branch.
                    boost_bonus = xp_boost_bonus_for_match(udoc or {}, p.kills, placement)
                    if boost_bonus > 0:
                        inc_doc["stats.bonus_xp"] = boost_bonus
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
                    "rank_division": rank_division_for_points(cur_points, tier_idx),
                    "prev_rank_tier": tier_idx,
                    "prev_rank_name": tier_name,
                    "prev_rank_division": rank_division_for_points(cur_points, tier_idx),
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
            # TDM-specific fields — the client uses these to render the
            # team-based VICTORY/DEFEAT/DRAW headline instead of the FFA
            # "1st place wins" logic. Populated for TDM only; FFA leaves
            # `game_mode: "ffa"` and null scores.
            "game_mode": self.game_mode,
        }
        if self.game_mode == "tdm":
            red_score = int(self.team_scores.get("red", 0))
            blue_score = int(self.team_scores.get("blue", 0))
            if red_score > blue_score:
                winning_team = "red"
            elif blue_score > red_score:
                winning_team = "blue"
            else:
                winning_team = None  # draw
            payload["team_scores"] = {"red": red_score, "blue": blue_score}
            payload["winning_team"] = winning_team
            # Inject each participant's team onto their placement row so
            # the client can look up "my team" -> compare to winning_team.
            # We index by participant id to cover both real players and
            # bots. Uses `all_participants` which is already in scope.
            team_by_id = {
                p.id: (getattr(p, "team", None) or "").lower() or None
                for p in all_participants
            }
            for row in placements:
                row["team"] = team_by_id.get(row.get("id"))
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
                # Build the shared "players list" once — every real player's
                # history row for this match gets the SAME roster so clicking
                # any history row surfaces the full scoreboard (real players
                # + bots). Bots include `is_bot: True` so the client can hide
                # profile-link buttons for them.
                #
                # Composite key `match_id` is a shared UUID so future queries
                # can group rows belonging to the same match without relying
                # on ended_at ± tolerance heuristics.
                match_id = uuid.uuid4().hex
                shared_roster: List[dict] = []
                for pl in self.players.values():
                    if getattr(pl, "is_spectator", False):
                        continue
                    entry = placements_by_uid.get(pl.user_id) if not pl.is_bot else None
                    shared_roster.append({
                        "user_id": pl.user_id if not pl.is_bot else None,
                        "username": pl.username,
                        "is_bot": bool(pl.is_bot),
                        "kills": int((entry.get("kills", pl.kills) if entry else pl.kills) or 0),
                        "deaths": int((entry.get("deaths", pl.deaths) if entry else pl.deaths) or 0),
                        "placement": placement_of.get(pl.id, 0),
                        "team": (getattr(pl, "team", None) or None),
                    })
                # Stable sort so the persisted scoreboard reads top-down:
                # winner first in FFA (placement asc), highest-kills first
                # in TDM (placement isn't meaningful there).
                if self.game_mode == "tdm":
                    shared_roster.sort(key=lambda r: (-r["kills"], r["deaths"]))
                else:
                    shared_roster.sort(key=lambda r: (r["placement"] or 999, -r["kills"]))
                for pl in real_players:
                    entry = placements_by_uid.get(pl.user_id) or {}
                    doc = {
                        "user_id": pl.user_id,
                        "username": pl.username,
                        "mode": mode,
                        # `game_mode` distinguishes FFA from TDM inside the
                        # broader mode label ("casual" covers both today).
                        # The profile history UI keys off this to render
                        # WIN/LOSS + team-score badges for TDM rows instead
                        # of the FFA "Nth of M" placement card.
                        "game_mode": self.game_mode,
                        "kills": int(entry.get("kills", pl.kills) or 0),
                        "deaths": int(entry.get("deaths", pl.deaths) or 0),
                        "placement": placement_of.get(pl.id, 1),
                        "total_players": total_with_bots,
                        "rp_delta": int(entry.get("delta", 0) or 0),
                        "rank_points_after": int(entry.get("new_points", 0) or 0),
                        "rank_name_after": entry.get("rank_name") or "BRONZE",
                        "is_placement": bool(entry.get("is_placement", False)),
                        "ended_at": now,
                        # Full match roster + shared match_id so the profile
                        # history UI can pop a scoreboard modal with every
                        # player who was in this match (real + bots), each
                        # real player linkable to their public profile.
                        "match_id": match_id,
                        "players": list(shared_roster),
                        # Per-player kill replays: every kill event
                        # where this player was either shooter OR
                        # victim. Bounded by _record_kill_snapshot's
                        # 400-entry cap and typical <40 kills/deaths
                        # per player per match.
                        "kill_events": [
                            k for k in self.kill_log
                            if (
                                (not k.get("shooter_is_bot") and k.get("shooter_id") == pl.user_id)
                                or (not k.get("victim_is_bot") and k.get("victim_id") == pl.user_id)
                            )
                        ],
                        # Arena bounds so the client can draw a
                        # correctly-scaled top-down killcam. Just
                        # store size; obstacles are re-derivable from
                        # the map id if we ever need them.
                        "arena_size": int(self.arena.get("size", 40)) if getattr(self, "arena", None) else 40,
                        "arena_map_id": (getattr(self, "arena", None) or {}).get("map_id"),
                    }
                    # TDM extras: persist the player's team color, the
                    # final 4v4 scoreline, and a precomputed `team_won`
                    # flag so the UI can render WIN / LOSS / DRAW without
                    # reapplying the tie-break rules client-side.
                    if self.game_mode == "tdm":
                        p_team = (getattr(pl, "team", None) or "").lower()
                        my_score = int(self.team_scores.get(p_team, 0))
                        other_team = "blue" if p_team == "red" else "red"
                        enemy_score = int(self.team_scores.get(other_team, 0))
                        if my_score > enemy_score:
                            team_outcome = "win"
                        elif my_score < enemy_score:
                            team_outcome = "loss"
                        else:
                            team_outcome = "draw"
                        doc.update({
                            "team": p_team or None,
                            "team_score": my_score,
                            "enemy_team_score": enemy_score,
                            "team_outcome": team_outcome,
                        })
                    docs.append(doc)
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
                    # Retention cap: keep only the last 20 matches per
                    # user (per-user request). For each user we just
                    # inserted a row for, find their 21st-newest and
                    # delete anything older. Cheap because the users we
                    # touched here is small (real players in this match).
                    HISTORY_KEEP = 20
                    for pl in real_players:
                        try:
                            skip_cursor = db.match_history.find(
                                {"user_id": pl.user_id},
                                {"_id": 1, "ended_at": 1},
                            ).sort("ended_at", -1).skip(HISTORY_KEEP).limit(1)
                            cutoff = await skip_cursor.to_list(length=1)
                            if cutoff:
                                await db.match_history.delete_many({
                                    "user_id": pl.user_id,
                                    "ended_at": {"$lt": cutoff[0]["ended_at"]},
                                })
                        except Exception as _e:
                            logger.warning("history retention prune failed for %s: %s", pl.user_id, _e)
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
        # New round, fresh freeze. Real players are still connected (no
        # loading screen this time round) so we mark them all loaded
        # immediately — `_maybe_start_countdown` will fire the 3-2-1
        # right after we broadcast `match_start` below. Bots are already
        # `is_loaded=True` from construction.
        self.match_started = False
        self.countdown_until = None
        self._countdown_grace_start = time.time()
        for p in self.players.values():
            if not p.is_bot:
                p.is_loaded = True
        # **Reset everyone's per-match counters** so a fresh round actually
        # starts at 0-0. Without this, bots that have been alive across
        # many practice / quick-match rounds carry their lifetime kill
        # tally into the new game and the player joins finding bots
        # already at "50 kills". HP also reset so respawn-on-match-start
        # gives a clean slate.
        for p in self.players.values():
            p.kills = 0
            p.deaths = 0
            p.hp = p.max_hp
            p.alive = True
            p.respawn_at = 0.0
        # Fresh TDM bookkeeping for the next match.
        self.team_scores = {"red": 0, "blue": 0}
        self._tdm_early_end_armed = False
        # Rebalance teams so a long-running room doesn't drift after
        # joins/leaves across many rounds.
        if self.game_mode == "tdm":
            self._rebalance_teams()

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
        # Kick off the post-reset 3-2-1 countdown. For inter-round
        # transitions this fires immediately because every real player
        # was marked loaded above; for first-time room creation
        # `_maybe_start_countdown` was already attempted on the welcome
        # path (player-by-player) so this call is a defensive no-op when
        # the room was just made.
        await self._maybe_start_countdown()

    async def run(self):
        interval = 1.0 / TICK_RATE
        while True:
            try:
                if not self.in_intermission:
                    real_count = sum(1 for p in self.players.values() if not p.is_bot)
                    has_min = real_count >= (RANKED_MIN_REAL_PLAYERS if self.is_ranked else 1)
                    # Skip the match-duration / idle-bot bookkeeping while
                    # the pre-match freeze is active. `tick()` is in
                    # charge of flipping `match_started` once the
                    # countdown elapses; until then we don't want to
                    # end the match (we haven't even started it) or
                    # zero-out bot stats (they're idle anyway).
                    if has_min and self.match_started and time.time() - self.match_start >= self.match_duration:
                        await self.end_match()
                        continue
                    # Idle-room hygiene — when no real players are around, the
                    # `end_match`/intermission cycle can't run (gated by
                    # `has_min` above), so bots would otherwise keep killing
                    # each other forever and accumulate hundreds of kills.
                    # Freeze the match clock and zero-out any bot stats so
                    # the next human joiner walks into a clean 0-0 lobby.
                    # Ranked rooms are skipped — their RP flow requires the
                    # full match window even at low population.
                    if not has_min and not self.is_ranked:
                        self.match_start = time.time()  # freeze duration timer
                        dirty = False
                        for bot in self.players.values():
                            if bot.is_bot and (bot.kills or bot.deaths):
                                bot.kills = 0
                                bot.deaths = 0
                                dirty = True
                        if dirty and self.game_mode == "tdm":
                            self.team_scores = {"red": 0, "blue": 0}
                            self._tdm_early_end_armed = False
                await self.tick()
            except Exception as e:
                logger.exception("tick error: %s", e)
            await asyncio.sleep(interval)


game_room = GameRoom(is_ranked=False, match_duration=60.0)  # 1 minute Quick Match (FFA)
# Dedicated TDM quick-match room — quick-match joins roll into this 50% of
# the time. Same 60s match length so the casual rotation feel is identical.
tdm_room = GameRoom(is_ranked=False, match_duration=60.0, game_mode="tdm")
ranked_room = GameRoom(is_ranked=True, match_duration=120.0)  # 2 minute Ranked
practice_room = GameRoom(is_ranked=False, match_duration=99999.0)  # Practice never ends
practice_room.is_practice = True
# TDM practice room — same never-ending session, but team-mode so users
# can rehearse the 4v4 format. Pre-filled with smart bots in start_event.
practice_tdm_room = GameRoom(is_ranked=False, match_duration=99999.0, game_mode="tdm")
practice_tdm_room.is_practice = True

# 12-player Big FFA — its own dedicated casual room, 2-minute matches so
# the deathmatch has room to breathe with 12 combatants. Not tied to the
# quick-match matchmaker or the ranked queue: players connect directly
# via `?mode=bigffa` from the lobby's dedicated button. `bots_target_size`
# overrides the default FFA_LOBBY_SIZE inside `_maintain_population` so
# the room fills to 12 with disguised bots when solo/duo players hop in.
BIGFFA_LOBBY_SIZE = 12
bigffa_room = GameRoom(is_ranked=False, match_duration=120.0)
bigffa_room.is_bigffa = True
bigffa_room.bots_target_size = BIGFFA_LOBBY_SIZE

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


# Offline-vs-AI TDM rooms — separate dict so a user can switch between
# FFA and TDM offline practice without leaking state between the two.
OFFLINE_TDM_ROOMS: Dict[str, "GameRoom"] = {}
OFFLINE_TDM_ROOM_TASKS: Dict[str, asyncio.Task] = {}


async def get_or_create_offline_tdm_room(user_id: str) -> "GameRoom":
    """Per-user 5-minute TDM-4v4 offline room. Pre-filled with disguised
    bots so the user drops into a balanced 4v4 of "humans".
    `_maintain_tdm_population` swaps bots in/out if more players ever join."""
    room = OFFLINE_TDM_ROOMS.get(user_id)
    if room is not None:
        return room
    room = GameRoom(is_ranked=False, match_duration=300.0, game_mode="tdm")
    room.is_offline = True
    bot_names = random.sample(DISGUISED_BOT_NAMES, TDM_TEAM_SIZE * 2 - 1)
    for nm in bot_names:
        room.spawn_bot(nm, disguised=True, difficulty=1.2)
    OFFLINE_TDM_ROOMS[user_id] = room
    OFFLINE_TDM_ROOM_TASKS[user_id] = asyncio.create_task(room.run())
    logger.info("Offline TDM room spawned for user=%s", user_id)
    return room


async def cleanup_offline_tdm_room_if_empty(user_id: str):
    room = OFFLINE_TDM_ROOMS.get(user_id)
    if room is None:
        return
    if any(not p.is_bot for p in room.players.values()):
        return
    task = OFFLINE_TDM_ROOM_TASKS.pop(user_id, None)
    if task and not task.done():
        task.cancel()
    OFFLINE_TDM_ROOMS.pop(user_id, None)
    logger.info("Offline TDM room destroyed for user=%s", user_id)


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
# Casual matchmaking — a single FIFO queue (no tiers) so quick-match
# operates like ranked but without rank gating. Bot-fill timer is short
# (10s) so the player is never left waiting long; matchmaker pairs head-
# to-head when two entries are present. Mirrors RANKED_QUEUE's shape:
# each entry is `{user_id?, user_ids?, username?, usernames?, joined_at, is_party?}`.
CASUAL_QUEUE: List[dict] = []
CASUAL_BOT_FILL_SEC = 10.0

# BigFFA queue — same pattern as CASUAL_QUEUE but drops the whole cohort
# into the shared `bigffa_room` at once. We hold queued players up to
# BIGFFA_BOT_FILL_SEC seconds to try and group real humans together;
# after that timeout the room bot-fills the remaining slots on entry.
# The 60s window is intentionally longer than casual's 10s so a 12-player
# lobby has a realistic shot at filling with humans before bots take over.
BIGFFA_QUEUE: List[dict] = []
BIGFFA_BOT_FILL_SEC = 60.0
# Range from which the per-join ETA pill is sampled. Wider than casual
# because the target lobby size is 3× larger.
BIGFFA_ETA_MIN_SEC = 20.0
BIGFFA_ETA_MAX_SEC = 60.0
MATCHED_USERS: Dict[str, dict] = {}  # user_id -> {match_id, tier}

# Rolling window (last 10) of how long each match took to fill, per tier.
# Used by the queue API to give players an estimated wait time. Empty until
# the matchmaker has seen at least one match in a tier.
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
                # Casual queue — single FIFO, no tiers. Pair head-to-head
                # when two entries are present, otherwise bot-fill after
                # CASUAL_BOT_FILL_SEC (10s). Quicker than ranked so
                # casual queues feel instant.
                while len(CASUAL_QUEUE) >= 2:
                    a = CASUAL_QUEUE.pop(0)
                    b = CASUAL_QUEUE.pop(0)
                    mid = uuid.uuid4().hex[:10]
                    a_uids = a.get("user_ids") or ([a["user_id"]] if a.get("user_id") else [])
                    b_uids = b.get("user_ids") or ([b["user_id"]] if b.get("user_id") else [])
                    # Roll FFA vs TDM ONCE per match so both paired
                    # players land in the same shared room.
                    match_tdm = random.random() < TDM_QUICK_MATCH_ROLL
                    for uid in a_uids + b_uids:
                        MATCHED_USERS[uid] = {"match_id": mid, "casual": True, "matched_at": now, "tdm": match_tdm}
                    logger.info(
                        "Casual matched entryA=%s vs entryB=%s mid=%s tdm=%s",
                        ",".join(a.get("usernames") or [a.get("username", "?")]),
                        ",".join(b.get("usernames") or [b.get("username", "?")]),
                        mid, match_tdm,
                    )
                while CASUAL_QUEUE and (now - CASUAL_QUEUE[0]["joined_at"]) >= CASUAL_BOT_FILL_SEC:
                    a = CASUAL_QUEUE.pop(0)
                    mid = uuid.uuid4().hex[:10]
                    a_uids = a.get("user_ids") or ([a["user_id"]] if a.get("user_id") else [])
                    shared_key = a_uids[0] if a_uids else None
                    # Solo bot-fill also rolls TDM/FFA so the bot room
                    # variety matches the head-to-head experience.
                    bot_tdm = random.random() < TDM_QUICK_MATCH_ROLL
                    for uid in a_uids:
                        MATCHED_USERS[uid] = {"match_id": mid, "casual": True, "matched_at": now, "vs_bot": True, "room_key": shared_key, "tdm": bot_tdm}
                    logger.info(
                        "Casual bot-filled entry=%s (%d users) after %ds queue tdm=%s",
                        ",".join(a.get("usernames") or [a.get("username", "?")]),
                        len(a_uids), int(CASUAL_BOT_FILL_SEC), bot_tdm,
                    )
                # BigFFA queue — everyone lands in the shared `bigffa_room`.
                # Dispatch the whole queue at once when either (a) the
                # queue has hit the room's target size (12 real humans) or
                # (b) the oldest entry has been waiting BIGFFA_BOT_FILL_SEC.
                # The room's own `_maintain_population` handles bot-fill
                # once players arrive, so we don't need a separate bot
                # branch — every dispatch is functionally the same.
                if BIGFFA_QUEUE and (
                    len(BIGFFA_QUEUE) >= BIGFFA_LOBBY_SIZE
                    or (now - BIGFFA_QUEUE[0]["joined_at"]) >= BIGFFA_BOT_FILL_SEC
                ):
                    mid = uuid.uuid4().hex[:10]
                    dispatched: List[str] = []
                    while BIGFFA_QUEUE:
                        entry = BIGFFA_QUEUE.pop(0)
                        uids = entry.get("user_ids") or (
                            [entry["user_id"]] if entry.get("user_id") else []
                        )
                        for uid in uids:
                            MATCHED_USERS[uid] = {
                                "match_id": mid,
                                "bigffa": True,
                                "matched_at": now,
                            }
                            dispatched.append(uid)
                        RECENT_MATCH_WAITS[0].append(now - entry["joined_at"])
                    logger.info(
                        "BigFFA dispatched %d players into bigffa_room mid=%s",
                        len(dispatched), mid,
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


async def seeded_climb_loop():
    """Lerp every seeded leaderboard account from 0 RP toward its
    `seed_target_rp` across the current season's runtime.

    Each seeded doc carries a `seed_target_rp` (final destination), per-stat
    targets (`seed_target_matches/kills/deaths/wins`), a per-bot
    `seed_climb_offset` (fraction of season elapsed before this bot starts
    climbing, 0..0.08 — tightened from 0.20 so seeds start climbing sooner)
    and `seed_climb_speed` (per-bot pace multiplier, ~1.35..2.4 — bumped
    from ~0.75..1.35 so the leaderboard fills the top tiers faster). Each
    tick:

      progress = clamp((elapsed_fraction - offset) * speed, 0, 1)

    is multiplied against each target field and written back. Because
    different bots have different offsets/speeds, the leaderboard
    reshuffles organically over the season instead of all seeds
    scaling uniformly. When `maybe_reset_season` zeroes everyone's
    `rank_points` + `placement_matches_played` at rollover the next tick
    rebuilds the curve from 0 automatically — no separate re-seed needed.

    `placement_matches_played` is restored to PLACEMENT_MATCHES once a
    seed's interpolated match count crosses that threshold, otherwise it
    tracks the lerped match count (so very-fresh-season seeds sit just
    below the leaderboard filter, then pop in as they "play" placements).
    """
    while True:
        try:
            # One-time migration for legacy seeded docs that pre-date the
            # climb system. Convert their static rank_points/stats into
            # climb targets so they participate in the curve like
            # newly-seeded docs. RP is snapped to the match grid
            # (multiples of 15) and the stat targets (matches/kills/
            # deaths/wins) are RE-synthesized from the snapped RP via
            # `_synthesize_career` so the targets are guaranteed to be
            # mathematically consistent with the ranked RP curve — even
            # if the legacy doc was inserted with under-counted matches
            # or impossibly low wins. After this single pass the docs
            # carry `seed_target_rp` and the migration filter no longer
            # matches them — subsequent ticks skip straight to the lerp.
            legacy = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": False}},
                {"_id": 1, "rank_points": 1, "stats": 1},
            )
            async for u in legacy:
                rp_raw = int(u.get("rank_points", 0) or 0)
                if rp_raw <= 0:
                    continue
                rp_target = _snap_rp_to_match_grid(rp_raw)
                rank_idx, _ = rank_for_points(rp_target)
                t_m, t_k, t_d, t_w = _synthesize_career(rp_target, rank_idx)
                await db.users.update_one(
                    {"_id": u["_id"]},
                    {"$set": {
                        "seed_target_rp": rp_target,
                        "seed_target_matches": t_m,
                        "seed_target_kills": t_k,
                        "seed_target_deaths": t_d,
                        "seed_target_wins": t_w,
                        "seed_career_v2": True,
                        "seed_climb_offset": round(random.uniform(0.0, 0.08), 4),
                        "seed_climb_speed": round(random.uniform(1.35, 2.4), 4),
                    }},
                )

            # v2 re-snap pass: any seeded doc whose `seed_target_rp` was
            # set by the first migration (or a pre-v2 `_build_and_insert`)
            # might carry an un-snapped RP (e.g., 2578 instead of 2580)
            # and stat targets that don't match the ranked RP curve
            # (e.g., wins < ceil(rp/30) — mathematically impossible).
            # Re-snap RP to the match grid and rebuild stat targets via
            # `_synthesize_career`. Marked complete with
            # `seed_career_v2: True` so this pass is a true one-shot per
            # doc. Only re-snaps if RP is off-grid OR wins is below the
            # arithmetic minimum, so docs that already happened to be
            # consistent skip cleanly.
            v2_cursor = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": True},
                 "seed_career_v2": {"$exists": False}},
                {"_id": 1, "seed_target_rp": 1, "seed_target_wins": 1},
            )
            async for u in v2_cursor:
                rp_old = int(u.get("seed_target_rp", 0) or 0)
                w_old = int(u.get("seed_target_wins", 0) or 0)
                rp_new = _snap_rp_to_match_grid(rp_old)
                min_wins = max(1, (rp_new + 29) // 30) if rp_new > 0 else 0
                needs_fix = (rp_new != rp_old) or (w_old < min_wins)
                if not needs_fix:
                    await db.users.update_one(
                        {"_id": u["_id"]},
                        {"$set": {"seed_career_v2": True}},
                    )
                    continue
                if rp_new <= 0:
                    await db.users.update_one(
                        {"_id": u["_id"]},
                        {"$set": {"seed_target_rp": 0, "seed_career_v2": True}},
                    )
                    continue
                rank_idx, _ = rank_for_points(rp_new)
                t_m, t_k, t_d, t_w = _synthesize_career(rp_new, rank_idx)
                await db.users.update_one(
                    {"_id": u["_id"]},
                    {"$set": {
                        "seed_target_rp": rp_new,
                        "seed_target_matches": t_m,
                        "seed_target_kills": t_k,
                        "seed_target_deaths": t_d,
                        "seed_target_wins": t_w,
                        "seed_career_v2": True,
                    }},
                )

            # v3 migration — climb-speed boost + top-heavy re-rank. Two
            # goals per user request:
            #   1) Existing seeded bots climb the ladder FASTER (bump
            #      their `seed_climb_speed` into the new 1.35..2.4 band
            #      and tighten the offset so they start sooner).
            #   2) The leaderboard skews DIAMOND+ — promote ~55% of the
            #      Bronze/Silver/Gold seeded bots into Diamond..Goonmaster
            #      by re-targeting their `seed_target_rp` (and stat
            #      totals) to the higher-tier RP windows.
            # Marked complete per doc with `seed_v3_boost: True` so this
            # migration is a strict one-shot. Runs before the lerp so
            # updated targets take effect on the same tick.
            v3_cursor = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": True},
                 "seed_v3_boost": {"$exists": False}},
                {"_id": 1, "seed_target_rp": 1},
            )
            # Windows mirror the seed endpoint's Diamond..Goonmaster
            # buckets so promoted bots blend in with newly-seeded ones.
            _V3_HIGH_TARGETS = [
                (820, 1190),   # Diamond
                (1220, 1690),  # Master
                (1720, 2290),  # Grandmaster
                (2300, 3200),  # Goonmaster
            ]
            # Diamond+ weights match the new bucket weights (28/22/14/6).
            _V3_HIGH_WEIGHTS = [28, 22, 14, 6]
            async for u in v3_cursor:
                rp_cur = int(u.get("seed_target_rp", 0) or 0)
                update = {
                    "seed_v3_boost": True,
                    "seed_climb_offset": round(random.uniform(0.0, 0.08), 4),
                    "seed_climb_speed": round(random.uniform(1.35, 2.4), 4),
                }
                # Promote ~55% of Bronze/Silver/Gold (rp <= 490) up to a
                # Diamond+ tier so the top of the leaderboard fills in.
                if rp_cur <= 490 and random.random() < 0.55:
                    lo, hi = random.choices(_V3_HIGH_TARGETS, weights=_V3_HIGH_WEIGHTS, k=1)[0]
                    rp_new = _snap_rp_to_match_grid(random.randint(lo, hi))
                    rank_idx, _ = rank_for_points(rp_new)
                    t_m, t_k, t_d, t_w = _synthesize_career(rp_new, rank_idx)
                    update.update({
                        "seed_target_rp": rp_new,
                        "seed_target_matches": t_m,
                        "seed_target_kills": t_k,
                        "seed_target_deaths": t_d,
                        "seed_target_wins": t_w,
                    })
                await db.users.update_one({"_id": u["_id"]}, {"$set": update})

            # v4 migration — Goonmaster-heavy end-of-season leaderboard.
            # Per user request, "most of the leaderboard [should] be
            # Goonmaster by the last week of the season". Promote ~65%
            # of every seeded bot NOT already targeting Goonmaster
            # (seed_target_rp < 2300) directly into a Goonmaster window
            # (2300..3200 RP). One-shot per doc via `seed_v4_gm: True`.
            v4_cursor = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": True},
                 "seed_v4_gm": {"$exists": False}},
                {"_id": 1, "seed_target_rp": 1},
            )
            async for u in v4_cursor:
                rp_cur = int(u.get("seed_target_rp", 0) or 0)
                update = {"seed_v4_gm": True}
                if rp_cur < 2300 and random.random() < 0.65:
                    rp_new = _snap_rp_to_match_grid(random.randint(2300, 3200))
                    rank_idx, _ = rank_for_points(rp_new)
                    t_m, t_k, t_d, t_w = _synthesize_career(rp_new, rank_idx)
                    update.update({
                        "seed_target_rp": rp_new,
                        "seed_target_matches": t_m,
                        "seed_target_kills": t_k,
                        "seed_target_deaths": t_d,
                        "seed_target_wins": t_w,
                    })
                await db.users.update_one({"_id": u["_id"]}, {"$set": update})

            # v5 migration — ALL seeded bots converge on Goonmaster by
            # end of season. v4 only promoted ~65% of non-GM seeds; v5
            # closes the loop and lifts EVERY remaining seed whose
            # target is still below 2400 (Goonmaster floor) into the
            # 2400..3000 range. Also widens `seed_climb_offset` to the
            # new 0..0.20 band so the ladder looks like a full mix of
            # tiers mid-season instead of everyone bunched at the top
            # from week one. One-shot per doc via `seed_v5_all_gm:
            # True`. Idempotent — re-running does nothing to already
            # v5-migrated docs.
            v5_cursor = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": True},
                 "seed_v5_all_gm": {"$exists": False}},
                {"_id": 1, "seed_target_rp": 1, "seed_climb_offset": 1},
            )
            # Goonmaster starts at 2400; anchor targets in 2400..3000
            # (a bit above the floor so top slots don't tie exactly).
            GOONMASTER_FLOOR = 2400
            async for u in v5_cursor:
                rp_cur = int(u.get("seed_target_rp", 0) or 0)
                update = {"seed_v5_all_gm": True}
                # Widen offset for a more organic staggered climb (some
                # bots start climbing later, filling lower tiers early
                # season). ONLY WIDENS (never narrows) so already-
                # organic offsets stay put.
                cur_off = float(u.get("seed_climb_offset", 0.0) or 0.0)
                if cur_off < 0.08:
                    # Redistribute across the new [0, 0.20] band so
                    # early-season the board isn't top-loaded.
                    update["seed_climb_offset"] = round(random.uniform(0.0, 0.20), 4)
                # Force target into Goonmaster range for anyone not
                # already there. Don't touch bots already targeting
                # GM — they're fine.
                if rp_cur < GOONMASTER_FLOOR:
                    rp_new = _snap_rp_to_match_grid(random.randint(2400, 3000))
                    rank_idx, _ = rank_for_points(rp_new)
                    t_m, t_k, t_d, t_w = _synthesize_career(rp_new, rank_idx)
                    update.update({
                        "seed_target_rp": rp_new,
                        "seed_target_matches": t_m,
                        "seed_target_kills": t_k,
                        "seed_target_deaths": t_d,
                        "seed_target_wins": t_w,
                    })
                await db.users.update_one({"_id": u["_id"]}, {"$set": update})

            # v6 migration — climb-speed boost + higher target ceiling
            # + level 10..25 pin. Three goals per user request:
            #   1) Existing seeded bots climb FASTER (bump
            #      `seed_climb_speed` into the new 2.5..4.0 band).
            #   2) Existing seeded bots go HIGHER (push any target below
            #      3000 RP into the 2600..3800 band so the top of the
            #      board has real spread within Goonmaster).
            #   3) Every seeded bot's displayed level lands in [10, 25]
            #      by injecting `stats.bonus_xp` (level derives from
            #      k*10 + w*50 + m*25 + bonus_xp — pinning bonus_xp to
            #      the level's XP threshold parks the display level in
            #      the target range even while stats lerp during climb).
            # One-shot per doc via `seed_v6_boost: True`.
            v6_cursor = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": True},
                 "seed_v6_boost": {"$exists": False}},
                {"_id": 1, "seed_target_rp": 1, "seed_climb_speed": 1,
                 "stats": 1},
            )
            async for u in v6_cursor:
                rp_cur = int(u.get("seed_target_rp", 0) or 0)
                cur_speed = float(u.get("seed_climb_speed", 1.0) or 1.0)
                update = {"seed_v6_boost": True}
                # Bump climb speed — only widen upward so bots already
                # in the new band stay put. Lower band = 2.5, upper = 4.0.
                if cur_speed < 2.5:
                    update["seed_climb_speed"] = round(random.uniform(2.5, 4.0), 4)
                # Push targets below 3000 up into the 2600..3800 band so
                # the ceiling meaningfully rises. Bots already >= 3000
                # stay put (they're at the top tail already).
                if rp_cur < 3000:
                    rp_new = _snap_rp_to_match_grid(random.randint(2600, 3800))
                    rank_idx, _ = rank_for_points(rp_new)
                    t_m, t_k, t_d, t_w = _synthesize_career(rp_new, rank_idx)
                    update.update({
                        "seed_target_rp": rp_new,
                        "seed_target_matches": t_m,
                        "seed_target_kills": t_k,
                        "seed_target_deaths": t_d,
                        "seed_target_wins": t_w,
                    })
                # Level 10..22 pin via bonus_xp (natural stats climb adds
                # up to ~2-3 levels on top, keeping display within 10..25).
                existing_bonus = int((u.get("stats") or {}).get("bonus_xp", 0) or 0)
                if existing_bonus == 0:
                    target_level = random.randint(10, 22)
                    update["stats.bonus_xp"] = xp_threshold_for_level(target_level)
                await db.users.update_one({"_id": u["_id"]}, {"$set": update})

            # v7 migration — VOLATILITY. Give every seeded bot a
            # per-bot sine profile so their RP swings up and down over
            # the season instead of climbing monotonically. Amplitude
            # (`seed_volatility`) is 0.03..0.10 of their climb range;
            # two harmonics with random frequencies + phases keep the
            # pattern non-repetitive. One-shot per doc (guarded by
            # `seed_v7_volatility`).
            v7_cursor = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": True},
                 "seed_v7_volatility": {"$exists": False}},
                {"_id": 1},
            )
            async for u in v7_cursor:
                await db.users.update_one(
                    {"_id": u["_id"]},
                    {"$set": {
                        "seed_v7_volatility": True,
                        # 3-10% of the climb range as swing amplitude —
                        # most bots swing enough to lose then gain back
                        # a division, top bots swing wider.
                        "seed_volatility": round(random.uniform(0.03, 0.10), 4),
                        # Frequencies expressed in "cycles per season".
                        # 4-8 slow cycles + 9-15 fast cycles = organic.
                        "seed_vol_freq_a": round(random.uniform(4.0, 8.0), 3),
                        "seed_vol_freq_b": round(random.uniform(9.0, 15.0), 3),
                        # Random phase per harmonic so bots don't all
                        # dip at the same moment.
                        "seed_vol_phase_a": round(random.uniform(0, 6.2832), 4),
                        "seed_vol_phase_b": round(random.uniform(0, 6.2832), 4),
                    }},
                )

            doc = await get_or_init_season()
            start = doc.get("season_start")
            if isinstance(start, datetime) and start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if start is None:
                await asyncio.sleep(30.0); continue
            now = datetime.now(timezone.utc)
            elapsed = (now - start).total_seconds()
            total = max(1.0, SEASON_LENGTH_DAYS * 86400.0)
            frac = max(0.0, min(1.0, elapsed / total))

            cursor = db.users.find(
                {"is_seeded": True, "seed_target_rp": {"$exists": True}},
                {
                    "_id": 1, "rank_points": 1,
                    "seed_target_rp": 1, "seed_target_matches": 1,
                    "seed_target_kills": 1, "seed_target_deaths": 1,
                    "seed_target_wins": 1,
                    "seed_climb_offset": 1, "seed_climb_speed": 1,
                    "seed_start_rp": 1,
                    "peak_rank_points": 1,
                    # v7 volatility fields — added so each bot swings up
                    # and down on top of the base lerp. See migration
                    # block below (`seed_v7_volatility`).
                    "seed_volatility": 1,
                    "seed_vol_freq_a": 1, "seed_vol_freq_b": 1,
                    "seed_vol_phase_a": 1, "seed_vol_phase_b": 1,
                },
            )
            async for u in cursor:
                offset = float(u.get("seed_climb_offset", 0.0) or 0.0)
                speed = float(u.get("seed_climb_speed", 1.0) or 1.0)
                p = max(0.0, min(1.0, (frac - offset) * speed))
                t_rp = int(u.get("seed_target_rp", 0) or 0)
                t_m = int(u.get("seed_target_matches", 0) or 0)
                t_k = int(u.get("seed_target_kills", 0) or 0)
                t_d = int(u.get("seed_target_deaths", 0) or 0)
                t_w = int(u.get("seed_target_wins", 0) or 0)
                # Season-start baseline (0 for legacy seeded bots that
                # pre-date `seed_start_rp` — they behave as before). Set
                # by `maybe_reset_season` at rollover so every seeded bot
                # begins the new season at their rolled-back RP instead
                # of the leaderboard-emptying `rank_points = 0` behaviour
                # of the pre-`seed_start_rp` code.
                start_rp = int(u.get("seed_start_rp", 0) or 0)
                # Lerp from `start_rp` → `t_rp` over the season. RP is
                # snapped to the ranked match grid (multiples of 15) so
                # every snapshot value is reachable via real matchplay.
                if t_rp <= start_rp:
                    # Rollback already exceeded the target (edge case) —
                    # freeze at start_rp so the leaderboard doesn't
                    # oscillate.
                    base_rp = start_rp
                else:
                    base_rp = int(round(start_rp + (t_rp - start_rp) * p))
                # ─── Volatility jitter (v7) ─────────────────────────────
                # On top of the smooth base climb, each bot rides a
                # two-harmonic sine wave so their RP visibly dips + gains
                # over the season instead of ratcheting upward. Amplitude
                # scales with the bot's `seed_volatility` (0..1, ~0.03-
                # 0.10 typical) and with the base climb range so a
                # small-climb bot swings less absolute RP than a big
                # climber. Two sine terms at prime-ish periods keep the
                # pattern non-repetitive over a season.
                vol = float(u.get("seed_volatility", 0.0) or 0.0)
                if vol > 0.0 and frac > 0.0:
                    fa = float(u.get("seed_vol_freq_a", 6.0) or 6.0)
                    fb = float(u.get("seed_vol_freq_b", 11.0) or 11.0)
                    pa = float(u.get("seed_vol_phase_a", 0.0) or 0.0)
                    pb = float(u.get("seed_vol_phase_b", 0.0) or 0.0)
                    # Amplitude in absolute RP: percentage of the total
                    # climb range (min 60 RP so even short-climb bots
                    # visibly move). Kept modest so peak/rank tier
                    # doesn't yo-yo — just a division or two.
                    climb_range = max(60, t_rp - start_rp)
                    amp = vol * climb_range
                    # Composite wave: two-thirds first harmonic + one-
                    # third faster harmonic → looks organic, not sine-y.
                    wave = (
                        (2.0 / 3.0) * math.sin(fa * frac * math.pi * 2 + pa)
                        + (1.0 / 3.0) * math.sin(fb * frac * math.pi * 2 + pb)
                    )
                    base_rp = base_rp + int(round(amp * wave))
                    # Never dip below the season-start floor (a bot that
                    # begins Bronze IV shouldn't sink into unranked
                    # territory) or above the target ceiling by more than
                    # a small overshoot buffer.
                    floor_rp = max(0, start_rp - int(amp * 0.5))
                    ceil_rp = t_rp + int(amp * 0.3)
                    base_rp = max(floor_rp, min(ceil_rp, base_rp))
                new_rp = _snap_rp_to_match_grid(base_rp)
                new_m = int(round(t_m * p))
                new_k = int(round(t_k * p))
                new_d = int(round(t_d * p))
                new_w = int(round(t_w * p))
                # Floor wins at ceil(rp/30) so the in-progress climb
                # also obeys the "can't have less wins than the
                # best-case path to this RP" rule that
                # `_synthesize_career` enforces at the target.
                min_wins_now = max(0, (new_rp + 29) // 30)
                if new_w < min_wins_now:
                    new_w = min_wins_now
                if new_m < new_w:
                    new_m = new_w
                placement = PLACEMENT_MATCHES if new_m >= PLACEMENT_MATCHES else new_m
                cur_rp = int(u.get("rank_points", 0) or 0)
                cur_peak = int(u.get("peak_rank_points", 0) or 0)
                # Skip writes only when NOTHING meaningful changed — RP
                # is stable AND peak is already at the target. Without
                # the peak check, a bot that already reached its target
                # RP would never get peak stamped.
                if new_rp == cur_rp and cur_peak >= t_rp and p > 0.0:
                    continue
                # Peak rank tracks the highest RP the bot has actually
                # reached — with the v7 volatility jitter a bot may
                # spike above its base-lerp target temporarily, and we
                # want that spike immortalised on their peak card. So
                # stamp peak whenever the current RP exceeds the stored
                # peak, in addition to the "climbing toward target"
                # initial write.
                update = {
                    "rank_points": new_rp,
                    "placement_matches_played": placement,
                    "stats.matches": new_m,
                    "stats.kills": new_k,
                    "stats.deaths": new_d,
                    "stats.wins": new_w,
                }
                new_peak = max(cur_peak, t_rp, new_rp)
                if new_peak > cur_peak:
                    peak_idx, peak_name = rank_for_points(new_peak)
                    update["peak_rank_points"] = new_peak
                    update["peak_rank_tier"] = int(peak_idx)
                    update["peak_rank_name"] = peak_name
                    update["peak_rank_division"] = rank_division_for_points(new_peak, peak_idx)
                await db.users.update_one(
                    {"_id": u["_id"]},
                    {"$set": update},
                )
        except Exception as e:
            logger.warning("seeded_climb_loop error: %s", e)
        await asyncio.sleep(45.0)


@api.get("/season")
async def season_status():
    doc = await maybe_reset_season()
    return season_payload(doc)


RANKED_MIN_LEVEL = 5


async def _party_for_user(user_id: str) -> Optional[dict]:
    """Look up the user's current party (if any). Returns the party dict
    from PARTIES or None. Wraps PARTY_MEMBER_INDEX for callers that don't
    need to import the global directly.

    Defensive resync: if PARTY_MEMBER_INDEX has no entry for this user
    but a PARTY somewhere lists them in its members, that's a desync
    (rare, but has been reported as party panel flashing off) — repair
    the index on the fly and return the found party. Cheap because
    PARTIES is small (server-wide there are only ever a few live
    parties at once)."""
    pid = PARTY_MEMBER_INDEX.get(user_id)
    if pid and pid in PARTIES:
        # Additional safety: the party might have been created but the
        # user removed from its members list somewhere. If so, the
        # index is stale — clear it and fall through to the scan.
        if user_id in PARTIES[pid].get("members", []):
            return PARTIES[pid]
        PARTY_MEMBER_INDEX.pop(user_id, None)
    # Slow-path scan (only reached on desync). Whichever party actually
    # lists the user wins — repair the index and return it.
    for candidate_pid, party in PARTIES.items():
        if user_id in party.get("members", []):
            PARTY_MEMBER_INDEX[user_id] = candidate_pid
            return party
    return None


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
    # Leave-penalty gate. If this user (or any party-mate when partied)
    # has a `ranked_ban_until` in the future, surface a 403 with the
    # remaining seconds so the client can render a countdown like
    # "RANKED LOCKED — 7:42". Solo first; party check happens below.
    me_ban = user.get("ranked_ban_until")
    if isinstance(me_ban, datetime):
        if me_ban.tzinfo is None:
            me_ban = me_ban.replace(tzinfo=timezone.utc)
        remaining = int((me_ban - datetime.now(timezone.utc)).total_seconds())
        if remaining > 0:
            raise HTTPException(
                status_code=403,
                detail=f"Ranked locked for {remaining}s (left a previous ranked match).",
                headers={"X-Ranked-Ban-Seconds": str(remaining)},
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
            mdoc = await db.users.find_one({"_id": ObjectId(uid)}, {"stats": 1, "username": 1, "ranked_ban_until": 1})
            mlvl = compute_level((mdoc or {}).get("stats", {}))["level"]
            if mlvl < RANKED_MIN_LEVEL:
                raise HTTPException(
                    status_code=403,
                    detail=f"Party member {(mdoc or {}).get('username', '?')} is Level {mlvl} (Ranked needs L{RANKED_MIN_LEVEL}).",
                )
            # Mirror the solo-ban gate above for each party member —
            # one banned alt locks the whole party out for the
            # remaining window. Avoids the obvious exploit of a
            # banned player just party-queuing with a friend.
            mban = (mdoc or {}).get("ranked_ban_until")
            if isinstance(mban, datetime):
                if mban.tzinfo is None:
                    mban = mban.replace(tzinfo=timezone.utc)
                remaining = int((mban - datetime.now(timezone.utc)).total_seconds())
                if remaining > 0:
                    raise HTTPException(
                        status_code=403,
                        detail=f"Party member {(mdoc or {}).get('username','?')} is locked from Ranked for {remaining}s.",
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
        # Sweep stale `matched` flags before checking. If the ack never
        # fired (client crash, tab close, ws error) MATCHED_USERS lingers
        # and would spuriously short-circuit this join with a stale
        # "match found". Anything older than 60s is definitely stale —
        # legitimate matches consume the flag on ws connect (<5s) and
        # the ranked ack pops it (<2s). 60s is a generous safety window.
        for mid in list(member_ids):
            m = MATCHED_USERS.get(mid)
            if m and (now_ts - float(m.get("matched_at", 0.0))) > 60.0:
                MATCHED_USERS.pop(mid, None)
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
    # Acquire QUEUE_LOCK for the read as well — otherwise the client
    # can catch the matchmaking loop mid-pairing (queue entry removed,
    # MATCHED_USERS not yet set) and get a spurious `in_queue: false`
    # even though the player is very much matched a millisecond later.
    # That race trips the client's miss-counter teardown, which is
    # exactly the "timer keeps disappearing" symptom the user reported.
    async with QUEUE_LOCK:
        # Same 60s stale-flag sweep as POST /queue/ranked. Without this the
        # background poll would report `matched: true` on every tick from a
        # dead ack, causing the queue toast to flicker + spontaneous
        # "match found" pops after returning to the lobby.
        m = MATCHED_USERS.get(user_id)
        if m and (now_ts - float(m.get("matched_at", 0.0))) > 60.0:
            MATCHED_USERS.pop(user_id, None)
            m = None
        if m:
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


@api.post("/queue/casual")
async def queue_casual_join(user: dict = Depends(get_current_user)):
    """Enqueue the caller for casual matchmaking. Single FIFO queue
    (no rank tiers). Matched head-to-head when another entry exists,
    otherwise bot-filled after CASUAL_BOT_FILL_SEC (10s).

    If the caller is in a party, the whole party is enqueued as a
    single multi-user entry (mirroring the party-ranked flow). Only
    the party leader may queue; non-leaders get a 403 explaining why.

    Returns an `estimated_wait_seconds` sampled inside the
    3-12s window so the client can pin a stable "Est. wait ~Xs" pill
    on the queue toast. The value re-rolls per join, but the client's
    lockedEtaRef preserves it for the lifetime of the queue session so
    the number doesn't tick down/jump around every second."""
    user_id = str(user["_id"])
    party = await _party_for_user(user_id)
    is_party = bool(party)
    if is_party and party.get("leader_id") != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the party leader can queue Quick Match.",
        )
    if is_party:
        member_ids = list(party["members"])
        usernames: List[str] = []
        for uid in member_ids:
            mdoc = await db.users.find_one({"_id": ObjectId(uid)}, {"username": 1})
            usernames.append((mdoc or {}).get("username", "?"))
    else:
        member_ids = [user_id]
        usernames = [user.get("username", "?")]
    async with QUEUE_LOCK:
        # Yank any existing casual entries for every party member so a
        # stale solo entry can't co-exist with the party entry.
        for uid in member_ids:
            _remove_user_from_casual_queue(uid)
            MATCHED_USERS.pop(uid, None)
        eta = random.uniform(3.0, 12.0)
        CASUAL_QUEUE.append({
            "user_id": user_id,
            "user_ids": member_ids,
            "username": user.get("username", "?"),
            "usernames": usernames,
            "joined_at": time.time(),
            "estimated_wait_seconds": int(round(eta)),
            "is_party": is_party,
            "party_id": (party or {}).get("party_id") if is_party else None,
        })
    return {
        "ok": True,
        "bot_fill_seconds": int(CASUAL_BOT_FILL_SEC),
        "estimated_wait_seconds": int(round(eta)),
        "queue_size": len(CASUAL_QUEUE),
        "is_party": is_party,
        "party_size": len(member_ids),
    }


@api.get("/queue/casual")
async def queue_casual_state(user: dict = Depends(get_current_user)):
    """Poll the caller's casual queue state. Mirrors the ranked GET:
    returns wait seconds, queue-position estimate, and (when matched)
    a `matched: true` flag with `vs_bot` so the client knows whether
    to route into the shared casual room or a private bot room."""
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        match = MATCHED_USERS.get(user_id)
        if match and match.get("casual"):
            return {
                "in_queue": False,
                "matched": True,
                "match_id": match["match_id"],
                "vs_bot": bool(match.get("vs_bot", False)),
                "room_key": match.get("room_key"),
                "tdm": bool(match.get("tdm", False)),
                "bot_fill_seconds": int(CASUAL_BOT_FILL_SEC),
            }
        for idx, e in enumerate(CASUAL_QUEUE):
            uids = e.get("user_ids") or ([e.get("user_id")] if e.get("user_id") else [])
            if user_id in uids:
                return {
                    "in_queue": True,
                    "matched": False,
                    "wait_seconds": int(time.time() - e["joined_at"]),
                    "queue_position": idx + 1,
                    "queue_size": len(CASUAL_QUEUE),
                    "bot_fill_seconds": int(CASUAL_BOT_FILL_SEC),
                    # Stable ETA sampled at join — see /queue/casual POST.
                    # The client also has an ETA lock that ignores server
                    # variance across polls; this ensures the first poll
                    # already carries the snapshot.
                    "estimated_wait_seconds": int(e.get("estimated_wait_seconds", int(CASUAL_BOT_FILL_SEC))),
                }
        return {"in_queue": False, "matched": False, "queue_size": len(CASUAL_QUEUE)}


@api.delete("/queue/casual")
async def queue_casual_leave(user: dict = Depends(get_current_user)):
    """Leave the casual queue and clear any stale matched flag. When
    the caller was queued as part of a party, `_remove_user_from_casual_queue`
    yanks the whole multi-user entry — mirror that here by scrubbing
    every party-mate's `MATCHED_USERS` too so nobody ends up half-matched."""
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        removed = _remove_user_from_casual_queue(user_id)
        MATCHED_USERS.pop(user_id, None)
        if removed:
            for uid in (removed.get("user_ids") or []):
                MATCHED_USERS.pop(uid, None)
    return {"ok": True}


def _remove_user_from_casual_queue(user_id: str) -> Optional[dict]:
    """Yank the caller's entry from CASUAL_QUEUE (caller must hold
    QUEUE_LOCK). Returns the removed entry so callers can mirror any
    multi-user cleanup if we ever support party casual queueing."""
    removed: Optional[dict] = None
    keep: List[dict] = []
    for e in CASUAL_QUEUE:
        uids = e.get("user_ids") or ([e.get("user_id")] if e.get("user_id") else [])
        if user_id in uids:
            if removed is None:
                removed = e
            continue
        keep.append(e)
    CASUAL_QUEUE[:] = keep
    return removed


def _remove_user_from_bigffa_queue(user_id: str) -> Optional[dict]:
    """Same shape as _remove_user_from_casual_queue but for BIGFFA_QUEUE."""
    removed: Optional[dict] = None
    keep: List[dict] = []
    for e in BIGFFA_QUEUE:
        uids = e.get("user_ids") or ([e.get("user_id")] if e.get("user_id") else [])
        if user_id in uids:
            if removed is None:
                removed = e
            continue
        keep.append(e)
    BIGFFA_QUEUE[:] = keep
    return removed


# BigFFA queue endpoints — mirror the casual queue's shape so the client
# can reuse its poll/cancel/ETA-lock plumbing. Doesn't touch CASUAL_QUEUE
# or the ranked queue; dispatches everyone in the queue into `bigffa_room`
# once the target size hits 12 or the 12s hold timer elapses.
@api.post("/queue/bigffa")
async def queue_bigffa_join(user: dict = Depends(get_current_user)):
    """Enqueue the caller for a 12-player FFA lobby. Solo-only (parties
    should use their own party lobby). Yanks any existing casual/bigffa
    entry so a player can only be in one queue at a time."""
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        _remove_user_from_casual_queue(user_id)
        _remove_user_from_bigffa_queue(user_id)
        MATCHED_USERS.pop(user_id, None)
        eta = random.uniform(BIGFFA_ETA_MIN_SEC, BIGFFA_ETA_MAX_SEC)
        BIGFFA_QUEUE.append({
            "user_id": user_id,
            "user_ids": [user_id],
            "username": user.get("username", "?"),
            "usernames": [user.get("username", "?")],
            "joined_at": time.time(),
            "estimated_wait_seconds": int(round(eta)),
        })
    return {
        "ok": True,
        "bot_fill_seconds": int(BIGFFA_BOT_FILL_SEC),
        "estimated_wait_seconds": int(round(eta)),
        "queue_size": len(BIGFFA_QUEUE),
    }


@api.get("/queue/bigffa")
async def queue_bigffa_state(user: dict = Depends(get_current_user)):
    """Poll BigFFA queue state — mirrors /queue/casual GET so the client's
    queue polling code can be reused verbatim. `matched: true` carries a
    `bigffa: true` marker so the client routes to /play?mode=bigffa
    instead of the casual room."""
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        match = MATCHED_USERS.get(user_id)
        if match and match.get("bigffa"):
            return {
                "in_queue": False,
                "matched": True,
                "match_id": match["match_id"],
                "bigffa": True,
                "bot_fill_seconds": int(BIGFFA_BOT_FILL_SEC),
            }
        for idx, e in enumerate(BIGFFA_QUEUE):
            uids = e.get("user_ids") or ([e.get("user_id")] if e.get("user_id") else [])
            if user_id in uids:
                return {
                    "in_queue": True,
                    "matched": False,
                    "wait_seconds": int(time.time() - e["joined_at"]),
                    "queue_position": idx + 1,
                    "queue_size": len(BIGFFA_QUEUE),
                    "bot_fill_seconds": int(BIGFFA_BOT_FILL_SEC),
                    "estimated_wait_seconds": int(e.get("estimated_wait_seconds", int(BIGFFA_BOT_FILL_SEC))),
                }
        return {"in_queue": False, "matched": False, "queue_size": len(BIGFFA_QUEUE)}


@api.delete("/queue/bigffa")
async def queue_bigffa_leave(user: dict = Depends(get_current_user)):
    """Leave the BigFFA queue and clear any stale matched flag."""
    user_id = str(user["_id"])
    async with QUEUE_LOCK:
        _remove_user_from_bigffa_queue(user_id)
        # Only nuke MATCHED_USERS if this was a bigffa match — leaving
        # this queue must never accidentally cancel a casual/ranked match
        # that just resolved.
        m = MATCHED_USERS.get(user_id)
        if m and m.get("bigffa"):
            MATCHED_USERS.pop(user_id, None)
    return {"ok": True}


@api.get("/queue/bigffa/status")
async def queue_bigffa_status(user: dict = Depends(get_current_user)):
    """Live real-player count in `bigffa_room`. Used by the lobby
    countdown to show "X PLAYER(S) FOUND" — excludes the caller so the
    number reads as 'other humans present'."""
    user_id = str(user["_id"])
    real_count = 0
    for p in bigffa_room.players.values():
        if p.is_bot or getattr(p, "is_spectator", False):
            continue
        if p.user_id and str(p.user_id) == user_id:
            continue
        real_count += 1
    return {"real_players": real_count, "total_players": len(bigffa_room.players)}


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


async def _party_payload(party_id: str, *, for_user_id: Optional[str] = None) -> dict:
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
    # Per-user match_starting mask. A member who exited the current
    # Custom Lobby via /api/party/leave-match is added to `match_optout`
    # so the poll reports match_starting=False FOR THAT USER ONLY —
    # otherwise PartyPanel's useEffect immediately re-navigates them
    # back into /play, producing the "leave match just brings you back
    # into game" bug. The rest of the party (still in the match) sees
    # match_starting unchanged. Cleared on the next /party/start so a
    # future custom lobby CAN pull the opted-out member back in.
    match_starting = bool(p.get("match_starting", False))
    optout = p.get("match_optout") or set()
    if for_user_id and for_user_id in optout:
        match_starting = False
    return {
        "party_id": party_id,
        "leader_id": p["leader_id"],
        "members": members,
        "match_starting": match_starting,
        # Custom Lobby settings so members see what the leader picked
        # before they auto-navigate. Defaults preserve legacy behaviour
        # (bots on, FFA).
        "bots_enabled": bool(p.get("bots_enabled", True)),
        "tdm": bool(p.get("tdm", False)),
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

# ─── Peak online tracking ────────────────────────────────────────────
# Admin moderation dashboard exposes the all-time peak concurrent real
# online count (in-match WS + lobby heartbeat) so admins can see the
# high-water mark at a glance. Stamped every time `count_real_online`
# is called from the live-stats endpoint. `at` is an ISO timestamp of
# when the peak was hit — helpful for correlating with news posts or
# tournament windows. Kept in memory; a server restart resets it, but
# that's fine for a live-monitoring signal (persistent history is
# already captured via the seed-migration audit logs).
PEAK_ONLINE: Dict[str, Any] = {"value": 0, "at": None}


def count_real_online() -> int:
    """Total unique users currently online — WS-connected (in-match)
    OR lobby-heartbeated within the last `HEARTBEAT_TTL` seconds.
    Also side-effects the `PEAK_ONLINE` high-water mark so the admin
    dashboard's peak-players tile stays accurate. Kept as a single
    helper so admin `/api/admin/live-stats`, friend-card `is_online`
    lookups, and any future public "players online" widget all read
    the same numbers.
    """
    now = time.time()
    # Union of the two sources — a user in-match doesn't need a
    # heartbeat, and a lobby user doesn't have a WS connection.
    unique: set = set(ONLINE_USERS.keys())
    for uid, ts in list(PRESENCE_HEARTBEAT.items()):
        if (now - ts) <= HEARTBEAT_TTL:
            unique.add(uid)
        else:
            # Opportunistic GC of stale heartbeats. Cheap and keeps
            # the dict from growing unbounded across a long uptime.
            PRESENCE_HEARTBEAT.pop(uid, None)
    total = len(unique)
    if total > int(PEAK_ONLINE.get("value") or 0):
        PEAK_ONLINE["value"] = total
        PEAK_ONLINE["at"] = datetime.now(timezone.utc).isoformat()
    return total


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
    t_div = rank_division_for_points(pts, t_idx)
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
        # Division within the tier (0=IV, 3=I). Needed by the friends
        # list's AnimatedRankIcon + rank pill so friends render with
        # the same "GOLD III" precision as the leaderboard.
        "rank_division": t_div,
        # Leaderboard position — only present for top-50 GOONMASTERs
        # (Ultimate Gooner cache). Friend rows show a "#N" gold chip
        # when this is set so ladder-visible friends stand out.
        "leaderboard_rank": TOP50_GOONER_IDS.get(uid),
        "level": lvl["level"],
        "banner_icon": int(u.get("banner_icon", 0) or 0),
        "banner_color": int(u.get("banner_color", 0) or 0),
        "banner_animated": bool(u.get("banner_animated", False)),
        "online": is_online(uid),
        "in_match": loc is not None and loc.get("kind") in ("casual", "bigffa", "ranked", "party", "offline"),
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


# ---- Whispers (1:1 friend DMs) ------------------------------------------
# Schema (`whispers` collection):
#   { _id, from_id, to_id, text, ts: datetime, read_by_recipient: bool }
# Sorted by `ts`. We keep the index list tight — one composite for
# pulling a conversation in either direction and one for unread counts.
_WHISPER_INDEXES_READY = False


async def _ensure_whisper_indexes():
    global _WHISPER_INDEXES_READY
    if _WHISPER_INDEXES_READY:
        return
    # Conversation lookup: server queries `{from_id: $in [A,B], to_id: $in [A,B]}`
    # → ts ascending. Composite index on (from_id, to_id, ts) covers it.
    await db.whispers.create_index([("from_id", 1), ("to_id", 1), ("ts", 1)])
    # Per-recipient unread count: index on (to_id, read_by_recipient).
    await db.whispers.create_index([("to_id", 1), ("read_by_recipient", 1)])
    _WHISPER_INDEXES_READY = True


class WhisperSendIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    text: str = Field(min_length=1, max_length=280)


async def _is_blocked_either_way(a_id: str, b_id: str) -> bool:
    """Return True if A has blocked B *or* B has blocked A. Whispers
    are bilateral so either side's block silences the channel."""
    doc = await db.friendships.find_one({
        "$or": [
            {"from_user_id": a_id, "to_user_id": b_id, "status": "blocked"},
            {"from_user_id": b_id, "to_user_id": a_id, "status": "blocked"},
        ],
    })
    return doc is not None


@api.post("/whispers/send")
async def whispers_send(payload: WhisperSendIn, user: dict = Depends(get_current_user)):
    """Send a private message to another user.

    Rules:
      - Target must exist.
      - Neither side may have the other blocked.
      - Self-whisper rejected (would clutter your own conversation
        list and serves no purpose).
      - Per-sender rate limit: max 20 sends/minute (anti-spam — friends
        still get to have a quick exchange).
    """
    await _ensure_whisper_indexes()
    me_id = str(user["_id"])
    target = await _find_user_by_username(payload.username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    to_id = str(target["_id"])
    if to_id == me_id:
        raise HTTPException(status_code=400, detail="Cannot whisper yourself")
    if await _is_blocked_either_way(me_id, to_id):
        raise HTTPException(status_code=403, detail="Whispers blocked between you two")
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
    recent = await db.whispers.count_documents({"from_id": me_id, "ts": {"$gte": cutoff}})
    if recent >= 20:
        raise HTTPException(status_code=429, detail="Slow down — too many whispers")
    doc = {
        "from_id": me_id,
        "to_id": to_id,
        "text": payload.text.strip(),
        "ts": datetime.now(timezone.utc),
        "read_by_recipient": False,
    }
    res = await db.whispers.insert_one(doc)
    return {
        "id": str(res.inserted_id),
        "from_id": me_id,
        "to_id": to_id,
        "text": doc["text"],
        "ts": doc["ts"].isoformat(),
        "read_by_recipient": False,
    }


@api.get("/whispers/conversation/{username}")
async def whispers_conversation(username: str, user: dict = Depends(get_current_user), limit: int = 50):
    """Return the last N messages between me and `username`, sorted
    oldest-first so the client can append the newest at the bottom.
    Also marks any of `username`'s messages to me as read (the act of
    opening the conversation IS the read receipt — matches Discord /
    iMessage behaviour). Returns `[]` if user not found instead of
    404 so the UI can show a clean "no messages yet" empty state."""
    await _ensure_whisper_indexes()
    me_id = str(user["_id"])
    target = await _find_user_by_username(username)
    if not target:
        return {"messages": [], "friend": None}
    to_id = str(target["_id"])
    await db.whispers.update_many(
        {"from_id": to_id, "to_id": me_id, "read_by_recipient": False},
        {"$set": {"read_by_recipient": True}},
    )
    limit = max(1, min(200, int(limit)))
    cursor = db.whispers.find({
        "$or": [
            {"from_id": me_id, "to_id": to_id},
            {"from_id": to_id, "to_id": me_id},
        ],
    }).sort("ts", -1).limit(limit)
    docs = []
    async for m in cursor:
        docs.append({
            "id": str(m["_id"]),
            "from_id": m["from_id"],
            "to_id": m["to_id"],
            "from_me": m["from_id"] == me_id,
            "text": m.get("text", ""),
            "ts": m["ts"].isoformat() if isinstance(m.get("ts"), datetime) else m.get("ts"),
            "read_by_recipient": bool(m.get("read_by_recipient", False)),
        })
    docs.reverse()
    return {
        "messages": docs,
        "friend": {
            "id": to_id,
            "username": target.get("username"),
            "avatar": int(target.get("avatar", 0) or 0),
        },
    }


@api.get("/whispers/unread")
async def whispers_unread(user: dict = Depends(get_current_user)):
    """Per-sender unread counts so the friends list can show a red
    pill on rows with new messages. Returns
    `{from_id_str: count, ...}` — frontend joins by friend.id."""
    await _ensure_whisper_indexes()
    me_id = str(user["_id"])
    pipeline = [
        {"$match": {"to_id": me_id, "read_by_recipient": False}},
        {"$group": {"_id": "$from_id", "count": {"$sum": 1}}},
    ]
    out: Dict[str, int] = {}
    total = 0
    async for row in db.whispers.aggregate(pipeline):
        out[str(row["_id"])] = int(row["count"])
        total += int(row["count"])
    return {"by_sender": out, "total": total}


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


@api.post("/admin/season/reset_pass")
async def admin_reset_pass(user: dict = Depends(get_current_user)):
    """Admin-only — wipe every player's pass progression NOW without
    bumping the season number. Useful when the live season has visibly
    "drifted" and we want to put everyone back at Tier 0 immediately.

    Resets: `season_xp` → 0, `claimed_season_tiers` → []. Keeps:
    `rank_points`, `peak_rank_points`, `owned_skins` (cosmetics already
    granted stay in the inventory).

    The normal full season rollover (which also zeros RP + archives the
    leaderboard + bumps season_number) still runs automatically when
    the season timer hits zero — this endpoint is the manual "soft
    reset" for the pass alone.
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    result = await db.users.update_many(
        {},
        {"$set": {"season_xp": 0, "claimed_season_tiers": []}},
    )
    logger.info("Admin %s wiped pass progression for %d users",
                user.get("username"), result.modified_count)
    return {
        "ok": True,
        "modified": int(result.modified_count or 0),
        "matched": int(result.matched_count or 0),
    }


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


@api.get("/admin/settings/smurf")
async def admin_get_smurf_ratio(user: dict = Depends(get_current_user)):
    """Return the current casual smurf-bot ratio + difficulty.
    Admin-only. Paired with the POST endpoint below so the Moderation
    dashboard's two sliders always display the live values."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return {
        "ratio": _get_casual_elite_bot_ratio(),
        "diff": _get_casual_elite_bot_diff(),
    }


class SmurfRatioIn(BaseModel):
    # Both fields are optional so the endpoint can be called with just
    # one slider's value (partial update). Backend caller sends the
    # slider that changed; the other stays put. Ratio 0-1, diff clamped
    # to the "smart AI" band [1.5, 2.5] — below 1.5 the smurf loses
    # its "smart" behavioural upgrades (see `_tick_bots`), above 2.5
    # it out-guns full-ranked bots (1.9) which defeats the point of
    # keeping ranked distinct from casual.
    ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    diff: float | None = Field(default=None, ge=1.5, le=2.5)


@api.post("/admin/settings/smurf")
async def admin_set_smurf_ratio(payload: SmurfRatioIn, user: dict = Depends(get_current_user)):
    """Mutate the casual smurf ratio and/or difficulty at runtime.
    Admin-only. The new value takes effect on the NEXT bot fill in
    any casual room — already-spawned bots aren't retroactively
    converted (that would yank matches mid-game). Both fields are
    optional; the endpoint applies whichever ones are present, so the
    two frontend sliders can save independently. Persistence is
    process-memory only (matches PEAK_ONLINE / SYNTHETIC_ONLINE).
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    global CASUAL_ELITE_BOT_RATIO, CASUAL_ELITE_BOT_DIFF
    if payload.ratio is not None:
        _CASUAL_ELITE_BOT_STATE["ratio"] = float(payload.ratio)
        CASUAL_ELITE_BOT_RATIO = float(payload.ratio)
    if payload.diff is not None:
        _CASUAL_ELITE_BOT_STATE["diff"] = float(payload.diff)
        CASUAL_ELITE_BOT_DIFF = float(payload.diff)
    logger.info(
        "Admin %s updated smurf settings — ratio=%.3f diff=%.2f",
        user.get("username"), _get_casual_elite_bot_ratio(), _get_casual_elite_bot_diff(),
    )
    return {
        "ratio": _get_casual_elite_bot_ratio(),
        "diff": _get_casual_elite_bot_diff(),
    }


@api.get("/admin/live-stats")
async def admin_live_stats(user: dict = Depends(get_current_user)):
    """Snapshot of live player activity for the moderation dashboard.
    Admin-only. Aggregates:
      • Real online player count (from ONLINE_USERS websocket registry)
      • Displayed "players online" (the synthetic value shown in the lobby)
      • Per-room human player counts, broken out by mode (FFA vs TDM) and
        room kind (Quick Match, Ranked, Practice, Offline vs AI, Ranked-vs-bots,
        Party rooms)
      • Queue depth by mode (ranked per-tier, casual)
      • Party count
      • Mode popularity totals — the two headline numbers admins actually
        care about ("how many people are playing FFA vs TDM right now").
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")

    def _count_humans(room: "GameRoom") -> int:
        return sum(1 for p in room.players.values() if not getattr(p, "is_bot", False))

    # ── Fixed rooms ─────────────────────────────────────────────────
    qm_ffa_humans = _count_humans(game_room)
    qm_tdm_humans = _count_humans(tdm_room)
    ranked_humans = _count_humans(ranked_room)
    practice_ffa_humans = _count_humans(practice_room)
    practice_tdm_humans = _count_humans(practice_tdm_room)

    # ── Per-user rooms ──────────────────────────────────────────────
    offline_ffa_humans = 0
    offline_tdm_humans = 0
    offline_ffa_rooms = 0
    offline_tdm_rooms = 0
    for room in OFFLINE_ROOMS.values():
        h = _count_humans(room)
        if room.game_mode == "tdm":
            offline_tdm_humans += h
            offline_tdm_rooms += 1 if h > 0 else 0
        else:
            offline_ffa_humans += h
            offline_ffa_rooms += 1 if h > 0 else 0

    ranked_bot_humans = 0
    ranked_bot_rooms = 0
    for room in RANKED_BOT_ROOMS.values():
        h = _count_humans(room)
        ranked_bot_humans += h
        if h > 0:
            ranked_bot_rooms += 1

    # ── Party rooms ────────────────────────────────────────────────
    party_ffa_humans = 0
    party_tdm_humans = 0
    party_ffa_rooms = 0
    party_tdm_rooms = 0
    for room in PARTY_ROOMS.values():
        h = _count_humans(room)
        if room.game_mode == "tdm":
            party_tdm_humans += h
            party_tdm_rooms += 1 if h > 0 else 0
        else:
            party_ffa_humans += h
            party_ffa_rooms += 1 if h > 0 else 0

    # ── Queues ────────────────────────────────────────────────────
    ranked_queue_by_tier: List[dict] = []
    ranked_queue_total = 0
    for tier_idx, q in RANKED_QUEUE.items():
        # A single queue entry can contain a party of N users.
        tier_size = sum(len(e.get("user_ids") or [e.get("user_id")]) for e in q)
        ranked_queue_total += tier_size
        if tier_size > 0:
            ranked_queue_by_tier.append({
                "tier": tier_idx,
                "tier_name": RANK_TIERS[tier_idx][1],
                "players": tier_size,
                "entries": len(q),
            })
    casual_queue_total = sum(len(e.get("user_ids") or [e.get("user_id")]) for e in CASUAL_QUEUE)

    # ── Mode popularity totals ──────────────────────────────────────
    ffa_in_match = (
        qm_ffa_humans
        + practice_ffa_humans
        + offline_ffa_humans
        + party_ffa_humans
    )
    tdm_in_match = (
        qm_tdm_humans
        + practice_tdm_humans
        + offline_tdm_humans
        + party_tdm_humans
    )
    # Ranked is FFA-only in this codebase (ranked_room is FFA). Keep it
    # in its own bucket so admins can see ranked activity as a distinct
    # signal from casual FFA.
    ranked_all = ranked_humans + ranked_bot_humans

    # ── Matches played per mode, last 24 hours ──────────────────────
    # Aggregated from `db.match_history`. Each real player in a match
    # gets one row (bots don't have `user_id` → not in this collection),
    # so counting DISTINCT `match_id` per mode gives the true match
    # count. Grouping by `game_mode` (ffa/tdm) THEN `mode` (casual/
    # ranked) so admins can see e.g. "72 casual FFA matches, 18 ranked
    # FFA, 41 casual TDM" in the last day.
    matches_last_24h = {"ffa_casual": 0, "ffa_ranked": 0, "tdm_casual": 0, "total": 0}
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        pipeline = [
            {"$match": {"ended_at": {"$gte": cutoff}}},
            # First collapse to one row per (match_id, game_mode, mode)
            # so multi-player matches don't get counted N times.
            {"$group": {
                "_id": {"match_id": "$match_id", "game_mode": "$game_mode", "mode": "$mode"},
            }},
            {"$group": {
                "_id": {"game_mode": "$_id.game_mode", "mode": "$_id.mode"},
                "count": {"$sum": 1},
            }},
        ]
        async for row in db.match_history.aggregate(pipeline):
            gm = (row["_id"].get("game_mode") or "ffa").lower()
            md = (row["_id"].get("mode") or "casual").lower()
            n = int(row.get("count") or 0)
            matches_last_24h["total"] += n
            key = f"{gm}_{md}"
            if key in matches_last_24h:
                matches_last_24h[key] += n
            elif gm == "ffa":
                # Any FFA row that's neither casual nor ranked
                # (defensive default). Route to ffa_casual.
                matches_last_24h["ffa_casual"] += n
            else:
                matches_last_24h["tdm_casual"] += n
    except Exception as e:
        logger.warning("matches_last_24h aggregation failed: %s", e)

    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        # `real_online` now unions WS (in-match) + lobby heartbeat so a
        # player sitting on the lobby screen (queue/challenges/friends)
        # counts too — before this it was WS-only, which understated
        # traffic because casual browsers never showed up.
        "real_online": count_real_online(),
        "real_online_in_match": len(ONLINE_USERS),
        "real_online_in_lobby": sum(
            1 for uid, ts in PRESENCE_HEARTBEAT.items()
            if (time.time() - ts) <= HEARTBEAT_TTL and uid not in ONLINE_USERS
        ),
        "peak_online": int(PEAK_ONLINE.get("value") or 0),
        "peak_online_at": PEAK_ONLINE.get("at"),
        "displayed_online": SYNTHETIC_ONLINE["value"],
        "rooms": {
            "quick_match_ffa": {"humans": qm_ffa_humans, "mode": "ffa"},
            "quick_match_tdm": {"humans": qm_tdm_humans, "mode": "tdm"},
            "ranked":          {"humans": ranked_humans, "mode": "ffa", "is_ranked": True},
            "practice_ffa":    {"humans": practice_ffa_humans, "mode": "ffa"},
            "practice_tdm":    {"humans": practice_tdm_humans, "mode": "tdm"},
            "offline_ffa":     {"humans": offline_ffa_humans, "rooms": offline_ffa_rooms, "mode": "ffa"},
            "offline_tdm":     {"humans": offline_tdm_humans, "rooms": offline_tdm_rooms, "mode": "tdm"},
            "ranked_vs_bots":  {"humans": ranked_bot_humans, "rooms": ranked_bot_rooms, "mode": "ffa", "is_ranked": True},
            "party_ffa":       {"humans": party_ffa_humans, "rooms": party_ffa_rooms, "mode": "ffa"},
            "party_tdm":       {"humans": party_tdm_humans, "rooms": party_tdm_rooms, "mode": "tdm"},
        },
        "queues": {
            "ranked_total": ranked_queue_total,
            "ranked_by_tier": ranked_queue_by_tier,
            "casual_total": casual_queue_total,
        },
        "parties": len(PARTIES),
        "mode_popularity": {
            "ffa_casual": ffa_in_match,
            "tdm_casual": tdm_in_match,
            "ranked": ranked_all,
            # Total human players actively in a match right now (any
            # mode) — sanity number that should be <= real_online.
            "in_match_total": ffa_in_match + tdm_in_match + ranked_all,
        },
        # 24h match-count breakdown, per user request. Keys mirror the
        # `mode_popularity` shape so the admin UI can pair them 1:1.
        "matches_last_24h": matches_last_24h,
    }


# Note: the seed-veteran name pool used to live here as a flat list, but
# was replaced with `TIERED_BOT_NAMES` lookups inside `_build_and_insert`
# so seeded leaderboard accounts share names with the in-game ranked bots
# for the same tier. Keeps the world's character names consistent.


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


def _snap_rp_to_match_grid(rp: int) -> int:
    """Snap an arbitrary RP value to the nearest reachable-via-gameplay
    value. Every valid ranked match delta (+30 / +15 / 0 / -30 / -60) is
    a multiple of 15, so any RP a real player can accumulate from 0 is
    a multiple of 15 too. Seed/climb code routes through this so the
    leaderboard never shows an RP value you couldn't actually earn
    (e.g., 423 — not a multiple of 15)."""
    rp = max(0, int(rp))
    return (rp // 15) * 15


def _prev_season_number() -> int:
    """Return the cached previous-season number (min 1). Populated by
    `_backfill_past_seasons_once` on startup from the season doc, then
    kept fresh across rollovers by `maybe_reset_season`."""
    try:
        return max(1, int(_CACHED_PREV_SEASON_NUMBER[0]))
    except Exception:
        return 1


def _seed_past_seasons_for(rp: int, rank_idx: int) -> list[dict]:
    """Build a plausible `past_seasons` array for a freshly-created
    seeded bot. Every bot gets an entry at its current target tier for
    the previous season (so PublicProfileModal can flex an equipped
    title immediately). Half of them also get an older lower-tier
    entry to sell the "veteran climbing over time" story.
    Season numbers use a defensive fallback of 1 when the season doc
    isn't ready yet — this is fixed up by `_backfill_past_seasons_once`
    on next boot if it ever races on the initial season insert.
    """
    prev = 1
    try:
        # The seed endpoint holds a synchronous handle to the season
        # via the global — read from the last-known cached number if
        # we've populated it. Otherwise fall back to 1.
        prev = int(_CACHED_PREV_SEASON_NUMBER[0])
    except Exception:
        prev = 1
    entries = [{
        "season": prev,
        "tier": int(rank_idx),
        "tier_name": RANK_TIERS[rank_idx][1] if 0 <= rank_idx < len(RANK_TIERS) else "BRONZE",
        "rp": _snap_rp_to_match_grid(rp),
    }]
    # ~50% carry an older season entry one tier lower — subtle history.
    if prev >= 2 and random.random() < 0.5:
        older_tier = max(0, rank_idx - 1)
        if older_tier < len(RANK_TIERS):
            lo = RANK_TIERS[older_tier][0]
            hi = (RANK_TIERS[older_tier + 1][0] - 1) if (older_tier + 1 < len(RANK_TIERS)) else (lo + 400)
            older_rp = _snap_rp_to_match_grid(random.randint(lo, hi))
            entries.insert(0, {
                "season": max(1, prev - 1),
                "tier": int(older_tier),
                "tier_name": RANK_TIERS[older_tier][1],
                "rp": older_rp,
            })
    return entries


# Small module-level cache updated by the season loop each tick so the
# synchronous seed endpoint can read the previous-season number without
# blocking on a fresh Mongo lookup.
_CACHED_PREV_SEASON_NUMBER: list[int] = [1]


def _synthesize_career(rp: int, rank_idx: int) -> tuple[int, int, int, int]:
    """Given a target `rp` (already snapped to multiples of 15) and a
    rank tier index, return a plausible (matches, kills, deaths, wins)
    tuple consistent with the ranked RP curve.

    Constraints enforced:
      - wins >= ceil(rp / 30): even at the best-case +30 per win, you
        need this many first-places to reach `rp`. Anything lower would
        be mathematically impossible.
      - matches is at least a small multiple of wins so the bot has
        room for the non-podium placements/losses that the random K/D
        formula assumes (otherwise low-match high-RP seeds look like
        90% win rates, which is implausible for a Diamond+ grinder).
      - kills/deaths scale with matches via the existing tier-based
        K/D bands. K/D ratio is preserved at all ranks (lower tiers
        skew nearer 1.0, higher tiers skew higher).
    """
    min_wins = max(1, (rp + 29) // 30)  # ceil(rp / 30)
    # Win rate: lower tiers ~40-55%, higher tiers ~55-70% (Masters+ need
    # higher rates just to stay positive on the -60 loss curve).
    win_rate = random.uniform(0.40 + rank_idx * 0.03, 0.55 + rank_idx * 0.025)
    win_rate = min(0.85, max(0.30, win_rate))
    # matches derived from min_wins/win_rate, with a small randomized
    # surplus so the totals don't look mechanically generated.
    base_matches = max(min_wins, int(round(min_wins / win_rate)))
    matches = base_matches + random.randint(2 + rank_idx * 2, 10 + rank_idx * 6)
    wins = max(min_wins, int(round(matches * win_rate)))
    # Keep wins <= matches (defensive — high win_rate * surplus could
    # theoretically tip over).
    wins = min(wins, matches)
    # Kills / deaths preserve the existing tier-aligned bands.
    kills = int(matches * random.uniform(2.5 + rank_idx * 0.4, 4.0 + rank_idx * 0.55))
    deaths = max(1, int(kills / random.uniform(0.95 + rank_idx * 0.12, 1.45 + rank_idx * 0.18)))
    return matches, kills, deaths, wins


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

    # RP buckets: (low, high, weight). All seed bots now target the
    # Goonmaster tier (2400+) — by the end of the season every seeded
    # account is at Goonmaster. During the season, per-bot climb offsets
    # + speeds spread the current-display RP across every tier so the
    # ladder still LOOKS mixed (some bots at Bronze early, Diamond
    # mid-season, GM late) — but the target endpoint is uniformly GM.
    #
    # Range 2400..3800 (widened from 2700) so a chunk of the top tail
    # sits well above the Goonmaster floor and the top-50 ULTIMATE
    # GOONER cutoff has a real ~1200 RP spread instead of everyone
    # bunched at 2400-3000.
    buckets = [
        (2400, 3800, 100),   # GOONMASTER only — all seeds converge here
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
    # Each window sits INSIDE its tier band (300 RP wide) with a small
    # buffer from the exact threshold so bots don't cluster at the
    # edges.
    TIER_RP_WINDOWS = {
        0: (40,   290),    # BRONZE   (0-299)
        1: (310,  590),    # SILVER   (300-599)
        2: (610,  890),    # GOLD     (600-899)
        3: (910,  1190),   # PLATINUM (900-1199)
        4: (1210, 1490),   # EMERALD  (1200-1499)
        5: (1510, 1790),   # DIAMOND  (1500-1799)
        6: (1810, 2090),   # MASTER   (1800-2099)
        7: (2110, 2390),   # GRANDMASTER (2100-2399)
    }

    async def _build_and_insert(rp: int):
        """Build one realistic veteran doc with the given RP and insert
        it. Returns the inserted-username summary or None on duplicate.

        RP is snapped to multiples of 15 (the GCD of valid ranked match
        deltas — see `_snap_rp_to_match_grid`) so the leaderboard never
        shows a value a real player couldn't have reached. Match/win
        counts are then derived from that RP via `_synthesize_career`
        so the bot's W/L numbers are mathematically consistent with its
        rank — wins is at least ceil(rp/30) (the best-case +30 per win)
        and matches sits comfortably above wins for plausible win rate.

        Name picking: the base handle is drawn from `TIERED_BOT_NAMES`
        for the doc's computed rank tier so seeded leaderboard accounts
        share the **same name pool** that in-game ranked bots use for
        that tier. That way a player who sees "ApexLumen_T1" pop up on
        the Master leaderboard also believably bumps into
        "ApexLumen_T1-R" inside a Master-tier match — the world feels
        coherent instead of having two disjoint name catalogs."""
        rp = _snap_rp_to_match_grid(rp)
        rank_idx, rank_name = rank_for_points(rp)
        # Tier-aligned pool (falls back to all-tiers flat if anything's
        # missing — defensive only; every tier 0..7 is populated above).
        pool = TIERED_BOT_NAMES.get(rank_idx) or [n for sub in TIERED_BOT_NAMES.values() for n in sub]
        base = random.choice(pool)
        if random.random() < 0.4 or any(d["username"] == base for d in inserted) or await db.users.find_one({"username": base}):
            if not suffix_pool:
                return None
            username = f"{base}{suffix_pool.pop()}"
        else:
            username = base
        matches, kills, deaths, wins = _synthesize_career(rp, rank_idx)
        # Level 10..25: pin the bot's displayed level by injecting a
        # baked-in `bonus_xp`. `compute_level` adds bonus_xp to the
        # natural stats-derived XP (kills*10 + wins*50 + matches*25),
        # so we pick a target level in [10, 22] and set the bonus to
        # the exact XP threshold for that level. As the seed climbs
        # and stats lerp toward their targets the level may drift up
        # by 1-3 during peak Goonmaster, staying comfortably within
        # the 10..25 band even at 100% climb.
        target_level = random.randint(10, 22)
        bonus_xp = xp_threshold_for_level(target_level)
        # Seeded accounts climb progressively across the season instead of
        # spawning at their final RP. We stash the *target* RP and stat
        # totals (matches/kills/deaths/wins) on the doc, then let
        # `seeded_climb_loop` lerp the live `rank_points` + `stats.*` from
        # 0 toward those targets as the season elapses. Per-bot offset
        # delays when a bot starts climbing (0..20% of season), and speed
        # is a per-bot pace multiplier — together they reshuffle the
        # board organically instead of every seed scaling in lockstep.
        # Season rollover zeroes `rank_points`/`placement_matches_played`
        # for all users; the next climb tick rebuilds the curve from 0.
        doc = {
            "email": f"seed_{username.lower()}_{int(now.timestamp())}_{len(inserted)}@virtue.seed",
            "password_hash": "",
            "username": username,
            "role": "user",
            "is_seeded": True,
            "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0, "bonus_xp": bonus_xp},
            "rank_points": 0,
            "placement_matches_played": 0,
            "seed_target_rp": rp,
            "seed_target_matches": matches,
            "seed_target_kills": kills,
            "seed_target_deaths": deaths,
            "seed_target_wins": wins,
            "seed_career_v2": True,
            "seed_climb_offset": round(random.uniform(0.0, 0.20), 4),
            # Faster climb speed (was 1.35..2.4) — bots reach their
            # Goonmaster target faster and the top of the leaderboard
            # populates earlier in the season.
            "seed_climb_speed": round(random.uniform(2.5, 4.0), 4),
            # Give fresh seeds an already-equipped past-season title so
            # their public profile flexes "S{prev} · {tier}" from the
            # moment they hit the leaderboard. Season 1 seeds show a
            # single "S0" fallback which we hide client-side (S0 stays
            # in past_seasons for future rollover math).
            "past_seasons": _seed_past_seasons_for(rp, rank_idx),
            "title_season": max(1, _CACHED_PREV_SEASON_NUMBER[0]),
            "seed_v3_boost": True,
            "seed_v4_gm": True,
            "seed_v5_all_gm": True,
            "seed_v6_boost": True,
            # Peak = target from the moment the seed lands in the DB.
            # Without this, the profile's "Peak" card would show 0 for
            # the first climb tick (~30s window) and mismatch the
            # past-season title.
            "peak_rank_points": rp,
            "peak_rank_tier": int(rank_idx),
            "peak_rank_name": rank_name,
            "peak_rank_division": rank_division_for_points(rp, rank_idx),
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
        # Cache-hit refresh. The leader may have re-clicked CUSTOM LOBBY
        # with a different BOTS toggle while the room was still alive
        # (e.g. one member is still connected keeping the cache warm).
        # Sync the room's `bots_enabled` from the party record and
        # prune any live fill-bots when the flag has flipped to False,
        # otherwise stale bots persist until the room dies naturally.
        party = PARTIES.get(party_id) or {}
        new_flag = bool(party.get("bots_enabled", True))
        if room.bots_enabled != new_flag:
            room.bots_enabled = new_flag
            if not new_flag:
                # Despawn every bot so the room reverts to human-only.
                # Real players stay untouched. Done outside the room
                # lock — the tick loop's next `_maintain_population`
                # will refuse to refill (early-return).
                for pid in [pid for pid, p in room.players.items() if p.is_bot]:
                    room.players.pop(pid, None)
                logger.info(
                    "Party room %s toggled to BOTS OFF — pruned live bots.",
                    party_id,
                )
        return room
    # 5-minute private FFA (or TDM if leader picked it). Bot-fill to
    # MAX_PARTY_SIZE — but only when the leader ENABLED bots via the
    # Custom Lobby toggle. A party that opts out of bots gets a
    # pure human-only room (great for 1v1s, 2v2s within friends).
    party = PARTIES.get(party_id) or {}
    member_count = len(party.get("members") or []) if party else 1
    bots_enabled = bool(party.get("bots_enabled", True))   # legacy default: fill with bots
    is_tdm = bool(party.get("tdm", False))
    room_mode = "tdm" if is_tdm else "ffa"
    bot_count = max(0, MAX_PARTY_SIZE - member_count) if bots_enabled else 0
    room = GameRoom(is_ranked=False, match_duration=300.0, game_mode=room_mode)
    room.is_party = True
    room.party_id = party_id
    # Propagate the party's BOTS-OFF opt-out into the room so the tick
    # loop's `_maintain_population` doesn't backfill bots after the
    # 0-bot seed below. Without this the room would silently fill to
    # FFA_LOBBY_SIZE within a few ticks even though bot_count=0 here.
    room.bots_enabled = bots_enabled
    if bot_count > 0:
        for name in random.sample(DISGUISED_BOT_NAMES, bot_count):
            # Party rooms are casual — match the nerfed casual bot
            # difficulty (0.9) so a small party doesn't get slammed
            # by fill bots harder than the actual quick-match ones.
            room.spawn_bot(name, disguised=True, difficulty=0.9)
    PARTY_ROOMS[party_id] = room
    PARTY_ROOM_TASKS[party_id] = asyncio.create_task(room.run())
    logger.info("Party room spawned id=%s members=%d bots=%d mode=%s",
                party_id, member_count, bot_count, room_mode)
    return room


# How long an emptied party room stays alive before actual cleanup.
# Covers three legitimate cases the old zero-delay cleanup broke:
#  1. React StrictMode double-mount: the leader's Game.jsx mounts,
#     the WS connects+adds, StrictMode immediately unmounts → remove
#     fires → room drops to 0 humans. The re-mount opens a NEW WS
#     within ~100ms.
#  2. Custom Lobby launch: leader clicks Start → navigates → WS
#     connects. The follower's /party/me poll can be 0-5s behind so
#     the room briefly holds only the leader. If the leader's tab
#     hiccups (network blip, tab focus loss, mobile bg pause) the
#     room used to die AND flip `match_starting=False`, which then
#     stopped the follower from ever navigating — the "custom game
#     only brings host into the game" bug the user reported for
#     BOTS OFF (with bots seeded the same race exists but occurs
#     less often since the room lives longer through the reconnect).
#  3. Match-end → lobby transition: both members briefly disconnect
#     during the intermission→lobby route change. Grace lets them
#     rejoin the SAME room instead of racing to create fresh ones.
PARTY_ROOM_CLEANUP_GRACE_SEC = 15.0

# Cleanup timers keyed by party_id so a re-add can cancel the pending
# destruction. Cleared on cleanup or on manual party disband.
_PARTY_ROOM_CLEANUP_TASKS: Dict[str, asyncio.Task] = {}


async def cleanup_party_room_if_empty(party_id: str):
    """Schedule a delayed room-teardown when the last real player
    leaves. The delay is critical: `remove()` fires on every WS
    disconnect, including StrictMode double-mounts and brief
    reconnects during the /lobby → /play navigation. Immediate
    teardown races the follower's /party/me poll → resets
    `match_starting=False` before the follower ever navigates → only
    the host enters the custom game.

    Idempotent: repeated calls while a cleanup is pending are a
    no-op. If a real player rejoins during the grace window the
    scheduled task detects the non-empty room and bails without
    destroying it.
    """
    room = PARTY_ROOMS.get(party_id)
    if room is None:
        return
    if any(not p.is_bot for p in room.players.values()):
        return
    if party_id in _PARTY_ROOM_CLEANUP_TASKS and not _PARTY_ROOM_CLEANUP_TASKS[party_id].done():
        return  # cleanup already scheduled — let it run

    async def _delayed_cleanup():
        try:
            await asyncio.sleep(PARTY_ROOM_CLEANUP_GRACE_SEC)
        except asyncio.CancelledError:
            _PARTY_ROOM_CLEANUP_TASKS.pop(party_id, None)
            return
        try:
            # Re-check on wake-up. A player may have (re)joined during
            # the grace window — bail without destroying.
            current = PARTY_ROOMS.get(party_id)
            if current is None:
                return
            if any(not p.is_bot for p in current.players.values()):
                logger.info(
                    "Party room %s grace-window rescue — a real player is back, skipping cleanup.",
                    party_id,
                )
                return
            task = PARTY_ROOM_TASKS.pop(party_id, None)
            if task and not task.done():
                task.cancel()
            PARTY_ROOMS.pop(party_id, None)
            # Clear match_starting flag when the room dies so the lobby panel re-resets.
            party = PARTIES.get(party_id)
            if party:
                party["match_starting"] = False
            logger.info("Party room destroyed id=%s (after %.0fs grace)", party_id, PARTY_ROOM_CLEANUP_GRACE_SEC)
        finally:
            _PARTY_ROOM_CLEANUP_TASKS.pop(party_id, None)

    _PARTY_ROOM_CLEANUP_TASKS[party_id] = asyncio.create_task(_delayed_cleanup())


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


# -------------------------------------------------------------------
# Admin: Redeem-code creator
# -------------------------------------------------------------------
# Hardcoded REDEEM_CODES stay as the seed catalog; admins can create
# additional one-time-per-user codes that persist in the `redeem_codes`
# collection and are looked up by the /codes/redeem endpoint.

import re as _re_codes  # local alias to avoid shadowing any earlier `re` usage


class AdminCodeIn(BaseModel):
    code: str
    reward_type: str  # one of: xp | rp | coins | min_level | rank_up_tiers | banner_animated
    amount: Optional[int] = None  # required for everything except banner_animated
    label: Optional[str] = None
    # Optional limits. `expires_at` is an ISO-8601 datetime string (date or
    # full datetime); `max_redemptions` is a positive int. Either, both,
    # or neither may be set.
    expires_at: Optional[str] = None
    max_redemptions: Optional[int] = None


_ALLOWED_REWARD_TYPES = {"xp", "rp", "coins", "min_level", "rank_up_tiers", "banner_animated"}


def _build_reward_from_admin_input(reward_type: str, amount: Optional[int], label: Optional[str]) -> dict:
    """Translate an admin's (type, amount) selection into the canonical
    reward dict shape consumed by /codes/redeem. Raises HTTPException on
    invalid combos so the admin UI shows a clear error toast."""
    rtype = (reward_type or "").strip().lower()
    if rtype not in _ALLOWED_REWARD_TYPES:
        raise HTTPException(status_code=400, detail=f"Reward type must be one of: {', '.join(sorted(_ALLOWED_REWARD_TYPES))}.")
    reward: Dict[str, object] = {}
    if rtype == "banner_animated":
        reward["banner_animated"] = True
    else:
        if amount is None or int(amount) <= 0:
            raise HTTPException(status_code=400, detail="Amount must be a positive integer.")
        amt = int(amount)
        # Sanity caps so a typo can't grant 10 million XP.
        CAPS = {"xp": 100_000, "rp": 7500, "coins": 1_000_000, "min_level": 100, "rank_up_tiers": 7}
        if amt > CAPS[rtype]:
            raise HTTPException(status_code=400, detail=f"Amount for {rtype} cannot exceed {CAPS[rtype]}.")
        reward[rtype] = amt
    if label:
        reward["label"] = str(label).strip()[:80]
    else:
        # Sensible default label so the redeem toast is never blank.
        if rtype == "banner_animated":
            reward["label"] = "Animated Banner Unlock"
        else:
            unit = {"xp": "XP", "rp": "RP", "coins": "Coins", "min_level": "Level", "rank_up_tiers": "Tier"}[rtype]
            reward["label"] = f"+{amount} {unit}"
    return reward


def _parse_expires_at(raw: Optional[str]) -> Optional[datetime]:
    """Parse an admin-supplied expiry string into a tz-aware UTC datetime.
    Accepts ISO-8601 dates (`2026-12-31`) or full datetimes. Returns None
    if the input is empty/null. Raises HTTPException(400) on invalid
    formats or past dates."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Accept trailing "Z" by normalising to "+00:00" — fromisoformat doesn't
    # speak the Z suffix on older Pythons.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="expires_at must be an ISO-8601 date or datetime.")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    # Promote a bare date (00:00:00) to end-of-day so "2026-12-31" reads as
    # "expires at the end of Dec 31", not "expires the moment Dec 31 starts".
    if dt.hour == 0 and dt.minute == 0 and dt.second == 0 and dt.microsecond == 0:
        dt = dt + timedelta(hours=23, minutes=59, seconds=59)
    now = datetime.now(timezone.utc)
    if dt <= now:
        raise HTTPException(status_code=400, detail="expires_at must be in the future.")
    return dt


@api.post("/admin/codes")
async def admin_create_code(payload: AdminCodeIn, user: dict = Depends(get_current_user)):
    """Create a new dynamic redeem code. Admin-only.

    Code rules: 3-20 chars, alphanumeric, case-insensitive (stored upper).
    Optional `expires_at` (ISO date/datetime, must be in future) and
    `max_redemptions` (positive int) limits. Refuses to overwrite hardcoded
    codes or codes that already exist in the dynamic collection."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    code = (payload.code or "").strip().upper()
    if not _re_codes.fullmatch(r"[A-Z0-9]{3,20}", code):
        raise HTTPException(status_code=400, detail="Code must be 3-20 alphanumeric characters.")
    if code in REDEEM_CODES:
        raise HTTPException(status_code=409, detail="That code is already part of the built-in catalog.")
    existing = await db.redeem_codes.find_one({"code": code})
    if existing:
        raise HTTPException(status_code=409, detail="Code already exists.")
    reward = _build_reward_from_admin_input(payload.reward_type, payload.amount, payload.label)
    expires_at = _parse_expires_at(payload.expires_at)
    max_redemptions: Optional[int] = None
    if payload.max_redemptions is not None:
        if int(payload.max_redemptions) <= 0:
            raise HTTPException(status_code=400, detail="max_redemptions must be a positive integer.")
        if int(payload.max_redemptions) > 1_000_000:
            raise HTTPException(status_code=400, detail="max_redemptions cannot exceed 1,000,000.")
        max_redemptions = int(payload.max_redemptions)
    now = datetime.now(timezone.utc)
    doc = {
        "code": code,
        "reward": reward,
        "label": reward.get("label", ""),
        "created_at": now,
        "created_by": user.get("username") or "admin",
        "redeemed_count": 0,
        "expires_at": expires_at,           # None = never expires
        "max_redemptions": max_redemptions, # None = unlimited
    }
    await db.redeem_codes.insert_one(doc)
    # Strip _id from response (ObjectId is not JSON-serializable).
    return {
        "ok": True,
        "code": code,
        "reward": reward,
        "label": doc["label"],
        "created_at": now.isoformat(),
        "created_by": doc["created_by"],
        "redeemed_count": 0,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "max_redemptions": max_redemptions,
    }


@api.get("/admin/codes")
async def admin_list_codes(user: dict = Depends(get_current_user)):
    """List all dynamic admin-created codes (most recent first). Admin-only.
    Includes derived `status` (active | expired | maxed) so the UI can
    badge each row without computing it client-side."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    out = []
    now = datetime.now(timezone.utc)
    cursor = db.redeem_codes.find({}, {"_id": 0}).sort("created_at", -1).limit(200)
    async for c in cursor:
        ts = c.get("created_at")
        lts = c.get("last_redeemed_at")
        exp = c.get("expires_at")
        # Mongo returns naive datetimes — coerce to UTC for comparison.
        exp_aware = exp.replace(tzinfo=timezone.utc) if isinstance(exp, datetime) and exp.tzinfo is None else exp
        max_red = c.get("max_redemptions")
        count = int(c.get("redeemed_count", 0) or 0)
        # Status: expired beats maxed beats active (UX choice — admin should
        # see "expired" if both conditions hit so they replace the code).
        status = "active"
        if isinstance(exp_aware, datetime) and exp_aware <= now:
            status = "expired"
        elif max_red is not None and count >= int(max_red):
            status = "maxed"
        out.append({
            "code": c.get("code"),
            "reward": c.get("reward") or {},
            "label": c.get("label") or (c.get("reward") or {}).get("label") or "",
            "created_at": ts.isoformat() if isinstance(ts, datetime) else ts,
            "created_by": c.get("created_by") or "",
            "redeemed_count": count,
            "last_redeemed_at": lts.isoformat() if isinstance(lts, datetime) else lts,
            "expires_at": exp.isoformat() if isinstance(exp, datetime) else None,
            "max_redemptions": int(max_red) if max_red is not None else None,
            "status": status,
        })
    return {"codes": out}


@api.delete("/admin/codes/{code}")
async def admin_delete_code(code: str, user: dict = Depends(get_current_user)):
    """Delete a dynamic code. Admin-only. The hardcoded built-in catalog
    can't be deleted via this endpoint — those live in source. Note:
    deletion does NOT affect users who already redeemed the code (their
    `redeemed_codes` list is unchanged), but the code can no longer be
    redeemed by anyone else."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    code_norm = (code or "").strip().upper()
    result = await db.redeem_codes.delete_one({"code": code_norm})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Code not found.")
    return {"ok": True, "deleted": code_norm}


# -------------------------------------------------------------------
# News — admin-broadcast announcement feed.
#
# `news_posts` collection. Admins compose posts; every signed-in user
# can read them at /news. A small unread badge in the lobby shows how
# many posts have been published since the user last opened the news
# page (tracked per-user via `users.news_last_read_at`).
# -------------------------------------------------------------------
class NewsPostIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    body:  str = Field(min_length=2, max_length=4000)
    pinned: bool = False


class NewsPostPatchIn(BaseModel):
    """Admin-only news-post edit payload — all fields optional so a
    partial update (e.g. just `likes`) works without re-sending the
    full post."""
    title: Optional[str] = Field(default=None, min_length=2, max_length=120)
    body: Optional[str] = Field(default=None, min_length=2, max_length=4000)
    pinned: Optional[bool] = None
    likes: Optional[int] = Field(default=None, ge=0, le=10_000_000)


@api.post("/admin/news")
async def admin_create_news(payload: NewsPostIn, user: dict = Depends(get_current_user)):
    """Admin-only: publish a new announcement. Stored in the `news_posts`
    collection with `created_at` set server-side. Returns the persisted
    post (id, title, body, author_username, created_at, pinned)."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    now = datetime.now(timezone.utc)
    doc = {
        "title": payload.title.strip(),
        "body": payload.body.strip(),
        "author_username": user.get("username", "Admin"),
        "author_id": str(user["_id"]),
        "created_at": now,
        "pinned": bool(payload.pinned),
    }
    res = await db.news_posts.insert_one(doc)
    return {
        "id": str(res.inserted_id),
        "title": doc["title"],
        "body": doc["body"],
        "author_username": doc["author_username"],
        "created_at": now.isoformat(),
        "pinned": doc["pinned"],
        "likes": 0,
        "liked_by_me": False,
    }


@api.patch("/admin/news/{post_id}")
async def admin_patch_news(
    post_id: str,
    payload: NewsPostPatchIn,
    user: dict = Depends(get_current_user),
):
    """Admin-only: patch an existing news post. Accepts partial updates —
    title / body / pinned / likes can each be sent independently. The
    `likes` field is what powers the "edit like count" admin control on
    the News page. Real user-driven likes still tick via the toggle
    endpoint below; admins can overwrite the total at any time (e.g. to
    seed a hype post at 200 or wipe brigading)."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    try:
        oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid post id.")
    updates: dict = {}
    if payload.title is not None:
        updates["title"] = payload.title.strip()
    if payload.body is not None:
        updates["body"] = payload.body.strip()
    if payload.pinned is not None:
        updates["pinned"] = bool(payload.pinned)
    if payload.likes is not None:
        updates["likes"] = int(payload.likes)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")
    res = await db.news_posts.update_one({"_id": oid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found.")
    return {"ok": True, "updated": list(updates.keys())}


@api.delete("/admin/news/{post_id}")
async def admin_delete_news(post_id: str, user: dict = Depends(get_current_user)):
    """Admin-only: delete a news post by id."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    try:
        oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid post id.")
    res = await db.news_posts.delete_one({"_id": oid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Post not found.")
    return {"ok": True, "deleted": post_id}


@api.get("/news")
async def list_news(user: dict = Depends(get_current_user), limit: int = 50):
    """Public list of all news posts (newest first, pinned posts on top).
    Also stamps `users.news_last_read_at = now` so the unread badge clears
    as soon as the user opens the feed. Each row carries the aggregate
    `likes` count plus a per-caller `liked_by_me` flag so the thumbs-up
    button can render its filled/hollow state without a follow-up call."""
    limit = max(1, min(200, int(limit)))
    me_id = str(user["_id"])
    # Pinned first, then by created_at desc.
    cursor = db.news_posts.find({}).sort([("pinned", -1), ("created_at", -1)]).limit(limit)
    posts: List[dict] = []
    async for p in cursor:
        posts.append(p)
    # Batch-fetch the caller's likes across all rendered posts in one
    # query so we don't N+1 the collection.
    liked_ids: set[str] = set()
    if posts:
        cur = db.news_post_likes.find(
            {"user_id": me_id, "post_id": {"$in": [str(p["_id"]) for p in posts]}},
            {"post_id": 1},
        )
        async for row in cur:
            liked_ids.add(row.get("post_id"))
    rows: List[dict] = []
    for p in posts:
        pid = str(p["_id"])
        rows.append({
            "id": pid,
            "title": p.get("title", ""),
            "body": p.get("body", ""),
            "author_username": p.get("author_username", "Admin"),
            "created_at": p["created_at"].isoformat() if isinstance(p.get("created_at"), datetime) else p.get("created_at"),
            "pinned": bool(p.get("pinned", False)),
            "likes": int(p.get("likes", 0) or 0),
            "liked_by_me": pid in liked_ids,
        })
    # Mark as read for this user — the unread counter checks against the
    # latest post's `created_at`.
    try:
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"news_last_read_at": datetime.now(timezone.utc)}},
        )
    except Exception:
        pass
    return rows


@api.post("/news/{post_id}/like")
async def toggle_news_like(post_id: str, user: dict = Depends(get_current_user)):
    """Toggle the caller's thumbs-up on a news post. Each user gets one
    like per post — clicking again removes it. Stored in
    `news_post_likes` (compound index on (user_id, post_id) enforces
    uniqueness). Returns the new aggregate count + the caller's flag so
    the client can update the button optimistically."""
    try:
        oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid post id.")
    post = await db.news_posts.find_one({"_id": oid})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    me_id = str(user["_id"])
    existing = await db.news_post_likes.find_one({"user_id": me_id, "post_id": post_id})
    if existing:
        await db.news_post_likes.delete_one({"_id": existing["_id"]})
        await db.news_posts.update_one({"_id": oid}, {"$inc": {"likes": -1}})
        liked_by_me = False
    else:
        await db.news_post_likes.insert_one({
            "user_id": me_id,
            "post_id": post_id,
            "created_at": datetime.now(timezone.utc),
        })
        await db.news_posts.update_one({"_id": oid}, {"$inc": {"likes": 1}})
        liked_by_me = True
    # Re-fetch the freshly-mutated total. Clamp at zero so admin
    # overrides that set likes below the personal-like count can't
    # produce negative aggregates.
    updated = await db.news_posts.find_one({"_id": oid}, {"likes": 1})
    likes = max(0, int((updated or {}).get("likes", 0) or 0))
    if likes != int((updated or {}).get("likes", 0) or 0):
        await db.news_posts.update_one({"_id": oid}, {"$set": {"likes": likes}})
    return {"likes": likes, "liked_by_me": liked_by_me}


@api.get("/news/unread")
async def news_unread(user: dict = Depends(get_current_user)):
    """Returns `{count: N}` for the lobby's NEWS-button badge.
    Counts posts published AFTER the user's `news_last_read_at`. New
    accounts that have never opened the feed see every existing post
    as unread (capped at 99 for display sanity)."""
    last_read = user.get("news_last_read_at")
    if isinstance(last_read, datetime) and last_read.tzinfo is None:
        last_read = last_read.replace(tzinfo=timezone.utc)
    query: dict = {}
    if last_read:
        query["created_at"] = {"$gt": last_read}
    count = await db.news_posts.count_documents(query)
    return {"count": min(99, int(count))}


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
    """Current party state (or {party_id: null} if not in a party).

    Uses `_party_for_user` (which has the PMI-desync self-repair) so a
    stale index entry can't cause the client's party panel to flash off
    on a poll cycle."""
    me_id = str(user["_id"])
    party = await _party_for_user(me_id)
    if not party:
        return {"party_id": None}
    # Resolve back to party_id via the (now-repaired) index.
    party_id = PARTY_MEMBER_INDEX.get(me_id)
    if not party_id or party_id not in PARTIES:
        return {"party_id": None}
    return await _party_payload(party_id, for_user_id=me_id)


@api.post("/party/leave-match")
async def party_leave_match(user: dict = Depends(get_current_user)):
    """Opt the caller out of the CURRENT Custom Lobby session without
    leaving the party itself. Fixes the "leave match just brings you
    back into the game if you are not the host" bug — after the client
    calls this the next `/party/me` poll returns `match_starting=False`
    for THIS user only, so PartyPanel's auto-nav useEffect doesn't
    yank them back into /play. Other members (still in the match)
    see the flag unchanged.

    The opt-out is scoped to the current start-session: on the next
    `/party/start` the set is cleared, so if the leader kicks off a
    new Custom Lobby the previously-opted-out member CAN be pulled
    back in.
    """
    me_id = str(user["_id"])
    party_id = PARTY_MEMBER_INDEX.get(me_id)
    if not party_id or party_id not in PARTIES:
        return {"ok": True}
    party = PARTIES[party_id]
    optout = party.setdefault("match_optout", set())
    optout.add(me_id)
    logger.info("Party %s: user %s opted out of current custom lobby.", party_id, me_id)
    return {"ok": True}


@api.post("/party/start")
async def party_start(payload: dict = None, user: dict = Depends(get_current_user)):
    """Leader flags the party as match_starting; all members poll & auto-nav.

    Optional body: `{"bots_enabled": bool, "tdm": bool}` — the "Custom
    Lobby" flow from PartyPanel passes both so the party's private room
    is created with the leader's chosen settings. Legacy callers who
    POST with no body still work — `bots_enabled` defaults to True
    (matches the old auto-fill behavior) and `tdm` to False.
    """
    me_id = str(user["_id"])
    party_id = PARTY_MEMBER_INDEX.get(me_id)
    if not party_id or party_id not in PARTIES:
        raise HTTPException(status_code=404, detail="No party")
    party = PARTIES[party_id]
    if party["leader_id"] != me_id:
        raise HTTPException(status_code=403, detail="Only the leader can start")
    body = payload or {}
    # Persist the two lobby-config flags so both the room-spawn helper
    # AND the /party/me poll can read them. Defaults preserve old
    # behaviour for any external caller.
    party["match_starting"] = True
    party["bots_enabled"] = bool(body.get("bots_enabled", True))
    party["tdm"] = bool(body.get("tdm", False))
    # A brand-new Custom Lobby session — clear any per-member opt-outs
    # from the PREVIOUS lobby so followers who exited last round can
    # be pulled back in this time.
    party["match_optout"] = set()
    logger.info("Party %s starting custom lobby: bots=%s tdm=%s",
                party_id, party["bots_enabled"], party["tdm"])
    return {"party_id": party_id, "bots_enabled": party["bots_enabled"], "tdm": party["tdm"]}


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
        "in_match": loc is not None and loc.get("kind") in ("casual", "bigffa", "ranked", "party", "offline"),
        "match_kind": loc.get("kind") if loc else None,
    }


@api.get("/users/{username}/profile")
async def public_profile(username: str, _user: dict = Depends(get_current_user)):
    """Public view of any user's profile — username, avatar, stats, rank,
    peak rank, last 10 matches. Email is intentionally excluded.

    Privacy: if the target user has `profile_private: True`, return a
    minimal payload (`private: True` + display essentials only). Bots
    (`is_bot: True` OR `is_seeded: True`) are ALWAYS treated as private
    so their seeded stats / fake match histories don't leak into the
    public-profile UI — the leaderboard lists them by username + rank
    only.

    The viewer can ALWAYS see their own full profile regardless of the
    flag, so a player who turned privacy on can still verify what
    they're hiding.
    """
    u = await _find_user_by_username(username)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    is_self = str(u.get("_id")) == str(_user.get("_id"))
    is_bot = bool(u.get("is_bot", False)) or bool(u.get("is_seeded", False))
    user_private = bool(u.get("profile_private", False))
    private = (is_bot or user_private) and not is_self
    pts = int(u.get("rank_points", 0) or 0)
    peak = int(u.get("peak_rank_points", pts) or pts)
    if pts > peak:
        peak = pts
    t_idx, t_name = rank_for_points(pts)
    p_idx, p_name = rank_for_points(peak)
    user_id = str(u["_id"])
    # Ultimate Gooner: expose the cached top-50 leaderboard rank so the
    # public-profile modal can render the flame + #N badge on both the
    # Current AND Peak rank pills. Missing entry ⇒ not Ultimate ⇒ the
    # client falls through to standard tier rendering.
    ultimate_pos = TOP50_GOONER_IDS.get(user_id)
    leaderboard_extras = {"leaderboard_rank": ultimate_pos} if ultimate_pos else {}
    # Ban surfacing: leaderboard rows still show a banned user (their old
    # RP may keep them in the top-100 for a while) so the profile modal
    # needs a clear "BANNED" indicator. `check_ban` returns None for
    # unbanned users and expired suspensions so this is a no-op most of
    # the time. We reveal `banned`, `ban_status` ("banned"|"suspended"),
    # and — for suspensions — the `ban_until` timestamp so the client
    # can show "Suspended until …". `ban_reason` is intentionally omitted
    # from the public payload to avoid doxxing the target.
    ban_info = check_ban(u) if not is_bot else None
    ban_extras = {}
    if ban_info:
        ban_extras = {
            "banned": True,
            "ban_status": ban_info.get("status"),
            "ban_until": ban_info.get("until"),
        }
    if private:
        return {
            "id": user_id,
            "username": u.get("username", ""),
            "avatar": int(u.get("avatar", 0) or 0),
            "private": True,
            "is_bot": is_bot,
            # Still surface rank so the modal can show the rank pill —
            # the leaderboard already exposes this info publicly, hiding
            # it here would just be confusing.
            "rank_points": pts,
            "rank_tier": t_idx,
            "rank_name": t_name,
            "rank_division": rank_division_for_points(pts, t_idx),
            "peak_rank_points": peak,
            "peak_rank_tier": p_idx,
            "peak_rank_name": p_name,
            "peak_rank_division": rank_division_for_points(peak, p_idx),
            "level": compute_level(u.get("stats", {}))["level"],
            "banner_icon": int(u.get("banner_icon", 0) or 0),
            "banner_color": int(u.get("banner_color", 0) or 0),
            "banner_animated": bool(u.get("banner_animated", False)),
            # Past-season peak-rank flex — bots seed these too so the
            # "S2 · DIAMOND" title stamp shows on their banner in the
            # public profile modal.
            "past_seasons": list(u.get("past_seasons") or []),
            "title_season": (int(u["title_season"]) if isinstance(u.get("title_season"), (int, float)) else None),
            "title_ultimate": bool(u.get("title_ultimate", False)),
            "online": is_online(user_id),
            **leaderboard_extras,
            **ban_extras,
        }
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
        "private": False,
        "stats": u.get("stats", {"kills": 0, "deaths": 0, "matches": 0, "wins": 0}),
        "rank_points": pts,
        "rank_tier": t_idx,
        "rank_name": t_name,
        "rank_division": rank_division_for_points(pts, t_idx),
        "peak_rank_points": peak,
        "peak_rank_tier": p_idx,
        "peak_rank_name": p_name,
        "peak_rank_division": rank_division_for_points(peak, p_idx),
        "level": compute_level(u.get("stats", {}))["level"],
        "banner_icon": int(u.get("banner_icon", 0) or 0),
        "banner_color": int(u.get("banner_color", 0) or 0),
        "banner_animated": bool(u.get("banner_animated", False)),
        # Past-season peak-rank flex — surface these so the public
        # profile modal renders the equipped title on the banner.
        "past_seasons": list(u.get("past_seasons") or []),
        "title_season": (int(u["title_season"]) if isinstance(u.get("title_season"), (int, float)) else None),
        "title_ultimate": bool(u.get("title_ultimate", False)),
        "online": is_online(user_id),
        "history": history,
        **leaderboard_extras,
        **ban_extras,
    }


class ProfilePrivacyPayload(BaseModel):
    profile_private: bool


@api.put("/profile/privacy")
async def set_profile_privacy(payload: ProfilePrivacyPayload, user: dict = Depends(get_current_user)):
    """Toggle the `profile_private` flag on the signed-in user's doc.
    When true, other players opening this user's PublicProfileModal see
    a stripped-down "private" view (no stats, no match history)."""
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"profile_private": bool(payload.profile_private)}},
    )
    return {"ok": True, "profile_private": bool(payload.profile_private)}


# -------------------------------------------------------------------
@api.websocket("/ws/game")
async def ws_game(websocket: WebSocket, token: Optional[str] = Query(default=None), mode: Optional[str] = Query(default="casual"), party_id: Optional[str] = Query(default=None), target: Optional[str] = Query(default=None), tdm: Optional[int] = Query(default=0), force_map: Optional[str] = Query(default=None), map: Optional[str] = Query(default=None)):
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
        # Consume the matched flag now that we've resolved the room.
        # Without this the flag survives the entire match and the next
        # `/queue/ranked` poll after returning to lobby instantly
        # reports "match found", short-circuiting the queue → forcing
        # the player into another match with no queue time. Mirrors
        # the casual mode's post-connect cleanup.
        async with QUEUE_LOCK:
            MATCHED_USERS.pop(u_id, None)
    elif mode == "practice":
        # Practice supports both FFA and TDM — driven by `?tdm=1` from the
        # PracticeMapSelector. TDM practice spawns into the dedicated
        # tdm_room so the dummy bots aren't promoted into 4v4.
        room = practice_tdm_room if tdm else practice_room
        # Any player can pick their practice-range arena via `?map=<id>`.
        # (Practice rooms are shared instances so this "hot-swaps" for
        # everyone in that room — that's acceptable for a training range.)
        # Admin-only `?force_map=<id>` retained as backwards-compat.
        chosen_map = None
        m = get_map_by_id(map) if map else None
        if m:
            chosen_map = m
        elif force_map and (user.get("role") == "admin" or user.get("is_admin")):
            fm = get_map_by_id(force_map)
            if fm:
                chosen_map = fm
        if chosen_map:
            room.arena = chosen_map
            if hasattr(room, "_build_healthpacks"):
                room.healthpacks = room._build_healthpacks()
            logger.info("Practice map override applied: %s (user=%s)", chosen_map.get("map_id"), str(user["_id"]))
    elif mode == "offline":
        # Offline-vs-AI also honours the TDM flag — the user picks FFA or
        # TDM at the same selector and we route to a per-user TDM room.
        # Any player (not just admins) can pick which map they train on:
        # `?map=<map_id>` from the PracticeMapSelector overrides the
        # random roll. Admin-only `?force_map=<map_id>` is retained as
        # an equivalent (kept for backwards-compat with the QA/preview
        # tooling). Either param clears the cached user room first so
        # the swap always applies — otherwise the stale room's arena
        # sticks and the pick silently no-ops.
        chosen_map = None
        m = get_map_by_id(map) if map else None
        if m:
            chosen_map = m
        elif force_map and (user.get("role") == "admin" or user.get("is_admin")):
            fm = get_map_by_id(force_map)
            if fm:
                chosen_map = fm
        if chosen_map:
            uid = str(user["_id"])
            if not tdm:
                # Tear down any stale offline room so a fresh instance is
                # created with the picked arena baked in from the start.
                await cleanup_offline_room_if_empty(uid)
        if tdm:
            room = await get_or_create_offline_tdm_room(str(user["_id"]))
        else:
            room = await get_or_create_offline_room(str(user["_id"]))
        if chosen_map:
            room.arena = chosen_map
            if hasattr(room, "_build_healthpacks"):
                room.healthpacks = room._build_healthpacks()
            logger.info("Offline map override applied: %s (user=%s)", chosen_map.get("map_id"), str(user["_id"]))
    elif mode == "party":
        if not party_id:
            await websocket.close(code=4400)
            return
        room = await get_or_create_party_room(party_id)
    elif mode == "bigffa":
        # 12-player FFA — dedicated shared room, not routed through the
        # casual matchmaker or the ranked queue. Any authenticated player
        # can hop straight in from the lobby button. `_maintain_population`
        # tops the room up to 12 with disguised bots so a solo joiner still
        # gets a full lobby.
        room = bigffa_room
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
        elif kind == "bigffa":
            room = bigffa_room
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
        # Casual / Quick Match. If the matchmaker has already paired us
        # (head-to-head OR bot-fill), honour the room mode it picked so
        # both paired players land in the same shared room. Falls back
        # to the legacy per-connection roll for direct ws joins that
        # bypass the queue (e.g. mid-development test flows).
        u_id = str(user["_id"])
        matched = MATCHED_USERS.get(u_id, {})
        if matched.get("casual"):
            wants_tdm = bool(tdm) or bool(matched.get("tdm"))
            # Consume the matched flag now that we've used it. The next
            # queue cycle starts from a clean slate; if the player drops
            # mid-match they'll requeue normally on return to lobby.
            async with QUEUE_LOCK:
                MATCHED_USERS.pop(u_id, None)
        else:
            wants_tdm = bool(tdm) or (random.random() < TDM_QUICK_MATCH_ROLL)
        room = tdm_room if wants_tdm else game_room
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
    # Seed primary-weapon loadout from the user's saved choice. `ak47`
    # remains the default for legacy accounts and anyone who hasn't
    # touched the lobby weapon-select. `sniper` is the only alternate
    # right now; new choices go through `PRIMARY_WEAPON_CHOICES`.
    saved_weapon = (user.get("primary_weapon") or "ak47")
    if saved_weapon in PRIMARY_WEAPON_CHOICES:
        player.weapon = saved_weapon
    # Freeze the loaded primary so the input-tick handler can restore it
    # after laser swaps and refuse mid-match ak47↔sniper reassignments.
    player._primary_loadout = saved_weapon if saved_weapon in PRIMARY_WEAPON_CHOICES else "ak47"
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
        # Belt-and-suspenders: clear any lingering MATCHED_USERS entry
        # for this user. Otherwise the client's /lobby background queue
        # poll (which fires ~3s after leaving /play) could see a stale
        # `matched: true` and re-yank the user back into a match they
        # just exited. Client also sets a 10s cancel guard on exit, so
        # this is a redundancy layer for cases where the client crashes
        # / tab-closes mid-match without going through handleExit.
        MATCHED_USERS.pop(u_id_str, None)
        # Stamp last_seen on disconnect so "last seen" timer starts from now.
        try:
            await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_seen_at": time.time()}})
        except Exception:
            pass
        if mode == "offline":
            await cleanup_offline_room_if_empty(str(user["_id"]))
            await cleanup_offline_tdm_room_if_empty(str(user["_id"]))
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


@api.get("/leaderboard/archive")
async def leaderboard_archive_index():
    """Index of every archived past season — just the metadata, no rows.
    Used by the Leaderboard UI to populate the "PAST SEASONS" dropdown.
    Sorted newest-first so the most-recent past season is the default
    selection in the picker."""
    cursor = db.season_archive.find(
        {},
        {"_id": 1, "season_number": 1, "started_at": 1, "ended_at": 1, "total_players": 1},
    ).sort([("season_number", -1)])
    out = []
    async for d in cursor:
        out.append({
            "season_number": int(d.get("season_number", 0) or 0),
            "started_at": d.get("started_at").isoformat() if isinstance(d.get("started_at"), datetime) else None,
            "ended_at":   d.get("ended_at").isoformat()   if isinstance(d.get("ended_at"),   datetime) else None,
            "total_players": int(d.get("total_players", 0) or 0),
        })
    return out


@api.get("/leaderboard/archive/{season_number}")
async def leaderboard_archive_season(season_number: int):
    """Top-50 archive for a single past season. 404 if the requested
    season hasn't ended yet (or doesn't exist).

    Note: the archive is stored as `top_100` (the historical name)
    but only the first 50 rows are exposed to clients — past-season
    leaderboards are intentionally trimmed to a "hall of fame" top
    50 rather than a full top-100 dump. `total_players` in the
    metadata still reflects the true season-wide player count."""
    doc = await db.season_archive.find_one(
        {"_id": int(season_number)},
        {"_id": 0},  # drop ObjectId-style key explicitly; _id is the int season_number
    )
    if not doc:
        raise HTTPException(404, "Season archive not found")
    # Serialize datetimes for JSON. Mongo stores them as bson datetimes.
    if isinstance(doc.get("started_at"), datetime):
        doc["started_at"] = doc["started_at"].isoformat()
    if isinstance(doc.get("ended_at"), datetime):
        doc["ended_at"]   = doc["ended_at"].isoformat()
    # Trim to top 50 (was top 100). Kept as `top_100` in the response
    # for backwards compatibility with clients that key on that field
    # name — the field is now guaranteed ≤ 50 rows.
    rows = list(doc.get("top_100") or [])
    doc["top_100"] = rows[:50]
    return doc


@api.get("/leaderboard/friends")
async def leaderboard_friends(user: dict = Depends(get_current_user)):
    """Friends-only leaderboard — same row shape as `/leaderboard` but
    restricted to the caller's accepted friends plus the caller themselves
    (so users always see themselves in the ranking context). Sorted by RP
    descending. Bots don't have friendships so this is always real-player
    only. Powers the "FRIENDS" sub-tab on the Leaderboard page."""
    import hashlib
    me_id = str(user["_id"])
    # Collect accepted-friend user_ids on both sides of the row.
    accepted_cur = db.friendships.find({
        "status": "accepted",
        "$or": [{"from_user_id": me_id}, {"to_user_id": me_id}],
    })
    friend_ids: set[str] = set()
    async for f in accepted_cur:
        other = f["to_user_id"] if f["from_user_id"] == me_id else f["from_user_id"]
        friend_ids.add(other)
    # Always include the caller so they can see their own placement
    # relative to friends even before adding anyone.
    friend_ids.add(me_id)

    # Convert string ids to ObjectId for the users lookup.
    obj_ids = []
    for uid in friend_ids:
        try:
            obj_ids.append(ObjectId(uid))
        except Exception:
            pass
    if not obj_ids:
        return []

    cursor = db.users.find(
        {"_id": {"$in": obj_ids}},
        {"username": 1, "rank_points": 1, "stats": 1, "email": 1, "is_seeded": 1},
    ).sort([("rank_points", -1), ("stats.kills", -1)])
    rows = []
    async for u in cursor:
        s = u.get("stats", {}) or {}
        pts = int(u.get("rank_points", 0) or 0)
        idx, name = rank_for_points(pts)
        uid = str(u["_id"])
        username = u.get("username", u.get("email", "anon"))
        loc = player_location(uid)
        in_match = loc is not None and loc.get("kind") in ("casual", "bigffa", "ranked", "party")
        rows.append({
            "id": uid,
            "username": username,
            "kills": int(s.get("kills", 0) or 0),
            "deaths": int(s.get("deaths", 0) or 0),
            "matches": int(s.get("matches", 0) or 0),
            "rank_points": pts,
            "rank_tier": idx,
            "rank_name": name,
            "rank_division": rank_division_for_points(pts, idx),
            "online": is_online(uid),
            "in_match": in_match,
            "match_kind": loc.get("kind") if loc else None,
            "is_me": uid == me_id,
        })
    return rows




@api.get("/me/season_history")
async def me_season_history(user: dict = Depends(get_current_user)):
    """Return every archived season the signed-in user appeared in
    (top-100 finish), newest first. Powers the "MY PAST SEASONS" widget
    on the Profile page. Each row is the user's own placement + RP at
    the moment the season closed."""
    uid = str(user.get("_id"))
    # Use a $elemMatch query so we only pull seasons that contain *this*
    # user, then filter their row out in Python (small lists ≤ 100 rows
    # each, cheap to scan).
    cursor = db.season_archive.find(
        {"top_100.user_id": uid},
        {"_id": 0, "season_number": 1, "started_at": 1, "ended_at": 1, "top_100": 1},
    ).sort([("season_number", -1)])
    out = []
    async for d in cursor:
        rows = d.get("top_100") or []
        my_row = next((r for r in rows if r.get("user_id") == uid), None)
        if not my_row:
            continue
        # Past-season leaderboards are trimmed to top 50. If the user
        # placed outside the top 50 they aren't part of the visible
        # archive, so hide the row here too — keeps the profile
        # widget consistent with what the leaderboard shows.
        if int(my_row.get("rank", 0) or 0) > 50:
            continue
        out.append({
            "season_number": int(d.get("season_number", 0) or 0),
            "started_at": d.get("started_at").isoformat() if isinstance(d.get("started_at"), datetime) else None,
            "ended_at":   d.get("ended_at").isoformat()   if isinstance(d.get("ended_at"),   datetime) else None,
            "rank": int(my_row.get("rank", 0) or 0),
            "rank_points": int(my_row.get("rank_points", 0) or 0),
            "rank_tier": int(my_row.get("rank_tier", 0) or 0),
            "rank_name": my_row.get("rank_name") or "BRONZE",
            "kills": int(my_row.get("kills", 0) or 0),
            "wins": int(my_row.get("wins", 0) or 0),
        })
    return out


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
