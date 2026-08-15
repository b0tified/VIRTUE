"""Regression guard for the "white-screen at match end" bug.

Root cause (fixed 2026-02-24): `MatchResultOverlay.jsx` referenced an
undeclared variable `idx` inside `data-testid` template literals in the
placement-scoreboard `.map((p, i) => ...)` loop. Every mount threw
`ReferenceError: idx is not defined` and blanked the overlay — players
saw a white screen instead of the victory / defeat splash.

The map already yields `i` as its index, so any `${idx}` inside that
map is guaranteed wrong. This test grep-guards the file so a future
refactor can't reintroduce the same typo. It intentionally stays a
plain text scan (not a JSX parse) so it works in the same pytest run
that ships the backend suite.
"""
import pathlib
import re


OVERLAY = pathlib.Path("/app/frontend/src/components/MatchResultOverlay.jsx")


def test_match_result_overlay_has_no_undefined_idx_reference():
    """No `${idx}` template inside MatchResultOverlay.jsx. The map's
    iterator is `i`, so any `idx` interpolation would crash on render
    (ReferenceError) and produce the reported white-screen match-end."""
    src = OVERLAY.read_text(encoding="utf-8")
    # Any `${idx}` (with optional whitespace) inside a template literal.
    hits = re.findall(r"\$\{\s*idx\s*[.}]", src)
    assert not hits, (
        "MatchResultOverlay.jsx references undefined `idx` inside a "
        "template literal — this is the white-screen match-end bug. "
        "Use the map's actual index (`i`) instead. Occurrences: "
        + repr(hits)
    )


def test_placement_map_uses_i_as_index():
    """Sanity: the placement scoreboard `.map` still exposes `i`. If a
    future refactor renames the index we want this test to fail loudly
    so the fix can be revisited (otherwise the grep guard above becomes
    a false comfort)."""
    src = OVERLAY.read_text(encoding="utf-8")
    assert "placements.map((p, i) =>" in src, (
        "Placement scoreboard `.map((p, i) => ...)` shape changed — "
        "revisit the idx / i regression guard to keep it meaningful."
    )
