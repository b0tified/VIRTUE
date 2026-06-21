/* ShopBody — embeddable skin-shop grid extracted from `ShopModal`.

  Used in two places:
    1. `ShopModal` — the standalone modal still mounts this inside its
       own chrome (header + close button + backdrop).
    2. `ProgressionModal`'s new "SHOP" tab — embeds the grid inline so
       Pass + Shop live behind a single lobby button (combined per
       user request). When embedded the component skips the
       header/coins pill (the host modal already has its own).

  Self-fetches via `/shop/skins` so the host doesn't have to pre-load.
  Uses the same buy/equip endpoints as before — no API surface change.
*/
import { useEffect, useState } from "react";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";
import { SKINS } from "@/game/skins";
import SkinPreview3D from "@/components/SkinPreview3D";
import { Coins } from "lucide-react";
import { SkinCard } from "@/components/ShopModal";

export default function ShopBody({ embedded = false }) {
  const { user, refreshMe } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [previewSkin, setPreviewSkin] = useState(null);

  const reload = async () => {
    try {
      const { data } = await api.get("/shop/skins");
      setData(data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Failed to load shop.");
    }
  };

  useEffect(() => {
    setError(null);
    reload();
  }, []);

  const coins = data?.coins ?? user?.coins ?? 0;
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

  return (
    <>
      {/* When embedded inside ProgressionModal we still show the coin
          pill at the top of the grid — feels weird to be looking at
          prices without the wallet in view. ShopModal hides this via
          `embedded={false}` since it already has its own. */}
      {embedded && (
        <div className="mb-3 flex items-center justify-end">
          <div
            className="border-pow shadow-pow-sm px-3 py-1.5 flex items-center gap-2"
            style={{ background: "#FFD700", color: "#0A0A0A" }}
            data-testid="shop-coin-balance-embedded"
          >
            <Coins size={14} strokeWidth={3} />
            <span className="font-anton uppercase text-[10px] tracking-widest opacity-70">Coins</span>
            <span className="font-display text-xl leading-none">{coins}</span>
          </div>
        </div>
      )}
      {error && (
        <div
          className="mb-3 px-3 py-2 border-2 border-[#E62429] bg-[#FFE4E4] text-[#7a1115] font-anton uppercase tracking-widest text-xs"
          data-testid="shop-error"
        >
          {error}
        </div>
      )}
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
      {/* 3D turntable preview — mounts above the host modal so the user
          can spin/inspect a skin's mesh + animated extras before
          committing coins. */}
      <SkinPreview3D
        open={!!previewSkin}
        skin={previewSkin}
        onClose={() => setPreviewSkin(null)}
      />
    </>
  );
}
