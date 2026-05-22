import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";

/* Lands here after Emergent-managed Google OAuth.
   The session_id arrives in the URL hash fragment (e.g. /#session_id=abc).
   We forward it to our backend which exchanges it for our normal JWT and
   creates the user if their Google email is new. */
export default function AuthCallback() {
  const nav = useNavigate();
  const { refreshMe } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = window.location.hash || "";
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setError("Missing session_id");
      return;
    }
    (async () => {
      try {
        await api.post("/auth/google/callback", { session_id: sessionId });
        await refreshMe?.();
        nav("/lobby", { replace: true });
      } catch (e) {
        setError(e.response?.data?.detail || "Google sign-in failed");
      }
    })();
  }, [refreshMe, nav]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white p-6" data-testid="auth-callback">
      {error ? (
        <div className="max-w-sm text-center">
          <h1 className="font-display text-3xl text-[#E62429] mb-2">Sign-in failed</h1>
          <p className="text-neutral-400">{error}</p>
          <button onClick={() => nav("/login", { replace: true })} className="mt-4 bg-white text-black rounded px-4 py-2 font-anton uppercase tracking-widest" data-testid="auth-callback-back">
            Back to login
          </button>
        </div>
      ) : (
        <div className="text-center">
          <div className="font-anton uppercase tracking-widest text-sm text-neutral-500">Signing you in</div>
          <div className="font-display text-4xl mt-1">VIR<span className="text-[#E62429]">TUE</span></div>
        </div>
      )}
    </div>
  );
}
