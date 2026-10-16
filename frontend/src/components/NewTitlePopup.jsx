// Lobby pop-up announcing a limited-time shop title the player hasn't seen yet.
import { useEffect, useState } from "react";
import api from "@/api";
import { Coins, Clock, Sparkles, X } from "lucide-react";
import { TitleChip } from "@/components/ShopTitlesTab";

const SEEN_KEY = "virtue_seen_title_popups";

const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); }
};

function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h left` : `${Math.max(1, h)}h left`;
}

export default function NewTitlePopup({ onView }) {
  const [title, setTitle] = useState(null);
  useEffect(() => {
    api.get("/shop/titles").then(({ data }) => {
      const seen = readSeen();
      const fresh = (data.titles || [])
        .filter((t) => t.on_sale && t.ends_at && !t.owned && !seen.has(t.id))
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      if (fresh.length) setTitle(fresh[0]);
    }).catch(() => {});
  }, []);
  if (!title) return null;
  const close = (view) => {
    const seen = readSeen();
    seen.add(title.id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    setTitle(null);
    if (view) onView?.();
  };
  return (
    <div className="fixed inset-0 z-[65] bg-black/60 flex items-center justify-center p-4" data-testid="new-title-popup" onClick={() => close(false)}>
      <div className="card-pow w-full max-w-sm p-0 overflow-hidden new-title-pop" onClick={(e) => e.stopPropagation()}>
        <div className="bg-[#E62429] text-white px-4 py-2 flex items-center gap-2">
          <Sparkles size={18} strokeWidth={3} className="text-[#FFD700]" />
          <span className="font-display text-2xl leading-none flex-1">NEW TITLE!</span>
          <button type="button" onClick={() => close(false)} aria-label="Close" data-testid="new-title-popup-close"><X size={18} strokeWidth={3} /></button>
        </div>
        <div className="bg-white p-4 flex flex-col items-center gap-3">
          <div className="bg-neutral-800 border-2 border-black w-full h-24 flex items-center justify-center">
            <TitleChip title={title} size="lg" />
          </div>
          <div className="flex items-center gap-3 font-anton uppercase tracking-widest text-xs">
            <span className="flex items-center gap-1" data-testid="new-title-popup-price"><Coins size={13} strokeWidth={3} /> {title.price}</span>
            <span className="flex items-center gap-1 text-[#E62429]" data-testid="new-title-popup-ends"><Clock size={13} strokeWidth={3} /> Limited · {timeLeft(title.ends_at)}</span>
          </div>
          <button type="button" onClick={() => close(true)} className="btn-pow bg-[#FFD700] text-black w-full [&]:py-2 [&]:text-sm" data-testid="new-title-popup-view">
            VIEW IN SHOP
          </button>
        </div>
      </div>
    </div>
  );
}
