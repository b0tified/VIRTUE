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
    # Enforced 8-13 second window per the user's spec — the constants
    # must be exactly MIN 8000ms and MAX 13000ms so any refactor
    # towards seconds/mins trips this guard. A random duration is
    # picked once per mount so a fresh page load feels varied.
    assert "MIN_DURATION_MS = 8000" in src, (
        "BootLoadingScreen must enforce an 8-second minimum via "
        "`MIN_DURATION_MS = 8000` — the user requested at least 8s."
    )
    assert "MAX_DURATION_MS = 13000" in src, (
        "BootLoadingScreen must cap the splash at 13s via "
        "`MAX_DURATION_MS = 13000` — the user requested a 8-13s window."
    )
    assert "pickBootDuration" in src, (
        "BootLoadingScreen must define a `pickBootDuration()` helper "
        "that picks the roll inside [MIN, MAX] once per mount."
    )
    assert "durationRef" in src, (
        "The rolled duration must be stored in a useRef (not useState) "
        "so a re-render doesn't reshuffle the value mid-splash and "
        "cause the progress bar to jump."
    )
    # Testids required for e2e / testing agent.
    for tid in ('"boot-loading-screen"', '"boot-progress-fill"', '"boot-tip"', '"boot-subtitle"'):
        assert tid in src, f"Missing test id {tid} on the boot splash."
    # Copy the user asked for: remove "Comic-Book Combat", make the
    # subtitle track the live season number from /api/season, and
    # replace the rotating tips with a plain "Loading" string.
    assert "Comic-Book Combat" not in src, (
        "User asked for the 'Comic-Book Combat' text to be removed "
        "from the boot splash subtitle."
    )
    assert "2026 Season" not in src, (
        "Hard-coded season string leaked back into the splash — must "
        "read the current season from GET /api/season instead."
    )
    assert 'api.get("/season")' in src, (
        "Splash must probe /api/season on mount so the subtitle "
        "reflects the CURRENT season, not a hard-coded year."
    )
    # The tip strip is now a static "Loading" label, not a rotating
    # tip carousel. Confirm the carousel state + array are gone.
    assert "TIPS[" not in src and "const TIPS" not in src, (
        "Rotating TIPS array must be removed — user asked for the "
        "small text below the bar to just say 'loading'."
    )


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


def test_boot_splash_plays_on_every_refresh():
    """User requirement: 'make the loading screen play every time you
    refresh'. That means NO sessionStorage / localStorage persistence
    across refreshes. On mount the splash must always start visible
    and App.js's `showRoutes` must always start false, so a browser
    refresh (which remounts the tree) triggers a fresh 8-second
    splash every time. Route changes within a session don't remount
    App, so `showRoutes` correctly stays true once resolved."""
    boot_src = pathlib.Path(BOOT_PATH).read_text(encoding="utf-8")
    assert "sessionStorage" not in boot_src, (
        "BootLoadingScreen must NOT persist a 'played' flag — the "
        "user asked for the splash to play on every refresh."
    )
    assert "localStorage" not in boot_src, (
        "Same reason as sessionStorage — no persistent 'skip me' flag."
    )
    # The initial visible state must be an unconditional `useState(true)`
    # so a refresh always shows the splash.
    assert "useState(true)" in boot_src, (
        "The splash's `visible` state must default to `true` on mount "
        "so a refresh always triggers a fresh splash."
    )

    app_src = pathlib.Path(APP_PATH).read_text(encoding="utf-8")
    assert "virtue_boot_played_v1" not in app_src, (
        "App.js must not read a persisted 'boot played' flag — the "
        "splash plays on every refresh."
    )
    assert "useState(false)" in app_src.split("const [showRoutes", 1)[1][:200], (
        "App.js `showRoutes` must start `false` on every mount so a "
        "refresh always defers the router until the splash resolves."
    )
