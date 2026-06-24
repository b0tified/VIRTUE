import "@/App.css";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { QueueProvider } from "@/context/QueueContext";
import QueueOverlay from "@/components/QueueOverlay";
import MatchLoadingScreen from "@/components/MatchLoadingScreen";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Lobby from "@/pages/Lobby";
import Game from "@/pages/Game";
import Profile from "@/pages/Profile";
import Leaderboard from "@/pages/Leaderboard";
import AuthCallback from "@/pages/AuthCallback";
import AdminReports from "@/pages/AdminReports";
import OrientationLock from "@/components/OrientationLock";
import MatchEntryGuard from "@/components/MatchEntryGuard";
import useButtonSounds from "@/hooks/useButtonSounds";

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white">
        <div className="font-display text-4xl text-pow-shadow">LOADING...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return null;
  if (user) return <Navigate to="/lobby" replace />;
  return children;
}

function Root() {
  // Send signed-in users straight to the lobby, guests straight to login.
  const { user } = useAuth();
  if (user === null) return null;
  return <Navigate to={user ? "/lobby" : "/login"} replace />;
}

export default function App() {
  // Global UI hover-blip: any element with the `.btn-pow` class plays
  // a tiny chirp on mouseenter (throttled, muted while pointer-locked,
  // and respects the SFX toggle). Mounted once at the App level so
  // every page inherits the feedback for free.
  useButtonSounds();
  // Global right-click blocker. The FPS uses RMB to aim down sights; if
  // the browser context menu were allowed to open it would steal focus
  // away from the canvas mid-fight. We swallow `contextmenu` on the
  // capture phase so even children that don't preventDefault won't pop
  // the OS menu. Form inputs (email/password/redeem code) are
  // explicitly allowed to keep paste / spellcheck working.
  useEffect(() => {
    const onContext = (e) => {
      const t = e.target;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onContext, { capture: true });
    // Global drag-start blocker. Anchor tags + images are HTML-draggable
    // by default (you can drag a link into the URL bar / bookmarks bar),
    // which felt out-of-place in a game shell — especially the "Sign up"
    // login link. CSS `user-drag: none` covers most browsers; this
    // listener is the belt-and-braces fallback for the cases it doesn't.
    const onDragStart = (e) => {
      const t = e.target;
      const tag = (t?.tagName || "").toLowerCase();
      // Allow drag on actual file/upload inputs (none today, but cheap
      // future-proofing). Block everything else.
      if (tag === "input" && t.type === "file") return;
      e.preventDefault();
    };
    document.addEventListener("dragstart", onDragStart, { capture: true });
    return () => {
      document.removeEventListener("contextmenu", onContext, { capture: true });
      document.removeEventListener("dragstart", onDragStart, { capture: true });
    };
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <QueueProvider>
          <OrientationLock />
          <QueueOverlay />
          {/* Match loading overlay lives at the app root so it survives
              the Lobby → /play route change and can stay open until the
              server's welcome arrives (revealing the actual selected map). */}
          <MatchLoadingScreen />
          <Routes>
            <Route path="/" element={<Root />} />
            <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
            <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
            <Route path="/lobby" element={<ProtectedRoute><Lobby /></ProtectedRoute>} />
            <Route path="/play" element={<ProtectedRoute><MatchEntryGuard><Game /></MatchEntryGuard></ProtectedRoute>} />
            <Route path="/spectate/:username" element={<ProtectedRoute><Game /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
            <Route path="/admin/reports" element={<ProtectedRoute><AdminReports /></ProtectedRoute>} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </QueueProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
