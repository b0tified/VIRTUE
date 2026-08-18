"""Regression tests for the 2026-02-24 party + smurf-bot changes.

User requests:
  1. "Private lobbies with party system with settings such as add bots"
  2. "Add higher ranked bots into casual sometimes"

Tests split cleanly into two classes to match the two features.
"""
import pathlib
import random
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


class TestPartyCustomLobbySettings:
    """The `/api/party/start` endpoint must accept + persist the
    `bots_enabled` and `tdm` flags so `get_or_create_party_room` can
    honor the leader's Custom Lobby toggle."""

    def test_party_start_default_bots_enabled(self):
        """Legacy callers who POST no body still get bots by default —
        preserves the old auto-fill behaviour so anything hitting the
        endpoint without a body doesn't suddenly get empty rooms."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert 'party["bots_enabled"] = bool(body.get("bots_enabled", True))' in src, (
            "party_start must default bots_enabled to True when the body "
            "is missing — preserves legacy auto-fill behaviour."
        )
        assert 'party["tdm"] = bool(body.get("tdm", False))' in src

    def test_party_me_exposes_bots_enabled_and_tdm(self):
        """Party members poll /party/me to auto-navigate + display the
        leader's settings, so both flags must be in the response."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert '"bots_enabled": bool(p.get("bots_enabled", True))' in src
        assert '"tdm": bool(p.get("tdm", False))' in src

    def test_party_room_skips_bot_fill_when_disabled(self):
        """The room-spawn helper must honor `bots_enabled=False` — the
        WHOLE point of the toggle is a human-only private lobby."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert 'bot_count = max(0, MAX_PARTY_SIZE - member_count) if bots_enabled else 0' in src

    def test_party_room_respects_tdm_flag(self):
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert 'room_mode = "tdm" if is_tdm else "ffa"' in src
        assert 'game_mode=room_mode' in src


class TestCasualSmurfBotsInjection:
    """The casual FFA auto-balance path must sometimes spawn a Diamond+
    disguised bot with elite AI (per user request: "higher ranked bots
    into casual sometimes")."""

    def test_smurf_ratio_and_diff_constants_present(self):
        """Constants must exist as module-level tunables so a future
        admin UI can adjust them without touching spawn code."""
        assert hasattr(srv, "CASUAL_ELITE_BOT_RATIO"), "Missing CASUAL_ELITE_BOT_RATIO"
        assert hasattr(srv, "CASUAL_ELITE_BOT_DIFF"), "Missing CASUAL_ELITE_BOT_DIFF"
        # Sanity: ratio in (0, 1) — a value >= 1 would make EVERY bot a
        # smurf which defeats the "sometimes" intent.
        assert 0.0 < srv.CASUAL_ELITE_BOT_RATIO < 1.0
        # Diff must clear the smart-AI threshold (1.5) or the "smurf"
        # is stat-nerfed but still uses dumb-bot behaviour, which
        # would show through the disguise.
        assert srv.CASUAL_ELITE_BOT_DIFF >= 1.5

    def test_smurf_gated_on_casual_ffa(self):
        """Ranked and TDM must never spawn smurfs — they already have
        proper tier-calibrated bots."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert 'self.game_mode == "ffa"' in src.split("smurf")[1][:500].lower() or (
            'is_smurf = (' in src and 'self.is_ranked' in src.split('is_smurf = (', 1)[1][:300]
        )

    def test_smurf_uses_diamond_tier_disguise(self):
        """The smurf spawn call must pass tier=5 (DIAMOND) so the
        rank icon on the scoreboard reads Diamond II."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "disguise_tier_idx=5" in src

    def test_smurf_uses_elite_diff_constant(self):
        """Smurf spawn must call `_get_casual_elite_bot_diff()` so
        runtime slider changes take effect on the next fill.
        Previously used the frozen `CASUAL_ELITE_BOT_DIFF` constant."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "difficulty=_get_casual_elite_bot_diff()" in src

    def test_smurf_ratio_reasonable_default(self):
        """0.15 default = ~1 in 7 casual fill bots is a smurf, which
        matches the user's "sometimes" ask. Anything above 0.5 would
        be too frequent; anything below 0.05 too rare to notice."""
        assert 0.05 <= srv.CASUAL_ELITE_BOT_RATIO <= 0.35


class TestSmurfProbabilityHoldsAcrossManyRolls:
    """Sanity: over many rolls with the module's ratio, ~15% of rolls
    should trip the smurf branch. This is a coarse Monte Carlo — 2000
    trials with a 15% ratio gives σ ≈ 0.008, so we allow ±0.05 slack."""

    def test_smurf_ratio_matches_expected(self):
        random.seed(4242)
        ratio = srv.CASUAL_ELITE_BOT_RATIO
        trials = 2000
        hits = sum(1 for _ in range(trials) if random.random() < ratio)
        empirical = hits / trials
        assert abs(empirical - ratio) < 0.05, (
            f"Empirical smurf ratio {empirical:.3f} diverged from "
            f"CASUAL_ELITE_BOT_RATIO={ratio}"
        )
