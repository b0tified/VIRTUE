import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

/* Stripped-down login screen — no decor, no rotation, no extras.
   Just the brand wordmark, two inputs, sign-in button, and a sign-up link. */
export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const r = await login(email, password);
    setLoading(false);
    if (r.ok) nav("/lobby");
    else setError(r.error || "Login failed");
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

        {error && (
          <div
            className="bg-[#E62429]/10 border border-[#E62429]/40 text-[#FF6B6B] text-sm rounded px-3 py-2"
            data-testid="login-error"
          >
            {error}
          </div>
        )}

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
