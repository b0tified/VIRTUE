# Custom shop titles (admin Title Maker) — admin CRUD, shop listing/buy, equip, banner serialization
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s, r.json()["user"]


@pytest.fixture(scope="module")
def admin():
    return _login("admin@shooter.com", "admin123")[0]


@pytest.fixture(scope="module")
def player():
    return _login("player1@shooter.com", "player123")


@pytest.fixture(scope="module")
def created(admin):
    ids = []
    yield ids
    for i in ids:
        admin.delete(f"{BASE_URL}/api/admin/titles/{i}")


def _mk(admin, created, **kw):
    body = {"text": "TEST_t", "color": "#00ff88", "style": "shimmer", "price": 5, "active": True}
    body.update(kw)
    r = admin.post(f"{BASE_URL}/api/admin/titles", json=body)
    if r.status_code == 200:
        created.append(r.json()["id"])
    return r


# Admin auth gating
def test_player_forbidden(player):
    s, _ = player
    assert s.get(f"{BASE_URL}/api/admin/titles").status_code == 403
    assert s.post(f"{BASE_URL}/api/admin/titles", json={"text": "X", "color": "#FFFFFF", "price": 1}).status_code == 403
    assert s.put(f"{BASE_URL}/api/admin/titles/abc", json={"text": "X", "color": "#FFFFFF", "price": 1}).status_code == 403
    assert s.delete(f"{BASE_URL}/api/admin/titles/abc").status_code == 403


def test_unauth():
    assert requests.get(f"{BASE_URL}/api/admin/titles").status_code in (401, 403)
    assert requests.get(f"{BASE_URL}/api/shop/titles").status_code in (401, 403)


# Validation
@pytest.mark.parametrize("bad", [
    {"color": "red"}, {"color": "#12345"}, {"style": "glow"}, {"text": ""}, {"text": "A" * 25},
    {"price": -1}, {"ends_at": "not-a-date"}, {"text": "   "},
])
def test_create_validation(admin, created, bad):
    r = _mk(admin, created, **bad)
    assert r.status_code in (400, 422), (bad, r.status_code, r.text)


# Create -> list, uppercase, owners count
def test_create_and_list(admin, created):
    r = _mk(admin, created, text="test_alpha", color="#abcdef", price=0)
    assert r.status_code == 200
    d = r.json()
    assert d["text"] == "TEST_ALPHA" and d["color"] == "#ABCDEF" and d["style"] == "shimmer"
    assert d["ends_at"] is None and d["active"] is True
    lst = admin.get(f"{BASE_URL}/api/admin/titles").json()["titles"]
    row = next(t for t in lst if t["id"] == d["id"])
    assert row["owners"] == 0


def test_update_and_404(admin, created):
    tid = _mk(admin, created, text="TEST_UPD").json()["id"]
    r = admin.put(f"{BASE_URL}/api/admin/titles/{tid}",
                  json={"text": "test_upd2", "color": "#112233", "style": "rainbow", "price": 7, "active": False})
    assert r.status_code == 200 and r.json()["text"] == "TEST_UPD2" and r.json()["active"] is False
    row = next(t for t in admin.get(f"{BASE_URL}/api/admin/titles").json()["titles"] if t["id"] == tid)
    assert row["price"] == 7 and row["style"] == "rainbow"
    assert admin.put(f"{BASE_URL}/api/admin/titles/nope", json={"text": "X", "color": "#FFFFFF", "price": 1}).status_code == 404
    assert admin.delete(f"{BASE_URL}/api/admin/titles/nope").status_code == 404


# Shop visibility: expired/hidden excluded, future end listed
def test_shop_visibility(admin, player, created):
    s, _ = player
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    fut = (datetime.now(timezone.utc) + timedelta(days=2, hours=3)).isoformat()
    exp = _mk(admin, created, text="TEST_EXP", ends_at=past).json()["id"]
    hid = _mk(admin, created, text="TEST_HID", active=False).json()["id"]
    lim = _mk(admin, created, text="TEST_LIM", ends_at=fut).json()["id"]
    ids = {t["id"] for t in s.get(f"{BASE_URL}/api/shop/titles").json()["titles"]}
    assert exp not in ids and hid not in ids and lim in ids
    # buy hidden/expired -> 404
    assert s.post(f"{BASE_URL}/api/shop/titles/buy", json={"title_id": exp}).status_code == 404
    assert s.post(f"{BASE_URL}/api/shop/titles/buy", json={"title_id": hid}).status_code == 404


