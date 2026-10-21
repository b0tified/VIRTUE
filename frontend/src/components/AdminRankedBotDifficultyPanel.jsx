// Moderation: ranked bot difficulty per rank (applies to newly created ranked bot matches).
import { useEffect, useState } from "react";
import api from "@/api";
import { Bot, Loader2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";

const TIER_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];

function TierSlider({ name, idx, value, onChange }) {
  return (
    <div className="flex items-center gap-3" data-testid={`ranked-bot-diff-row-${idx}`}>
      <span className="font-anton uppercase tracking-wider text-xs w-28 shrink-0" style={{ color: TIER_COLORS[idx] }}>{name}</span>
      <Slider min={0.5} max={5} step={0.05} value={[value]} onValueChange={([v]) => onChange(v)} className="flex-1 [&>span:first-child]:bg-neutral-300 [&>span:first-child]:h-2 [&>span:first-child>span]:bg-[#E62429] [&_[role=slider]]:bg-[#FFD700] [&_[role=slider]]:border-2 [&_[role=slider]]:border-black" data-testid={`ranked-bot-diff-slider-${idx}`} />
      <span className="font-anton text-sm w-10 text-right" data-testid={`ranked-bot-diff-value-${idx}`}>{value.toFixed(2)}</span>
    </div>
  );
}

export default function AdminRankedBotDifficultyPanel({ onToast }) {
  const [cfg, setCfg] = useState(null);
  const [vals, setVals] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/admin/ranked_bot_difficulty").then(({ data }) => { setCfg(data); setVals(data.values); }).catch(() => {});
  }, []);

  const save = async (values) => {
    setSaving(true);
    try {
      const { data } = await api.post("/admin/ranked_bot_difficulty", { values });
      setCfg(data);
      setVals(data.values);
      onToast?.({ kind: "ok", text: "Ranked bot difficulty saved." });
    } catch (e) {
      onToast?.({ kind: "err", text: e?.response?.data?.detail || "Failed to save difficulty." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-ranked-bot-difficulty-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Bot size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Ranked Bot Difficulty Per Rank</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">0.5 = very easy · 1.0 = normal bot · 5.0 = very hard. Applies to new ranked matches.</div>
      {!cfg ? <Loader2 size={16} className="animate-spin" /> : (
        <div className="space-y-3">
          {cfg.tiers.map((t, i) => (
            <TierSlider key={t} name={t} idx={i} value={vals[i]} onChange={(v) => setVals(vals.map((x, k) => (k === i ? Math.round(v * 100) / 100 : x)))} />
          ))}
          <div className="flex gap-3 justify-end border-t-2 border-black/10 pt-3">
            <button type="button" disabled={saving} onClick={() => save(cfg.defaults)} className="btn-pow bg-white text-black text-xs px-4 py-2" data-testid="ranked-bot-diff-reset-button">Reset Defaults</button>
            <button type="button" disabled={saving} onClick={() => save(vals)} className="btn-pow bg-[#FFD700] text-black text-xs px-4 py-2" data-testid="ranked-bot-diff-save-button">
              {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
