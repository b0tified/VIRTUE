# Bot Loadout admin API tests (GET/POST /api/admin/bot_loadout)
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
DEFAULTS = {"sniper_low": 6, "sniper_high": 45, "laser": 15}


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def admin():
    s = _login("admin@shooter.com", "admin123")
    orig = s.get(f"{BASE_URL}/api/admin/bot_loadout").json()
    yield s
    s.post(f"{BASE_URL}/api/admin/bot_loadout", json=orig)


@pytest.fixture(scope="module")
def player():
    return _login("player1@shooter.com", "player123")


def test_get_admin(admin):
    r = admin.get(f"{BASE_URL}/api/admin/bot_loadout")
    assert r.status_code == 200
    d = r.json()
    assert set(d) >= {"sniper_low", "sniper_high", "laser"}


def test_player_forbidden(player):
    assert player.get(f"{BASE_URL}/api/admin/bot_loadout").status_code == 403
    assert player.post(f"{BASE_URL}/api/admin/bot_loadout", json=DEFAULTS).status_code == 403


def test_unauth():
    assert requests.get(f"{BASE_URL}/api/admin/bot_loadout").status_code in (401, 403)


def test_set_and_persist(admin):
    p = {"sniper_low": 10, "sniper_high": 50, "laser": 30}
    r = admin.post(f"{BASE_URL}/api/admin/bot_loadout", json=p)
    assert r.status_code == 200
    assert r.json() == {k: float(v) for k, v in p.items()}
    g = admin.get(f"{BASE_URL}/api/admin/bot_loadout").json()
    assert g["sniper_high"] == 50 and g["laser"] == 30


@pytest.mark.parametrize("p", [
    {"sniper_low": 0, "sniper_high": 90, "laser": 20},
    {"sniper_low": 95, "sniper_high": 0, "laser": 10},
])
def test_sum_over_100_rejected(admin, p):
    r = admin.post(f"{BASE_URL}/api/admin/bot_loadout", json=p)
    assert r.status_code == 400
    assert "100" in r.json().get("detail", "")


@pytest.mark.parametrize("p", [
    {"sniper_low": -1, "sniper_high": 10, "laser": 10},
    {"sniper_low": 1, "sniper_high": 101, "laser": 0},
    {"sniper_low": 1, "sniper_high": 10},
])
def test_invalid_fields(admin, p):
    assert admin.post(f"{BASE_URL}/api/admin/bot_loadout", json=p).status_code == 422


def test_boundary_100_ok(admin):
    r = admin.post(f"{BASE_URL}/api/admin/bot_loadout", json={"sniper_low": 0, "sniper_high": 60, "laser": 40})
    assert r.status_code == 200
