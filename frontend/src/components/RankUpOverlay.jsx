/* Full-screen rank-up celebration overlay.

   Shown after a ranked match end when the player crossed a tier threshold.
   Uses raw CSS keyframes (no Motion library needed) so it stays light and
   reliable. The overlay is dismissable by clicking anywhere or via the
   bottom button; auto-dismisses after 6s.

   Props:
     - open: boolean
     - prevTier: { idx, name }       — tier they had before the match
     - newTier:  { idx, name }       — tier they now hold
     - rpDelta:   number             — RP gained (positive)
     - newPoints: number             — RP total after change
     - onClose: () => void
*/
import { useEffect, useState } from "react";
import { rankIconFor, rankColorFor } from "@/game/rankIcons";
import { Sparkles, ChevronUp } from "lucide-react";

export default function RankUpOverlay({ open, prevTier, newTier, rpDelta, newPoints, onClose }) {
  const [phase, setPhase] = useState(0); // 0: enter, 1: swap, 2: shower
  useEffect(() => {
    if (!open) return;
    setPhase(0);
    const t1 = setTimeout(() => setPhase(1), 700);   // swap shield
    const t2 = setTimeout(() => setPhase(2), 1400);  // shower of stars
    const auto = setTimeout(() => onClose?.(), 6500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(auto);
    };
  }, [open, onClose]);
  if (!open || !newTier || !prevTier) return null;
  const PrevIcon = rankIconFor(prevTier.idx ?? 0);
  const NewIcon = rankIconFor(newTier.idx ?? 0);
  const newColor = rankColorFor(newTier.idx ?? 0) || "#FFD700";
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center cursor-pointer"
      onClick={onClose}
      data-testid="rankup-overlay"
      data-phase={phase}
      style={{
        background:
          "radial-gradient(circle at 50% 40%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.92) 70%)",
        animation: "rankup-fade-in 0.4s ease-out both",
      }}
    >
      {/* Comic burst lines behind the shield */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            `repeating-conic-gradient(from 0deg at 50% 45%, ${newColor}22 0deg 6deg, transparent 6deg 18deg)`,
          opacity: phase >= 1 ? 1 : 0.4,
          transition: "opacity 0.5s ease",
          animation: "rankup-burst-spin 18s linear infinite",
          maskImage:
            "radial-gradient(circle at 50% 45%, black 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 45%, black 0%, transparent 70%)",
        }}
      />

      {/* Star shower (phase 2) */}
      {phase >= 2 && (
        <div className="absolute inset-0 pointer-events-none" data-testid="rankup-stars">
          {[...Array(24)].map((_, i) => {
            const left = (i * 137.5) % 100;
            const delay = (i * 0.07) % 1.4;
            const size = 10 + ((i * 13) % 18);
            return (
              <Sparkles
                key={i}
                size={size}
                strokeWidth={3}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  top: "-10%",
                  color: i % 3 === 0 ? "#FFD700" : i % 3 === 1 ? "#E62429" : "#0055FF",
                  animation: `rankup-star-fall 2.4s ${delay}s ease-in forwards`,
                  filter: "drop-shadow(0 0 4px rgba(255,255,255,0.6))",
                }}
              />
            );
          })}
        </div>
      )}

      {/* Main card */}
      <div
        className="relative z-10 flex flex-col items-center select-none px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* "RANK UP!" comic banner */}
        <div
          className="font-display text-5xl sm:text-7xl text-pow-shadow-lg flex items-center gap-3"
          style={{
            color: "#FFD700",
            animation: "rankup-banner-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
          data-testid="rankup-banner"
        >
          <ChevronUp size={48} strokeWidth={4} className="text-[#06A35F]" />
          RANK UP!
          <ChevronUp size={48} strokeWidth={4} className="text-[#06A35F]" />
        </div>

        {/* Shield swap: previous tier slides out left → new tier zooms in */}
        <div className="relative my-8 sm:my-10 w-[260px] h-[260px] sm:w-[320px] sm:h-[320px]">
          {/* Previous tier shield — fades out + slides left on phase 1 */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              animation: phase >= 1
                ? "rankup-prev-out 0.55s ease-in forwards"
                : "rankup-prev-in 0.45s ease-out both",
            }}
            data-testid="rankup-prev-shield"
          >
            <RankShield Icon={PrevIcon} color={rankColorFor(prevTier.idx ?? 0)} faded />
            <div className="absolute bottom-[-32px] font-anton uppercase tracking-widest text-sm text-neutral-500">
              {prevTier.name || "BRONZE"}
            </div>
          </div>

          {/* New tier shield — zooms in on phase 1 */}
          {phase >= 1 && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                animation: "rankup-new-in 0.7s cubic-bezier(0.16, 1.4, 0.3, 1) both",
              }}
              data-testid="rankup-new-shield"
            >
              <RankShield Icon={NewIcon} color={newColor} />
              <div
                className="absolute bottom-[-32px] font-anton uppercase tracking-widest text-base sm:text-lg"
                style={{
                  color: newColor,
                  textShadow: `0 0 12px ${newColor}88`,
                }}
              >
                {newTier.name || "BRONZE"}
              </div>
            </div>
          )}
        </div>

        {/* RP delta + new total */}
        <div className="mt-6 sm:mt-8 flex items-center gap-3 flex-wrap justify-center">
          {Number.isFinite(rpDelta) && rpDelta > 0 && (
            <div
              className="border-pow shadow-pow-sm px-3 py-1 bg-[#06A35F] text-white font-anton uppercase tracking-widest text-sm sm:text-base"
              data-testid="rankup-rp-delta"
            >
              +{rpDelta} RP
            </div>
          )}
          {Number.isFinite(newPoints) && (
            <div
              className="border-pow shadow-pow-sm px-3 py-1 bg-black text-white font-anton uppercase tracking-widest text-sm sm:text-base"
              data-testid="rankup-new-total"
            >
              {newPoints} RP total
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-8 btn-pow bg-white text-black [&]:px-6 [&]:py-2 [&]:text-base"
          data-testid="rankup-continue"
        >
          CONTINUE
        </button>
      </div>
    </div>
  );
}

function RankShield({ Icon, color, faded = false }) {
  const c = color || "#FFD700";
  return (
    <div
      className="relative w-full h-full flex items-center justify-center"
      style={{ opacity: faded ? 0.45 : 1 }}
    >
      {/* Outer glow ring */}
      <div
        className="absolute inset-0 rounded-[28%]"
        style={{
          background: `radial-gradient(circle, ${c}55 0%, transparent 65%)`,
          filter: "blur(20px)",
        }}
      />
      {/* Shield body — POW outlined box */}
      <div
        className="relative w-[78%] h-[78%] border-pow shadow-pow-sm flex items-center justify-center"
        style={{
          background: `linear-gradient(160deg, ${c}, ${c}aa)`,
          transform: "rotate(-3deg)",
        }}
      >
        <Icon
          size={120}
          strokeWidth={3}
          color="#0A0A0A"
          style={{ filter: "drop-shadow(0 4px 0 rgba(0,0,0,0.35))" }}
        />
      </div>
    </div>
  );
}
