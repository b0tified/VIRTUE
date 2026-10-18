// Lobby pop-up for the 7-day login streak reward.
import { useEffect, useState } from "react";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";
import { Coins, Gift, Loader2, X, Zap } from "lucide-react";

function DayCard({ day, amount, state }) {
  const bg = state === "claimed" ? "#06A35F" : state === "today" ? "#FFD700" : "#F4F4F5";
  return (
    <div
      className={`border-4 border-black flex flex-col items-center justify-center py-2 px-1 ${state === "today" ? "scale-105" : ""}`}
      style={{ background: bg, color: state === "claimed" ? "#fff" : "#0A0A0A", boxShadow: "3px 3px 0 0 #0A0A0A" }}
      data-testid={`daily-day-${day}`}
      data-state={state}
    >
      <div className="font-anton uppercase tracking-widest text-[10px]">Day {day}</div>
      <Coins size={day === 7 ? 22 : 16} strokeWidth={3} className="my-1" />
      <div className="font-display text-base leading-none">{amount}</div>
    </div>
  );
}

export default function DailyRewardModal() {
  const { refreshMe } = useAuth();
  const [info, setInfo] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get("/rewards/daily").then(({ data }) => { if (data.claimable) setInfo(data); }).catch(() => {});
  }, []);

  if (!info) return null;
  const claim = async () => {
    setClaiming(true);
    try {
      const { data } = await api.post("/rewards/daily/claim");
      setClaimed(data);
      refreshMe?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't claim reward.");
    } finally {
      setClaiming(false);
    }
  };
  const today = claimed ? claimed.day : info.next_day;
  const stateFor = (d) => (d < today || (claimed && d === today) ? "claimed" : d === today ? "today" : "locked");

  return (
    <div className="fixed inset-0 z-[66] bg-black/60 flex items-start justify-center p-4 overflow-y-auto" data-testid="daily-reward-modal">
      <div className="card-pow p-0 w-[min(560px,94vw)] my-auto">
        <div className="bg-black text-white px-5 py-3 tiny:py-2 flex items-center justify-between">
          <div className="font-display text-2xl tiny:text-xl text-[#FFD700] flex items-center gap-2">
            <Gift size={22} strokeWidth={3} /> DAILY REWARD
          </div>
          <button onClick={() => setInfo(null)} className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1" data-testid="daily-reward-close" aria-label="Close">
            <X size={14} strokeWidth={3} />
          </button>
        </div>
        <div className="bg-white p-4 tiny:p-3 space-y-3 tiny:space-y-2">
          <div className="font-anton uppercase tracking-widest text-xs text-neutral-600 flex items-center gap-2 flex-wrap">
            Log in every day to grow your streak. Missing a day resets it.
            {info.multiplier > 1 && (
              <span className="inline-flex items-center gap-1 bg-[#E62429] text-white px-2 py-0.5" data-testid="daily-reward-boost">
                <Zap size={11} strokeWidth={3} /> {info.multiplier}x COINS
              </span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {info.rewards.map((amt, i) => <DayCard key={i} day={i + 1} amount={amt} state={stateFor(i + 1)} />)}
          </div>
          {err && <div className="text-xs text-[#E62429] font-anton uppercase" data-testid="daily-reward-error">{err}</div>}
          {claimed ? (
            <button onClick={() => setInfo(null)} className="btn-pow bg-[#06A35F] text-white w-full [&]:py-2 tiny:[&]:py-1" data-testid="daily-reward-done">
              <span className="font-anton uppercase tracking-widest text-lg">+{claimed.claimed} coins claimed!</span>
            </button>
          ) : (
            <button onClick={claim} disabled={claiming} className="btn-pow bg-[#FFD700] text-black w-full [&]:py-2 tiny:[&]:py-1" data-testid="daily-reward-claim">
              <span className="font-anton uppercase tracking-widest text-lg flex items-center justify-center gap-2">
                {claiming ? <Loader2 size={16} className="animate-spin" /> : <Coins size={16} strokeWidth={3} />}
                Claim day {today} · {info.rewards[today - 1]} coins
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
