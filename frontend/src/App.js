import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Lobby from "@/pages/Lobby";
import Game from "@/pages/Game";
import Profile from "@/pages/Profile";
import Leaderboard from "@/pages/Leaderboard";
import AuthCallback from "@/pages/AuthCallback";

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
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route path="/lobby" element={<ProtectedRoute><Lobby /></ProtectedRoute>} />
          <Route path="/play" element={<ProtectedRoute><Game /></ProtectedRoute>} />
          <Route path="/spectate/:username" element={<ProtectedRoute><Game /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
