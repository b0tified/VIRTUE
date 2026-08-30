/* Skin shop modal. Renders the SKINS catalog as a grid of cards with the
   user's current coin balance up top; each card shows a live 2D preview
   of the skin (humanoid silhouette colored per skin), the price, ownership
   state, and a Buy / Equip / Equipped action.

   Buying calls POST /api/shop/buy and auto-equips on success. The auth
   context's `refreshMe()` is called after each successful mutation so the
   wallet + equipped indicator update everywhere (lobby PlayerCard, header
   coin badge, etc.) without a page reload.
*/
import { useEffect, useMemo, useState } from "react";
import api from "@/api";
import { SKINS, RARITY_COLOR } from "@/game/skins";
import { useAuth } from "@/context/AuthContext";
import { Coins, Check, X, Lock, Eye, Zap, Clock } from "lucide-react";
import SkinPreview3D from "@/components/SkinPreview3D";

export default function ShopModal({ open, onClose }) {
  const { user, refreshMe } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Tab state — "skins" (default) vs "boosts". Boosts live in a
  // sibling tab so users looking for cosmetics don't get a wall of
  // consumables in their way, and vice versa.
  const [tab, setTab] = useState("skins");
  // Boosts payload (catalog + coins + active-boost countdown). Fetched
  // lazily when the user first switches to the boosts tab so the
  // initial skin fetch stays fast for the common path.
  const [boostsData, setBoostsData] = useState(null);
  // 3D preview modal — opens when the user hits "PREVIEW IN 3D" on any
  // card. Holds the full skin object so the modal can mount its own
  // Three.js scene with the live humanoid mesh.
  const [previewSkin, setPreviewSkin] = useState(null);

  const reload = async () => {
    try {
      const { data } = await api.get("/shop/skins");
      setData(data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Failed to load shop.");
    }
  };

  const reloadBoosts = async () => {
    try {
      const { data } = await api.get("/shop/boosts");
      setBoostsData(data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Failed to load boosts.");
    }
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    reload();
    // Warm the boost countdown too — cheap request, keeps the badge
    // fresh so a user who bought a boost outside the modal still
    // sees the "ACTIVE · Xm LEFT" chip when they open it.
    reloadBoosts();
  }, [open]);

  const coins = boostsData?.coins ?? data?.coins ?? user?.coins ?? 0;
  const selected = data?.selected_skin ?? user?.selected_skin ?? "default";
  const items = data?.items || SKINS.map((s) => ({ ...s, owned: s.id === "default", equipped: s.id === selected }));

  const buy = async (id) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/shop/buy", { skin_id: id });
      await refreshMe?.();
      await reload();
    } catch (e) {
      setError(e.response?.data?.detail || "Could not buy skin.");
    } finally {
      setBusy(false);
    }
  };

  const equip = async (id) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/profile/me/skin", { skin_id: id });
      await refreshMe?.();
      await reload();
    } catch (e) {
      setError(e.response?.data?.detail || "Could not equip skin.");
    } finally {
      setBusy(false);
    }
  };

  const buyBoost = async (id) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/shop/boost/purchase", { boost_id: id });
      await refreshMe?.();
      await reloadBoosts();
      await reload();  // wallet is shared → refresh the skin tab's coin count too
    } catch (e) {
      setError(e.response?.data?.detail || "Could not buy boost.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
      data-testid="shop-modal"
      onClick={onClose}
    >
      <div
        className="card-pow w-[min(960px,96vw)] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="font-display text-3xl text-pow-shadow flex items-center gap-3">
            <span className="text-[#FFD700]">SKIN</span><span className="text-white">SHOP</span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="border-pow shadow-pow-sm px-3 py-1.5 flex items-center gap-2"
              style={{ background: "#FFD700", color: "#0A0A0A" }}
              data-testid="shop-coin-balance"
            >
              <Coins size={14} strokeWidth={3} />
              <span className="font-anton uppercase text-[10px] tracking-widest opacity-70">Coins</span>
              <span className="font-display text-xl leading-none">{coins}</span>
            </div>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-white"
              data-testid="shop-close"
            >
              <X size={22} strokeWidth={3} />
            </button>
          </div>
        </div>
        {/* Tab strip — Skins vs Boosts. Kept simple + comic-flat so the
            header stays visually anchored to the black bar above. */}
        <div className="bg-neutral-900 text-white px-3 py-1.5 flex items-center gap-1 flex-shrink-0 border-t-2 border-black">
          {[
            { id: "skins",  label: "SKINS",  icon: <Eye size={12} strokeWidth={3} /> },
            { id: "boosts", label: "XP BOOSTS", icon: <Zap size={12} strokeWidth={3} /> },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "font-anton uppercase text-[11px] tracking-widest px-3 py-1.5 border-2 border-black flex items-center gap-1.5 transition-colors " +
                (tab === t.id
                  ? "bg-[#FFD700] text-black"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700")
              }
              data-testid={`shop-tab-${t.id}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          {/* Active-boost countdown chip — surfaces the current 2x
              timer prominently on both tabs so a repeat purchase can
              see "still 40m of my last one" before spending. */}
          {(boostsData?.active_seconds_remaining ?? 0) > 0 && (
            <div
              className="ml-auto font-anton uppercase text-[10px] tracking-widest bg-[#06A35F] text-white border-2 border-black px-2 py-1 flex items-center gap-1"
              data-testid="shop-active-boost-chip"
              title="Active XP Boost time remaining"
            >
              <Clock size={10} strokeWidth={3} />
              2X · {formatBoostRemaining(boostsData.active_seconds_remaining)}
            </div>
          )}
        </div>
        {/* Grid */}
        <div className="bg-white p-4 overflow-y-auto" data-testid="shop-grid">
          {error && (
            <div
              className="mb-3 px-3 py-2 border-2 border-[#E62429] bg-[#FFE4E4] text-[#7a1115] font-anton uppercase tracking-widest text-xs"
              data-testid="shop-error"
            >
              {error}
            </div>
          )}
          {tab === "skins" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {items.map((s) => (
                  <SkinCard
                    key={s.id}
                    skin={s}
                    coins={coins}
                    busy={busy}
                    onBuy={() => buy(s.id)}
                    onEquip={() => equip(s.id)}
                    onPreview={() => setPreviewSkin(s)}
                  />
                ))}
              </div>
              <p className="text-[10px] text-neutral-500 mt-4 text-center">
                Earn coins by leveling up (+100/level) or redeeming promo codes. Skins are
                permanent once bought.
              </p>
            </>
          )}
          {tab === "boosts" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="shop-boosts-grid">
                {(boostsData?.boosts || []).map((b) => (
                  <BoostCard
                    key={b.id}
                    boost={b}
                    coins={coins}
                    busy={busy}
                    onBuy={() => buyBoost(b.id)}
                  />
                ))}
              </div>
              <p className="text-[10px] text-neutral-500 mt-4 text-center">
                XP Boosts apply to every match — casual and ranked. Stacks by
                extending the timer if you buy again while active. Only
                affects your XP / level, never rank RP.
              </p>
            </>
          )}
        </div>
      </div>

      {/* 3D turntable preview — mounts above the shop on top of the
          backdrop so the user can spin/inspect a skin's mesh + animated
          extras (thrusters, LEDs, etc.) before committing coins. */}
      <SkinPreview3D
        open={!!previewSkin}
        skin={previewSkin}
        onClose={() => setPreviewSkin(null)}
      />
    </div>
  );
}

/* Single skin card. Renders a flat CSS-only humanoid preview using the
   skin's palette + an animated aura ring underneath. No Three.js — the
   preview is good enough for the shop and stays performant. Exported
   so the embeddable `ShopBody` can reuse the same card markup. */
export function SkinCard({ skin, coins, busy, onBuy, onEquip, onPreview }) {
  const canAfford = coins >= skin.price;
  const rarityHex = RARITY_COLOR[skin.rarity] || "#9aa3ad";
  const auraStyle = useMemo(() => auraCss(skin), [skin]);
  const colorHex = (n) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");
  return (
    <div
      className="border-pow shadow-pow-sm bg-neutral-50 flex flex-col"
      data-testid={`shop-skin-${skin.id}`}
      data-rarity={skin.rarity}
    >
      {/* Preview area */}
      <div
        className="relative h-44 overflow-hidden flex items-end justify-center group"
        style={{ background: `linear-gradient(180deg, ${colorHex(skin.body)}33 0%, #0A0A0A 100%)` }}
      >
        {/* PREVIEW IN 3D button — overlays the preview tile so it doesn't
            cost any footer real-estate. Always present (default skin
            included — useful for sanity-checking your own current look).
            Fades in on hover so the tile looks clean at rest. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPreview?.(); }}
          className="absolute top-2 right-12 z-10 font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 bg-[#0055FF] text-white border-2 border-black flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          data-testid={`shop-skin-preview-${skin.id}`}
          title={`Preview ${skin.name} in 3D`}
        >
          <Eye size={11} strokeWidth={3} /> 3D
        </button>
        {/* Aura disc behind the figure */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-32 h-6 rounded-full" style={auraStyle} />
        {/* Cape (renders behind the body) */}
        {skin.cape != null && (
          <div
            className="absolute border-2 border-black"
            style={{
              width: 50,
              height: 80,
              bottom: 20,
              left: "50%",
              transform: "translateX(-50%) rotate(2deg)",
              background: colorHex(skin.cape),
              zIndex: 0,
            }}
          />
        )}
        {/* Mini humanoid (CSS only) — layered: head + helmet + visor + torso
            + chest stripe + emblem + belt + shoulder pads + legs + knee
            stripes. Mirrors the THREE.js humanoid layout in /game/engine.js
            so the preview reads honestly. */}
        <div className="relative mb-2" style={{ width: 76, height: 130, zIndex: 1 }}>
          {/* Head */}
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-full border-2 border-black"
            style={{ width: 28, height: 28, top: 0, background: colorHex(skin.head) }}
          />
          {/* Helmet skull cap (upper half only) */}
          {skin.helmet != null && (
            <div
              className="absolute left-1/2 -translate-x-1/2 border-2 border-black"
              style={{
                width: 30,
                height: 16,
                top: -1,
                background: colorHex(skin.helmet),
                borderRadius: "16px 16px 4px 4px",
              }}
            />
          )}
          {/* Visor band (overrides default black mask if visor defined) */}
          <div
            className="absolute left-1/2 -translate-x-1/2 border-2 border-black"
            style={{
              width: 30,
              height: 6,
              top: 10,
              background: skin.visor != null ? colorHex(skin.visor) : "#0A0A0A",
              boxShadow: skin.visor != null ? `0 0 6px ${colorHex(skin.visor)}` : "none",
            }}
          />
          {/* Torso */}
          <div
            className="absolute left-1/2 -translate-x-1/2 border-2 border-black"
            style={{ width: 42, height: 44, top: 30, background: colorHex(skin.body) }}
          />
          {/* Chest stripe (vertical) */}
          {skin.stripe != null && (
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                width: 8,
                height: 38,
                top: 33,
                background: colorHex(skin.stripe),
              }}
            />
          )}
          {/* Emblem */}
          <div
            className="absolute left-1/2 -translate-x-1/2 border-2 border-black"
            style={{ width: 14, height: 10, top: 42, background: colorHex(skin.accent) }}
          />
          {/* Belt */}
          {skin.belt != null && (
            <div
              className="absolute left-1/2 -translate-x-1/2 border-2 border-black"
              style={{ width: 42, height: 6, top: 70, background: colorHex(skin.belt) }}
            />
          )}
          {/* Shoulder pads — wider than the body, attached at the top */}
          {skin.shoulder != null && (
            <>
              <div
                className="absolute border-2 border-black"
                style={{ width: 14, height: 12, top: 28, left: -4, background: colorHex(skin.shoulder) }}
              />
              <div
                className="absolute border-2 border-black"
                style={{ width: 14, height: 12, top: 28, right: -4, background: colorHex(skin.shoulder) }}
              />
            </>
          )}
          {/* Arms */}
          <div
            className="absolute border-2 border-black"
            style={{ width: 10, height: 36, top: 32, left: 4, background: colorHex(skin.body) }}
          />
          <div
            className="absolute border-2 border-black"
            style={{ width: 10, height: 36, top: 32, right: 4, background: colorHex(skin.body) }}
          />
          {/* Legs */}
          <div
            className="absolute border-2 border-black"
            style={{ width: 14, height: 40, top: 76, left: 20, background: colorHex(skin.leg) }}
          />
          <div
            className="absolute border-2 border-black"
            style={{ width: 14, height: 40, top: 76, right: 20, background: colorHex(skin.leg) }}
          />
          {/* Knee stripes */}
          {skin.stripe != null && (
            <>
              <div
                className="absolute"
                style={{ width: 14, height: 4, top: 96, left: 20, background: colorHex(skin.stripe) }}
              />
              <div
                className="absolute"
                style={{ width: 14, height: 4, top: 96, right: 20, background: colorHex(skin.stripe) }}
              />
            </>
          )}
        </div>
        {/* Rarity chip */}
        <div
          className="absolute top-2 left-2 font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border-2 border-black"
          style={{ background: rarityHex, color: "#0A0A0A" }}
          data-testid={`shop-skin-rarity-${skin.id}`}
        >
          {skin.rarity}
        </div>
        {/* Equipped pin */}
        {skin.equipped && (
          <div
            className="absolute top-2 right-2 font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 bg-[#06A35F] text-white border-2 border-black flex items-center gap-1"
            data-testid={`shop-skin-equipped-${skin.id}`}
          >
            <Check size={11} strokeWidth={3} /> EQUIPPED
          </div>
        )}
      </div>
      {/* Footer */}
      <div className="p-3 flex items-center justify-between gap-2">
        <div>
          <div className="font-anton uppercase tracking-widest text-sm">{skin.name}</div>
          <div className="flex items-center gap-1 text-xs text-neutral-600 font-anton uppercase tracking-widest">
            <Coins size={12} strokeWidth={3} className="text-[#a36a00]" /> {skin.price}
          </div>
        </div>
        {skin.equipped ? (
          <button
            disabled
            className="btn-pow bg-neutral-200 text-neutral-500 [&]:px-3 [&]:py-1.5 [&]:text-xs"
            data-testid={`shop-skin-action-${skin.id}`}
          >
            EQUIPPED
          </button>
        ) : skin.owned ? (
          <button
            disabled={busy}
            onClick={onEquip}
            className="btn-pow bg-[#0055FF] text-white [&]:px-3 [&]:py-1.5 [&]:text-xs"
            data-testid={`shop-skin-action-${skin.id}`}
          >
            EQUIP
          </button>
        ) : (
          <button
            disabled={busy || !canAfford}
            onClick={onBuy}
            className={`btn-pow [&]:px-3 [&]:py-1.5 [&]:text-xs ${canAfford ? "bg-[#FFD700] text-black" : "bg-neutral-200 text-neutral-500"}`}
            data-testid={`shop-skin-action-${skin.id}`}
            title={canAfford ? "Buy this skin" : "Not enough coins"}
          >
            <span className="flex items-center gap-1">
              {!canAfford && <Lock size={11} strokeWidth={3} />}
              BUY
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/* CSS gradient that approximates the skin's aura. Defaults to a flat
   disc; animated modes get a subtle keyframe shimmer via inline animation
   names already defined in the Lobby's animation registry (banner-shimmer
   reused for spin/pulse). */
function auraCss(skin) {
  if (!skin.aura_mode || skin.aura_mode === "none") {
    return { background: "transparent" };
  }
  const color = "#" + (skin.aura & 0xffffff).toString(16).padStart(6, "0");
  if (skin.aura_mode === "pulse") {
    return {
      background: `radial-gradient(ellipse at 50% 50%, ${color}cc 0%, ${color}55 60%, transparent 100%)`,
      animation: "shop-aura-pulse 2s ease-in-out infinite",
      filter: "blur(2px)",
    };
  }
  if (skin.aura_mode === "spin") {
    return {
      background: `conic-gradient(from 0deg, ${color}cc, transparent 35%, ${color}99 65%, transparent 90%, ${color}cc)`,
      animation: "shop-aura-spin 3s linear infinite",
      filter: "blur(2px)",
    };
  }
  if (skin.aura_mode === "rainbow") {
    return {
      background:
        "conic-gradient(from 0deg, #ff0000, #ff9500, #ffd700, #00e676, #00b8ff, #6b00ff, #ff00d4, #ff0000)",
      animation: "shop-aura-spin 2.4s linear infinite",
      filter: "blur(2px) saturate(1.4)",
    };
  }
  if (skin.aura_mode === "flame") {
    return {
      background: `radial-gradient(ellipse at 50% 60%, #ffd700cc 0%, ${color}aa 35%, ${color}33 70%, transparent 100%)`,
      animation: "shop-aura-flame 0.8s ease-in-out infinite alternate",
      filter: "blur(3px) saturate(1.3)",
    };
  }
  if (skin.aura_mode === "frost") {
    return {
      background: `radial-gradient(ellipse at 50% 50%, #ffffff99 0%, ${color}aa 30%, ${color}33 70%, transparent 100%)`,
      animation: "shop-aura-pulse 3.2s ease-in-out infinite",
      filter: "blur(2px) brightness(1.15)",
    };
  }
  if (skin.aura_mode === "comet") {
    return {
      background: `conic-gradient(from 0deg, ${color}ff 0deg 50deg, ${color}66 60deg 120deg, transparent 130deg 360deg)`,
      animation: "shop-aura-spin 1.6s linear infinite",
      filter: "blur(2px)",
    };
  }
  // flicker (default for any remaining unknown mode)
  return {
    background: `radial-gradient(ellipse at 50% 50%, ${color}cc 0%, ${color}55 60%, transparent 100%)`,
    animation: "shop-aura-flicker 0.9s steps(2, end) infinite",
    filter: "blur(3px)",
  };
}


// ─── XP Boost store — tab card + helpers ──────────────────────────────
// Renders one boost SKU as a card matching the SkinCard visual weight
// but with a "2X XP" hero + duration pill instead of a humanoid preview.

/** Compact "1h 42m", "2d 3h", "45m", "23s" formatting for the countdown
 *  chip. Falls back to seconds when < 1 minute so the last minute of a
 *  boost feels alive. */
function formatBoostRemaining(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const days = Math.floor(s / 86400);
  const hrs = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

/** Human-readable duration shown on the card face ("60 minutes",
 *  "24 hours", "7 days"). Deterministic per SKU. */
function formatBoostDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s % 86400 === 0) {
    const d = s / 86400;
    return d === 1 ? "1 day" : `${d} days`;
  }
  if (s % 3600 === 0) {
    const h = s / 3600;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  const m = Math.round(s / 60);
  return `${m} min`;
}

export function BoostCard({ boost, coins, busy, onBuy }) {
  const canAfford = coins >= boost.price;
  const rarityColor = RARITY_COLOR[boost.rarity] || "#a3a3a3";
  return (
    <div
      className="card-pow bg-white flex flex-col overflow-hidden"
      data-testid={`shop-boost-card-${boost.id}`}
    >
      {/* Header — rarity strip + name */}
      <div
        className="px-3 py-1.5 flex items-center justify-between text-white"
        style={{ background: rarityColor }}
      >
        <div className="font-anton uppercase text-[11px] tracking-widest text-black">
          {boost.rarity}
        </div>
        <div className="font-anton uppercase text-[10px] tracking-widest text-black/70">
          XP BOOST
        </div>
      </div>
      {/* Hero: giant "2X" + duration copy */}
      <div className="flex flex-col items-center justify-center py-6 bg-gradient-to-br from-[#fff8dd] to-[#ffe08a]">
        <div className="flex items-baseline gap-1 text-black">
          <span className="font-display text-6xl leading-none text-pow-shadow">
            {Number(boost.multiplier || 2)}X
          </span>
          <Zap size={26} strokeWidth={4} className="text-[#a36a00] mb-1" />
        </div>
        <div className="mt-1 font-anton uppercase text-[11px] tracking-widest text-neutral-700">
          {formatBoostDuration(boost.duration_sec)}
        </div>
      </div>
      {/* Body: name + tagline */}
      <div className="px-3 py-2 flex-1 flex flex-col">
        <div className="font-anton uppercase text-sm text-black">{boost.name}</div>
        <div className="text-[10px] text-neutral-500 mt-0.5">{boost.tagline}</div>
      </div>
      {/* Footer: price + Buy */}
      <div className="border-t-2 border-black px-3 py-2 flex items-center justify-between bg-neutral-50">
        <div className="flex items-center gap-1 font-anton text-sm text-[#a36a00]">
          <Coins size={12} strokeWidth={3} /> {boost.price}
        </div>
        <button
          onClick={onBuy}
          disabled={!canAfford || busy}
          className={
            "btn-pow [&]:py-1 [&]:px-3 [&]:text-xs " +
            (canAfford
              ? "bg-[#06A35F] text-white"
              : "bg-neutral-300 text-neutral-500 cursor-not-allowed")
          }
          data-testid={`shop-boost-buy-${boost.id}`}
          title={canAfford ? "Activate this boost" : "Not enough coins"}
        >
          {canAfford ? "BUY" : (<span className="flex items-center gap-1"><Lock size={11} strokeWidth={3} /> LOCKED</span>)}
        </button>
      </div>
    </div>
  );
}
