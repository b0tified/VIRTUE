// Full-screen recap shown once after a season reset.
import { useEffect, useState } from "react";
import api from "@/api";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import RankResetOverlay from "@/components/RankResetOverlay";
import { divisionRoman } from "@/game/rankIcons";
import { ArrowDown, Coins, Crosshair, Swords, Trophy } from "lucide-react";

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];

const rankLabel = (r) => `${r.name}${divisionRoman(r.division) ? ` ${divisionRoman(r.division)}` : ""}`;

function RankCard({ label, rank, testid, delay, big }) {
  return (
    <div
      className="flex flex-col items-center gap-1 recap-pop"
      style={{ animationDelay: `${delay}ms` }}
      data-testid={testid}
    >
      <div className="font-anton uppercase tracking-widest text-[10px] sm:text-xs text-white/70">{label}</div>
      <div
        className="border-4 border-black px-3 py-2 tiny:py-1 flex items-center gap-2"
        style={{ background: RANK_COLORS[Math.min(8, rank.tier)] || "#666", boxShadow: "4px 4px 0 0 #0A0A0A" }}
      >
        <AnimatedRankIcon tier={rank.tier} division={rank.division} size={big ? 44 : 32} />
        <div className="text-left leading-none">
          <div className={`font-display text-black ${big ? "text-2xl sm:text-3xl tiny:text-xl" : "text-xl tiny:text-base"}`}>{rankLabel(rank)}</div>
          <div className="font-anton text-[10px] text-black/70">{rank.rp} RP</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, delay, testid }) {
  return (
    <div className="bg-white text-black border-4 border-black px-3 py-2 tiny:py-1 flex items-center gap-2 recap-pop" style={{ animationDelay: `${delay}ms`, boxShadow: "3px 3px 0 0 #0A0A0A" }} data-testid={testid}>
      {icon}
      <div className="leading-none">
        <div className="font-anton uppercase tracking-widest text-[9px] text-neutral-500">{label}</div>
        <div className="font-display text-lg tiny:text-base">{value}</div>
      </div>
    </div>
  );
}

export function SeasonRecapView({ recap: r, nextSeason, onClose, buttonLabel }) {
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto flex items-start justify-center p-4" style={{ background: "radial-gradient(ellipse at center, #2a1058 0%, #0A0A0A 75%)" }} data-testid="season-recap-modal">
      <style>{`
        .recap-pop { animation: recap-pop 520ms cubic-bezier(.2,1.3,.4,1) both; }
        @keyframes recap-pop { 0% { transform: scale(.6) translateY(16px); opacity: 0; } 100% { transform: none; opacity: 1; } }
      `}</style>
      <div className="relative w-full max-w-2xl my-auto flex flex-col items-center gap-4 tiny:gap-2 text-center">
        <div className="recap-pop">
          <div className="font-anton uppercase tracking-[0.3em] text-[#FFD700] text-xs">Season {r.season} complete</div>
          <div className="font-display text-white text-4xl sm:text-6xl tiny:text-3xl leading-none" style={{ textShadow: "4px 4px 0 #E62429, 7px 7px 0 #0A0A0A" }} data-testid="season-recap-title">
            SEASON RECAP
          </div>
          {r.leaderboard_rank ? (
            <div className="font-anton uppercase tracking-widest text-xs text-white mt-1" data-testid="season-recap-leaderboard">Finished #{r.leaderboard_rank} globally</div>
          ) : null}
        </div>
        {r.full === false ? (
          <>
            <RankCard label="Final rank" rank={r.final} testid="season-recap-final" delay={200} big />
            <div className="font-anton uppercase tracking-widest text-xs text-white/60 recap-pop" style={{ animationDelay: "450ms" }} data-testid="season-recap-not-tracked">
              Stats not tracked for this season
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-center gap-4 tiny:gap-3">
              <RankCard label="Season peak" rank={r.peak} testid="season-recap-peak" delay={200} big />
              <RankCard label="Final rank" rank={r.final} testid="season-recap-final" delay={450} />
            </div>
            <ArrowDown size={28} strokeWidth={4} className="text-[#FFD700] recap-pop tiny:hidden" style={{ animationDelay: "700ms" }} />
            <RankCard label={`Season ${nextSeason} start`} rank={r.new} testid="season-recap-new" delay={850} big />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
              <Stat icon={<Swords size={18} strokeWidth={3} />} label="Ranked matches" value={r.matches} delay={1100} testid="season-recap-matches" />
              <Stat icon={<Trophy size={18} strokeWidth={3} />} label="Wins" value={r.wins} delay={1200} testid="season-recap-wins" />
              <Stat icon={<Crosshair size={18} strokeWidth={3} />} label="Kills" value={r.kills} delay={1300} testid="season-recap-kills" />
              <Stat icon={<Coins size={18} strokeWidth={3} className="text-[#FFB800]" />} label="Coins earned" value={r.coins_earned} delay={1400} testid="season-recap-coins" />
            </div>
            {r.season_end_coins > 0 && (
              <div className="font-anton uppercase tracking-widest text-xs text-[#FFD700] recap-pop" style={{ animationDelay: "1500ms" }} data-testid="season-recap-reward">
                Includes +{r.season_end_coins} season-end reward
              </div>
            )}
          </>
        )}
        <button onClick={onClose} className="btn-pow bg-[#FFD700] text-black recap-pop [&]:py-2 tiny:[&]:py-1" style={{ animationDelay: r.full === false ? "600ms" : "1650ms" }} data-testid="season-recap-continue">
          <span className="font-anton uppercase tracking-widest">{buttonLabel}</span>
        </button>
      </div>
    </div>
  );
}

export default function SeasonRecapModal() {
  const [data, setData] = useState(null);
  const [resetDone, setResetDone] = useState(false);
  useEffect(() => {
    api.get("/season/recap").then(({ data: d }) => { if (d.recap) setData(d); }).catch(() => {});
  }, []);
  if (!data) return null;
  const close = () => {
    api.post("/season/recap/seen").catch(() => {});
    setData(null);
  };
  const r = data.recap;
  if (!resetDone && r.full !== false && r.final && r.new) {
    return <RankResetOverlay from={r.final} to={r.new} season={data.current_season} onDone={() => setResetDone(true)} />;
  }
  return <SeasonRecapView recap={data.recap} nextSeason={data.current_season} onClose={close} buttonLabel={`Start Season ${data.current_season}`} />;
}
