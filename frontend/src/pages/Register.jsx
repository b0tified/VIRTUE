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
    <div className="min-h-screen flex items-center justify-center bg-[#F4F4F5] halftone-light p-6" data-testid="register-page">
      <form onSubmit={onSubmit} className="card-pow p-8 w-full max-w-md rotate-1" data-testid="register-form">
        <div className="inline-block bg-[#0055FF] text-white border-pow shadow-pow-sm px-3 py-1 -rotate-2 mb-4">
          <span className="font-anton uppercase tracking-widest">New Recruit</span>
        </div>
        <h1 className="font-display text-5xl uppercase text-[#0055FF] text-pow-shadow">SIGN UP</h1>

        <div className="mt-6 space-y-4">
          <div>
            <label className="font-anton uppercase tracking-[0.2em] text-sm">Username</label>
            <input
              className="input-pow mt-1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={2}
              maxLength={20}
              required
              data-testid="register-username-input"
            />
          </div>
          <div>
            <label className="font-anton uppercase tracking-[0.2em] text-sm">Email</label>
            <input
              type="email"
              className="input-pow mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="register-email-input"
            />
          </div>
          <div>
            <label className="font-anton uppercase tracking-[0.2em] text-sm">Password</label>
            <input
              type="password"
              className="input-pow mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              data-testid="register-password-input"
            />
          </div>

          {error && (
            <div className="border-pow-thin bg-[#E62429] text-white p-3 font-anton uppercase tracking-wide text-sm" data-testid="register-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-pow bg-[#0055FF] text-white w-full"
            data-testid="register-submit-button"
          >
            <span>{loading ? "LOADING..." : "CREATE ACCOUNT"}</span>
          </button>
        </div>

        <div className="mt-6 font-body text-sm">
          Already have an account?{" "}
          <Link to="/login" className="font-anton uppercase underline" data-testid="register-login-link">
            Log in
          </Link>
        </div>
      </form>
    </div>
  );
}
