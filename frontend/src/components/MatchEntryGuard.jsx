/* MatchEntryGuard — wraps the /play route so the heavy Game component
   only mounts when the user actually came from a queue/party/practice
   button click (which routes through `navigateToMatch`, stamping
   `location.state.fromLobby = true`). Pasting/refreshing the /play URL
   drops that state — the guard then synchronously redirects to /lobby
   so no WebSocket / engine / audio code ever spins up for a bare-URL
   visit.

   Spectate share links (`/spectate/:username`) intentionally bypass
   this guard — they're a legitimate "watch someone else" entry point
   that should keep working when shared.

   Lives in its own file so the routing concern stays out of Game.jsx
   (which has a long mount-effect chain that would have collided with
   any in-component early-return). */
import { Navigate, useLocation } from "react-router-dom";

export default function MatchEntryGuard({ children }) {
  const location = useLocation();
  const cameFromLobby = !!location.state?.fromLobby;
  if (!cameFromLobby) {
    return <Navigate to="/lobby" replace />;
  }
  return children;
}
