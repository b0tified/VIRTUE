// Moderation: comeback gift tiers (days away → coins + XP).
import { useEffect, useState } from "react";
import api from "@/api";
import { Gift, Loader2, Plus, Trash2 } from "lucide-react";

function Num({ value, onChange, testid }) {
  return (
    <input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))}
      className="border-2 border-black px-2 py-1 w-full font-anton" data-testid={testid} />
  );
}

function TierRow({ t, i, onChange, onRemove }) {
  const set = (k) => (v) => onChange({ ...t, [k]: v });
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center" data-testid={`comeback-tier-${i}`}>
      <Num value={t.days} onChange={set("days")} testid={`comeback-tier-${i}-days`} />
      <Num value={t.coins} onChange={set("coins")} testid={`comeback-tier-${i}-coins`} />
      <Num value={t.xp} onChange={set("xp")} testid={`comeback-tier-${i}-xp`} />
      <button type="button" onClick={onRemove} className="btn-pow bg-white text-black [&]:px-2 [&]:py-1" data-testid={`comeback-tier-${i}-remove`} aria-label="Remove tier">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

export default function AdminComebackPanel({ onToast }) {
  const [cfg, setCfg] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/admin/comeback_config").then(({ data }) => { setCfg(data); setTiers(data.tiers); }).catch(() => {});
  }, []);

  const save = async (body) => {
    setSaving(true);
    try {
      const { data } = await api.post("/admin/comeback_config", { tiers: body });
      setCfg(data);
      setTiers(data.tiers);
      onToast?.({ kind: "ok", text: "Comeback gift saved." });
    } catch (e) {
      const d = e?.response?.data?.detail;
      onToast?.({ kind: "err", text: (Array.isArray(d) ? d[0]?.msg : d) || "Failed to save comeback gift." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-comeback-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Gift size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Comeback Gift</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">
        Players away at least this many days get a "Welcome back" popup. The biggest tier they reach applies. Coin multiplier events also apply.
      </div>
      {!cfg ? <Loader2 size={16} className="animate-spin" /> : (
        <div className="space-y-2 max-w-xl">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 font-anton uppercase tracking-widest text-[10px] opacity-70">
            <span>Days away</span><span>Coins</span><span>XP</span><span className="w-7" />
          </div>
          {tiers.map((t, i) => (
            <TierRow key={i} t={t} i={i} onChange={(nt) => setTiers(tiers.map((x, k) => (k === i ? nt : x)))} onRemove={() => setTiers(tiers.filter((_, k) => k !== i))} />
          ))}
          <div className="flex gap-3 justify-between border-t-2 border-black/10 pt-3">
            <button type="button" disabled={tiers.length >= 6} onClick={() => setTiers([...tiers, { days: (tiers.at(-1)?.days || 0) + 30, coins: 0, xp: 0 }])} className="btn-pow bg-white text-black text-xs px-3 py-2 flex items-center gap-1" data-testid="comeback-add-tier">
              <Plus size={12} /> Add Tier
            </button>
            <div className="flex gap-3">
              <button type="button" disabled={saving} onClick={() => save(cfg.defaults)} className="btn-pow bg-white text-black text-xs px-4 py-2" data-testid="comeback-reset-button">Reset Defaults</button>
              <button type="button" disabled={saving || !tiers.length} onClick={() => save(tiers)} className="btn-pow bg-[#FFD700] text-black text-xs px-4 py-2" data-testid="comeback-save-button">
                {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
