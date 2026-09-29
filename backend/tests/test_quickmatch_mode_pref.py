"""Regression tests for the Quick-Match mode_pref feature (Feb-2026).

Contract:
  - `POST /api/queue/casual` accepts an optional `mode_pref` field in
    the body: "ffa" | "tdm" | "both" (default "both", legacy behaviour).
  - Head-to-head matchmaker pairs only entries with compatible prefs:
      both ↔ anything | ffa ↔ ffa | tdm ↔ tdm | ffa ↔ tdm = incompatible.
  - When paired, the resolved match mode honours the pinned side:
      both + both → 50/50 roll; both + ffa → FFA; both + tdm → TDM;
      ffa + ffa  → FFA; tdm + tdm → TDM.
  - Bot-fill honours the caller's pref exactly:
      ffa → FFA; tdm → TDM; both → 50/50 roll.
"""
import sys
import pytest

sys.path.insert(0, "/app/backend")
import server as srv  # noqa: E402


def test_mode_prefs_compatible_truth_table():
    """Truth table for _casual_mode_prefs_compatible."""
    cases = [
        ({"mode_pref": "both"}, {"mode_pref": "both"}, True),
        ({"mode_pref": "both"}, {"mode_pref": "ffa"},  True),
        ({"mode_pref": "both"}, {"mode_pref": "tdm"},  True),
        ({"mode_pref": "ffa"},  {"mode_pref": "ffa"},  True),
        ({"mode_pref": "tdm"},  {"mode_pref": "tdm"},  True),
        ({"mode_pref": "ffa"},  {"mode_pref": "tdm"},  False),
        ({"mode_pref": "tdm"},  {"mode_pref": "ffa"},  False),
        # Missing key defaults to "both".
        ({},                    {"mode_pref": "ffa"},  True),
        ({},                    {},                    True),
    ]
    for a, b, expected in cases:
        got = srv._casual_mode_prefs_compatible(a, b)
        assert got is expected, f"pair {a} × {b}: expected {expected}, got {got}"


def test_resolve_pair_pinned_ffa():
    """When either paired side pins FFA, the match is FFA."""
    a = {"mode_pref": "ffa"}
    b = {"mode_pref": "both"}
    for _ in range(20):
        assert srv._resolve_casual_match_mode(a, b) is False


def test_resolve_pair_pinned_tdm():
    """When either paired side pins TDM, the match is TDM."""
    a = {"mode_pref": "both"}
    b = {"mode_pref": "tdm"}
    for _ in range(20):
        assert srv._resolve_casual_match_mode(a, b) is True


def test_resolve_pair_both_both_rolls():
    """Both preferences = "both" → 50/50 roll (accept either outcome
    across many trials to prove it's not hard-coded)."""
    seen_ffa = 0
    seen_tdm = 0
    for _ in range(400):
        got = srv._resolve_casual_match_mode({"mode_pref": "both"}, {"mode_pref": "both"})
        if got:
            seen_tdm += 1
        else:
            seen_ffa += 1
    # 400 rolls at TDM_QUICK_MATCH_ROLL — accept a wide band so this
    # never flakes; we just need to confirm BOTH outcomes surface.
    assert seen_ffa > 0 and seen_tdm > 0, (
        f"expected both outcomes, got ffa={seen_ffa} tdm={seen_tdm}"
    )


def test_resolve_solo_bot_fill_pinned():
    """Bot-fill with a pinned pref must always return that mode."""
    for _ in range(20):
        assert srv._resolve_casual_match_mode({"mode_pref": "ffa"}, None) is False
        assert srv._resolve_casual_match_mode({"mode_pref": "tdm"}, None) is True


def test_resolve_solo_bot_fill_both_rolls():
    """Bot-fill with pref="both" rolls TDM_QUICK_MATCH_ROLL."""
    seen_ffa = 0
    seen_tdm = 0
    for _ in range(400):
        got = srv._resolve_casual_match_mode({"mode_pref": "both"}, None)
        if got:
            seen_tdm += 1
        else:
            seen_ffa += 1
    assert seen_ffa > 0 and seen_tdm > 0


def test_queue_flags_model_accepts_mode_pref():
    """The Pydantic body model accepts and defaults mode_pref."""
    default = srv.QueueFlagsIn()
    assert default.mode_pref == "both"
    picked = srv.QueueFlagsIn(mode_pref="tdm")
    assert picked.mode_pref == "tdm"


def test_matchmaker_skips_incompatible_pref_pair():
    """Two players with ffa vs tdm prefs must NOT be paired even when
    they're the only two entries in the queue. Head-to-head loop skips
    them, and if the bot-fill timeout hasn't elapsed both entries stay
    queued — validating the compatibility gate."""
    import asyncio

    async def _run():
        # Save/restore global state so the test isolates itself.
        original = list(srv.CASUAL_QUEUE)
        srv.CASUAL_QUEUE.clear()
        try:
            now = __import__("time").time()
            srv.CASUAL_QUEUE.append({
                "user_id": "u_ffa_only", "user_ids": ["u_ffa_only"],
                "username": "F", "usernames": ["F"],
                "joined_at": now, "estimated_wait_seconds": 5,
                "is_party": False, "party_id": None,
                "is_mobile": False, "mobile_only": False,
                "mode_pref": "ffa",
            })
            srv.CASUAL_QUEUE.append({
                "user_id": "u_tdm_only", "user_ids": ["u_tdm_only"],
                "username": "T", "usernames": ["T"],
                "joined_at": now, "estimated_wait_seconds": 5,
                "is_party": False, "party_id": None,
                "is_mobile": False, "mobile_only": False,
                "mode_pref": "tdm",
            })
            # Directly emulate the head-to-head compatibility scan.
            paired_i, paired_j = None, None
            for i in range(len(srv.CASUAL_QUEUE)):
                for j in range(i + 1, len(srv.CASUAL_QUEUE)):
                    if (
                        srv._platforms_compatible(srv.CASUAL_QUEUE[i], srv.CASUAL_QUEUE[j])
                        and srv._casual_mode_prefs_compatible(srv.CASUAL_QUEUE[i], srv.CASUAL_QUEUE[j])
                    ):
                        paired_i, paired_j = i, j
                        break
                if paired_i is not None:
                    break
            assert paired_i is None and paired_j is None, (
                f"ffa+tdm pair must not match: {paired_i}, {paired_j}"
            )
        finally:
            srv.CASUAL_QUEUE.clear()
            srv.CASUAL_QUEUE.extend(original)

    asyncio.run(_run())
