/* navigateToMatch.js — single helper to start the comic-style loading
   overlay and navigate to the in-match route after a short hold.

   The overlay is rendered globally in Lobby.jsx via MatchLoadingScreen.
   It listens for the `virtue-match-loading` window event (carrying the
   mode + username), shows itself for 1.4s, then dismisses when the route
   has changed (Lobby unmount auto-clears the overlay).

   Usage:
     navigateToMatch(nav, "/play?mode=ranked", { mode: "ranked", username });

   Returns a no-op cancel function — callers can ignore if they don't
   need to abort the nav.
*/
export const MATCH_LOAD_MS = 1400;

export function navigateToMatch(nav, route, { mode = "casual", username } = {}, options = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent("virtue-match-loading", { detail: { mode, username } }),
    );
  } catch {}
  const t = setTimeout(() => nav(route, options), MATCH_LOAD_MS);
  return () => clearTimeout(t);
}
