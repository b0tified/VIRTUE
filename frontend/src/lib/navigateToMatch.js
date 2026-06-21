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
  // Stamp `fromLobby: true` onto the nav state so the `/play` route can
  // verify the user actually clicked a queue/party button instead of
  // pasting the URL directly. Game.jsx kicks unauthenticated direct
  // visits back to /lobby. We merge `state` defensively so a caller
  // passing its own `options.state` extras still gets the flag.
  const mergedState = { ...(options.state || {}), fromLobby: true };
  const t = setTimeout(() => nav(route, { ...options, state: mergedState }), MATCH_LOAD_MS);
  return () => clearTimeout(t);
}
