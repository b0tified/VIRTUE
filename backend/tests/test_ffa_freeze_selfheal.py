"""Regression: mobile-FFA pre-match freeze self-heal.

Reported symptom: on Quick Match FFA, mobile clients experience the
same freeze as ranked previously — bots move + shoot, damage arrows
fire, audio plays, but the local player can't move/shoot because
`_matchStarted` stays false. TDM does not exhibit the same issue.

This test locks in the invariant that a state broadcast fired
immediately after `_begin_match_now` MUST include `match_started=True`
in `top_full` for FFA rooms — the same self-heal contract the ranked
tests already cover.
"""
import asyncio
import json
import sys
import time
import uuid

import pytest

sys.path.insert(0, "/app/backend")
import server as srv  # noqa: E402


class SpyWS:
    def __init__(self):
        self.sent: list = []

    async def send_text(self, text: str):
        try:
            self.sent.append(json.loads(text))
        except Exception:
            self.sent.append({"_raw": text})


def _real_player(name: str, ws: SpyWS) -> srv.Player:
    p = srv.Player(ws=ws, is_bot=True, bot_name=name)
    p.is_bot = False
    p.ws = ws
    p.user_id = str(uuid.uuid4())
    p.username = name
    p.is_loaded = True
    p.alive = True
    p.hp = p.max_hp
    return p


def _state_frames(ws: SpyWS) -> list:
    return [m for m in ws.sent if m.get("type") in ("state", "state_delta")]


@pytest.mark.asyncio
async def test_ffa_state_carries_match_started_after_begin_now():
    """Quick Match FFA room: state broadcast fired right after
    `_begin_match_now` must include `match_started=True` so a mobile
    client that dropped the one-shot `match_go` self-heals on the
    next state frame."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")
    ws = SpyWS()
    p = _real_player("mobffa", ws)
    await room.add(p)
    await room._begin_match_now()
    ws.sent.clear()
    await room.tick()
    frames = _state_frames(ws)
    assert frames, f"expected a state frame, got {ws.sent!r}"
    frame = frames[0]
    assert frame.get("match_started") is True, (
        f"FFA state broadcast must carry match_started=True after "
        f"_begin_match_now; frame={frame!r}"
    )


@pytest.mark.asyncio
async def test_ffa_state_after_intermission_still_carries_match_started():
    """Simulates the between-round transition in the shared FFA room:
    end_match cached match_started=True in `_last_sent_top`, then
    intermission + reset flipped it to False (during which no state
    broadcasts ran), then `_begin_match_now` flipped it back to True.
    On the next tick the delta might omit `match_started` (since the
    cached value never actually changed on the wire), so we rely on
    the keyframe cadence to re-assert the truth. Validate that the
    first post-freeze frame is a keyframe carrying match_started."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")
    ws = SpyWS()
    p = _real_player("mobffa2", ws)
    await room.add(p)
    # Round 1: normal play. Broadcast a state so caches are populated.
    await room._begin_match_now()
    await room.tick()
    # Simulate the round-end + intermission + reset dance. `_last_sent_top`
    # keeps `match_started=True` since tick was NOT called during
    # the intermission/freeze (see `run()` gate).
    room.in_intermission = True
    # Between-round reset would flip these Python-side without broadcasting:
    room.match_started = False
    room.countdown_until = None
    room.in_intermission = False
    # Now the freeze ends and match starts fresh.
    await room._begin_match_now()
    # Force the keyframe cadence to fire on the next tick by pretending
    # a full second has passed since the last keyframe (mirrors the
    # real 3s countdown + 10s intermission gap).
    room._last_keyframe_at = time.time() - 5.0
    ws.sent.clear()
    await room.tick()
    frames = _state_frames(ws)
    assert frames, f"expected a state frame, got {ws.sent!r}"
    frame = frames[0]
    # Whether keyframe or delta, the invariant is: after a freeze
    # transition, the client MUST see match_started=True on the wire
    # within one tick — otherwise a missed match_go leaves them
    # frozen forever.
    assert frame.get("match_started") is True, (
        f"FFA post-freeze frame must carry match_started=True; "
        f"frame_type={frame.get('type')} full_frame={frame!r}"
    )


@pytest.mark.asyncio
async def test_ffa_state_delta_always_carries_match_started():
    """Belt-and-suspenders invariant: EVERY state (or state_delta)
    frame from a running room now surfaces `match_started` in the
    top-level, even when unchanged. This guarantees a mobile client
    that dropped `match_go` self-heals on the very next tick (~50ms)
    instead of waiting up to 1s for the keyframe."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")
    ws = SpyWS()
    p = _real_player("mobffa3", ws)
    await room.add(p)
    await room._begin_match_now()
    await room.tick()  # keyframe
    ws.sent.clear()
    await room.tick()  # delta — should still carry match_started
    frames = _state_frames(ws)
    assert frames
    assert frames[0].get("match_started") is True, (
        f"delta must always carry match_started for FFA self-heal: {frames[0]!r}"
    )
    assert "countdown_until" in frames[0], (
        f"delta must always carry countdown_until too: {frames[0]!r}"
    )


@pytest.mark.asyncio
async def test_ffa_first_post_freeze_frame_is_a_keyframe():
    """After a pre-match freeze ends (no state broadcasts during the
    3s countdown), the very NEXT tick should produce a keyframe
    because the keyframe cadence has elapsed. This is the load-bearing
    invariant for the mobile self-heal — without it, a missed
    `match_go` would leave the client frozen up to 1s waiting for the
    next keyframe. Confirm it fires immediately."""
    room = srv.GameRoom(is_ranked=False, match_duration=60.0, game_mode="ffa")
    ws = SpyWS()
    p = _real_player("mobffa4", ws)
    await room.add(p)
    # Simulate the pre-match freeze — set match_started=False and
    # keep the last-keyframe timestamp stale (mirrors "no broadcasts
    # during the freeze"). Then flip to True and tick.
    room.match_started = False
    room._last_keyframe_at = time.time() - 5.0
    room.match_started = True
    ws.sent.clear()
    await room.tick()
    frames = _state_frames(ws)
    assert frames
    assert frames[0].get("type") == "state", (
        f"Expected keyframe as first post-freeze frame, got {frames[0].get('type')}"
    )
    assert frames[0].get("match_started") is True
