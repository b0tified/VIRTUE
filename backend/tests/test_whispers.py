"""Whisper (1:1 friend DM) API tests.

Three endpoints under test:
  POST /api/whispers/send                — create a message
  GET  /api/whispers/conversation/{user} — fetch + mark-read
  GET  /api/whispers/unread              — per-sender unread counts

Rules enforced:
  - Can't whisper yourself (400).
  - Can't whisper if either side blocked the other (403).
  - 20 sends/min rate cap (429).
  - Length 1..280 (422 outside range).
  - Conversation fetch marks INBOUND messages read but leaves
    OUTBOUND read-state untouched (read receipt belongs to recipient).
"""
import sys
import pathlib

import pytest
import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402

LOCAL = "http://127.0.0.1:8001"


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def _register(username: str, email: str):
    """Register a fresh user (or fetch existing token by logging in
    with the password 'pw1234567'). Normalizes the response shape so
    each helper exposes `tok` regardless of which endpoint was used."""
    r = requests.post(f"{LOCAL}/api/auth/register", json={
        "username": username, "email": email, "password": "pw1234567",
    })
    if r.status_code == 200:
        d = r.json()
        return {"user": d["user"], "tok": d["access_token"]}
    r = requests.post(f"{LOCAL}/api/auth/login", json={
        "email": email, "password": "pw1234567",
    })
    assert r.status_code == 200, r.text
    d = r.json()
    return {"user": d["user"], "tok": d["access_token"]}


@pytest.fixture(scope="module")
def two_users():
    import uuid
    sa = uuid.uuid4().hex[:6]
    sb = uuid.uuid4().hex[:6]
    a = _register(f"WhA{sa}", f"wha{sa}@e.com")
    b = _register(f"WhB{sb}", f"whb{sb}@e.com")
    return {"a": a, "b": b}


def test_send_and_fetch_conversation(two_users):
    a = two_users["a"]; b = two_users["b"]
    # A → B
    r = requests.post(f"{LOCAL}/api/whispers/send",
                      json={"username": b["user"]["username"], "text": "hello B!"},
                      headers=_auth(a["tok"]))
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["text"] == "hello B!"
    assert msg["from_id"] == a["user"]["id"]
    assert msg["to_id"] == b["user"]["id"]
    assert msg["read_by_recipient"] is False

    # B fetches conversation with A → marks A's message read + returns it.
    r = requests.get(f"{LOCAL}/api/whispers/conversation/{a['user']['username']}",
                     headers=_auth(b["tok"]))
    assert r.status_code == 200
    data = r.json()
    assert data["friend"]["username"] == a["user"]["username"]
    msgs = data["messages"]
    assert any(m["text"] == "hello B!" for m in msgs)
    # `from_me` is from B's POV — A's message should NOT be from_me.
    hello = next(m for m in msgs if m["text"] == "hello B!")
    assert hello["from_me"] is False


def test_self_whisper_rejected(two_users):
    a = two_users["a"]
    r = requests.post(f"{LOCAL}/api/whispers/send",
                      json={"username": a["user"]["username"], "text": "myself"},
                      headers=_auth(a["tok"]))
    assert r.status_code == 400


def test_unknown_user_rejected(two_users):
    a = two_users["a"]
    r = requests.post(f"{LOCAL}/api/whispers/send",
                      json={"username": "ghost_user_zzz_404", "text": "hi"},
                      headers=_auth(a["tok"]))
    assert r.status_code == 404


def test_text_length_bounds(two_users):
    a = two_users["a"]; b = two_users["b"]
    # Empty / too short
    r = requests.post(f"{LOCAL}/api/whispers/send",
                      json={"username": b["user"]["username"], "text": ""},
                      headers=_auth(a["tok"]))
    assert r.status_code == 422
    # Too long
    r = requests.post(f"{LOCAL}/api/whispers/send",
                      json={"username": b["user"]["username"], "text": "x" * 281},
                      headers=_auth(a["tok"]))
    assert r.status_code == 422


def test_unread_count_per_sender(two_users):
    a = two_users["a"]; b = two_users["b"]
    # First clear B's unread map by fetching the conversation.
    requests.get(f"{LOCAL}/api/whispers/conversation/{a['user']['username']}",
                 headers=_auth(b["tok"]))
    # Now A sends 3 new messages to B.
    for i in range(3):
        r = requests.post(f"{LOCAL}/api/whispers/send",
                          json={"username": b["user"]["username"], "text": f"ping{i}"},
                          headers=_auth(a["tok"]))
        assert r.status_code == 200, r.text
    # B checks unread counts.
    r = requests.get(f"{LOCAL}/api/whispers/unread", headers=_auth(b["tok"]))
    assert r.status_code == 200
    data = r.json()
    assert data["by_sender"].get(a["user"]["id"]) == 3
    assert data["total"] >= 3
    # Fetching the conversation marks them read.
    requests.get(f"{LOCAL}/api/whispers/conversation/{a['user']['username']}",
                 headers=_auth(b["tok"]))
    r = requests.get(f"{LOCAL}/api/whispers/unread", headers=_auth(b["tok"]))
    assert r.status_code == 200
    assert r.json()["by_sender"].get(a["user"]["id"], 0) == 0


def test_blocked_either_way_rejects_whisper(two_users):
    a = two_users["a"]; b = two_users["b"]
    # B blocks A
    r = requests.post(f"{LOCAL}/api/friends/block",
                      json={"username": a["user"]["username"]},
                      headers=_auth(b["tok"]))
    assert r.status_code == 200, r.text
    # A tries to whisper B → 403
    r = requests.post(f"{LOCAL}/api/whispers/send",
                      json={"username": b["user"]["username"], "text": "blocked test"},
                      headers=_auth(a["tok"]))
    assert r.status_code == 403, r.text
    # B tries to whisper A → also 403 (bilateral)
    r = requests.post(f"{LOCAL}/api/whispers/send",
                      json={"username": a["user"]["username"], "text": "also blocked"},
                      headers=_auth(b["tok"]))
    assert r.status_code == 403, r.text
    # Cleanup: B unblocks A so subsequent tests can still talk.
    requests.post(f"{LOCAL}/api/friends/unblock",
                  json={"username": a["user"]["username"]},
                  headers=_auth(b["tok"]))
