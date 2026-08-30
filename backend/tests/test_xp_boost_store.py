"""Regression test — 2026-02-25.

User request: "XP Boosts in store"

Coverage:
  - BOOSTS_CATALOG shape + BOOSTS_BY_ID index
  - `xp_boost_remaining_seconds` / `xp_boost_active_multiplier` helpers
  - `xp_boost_bonus_for_match` doubling math (kills * 10 + win * 50 + 25)
  - Stacking: buying while active extends the timer (max(now, prev) + duration)
  - Static grep guards: end_match branches wire in `stats.bonus_xp`,
    public_user exposes the boost fields, /shop/boost/purchase endpoint.
"""
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


# ─── catalog shape ────────────────────────────────────────────────────


def test_boosts_catalog_has_three_durations():
    ids = {b["id"] for b in srv.BOOSTS_CATALOG}
    assert ids == {"boost_1h", "boost_24h", "boost_7d"}, (
        f"Expected the three canonical SKUs, got {ids}. Add/remove "
        "with intent — the front-end grid is a 3-column responsive grid."
    )
    # BOOSTS_BY_ID must mirror the list.
    assert srv.BOOSTS_BY_ID.keys() == ids


def test_boost_prices_are_progressive():
    """1h < 24h < 7d — the copy on the 7d card says 'best value', which
    only reads true if the coin-per-hour rate is cheaper the further
    you commit."""
    boosts = {b["id"]: b for b in srv.BOOSTS_CATALOG}
    p1 = boosts["boost_1h"]["price"] / (boosts["boost_1h"]["duration_sec"] / 3600)
    p2 = boosts["boost_24h"]["price"] / (boosts["boost_24h"]["duration_sec"] / 3600)
    p3 = boosts["boost_7d"]["price"] / (boosts["boost_7d"]["duration_sec"] / 3600)
    assert p1 > p2 > p3, (
        f"Coin/hour rate must decrease from 1h→24h→7d. Got 1h={p1}, "
        f"24h={p2}, 7d={p3}. Otherwise the 'best value' copy lies."
    )


# ─── active/remaining helpers ─────────────────────────────────────────


def test_remaining_seconds_zero_when_no_boost():
    assert srv.xp_boost_remaining_seconds({}) == 0
    assert srv.xp_boost_active_multiplier({}) == 1.0


def test_remaining_seconds_zero_after_expiry():
    """A stale `xp_boost_until` in the past must never grant a boost."""
    u = {"xp_boost_until": time.time() - 5.0, "xp_boost_multiplier": 2.0}
    assert srv.xp_boost_remaining_seconds(u) == 0
    assert srv.xp_boost_active_multiplier(u) == 1.0


def test_remaining_seconds_reports_positive_while_active():
    u = {"xp_boost_until": time.time() + 90.0, "xp_boost_multiplier": 2.0}
    rem = srv.xp_boost_remaining_seconds(u)
    assert 85 <= rem <= 90, f"Expected ~90 seconds left, got {rem}."
    assert srv.xp_boost_active_multiplier(u) == 2.0


# ─── bonus_xp math ────────────────────────────────────────────────────


def test_bonus_xp_zero_without_boost():
    """No active boost → no bonus regardless of kills/placement."""
    assert srv.xp_boost_bonus_for_match({}, kills=20, placement=1) == 0


def test_bonus_xp_doubles_win_match():
    """A winning game with 10 kills naturally earns 25+50+100 = 175 XP.
    A 2x boost adds another 175 as bonus, netting 350 total."""
    u = {"xp_boost_until": time.time() + 60.0, "xp_boost_multiplier": 2.0}
    assert srv.xp_boost_bonus_for_match(u, kills=10, placement=1) == 175


def test_bonus_xp_only_match_and_kill_when_not_first_place():
    """No win bonus when placement != 1 — 25 + 5*10 = 75; 2x adds 75."""
    u = {"xp_boost_until": time.time() + 60.0, "xp_boost_multiplier": 2.0}
    assert srv.xp_boost_bonus_for_match(u, kills=5, placement=3) == 75


def test_bonus_xp_scales_with_a_hypothetical_larger_multiplier():
    """Future 3x SKU: (mult - 1) is the multiplier applied to natural
    XP. Assert the math generalises so a schema change (3.0 mult) does
    the right thing without additional code changes."""
    u = {"xp_boost_until": time.time() + 60.0, "xp_boost_multiplier": 3.0}
    # kills=1, placement=2 → natural = 25 + 0 + 10 = 35. 3x → +70 bonus.
    assert srv.xp_boost_bonus_for_match(u, kills=1, placement=2) == 70


# ─── static / grep guards ─────────────────────────────────────────────


def test_end_match_credits_bonus_xp_on_both_branches():
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    # The stats.bonus_xp increment must appear at least twice — once in
    # the ranked end_match branch and once in the casual branch. Both
    # branches call `xp_boost_bonus_for_match` right before update_one.
    assert src.count('inc_doc["stats.bonus_xp"] = boost_bonus') >= 2, (
        "end_match must credit stats.bonus_xp in BOTH the ranked and "
        "casual branches — otherwise casual matches silently ignore "
        "the player's active XP boost."
    )
    assert src.count("xp_boost_bonus_for_match(udoc or {}, p.kills, placement)") >= 2


def test_public_user_exposes_boost_fields():
    """The client needs `xp_boost_until` (absolute epoch) to tick a live
    countdown without polling, plus the current multiplier + remaining
    seconds so a stale user object still shows a sane pill."""
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    # All three keys must be part of the public_user return.
    for key in ('"xp_boost_seconds_remaining"', '"xp_boost_multiplier"', '"xp_boost_until"'):
        assert key in src, f"public_user must expose {key} for the client badge."


def test_purchase_endpoint_registered():
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    assert '@api.post("/shop/boost/purchase")' in src
    assert '@api.get("/shop/boosts")' in src
    # Stacking rule must be in the endpoint body — a repeat purchase
    # while active EXTENDS the timer, never overwrites.
    body = src.split("async def shop_boost_purchase", 1)[1][:3000]
    assert "prev_until if prev_until > now else now" in body, (
        "Boost purchase must extend from `max(now, prev_until)` so a "
        "repeat purchase never loses time already paid for."
    )


# ─── frontend grep guards ─────────────────────────────────────────────


def test_shop_modal_has_boosts_tab():
    src = pathlib.Path("/app/frontend/src/components/ShopModal.jsx").read_text(encoding="utf-8")
    # The testid is built via a template literal (`shop-tab-${t.id}`)
    # so anchor on the tab id in the definition array + the boosts-grid
    # testid rendered when that tab is active.
    assert 'id: "boosts"' in src, "Boosts tab id missing from ShopModal tab config."
    assert 'data-testid="shop-boosts-grid"' in src
    assert "api.post(\"/shop/boost/purchase\"" in src or "api.post('/shop/boost/purchase'" in src
    # BoostCard component present.
    assert "export function BoostCard" in src


def test_lobby_renders_active_boost_pill():
    src = pathlib.Path("/app/frontend/src/pages/Lobby.jsx").read_text(encoding="utf-8")
    assert 'data-testid="lobby-xp-boost-badge"' in src
    # Live tick — the pill's remaining time must come from state that
    # decrements every second (not the stale `user.xp_boost_seconds_remaining`
    # snapshot the auth context caches).
    assert "xpBoostLeft" in src
    assert "setInterval" in src.split("xpBoostLeft", 1)[1][:3000], (
        "The XP-boost pill needs a 1s setInterval to tick down the "
        "displayed value locally between /auth/me refreshes."
    )