# Buy / re-buy / insufficient / equip / unequip / season clears / delete cleanup
def test_full_purchase_flow(admin, player, created):
    s, puser = player
    before = s.get(f"{BASE_URL}/api/shop/titles").json()
    coins0 = before["coins"]
    tid = _mk(admin, created, text="TEST_BUY", price=3, style="rainbow", color="#FF0000").json()["id"]
    r = s.post(f"{BASE_URL}/api/shop/titles/buy", json={"title_id": tid})
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["custom_title"]["id"] == tid and u["custom_title"]["text"] == "TEST_BUY"
    assert tid in u["owned_titles"]
    after = s.get(f"{BASE_URL}/api/shop/titles").json()
    assert after["coins"] == coins0 - 3 and after["equipped"] == tid
    assert s.post(f"{BASE_URL}/api/shop/titles/buy", json={"title_id": tid}).status_code == 409
    # /auth/me
    me = s.get(f"{BASE_URL}/api/auth/me").json()
    me = me.get("user", me)
    assert me["custom_title"] == {"id": tid, "text": "TEST_BUY", "color": "#FF0000", "style": "rainbow"}
    # public profile
    pub = s.get(f"{BASE_URL}/api/users/{puser['username']}/profile")
    assert pub.status_code == 200
    pj = pub.json()
    pj = pj.get("user", pj)
    assert (pj.get("custom_title") or {}).get("id") == tid, pj.get("custom_title")
    # owners count
    row = next(t for t in admin.get(f"{BASE_URL}/api/admin/titles").json()["titles"] if t["id"] == tid)
    assert row["owners"] == 1
    # hidden but owned still listed
    admin.put(f"{BASE_URL}/api/admin/titles/{tid}", json={"text": "TEST_BUY", "color": "#FF0000", "style": "rainbow", "price": 3, "active": False})
    st = s.get(f"{BASE_URL}/api/shop/titles").json()["titles"]
    assert any(t["id"] == tid and t["owned"] for t in st)
    # unequip
    r = s.post(f"{BASE_URL}/api/profile/me/custom_title", json={"title_id": None})
    assert r.status_code == 200 and r.json()["custom_title"] is None
    # re-equip
    r = s.post(f"{BASE_URL}/api/profile/me/custom_title", json={"title_id": tid})
    assert r.status_code == 200 and r.json()["custom_title"]["id"] == tid
    # equip not owned -> 403
    other = _mk(admin, created, text="TEST_NOTOWN").json()["id"]
    assert s.post(f"{BASE_URL}/api/profile/me/custom_title", json={"title_id": other}).status_code == 403
    # insufficient coins
    pricey = _mk(admin, created, text="TEST_PRICEY", price=999999).json()["id"]
    assert s.post(f"{BASE_URL}/api/shop/titles/buy", json={"title_id": pricey}).status_code == 402
    # delete -> removed from owners, unequipped
    assert admin.delete(f"{BASE_URL}/api/admin/titles/{tid}").status_code == 200
    created.remove(tid)
    me = s.get(f"{BASE_URL}/api/auth/me").json()
    me = me.get("user", me)
    assert me["custom_title"] is None and tid not in me["owned_titles"]


def test_season_title_clears_custom(admin, created):
    # admin has past_seasons; buy free title then equip season title
    tid = _mk(admin, created, text="TEST_SEAS", price=0).json()["id"]
    r = admin.post(f"{BASE_URL}/api/shop/titles/buy", json={"title_id": tid})
    assert r.status_code == 200
    seasons = r.json()["user"].get("past_seasons") or []
    if not seasons:
        pytest.skip("admin has no past seasons")
    r = admin.post(f"{BASE_URL}/api/profile/me/title", json={"season": seasons[0]["season"]})
    assert r.status_code == 200, r.text
    assert r.json()["custom_title"] is None
    me = admin.get(f"{BASE_URL}/api/auth/me").json()
    me = me.get("user", me)
    assert me["custom_title"] is None
