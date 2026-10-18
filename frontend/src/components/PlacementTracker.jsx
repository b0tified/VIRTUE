// Win/loss dots for this season's placement matches (shown while in placements).
import { useEffect, useState } from "react";
import api from "@/api";

export default function PlacementTracker({ played = 0, total = 5, testid = "placement-tracker", className = "" }) {
  const [results, setResults] = useState([]);
  useEffect(() => {
    api.get("/me/placements").then(({ data }) => setResults(data.results || [])).catch(() => {});
  }, [played]);

  const slots = Array.from({ length: total }, (_, i) => results[i] || null);
  const wins = results.filter((r) => r.win).length;
  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid={testid}>
      <span className="font-anton uppercase tracking-widest text-[10px] text-white/80">Placements</span>
      <div className="flex items-center gap-1.5">
        {slots.map((r, i) => (
          <span
            key={i}
            title={r ? `Match ${i + 1}: #${r.placement}${r.total_players ? ` of ${r.total_players}` : ""} · ${r.kills} kills` : `Match ${i + 1}: not played`}
            className={`w-5 h-5 rounded-full border-2 border-black flex items-center justify-center font-anton text-[9px] leading-none ${r ? "text-white" : "text-white/40 border-dashed bg-transparent"}`}
            style={r ? { background: r.win ? "#06A35F" : "#E62429", boxShadow: "2px 2px 0 0 #0A0A0A" } : { borderColor: "rgba(255,255,255,0.4)" }}
            data-testid={`${testid}-dot-${i}`}
            data-result={r ? (r.win ? "win" : "loss") : "pending"}
          >
            {r ? (r.win ? "W" : `#${r.placement}`) : ""}
          </span>
        ))}
      </div>
      <span className="font-anton uppercase tracking-widest text-[10px] text-[#FFD700]" data-testid={`${testid}-summary`}>
        {wins}W · {results.length - wins}L
      </span>
    </div>
  );
}
