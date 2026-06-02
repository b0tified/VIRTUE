"""Season 2 pass — METEOR / SPACE theme.
Lock in the swap behaviour so the new pass goes live exactly when the
season clock rolls over, not before. Specifically:
  - Season 1 callers still get Solar/Cyber/Quantum at tiers 10/20/30.
  - Season 2 callers get Stardust Drifter / Crater Forged / Meteor Ascendant.
  - The three new S2 skins exist in SKINS_CATALOG so the renderer can
    paint them as soon as `_season_tiers(2)` references them.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_season_1_layout_unchanged():
    """Anyone still inside Season 1 should see the original three skins
    at tiers 10/20/30. This is the contract that lets us ship the new
    pass without disrupting active S1 players."""
    tiers = server._season_tiers(1)
    by_tier = {t["tier"]: t for t in tiers}
    assert by_tier[10]["reward_skin"] == "solar"
    assert by_tier[20]["reward_skin"] == "cyber"
    assert by_tier[30]["reward_skin"] == "quantum"
    # Coins layout shouldn't have shifted either.
    assert by_tier[5]["reward_coins"] == 500
    assert by_tier[1]["reward_coins"] == 100


def test_season_2_layout_uses_meteor_skins():
    tiers = server._season_tiers(2)
    by_tier = {t["tier"]: t for t in tiers}
    assert by_tier[10]["reward_skin"] == "stardust"
    assert by_tier[10]["reward_label"] == "Stardust Drifter"
    assert by_tier[20]["reward_skin"] == "crater"
    assert by_tier[20]["reward_label"] == "Crater Forged"
    assert by_tier[30]["reward_skin"] == "meteor"
    assert by_tier[30]["reward_label"] == "Meteor Ascendant"
    # Same coin layout — only the milestone skins should differ.
    assert by_tier[5]["reward_coins"] == 500
    assert by_tier[15]["reward_coins"] == 500


def test_meteor_skins_are_in_catalog():
    """The new S2 skins must be in SKINS_BY_ID so the renderer can paint
    them the instant `_season_tiers(2)` references them."""
    for sid in ("stardust", "crater", "meteor"):
        assert sid in server.SKINS_BY_ID, f"Missing S2 skin in catalog: {sid}"
        s = server.SKINS_BY_ID[sid]
        # Sanity: shape matches existing pass-tier skins.
        assert s.get("price") == 0
        assert s.get("rarity") in ("epic", "legendary")
        assert s.get("obtain", "").endswith("_s2")
        for key in ("body", "leg", "head", "accent", "aura", "aura_mode"):
            assert key in s, f"Skin {sid} missing visual key: {key}"


def test_unknown_season_falls_back_to_s1():
    """Defensive: an out-of-band season_number (e.g. 99 or 0) must not
    crash the pass — fall back to the S1 lineup so the user can still
    see *some* pass."""
    tiers = server._season_tiers(99)
    by_tier = {t["tier"]: t for t in tiers}
    assert by_tier[10]["reward_skin"] == "solar"


def test_tier_counts_unchanged():
    for s_num in (1, 2):
        assert len(server._season_tiers(s_num)) == server.SEASON_MAX_TIER == 30
