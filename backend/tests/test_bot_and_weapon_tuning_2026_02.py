"""Regression tests for the 2026-02-24 bot / weapon tuning pass:

  1. Casual bots nerfed 1.15 → 0.9 (sub-Platinum forgiveness).
  2. AK small buffs: cooldown_ms 320 → 285 (fire rate), projectile_thickness
     0.45 → 0.55 (hitbox).
  3. Elite (Diamond+) smart bots get behavioural intelligence upgrades —
     tighter target lock, deeper cover-seeking HP threshold, longer lead —
     but NO stat buffs (damage / HP untouched).
  4. Anti-stuck logic: if both movement axes are blocked, bot attempts a
     perpendicular slide.

We assert on the raw source strings + config dicts so the tests run
without spinning up an event loop.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


class TestAKBuffs:
    def test_projectile_thickness_bumped_to_055(self):
        """User asked for a second AK hitbox buff on top of the 0.45
        we shipped last week — target 0.55m of near-miss forgiveness."""
        assert srv.WEAPON_CONFIGS["ak47"]["projectile_thickness"] == 0.55

    def test_ak_cooldown_lowered_to_285ms(self):
        """Small fire-rate buff: 320ms → 285ms (~12% faster cadence)."""
        assert srv.WEAPON_CONFIGS["ak47"]["cooldown_ms"] == 285

    def test_ak_stays_high_dps_after_buff(self):
        """Sanity — the cooldown buff shouldn't accidentally raise AK
        cd back above the pre-buff value (320ms) or land it below the
        sniper's post-shot lockout in a way that would break balance.
        We just assert the new value is in the safe [250, 320] window."""
        ak_cd = srv.WEAPON_CONFIGS["ak47"]["cooldown_ms"]
        assert 250 <= ak_cd < 320, f"AK cd {ak_cd} outside safe post-buff window"

    def test_precision_weapons_still_pinpoint(self):
        """The fat-bullet buff must only apply to the AK — sniper/laser
        stay 0.0 thickness or the precision balance breaks."""
        assert srv.WEAPON_CONFIGS["sniper"].get("projectile_thickness", 0.0) == 0.0
        assert srv.WEAPON_CONFIGS["laser"].get("projectile_thickness", 0.0) == 0.0


class TestCasualBotsNerfed:
    """Grep guard on server.py — casual room + party room bot spawn
    sites must use 0.9 difficulty (sub-Platinum forgiveness). Ranked
    stays at 1.9, TDM at 1.45 for real practice."""

    def test_casual_room_startup_bots_at_09(self):
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "game_room.spawn_bot(name, disguised=True, difficulty=0.9)" in src, (
            "Casual quick-match seed bots regressed — must spawn at 0.9 "
            "difficulty for sub-Platinum forgiveness."
        )

    def test_casual_refill_bots_at_09(self):
        """Auto-refill path (when a player leaves and we top the room
        back up) must also spawn at 0.9. Anchor on the comment marker
        so this test isn't fragile against unrelated 1.15 uses in
        other parts of the file (score multipliers, strafe amps, ...)."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        # The refill branch is anchored by the comment "Casual FFA — nerfed"
        # immediately followed by `diff = 0.9`.
        marker = "Casual FFA — nerfed 1.15 → 0.9"
        assert marker in src, "Refill nerf comment marker missing"
        block = src.split(marker, 1)[1][:400]
        assert "diff = 0.9" in block, (
            "Refill block no longer sets diff = 0.9 — the casual nerf regressed."
        )

    def test_party_room_bots_at_09(self):
        """Party rooms are casual — the fill bots must inherit the
        casual nerf so a 2-person party doesn't get slammed by
        harder-than-quick-match bots."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "room.spawn_bot(name, disguised=True, difficulty=0.9)" in src

    def test_ranked_bots_untouched(self):
        """Ranked bots stay at 1.9 — the nerf targeted sub-Plat only."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert 'ranked_room.spawn_bot(nm + "-R", disguised=True, difficulty=1.9)' in src


