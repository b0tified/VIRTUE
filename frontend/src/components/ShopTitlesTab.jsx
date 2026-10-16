// Shop "Titles" tab — admin-made custom banner titles bought with coins.
import { useEffect, useState } from "react";
import api from "@/api";
import { Coins, Check, Clock } from "lucide-react";
import { customTitleClass } from "@/game/bannerTitle";
import { SKINS } from "@/game/skins";

export function TitleChip({ title, size = "md" }) {
  return (
    <span
      className={`inline-block font-anton uppercase tracking-widest leading-none whitespace-nowrap px-2 py-1 border-2 border-black bg-black/80 ${size === "lg" ? "text-xl" : "text-sm"} ${title.style === "rainbow" ? "" : customTitleClass(title.style)}`}
      style={{ color: title.color, textShadow: "0 1px 0 rgba(0,0,0,0.85)" }}
      data-testid={`title-chip-${title.id || "preview"}`}
    >
      {title.style === "rainbow" ? <span className="custom-title-rainbow">{title.text || "TITLE"}</span> : (title.text || "TITLE")}
    </span>
  );
}

function endsLabel(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h left` : `${Math.max(1, h)}h left`;
}

function TitleCard({ t, equipped, coins, busy, onBuy, onEquip, onUnequip }) {
  const isEquipped = equipped === t.id;
  const ends = endsLabel(t.ends_at);
  return (
    <div className="border-pow-thick bg-neutral-100 p-3 flex flex-col gap-3" data-testid={`shop-title-card-${t.id}`}>
      <div className="bg-neutral-800 border-2 border-black h-16 flex items-center justify-center">
        <TitleChip title={t} />
      </div>
      <div className="flex items-center justify-between gap-2 min-h-[20px]">
        <span className="font-anton uppercase tracking-widest text-[10px] text-neutral-500">{t.style}</span>
        {ends && t.on_sale && (
          <span className="font-anton uppercase tracking-widest text-[10px] text-[#E62429] flex items-center gap-1" data-testid={`shop-title-ends-${t.id}`}>
            <Clock size={10} strokeWidth={3} /> {ends}
          </span>
        )}
      </div>
      {t.owned ? (
        <button
          type="button"
          disabled={busy}
          onClick={isEquipped ? onUnequip : onEquip}
          className={`btn-pow w-full [&]:py-2 [&]:text-sm ${isEquipped ? "bg-[#06A35F] text-white" : "bg-white text-black"}`}
          data-testid={`shop-title-${isEquipped ? "unequip" : "equip"}-${t.id}`}
        >
          {isEquipped ? <span className="flex items-center justify-center gap-1"><Check size={14} strokeWidth={3} /> EQUIPPED</span> : "EQUIP"}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || coins < t.price}
          onClick={onBuy}
          className="btn-pow w-full bg-[#FFD700] text-black [&]:py-2 [&]:text-sm disabled:opacity-50"
          data-testid={`shop-title-buy-${t.id}`}
        >
          <span className="flex items-center justify-center gap-1"><Coins size={14} strokeWidth={3} /> {t.price}</span>
        </button>
      )}
    </div>
  );
}

export default function ShopTitlesTab({ coins, refreshMe, onError, onCoins }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const { data } = await api.get("/shop/titles");
      setData(data);
      onCoins?.(data.coins);
    } catch (e) {
      onError(e.response?.data?.detail || "Failed to load titles.");
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, msg) => {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      await fn();
      await refreshMe?.();
      await load();
    } catch (e) {
      onError(e.response?.data?.detail || msg);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="text-center font-anton uppercase tracking-widest text-xs py-8">Loading…</div>;
  return (
    <>
      {data.titles.length === 0 ? (
        <div className="text-center font-anton uppercase tracking-widest text-sm py-10 text-neutral-500" data-testid="shop-titles-empty">
          No titles in the shop right now — check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="shop-titles-grid">
          {data.titles.map((t) => (
            <TitleCard
              key={t.id}
              t={t}
              equipped={data.equipped}
              coins={coins}
              busy={busy}
              onBuy={() => act(() => api.post("/shop/titles/buy", { title_id: t.id }), "Could not buy title.")}
              onEquip={() => act(() => api.post("/profile/me/custom_title", { title_id: t.id }), "Could not equip title.")}
              onUnequip={() => act(() => api.post("/profile/me/custom_title", { title_id: null }), "Could not unequip title.")}
            />
          ))}
        </div>
      )}
      <p className="text-[10px] text-neutral-500 mt-4 text-center">
        Titles show on your banner. Equipping a shop title replaces your season title. Limited titles leave the shop when their timer ends — you keep them forever.
      </p>
    </>
  );
}

const hex = (n) => "#" + ((n ?? 0x888888) & 0xffffff).toString(16).padStart(6, "0");

function MiniSkin({ skinId }) {
  const sk = SKINS.find((s) => s.id === skinId) || {};
  return (
    <div className="flex flex-col items-center" aria-hidden>
      <div className="w-7 h-7 rounded-full border-2 border-black" style={{ background: hex(sk.head) }} />
      <div className="w-12 h-12 border-2 border-black -mt-0.5 relative" style={{ background: hex(sk.body) }}>
        <div className="absolute inset-x-0 top-3 h-1.5" style={{ background: hex(sk.accent) }} />
      </div>
      <div className="flex gap-1 -mt-0.5">
        <div className="w-4 h-6 border-2 border-black" style={{ background: hex(sk.leg) }} />
        <div className="w-4 h-6 border-2 border-black" style={{ background: hex(sk.leg) }} />
      </div>
    </div>
  );
}

function BundleCard({ b, coins, busy, onBuy }) {
  const ends = endsLabel(b.ends_at);
  const save = Math.max(0, b.full_price - b.price);
  return (
    <div className="border-pow-thick bg-neutral-100 p-3 flex flex-col gap-3" data-testid={`shop-bundle-card-${b.id}`}>
      <div className="bg-neutral-800 border-2 border-black h-32 flex items-center justify-around px-3 relative">
        <MiniSkin skinId={b.skin.id} />
        <span className="font-display text-3xl text-[#FFD700]">+</span>
        <TitleChip title={b.title} />
        {save > 0 && (
          <span className="absolute top-1 left-1 bg-[#E62429] text-white font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border-2 border-black" data-testid={`shop-bundle-save-${b.id}`}>
            Save {Math.round((save / Math.max(1, b.full_price)) * 100)}%
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-anton uppercase tracking-widest text-xs truncate">{b.skin.name} + {b.title.text}</span>
        {ends && <span className="font-anton uppercase tracking-widest text-[10px] text-[#E62429] flex items-center gap-1 shrink-0"><Clock size={10} strokeWidth={3} /> {ends}</span>}
      </div>
      {(b.owned_title || b.owned_skin) && !b.owned && (
        <div className="text-[10px] text-neutral-500 -mt-2">You already own the {b.owned_title ? "title" : "skin"} — price reduced.</div>
      )}
      {b.owned ? (
        <div className="btn-pow w-full bg-[#06A35F] text-white [&]:py-2 [&]:text-sm text-center" data-testid={`shop-bundle-owned-${b.id}`}>OWNED</div>
      ) : (
        <button
          type="button"
          disabled={busy || coins < b.your_price}
          onClick={onBuy}
          className="btn-pow w-full bg-[#FFD700] text-black [&]:py-2 [&]:text-sm disabled:opacity-50"
          data-testid={`shop-bundle-buy-${b.id}`}
        >
          <span className="flex items-center justify-center gap-2">
            <Coins size={14} strokeWidth={3} />
            {b.your_price !== b.full_price && <s className="opacity-50">{b.full_price}</s>}
            {b.your_price}
          </span>
        </button>
      )}
    </div>
  );
}

export function ShopBundlesTab({ coins, refreshMe, onError, onCoins }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const { data } = await api.get("/shop/bundles");
      setData(data);
      onCoins?.(data.coins);
    } catch (e) {
      onError(e.response?.data?.detail || "Failed to load bundles.");
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const buy = async (id) => {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      await api.post("/shop/bundles/buy", { bundle_id: id });
      await refreshMe?.();
      await load();
    } catch (e) {
      onError(e.response?.data?.detail || "Could not buy bundle.");
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <div className="text-center font-anton uppercase tracking-widest text-xs py-8">Loading…</div>;
  return (
    <>
      {data.bundles.length === 0 ? (
        <div className="text-center font-anton uppercase tracking-widest text-sm py-10 text-neutral-500" data-testid="shop-bundles-empty">
          No bundles right now — check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="shop-bundles-grid">
          {data.bundles.map((b) => <BundleCard key={b.id} b={b} coins={coins} busy={busy} onBuy={() => buy(b.id)} />)}
        </div>
      )}
      <p className="text-[10px] text-neutral-500 mt-4 text-center">
        Bundles give you a skin and a title together for less. Both are equipped when you buy.
      </p>
    </>
  );
}
