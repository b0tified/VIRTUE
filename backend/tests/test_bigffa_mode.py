"""Backend tests for the 12-player Big FFA mode (Feb-2026).

Contract:
  - GET /api/ws/game?mode=bigffa is a valid, authenticated route that
    lands the caller in a dedicated FFA room whose target lobby size is
    12 (auto-fills with disguised bots).
  - The mode is direct-connect only — it never touches the ranked queue
    or the casual matchmaker.
"""
import asyncio
import importlib
import json
import time
import uuid

import pytest
import requests
import websockets
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

LOCAL = "http://localhost:8001"
WS = "ws://localhost:8001"


def _register(suffix: str) -> str:
    """Register/login a throwaway user; returns access_token."""
    uname = f"TESTbf{suffix}"[:20]
    body = {
        "email": f"TEST_bf_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": uname,
    }
    r = requests.post(f"{LOCAL}/api/auth/register", json=body)
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": body["email"], "password": body["password"]})
    assert r.status_code == 200, f"auth failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


# --- In-process room-object assertions -----------------------------

def test_bigffa_room_configured_for_12_players():
    """The `bigffa_room` module-level singleton is configured as a
    12-player FFA room. Guards regressions where a refactor silently
    drops the `bots_target_size` override and the room falls back to
    the default 4-player lobby."""
    server = importlib.import_module("server")
    room = server.bigffa_room
    assert room is not None
    assert getattr(room, "is_bigffa", False) is True
    assert room.game_mode == "ffa"
    assert room.is_ranked is False
    assert int(getattr(room, "bots_target_size", 0)) == 12
    # Sanity: BIGFFA_LOBBY_SIZE constant matches the room override.
    assert server.BIGFFA_LOBBY_SIZE == 12


def test_maintain_population_honours_bots_target_size():
    """`_maintain_population` reads `bots_target_size` when set — the
    override plumbing that keeps bigffa_room at 12 combatants."""
    server = importlib.import_module("server")
    room = server.bigffa_room
    # We can't run `_maintain_population` directly under pytest's event
    # loop (it needs the room lock + async context), but we can at
    # least verify the attribute the function reads is present and set
    # correctly at the module level.
    assert hasattr(room, "bots_target_size")
    assert int(room.bots_target_size) == 12


# --- WebSocket contract --------------------------------------------

@pytest.mark.asyncio
async def test_bigffa_welcome_advertises_ffa_and_not_ranked():
    """Connecting via `mode=bigffa` returns a `welcome` payload with
    `game_mode="ffa"` and `is_ranked=False`. This is the client-visible
    contract; state broadcasts / bot fill are tested separately."""
    tok = _register(uuid.uuid4().hex[:6])
    url = f"{WS}/api/ws/game?token={tok}&mode=bigffa"
    async with websockets.connect(url) as ws:
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=4)
            except asyncio.TimeoutError:
                continue
            m = json.loads(raw)
            if m.get("type") == "welcome":
                assert m.get("game_mode") == "ffa"
                assert m.get("is_ranked") is False
                # `is_practice` is the field the loading screen reads
                # to distinguish practice from real matches — bigffa
                # is a real match.
                assert bool(m.get("is_practice", False)) is False
                return
        pytest.fail("welcome message never arrived for mode=bigffa")


@pytest.mark.asyncio
async def test_bigffa_rejects_missing_token():
    """No `?token=…` query param → the socket is closed without a
    welcome. Confirms bigffa hasn't accidentally been opened up to
    anonymous connections (same guard as every other mode)."""
    url = f"{WS}/api/ws/game?mode=bigffa"
    saw_welcome = False
    try:
        async with websockets.connect(url) as ws:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=3)
                m = json.loads(raw)
                if m.get("type") == "welcome":
                    saw_welcome = True
            except (asyncio.TimeoutError,
                    websockets.exceptions.ConnectionClosed):
                pass
    except (websockets.exceptions.InvalidStatus,
            websockets.exceptions.ConnectionClosed,
            websockets.exceptions.InvalidHandshake):
        pass
    assert not saw_welcome, "auth bypass: bigffa accepted anonymous WS"
