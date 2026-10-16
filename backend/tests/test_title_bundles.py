# Title Bundles (admin bundle maker + shop bundles listing/buy) regression tests
import os
import uuid
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
def fresh_user():
    # brand-new account (owns nothing, low coins)
    tag = uuid.uuid4().hex[:8]
    email = f"test_bundle_{tag}@test.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "pw123456", "username": f"tb{tag}"})
    assert r.status_code in (200, 201), r.text
    return _login(email, "pw123456")


@pytest.fixture(scope="module")
def created(admin):
    ids = {"titles": [], "bundles": []}
    yield ids
    for b in ids["bundles"]:
        admin.delete(f"{BASE_URL}/api/admin/title_bundles/{b}")
    for t in ids["titles"]:
        admin.delete(f"{BASE_URL}/api/admin/titles/{t}")


def _mk_title(admin, created, **kw):
    body = {"text": "TEST_BT", "color": "#00FF88", "style": "plain", "price": 10, "active": True}
    body.update(kw)
    r = admin.post(f"{BASE_URL}/api/admin/titles", json=body)
    assert r.status_code == 200, r.text
    created["titles"].append(r.json()["id"])
    return r.json()


def _mk_bundle(admin, created, **kw):
    r = admin.post(f"{BASE_URL}/api/admin/title_bundles", json=kw)
    if r.status_code == 200:
        created["bundles"].append(r.json()["id"])
    return r


# Auth gating
def test_bundle_admin_forbidden(player):
    s, _ = player
    assert s.get(f"{BASE_URL}/api/admin/title_bundles").status_code == 403
    assert s.post(f"{BASE_URL}/api/admin/title_bundles", json={"title_id": "x", "skin_id": "neon", "price": 1}).status_code == 403
    assert s.put(f"{BASE_URL}/api/admin/title_bundles/x", json={"title_id": "x", "skin_id": "neon", "price": 1}).status_code == 403
    assert s.delete(f"{BASE_URL}/api/admin/title_bundles/x").status_code == 403
    assert requests.get(f"{BASE_URL}/api/shop/bundles").status_code in (401, 403)


# Validation: unknown title/skin/default -> 404, negative price 422
def test_bundle_validation(admin, created):
    t = _mk_title(admin, created, text="TEST_BV")
    assert _mk_bundle(admin, created, title_id="nope", skin_id="neon", price=1).status_code == 404
    assert _mk_bundle(admin, created, title_id=t["id"], skin_id="nope", price=1).status_code == 404
    assert _mk_bundle(admin, created, title_id=t["id"], skin_id="default", price=1).status_code == 404
    assert _mk_bundle(admin, created, title_id=t["id"], skin_id="neon", price=-1).status_code == 422
    assert _mk_bundle(admin, created, title_id=t["id"], skin_id="neon", price=1, ends_at="bad").status_code == 400
    assert admin.put(f"{BASE_URL}/api/admin/title_bundles/nope",
                     json={"title_id": t["id"], "skin_id": "neon", "price": 1}).status_code == 404
    assert admin.delete(f"{BASE_URL}/api/admin/title_bundles/nope").status_code == 404


# Create -> admin list -> shop list with full_price / your_price
def test_bundle_create_list_shop(admin, fresh_user, created):
    s, _ = fresh_user
    t = _mk_title(admin, created, text="TEST_BCL", price=100)
    r = _mk_bundle(admin, created, title_id=t["id"], skin_id="neon", price=400)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["price"] == 400 and b["full_price"] == 600 and b["skin"]["id"] == "neon" and b["title"]["id"] == t["id"]
    assert any(x["id"] == b["id"] for x in admin.get(f"{BASE_URL}/api/admin/title_bundles").json()["bundles"])
    sb = next(x for x in s.get(f"{BASE_URL}/api/shop/bundles").json()["bundles"] if x["id"] == b["id"])
    assert sb["your_price"] == 400 and sb["owned"] is False and sb["owned_title"] is False and sb["owned_skin"] is False


# Hidden / expired bundles not listed and not buyable
def test_bundle_hidden_expired(admin, fresh_user, created):
    s, _ = fresh_user
    t = _mk_title(admin, created, text="TEST_BHE", price=0)
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    hid = _mk_bundle(admin, created, title_id=t["id"], skin_id="neon", price=0, active=False).json()["id"]
    exp = _mk_bundle(admin, created, title_id=t["id"], skin_id="neon", price=0, ends_at=past).json()["id"]
    ids = {x["id"] for x in s.get(f"{BASE_URL}/api/shop/bundles").json()["bundles"]}
    assert hid not in ids and exp not in ids
    assert s.post(f"{BASE_URL}/api/shop/bundles/buy", json={"bundle_id": hid}).status_code == 404
    assert s.post(f"{BASE_URL}/api/shop/bundles/buy", json={"bundle_id": exp}).status_code == 404
    assert s.post(f"{BASE_URL}/api/shop/bundles/buy", json={"bundle_id": "nope"}).status_code == 404
    # toggle via PUT -> visible
    r = admin.put(f"{BASE_URL}/api/admin/title_bundles/{hid}",
                  json={"title_id": t["id"], "skin_id": "neon", "price": 0, "active": True})
    assert r.status_code == 200 and r.json()["active"] is True
    ids = {x["id"] for x in s.get(f"{BASE_URL}/api/shop/bundles").json()["bundles"]}
    assert hid in ids


