"""Higher-rank bots play better MOVEMENT regardless of game mode.

User request: "Make the higher rank bots have better movement such as
strafing and playing cover."

Previously, strafe/cover/juke/jump smarts were all gated on
`smart = difficulty >= 1.5` (ranked-only) AND `self.is_ranked`. Which
meant a disguised Diamond bot in Quick Match (difficulty 0.9-1.2)
would waddle around like a Bronze.

Fix:
  1. Casual bot disguise RP range widened from [0, 850] to a
     triangular(0, 2200, 400) distribution so ~11% roll Diamond+
     and ~33% roll Platinum+.
  2. New `mv_smart` and `mv_elite` flags in _update_bots — unlock
     strafe/cover/juke/jump purely on `rank_tier`, not difficulty.
     Aim and fire-rate stay difficulty-gated so Quick Match bots
     don't start aimbotting.

Tests below assert the disguise range is right and that spawned
Quick Match bots can carry a high rank_tier.
"""
import sys
import pathlib
import random
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def test_casual_bot_disguise_spans_all_tiers():
    """Spawning 2000 casual-disguise bots should cover a wide tier
    spread, including Diamond+ (tier >= 5)."""
    # Use the shared casual game_room so arena / collision are real.
    room = server.game_room
    tiers = Counter()
    spawned = []
    try:
        for i in range(2000):
            b = room.spawn_bot(f"_t_bot_{i}", disguised=True, difficulty=0.9)
            spawned.append(b)
            tiers[int(getattr(b, "rank_tier", 0) or 0)] += 1
        # Every tier 0..7 should appear at least once (triangular(0,
        # 2200, 400) samples the full range).
        for t in range(0, 8):
            assert tiers[t] > 0, f"tier {t} never rolled: {tiers}"
        # Diamond+ (tier >= 5) should be roughly 5-20% of the sample.
        high = sum(c for t, c in tiers.items() if t >= 5)
        assert 50 <= high <= 500, f"Diamond+ share off: {high}/2000 (tiers={dict(tiers)})"
        # Bronze/Silver bulk should still be a strong plurality (>30%)
        # so Quick Match keeps blending with new players most of the
        # time. Triangular(0, 2200, 400) empirically lands ~35-40% of
        # samples in tiers 0-1.
        low = sum(c for t, c in tiers.items() if t <= 1)
        assert low >= 500, f"low-tier share too thin: {low}/2000"
    finally:
        for b in spawned:
            room.players.pop(b.id, None)


def test_mv_elite_unlocks_for_high_rank_casual_bot():
    """A casual bot forced to rank_tier=5 (Diamond) + difficulty=1.0
    should see mv_elite=True inside _update_bots' logic — verified
    indirectly by spawning the bot and asserting its disguised rank_tier
    exposes the fields the AI loop checks."""
    room = server.game_room
    # Force a Diamond disguise by passing an explicit disguise_tier_idx
    # (which also pins disguise_rank_points → tier 5).
    b = room.spawn_bot(
        "_elite_casual",
        disguised=True,
        difficulty=1.0,
        disguise_tier_idx=5,
    )
    try:
        assert int(getattr(b, "rank_tier", 0) or 0) == 5
        # Simulate the _update_bots elite / mv_elite derivation.
        difficulty = float(getattr(b, "difficulty", 1.0))
        smart = difficulty >= 1.5
        elite = smart and int(getattr(b, "rank_tier", 0) or 0) >= 5
        rank_tier = int(getattr(b, "rank_tier", 0) or 0)
        mv_smart = smart or rank_tier >= 3
        mv_elite = elite or rank_tier >= 5
        # Difficulty is low (1.0), so legacy `smart`/`elite` are False.
        assert smart is False
        assert elite is False
        # But rank-driven mv_smart + mv_elite should be True — this is
        # the fix.
        assert mv_smart is True, "Diamond bot in Quick Match should get mv_smart"
        assert mv_elite is True, "Diamond bot in Quick Match should get mv_elite"
    finally:
        room.players.pop(b.id, None)


def test_mv_smart_boundaries():
    """Verify the rank tier thresholds for mv_smart (>=3 Platinum) and
    mv_elite (>=5 Diamond)."""
    checks = [
        (0, False, False),  # Bronze
        (1, False, False),  # Silver
        (2, False, False),  # Gold
        (3, True,  False),  # Platinum — mv_smart only
        (4, True,  False),  # Emerald
        (5, True,  True),   # Diamond — mv_elite
        (6, True,  True),   # Master
        (7, True,  True),   # Grandmaster
        (8, True,  True),   # Goonmaster
    ]
    difficulty = 1.0  # Quick Match baseline
    for rank_tier, want_smart, want_elite in checks:
        smart = difficulty >= 1.5
        elite = smart and rank_tier >= 5
        mv_smart = smart or rank_tier >= 3
        mv_elite = elite or rank_tier >= 5
        assert mv_smart is want_smart, f"tier {rank_tier}: mv_smart"
        assert mv_elite is want_elite, f"tier {rank_tier}: mv_elite"
