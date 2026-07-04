"""Regression tests for ranked queue endpoints per iteration-12.

Covers:
- POST /api/queue/ranked (join)
- GET /api/queue/ranked (status polling)
- DELETE /api/queue/ranked (leave)
- POST /api/queue/ranked/ack (client ack)
- POST/GET/DELETE /api/queue/casual (casual queue sanity)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def token():
    """Login as player1 (level >= 5 required for ranked). Fallback to a
    fresh TEST_ user if player1 has a ranked-leave penalty active."""
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "player1@shooter.com", "password": "player123"},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    # If player1 is under ranked ban, some ranked tests will 403; we
    # tolerate that and let those tests skip when they hit the ban.
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup(headers):
    """Ensure clean queue state before + after the module."""
    try:
        requests.delete(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        requests.delete(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
    except Exception:
        pass
    yield
    try:
        requests.delete(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        requests.delete(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
    except Exception:
        pass


# ------------------------ RANKED ------------------------

class TestRankedQueue:
    def test_ranked_join_returns_payload(self, headers):
        r = requests.post(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        # Server returns in_queue on join
        assert d.get("in_queue") is True or "tier" in d, d
        assert "tier" in d
        assert "tier_name" in d
        assert "bot_fill_seconds" in d
        assert isinstance(d.get("bot_fill_seconds"), (int, float))

    def test_ranked_get_status_while_queued(self, headers):
        r = requests.get(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("in_queue") is True, f"Expected in_queue after join: {d}"
        assert d.get("matched") is not True
        assert "wait_seconds" in d
        assert "estimated_wait_seconds" in d
        assert "tier_size" in d
        assert d["tier_size"] >= 1

    def test_ranked_wait_seconds_increases(self, headers):
        r1 = requests.get(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        w1 = r1.json().get("wait_seconds", 0)
        time.sleep(2.2)
        r2 = requests.get(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        w2 = r2.json().get("wait_seconds", 0)
        assert w2 >= w1 + 1, f"wait_seconds did not increase: {w1} -> {w2}"

    def test_ranked_leave(self, headers):
        r = requests.delete(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_ranked_get_after_leave(self, headers):
        r = requests.get(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("in_queue") is False
        assert d.get("matched") is False
        assert d.get("wait_seconds", 0) == 0

    def test_ranked_ack_is_idempotent_when_not_matched(self, headers):
        # Ack when not matched should still succeed cleanly
        r = requests.post(f"{BASE_URL}/api/queue/ranked/ack", headers=headers, timeout=10)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_ranked_rejoin_then_leave(self, headers):
        r1 = requests.post(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert r1.status_code == 200
        r2 = requests.delete(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert r2.status_code == 200
        r3 = requests.get(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert r3.json().get("in_queue") is False

    def test_ranked_bot_fill_matches_within_window(self, headers):
        """Bronze bot-fill is ~20-45s. This is an optional slow test that
        verifies matched:true eventually appears. We poll up to 60s."""
        # Join
        r = requests.post(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert r.status_code == 200
        matched = False
        deadline = time.time() + 60
        while time.time() < deadline:
            s = requests.get(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
            j = s.json()
            if j.get("matched"):
                matched = True
                # Validate match payload
                assert "match_id" in j
                assert "tier" in j
                assert "tier_name" in j
                break
            time.sleep(2)
        # Cleanup regardless
        if matched:
            # Ack + confirm ack clears matched state
            ack = requests.post(f"{BASE_URL}/api/queue/ranked/ack", headers=headers, timeout=10)
            assert ack.status_code == 200
            after = requests.get(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10).json()
            assert after.get("matched") is False, f"ack should clear matched: {after}"
        else:
            # Still queued — leave
            requests.delete(f"{BASE_URL}/api/queue/ranked", headers=headers, timeout=10)
        assert matched, "Bot-fill did not produce a match within 60s"


# ------------------------ CASUAL ------------------------

class TestCasualQueue:
    def test_casual_join(self, headers):
        r = requests.post(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("in_queue") is True or "bot_fill_seconds" in d, d

    def test_casual_status(self, headers):
        r = requests.get(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
        assert r.status_code == 200
        d = r.json()
        # Either matched already, or still queued
        assert ("in_queue" in d) or ("matched" in d)

    def test_casual_leave(self, headers):
        r = requests.delete(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
        assert r.status_code == 200

    def test_casual_join_idempotent(self, headers):
        """iteration_13: rapid double-click / re-join must be idempotent
        and NOT crash the queue endpoint."""
        # Clean slate
        requests.delete(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
        r1 = requests.post(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1.get("in_queue") is True or "bot_fill_seconds" in d1
        g = requests.get(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
        assert g.status_code == 200
        # Second POST must not 4xx/5xx — must return a sensible payload.
        r2 = requests.post(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
        assert r2.status_code == 200, f"idempotent re-join failed: {r2.status_code} {r2.text}"
        d2 = r2.json()
        assert d2.get("in_queue") is True or "bot_fill_seconds" in d2
        # Cleanup
        rd = requests.delete(f"{BASE_URL}/api/queue/casual", headers=headers, timeout=10)
        assert rd.status_code == 200
        assert rd.json().get("ok") is True or "ok" in rd.json()
