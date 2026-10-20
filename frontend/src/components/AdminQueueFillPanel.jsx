// Moderation: queue wait time before empty slots are filled with bots.
import { useEffect, useState } from "react";
import api from "@/api";
import { Timer, Loader2 } from "lucide-react";

function Sec({ value, onChange, testid }) {
  return (
    <input
      type="number" min={0} step={1} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="border-2 border-black px-2 py-1 w-full font-anton"
      data-testid={testid}
    />
  );
}

const Label = ({ children }) => (
  <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">{children}</span>
);

function RankedGrid({ tiers, ranked, onChange }) {
  const set = (i, j, v) => onChange(ranked.map((r, k) => (k === i ? r.map((x, m) => (m === j ? v : x)) : r)));
  return (
    <div>
      <Label>Ranked · random wait between min and max seconds, per rank (top = min, bottom = max)</Label>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mt-1">
        {tiers.map((t, i) => (
          <div key={t} className="flex flex-col gap-1" data-testid={`queue-ranked-tier-${i}`}>
            <span className="text-[10px] text-neutral-500 truncate">{t}</span>
            <Sec value={ranked[i][0]} onChange={(v) => set(i, 0, v)} testid={`queue-ranked-${i}-min`} />
            <Sec value={ranked[i][1]} onChange={(v) => set(i, 1, v)} testid={`queue-ranked-${i}-max`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminQueueFillPanel({ onToast }) {
  const [vals, setVals] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/admin/queue_fill_config").then(({ data }) => setVals(data)).catch(() => {});
  }, []);

  const save = async (body) => {
    setSaving(true);
    try {
      const { data } = await api.post("/admin/queue_fill_config", body);
      setVals(data);
      onToast?.({ kind: "ok", text: "Queue autofill times saved." });
    } catch (e) {
      const d = e?.response?.data?.detail;
      onToast?.({ kind: "err", text: (Array.isArray(d) ? d[0]?.msg : d) || "Failed to save queue times." });
    } finally {
      setSaving(false);
    }
  };
  const current = () => ({ casual_sec: vals.casual_sec, bigffa_min: vals.bigffa_min, bigffa_max: vals.bigffa_max, ranked: vals.ranked });

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-queue-fill-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Timer size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Queue Time Before Bot Autofill</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">
        How long players wait in queue for real opponents before empty slots are filled with bots. Seconds.
      </div>
      {!vals ? <Loader2 size={16} className="animate-spin" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 max-w-xl">
            <label className="flex flex-col gap-1"><Label>Quick Match</Label>
              <Sec value={vals.casual_sec} onChange={(v) => setVals({ ...vals, casual_sec: v })} testid="queue-casual-input" /></label>
            <label className="flex flex-col gap-1"><Label>Big FFA min</Label>
              <Sec value={vals.bigffa_min} onChange={(v) => setVals({ ...vals, bigffa_min: v })} testid="queue-bigffa-min-input" /></label>
            <label className="flex flex-col gap-1"><Label>Big FFA max</Label>
              <Sec value={vals.bigffa_max} onChange={(v) => setVals({ ...vals, bigffa_max: v })} testid="queue-bigffa-max-input" /></label>
          </div>
          <RankedGrid tiers={vals.tiers} ranked={vals.ranked} onChange={(ranked) => setVals({ ...vals, ranked })} />
          <div className="flex gap-3 justify-end border-t-2 border-black/10 pt-3">
            <button type="button" disabled={saving} onClick={() => save(vals.defaults)} className="btn-pow bg-white text-black text-xs px-4 py-2" data-testid="queue-fill-reset-button">
              Reset Defaults
            </button>
            <button type="button" disabled={saving} onClick={() => save(current())} className="btn-pow bg-[#FFD700] text-black text-xs px-4 py-2" data-testid="queue-fill-save-button">
              {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
