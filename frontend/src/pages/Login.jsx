import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

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
    <div className="min-h-screen flex items-center justify-center bg-[#F4F4F5] halftone-light p-6" data-testid="login-page">
      <form onSubmit={onSubmit} className="card-pow p-8 w-full max-w-md -rotate-1" data-testid="login-form">
        <div className="inline-block bg-[#FFD700] border-pow shadow-pow-sm px-3 py-1 -rotate-2 mb-4">
          <span className="font-anton uppercase tracking-widest">Welcome Back</span>
        </div>
        <h1 className="font-display text-5xl uppercase text-[#E62429] text-pow-shadow">LOG IN</h1>
        <p className="font-body text-sm uppercase tracking-widest text-neutral-600 mt-1">Grab your loadout</p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="font-anton uppercase tracking-[0.2em] text-sm">Email</label>
            <input
              type="email"
              className="input-pow mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="login-email-input"
            />
          </div>
          <div>
            <label className="font-anton uppercase tracking-[0.2em] text-sm">Password</label>
            <input
              type="password"
              className="input-pow mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="login-password-input"
            />
          </div>

          {error && (
            <div className="border-pow-thin bg-[#E62429] text-white p-3 font-anton uppercase tracking-wide text-sm" data-testid="login-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-pow bg-[#E62429] text-white w-full"
            data-testid="login-submit-button"
          >
            <span>{loading ? "LOADING..." : "LOG IN"}</span>
          </button>
        </div>

        <div className="mt-6 font-body text-sm">
          Need an account?{" "}
          <Link to="/register" className="font-anton uppercase underline" data-testid="login-register-link">
            Sign up
          </Link>
        </div>
        <div className="mt-1 font-body text-xs text-neutral-500">
          Demo: admin@shooter.com / admin123
        </div>
      </form>
    </div>
  );
}
