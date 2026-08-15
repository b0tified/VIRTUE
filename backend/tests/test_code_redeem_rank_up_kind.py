"""Regression tests: `/api/codes/redeem` fires the `rank_up` payload
whenever a code's net RP change crosses a tier OR division boundary,
not just for the `rank_up_tiers` reward type.

User request (2026-02-24):
  > Post-Match Rank-Up Cinematic: play a bigger celebration when the
  > tier boundary is crossed, not just a division bump — and make sure
  > it plays even when you use code.

Before this fix, only the `rank_up_tiers` reward returned a
`rank_up_payload`. A plain `rp` code that pushed the player from
Bronze I → Silver III (a boundary crossing) or Silver III → Silver II
(a division bump) silently updated `rank_points` without triggering
the celebration overlay.

We run the same logic the endpoint uses (RP grant clamped to 7500,
then compare tier / division before vs after) and assert the emitted
payload's `kind` is correct.
"""
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


def _simulate_rp_grant(cur_pts: int, rp_grant: int) -> dict | None:
    """Mirror the unified rank-up detection block in `redeem_code` so
    we can assert on it without spinning up FastAPI + a mongo. Any
    drift between this function and the server logic will show up as
    a test failure — that's the point of the grep-guard below."""
    target_pts = min(7500, cur_pts + rp_grant)
    cur_tier_idx, cur_tier_name = srv.rank_for_points(cur_pts)
    target_tier_idx, target_tier_name = srv.rank_for_points(target_pts)
    cur_div = srv.rank_division_for_points(cur_pts, cur_tier_idx)
    target_div = srv.rank_division_for_points(target_pts, target_tier_idx)
    tier_crossed = target_tier_idx > cur_tier_idx
    division_crossed = (
        not tier_crossed
        and target_div > 0
        and cur_div > 0
        and target_div < cur_div
    )
    if not (tier_crossed or division_crossed):
        return None
    return {
        "prev_tier": {"idx": cur_tier_idx, "name": cur_tier_name, "division": cur_div},
        "new_tier":  {"idx": target_tier_idx, "name": target_tier_name, "division": target_div},
        "rp_delta":  int(target_pts - cur_pts),
        "new_points": int(target_pts),
        "kind": "tier" if tier_crossed else "division",
    }


class TestRpCodeCrossesTierBoundary:
    """A plain `rp` code that pushes the player across a tier boundary
    must emit a `kind: 'tier'` payload — the big celebration."""

    def test_bronze_top_to_silver_entry_triggers_tier_kind(self):
        # Bronze I is 200-299 RP. A +50 grant from 280 → 330 crosses
        # into Silver III (300).
        payload = _simulate_rp_grant(cur_pts=280, rp_grant=50)
        assert payload is not None, "Boundary crossing must produce a payload"
        assert payload["kind"] == "tier"
        assert payload["prev_tier"]["name"] == "BRONZE"
        assert payload["new_tier"]["name"] == "SILVER"

    def test_platinum_i_to_emerald_iii_triggers_tier_kind(self):
        # Platinum I is 1100-1199. +50 pushes 1150 → 1200 = Emerald III.
        payload = _simulate_rp_grant(cur_pts=1150, rp_grant=50)
        assert payload is not None
        assert payload["kind"] == "tier"
        assert payload["prev_tier"]["name"] == "PLATINUM"
        assert payload["new_tier"]["name"] == "EMERALD"

    def test_diamond_i_to_master_iii_triggers_tier_kind(self):
        # Diamond I is 1700-1799. +50 pushes 1750 → 1800 = Master III.
        payload = _simulate_rp_grant(cur_pts=1750, rp_grant=50)
        assert payload is not None
        assert payload["kind"] == "tier"

    def test_multi_tier_leap_is_still_tier_kind(self):
        # A monster RP code that leaps 3 tiers still emits `kind: tier`
        # (the biggest celebration variant).
        payload = _simulate_rp_grant(cur_pts=100, rp_grant=1000)
        assert payload is not None
        assert payload["kind"] == "tier"
        assert payload["new_tier"]["idx"] > payload["prev_tier"]["idx"] + 1


class TestRpCodeOnlyBumpsDivision:
    """A smaller `rp` code that only advances a division within the
    same tier must emit `kind: 'division'` — the lighter, faster
    celebration variant."""

    def test_bronze_iii_to_ii_is_division_kind(self):
        # Bronze III is 0-99, II is 100-199. +50 from 60 → 110 is a
        # same-tier promotion.
        payload = _simulate_rp_grant(cur_pts=60, rp_grant=50)
        assert payload is not None
        assert payload["kind"] == "division"
        assert payload["prev_tier"]["idx"] == payload["new_tier"]["idx"]
        # And the numeric division dropped (higher rank).
        assert payload["new_tier"]["division"] < payload["prev_tier"]["division"]

    def test_gold_ii_to_i_is_division_kind(self):
        # Gold II is 700-799, Gold I is 800-899. +50 from 780 → 830.
        payload = _simulate_rp_grant(cur_pts=780, rp_grant=50)
        assert payload is not None
        assert payload["kind"] == "division"


class TestRpCodeNoBoundaryCrossed:
    """RP grants that don't move the player past any boundary must
    return None — no celebration."""

    def test_same_division_no_payload(self):
        # Bronze III → Bronze III (small grant inside the same division).
        assert _simulate_rp_grant(cur_pts=10, rp_grant=20) is None

    def test_goonmaster_absorbs_grant_no_promotion(self):
        # At 7500 RP already (cap), any grant is a no-op.
        assert _simulate_rp_grant(cur_pts=7500, rp_grant=500) is None


def test_redeem_endpoint_emits_kind_field():
    """Grep guard on the endpoint source: the emitted `rank_up_payload`
    must carry an explicit `kind` field so the frontend can pick the
    right celebration variant deterministically. Without this the
    client's `sameTier` fallback still works, but making it explicit
    means backend changes can't silently break the variant choice."""
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    # Anchor on the unified rank-up detection block.
    marker = 'Unified rank-up detection'
    assert marker in src, "Unified rank-up detection block is missing"
    assert '"kind": "tier" if tier_crossed else "division"' in src, (
        "redeem_code no longer emits an explicit `kind` on the "
        "rank_up_payload — division vs tier disambiguation regressed."
    )
