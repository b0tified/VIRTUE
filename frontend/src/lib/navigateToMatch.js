/* navigateToMatch.js — single helper to start the comic-style loading
   overlay and navigate to the in-match route after a short hold.

   The overlay is rendered globally in App.js via MatchLoadingScreen.
   It listens for the `virtue-match-loading` window event (carrying the
   mode + username), shows itself, then dismisses when `virtue-match-loaded`
   arrives (fired by Game.jsx on WS welcome with the actual server-selected
   map). A safety timer in the overlay also dismisses after 6s if welcome
   never arrives.

   Usage:
     navigateToMatch(nav, "/play?mode=ranked", { mode: "ranked", username });

   Returns a no-op cancel function — callers can ignore if they don't
   need to abort the nav.
*/
// Hold the loading overlay this long on the lobby side before navigating.
// Brief — the overlay then stays mounted across the route change at the
// App root, and dismisses only when WS welcome arrives.
export const MATCH_LOAD_MS = 800;

export function navigateToMatch(nav, route, { mode = "casual", username, tdm = false, game_mode } = {}, options = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent("virtue-match-loading", {
        detail: { mode, username, tdm, game_mode },
      }),
    );
  } catch {}
  const t = setTimeout(() => nav(route, options), MATCH_LOAD_MS);
  return () => clearTimeout(t);
}
