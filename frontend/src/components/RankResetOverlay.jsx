// Season rank reset: old rank cracks and drops, then the new predicted starting rank slams in.
import { useEffect, useRef, useState } from "react";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import audioBus from "@/game/audio";
import { divisionRoman } from "@/game/rankIcons";
import useTinyScreen from "@/hooks/useTinyScreen";

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];
const label = (r) => `${r.name}${divisionRoman(r.division) ? ` ${divisionRoman(r.division)}` : ""}`;
const STYLES = `
  @keyframes rs-in { from { transform: scale(.5); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes rs-shake { 0%,100% { transform: translate(0,0) rotate(0); } 25% { transform: translate(-5px,3px) rotate(-2deg); } 75% { transform: translate(5px,-3px) rotate(2deg); } }
  @keyframes rs-drop { 0% { transform: none; opacity: 1; } 100% { transform: translateY(70vh) rotate(28deg) scale(.7); opacity: 0; } }
  @keyframes rs-slam { 0% { transform: scale(2.6); opacity: 0; } 60% { transform: scale(.9); opacity: 1; } 100% { transform: scale(1); } }
  @keyframes rs-flash { from { opacity: .9; } to { opacity: 0; } }
  @keyframes rs-crack { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
`;

function OldRank({ rank, phase, size }) {
  const anim = phase === "hold" ? "rs-in 450ms cubic-bezier(.2,1.3,.4,1) both" : phase === "crack" ? "rs-shake 90ms linear infinite" : "rs-drop 700ms ease-in forwards";
  return (
    <div className="relative flex flex-col items-center gap-2" style={{ animation: anim }} data-testid="rank-reset-old">
      <AnimatedRankIcon tier={rank.tier} division={rank.division} size={size} />
      <div className="font-display text-3xl sm:text-5xl tiny:text-2xl" style={{ color: RANK_COLORS[rank.tier], WebkitTextStroke: "2px #0A0A0A", textShadow: "4px 4px 0 #0A0A0A" }}>{label(rank)}</div>
      <div className="font-anton text-white/70 text-sm">{rank.rp} RP</div>
      {phase !== "hold" && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ animation: "rs-crack 260ms ease-out both" }}>
          <polyline points="48,0 55,22 44,38 58,55 46,72 54,100" fill="none" stroke="#fff" strokeWidth="1.6" />
          <polyline points="55,22 70,30 82,26" fill="none" stroke="#fff" strokeWidth="1" />
          <polyline points="58,55 30,62 18,58" fill="none" stroke="#fff" strokeWidth="1" />
        </svg>
      )}
    </div>
  );
}

function NewRank({ rank, size, onDone }) {
  const color = RANK_COLORS[rank.tier];
  return (
    <div className="flex flex-col items-center gap-3 tiny:gap-1" data-testid="rank-reset-new">
      <div style={{ animation: "rs-slam 520ms cubic-bezier(.2,1.4,.4,1) both" }}>
        <AnimatedRankIcon tier={rank.tier} division={rank.division} size={size} />
      </div>
      <div className="font-anton uppercase tracking-[0.3em] text-xs text-[#FFD700]" style={{ animation: "rs-in 400ms 200ms both" }}>Predicted</div>
      <div className="font-display text-5xl sm:text-7xl tiny:text-4xl leading-none" style={{ color, WebkitTextStroke: "2px #0A0A0A", textShadow: "5px 5px 0 #0A0A0A", animation: "rs-slam 600ms 120ms cubic-bezier(.2,1.4,.4,1) both" }} data-testid="rank-reset-new-name">
        {label(rank)}
      </div>
      <div className="font-anton uppercase tracking-widest text-white/80 text-xs sm:text-sm max-w-xs" style={{ animation: "rs-in 400ms 400ms both" }}>
        Play 5 placement matches to lock in your rank
      </div>
      <button onClick={(e) => { e.stopPropagation(); onDone(); }} className="btn-pow bg-[#FFD700] text-black mt-2 [&]:py-2 tiny:[&]:py-1" style={{ animation: "rs-in 400ms 600ms both" }} data-testid="rank-reset-continue">
        <span className="font-anton uppercase tracking-widest">Continue</span>
      </button>
    </div>
  );
}

export default function RankResetOverlay({ from, to, season, onDone }) {
  const [phase, setPhase] = useState("hold"); // hold → crack → drop → reveal
  const timers = useRef([]);
  const tiny = useTinyScreen();
  const size = tiny ? 80 : 140;

  useEffect(() => {
    const t = timers.current;
    t.push(setTimeout(() => setPhase("crack"), 1300));
    t.push(setTimeout(() => setPhase("drop"), 2100));
    t.push(setTimeout(() => { setPhase("reveal"); audioBus.revealImpact?.(to.tier >= 2); }, 2900));
    return () => t.forEach(clearTimeout);
  }, [to.tier]);

  const skip = () => {
    if (phase === "reveal") return;
    timers.current.forEach(clearTimeout);
    setPhase("reveal");
  };
  const color = RANK_COLORS[to.tier];

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center overflow-hidden select-none text-center px-4" style={{ background: phase === "reveal" ? `radial-gradient(circle at center, ${color}55 0%, #0A0A0A 70%), #0A0A0A` : "#0A0A0A" }} onClick={skip} data-testid="rank-reset-overlay" data-phase={phase}>
      <style>{STYLES}</style>
      {phase === "reveal" && <div className="absolute inset-0 pointer-events-none" style={{ background: color, animation: "rs-flash 600ms ease-out forwards" }} />}
      <div className="relative flex flex-col items-center gap-6 tiny:gap-2">
        <div className="font-display text-white text-3xl sm:text-5xl tiny:text-2xl tracking-wider" style={{ textShadow: "3px 3px 0 #E62429" }} data-testid="rank-reset-heading">
          {phase === "reveal" ? `SEASON ${season} STARTING RANK` : "RANK RESET"}
        </div>
        {phase === "reveal" ? <NewRank rank={to} size={size} onDone={onDone} /> : <OldRank rank={from} phase={phase} size={size} />}
        {phase !== "reveal" && <div className="font-anton uppercase tracking-widest text-[10px] text-white/40">Tap to skip</div>}
      </div>
    </div>
  );
}
