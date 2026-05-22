"""Tests for the per-player `platform` field added for scoreboard icons.

Covers:
- Each player's `to_state()` includes a `platform` field.
- Bots default to platform="bot".
- Real players default to platform="pc".
- A `set_platform` message updates the player's platform to "mobile" or
  "controller" (and rejects unknown values).
"""
import asyncio
import json

import pytest
import requests
import websockets


LOCAL = "http://localhost:8001"
WS = "ws://localhost:8001"


def _register_or_login(suffix: str):
    body = {
        "email": f"TEST_plat_{suffix}@shooter.com",
        "password": "Passw0rd!",
        "username": f"TESTplat{suffix}"[:20],
    }
    r = requests.post(f"{LOCAL}/api/auth/register", json=body)
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": body["email"], "password": body["password"]})
    return r.json()["access_token"], r.json()["user"]


async def _connect_and_get_state(token: str, *, set_platform=None, mode="casual"):
    url = f"{WS}/api/ws/game?token={token}&mode={mode}"
    async with websockets.connect(url) as ws:
        welcome = json.loads(await ws.recv())
        if set_platform is not None:
            await ws.send(json.dumps({"type": "set_platform", "platform": set_platform}))
        for _ in range(15):
            msg = json.loads(await ws.recv())
            if msg.get("type") == "state":
                me = next((p for p in msg["players"]
                           if p["id"] == welcome["you"]["id"]), None)
                bot = next((p for p in msg["players"] if p.get("is_bot")), None)
                return welcome, me, bot, msg
        raise RuntimeError("Never received state")


def test_default_platform_is_pc_and_bot_is_bot():
    tok, _ = _register_or_login("default")
    welcome, me, bot, _ = asyncio.run(_connect_and_get_state(tok))
    assert welcome["you"].get("platform") == "pc"
    assert me is not None
    assert me["platform"] == "pc"
    assert bot is not None
    assert bot["platform"] == "bot"


def test_set_platform_mobile_and_controller_persists():
    tok, _ = _register_or_login("mobile")
    _, me, _, _ = asyncio.run(_connect_and_get_state(tok, set_platform="mobile"))
    assert me["platform"] == "mobile"

    tok2, _ = _register_or_login("ctrl")
    _, me2, _, _ = asyncio.run(_connect_and_get_state(tok2, set_platform="controller"))
    assert me2["platform"] == "controller"


def test_set_platform_rejects_unknown_value():
    tok, _ = _register_or_login("bogus")
    _, me, _, _ = asyncio.run(_connect_and_get_state(tok, set_platform="xbox360"))
    # Server must keep the default ("pc"), not adopt the unknown value.
    assert me["platform"] == "pc"


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
