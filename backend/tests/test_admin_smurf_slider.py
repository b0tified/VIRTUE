"""Regression tests for the admin smurf-ratio slider endpoint.

User request (2026-02-24):
  > Admin Smurf Slider: expose CASUAL_ELITE_BOT_RATIO in the moderation
  > dashboard so you can dial the smurf frequency without a redeploy.

Endpoints under test:
  GET  /api/admin/settings/smurf   → {ratio, diff}
  POST /api/admin/settings/smurf   → same shape, with new ratio.

Both are admin-only. The setter must:
  - Clamp via Pydantic (0.0-1.0). Invalid → 422.
  - Mutate the module state so the next `_get_casual_elite_bot_ratio()`
    call inside a spawn loop picks up the change.
  - Keep `CASUAL_ELITE_BOT_RATIO` module attribute in sync so existing
    tests that read `srv.CASUAL_ELITE_BOT_RATIO` still see current value.
"""
import sys
import pathlib
import uuid
import os

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "shooter_test_smurf_" + uuid.uuid4().hex[:8])

import server as srv  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_ratio():
    """Every test starts + ends at the defaults so ordering doesn't
    matter and one test's mutation can't poison another."""
    srv._CASUAL_ELITE_BOT_STATE["ratio"] = 0.15
    srv._CASUAL_ELITE_BOT_STATE["diff"] = 1.7
    srv.CASUAL_ELITE_BOT_RATIO = 0.15
    srv.CASUAL_ELITE_BOT_DIFF = 1.7
    yield
    srv._CASUAL_ELITE_BOT_STATE["ratio"] = 0.15
    srv._CASUAL_ELITE_BOT_STATE["diff"] = 1.7
    srv.CASUAL_ELITE_BOT_RATIO = 0.15
    srv.CASUAL_ELITE_BOT_DIFF = 1.7


ADMIN = {"_id": "admin_id", "role": "admin", "username": "admin"}
PLEB = {"_id": "pleb_id", "role": "user", "username": "pleb"}


class TestGetSmurfRatio:
    async def test_admin_can_read(self):
        out = await srv.admin_get_smurf_ratio(ADMIN)
        assert out == {"ratio": 0.15, "diff": srv.CASUAL_ELITE_BOT_DIFF}

    async def test_non_admin_rejected(self):
        with pytest.raises(HTTPException) as exc:
            await srv.admin_get_smurf_ratio(PLEB)
        assert exc.value.status_code == 403


class TestSetSmurfRatio:
    async def test_admin_can_write(self):
        payload = srv.SmurfRatioIn(ratio=0.45)
        out = await srv.admin_set_smurf_ratio(payload, ADMIN)
        assert out["ratio"] == 0.45
        # Module state updated for the spawn loop.
        assert srv._get_casual_elite_bot_ratio() == 0.45
        # Module attribute kept in sync so pytests reading it directly
        # see the current value.
        assert srv.CASUAL_ELITE_BOT_RATIO == 0.45

    async def test_admin_can_write_diff_only(self):
        """Endpoint accepts partial updates — the diff slider can save
        without also sending the ratio, and vice versa."""
        payload = srv.SmurfRatioIn(diff=2.1)
        out = await srv.admin_set_smurf_ratio(payload, ADMIN)
        assert out["diff"] == 2.1
        assert srv._get_casual_elite_bot_diff() == 2.1
        assert srv.CASUAL_ELITE_BOT_DIFF == 2.1
        # Ratio must NOT have been touched — partial update leaves the
        # other field alone.
        assert srv._get_casual_elite_bot_ratio() == 0.15

    async def test_admin_can_write_both(self):
        payload = srv.SmurfRatioIn(ratio=0.4, diff=1.9)
        out = await srv.admin_set_smurf_ratio(payload, ADMIN)
        assert out == {"ratio": 0.4, "diff": 1.9}

    async def test_non_admin_rejected(self):
        payload = srv.SmurfRatioIn(ratio=0.5)
        with pytest.raises(HTTPException) as exc:
            await srv.admin_set_smurf_ratio(payload, PLEB)
        assert exc.value.status_code == 403
        # State must NOT have changed — no partial write.
        assert srv._get_casual_elite_bot_ratio() == 0.15

    def test_ratio_above_one_rejected_by_pydantic(self):
        with pytest.raises(Exception):
            srv.SmurfRatioIn(ratio=1.5)

    def test_negative_ratio_rejected_by_pydantic(self):
        with pytest.raises(Exception):
            srv.SmurfRatioIn(ratio=-0.01)

    def test_diff_below_1_5_rejected_by_pydantic(self):
        """Below 1.5 the smurf loses its smart-AI behaviour — clamp
        stops admins from accidentally reducing them to dumb bots."""
        with pytest.raises(Exception):
            srv.SmurfRatioIn(diff=1.4)

    def test_diff_above_2_5_rejected_by_pydantic(self):
        """Above 2.5 the smurf out-guns ranked (1.9) — clamp keeps
        casual distinct from ranked."""
        with pytest.raises(Exception):
            srv.SmurfRatioIn(diff=2.51)

    def test_zero_and_one_allowed(self):
        srv.SmurfRatioIn(ratio=0.0)
        srv.SmurfRatioIn(ratio=1.0)

    def test_diff_boundary_values_allowed(self):
        """Both endpoints of the diff range are valid: 1.5 = baseline
        smart, 2.5 = razor-sharp cap."""
        srv.SmurfRatioIn(diff=1.5)
        srv.SmurfRatioIn(diff=2.5)


class TestLiveRatioAffectsSpawnLoop:
    """The whole point of the endpoint is that spawn code reads the
    live ratio, not a snapshot from server startup. Assert that
    changing the ratio via the endpoint is immediately visible to
    the spawn loop's `_get_casual_elite_bot_ratio()` helper."""

    async def test_update_visible_to_spawn_loop(self):
        assert srv._get_casual_elite_bot_ratio() == 0.15
        await srv.admin_set_smurf_ratio(srv.SmurfRatioIn(ratio=0.05), ADMIN)
        assert srv._get_casual_elite_bot_ratio() == 0.05
        await srv.admin_set_smurf_ratio(srv.SmurfRatioIn(ratio=0.9), ADMIN)
        assert srv._get_casual_elite_bot_ratio() == 0.9

    def test_spawn_loop_uses_helper_not_constant(self):
        """Grep guard: the auto-balance loop must call
        `_get_casual_elite_bot_ratio()`, not `CASUAL_ELITE_BOT_RATIO`
        directly (which would freeze at startup value and defeat the
        whole live-tune purpose)."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "random.random() < _get_casual_elite_bot_ratio()" in src
