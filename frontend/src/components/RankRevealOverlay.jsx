// Dramatic "Your rank is…" reveal after the final placement match.
import { useEffect, useRef, useState } from "react";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import audioBus from "@/game/audio";
import { divisionRoman } from "@/game/rankIcons";
import useTinyScreen from "@/hooks/useTinyScreen";

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];
const SPIN_MS = 2600;

function Confetti() {
  const bits = Array.from({ length: 40 }, (_, i) => i);
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" data-testid="rank-reveal-confetti">
      {bits.map((i) => (
        <span
          key={i}
          className="absolute top-[-5%] block w-2 h-3"
          style={{
            left: `${(i * 37) % 100}%`,
            background: i % 3 ? "#FFD700" : "#FFFFFF",
            animation: `rr-fall ${1.8 + (i % 5) * 0.35}s linear ${(i % 8) * 0.12}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

export default function RankRevealOverlay({ row, onDone }) {
  const tier = Math.max(0, Math.min(8, row.rank_tier ?? 0));
  const big = tier >= 2;
  const color = RANK_COLORS[tier];
  const [phase, setPhase] = useState("intro"); // intro → spin → reveal
  const [spinTier, setSpinTier] = useState(0);
  const timers = useRef([]);
  const tiny = useTinyScreen();

  useEffect(() => {
    const t = timers.current;
    t.push(setTimeout(() => { setPhase("spin"); audioBus.revealDrumroll?.(SPIN_MS / 1000); }, 900));
    let elapsed = 0, step = 60, i = 0;
    const tick = () => {
      setSpinTier(i++ % 9);
      elapsed += step;
      step = Math.min(320, step * 1.09);
      if (elapsed < SPIN_MS) t.push(setTimeout(tick, step));
      else { setPhase("reveal"); audioBus.revealImpact?.(big); }
    };
    t.push(setTimeout(tick, 900));
    return () => t.forEach(clearTimeout);
  }, [big]);

  const skip = () => {
    if (phase === "reveal") return;
    timers.current.forEach(clearTimeout);
    setPhase("reveal");
    audioBus.revealImpact?.(big);
  };
  const roman = divisionRoman(row.rank_division);

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center overflow-hidden pointer-events-auto select-none"
      style={{ background: phase === "reveal" ? `radial-gradient(circle at center, ${color}55 0%, #0A0A0A 70%)` : "#0A0A0A" }}
      onClick={skip}
      data-testid="rank-reveal-overlay"
      data-phase={phase}
    >
      <style>{`
        @keyframes rr-type { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
        @keyframes rr-flash { 0% { opacity: .95; } 100% { opacity: 0; } }
        @keyframes rr-slam { 0% { transform: scale(2.4); opacity: 0; } 60% { transform: scale(.92); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes rr-burst { from { transform: rotate(0deg) scale(.6); opacity: .9; } to { transform: rotate(25deg) scale(1.15); opacity: .55; } }
        @keyframes rr-fall { to { transform: translateY(115vh) rotate(540deg); } }
        @keyframes rr-shake { 0%,100% { transform: translate(0,0); } 25% { transform: translate(-3px,2px); } 75% { transform: translate(3px,-2px); } }
      `}</style>

      {phase === "reveal" && (
        <>
          <div className="absolute inset-0" style={{ background: color, animation: "rr-flash 600ms ease-out forwards" }} />
          <div
            className="absolute w-[160vmax] h-[160vmax]"
            style={{
              background: `repeating-conic-gradient(${color}55 0deg 6deg, transparent 6deg 18deg)`,
              animation: "rr-burst 1.4s ease-out forwards",
            }}
          />
          {big && <Confetti />}
        </>
      )}

      <div className="relative flex flex-col items-center gap-5 tiny:gap-2 text-center px-4">
        <div
          className="font-display text-white text-3xl sm:text-5xl tiny:text-2xl tracking-wider"
          style={{ animation: "rr-type 800ms steps(14) both", textShadow: "3px 3px 0 #E62429" }}
          data-testid="rank-reveal-heading"
        >
          YOUR RANK IS…
        </div>

        <div style={{ animation: phase === "spin" ? "rr-shake 120ms linear infinite" : phase === "reveal" ? "rr-slam 520ms cubic-bezier(.2,1.4,.4,1) both" : "none" }}>
          {phase === "intro" ? (
            <AnimatedRankIcon tier={-1} size={tiny ? 70 : 120} />
          ) : (
            <AnimatedRankIcon tier={phase === "reveal" ? tier : spinTier} division={phase === "reveal" ? row.rank_division : 3} size={tiny ? (phase === "reveal" ? 84 : 70) : (phase === "reveal" ? 150 : 120)} testid="rank-reveal-icon" />
          )}
        </div>

        {phase === "reveal" && (
          <div className="flex flex-col items-center gap-3 tiny:gap-1" style={{ animation: "rr-slam 600ms 120ms cubic-bezier(.2,1.4,.4,1) both" }}>
            <div
              className="font-display text-5xl sm:text-7xl tiny:text-4xl leading-none"
              style={{ color, WebkitTextStroke: "2px #0A0A0A", textShadow: "5px 5px 0 #0A0A0A" }}
              data-testid="rank-reveal-name"
            >
              {row.rank_name}{roman ? ` ${roman}` : ""}
            </div>
            <div className="font-anton uppercase tracking-widest text-white/80 text-sm" data-testid="rank-reveal-rp">{row.new_points ?? 0} RP</div>
            <button
              onClick={(e) => { e.stopPropagation(); onDone(); }}
              className="btn-pow bg-[#FFD700] text-black mt-2 [&]:py-2 tiny:[&]:py-1"
              data-testid="rank-reveal-continue"
            >
              <span className="font-anton uppercase tracking-widest">Continue</span>
            </button>
          </div>
        )}
        {phase !== "reveal" && (
          <div className="font-anton uppercase tracking-widest text-[10px] text-white/40" data-testid="rank-reveal-skip-hint">Tap to skip</div>
        )}
      </div>
    </div>
  );
}
