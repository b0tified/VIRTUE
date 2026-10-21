// Moderation: preview the season rank reset animation + recap with chosen ranks (nothing is saved).
import { useState } from "react";
import { Play, Sparkles } from "lucide-react";
import RankResetOverlay from "@/components/RankResetOverlay";
import { SeasonRecapView } from "@/components/SeasonRecapModal";

const TIERS = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "GOONMASTER"];
const ROMAN = { 1: "I", 2: "II", 3: "III" };
const OPTIONS = TIERS.flatMap((name, tier) =>
  tier === 8
    ? [{ key: name, name, tier, division: 0, rp: 2450 }]
    : [3, 2, 1].map((d) => ({ key: `${name}_${d}`, name, tier, division: d, rp: tier * 300 + (3 - d) * 100 + 50 })),
);
const byKey = Object.fromEntries(OPTIONS.map((o) => [o.key, o]));
const toRank = ({ name, tier, division, rp }) => ({ name, tier, division, rp });

function RankSelect({ value, onChange, testid, label }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="border-2 border-black px-2 py-1 font-anton" data-testid={testid}>
        {OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.name} {ROMAN[o.division] || ""}</option>)}
      </select>
    </label>
  );
}

export default function AdminRankResetPreview() {
  const [fromKey, setFromKey] = useState("GRANDMASTER_2");
  const [toKey, setToKey] = useState("DIAMOND_3");
  const [step, setStep] = useState(null); // null | "reset" | "recap"
  const from = toRank(byKey[fromKey]);
  const to = toRank(byKey[toKey]);
  const recap = { season: 1, full: true, peak: from, final: from, new: to, matches: 42, wins: 11, kills: 318, coins_earned: 1250, season_end_coins: 500 };

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-rank-reset-preview">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Sparkles size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Season Reset Animation Preview</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">Plays what players see on their first login after a season reset. Preview only, nothing is saved.</div>
      <div className="flex flex-wrap items-end gap-3">
        <RankSelect label="Rank before reset" value={fromKey} onChange={setFromKey} testid="rank-reset-preview-from" />
        <RankSelect label="Starting predicted rank" value={toKey} onChange={setToKey} testid="rank-reset-preview-to" />
        <button type="button" onClick={() => setStep("reset")} className="btn-pow bg-[#FFD700] text-black text-xs px-4 py-2 flex items-center gap-1" data-testid="rank-reset-preview-play">
          <Play size={12} strokeWidth={3} /> Play
        </button>
      </div>
      {step === "reset" && <RankResetOverlay from={from} to={to} season={2} onDone={() => setStep("recap")} />}
      {step === "recap" && <SeasonRecapView recap={recap} nextSeason={2} onClose={() => setStep(null)} buttonLabel="Close Preview" />}
    </div>
  );
}
