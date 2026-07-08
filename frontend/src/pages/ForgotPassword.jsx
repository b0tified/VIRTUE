import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/api";

/* Forgot-password flow (security-question based).
   Two-step:
     1. Email input → server returns the account's security question
        (or the generic "no question set" message).
     2. Answer + new password → server validates via bcrypt and updates
        the password hash. Rate-limited 5/hour per email server-side. */
export default function ForgotPassword() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const submitChallenge = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/forgot-password/challenge", { email });
      if (!data.question) {
        setError(
          data.message ||
            "No security question is set for that account. Please contact support.",
        );
      } else {
        setQuestion(data.question);
        setStep(2);
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Something went wrong.");
    }
    setLoading(false);
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/forgot-password/reset", {
        email,
        answer,
        new_password: newPassword,
      });
      setOk("Password reset. Redirecting to sign-in…");
      setTimeout(() => nav("/login"), 1500);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Reset failed.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <form
        onSubmit={step === 1 ? submitChallenge : submitReset}
        className="w-full max-w-sm space-y-4 bg-neutral-900 p-6 rounded-lg border border-neutral-800"
        data-testid="forgot-password-form"
      >
        <div className="text-center">
          <div className="font-anton uppercase tracking-widest text-white text-2xl">
            {step === 1 ? "Forgot Password" : "Answer & Reset"}
          </div>
          <div className="text-neutral-400 text-xs mt-1">
            {step === 1
              ? "We'll ask your security question."
              : "Answer correctly to set a new password."}
          </div>
        </div>

        {step === 1 && (
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-neutral-800 text-white px-3 py-2 rounded outline-none focus:ring-2 focus:ring-[#FFD700]"
            required
            data-testid="forgot-password-email"
          />
        )}

        {step === 2 && (
          <>
            <div
              className="bg-neutral-800 text-white text-sm px-3 py-2 rounded"
              data-testid="forgot-password-question"
            >
              {question}
            </div>
            <input
              type="text"
              placeholder="Your answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="w-full bg-neutral-800 text-white px-3 py-2 rounded outline-none focus:ring-2 focus:ring-[#FFD700]"
              required
              data-testid="forgot-password-answer"
            />
            <input
              type="password"
              placeholder="New password (min 6 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              className="w-full bg-neutral-800 text-white px-3 py-2 rounded outline-none focus:ring-2 focus:ring-[#FFD700]"
              required
              data-testid="forgot-password-new-password"
            />
          </>
        )}

        {error && (
          <div className="text-[#E62429] text-sm" data-testid="forgot-password-error">
            {error}
          </div>
        )}
        {ok && (
          <div className="text-[#06D6A0] text-sm" data-testid="forgot-password-success">
            {ok}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#E62429] hover:bg-[#c41c21] disabled:opacity-60 text-white font-anton uppercase tracking-widest py-2.5 rounded transition-colors"
          data-testid="forgot-password-submit"
        >
          {loading ? "Working..." : step === 1 ? "Continue" : "Reset Password"}
        </button>

        <div className="text-center text-xs text-neutral-500 pt-1">
          <Link to="/login" className="hover:text-[#FFD700] underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
