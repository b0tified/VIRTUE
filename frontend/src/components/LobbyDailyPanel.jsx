/* LobbyDailyPanel — compact "Daily Challenges" widget that lives in the
   previously-empty right column of the Lobby. Pulls from /api/progression
   (same endpoint as the Progress modal) and lets the player claim a
   challenge inline. A successful claim refreshes the user (coins) and
   re-fetches the panel state so the UI stays consistent.

   Opening the full Progress modal is still available via the PASS button
   in the lobby header — this panel just surfaces the 3 dailies up front
   so they aren't hidden behind a modal click. */
import { useCallback, useEffect, useState } from "react";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";
import { Calendar, Coins, Star, Check, Zap, Flame } from "lucide-react";

export default function LobbyDailyPanel() {
  const { refreshMe } = useAuth();
  const [daily, setDaily] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null); // { kind, text }

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get("/progression");
      setDaily(data?.daily || null);
    } catch (e) {
      // Soft-fail: keep last data, surface nothing in the lobby.
    }
  }, []);

  useEffect(() => {
    reload();
    // Refresh every 30s so progress ticks up after returning from a match.
    const id = setInterval(reload, 30000);
    return () => clearInterval(id);
  }, [reload]);

  const claim = async (id) => {
    if (busy) return;
    setBusy(true);
    setToast(null);
    try {
      const { data: res } = await api.post("/progression/claim", { kind: "daily", id });
      setToast({ kind: "ok", text: res?.label || "Claimed!" });
      await refreshMe?.();
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e.response?.data?.detail || "Couldn't claim." });
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  const challenges = daily?.challenges || [];

  return (
    <div className="w-full max-w-md card-pow p-0 overflow-hidden" data-testid="lobby-daily-panel">
      <div className="bg-black text-white px-4 py-2 flex items-center justify-between">
        <div className="font-display text-2xl text-pow-shadow flex items-center gap-2">
          <span className="text-[#FFD700]">DAILY</span>
          <span>CHALLENGES</span>
        </div>
        <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-400 flex items-center gap-1">
          <Calendar size={12} strokeWidth={3} />
          {daily?.date || "—"} UTC
        </div>
      </div>
      {toast && (
        <div
          className={`px-3 py-1.5 border-b-4 border-black font-anton uppercase tracking-widest text-[11px] ${
            toast.kind === "ok" ? "bg-[#E4F7EC] text-[#0a4f2a]" : "bg-[#FFE4E4] text-[#7a1115]"
          }`}
          data-testid="lobby-daily-toast"
        >
          {toast.text}
        </div>
      )}
      <div className="bg-white p-3 space-y-2">
        {!daily ? (
          <div className="text-center py-6 text-neutral-500 font-anton uppercase tracking-widest text-xs">
            Loading…
          </div>
        ) : challenges.length === 0 ? (
          <div className="text-center py-6 text-neutral-500 font-anton uppercase tracking-widest text-xs">
            No dailies available
          </div>
        ) : (
          challenges.map((c) => (
            <DailyRow key={c.id} c={c} busy={busy} onClaim={() => claim(c.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function DailyRow({ c, busy, onClaim }) {
  const pct = Math.max(0, Math.min(100, Math.round((c.progress / Math.max(1, c.goal)) * 100)));
  const canClaim = c.completed && !c.claimed;
  return (
    <div
      className={`border-pow-thin bg-neutral-50 p-2 ${c.claimed ? "opacity-50" : ""}`}
      data-testid={`lobby-daily-${c.id}`}
      data-completed={c.completed ? "true" : "false"}
      data-claimed={c.claimed ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-anton uppercase tracking-widest text-xs truncate">{c.name}</div>
          <div className="text-[11px] text-neutral-600 leading-tight">{c.desc}</div>
        </div>
        {c.claimed ? (
          <Check size={16} strokeWidth={3} className="text-[#06A35F] flex-shrink-0" />
        ) : c.completed ? (
          <Zap size={16} strokeWidth={3} className="text-[#FFD700] flex-shrink-0 animate-pulse" />
        ) : (
          <Flame size={16} strokeWidth={3} className="text-neutral-300 flex-shrink-0" />
        )}
      </div>
      <div className="h-1.5 bg-neutral-200 border border-black mt-1.5">
        <div
          className={`h-full ${c.completed ? "bg-[#06A35F]" : "bg-[#0055FF]"}`}
          style={{ width: `${pct}%`, transition: "width 0.4s ease" }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-anton uppercase tracking-widest">
        <span className="text-neutral-700">{c.progress} / {c.goal}</span>
        <div className="flex items-center gap-2">
          {c.season_xp ? (
            <span className="flex items-center gap-1 text-[#FFD700]">
              <Star size={11} strokeWidth={3} /> +{c.season_xp}
            </span>
          ) : null}
          {c.coins ? (
            <span className="flex items-center gap-1 text-[#a36a00]">
              <Coins size={11} strokeWidth={3} /> +{c.coins}
            </span>
          ) : null}
          <button
            disabled={!canClaim || busy}
            onClick={onClaim}
            className={`btn-pow [&]:px-2 [&]:py-0.5 [&]:text-[10px] ${
              c.claimed ? "bg-neutral-300 text-neutral-500" :
              c.completed ? "bg-[#06A35F] text-white" :
              "bg-neutral-200 text-neutral-500"
            }`}
            data-testid={`lobby-daily-claim-${c.id}`}
          >
            {c.claimed ? "CLAIMED" : c.completed ? "CLAIM" : "IN PROGRESS"}
          </button>
        </div>
      </div>
    </div>
  );
}