# 402 not enough coins
def test_bundle_insufficient(admin, fresh_user, created):
    s, _ = fresh_user
    t = _mk_title(admin, created, text="TEST_BPR", price=5)
    bid = _mk_bundle(admin, created, title_id=t["id"], skin_id="golden", price=999999).json()["id"]
    r = s.post(f"{BASE_URL}/api/shop/bundles/buy", json={"bundle_id": bid})
    assert r.status_code == 402, r.text


# Partial ownership credit + buy grants+equips both + 409 rebuy
def test_bundle_partial_and_buy(admin, fresh_user, created):
    s, _ = fresh_user
    t = _mk_title(admin, created, text="TEST_BPART", price=3)
    # fresh user buys title first (3 coins) - may lack coins
    coins = s.get(f"{BASE_URL}/api/shop/bundles").json()["coins"]
    if coins < 5:
        pytest.skip(f"fresh user has only {coins} coins")
    assert s.post(f"{BASE_URL}/api/shop/titles/buy", json={"title_id": t["id"]}).status_code == 200
    bid = _mk_bundle(admin, created, title_id=t["id"], skin_id="neon", price=2).json()["id"]
    sb = next(x for x in s.get(f"{BASE_URL}/api/shop/bundles").json()["bundles"] if x["id"] == bid)
    assert sb["owned_title"] is True and sb["owned_skin"] is False and sb["your_price"] == 2
    c0 = s.get(f"{BASE_URL}/api/shop/bundles").json()["coins"]
    r = s.post(f"{BASE_URL}/api/shop/bundles/buy", json={"bundle_id": bid})
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert "neon" in u["owned_skins"] and t["id"] in u["owned_titles"]
    assert u["selected_skin"] == "neon" and u["custom_title"]["id"] == t["id"]
    assert s.get(f"{BASE_URL}/api/shop/bundles").json()["coins"] == c0 - 2
    assert s.post(f"{BASE_URL}/api/shop/bundles/buy", json={"bundle_id": bid}).status_code == 409


# Full price buy deducts coins
def test_bundle_full_buy_deducts(admin, fresh_user, created):
    s, _ = fresh_user
    coins = s.get(f"{BASE_URL}/api/shop/bundles").json()["coins"]
    if coins < 1:
        pytest.skip("no coins")
    t = _mk_title(admin, created, text="TEST_BFULL", price=50)
    bid = _mk_bundle(admin, created, title_id=t["id"], skin_id="ghost", price=1).json()["id"]
    r = s.post(f"{BASE_URL}/api/shop/bundles/buy", json={"bundle_id": bid})
    assert r.status_code == 200, r.text
    assert s.get(f"{BASE_URL}/api/shop/bundles").json()["coins"] == coins - 1
    assert r.json()["user"]["selected_skin"] == "ghost"


# Deleting the title removes its bundles
def test_title_delete_cascades(admin, created):
    t = _mk_title(admin, created, text="TEST_BCAS")
    bid = _mk_bundle(admin, created, title_id=t["id"], skin_id="neon", price=1).json()["id"]
    assert admin.delete(f"{BASE_URL}/api/admin/titles/{t['id']}").status_code == 200
    created["titles"].remove(t["id"])
    assert all(x["id"] != bid for x in admin.get(f"{BASE_URL}/api/admin/title_bundles").json()["bundles"])
    assert admin.delete(f"{BASE_URL}/api/admin/title_bundles/{bid}").status_code == 404
    created["bundles"].remove(bid)


# Existing BUNDLE TEST bundle owned by player1 -> 409
def test_existing_bundle_owned(player):
    s, _ = player
    try:
        tid, bid = open("/app/memory/.tmp_bundle").read().split()[:2]
    except Exception:
        pytest.skip("no tmp bundle")
    sb = [x for x in s.get(f"{BASE_URL}/api/shop/bundles").json()["bundles"] if x["id"] == bid]
    if not sb:
        pytest.skip("bundle gone")
    assert sb[0]["owned"] is True
    assert s.post(f"{BASE_URL}/api/shop/bundles/buy", json={"bundle_id": bid}).status_code == 409
