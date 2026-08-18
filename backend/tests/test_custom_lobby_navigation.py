"""Regression test: Custom Lobby navigation must hit `/play` with
`state.fromLobby: true` — not `/game` and not without the state.

User report (2026-02-24): "When in party and click custom game, screen
flashes white and nothing happens."

Root cause: PartyPanel navigated to `/game?mode=party&...` but the
React Router route is `/play`, and even the correct path requires
`location.state.fromLobby === true` or `MatchEntryGuard` bounces the
user back to `/lobby`. Either failure produces a white flash (empty
render, then instant redirect).

This is a JSX/React test we can't run directly in pytest, so we
grep-guard the file's two navigation sites so a future refactor can't
silently reintroduce either half of the bug.
"""
import pathlib


PARTY_PANEL = pathlib.Path("/app/frontend/src/components/PartyPanel.jsx")


def test_leader_startcustomlobby_uses_play_route():
    """The leader's click handler must navigate to `/play`."""
    src = PARTY_PANEL.read_text(encoding="utf-8")
    # The leader's nav call must include the /play?mode=party path.
    assert '`/play?mode=party&party_id=${party.party_id}`' in src, (
        "Leader Custom Lobby nav must target /play (not /game) or "
        "React Router has no matching route → white flash."
    )


def test_leader_startcustomlobby_stamps_fromlobby_state():
    """MatchEntryGuard around `/play` requires `state.fromLobby === true`.
    Without this stamp, the guard bounces the user back to /lobby with
    a visible white flash."""
    src = PARTY_PANEL.read_text(encoding="utf-8")
    # Anchor on the whole startCustomLobby block so we know the stamp
    # is next to the correct call, not some unrelated navigate.
    marker = "const startCustomLobby = useCallback(async ()"
    assert marker in src
    block = src.split(marker, 1)[1][:800]
    assert "state: { fromLobby: true }" in block, (
        "Leader nav is missing `state: { fromLobby: true }` — the "
        "MatchEntryGuard will bounce the leader back to /lobby."
    )


def test_member_useeffect_uses_play_route_with_state():
    """The member auto-navigation useEffect had the same bug — must
    also target /play + stamp `state.fromLobby: true`."""
    src = PARTY_PANEL.read_text(encoding="utf-8")
    assert '`/play?mode=party&party_id=${party.party_id}${party.tdm ? "&tdm=1" : ""}`' in src, (
        "Member auto-nav useEffect must target /play, not /game."
    )
    # Verify the stamp is next to the member nav call — search inside
    # the useEffect body.
    ue_marker = "Members: when the leader flips `match_starting`"
    assert ue_marker in src
    block = src.split(ue_marker, 1)[1][:900]
    assert "state: { fromLobby: true }" in block, (
        "Member auto-nav useEffect missing state.fromLobby — "
        "party members will white-flash back to /lobby."
    )


def test_no_stray_game_route_references():
    """Belt and suspenders — no legacy `/game?mode=party` references
    should exist in PartyPanel. Any leftover would silently re-break
    the flow if a future edit swaps back to the wrong navigate call."""
    src = PARTY_PANEL.read_text(encoding="utf-8")
    assert "/game?mode=party" not in src, (
        "Stray /game?mode=party reference — router will have no match "
        "and the click flashes white."
    )
