import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ShieldAlert, Clock } from "lucide-react";

/* Stripped-down login screen — no decor, no rotation, no extras.
   Just the brand wordmark, two inputs, sign-in button, and a sign-up link. */
export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() => {
    try { return localStorage.getItem("virtue.remember") !== "0"; } catch { return true; }
  });
  const [error, setError] = useState("");
  const [ban, setBan] = useState(null); // structured ban payload from backend
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBan(null);
    setLoading(true);
    try { localStorage.setItem("virtue.remember", remember ? "1" : "0"); } catch {}
    const r = await login(email, password, { remember });
    setLoading(false);
    if (r.ok) nav("/lobby");
    else {
      // Prefer the rich ban banner when the backend returned the
      // structured `ban` payload; fall back to the generic error toast.
      if (r.ban) setBan(r.ban);
      else setError(r.error || "Login failed");
    }
  };

  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center bg-neutral-950 p-4 sm:p-6"
      data-testid="login-page"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-3 sm:space-y-4"
        data-testid="login-form"
      >
        <div className="text-center mb-2">
          <div className="font-display text-4xl tracking-tight">
            <span className="text-[#E62429]">VIR</span><span className="text-[#0055FF]">TUE</span>
          </div>
          <p className="text-neutral-500 text-xs uppercase tracking-widest mt-1">Sign in to play</p>
        </div>

        <div>
          <label className="text-neutral-400 text-xs uppercase tracking-widest" htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            className="w-full mt-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white focus:outline-none focus:border-[#E62429]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="login-email-input"
          />
        </div>
        <div>
          <label className="text-neutral-400 text-xs uppercase tracking-widest" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            className="w-full mt-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white focus:outline-none focus:border-[#E62429]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            data-testid="login-password-input"
          />
        </div>

        {ban && (
          <div
            className="border-2 border-[#E62429] rounded overflow-hidden"
            data-testid="login-ban-banner"
            role="alert"
          >
            <div className="bg-[#E62429] text-white px-3 py-2 flex items-center gap-2 font-anton uppercase tracking-widest text-sm">
              <ShieldAlert size={16} strokeWidth={3} />
              ACCOUNT {ban.status === "banned" ? "PERMANENTLY BANNED" : "SUSPENDED"}
            </div>
            <div className="bg-[#E62429]/10 text-[#FFB3B3] text-sm px-3 py-3 space-y-2">
              <div className="text-white">
                <span className="text-neutral-400 text-xs uppercase tracking-widest">Reason:</span>
                <div className="text-sm mt-0.5">{ban.reason || "Violation of community guidelines"}</div>
              </div>
              {ban.until && (
                <div className="text-white flex items-start gap-1.5">
                  <Clock size={13} strokeWidth={3} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-neutral-400 text-xs uppercase tracking-widest">Suspension ends:</span>
                    <div className="text-sm">{new Date(ban.until).toLocaleString()}</div>
                  </div>
                </div>
              )}
              {!ban.until && ban.status === "banned" && (
                <div className="text-[#FFD700] text-xs uppercase tracking-widest font-anton">
                  This sanction has no expiration date.
                </div>
              )}
              {ban.by && (
                <div className="text-neutral-400 text-[11px] uppercase tracking-widest">
                  Issued by {ban.by}
                </div>
              )}
            </div>
          </div>
        )}

        {error && !ban && (
          <div
            className="bg-[#E62429]/10 border border-[#E62429]/40 text-[#FF6B6B] text-sm rounded px-3 py-2"
            data-testid="login-error"
          >
            {error}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer select-none" data-testid="login-remember-row">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 accent-[#E62429] bg-neutral-800 border-neutral-700"
            data-testid="login-remember-checkbox"
          />
          <span>Remember me</span>
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#E62429] hover:bg-[#c41c21] disabled:opacity-60 text-white font-anton uppercase tracking-widest py-2.5 rounded transition-colors"
          data-testid="login-submit-button"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <div className="text-center text-sm text-neutral-400 pt-1">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="text-white underline hover:text-[#FFD700]" data-testid="login-register-link">
            Sign up
          </Link>
        </div>
      </form>
    </div>
  );
}
