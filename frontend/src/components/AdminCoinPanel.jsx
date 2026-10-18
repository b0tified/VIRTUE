// Moderation: tune coin rewards + run timed coin multiplier events.
import { useEffect, useState } from "react";
import api from "@/api";
import { Coins, Loader2 } from "lucide-react";

const TIERS = ["Bronze", "Silver", "Gold", "Plat", "Emerald", "Diamond", "Master", "GM", "Goon"];
const SCALARS = [
  { k: "match_play", label: "Per match played" },
  { k: "per_kill", label: "Per kill" },
  { k: "kill_cap", label: "Max kills counted" },
  { k: "win_bonus", label: "Win / 1st place bonus" },
  { k: "rank_up_bonus", label: "Ranked tier-up bonus" },
];

function NumInput({ value, onChange, testid, step = 1 }) {
  return (
    <input
      type="number" min={0} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="border-2 border-black px-2 py-1 w-full font-anton"
      data-testid={testid}
    />
  );
}

function ListRow({ title, labels, values, onChange, prefix }) {
  return (
    <div>
      <div className="font-anton uppercase tracking-widest text-[10px] opacity-70 mb-1">{title}</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0,1fr))` }}>
        {labels.map((l, i) => (
          <label key={l} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500 truncate">{l}</span>
            <NumInput value={values[i]} onChange={(v) => onChange(values.map((x, j) => (j === i ? v : x)))} testid={`${prefix}-${i}`} />
          </label>
        ))}
      </div>
    </div>
  );
}

export default function AdminCoinPanel({ onToast }) {
  const [vals, setVals] = useState(null);
  const [hours, setHours] = useState(48);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/admin/coin_config").then(({ data }) => setVals(data)).catch(() => {});
  }, []);

  const save = async (override = {}) => {
    setSaving(true);
    try {
      const body = { ...vals, multiplier_hours: hours, ...override };
      const { data } = await api.post("/admin/coin_config", body);
      setVals(data);
      onToast?.({ kind: "ok", text: "Coin rewards saved." });
    } catch (e) {
      onToast?.({ kind: "err", text: e?.response?.data?.detail?.[0]?.msg || e?.response?.data?.detail || "Failed to save coin rewards." });
    } finally {
      setSaving(false);
    }
  };
  const active = vals?.active_multiplier > 1;
  const endsAt = active && vals.multiplier_until ? new Date(vals.multiplier_until * 1000).toLocaleString() : null;

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-coin-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Coins size={16} strokeWidth={3} className="text-[#FFB800]" />
        <span>Coin Rewards</span>
        {active && (
          <span className="ml-2 bg-[#E62429] text-white px-2 py-0.5 text-[10px]" data-testid="admin-coin-boost-active">
            {vals.active_multiplier}x ACTIVE{endsAt ? ` · until ${endsAt}` : ""}
          </span>
        )}
      </div>
      <div className="text-xs text-neutral-600 mb-3">
        Coins from online matches (not Practice), ranked tier-ups, season-end rank and the 7-day login streak.
      </div>
      {!vals ? <Loader2 size={16} className="animate-spin" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {SCALARS.map(({ k, label }) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">{label}</span>
                <NumInput value={vals[k]} onChange={(v) => setVals({ ...vals, [k]: v })} testid={`coin-${k}-input`} />
              </label>
            ))}
          </div>
          <ListRow title="Daily streak (day 1 → 7)" labels={[1, 2, 3, 4, 5, 6, 7].map((d) => `Day ${d}`)} values={vals.daily} onChange={(daily) => setVals({ ...vals, daily })} prefix="coin-daily" />
          <ListRow title="Season-end reward by final rank" labels={TIERS} values={vals.season_end} onChange={(season_end) => setVals({ ...vals, season_end })} prefix="coin-season" />
          <div className="flex flex-wrap items-end gap-3 border-t-2 border-black/10 pt-3">
            <label className="flex flex-col gap-1 w-28">
              <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Multiplier</span>
              <NumInput step={0.5} value={vals.multiplier} onChange={(v) => setVals({ ...vals, multiplier: v })} testid="coin-multiplier-input" />
            </label>
            <label className="flex flex-col gap-1 w-28">
              <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">For hours (0 = no end)</span>
              <NumInput value={hours} onChange={setHours} testid="coin-multiplier-hours-input" />
            </label>
            <button type="button" disabled={saving} onClick={() => save({ multiplier: 2 })} className="btn-pow bg-[#E62429] text-white text-xs px-4 py-2" data-testid="coin-start-2x-button">
              Start 2x Coins
            </button>
            {active && (
              <button type="button" disabled={saving} onClick={() => save({ multiplier: 1 })} className="btn-pow bg-white text-black text-xs px-4 py-2" data-testid="coin-end-boost-button">
                End Boost
              </button>
            )}
            <button type="button" disabled={saving} onClick={() => save()} className="btn-pow bg-[#FFD700] text-black text-xs px-4 py-2 ml-auto" data-testid="coin-save-button">
              {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
