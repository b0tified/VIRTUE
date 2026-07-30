"""Iteration 24 — jump broadcast + MATCHED_USERS cleanup smoke tests.

Covers the two bugs fixed together:
  (a) Player._jump_start_ms drives to_state() sin-arc for humans so
      remote clients see the jump.
  (b) ws_game finally block clears MATCHED_USERS[u_id_str] so a
      /lobby background poll can't yank the user back into a match
      immediately after they press EXIT.
"""
import math
import os
import sys
import time

import pytest

# Ensure backend on path
BACKEND_DIR = "/app/backend"
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# server.py imports emergentintegrations & Mongo at module load; those are
# already in place in the environment. Just import Player + constants.
from server import Player, PLAYER_HEIGHT  # noqa: E402


def _mk_player():
    fake_user = {"_id": "test-user-1", "username": "tester", "email": "tester@example.com"}
    p = Player(ws=None, user=fake_user, is_bot=False, bot_name="")
    # Player init picks a random spawn but leaves y at PLAYER_HEIGHT.
    p.y = PLAYER_HEIGHT
    return p


class TestJumpBroadcast:
    def test_fresh_player_has_zero_jump_start(self):
        p = _mk_player()
        assert p._jump_start_ms == 0

    def test_to_state_grounded_returns_player_height(self):
        p = _mk_player()
        state = p.to_state()
        assert state["y"] == round(PLAYER_HEIGHT, 3)

    def test_to_state_midarc_lifts_y_above_ground(self):
        p = _mk_player()
        now_ms = int(time.time() * 1000)
        # 100ms into 650ms arc → sin(pi*100/650) * 1.2 ≈ 0.55m above ground
        p._jump_start_ms = now_ms - 100
        state = p.to_state()
        assert state["y"] > round(PLAYER_HEIGHT, 3), (
            f"expected mid-arc lift, got y={state['y']}"
        )
        # Expected value ≈ 1.8 + sin(pi*100/650)*1.2
        expected = PLAYER_HEIGHT + math.sin((100 / 650.0) * math.pi) * 1.2
        assert abs(state["y"] - round(expected, 3)) < 0.05

    def test_to_state_after_arc_snaps_back_and_resets(self):
        p = _mk_player()
        now_ms = int(time.time() * 1000)
        p._jump_start_ms = now_ms - 700  # arc expired (>650ms)
        state = p.to_state()
        assert state["y"] == round(PLAYER_HEIGHT, 3)
        assert p._jump_start_ms == 0, "arc expiry must clear _jump_start_ms"

    def test_bots_do_not_use_the_human_jump_arc(self):
        """Bots update y directly in _tick_bots; to_state() must NOT
        overwrite their y based on _jump_start_ms."""
        p = Player(ws=None, user=None, is_bot=True, bot_name="TESTBOT")
        p.y = 3.5  # simulate bot mid-jump directly
        p._jump_start_ms = int(time.time() * 1000) - 100
        state = p.to_state()
        # For bots, the sin-arc branch is skipped and y is returned as-is.
        assert state["y"] == 3.5


class TestMatchedUsersCleanupPresent:
    """Static smoke — the belt-and-suspenders MATCHED_USERS.pop line
    must live inside the ws_game finally clause so leaving via a
    dropped connection still clears matched state."""

    def test_matched_users_pop_line_exists(self):
        src = open("/app/backend/server.py").read()
        assert "MATCHED_USERS.pop(u_id_str, None)" in src

    def test_jump_message_handler_exists(self):
        src = open("/app/backend/server.py").read()
        assert 'mtype == "jump"' in src
        assert "_jump_start_ms = now_ms" in src
