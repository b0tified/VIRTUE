# Party re-queue fix: MATCHED_USERS 'party' flag + matched_ago on GET /queue/casual & ranked
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


@pytest.fixture(scope="module")
def leader():
    return _login("partyleader@test.com", "pw123456")


@pytest.fixture(scope="module")
def follower():
    return _login("partyfollower@test.com", "pw123456")


@pytest.fixture(scope="module")
def solo():
    return _login("player1@shooter.com", "player123")


def _form_party(leader, follower):
    for s in (leader, follower):
        s.post(f"{API}/party/leave", timeout=20)
        s.delete(f"{API}/queue/casual", timeout=20)
        s.delete(f"{API}/queue/ranked", timeout=20)
    r = leader.post(f"{API}/party/invite", json={"username": "partyfollower"}, timeout=20)
    assert r.status_code == 200, r.text
    r = follower.post(f"{API}/party/accept", json={"username": "partyleader"}, timeout=20)
    assert r.status_code == 200, r.text
    me = leader.get(f"{API}/party/me", timeout=20).json()
    assert len(me.get("members") or []) == 2, me


def _wait_matched(sess, path, timeout=25):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = sess.get(f"{API}{path}", timeout=20).json()
        if last.get("matched"):
            return last
        time.sleep(1)
    return last


@pytest.fixture(scope="module", autouse=True)
def teardown(leader, follower):
    yield
    for s in (leader, follower):
        s.delete(f"{API}/queue/casual", timeout=20)
        s.delete(f"{API}/queue/ranked", timeout=20)
        s.post(f"{API}/party/leave", timeout=20)


class TestPartyCasualFlag:
    def test_party_casual_matched_flag_same_match(self, leader, follower):
        _form_party(leader, follower)
        r = leader.post(f"{API}/queue/casual", json={}, timeout=20)
        assert r.status_code == 200, r.text
        lm = _wait_matched(leader, "/queue/casual")
        assert lm and lm.get("matched"), lm
        fm = follower.get(f"{API}/queue/casual", timeout=20).json()
        assert fm.get("matched") is True, fm
        assert lm["party"] is True and fm["party"] is True
        assert lm["match_id"] == fm["match_id"]
        assert isinstance(fm["matched_ago"], int) and 0 <= fm["matched_ago"] <= 45

    def test_follower_matched_persists_15s(self, follower):
        # 'again' case: follower polls late (~15s) and still sees fresh party match
        time.sleep(12)
        fm = follower.get(f"{API}/queue/casual", timeout=20).json()
        assert fm.get("matched") is True and fm.get("party") is True, fm
        assert fm["matched_ago"] <= 45

    def test_follower_cannot_queue(self, follower):
        r = follower.post(f"{API}/queue/casual", json={}, timeout=20)
        assert r.status_code == 403


class TestPartyRankedFlag:
    def test_party_ranked_matched_flag(self, leader, follower):
        _form_party(leader, follower)
        r = leader.post(f"{API}/queue/ranked", json={}, timeout=20)
        assert r.status_code == 200, r.text
        fm = _wait_matched(follower, "/queue/ranked", timeout=60)
        assert fm and fm.get("matched"), fm
        assert fm.get("party") is True, fm
        assert isinstance(fm.get("wait_seconds"), int)
        lm = leader.get(f"{API}/queue/ranked", timeout=20).json()
        if lm.get("matched"):
            assert lm["match_id"] == fm["match_id"]
            assert lm["party"] is True


class TestSoloFlag:
    def test_solo_casual_party_false(self, solo):
        solo.post(f"{API}/party/leave", timeout=20)
        r = solo.post(f"{API}/queue/casual", json={}, timeout=20)
        assert r.status_code == 200, r.text
        m = _wait_matched(solo, "/queue/casual")
        try:
            assert m.get("matched") is True, m
            assert m.get("party") is False
        finally:
            solo.delete(f"{API}/queue/casual", timeout=20)

    def test_solo_idle_not_matched(self, solo):
        solo.delete(f"{API}/queue/casual", timeout=20)
        m = solo.get(f"{API}/queue/casual", timeout=20).json()
        assert not m.get("matched") and not m.get("in_queue"), m
