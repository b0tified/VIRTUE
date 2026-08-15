"""Regression test: end-of-match scoreboard rows for BOTS must include
`rank_division` so the client renders the full "TIER + DIVISION" label
(e.g. "DIAMOND II") instead of just "DIAMOND".

User report (2026-02-24): "Make the bots on the end match screen show
the rank tier they are in not just rank". Real-player rows already
included `rank_division`; bot rows didn't, so their disguise ended at
the tier name.

We stub a minimal room + bot player, force the disguise fields, drive
the placement construction logic directly, and assert the emitted dict
carries a valid roman-numeral-capable division. Covered for both the
ranked path and the casual path.
"""
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server as srv  # noqa: E402


def _disguised_bot(tier_idx: int, rp_in_band: int):
    """Build a fake bot Player with the disguise fields the end-match
    logic reads. No websocket, no room — this is a data-shape test."""
    p = srv.Player(ws=None, is_bot=True, bot_name="RegBot")
    p.username = "RegBot"
    p.is_bot = True
    p.kills = 5
    p.deaths = 3
    p.rank_tier = tier_idx
    p.disguise_rank_name = srv.RANK_TIERS[tier_idx][1]
    p.disguise_rank_points = rp_in_band
    return p


def _row_for_bot(tier_idx: int, rp_in_band: int, *, is_ranked: bool):
    """Recreate the exact `placements.append({...})` dict shape used
    by `GameRoom.end_match` for a bot, without spinning up a room."""
    p = _disguised_bot(tier_idx, rp_in_band)
    disguise_rp = int(getattr(p, "disguise_rank_points", 0) or 0)
    division = srv.rank_division_for_points(disguise_rp, tier_idx)
    if is_ranked:
        return {
            "id": p.id,
            "user_id": "",
            "username": p.username,
            "kills": p.kills,
            "deaths": p.deaths,
            "rank_tier": tier_idx,
            "rank_name": p.disguise_rank_name,
            "rank_division": division,
        }
    return {
        "id": p.id,
        "user_id": "",
        "username": p.username,
        "kills": p.kills,
        "deaths": p.deaths,
        "rank_tier": tier_idx,
        "rank_name": p.disguise_rank_name,
        "rank_division": division,
    }


@pytest.mark.parametrize(
    "tier_idx, rp, expected_division",
    [
        (5, 1500, 3),   # Diamond III (entry)
        (5, 1650, 2),   # Diamond II  (middle)
        (5, 1750, 1),   # Diamond I   (top)
        (2, 700,  2),   # Gold II
        (4, 1300, 2),   # Emerald II
        (0, 50,   3),   # Bronze III
    ],
)
def test_bot_row_carries_correct_division_for_display(tier_idx, rp, expected_division):
    """Every tier / division combo we display must serialize with a
    non-null `rank_division` — 3 (III), 2 (II) or 1 (I). The frontend
    reads this to append the roman numeral after the tier name."""
    row = _row_for_bot(tier_idx, rp, is_ranked=True)
    assert row["rank_division"] == expected_division, (
        f"Bot at tier {tier_idx} RP {rp} → division {row['rank_division']}, "
        f"expected {expected_division}"
    )
    # And casual mirrors ranked — same division logic, no divergence.
    row_casual = _row_for_bot(tier_idx, rp, is_ranked=False)
    assert row_casual["rank_division"] == expected_division


def test_end_match_source_includes_bot_rank_division_key():
    """Grep guard: the `server.py` end_match code paths must emit
    `rank_division` on bot rows. Cheap and catches a future refactor
    that drops the key without noticing the scoreboard label breaks."""
    src = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
    # Count the bot-row placement dicts that carry rank_division.
    # There are exactly two (ranked branch + casual branch), both must
    # include the key. Look for the specific comment anchors so this
    # test doesn't break on unrelated `rank_division` mentions.
    assert 'bot_tier_division = rank_division_for_points' in src, (
        "Ranked-branch bot row no longer computes `bot_tier_division` — "
        "the end-match scoreboard will show 'DIAMOND' instead of 'DIAMOND II'."
    )
    assert 'tier_division = rank_division_for_points(disguise_rp, tier_idx)' in src, (
        "Casual-branch bot row no longer computes disguised `tier_division` — "
        "the end-match scoreboard will show 'DIAMOND' instead of 'DIAMOND II'."
    )
