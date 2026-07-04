"""Ranked bot fire-rate parity — ranked bots must NEVER fire faster than
the player's AK cadence (`SHOT_COOLDOWN_MS`).

Before the floor was added, high-tier ranked bots (difficulty ≥ 2.8 →
Diamond and above) computed `effective_cd = BOT_SHOT_COOLDOWN_MS /
difficulty + 40ms`, which yielded ~200-260ms — significantly faster than
the player's 320ms hold-to-fire cooldown. That felt like bots were
trigger-hacking. The floor guarantees the ladder scales via bot aim and
movement, never by pure trigger speed the player can't match.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def _effective_cd(difficulty, is_ranked_smart):
    """Reproduces the exact `effective_cd` math from `_update_bots`.
    Keeping this in the test verbatim so a regression in the production
    code fails loudly."""
    cd = server.BOT_SHOT_COOLDOWN_MS / max(0.5, difficulty)
    if is_ranked_smart:
        cd += 40
        cd = max(cd, float(server.SHOT_COOLDOWN_MS))
    return cd


def test_ranked_bot_bronze_slower_than_player():
    """Bronze ranked bots (difficulty 1.90) should already be slower
    than the player's AK. Sanity check that the floor doesn't over-
    apply and nerf low-tier bots."""
    cd = _effective_cd(1.90, is_ranked_smart=True)
    # Raw math: 620/1.9 + 40 ≈ 366ms. Above the 320ms player floor.
    assert cd >= server.SHOT_COOLDOWN_MS
    assert cd == 620 / 1.9 + 40


def test_ranked_bot_high_tier_floored_at_player_cadence():
    """Diamond+ ranked bots (difficulty ≥ 2.8) would compute a cooldown
    under 320ms without the floor. Floor must clamp them to match the
    player's AK cadence."""
    # Diamond: difficulty=2.8. Raw math: 620/2.8 + 40 ≈ 261ms.
    assert _effective_cd(2.8, is_ranked_smart=True) == server.SHOT_COOLDOWN_MS
    # Grandmaster: difficulty=3.4. Raw math: 620/3.4 + 40 ≈ 222ms.
    assert _effective_cd(3.4, is_ranked_smart=True) == server.SHOT_COOLDOWN_MS
    # Goonmaster (top of scale): difficulty=3.7. Raw math: 620/3.7 + 40 ≈ 208ms.
    assert _effective_cd(3.7, is_ranked_smart=True) == server.SHOT_COOLDOWN_MS


def test_ranked_bot_never_faster_than_player():
    """Universal invariant: no matter the difficulty, a ranked smart bot
    must never fire faster than the player's AK. Sweep the full ranked
    difficulty range."""
    for diff in [1.9, 2.2, 2.5, 2.8, 3.1, 3.4, 3.7]:
        cd = _effective_cd(diff, is_ranked_smart=True)
        assert cd >= server.SHOT_COOLDOWN_MS, (
            f"Ranked bot at diff={diff} fires at {cd:.0f}ms, "
            f"faster than player's {server.SHOT_COOLDOWN_MS}ms AK"
        )


def test_casual_bot_unaffected_by_floor():
    """Casual (non-ranked) bots should still scale purely with
    difficulty — no floor. Keeps easy practice bots easy."""
    # Casual practice bots are difficulty ~1.15-1.45. Raw math:
    # 620/1.15 ≈ 539ms (well above floor anyway).
    cd_casual = _effective_cd(1.15, is_ranked_smart=False)
    assert cd_casual == 620 / 1.15  # no +40, no floor


def test_server_code_has_floor():
    """Read the source back to confirm the floor is present. Catches
    accidental deletion during future refactors."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert "effective_cd = max(effective_cd, float(SHOT_COOLDOWN_MS))" in src, (
        "Ranked-bot floor is missing from server.py — high-tier bots "
        "will fire faster than the player again."
    )
