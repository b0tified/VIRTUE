/* LobbyDailyPanel — compact "Daily Challenges" widget in the lobby's
   right column. Reads from /api/progression (same endpoint as the
   Progress modal). Completed dailies are **auto-claimed** server-side
   on every progression refresh — this panel just surfaces a "+50 coins"
   toast the moment a sweep credits anything new. No claim button.

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
  const [toast, setToast] = useState(null); // { kind, text }

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get("/progression");
      setDaily(data?.daily || null);
      // Server returned a list of dailies that were auto-claimed
      // during this request — surface them as a single rewards toast
      // and refresh the user header so the coin pill jumps.
      const auto = data?.daily?.auto_claimed || [];
      if (auto.length) {
        const coins = auto.reduce((s, a) => s + (a.coins || 0), 0);
        const xp = auto.reduce((s, a) => s + (a.season_xp || 0), 0);
        const names = auto.map((a) => a.name).join(", ");
        setToast({
          kind: "ok",
          text: `${names} — +${coins} coins · +${xp} XP`,
        });
        refreshMe?.();
        setTimeout(() => setToast(null), 4500);
      }
    } catch (e) {
      // Soft-fail: keep last data, surface nothing in the lobby.
    }
  }, [refreshMe]);

  useEffect(() => {
    reload();
    // Refresh every 30s so progress ticks up after returning from a match.
    const id = setInterval(reload, 30000);
    return () => clearInterval(id);
  }, [reload]);

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
            <DailyRow key={c.id} c={c} />
          ))
        )}
      </div>
    </div>
  );
}

function DailyRow({ c }) {
  const pct = Math.max(0, Math.min(100, Math.round((c.progress / Math.max(1, c.goal)) * 100)));
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
          {/* No claim button — auto-claim happens server-side on the
              /progression GET so the player never has to tap. Status
              badge keeps the row legible. */}
          <span
            className={`font-anton uppercase text-[10px] px-2 py-0.5 border-pow-thin ${
              c.claimed ? "bg-neutral-200 text-neutral-500" :
              c.completed ? "bg-[#FFD700] text-black animate-pulse" :
              "bg-neutral-100 text-neutral-500"
            }`}
            data-testid={`lobby-daily-status-${c.id}`}
          >
            {c.claimed ? "CLAIMED" : c.completed ? "CLAIMING…" : "IN PROGRESS"}
          </span>
        </div>
      </div>
    </div>
  );
}
