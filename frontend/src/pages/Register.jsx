import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const r = await register(email, password, username);
    setLoading(false);
    if (r.ok) nav("/lobby");
    else setError(r.error || "Registration failed");
  };

  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center bg-neutral-950 p-4 sm:p-6"
      data-testid="register-page"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-3 sm:space-y-4"
        data-testid="register-form"
      >
        <div className="text-center mb-2">
          <div className="font-display text-4xl tracking-tight">
            <span className="text-[#E62429]">VIR</span><span className="text-[#0055FF]">TUE</span>
          </div>
          <p className="text-neutral-500 text-xs uppercase tracking-widest mt-1">Create your account</p>
        </div>

        <div>
          <label className="text-neutral-400 text-xs uppercase tracking-widest" htmlFor="register-username">Username</label>
          <input
            id="register-username"
            className="w-full mt-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white focus:outline-none focus:border-[#0055FF]"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={2}
            maxLength={20}
            required
            data-testid="register-username-input"
          />
        </div>
        <div>
          <label className="text-neutral-400 text-xs uppercase tracking-widest" htmlFor="register-email">Email</label>
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            className="w-full mt-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white focus:outline-none focus:border-[#0055FF]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="register-email-input"
          />
        </div>
        <div>
          <label className="text-neutral-400 text-xs uppercase tracking-widest" htmlFor="register-password">Password</label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            className="w-full mt-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white focus:outline-none focus:border-[#0055FF]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            data-testid="register-password-input"
          />
        </div>

        {error && (
          <div
            className="bg-[#E62429]/10 border border-[#E62429]/40 text-[#FF6B6B] text-sm rounded px-3 py-2"
            data-testid="register-error"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0055FF] hover:bg-[#0044cc] disabled:opacity-60 text-white font-anton uppercase tracking-widest py-2.5 rounded transition-colors"
          data-testid="register-submit-button"
        >
          {loading ? "Loading..." : "Create Account"}
        </button>

        <div className="text-center text-sm text-neutral-500">
          Already have an account?{" "}
          <Link to="/login" className="text-[#0055FF] hover:text-[#3377FF] uppercase tracking-wider" data-testid="register-login-link">
            Log in
          </Link>
        </div>
      </form>
    </div>
  );
}
