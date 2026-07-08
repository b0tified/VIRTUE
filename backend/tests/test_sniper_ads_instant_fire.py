"""Regression test for the "sniper can't shoot the second you ADS" bug.

Root cause: the server's shoot handler only knew about a player's ADS
state through the 20Hz input tick. A right-click-then-immediate-fire
sequence could arrive at the server before the input tick's `ads: true`
propagated (up to ~50ms delay), so the very first sniper shot after
ADS was silently rejected by the `ads_only` gate.

Fix: the shoot message now carries an `ads` field that mirrors the
client's live ADS state. The server honors it on every shoot,
eliminating the race entirely.
"""
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1].joinpath("server.py").read_text()


def test_shoot_handler_honors_per_shot_ads_mirror():
    """The `shoot` branch must apply `msg["ads"]` to `player.is_ads`
    before the `ads_only` gate — otherwise a right-click-then-fire
    sequence loses its first shot to a stale ADS flag."""
    idx = SRC.find('elif mtype == "shoot":')
    assert idx >= 0, "shoot handler missing"
    ads_gate_idx = SRC.find('if cfg.get("ads_only") and not player.is_ads', idx)
    assert ads_gate_idx > idx, "ads_only gate missing"
    block = SRC[idx: ads_gate_idx]
    # Must consult msg["ads"] BEFORE the gate check.
    assert '"ads" in msg' in block, (
        "shoot handler must read `msg['ads']` before the ads_only gate — "
        "otherwise sniper users can't fire the instant they ADS."
    )
    assert "player.is_ads = bool(msg[\"ads\"])" in block or 'player.is_ads = bool(msg["ads"])' in block, (
        "shoot handler must set `player.is_ads` from the shoot message's ads field."
    )
