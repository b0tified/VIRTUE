"""TDM mode — backend contract tests:
  - GameRoom has `game_mode` and `team_scores` fields
  - `_assign_team` balances 3v3
  - Friendly fire is suppressed in TDM (source-level check on shoot/laser/melee paths)
  - Quick-match casual rolls TDM at the configured probability
  - WS handler accepts the `tdm` query param
  - Practice + offline routes split FFA vs TDM rooms
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def test_constants_present():
    assert server.TDM_KILL_TARGET == 30
    assert server.TDM_TEAM_SIZE == 3
    assert 0.0 < server.TDM_QUICK_MATCH_ROLL <= 1.0


def test_gameroom_ffa_default():
    r = server.GameRoom(is_ranked=False)
    assert r.game_mode == "ffa"
    assert r.team_scores == {"red": 0, "blue": 0}


def test_gameroom_tdm_field_and_scores():
    r = server.GameRoom(is_ranked=False, game_mode="tdm")
    assert r.game_mode == "tdm"
    assert "red" in r.team_scores and "blue" in r.team_scores


def test_invalid_game_mode_coerces_to_ffa():
    r = server.GameRoom(is_ranked=False, game_mode="garbage")
    assert r.game_mode == "ffa"


def test_assign_team_balances_3v3():
    """`_assign_team` should split players evenly across red/blue. With a
    fresh room, the first two assigns must produce one red + one blue."""
    r = server.GameRoom(is_ranked=False, game_mode="tdm")

    class P:
        def __init__(self):
            self.team = None
            self.is_spectator = False
    a, b = P(), P()
    r.players["a"] = a; r._assign_team(a)
    r.players["b"] = b; r._assign_team(b)
    assert {a.team, b.team} == {"red", "blue"}


def test_ffa_assign_team_is_noop():
    r = server.GameRoom(is_ranked=False, game_mode="ffa")

    class P:
        team = "should-clear"
        is_spectator = False
    p = P()
    r._assign_team(p)
    assert p.team is None


def test_friendly_fire_blocked_in_apply_shoot():
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    # All three damage paths must short-circuit on same-team hit.
    needles = [
        # Inside _apply_shoot (raycast hit)
        "if self.game_mode == \"tdm\" and shooter.team and hit.team and shooter.team == hit.team:",
        # Inside laser beam
        # Same predicate string appears verbatim above the laser damage line.
    ]
    # The same predicate string is used in both shoot and laser. Count
    # occurrences so we don't regress one path.
    assert src.count("shooter.team and hit.team and shooter.team == hit.team") >= 2, \
        "TDM friendly fire suppression must guard both bullet and laser damage paths."
    # Melee path uses attacker/p variable names.
    assert "attacker.team and p.team and attacker.team == p.team" in src, \
        "TDM friendly fire suppression must also guard the melee path."


def test_on_team_kill_credits_team_and_arms_early_end():
    r = server.GameRoom(is_ranked=False, game_mode="tdm", match_duration=120.0)

    class K:
        team = "red"
    # Bump red's score up to TDM_KILL_TARGET - 1 manually to avoid
    # round-trip; one more kill via _on_team_kill should arm the end.
    r.team_scores["red"] = server.TDM_KILL_TARGET - 1
    r._on_team_kill(K())
    assert r.team_scores["red"] == server.TDM_KILL_TARGET
    assert r._tdm_early_end_armed is True


def test_on_team_kill_ffa_is_noop():
    r = server.GameRoom(is_ranked=False, game_mode="ffa")

    class K:
        team = "red"
    r._on_team_kill(K())
    assert r.team_scores["red"] == 0


def test_ws_handler_accepts_tdm_param():
    """Sanity: the WS endpoint signature must include the `tdm` query
    parameter so the frontend can route practice/offline → TDM rooms."""
    import inspect
    sig = inspect.signature(server.ws_game)
    assert "tdm" in sig.parameters, "ws_game must accept ?tdm=… query param"


def test_dedicated_quick_match_tdm_room_exists():
    """A separate `tdm_room` singleton must exist so casual TDM joins
    don't pollute the FFA `game_room`. Bot fill happens inside the
    FastAPI startup handler so we just verify the room is present and
    has the correct mode here."""
    assert hasattr(server, "tdm_room")
    assert server.tdm_room.game_mode == "tdm"


def test_dedicated_practice_tdm_room_exists():
    assert hasattr(server, "practice_tdm_room")
    assert server.practice_tdm_room.game_mode == "tdm"
    assert getattr(server.practice_tdm_room, "is_practice", False) is True
