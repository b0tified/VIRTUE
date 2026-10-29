# Admin-editable mode names: /api/admin/mode_names + /api/modes/status names
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
DEFAULTS = {"casual": "Casual", "ranked": "Ranked", "bigffa": "12P FFA", "party": "Party", "practice": "Practice"}


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
    yield s
    s.post(f"{BASE_URL}/api/admin/mode_names", json={"names": DEFAULTS})


@pytest.fixture(scope="module")
def player():
    return _login("player1@shooter.com", "player123")


def test_get_admin(admin):
    r = admin.get(f"{BASE_URL}/api/admin/mode_names")
    assert r.status_code == 200
    d = r.json()
    assert d["defaults"] == DEFAULTS
    assert set(d["names"].keys()) == set(DEFAULTS)


def test_get_non_admin_403(player):
    assert player.get(f"{BASE_URL}/api/admin/mode_names").status_code == 403


def test_post_non_admin_403(player):
    r = player.post(f"{BASE_URL}/api/admin/mode_names", json={"names": {"casual": "X"}})
    assert r.status_code == 403


def test_unauth_401():
    assert requests.get(f"{BASE_URL}/api/admin/mode_names").status_code in (401, 403)


def test_save_merges_and_status(admin, player):
    admin.post(f"{BASE_URL}/api/admin/mode_names", json={"names": DEFAULTS})
    r = admin.post(f"{BASE_URL}/api/admin/mode_names", json={"names": {"casual": "  Arcade   Fun "}})
    assert r.status_code == 200
    n = r.json()["names"]
    assert n["casual"] == "Arcade Fun"
    assert n["ranked"] == "Ranked" and n["bigffa"] == "12P FFA"
    g = admin.get(f"{BASE_URL}/api/admin/mode_names").json()
    assert g["names"]["casual"] == "Arcade Fun"
    s = player.get(f"{BASE_URL}/api/modes/status")
    assert s.status_code == 200
    assert s.json()["names"]["casual"] == "Arcade Fun"
    r2 = admin.post(f"{BASE_URL}/api/admin/mode_names", json={"names": {"ranked": "Competitive"}})
    assert r2.json()["names"]["casual"] == "Arcade Fun"
    assert r2.json()["names"]["ranked"] == "Competitive"


@pytest.mark.parametrize("payload,code", [
    ({"casual": ""}, 400),
    ({"casual": "   "}, 400),
    ({"casual": "A" * 21}, 400),
    ({"foo": "Bar"}, 400),
])
def test_validation(admin, payload, code):
    before = admin.get(f"{BASE_URL}/api/admin/mode_names").json()["names"]
    r = admin.post(f"{BASE_URL}/api/admin/mode_names", json={"names": payload})
    assert r.status_code == code
    assert isinstance(r.json().get("detail"), str)
    after = admin.get(f"{BASE_URL}/api/admin/mode_names").json()["names"]
    assert before == after


def test_exactly_20_ok(admin):
    r = admin.post(f"{BASE_URL}/api/admin/mode_names", json={"names": {"party": "B" * 20}})
    assert r.status_code == 200 and r.json()["names"]["party"] == "B" * 20


def test_partial_invalid_no_save(admin):
    before = admin.get(f"{BASE_URL}/api/admin/mode_names").json()["names"]
    r = admin.post(f"{BASE_URL}/api/admin/mode_names", json={"names": {"casual": "OKName", "ranked": ""}})
    assert r.status_code == 400
    assert admin.get(f"{BASE_URL}/api/admin/mode_names").json()["names"] == before


def test_db_persisted(admin):
    from pymongo import MongoClient
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    c = MongoClient(env["MONGO_URL"])
    doc = c[env["DB_NAME"]].meta.find_one({"_id": "mode_names"})
    cur = admin.get(f"{BASE_URL}/api/admin/mode_names").json()["names"]
    assert doc and doc["names"] == cur


def test_restore_defaults(admin):
    r = admin.post(f"{BASE_URL}/api/admin/mode_names", json={"names": DEFAULTS})
    assert r.status_code == 200 and r.json()["names"] == DEFAULTS