class TestElitesSmarterWithoutStatBuffs:
    """Elite (Diamond+ disguised) bots must get AI upgrades — but their
    damage / HP / cooldowns must be IDENTICAL to any other ranked bot.
    Only behaviour changes. Grep-guards on the key `elite` code paths."""

    def test_elite_flag_gated_on_diamond_tier(self):
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert 'elite = smart and int(getattr(bot, "rank_tier", 0) or 0) >= 5' in src

    def test_elite_target_lock_shorter(self):
        """Faster target re-evaluation — 0.8s vs 1.5s for regular smart bots."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "lock_dur = 0.8 if elite else (1.5 if smart else 0.5)" in src

    def test_elite_cover_seek_at_higher_hp(self):
        """Elites duck at 65 HP, regular smart bots wait until 45."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "cover_hp = 65 if elite else 45" in src

    def test_elite_lead_prediction_longer(self):
        """Elites lead 0.27 (was 0.18) — punishes sustained strafers."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "lead_scale = 0.27 if elite else 0.18" in src

    def test_elite_bots_do_not_get_damage_or_hp_buffs(self):
        """Explicit: no stat scaling anywhere gated on `elite` — only
        behaviour. Fails loudly if a future edit tries to sneak in a
        damage / HP / cooldown buff for high-tier bots."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        forbidden = [
            "bot.max_hp *= ",     # HP scaling
            "damage *= ",         # damage scaling
            "elite and bot.max_hp",   # any HP branch keyed on elite
            "elite and bot.damage",
        ]
        for pat in forbidden:
            # Allow the pattern to exist unrelated to elite; only fail if
            # `elite` appears within 60 chars of the pattern.
            for hit_idx in range(0, len(src), 1):
                idx = src.find(pat, hit_idx)
                if idx == -1:
                    break
                window = src[max(0, idx - 60):idx + 60]
                assert "elite" not in window.replace(pat, ""), (
                    f"Bot stat scaling appears gated on `elite`: pattern={pat!r} "
                    f"window={window!r}"
                )
                hit_idx = idx + 1


class TestBotAntiStuck:
    """Bots must attempt a perpendicular slide when both movement axes
    are blocked, in BOTH the pursuit and wander branches. Grep-guards
    on the specific slide implementation."""

    def test_pursuit_branch_has_perp_slide(self):
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "perp_x, perp_z = -mz_, mx_" in src, (
            "Pursuit branch missing perpendicular slide — bots will "
            "freeze when cornered against an obstacle."
        )

    def test_wander_branch_has_perp_slide(self):
        """The wander branch (no target) had the same bug — a bot with
        no target could freeze against a wall waiting forever."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert "perp_x, perp_z = -wz / mag, wx / mag" in src, (
            "Wander branch missing perpendicular slide — target-less bots "
            "will freeze near obstacles."
        )

    def test_slide_tries_both_directions(self):
        """The slide must try (+, -) so a bot can escape either way
        around the obstacle."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        # Both branches share the tuple (1.0, -1.0) as the slide sign iterator.
        assert src.count("for sign in (1.0, -1.0):") >= 2


class TestMatchesLast24hAggregation:
    """Admin live-stats must emit the `matches_last_24h` breakdown so
    the moderation dashboard's new panel can render mode counts."""

    def test_endpoint_computes_matches_last_24h(self):
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert 'matches_last_24h = {"ffa_casual": 0, "ffa_ranked": 0, "tdm_casual": 0, "total": 0}' in src

    def test_aggregation_dedupes_by_match_id(self):
        """A 4-player match should count as 1, not 4. The pipeline must
        collapse to unique match_ids before counting."""
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert '{"match_id": "$match_id", "game_mode": "$game_mode", "mode": "$mode"}' in src

    def test_response_includes_matches_last_24h_key(self):
        src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
        assert '"matches_last_24h": matches_last_24h,' in src
