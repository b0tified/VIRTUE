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

        <div className="flex items-center gap-3 my-1 short:hidden">
          <div className="flex-1 h-px bg-neutral-800" />
          <span className="text-[10px] text-neutral-600 uppercase tracking-widest">Or</span>
          <div className="flex-1 h-px bg-neutral-800" />
        </div>

        <button
          type="button"
          onClick={() => {
            const redirect = encodeURIComponent(window.location.origin + "/auth/callback");
            window.location.href = `https://auth.emergentagent.com/?redirect=${redirect}`;
          }}
          className="w-full bg-white hover:bg-neutral-100 text-black font-anton uppercase tracking-widest py-2.5 rounded flex items-center justify-center gap-2 transition-colors short:hidden"
          data-testid="login-google-button"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.9 6.2 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8c1.8-4.3 6-7.5 11.1-7.5 3 0 5.8 1.1 7.9 3l5.7-5.7C34.9 6.2 29.7 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.5C29.6 34.6 27 35.5 24 35.5c-5.1 0-9.5-3.3-11.2-7.9l-6.5 5C9.6 39.5 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.5c-.4.4 7.3-5.3 7.3-15 0-1.2-.1-2.4-.4-3.5z"/>
          </svg>
          Continue with Google
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
