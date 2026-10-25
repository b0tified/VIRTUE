// Moderation: adjustable anti-cheat flag limits.
import { useEffect, useState } from "react";
import api from "@/api";
import { Loader2, SlidersHorizontal } from "lucide-react";

const FIELDS = [
  ["hs_rate_max", "Headshot rate limit", true], ["hs_min_hits", "…after at least N hits", false],
  ["accuracy_max", "Accuracy limit", true], ["acc_min_shots", "…after at least N shots", false],
  ["snap_rate_max", "Snap-hit rate limit", true], ["snap_min_hits", "…after at least N hits", false],
  ["kd_max", "K/D limit", false], ["kd_min_kills", "…after at least N kills", false],
  ["sample_matches", "Matches checked", false], ["min_matches", "Min matches before flagging", false],
];

function Field({ k, label, isPct, value, onChange }) {
  const shown = isPct ? Math.round(value * 100) : value;
  return (
    <label className="flex flex-col gap-1">
      <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">{label}{isPct ? " (%)" : ""}</span>
      <input type="number" step="any" value={shown} onChange={(e) => onChange(isPct ? Number(e.target.value) / 100 : Number(e.target.value))}
        className="border-2 border-black px-2 py-1 font-anton" data-testid={`anticheat-config-${k}`} />
    </label>
  );
}

export default function AdminAnticheatConfig({ onToast }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && !cfg) api.get("/admin/anticheat_config").then(({ data }) => { setCfg(data.config); setDefaults(data.defaults); }).catch(() => {});
  }, [open, cfg]);

  const save = async (body) => {
    setSaving(true);
    try {
      const { data } = await api.post("/admin/anticheat_config", body);
      setCfg(data.config);
      onToast?.({ kind: "ok", text: "Anti-cheat limits saved." });
    } catch (e) {
      onToast?.({ kind: "err", text: "Failed to save limits." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 border-t-2 border-black/10 pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="font-anton uppercase tracking-widest text-xs flex items-center gap-2" data-testid="anticheat-config-toggle">
        <SlidersHorizontal size={14} /> Flag limits {open ? "▲" : "▼"}
      </button>
      {open && (!cfg ? <Loader2 size={16} className="animate-spin mt-2" /> : (
        <div className="mt-3 space-y-3" data-testid="anticheat-config-form">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {FIELDS.map(([k, label, isPct]) => (
              <Field key={k} k={k} label={label} isPct={isPct} value={cfg[k]} onChange={(v) => setCfg({ ...cfg, [k]: v })} />
            ))}
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" disabled={saving} onClick={() => save(defaults)} className="btn-pow bg-white text-black text-xs px-4 py-2" data-testid="anticheat-config-reset">Reset Defaults</button>
            <button type="button" disabled={saving} onClick={() => save(cfg)} className="btn-pow bg-[#FFD700] text-black text-xs px-4 py-2" data-testid="anticheat-config-save">
              {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
