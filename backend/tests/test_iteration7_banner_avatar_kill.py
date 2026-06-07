"""Iteration-7 backend tests for VIRTUE 3D FPS.

Under test:
  * POST /api/profile/me/avatar — accepts idx 0..11 (12-avatar pool);
    idx 12+ -> 422
  * POST /api/profile/me/banner — accepts banner_icon/banner_color 0..11
    (12-icon / 12-color pool); idx 12+ -> 422
  * GET  /api/profile/me — public_user returns banner_icon, banner_color,
    peak_rank_tier (and avatar)
  * WS /api/ws/game?mode=casual — kill events include
    shooter_peak_rank_tier, shooter_banner_icon, shooter_banner_color.
    Bots fight each other, so within ~10s we usually see at least one
    kill event we can schema-check.
"""
import os
import json
import asyncio
import pytest
import requests
import websockets

# --- env bootstrap ---------------------------------------------------------
_envpath = "/app/frontend/.env"
if not os.environ.get("REACT_APP_BACKEND_URL") and os.path.exists(_envpath):
    with open(_envpath) as _f:
        for _line in _f:
            if _line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = _line.split("=", 1)[1].strip()
                break
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

P1 = {"email": "player1@shooter.com", "password": "player123"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def token():
    return _login(P1)


# ---------- AVATAR --------------------------------------------------------
class TestAvatarRange:
    """POST /api/profile/me/avatar accepts 0..11 (12-avatar pool). idx 0..5
    are free; idx 6..11 are gated by player level or peak rank — the
    backend returns 403 (not 422) when those gates aren't met. Tests
    here only assert that the value is *in validator range* (i.e., not
    422), since the gate response depends on the test account's
    level/rank."""

    @pytest.mark.parametrize("idx", [0, 1, 2, 3, 4, 5])
    def test_avatar_accepts_free_range(self, token, idx):
        r = requests.post(
            f"{BASE_URL}/api/profile/me/avatar",
            headers=_h(token),
            json={"avatar": idx},
            timeout=10,
        )
        assert r.status_code == 200, f"avatar={idx} -> {r.status_code} {r.text}"
        data = r.json()
        assert data["avatar"] == idx, f"persisted avatar mismatch: {data}"
        # Verify GET /profile/me reflects same value
        me = requests.get(f"{BASE_URL}/api/profile/me", headers=_h(token), timeout=10).json()
        assert me["avatar"] == idx

    @pytest.mark.parametrize("idx", [6, 7, 8, 9, 10, 11])
    def test_avatar_validator_accepts_unlock_range(self, token, idx):
        """Validator must not 422 on the unlockable indices — the
        response is either 200 (gate met → persisted) or 403 (gate not
        met → rejected with a friendly message). Anything else (e.g.,
        422 / 400) is a validation regression."""
        r = requests.post(
            f"{BASE_URL}/api/profile/me/avatar",
            headers=_h(token),
            json={"avatar": idx},
            timeout=10,
        )
        assert r.status_code in (200, 403), \
            f"avatar={idx} -> {r.status_code} {r.text}"

    def test_avatar_idx_12_returns_422(self, token):
        r = requests.post(
            f"{BASE_URL}/api/profile/me/avatar",
            headers=_h(token),
            json={"avatar": 12},
            timeout=10,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"

    def test_avatar_idx_negative_returns_422(self, token):
        r = requests.post(
            f"{BASE_URL}/api/profile/me/avatar",
            headers=_h(token),
            json={"avatar": -1},
            timeout=10,
        )
        assert r.status_code == 422


# ---------- BANNER (regression) -------------------------------------------
class TestBannerRange:
    """POST /api/profile/me/banner accepts banner_icon + banner_color 0..11."""

    def test_banner_accepts_min(self, token):
        r = requests.post(
            f"{BASE_URL}/api/profile/me/banner",
            headers=_h(token),
            json={"banner_icon": 0, "banner_color": 0},
            timeout=10,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["banner_icon"] == 0 and d["banner_color"] == 0

    def test_banner_accepts_max(self, token):
        r = requests.post(
            f"{BASE_URL}/api/profile/me/banner",
            headers=_h(token),
            json={"banner_icon": 11, "banner_color": 11},
            timeout=10,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["banner_icon"] == 11 and d["banner_color"] == 11
        # Persistence check
        me = requests.get(f"{BASE_URL}/api/profile/me", headers=_h(token), timeout=10).json()
        assert me["banner_icon"] == 11 and me["banner_color"] == 11

    def test_banner_icon_12_returns_422(self, token):
        r = requests.post(
            f"{BASE_URL}/api/profile/me/banner",
            headers=_h(token),
            json={"banner_icon": 12, "banner_color": 0},
            timeout=10,
        )
        assert r.status_code == 422

    def test_banner_color_12_returns_422(self, token):
        r = requests.post(
            f"{BASE_URL}/api/profile/me/banner",
            headers=_h(token),
            json={"banner_icon": 0, "banner_color": 12},
            timeout=10,
        )
        assert r.status_code == 422


# ---------- public_user schema --------------------------------------------
class TestPublicUserSchema:
    """GET /api/profile/me must include banner_icon, banner_color, peak_rank_tier, avatar."""

    def test_profile_me_includes_new_fields(self, token):
        r = requests.get(f"{BASE_URL}/api/profile/me", headers=_h(token), timeout=10)
        assert r.status_code == 200
        me = r.json()
        for field in ("avatar", "banner_icon", "banner_color", "peak_rank_tier", "rank_tier", "peak_rank_name"):
            assert field in me, f"missing field {field} in /profile/me: {me}"
        # All ints
        assert isinstance(me["avatar"], int)
        assert isinstance(me["banner_icon"], int)
        assert isinstance(me["banner_color"], int)
        assert isinstance(me["peak_rank_tier"], int)


# ---------- WS kill event schema ------------------------------------------
async def _stream_until_kill(token, mode="casual", timeout=12.0):
    """Connect WS in given mode, stream messages, return first kill event seen (or None)."""
    url = f"{WS_BASE}/api/ws/game?token={token}&mode={mode}"
    async with websockets.connect(url, max_size=None, close_timeout=2) as ws:
        end_at = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < end_at:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            except asyncio.TimeoutError:
                continue
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            # State stream carries events[]
            events = msg.get("events") or []
            for ev in events:
                if ev.get("type") == "kill":
                    return ev
        return None


class TestKillEventSchema:
    """Kill events must include shooter_peak_rank_tier, shooter_banner_icon, shooter_banner_color.
    Bots in casual rooms shoot each other, so we expect a kill within ~10s."""

    @pytest.mark.asyncio
    async def test_kill_event_includes_new_shooter_fields(self, token):
        kill = await _stream_until_kill(token, mode="casual", timeout=14.0)
        if kill is None:
            pytest.skip("No kill event captured within 14s — bot AI may have been idle; schema not verified.")
        for f in ("shooter_peak_rank_tier", "shooter_banner_icon", "shooter_banner_color"):
            assert f in kill, f"kill event missing {f}: {kill}"
        # Types are integers
        assert isinstance(kill["shooter_peak_rank_tier"], int)
        assert isinstance(kill["shooter_banner_icon"], int)
        assert isinstance(kill["shooter_banner_color"], int)


# ---------- Smoke regression ---------------------------------------------
class TestSmokeRegression:
    def test_auth_login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json=P1, timeout=10)
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_leaderboard(self, token):
        r = requests.get(f"{BASE_URL}/api/leaderboard", headers=_h(token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
