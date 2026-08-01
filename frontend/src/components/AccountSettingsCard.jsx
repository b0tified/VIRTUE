import { useEffect, useState } from "react";
import { UserCog, KeyRound, Check, AlertCircle } from "lucide-react";
import api from "@/api";

// Small inline banner for form success/error. Lifted out of the parent
// so React doesn't destroy+recreate its subtree on every parent render.
function StatusMsg({ msg }) {
  if (!msg?.text) return null;
  return (
    <div
      className={`flex items-center gap-1.5 text-xs mt-1 ${
        msg.kind === "ok" ? "text-[#06D6A0]" : "text-[#E62429]"
      }`}
    >
      {msg.kind === "ok" ? <Check size={14} /> : <AlertCircle size={14} />}
      <span>{msg.text}</span>
    </div>
  );
}

/* Account settings card — collects the two "account hygiene" widgets
   that used to live outside the profile page:
     • Change username (7-day cooldown, historical entries keep the
       OLD name — the server enforces both).
     • Set / update security question (used by the forgot-password
       flow at /forgot-password to prove account ownership).
   Both endpoints are auth-required; the card just wraps calls to
   /profile/me/username and /profile/me/security-question. */
export default function AccountSettingsCard({ user, refreshMe }) {
  const [newName, setNewName] = useState("");
  const [nameMsg, setNameMsg] = useState({ kind: "", text: "" });
  const [nameBusy, setNameBusy] = useState(false);

  const [questions, setQuestions] = useState([]);
  const [question, setQuestion] = useState(user?.security_question || "");
  const [answer, setAnswer] = useState("");
  const [secMsg, setSecMsg] = useState({ kind: "", text: "" });
  const [secBusy, setSecBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/auth/security-questions");
        if (alive) setQuestions(data?.questions || []);
      } catch { /* offline / auth-only endpoint failure — silent */ }
    })();
    return () => { alive = false; };
  }, []);

  const submitName = async (e) => {
    e.preventDefault();
    setNameMsg({ kind: "", text: "" });
    setNameBusy(true);
    try {
      await api.post("/profile/me/username", { username: newName.trim() });
      setNameMsg({ kind: "ok", text: "Username updated." });
      setNewName("");
      refreshMe?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setNameMsg({
        kind: "err",
        text: typeof detail === "string" ? detail : "Update failed.",
      });
    }
    setNameBusy(false);
  };

  const submitSecurity = async (e) => {
    e.preventDefault();
    setSecMsg({ kind: "", text: "" });
    setSecBusy(true);
    try {
      await api.post("/profile/me/security-question", { question, answer });
      setSecMsg({ kind: "ok", text: "Security question saved." });
      setAnswer("");
      refreshMe?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setSecMsg({
        kind: "err",
        text: typeof detail === "string" ? detail : "Save failed.",
      });
    }
    setSecBusy(false);
  };

  const Msg = StatusMsg;

  return (
    <div className="rounded border border-neutral-800 overflow-hidden bg-neutral-950" data-testid="account-settings-card">
      <div className="bg-black text-white px-5 py-3 flex items-center gap-2 border-b border-neutral-800">
        <UserCog size={18} strokeWidth={3} className="text-[#FFD700]" />
        <span className="font-anton uppercase tracking-widest">Account</span>
      </div>
      <div className="p-4 space-y-5 bg-neutral-950 text-white">
        {/* Change username */}
        <form onSubmit={submitName} className="space-y-2" data-testid="change-username-form">
          <label className="font-anton uppercase tracking-widest text-xs text-neutral-200">
            Change Username
          </label>
          <div className="text-xs text-neutral-400">
            Current: <strong className="text-white">{user?.username}</strong> · Cooldown: once every 7 days
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="new_username"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              minLength={2}
              maxLength={20}
              pattern="[A-Za-z0-9_.\-]{2,20}"
              className="flex-1 rounded border border-neutral-800 bg-neutral-900 text-white placeholder:text-neutral-500 px-3 py-2 outline-none focus:border-[#FFD700] text-sm"
              data-testid="change-username-input"
              required
            />
            <button
              type="submit"
              disabled={nameBusy || !newName.trim() || newName.trim() === user?.username}
              className="rounded bg-[#0055FF] hover:bg-[#003fbf] disabled:opacity-60 text-white font-anton uppercase tracking-widest px-4 py-2 text-sm"
              data-testid="change-username-submit"
            >
              {nameBusy ? "..." : "Save"}
            </button>
          </div>
          <Msg msg={nameMsg} />
        </form>

        {/* Security question */}
        <form onSubmit={submitSecurity} className="space-y-2" data-testid="security-question-form">
          <label className="font-anton uppercase tracking-widest text-xs flex items-center gap-1.5 text-neutral-200">
            <KeyRound size={14} strokeWidth={3} />
            Security Question
          </label>
          <div className="text-xs text-neutral-400">
            {user?.security_question
              ? "Change your question or update the answer."
              : "Required for the Forgot-Password flow."}
          </div>
          <select
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full rounded border border-neutral-800 bg-neutral-900 text-white px-3 py-2 outline-none focus:border-[#FFD700] text-sm"
            data-testid="security-question-select"
            required
          >
            <option value="">Choose a question…</option>
            {questions.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Your answer (case/space-insensitive)"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            minLength={2}
            maxLength={100}
            className="w-full rounded border border-neutral-800 bg-neutral-900 text-white placeholder:text-neutral-500 px-3 py-2 outline-none focus:border-[#FFD700] text-sm"
            data-testid="security-question-answer-input"
            required
          />
          <button
            type="submit"
            disabled={secBusy || !question || !answer.trim()}
            className="rounded bg-[#0055FF] hover:bg-[#003fbf] disabled:opacity-60 text-white font-anton uppercase tracking-widest px-4 py-2 text-sm"
            data-testid="security-question-submit"
          >
            {secBusy ? "..." : user?.security_question ? "Update" : "Save"}
          </button>
          <Msg msg={secMsg} />
        </form>
      </div>
    </div>
  );
}
