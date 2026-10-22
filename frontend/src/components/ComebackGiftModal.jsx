// Lobby pop-up: "Welcome back" gift for players returning after a long break.
import { useEffect, useState } from "react";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";
import { Coins, Gift, Loader2, Sparkles, X } from "lucide-react";

function Reward({ icon: Icon, value, label, testid }) {
  return (
    <div className="border-4 border-black bg-[#FFD700] flex flex-col items-center py-3 tiny:py-2 px-4" style={{ boxShadow: "4px 4px 0 0 #0A0A0A" }} data-testid={testid}>
      <Icon size={22} strokeWidth={3} />
      <div className="font-display text-3xl tiny:text-2xl leading-none mt-1">+{value.toLocaleString()}</div>
      <div className="font-anton uppercase tracking-widest text-[10px] mt-1">{label}</div>
    </div>
  );
}

export default function ComebackGiftModal() {
  const { refreshMe } = useAuth();
  const [gift, setGift] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get("/rewards/comeback").then(({ data }) => setGift(data.pending || null)).catch(() => {});
  }, []);

  if (!gift) return null;
  const claim = async () => {
    setClaiming(true);
    try {
      await api.post("/rewards/comeback/claim");
      setClaimed(true);
      refreshMe?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't claim gift.");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[67] bg-black/70 flex items-start justify-center p-4 overflow-y-auto" data-testid="comeback-gift-modal">
      <div className="card-pow p-0 w-[min(480px,94vw)] my-auto">
        <div className="bg-black text-white px-5 py-3 tiny:py-2 flex items-center justify-between">
          <div className="font-display text-2xl tiny:text-xl text-[#FFD700] flex items-center gap-2">
            <Gift size={22} strokeWidth={3} /> WELCOME BACK!
          </div>
          <button onClick={() => setGift(null)} className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1" data-testid="comeback-gift-close" aria-label="Close">
            <X size={14} strokeWidth={3} />
          </button>
        </div>
        <div className="p-5 tiny:p-3 flex flex-col items-center text-center gap-4 tiny:gap-2">
          <div className="font-anton uppercase tracking-widest text-sm" data-testid="comeback-gift-days">
            You've been away {gift.days_away} days. Here's a gift to jump back in.
          </div>
          <div className="flex gap-4">
            <Reward icon={Coins} value={gift.coins} label="Coins" testid="comeback-gift-coins" />
            <Reward icon={Sparkles} value={gift.xp} label="XP" testid="comeback-gift-xp" />
          </div>
          {err && <div className="text-[#E62429] text-xs font-anton uppercase" data-testid="comeback-gift-error">{err}</div>}
          {claimed ? (
            <button onClick={() => setGift(null)} className="btn-pow bg-[#06A35F] text-white w-full" data-testid="comeback-gift-done">
              <span className="font-anton uppercase tracking-widest">Claimed! Let's Go</span>
            </button>
          ) : (
            <button onClick={claim} disabled={claiming} className="btn-pow bg-[#FFD700] text-black w-full" data-testid="comeback-gift-claim">
              {claiming ? <Loader2 size={14} className="animate-spin mx-auto" /> : <span className="font-anton uppercase tracking-widest">Claim Gift</span>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
