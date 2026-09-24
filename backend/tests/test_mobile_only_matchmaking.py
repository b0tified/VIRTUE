"""Backend tests for the Feb-2026 Mobile-Only Matchmaking feature.

Contract:
  - Queue-join POSTs (casual/ranked/bigffa) accept an optional
    `{is_mobile, mobile_only}` body.
  - The matchmaker pairs/dispatches respect `_platforms_compatible`:
    an entry with `mobile_only=True` can only cohort with `is_mobile=True`
    entries.
"""
import time
import uuid

import pytest
import requests

LOCAL = "http://localhost:8001"


def _register(suffix: str) -> tuple[str, str, str]:
    """Register/login a throwaway user; returns (email, username, token)."""
    email = f"TEST_mm_{suffix}@shooter.com"
    username = f"TESTmm{suffix}"[:20]
    r = requests.post(f"{LOCAL}/api/auth/register",
                      json={"email": email, "password": "Passw0rd!", "username": username})
    if r.status_code == 400:
        r = requests.post(f"{LOCAL}/api/auth/login",
                          json={"email": email, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    return email, username, r.json()["access_token"]


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# --- Endpoint payload acceptance ----------------------------------

def test_casual_accepts_mobile_flags():
    _, _, tok = _register(uuid.uuid4().hex[:6])
    hdr = _auth(tok)
    requests.delete(f"{LOCAL}/api/queue/casual", headers=hdr)
    r = requests.post(f"{LOCAL}/api/queue/casual", json={"is_mobile": True, "mobile_only": True}, headers=hdr)
    assert r.status_code == 200, r.text
    requests.delete(f"{LOCAL}/api/queue/casual", headers=hdr)


def test_bigffa_accepts_mobile_flags():
    _, _, tok = _register(uuid.uuid4().hex[:6])
    hdr = _auth(tok)
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)
    r = requests.post(f"{LOCAL}/api/queue/bigffa", json={"is_mobile": True, "mobile_only": True}, headers=hdr)
    assert r.status_code == 200, r.text
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr)


def test_queue_endpoints_still_accept_empty_body():
    """Legacy clients (no payload) must still work — default flags are False."""
    _, _, tok = _register(uuid.uuid4().hex[:6])
    hdr = _auth(tok)
    requests.delete(f"{LOCAL}/api/queue/casual", headers=hdr)
    r = requests.post(f"{LOCAL}/api/queue/casual", headers=hdr)
    assert r.status_code == 200
    requests.delete(f"{LOCAL}/api/queue/casual", headers=hdr)


# --- `_platforms_compatible` unit tests ---------------------------

def test_platforms_compat_unit():
    """Direct unit test on the helper: mobile-only can't cohort with a
    desktop entry, but two mobile entries (regardless of flag combo)
    always can, and two desktop entries always can."""
    import importlib
    server = importlib.import_module("server")
    compat = server._platforms_compatible
    # Both desktop, no restrictions → compatible.
    assert compat({"is_mobile": False, "mobile_only": False},
                  {"is_mobile": False, "mobile_only": False}) is True
    # Mobile-only vs desktop → incompatible.
    assert compat({"is_mobile": True, "mobile_only": True},
                  {"is_mobile": False, "mobile_only": False}) is False
    # Reverse: desktop vs mobile-only mobile → incompatible.
    assert compat({"is_mobile": False, "mobile_only": False},
                  {"is_mobile": True, "mobile_only": True}) is False
    # Two mobile players, one restricted, one not → still compatible.
    assert compat({"is_mobile": True, "mobile_only": True},
                  {"is_mobile": True, "mobile_only": False}) is True
    # Two mobile-only mobile players → compatible.
    assert compat({"is_mobile": True, "mobile_only": True},
                  {"is_mobile": True, "mobile_only": True}) is True
    # Non-mobile-only mobile user vs desktop → compatible (they don't care).
    assert compat({"is_mobile": True, "mobile_only": False},
                  {"is_mobile": False, "mobile_only": False}) is True


# --- BigFFA dispatch respects platform preference -----------------

def test_bigffa_mobile_only_gets_own_match():
    """A mobile-only mobile user in the bigffa queue does NOT get
    dispatched into the same match as a desktop-only queuer, even after
    the 60s timeout elapses. Each ends up with a distinct `match_id`."""
    _, _, tok_mobile = _register(uuid.uuid4().hex[:6])
    _, _, tok_desktop = _register(uuid.uuid4().hex[:6])
    hdr_m = _auth(tok_mobile)
    hdr_d = _auth(tok_desktop)
    # Clean any stale state.
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr_m)
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr_d)
    # Mobile-only enqueues first.
    r_m = requests.post(f"{LOCAL}/api/queue/bigffa",
                       json={"is_mobile": True, "mobile_only": True},
                       headers=hdr_m)
    assert r_m.status_code == 200
    # Desktop queues right after.
    r_d = requests.post(f"{LOCAL}/api/queue/bigffa",
                       json={"is_mobile": False, "mobile_only": False},
                       headers=hdr_d)
    assert r_d.status_code == 200
    # Poll both for up to 75s. Both should eventually get `matched:true`
    # via the BIGFFA_BOT_FILL_SEC timeout, and their match_ids must differ.
    mid_m: str | None = None
    mid_d: str | None = None
    deadline = time.monotonic() + 75
    while time.monotonic() < deadline and (mid_m is None or mid_d is None):
        if mid_m is None:
            j = requests.get(f"{LOCAL}/api/queue/bigffa", headers=hdr_m).json()
            if j.get("matched"):
                mid_m = j.get("match_id")
        if mid_d is None:
            j = requests.get(f"{LOCAL}/api/queue/bigffa", headers=hdr_d).json()
            if j.get("matched"):
                mid_d = j.get("match_id")
        time.sleep(2)
    # Clean up matched state.
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr_m)
    requests.delete(f"{LOCAL}/api/queue/bigffa", headers=hdr_d)
    assert mid_m is not None, "mobile-only queuer never got matched"
    assert mid_d is not None, "desktop queuer never got matched"
    assert mid_m != mid_d, (
        f"mobile-only + desktop ended up in the same match ({mid_m}) — "
        "platform partition failed"
    )
