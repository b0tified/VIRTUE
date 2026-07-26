"""Knight (Silver Sentinel) legendary shop skin — catalog + purchase.

NOTE: Buy endpoint in server is `/api/shop/buy` (not `/api/shop/skins/buy`
as suggested in the review request). The catalog endpoint is
`/api/shop/skins`.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def rich_user_token():
    """Register a fresh user then grant it 5000+ coins via the admin
    endpoint (login admin, POST /api/admin/coins/grant if it exists —
    else we hit MongoDB directly via a debug hook). We fall back to
    just logging in as admin who has coins."""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    email = f"TEST_knight_{uuid.uuid4().hex[:8]}@shooter.com"
    pw = "testpass123"
    uname = f"knightbuyer{uuid.uuid4().hex[:6]}"
    r = session.post(f"{BASE_URL}/api/auth/register",
                     json={"email": email, "password": pw, "username": uname})
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed: {r.status_code} {r.text}")
    login = session.post(f"{BASE_URL}/api/auth/login",
                        json={"email": email, "password": pw})
    if login.status_code != 200:
        pytest.skip(f"login failed: {login.status_code}")
    token = login.json().get("access_token") or login.json().get("token")
    if not token:
        # cookie-based auth: fall back to session
        return {"session": session, "token": None}
    # Grant coins directly via mongo since we know MONGO_URL.
    try:
        from pymongo import MongoClient
        mc = MongoClient(os.environ.get("MONGO_URL"))
        # Backend lowercases emails on register, so match case-insensitively.
        res = mc[os.environ.get("DB_NAME", "test_database")].users.update_one(
            {"email": email.lower()}, {"$set": {"coins": 10000}}
        )
        if res.matched_count == 0:
            pytest.skip(f"user not found in db to grant coins")
    except Exception as e:
        pytest.skip(f"couldn't grant coins: {e}")
    return {"session": session, "token": token, "email": email}


class TestKnightCatalog:
    def test_knight_appears_in_shop(self, rich_user_token):
        s = rich_user_token["session"]
        token = rich_user_token.get("token")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        r = s.get(f"{BASE_URL}/api/shop/skins", headers=headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data
        knight = next((i for i in data["items"] if i.get("id") == "knight"), None)
        assert knight is not None, f"'knight' missing from shop items: {[i['id'] for i in data['items']]}"
        assert knight["name"] == "Silver Sentinel"
        assert knight["price"] == 5000
        assert knight["rarity"] == "legendary"
        assert knight["obtain"] == "shop"
        assert knight["owned"] is False


class TestKnightPurchase:
    def test_buy_knight_deducts_coins(self, rich_user_token):
        s = rich_user_token["session"]
        token = rich_user_token.get("token")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        # verify starting coins first
        r = s.get(f"{BASE_URL}/api/shop/skins", headers=headers)
        assert r.status_code == 200
        start_coins = int(r.json()["coins"])
        assert start_coins >= 5000, f"seeded user should have >=5000 coins, got {start_coins}"

        buy = s.post(f"{BASE_URL}/api/shop/buy",
                     json={"skin_id": "knight"}, headers=headers)
        assert buy.status_code == 200, f"buy failed: {buy.status_code} {buy.text}"
        payload = buy.json()
        assert payload.get("ok") is True
        assert payload["skin"]["id"] == "knight"
        user = payload["user"]
        assert user["coins"] == start_coins - 5000
        assert "knight" in user.get("owned_skins", [])

        # GET-verify persistence
        r2 = s.get(f"{BASE_URL}/api/shop/skins", headers=headers)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["coins"] == start_coins - 5000
        knight2 = next(i for i in d2["items"] if i["id"] == "knight")
        assert knight2["owned"] is True
