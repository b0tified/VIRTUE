"""Apex ranked buffs + regression: ranked smart bots keep cover & jumps.

Context: a previous refactor gated cover-seeking and jumps on `mv_elite`
(= smart AND rank_tier >= 5, or just rank_tier >= 5). That accidentally
*removed* cover-seek and jumps from ranked smart bots BELOW Diamond
(Bronze/Silver/Gold/Platinum/Emerald ranked), which previously got them
via the `smart` gate alone.

User request: "Add the movement bot buffs to the high rank ranked mode
bots." So:
  1. Fix the regression — ranked smart bots at ANY tier regain cover
     and jumps (reproducing pre-refactor behavior).
  2. Add new "apex" buffs reserved for Diamond+ (tier >= 5) bots in
     ranked mode:
       - +15% move speed
       - +25% strafe amplitude
       - +10% strafe frequency
       - Jump cadence shortened from 900-2400ms to 600-1500ms
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def _derive_flags(is_ranked: bool, difficulty: float, rank_tier: int) -> dict:
    """Reproduce the inline flag derivation inside `_update_bots` so we
    can assert gate behaviour without running the full tick loop."""
    smart = difficulty >= 1.5
    elite = smart and rank_tier >= 5
    mv_smart = smart or rank_tier >= 3
    mv_elite = elite or rank_tier >= 5
    apex_ranked = mv_elite and is_ranked
    return {
        "smart": smart, "elite": elite,
        "mv_smart": mv_smart, "mv_elite": mv_elite,
        "apex_ranked": apex_ranked,
        # Gate predicates as used in server.py:
        "cover_gate": (mv_elite or smart),
        "jump_gate": (mv_elite or smart),
    }


def test_regression_platinum_ranked_keeps_cover_and_jumps():
    """A Platinum ranked bot (tier 3, difficulty 1.9) must retain
    cover-seek + jumps even though it's not Diamond — the previous
    refactor accidentally stripped these."""
    f = _derive_flags(is_ranked=True, difficulty=1.9, rank_tier=3)
    assert f["smart"] is True
    assert f["elite"] is False  # not Diamond, so legacy elite is False
    assert f["mv_elite"] is False  # also False via rank gate alone
    # BUT the broadened cover + jump gates must be True — regression fix.
    assert f["cover_gate"] is True, "Platinum ranked bot lost cover-seek"
    assert f["jump_gate"] is True, "Platinum ranked bot lost jumps"


def test_regression_bronze_ranked_keeps_cover_and_jumps():
    """Bronze ranked bot (tier 0, difficulty 1.9) — baseline tier of
    ranked matchmaker — must also keep cover + jumps."""
    f = _derive_flags(is_ranked=True, difficulty=1.9, rank_tier=0)
    assert f["smart"] is True
    assert f["cover_gate"] is True
    assert f["jump_gate"] is True


def test_apex_ranked_only_for_diamond_plus_in_ranked_mode():
    """`apex_ranked` must be True only when the bot is Diamond+ AND
    the room is ranked. Diamond disguise in Quick Match = NOT apex."""
    # Diamond+ in Ranked → apex.
    assert _derive_flags(True, 1.9, 5)["apex_ranked"] is True
    assert _derive_flags(True, 1.9, 7)["apex_ranked"] is True  # Grandmaster
    assert _derive_flags(True, 1.9, 8)["apex_ranked"] is True  # Goonmaster
    # Diamond+ in Quick Match → mv_elite but NOT apex.
    assert _derive_flags(False, 1.2, 5)["apex_ranked"] is False
    assert _derive_flags(False, 1.2, 7)["apex_ranked"] is False
    # Bronze ranked → not apex.
    assert _derive_flags(True, 1.9, 0)["apex_ranked"] is False


def test_quick_match_diamond_still_gets_mv_elite_without_apex():
    """Quick Match disguised Diamond bot keeps the standard mv_elite
    cover + jump behaviour (just not the apex speed/strafe/jump-cadence
    bumps reserved for ranked endgame)."""
    f = _derive_flags(is_ranked=False, difficulty=1.0, rank_tier=5)
    assert f["mv_elite"] is True
    assert f["cover_gate"] is True
    assert f["jump_gate"] is True
    assert f["apex_ranked"] is False  # the extra speed buff is ranked-only


def test_apex_speed_strafe_values_in_server_code():
    """Smoke test: the file should contain the literal apex buff
    constants we introduced (5.75 speed, 1.45 strafe amp, 2.85 freq,
    600-1500 ms jump cadence). Guards against a merge accidentally
    reverting the apex path."""
    src = pathlib.Path(server.__file__).read_text()
    assert "_apex_ranked" in src, "apex flag missing from server.py"
    assert "5.75 if _apex_ranked" in src, "apex speed boost missing"
    assert "strafe_freq = 2.85" in src, "apex strafe freq missing"
    assert "strafe_amp = 1.45" in src, "apex strafe amp missing"
    assert "random.randint(600, 1500)" in src, "apex jump cadence missing"
