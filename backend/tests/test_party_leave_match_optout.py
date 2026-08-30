"""Regression test — 2026-02-25.

User report: "The leave match just brings you back into game if you are
not the host of the party in custom game."

Root cause: a non-leader follower who exited a Custom Lobby via the
"Leave Match" button was navigated to /lobby, where /party/me still
returned `match_starting=true` (leader was still in the room). The
PartyPanel useEffect fires on that state and re-navigates the follower
back into /play — infinite bounce.

Fix: `/api/party/leave-match` marks the caller as opted-out of the
CURRENT Custom Lobby session. `/party/me` returns
`match_starting=false` for THAT USER ONLY. Cleared by the next
`/api/party/start` so a future custom lobby CAN pull them back in.

These tests exercise the fix directly against the in-memory PARTIES
state so they don't need a live network.
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _seed_party(leader_id: str, follower_id: str, *, match_starting: bool = True) -> str:
    """Create a live 2-member party in PARTIES and PARTY_MEMBER_INDEX."""
    pid = f"test_pid_{leader_id[-4:]}_{follower_id[-4:]}"
    srv.PARTIES[pid] = {
        "party_id": pid,
        "leader_id": leader_id,
        "members": [leader_id, follower_id],
        "match_starting": match_starting,
        "bots_enabled": False,
        "tdm": False,
    }
    srv.PARTY_MEMBER_INDEX[leader_id] = pid
    srv.PARTY_MEMBER_INDEX[follower_id] = pid
    return pid


# 24-char hex ObjectId-format IDs so _party_card's ObjectId() cast doesn't
# throw. The users don't need to exist in Mongo — _party_card returns a
# fallback "(unknown)" card for missing users, which is fine for the
# match_starting mask assertion.
_LID = "aaaaaaaaaaaaaaaaaaaaaaa1"
_FID = "aaaaaaaaaaaaaaaaaaaaaaa2"


def _cleanup_party(pid: str):
    p = srv.PARTIES.pop(pid, None)
    if p:
        for uid in p.get("members", []):
            srv.PARTY_MEMBER_INDEX.pop(uid, None)


# ---------- static / grep guards --------------------------------------


def test_leave_match_endpoint_exists():
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    assert '@api.post("/party/leave-match")' in src, (
        "POST /api/party/leave-match must be registered — it's the "
        "server-side hook the client uses to break the follower's "
        "auto-nav loop."
    )
    assert "async def party_leave_match" in src


def test_party_payload_accepts_for_user_id_arg():
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    assert "async def _party_payload(party_id: str, *, for_user_id" in src, (
        "_party_payload must take a per-user `for_user_id` so the "
        "match_starting mask is applied to the right member only."
    )


def test_party_start_clears_optout_set():
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    # Grep for the exact reset line inside party_start.
    marker = 'async def party_start'
    assert marker in src
    body = src.split(marker, 1)[1][:2000]
    assert 'party["match_optout"] = set()' in body, (
        "party_start must clear the match_optout set — otherwise a "
        "member who exited round 1 can never be pulled back for "
        "round 2's Custom Lobby."
    )


def test_game_page_calls_leave_match_on_exit():
    src = pathlib.Path("/app/frontend/src/pages/Game.jsx").read_text(encoding="utf-8")
    # The exit handler must post to /party/leave-match when the
    # current mode is a party match; without it the backend can't
    # know we've bailed and /party/me will keep returning
    # match_starting=true → PartyPanel re-navigates.
    assert 'api.post("/party/leave-match")' in src, (
        "Game.jsx handleExit must POST /party/leave-match so the "
        "follower's next /party/me poll masks match_starting to false."
    )
    # And it must be gated on party mode so it doesn't fire for
    # casual/ranked/practice exits. Look at the whole handleExit
    # body — the callback in this file is ~50 lines so a 2500-char
    # slice covers it comfortably.
    handle_exit_body = src.split("const handleExit = useCallback", 1)[1][:2500]
    assert 'mode === "party"' in handle_exit_body, (
        "handleExit must gate the leave-match POST on `mode === \"party\"` "
        "so casual/ranked exits don't hit the party endpoint."
    )
    assert '/party/leave-match' in handle_exit_body


# ---------- runtime behaviour ----------------------------------------


def test_party_payload_masks_match_starting_for_opted_out_user():
    pid = _seed_party(_LID, _FID, match_starting=True)
    try:
        # Nobody's opted out yet → both members see match_starting=True.
        p_leader = _run(srv._party_payload(pid, for_user_id=_LID))
        p_follower = _run(srv._party_payload(pid, for_user_id=_FID))
        assert p_leader["match_starting"] is True
        assert p_follower["match_starting"] is True
        # Opt the follower out.
        srv.PARTIES[pid]["match_optout"] = {_FID}
        p_leader = _run(srv._party_payload(pid, for_user_id=_LID))
        p_follower = _run(srv._party_payload(pid, for_user_id=_FID))
        assert p_leader["match_starting"] is True, (
            "Leader must still see match_starting=True — the opt-out "
            "is scoped to the follower who exited."
        )
        assert p_follower["match_starting"] is False, (
            "Follower must see match_starting=False after opt-out, "
            "otherwise the PartyPanel useEffect re-navigates them."
        )
    finally:
        _cleanup_party(pid)


def test_party_payload_without_for_user_returns_raw_flag():
    """Callers that don't know the user (or don't care) get the raw
    match_starting — preserves the legacy contract for admin/debug
    payloads that shouldn't be mutated by per-user masks."""
    pid = _seed_party(_LID, _FID, match_starting=True)
    srv.PARTIES[pid]["match_optout"] = {_FID}
    try:
        payload = _run(srv._party_payload(pid))
        assert payload["match_starting"] is True
    finally:
        _cleanup_party(pid)


def test_party_start_clears_optout_runtime():
    pid = _seed_party(_LID, _FID, match_starting=True)
    srv.PARTIES[pid]["match_optout"] = {_FID}
    try:
        # Simulate leader hitting /party/start for a NEW session.
        # We can't call the endpoint directly without FastAPI, so we
        # inline the same reset that party_start performs. If the
        # source is ever refactored to skip this reset, the grep-guard
        # above (`test_party_start_clears_optout_set`) will fail.
        srv.PARTIES[pid]["match_starting"] = True
        srv.PARTIES[pid]["match_optout"] = set()
        # After reset the follower must see match_starting=True again.
        p_follower = _run(srv._party_payload(pid, for_user_id=_FID))
        assert p_follower["match_starting"] is True
    finally:
        _cleanup_party(pid)
