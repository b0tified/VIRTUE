"""Regression: placement matches now award a PERFORMANCE bonus/penalty
on top of the base ±100 delta.

Spec (per user request "up to 150 bonus per match, can lose up to 300"):
  - Base: +100 for 1st place, −100 otherwise (unchanged)
  - Performance: kills*10 − deaths*8, clamped to [-200, +150]
  - Combined range: worst = -100 + -200 = -300
                     best  = +100 + +150 = +250

The test is a source-level assertion since the placement RP logic is
buried inside a large `elif mtype == "end_match":` block that's hard
to isolate for a unit call. Combined with existing e2e tests
(`test_placement_matches.py`) this catches regressions on the
formula.
"""
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()


def _find_placement_block():
    marker = "Placement matches: hard \"win or lose 100\" rule"
    idx = SRC.find(marker)
    assert idx >= 0, "placement RP block missing"
    return SRC[idx: idx + 2500]


def test_placement_performance_bonus_cap_is_150():
    """+150 is the ceiling on the performance modifier — a dominant
    win never earns more than +250 total (base +100 + perf +150)."""
    block = _find_placement_block()
    assert "PLACEMENT_PERF_BONUS_CAP = 150" in block, (
        "placement bonus cap must be exactly 150 (spec)."
    )


def test_placement_performance_penalty_cap_is_minus_200():
    """−200 is the floor on the performance modifier — a hard throw
    never loses more than −300 total (base −100 + perf −200)."""
    block = _find_placement_block()
    assert "PLACEMENT_PERF_PENALTY_CAP = -200" in block, (
        "placement penalty cap must be exactly -200 so total loss caps "
        "at -300 per the user spec."
    )


def test_placement_perf_formula_uses_kills_and_deaths_with_weights():
    """The formula must be `kills * 10 - deaths * 8` — kills weighted
    slightly heavier so aggressive plays are encouraged over camping."""
    block = _find_placement_block()
    assert "p.kills * 10 - p.deaths * 8" in block, (
        "performance signal must be `kills * 10 - deaths * 8`."
    )


def test_placement_delta_is_base_plus_perf():
    """Final `delta` must be `base + perf` — not one or the other."""
    block = _find_placement_block()
    assert "delta = base + perf" in block, (
        "placement match delta must combine the base (±100) with the "
        "capped performance modifier."
    )
