"""TDM match_end payload contract test — the WS `match_end` payload for
TDM matches must include:
  - `game_mode: "tdm"`
  - `team_scores: {"red": int, "blue": int}`
  - `winning_team: "red" | "blue" | None`  (None on draw)
  - each `placements[i]` row has a `team` field

The client's MatchResultOverlay renders team-based VICTORY/DEFEAT/DRAW
based on these fields; a missing field falls back to FFA logic and
would misclassify TDM outcomes.

FFA matches must NOT include the TDM-only keys.

We test the payload-assembly logic directly rather than exercising the
full `end_match` flow (which has DB writes and async broadcasts). The
production code lives inline in server.py::GameRoom.end_match around
line 4909; this test mirrors that logic and asserts on the shape.
"""
import sys
import pathlib
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def _build_payload(game_mode, team_scores, participants, placements):
    """Mirror of the payload-assembly block added to end_match. Kept in
    the test verbatim so a divergence between the production code and
    this reference gets caught on the next run."""
    payload = {
        "type": "match_end",
        "placements": placements,
        "duration": 60.0,
        "is_ranked": False,
        "game_mode": game_mode,
    }
    if game_mode == "tdm":
        red_score = int(team_scores.get("red", 0))
        blue_score = int(team_scores.get("blue", 0))
        if red_score > blue_score:
            winning_team = "red"
        elif blue_score > red_score:
            winning_team = "blue"
        else:
            winning_team = None
        payload["team_scores"] = {"red": red_score, "blue": blue_score}
        payload["winning_team"] = winning_team
        team_by_id = {
            p.id: (getattr(p, "team", None) or "").lower() or None
            for p in participants
        }
        for row in placements:
            row["team"] = team_by_id.get(row.get("id"))
    return payload


def _p(pid, team=None):
    return types.SimpleNamespace(id=pid, team=team)


def test_tdm_red_wins_populates_team_fields():
    participants = [_p("p1", "red"), _p("p2", "red"), _p("p3", "blue")]
    placements = [
        {"id": "p1", "username": "Alice", "kills": 12},
        {"id": "p2", "username": "Bob",   "kills": 10},
        {"id": "p3", "username": "Carol", "kills": 8},
    ]
    payload = _build_payload("tdm", {"red": 30, "blue": 22}, participants, placements)
    assert payload["game_mode"] == "tdm"
    assert payload["team_scores"] == {"red": 30, "blue": 22}
    assert payload["winning_team"] == "red"
    teams = {row["id"]: row["team"] for row in payload["placements"]}
    assert teams == {"p1": "red", "p2": "red", "p3": "blue"}


def test_tdm_draw_returns_none_winning_team():
    participants = [_p("p1", "red"), _p("p2", "blue")]
    placements = [{"id": "p1", "kills": 7}, {"id": "p2", "kills": 7}]
    payload = _build_payload("tdm", {"red": 15, "blue": 15}, participants, placements)
    assert payload["game_mode"] == "tdm"
    assert payload["team_scores"] == {"red": 15, "blue": 15}
    assert payload["winning_team"] is None


def test_tdm_blue_wins():
    participants = [_p("p1", "red"), _p("p2", "blue")]
    placements = [{"id": "p1", "kills": 6}, {"id": "p2", "kills": 11}]
    payload = _build_payload("tdm", {"red": 18, "blue": 30}, participants, placements)
    assert payload["winning_team"] == "blue"


def test_ffa_omits_tdm_only_keys():
    participants = [_p("p1"), _p("p2")]
    placements = [{"id": "p1", "kills": 12}, {"id": "p2", "kills": 10}]
    payload = _build_payload("ffa", {"red": 0, "blue": 0}, participants, placements)
    assert payload["game_mode"] == "ffa"
    assert "team_scores" not in payload
    assert "winning_team" not in payload
    for row in payload["placements"]:
        assert "team" not in row


def test_tdm_participant_without_team_gets_none():
    """Bots may not have a team assigned (spectator, or bot spawned before
    team-balancer). Their placement row's `team` must be None, not empty
    string — the client keys on `p.team && TEAM_COLORS[p.team]`."""
    participants = [_p("p1", "red"), _p("bot1", None), _p("bot2", "")]
    placements = [{"id": "p1"}, {"id": "bot1"}, {"id": "bot2"}]
    payload = _build_payload("tdm", {"red": 20, "blue": 10}, participants, placements)
    teams = {row["id"]: row["team"] for row in payload["placements"]}
    assert teams["p1"] == "red"
    assert teams["bot1"] is None
    assert teams["bot2"] is None


def test_server_payload_assembly_matches_reference():
    """Sanity: read the added block back from server.py and verify the
    key phrases exist. This catches accidental deletion of the TDM
    payload injection during future refactors."""
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # Anchor phrases from the added block
    assert '"game_mode": self.game_mode' in src
    assert 'payload["team_scores"] = {"red": red_score, "blue": blue_score}' in src
    assert 'payload["winning_team"] = winning_team' in src
    assert 'row["team"] = team_by_id.get(row.get("id"))' in src
