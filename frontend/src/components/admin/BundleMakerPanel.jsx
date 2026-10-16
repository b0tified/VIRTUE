// Moderation: bundle a custom title with a skin at a discount price.
import { useEffect, useState } from "react";
import api from "@/api";
import { Loader2, Package, Coins } from "lucide-react";
import { SKINS } from "@/game/skins";
import { TitleChip } from "@/components/ShopTitlesTab";

const EMPTY = { title_id: "", skin_id: "", price: 0, active: true, ends_at: "" };

export default function BundleMakerPanel({ onToast }) {
  const [titles, setTitles] = useState([]);
  const [bundles, setBundles] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const load = () => {
    api.get("/admin/titles").then(({ data }) => setTitles(data.titles)).catch(() => {});
    api.get("/admin/title_bundles").then(({ data }) => setBundles(data.bundles)).catch(() => setBundles([]));
  };
  useEffect(() => { load(); window.addEventListener("virtue-titles-changed", load); return () => window.removeEventListener("virtue-titles-changed", load); }, []);

  const skins = SKINS.filter((s) => s.id !== "default");
  const title = titles.find((t) => t.id === form.title_id);
  const skin = skins.find((s) => s.id === form.skin_id);
  const full = (title?.price || 0) + (skin?.price || 0);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const err = (e, m) => onToast?.({ kind: "err", text: e?.response?.data?.detail || m });
  const body = (b) => ({ ...b, price: Number(b.price) || 0, ends_at: b.ends_at ? new Date(b.ends_at).toISOString() : null });

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/admin/title_bundles", body(form));
      onToast?.({ kind: "ok", text: "Bundle added to the shop." });
      setForm(EMPTY);
      load();
    } catch (e) { err(e, "Failed to save bundle."); } finally { setSaving(false); }
  };
  const toggle = async (b) => {
    try {
      await api.put(`/admin/title_bundles/${b.id}`, { title_id: b.title.id, skin_id: b.skin.id, price: b.price, active: !b.active, ends_at: b.ends_at });
      load();
    } catch (e) { err(e, "Failed to update bundle."); }
  };
  const remove = async (b) => {
    if (!window.confirm("Delete this bundle?")) return;
    try { await api.delete(`/admin/title_bundles/${b.id}`); load(); } catch (e) { err(e, "Failed to delete bundle."); }
  };

  const sel = "border-2 border-black px-2 py-1.5 text-sm bg-white";
  return (
    <div className="bg-white border-4 border-black p-4" data-testid="bundle-maker-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Package size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Title Bundles</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">Pair a custom title with a skin at a discount. Shows in Shop → Bundles. Players who own one item pay less.</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Title</span>
          <select value={form.title_id} onChange={(e) => set("title_id", e.target.value)} className={sel} data-testid="bundle-maker-title-select">
            <option value="">Select title…</option>
            {titles.map((t) => <option key={t.id} value={t.id}>{t.text} ({t.price})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Skin</span>
          <select value={form.skin_id} onChange={(e) => set("skin_id", e.target.value)} className={sel} data-testid="bundle-maker-skin-select">
            <option value="">Select skin…</option>
            {skins.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.price || 0})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Bundle price {full > 0 && `(full ${full})`}</span>
          <input type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} className={sel} data-testid="bundle-maker-price-input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Ends (optional)</span>
          <input type="datetime-local" value={form.ends_at} onChange={(e) => set("ends_at", e.target.value)} className={`${sel} text-xs`} data-testid="bundle-maker-ends-input" />
        </label>
        <button type="button" onClick={save} disabled={saving || !form.title_id || !form.skin_id} className="btn-pow bg-[#06A35F] text-white [&]:py-2 [&]:text-xs disabled:opacity-50" data-testid="bundle-maker-save-button">
          {saving ? <Loader2 size={12} className="animate-spin mx-auto" /> : "Add Bundle"}
        </button>
      </div>
      <div className="mt-4 border-t-2 border-black/10 pt-3" data-testid="bundle-maker-list">
        {bundles === null ? <Loader2 size={16} className="animate-spin" /> : bundles.length === 0 ? (
          <div className="text-xs text-neutral-500">No bundles yet.</div>
        ) : bundles.map((b) => (
          <div key={b.id} className="flex items-center gap-3 py-2 border-b border-black/5 flex-wrap" data-testid={`bundle-maker-row-${b.id}`}>
            <span className="font-anton uppercase text-xs">{b.skin.name}</span>
            <span className="font-display">+</span>
            <TitleChip title={b.title} />
            <span className="font-anton text-xs flex items-center gap-1"><Coins size={12} /> {b.price} <s className="opacity-50">{b.full_price}</s></span>
            {b.ends_at && (new Date(b.ends_at) <= new Date()
              ? <span className="text-[10px] uppercase tracking-widest bg-[#E62429] text-white px-1.5 py-0.5 border border-black">Expired</span>
              : <span className="text-[10px] uppercase tracking-widest text-[#E62429]">ends {new Date(b.ends_at).toLocaleString()}</span>)}
            <div className="ml-auto flex gap-1">
              <button type="button" onClick={() => toggle(b)} className={`border-2 border-black px-2 py-1 font-anton uppercase text-[10px] tracking-widest ${b.active ? "bg-[#06A35F] text-white" : "bg-neutral-200"}`} data-testid={`bundle-maker-toggle-${b.id}`}>{b.active ? "In Shop" : "Hidden"}</button>
              <button type="button" onClick={() => remove(b)} className="border-2 border-black px-2 py-1 font-anton uppercase text-[10px] tracking-widest bg-[#E62429] text-white" data-testid={`bundle-maker-delete-${b.id}`}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
