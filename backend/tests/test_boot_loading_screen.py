"""Regression test — 2026-02-25.

User request: "Add a loading screen before the game fully load to lobby
and make it take at least 8 seconds to load lobby."

Coverage:
  - BootLoadingScreen component exists with the required minimum
    duration constant.
  - App.js gates route rendering on the splash finishing (`showRoutes`).
  - The splash uses sessionStorage so a route change / reload in the
    same tab doesn't repeat it.
"""
import pathlib


BOOT_PATH = "/app/frontend/src/components/BootLoadingScreen.jsx"
APP_PATH = "/app/frontend/src/App.js"


def test_boot_loading_screen_component_exists():
    p = pathlib.Path(BOOT_PATH)
    assert p.exists(), "BootLoadingScreen.jsx must exist."
    src = p.read_text(encoding="utf-8")
    # Enforced 8-second minimum per the user's spec — the constant
    # must be exactly 8000 (ms) so any refactor towards seconds/mins
    # trips this guard.
    assert "MIN_DURATION_MS = 8000" in src, (
        "BootLoadingScreen must enforce an 8-second minimum via "
        "`MIN_DURATION_MS = 8000` — the user requested at least 8s "
        "before the lobby paints."
    )
    # Testids required for e2e / testing agent.
    for tid in ('"boot-loading-screen"', '"boot-progress-fill"', '"boot-tip"'):
        assert tid in src, f"Missing test id {tid} on the boot splash."


def test_app_gates_routes_behind_boot_splash():
    src = pathlib.Path(APP_PATH).read_text(encoding="utf-8")
    assert "BootLoadingScreen" in src, (
        "App.js must import and render BootLoadingScreen so the "
        "splash actually shows on first tab load."
    )
    # Router must be gated on `showRoutes` — otherwise the lobby /
    # login screen paints BEHIND the splash and the transition looks
    # jarring on the 8-second tail.
    assert "showRoutes" in src
    assert "setShowRoutes" in src
    # The gate must actually short-circuit <Routes>: search for the
    # conditional render wrapping the router.
    assert "{showRoutes && (" in src, (
        "App.js must render <Routes> only when the splash resolves "
        "(setShowRoutes(true)) — otherwise the router paints early."
    )


def test_boot_splash_only_plays_once_per_session():
    src = pathlib.Path(BOOT_PATH).read_text(encoding="utf-8")
    # sessionStorage guard on both entry (initial state) and exit
    # (setItem on completion).
    assert "sessionStorage" in src
    assert "BOOT_KEY" in src, (
        "BootLoadingScreen must use a named sessionStorage key so a "
        "refresh in the same tab doesn't replay the 8s splash."
    )
    # App.js also reads the same key for its own `showRoutes` seed,
    # otherwise there'd be a flash between App-decides-to-show and
    # BootLoadingScreen-decides-to-hide.
    app_src = pathlib.Path(APP_PATH).read_text(encoding="utf-8")
    assert "virtue_boot_played_v1" in app_src, (
        "App.js must mirror BootLoadingScreen's sessionStorage key "
        "so its initial `showRoutes` state doesn't diverge from the "
        "splash's visibility."
    )
