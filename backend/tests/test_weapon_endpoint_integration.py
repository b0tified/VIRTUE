"""HTTP integration tests for /api/profile/me/weapon.

Covers the frontend contract:
  - POST {weapon: 'sniper'} -> 200, saved
  - POST {weapon: 'ak47'}   -> 200, saved
  - POST {weapon: 'rocket'} -> 400
  - GET /api/profile/me returns primary_weapon reflecting last write
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend/.env for CLI runs
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "player1@shooter.com", "password": "player123"},
                      timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _get_profile(auth_headers):
    r = requests.get(f"{BASE_URL}/api/profile/me", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    return r.json()


def test_set_sniper_then_get(auth_headers):
    r = requests.post(f"{BASE_URL}/api/profile/me/weapon",
                      headers=auth_headers, json={"weapon": "sniper"}, timeout=10)
    assert r.status_code == 200, r.text
    prof = _get_profile(auth_headers)
    # profile shape may be flat or nested
    pw = prof.get("primary_weapon") or prof.get("user", {}).get("primary_weapon")
    assert pw == "sniper", f"expected sniper, got {pw} — profile={prof}"


def test_set_ak47_then_get(auth_headers):
    r = requests.post(f"{BASE_URL}/api/profile/me/weapon",
                      headers=auth_headers, json={"weapon": "ak47"}, timeout=10)
    assert r.status_code == 200, r.text
    prof = _get_profile(auth_headers)
    pw = prof.get("primary_weapon") or prof.get("user", {}).get("primary_weapon")
    assert pw == "ak47", f"expected ak47, got {pw}"


def test_invalid_weapon_rejected(auth_headers):
    r = requests.post(f"{BASE_URL}/api/profile/me/weapon",
                      headers=auth_headers, json={"weapon": "rocket"}, timeout=10)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_unauthenticated_rejected():
    r = requests.post(f"{BASE_URL}/api/profile/me/weapon",
                      json={"weapon": "sniper"}, timeout=10)
    assert r.status_code in (401, 403)
