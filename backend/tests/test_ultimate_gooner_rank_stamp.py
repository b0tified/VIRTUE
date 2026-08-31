"""Regression test — 2026-02-25.

User request: "Make the ultimate gooner title at the end of the season
have ur leaderboard number on it."

Design:
  - At season rollover, the past_seasons[] entry now carries
    `leaderboard_rank` (the player's final top-50 position). Users who
    finished outside top-50 don't get the field.
  - A one-shot backfill patches existing past_seasons entries by
    cross-referencing db.season_archive.top_100.
  - Frontend `formatBannerTitle` weaves the rank into the equipped
    title so a past-season Ultimate Gooner banner reads
    "S3 · #7 GOONMASTER". The current-season Ultimate title reads
    "ULTIMATE GOONER · #7".
  - `TitleTile` renders a gold "#N" pill on any past-season tile that
    was top-50 that season so the picker shows the placement too.
"""
import pathlib

SRV = pathlib.Path("/app/backend/server.py").read_text(encoding="utf-8")
PROF = pathlib.Path("/app/frontend/src/pages/Profile.jsx").read_text(encoding="utf-8")
BANNER = pathlib.Path("/app/frontend/src/game/bannerTitle.js").read_text(encoding="utf-8")


# ─── backend: rollover stamp ──────────────────────────────────────────


def test_rollover_stamps_leaderboard_rank_from_season_archive():
    """The rollover pass that appends {season, tier, tier_name, rp} to
    past_seasons[] must ALSO look up the just-archived top-50 and
    attach `leaderboard_rank` for finishers 1..50."""
    # Rank map built from db.season_archive right before the user
    # cursor is iterated.
    assert 'rank_by_uid: Dict[str, int] = {}' in SRV, (
        "Rollover must build a `rank_by_uid` map from the just-archived "
        "top-100 so past_seasons entries can carry leaderboard_rank."
    )
    # Only top-50 finishers get the field — matches the "top-50 =
    # Ultimate Gooner" definition used elsewhere.
    assert "1 <= pos <= 50" in SRV, (
        "Only top-50 finishers should get leaderboard_rank stamped — "
        "matches the existing Ultimate Gooner threshold."
    )
    # And the entry must actually receive the field.
    assert 'entry["leaderboard_rank"] = int(pos)' in SRV, (
        "past_seasons entry must be augmented with leaderboard_rank "
        "when the user was in the top 50 that season."
    )


def test_past_seasons_leaderboard_rank_backfill_registered():
    """A one-shot backfill task must exist AND be scheduled on
    startup so existing past_seasons entries (stamped before this
    feature) also get their leaderboard_rank populated."""
    assert "async def _backfill_past_seasons_leaderboard_rank_once" in SRV, (
        "The one-shot leaderboard_rank backfill function must exist."
    )
    assert "asyncio.create_task(_backfill_past_seasons_leaderboard_rank_once())" in SRV, (
        "The backfill task must be scheduled on startup, next to the "
        "existing _backfill_past_seasons_once."
    )
    # Must actually read from season_archive top_100 (source of truth).
    body = SRV.split("async def _backfill_past_seasons_leaderboard_rank_once", 1)[1][:3000]
    assert "db.season_archive.find" in body
    assert "top_100" in body


# ─── frontend: banner title formatting ────────────────────────────────


def test_banner_title_weaves_leaderboard_rank_when_available():
    """`formatBannerTitle` must render:
       • "ULTIMATE GOONER · #7"  when live top-50 title is equipped.
       • "S3 · #7 GOONMASTER"    when a past-season title with a
                                  stamped leaderboard_rank is equipped.
       • "S3 · GOONMASTER"       when a past-season title with NO
                                  leaderboard_rank is equipped (falls
                                  outside top-50).
    """
    # Live Ultimate variant surfaces the rank.
    assert "`ULTIMATE GOONER · #${rank}`" in BANNER, (
        "Live Ultimate Gooner banner must render the current "
        "leaderboard_rank inline (\"ULTIMATE GOONER · #7\")."
    )
    # Past-season variant surfaces the archived rank when present.
    assert "`S${entry.season} · #${lb} ${tierName}`" in BANNER, (
        "Past-season title with a stamped leaderboard_rank must "
        "render as \"S3 · #7 GOONMASTER\" so it visibly flexes the "
        "Ultimate placement forever."
    )
    # Fallback for finishers outside top-50 is preserved (no rank
    # tag). Any refactor that drops this fallback would leave those
    # users with a broken banner.
    assert "`S${entry.season} · ${tierName}`" in BANNER


# ─── frontend: TitleTile pill on the picker ───────────────────────────


def test_title_tile_renders_leaderboard_rank_pill():
    """The past-season TitleTile in the profile picker must render a
    small "#N" pill in the corner when the entry carries a
    leaderboard_rank. Users see it at a glance without needing to
    equip the title."""
    assert "leaderboardRank" in PROF, (
        "TitleTile must accept a `leaderboardRank` prop so the past-"
        "season picker can render the Ultimate Gooner placement."
    )
    # The pill JSX itself.
    assert "leaderboardRank != null" in PROF
    assert "#{leaderboardRank}" in PROF, (
        "The rank pill must render '#N' text (not the raw number)."
    )
    # PastTitlesCard actually passes the value from the entry.
    assert "entry?.leaderboard_rank" in PROF, (
        "PastTitlesCard must read leaderboard_rank off the entry "
        "and pass it into <TitleTile />."
    )
