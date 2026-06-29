/* Full-screen rank-up celebration overlay.

   Animation timeline (all driven by raw CSS keyframes for reliability):
     • 0.0s  → fade in dim background, "RANK UP!" / "PROMOTED" banner pops in.
     • 0.7s  → previous-tier crest brightens + SHATTERS outward (8 shards
               fly in a starburst), screen flashes white, ring expands.
     • 1.35s → new-tier crest assembles from blur+scale (with extra
               division-aware orbital animations baked into AnimatedRankIcon).
     • 2.0s  → star shower (24 falling Sparkles).
     • 6.5s  → auto-dismiss (4.5s for the lighter "division" variant).

   The `kind` prop switches between two visual flavors:
     • "tier" (default) — full main-tier promotion. Yellow "RANK UP!" banner
       with green chevrons, larger crest, longer timeline, big star shower.
     • "division" — sub-tier promotion (e.g. SILVER III → SILVER II). Smaller
       teal "PROMOTED" banner, the SAME crest icon on both sides but with
       the previous icon's division ornaments dissolving and the new (more
       elaborate) ornaments materialising in their place — so the change is
       carried by the icon's animation level, not the crest shape.

   Props:
     - open: boolean
     - prevTier: { idx, name, division? }
     - newTier:  { idx, name, division? }
     - rpDelta:  number
     - newPoints: number
     - kind: "tier" | "division"  (default "tier")
     - onClose: () => void
*/
import { useEffect, useRef, useState } from "react";
import { rankColorFor, divisionRoman } from "@/game/rankIcons";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import { Sparkles, ChevronUp } from "lucide-react";

export default function RankUpOverlay({ open, prevTier, newTier, rpDelta, newPoints, kind = "tier", onClose }) {
  // 0: enter, 1: shatter (prev crest explodes), 2: new assembled, 3: star shower
  const [phase, setPhase] = useState(0);
  const isDivision = kind === "division";
  // Keep the latest `onClose` in a ref so the timing effect (below) can
  // call it without listing onClose in its deps — that prop is recreated
  // on every parent render and previously caused the entire animation
  // to restart whenever the lobby re-polled (yanking the player back
  // to phase 0 mid-transition).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    setPhase(0);
    // Division-up uses a tighter, snappier timeline (the visual change is
    // smaller, so the player doesn't need as long to read it).
    const tShatter   = isDivision ? 500  : 700;
    const tAssemble  = isDivision ? 950  : 1350;
    const tStars     = isDivision ? 1450 : 2000;
    const tDismiss   = isDivision ? 4500 : 6500;
    const t1 = setTimeout(() => setPhase(1), tShatter);
    const t2 = setTimeout(() => setPhase(2), tAssemble);
    const t3 = setTimeout(() => setPhase(3), tStars);
    const auto = setTimeout(() => onCloseRef.current?.(), tDismiss);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(auto);
    };
  }, [open, isDivision]);
  if (!open || !newTier || !prevTier) return null;
  const prevIdx = prevTier.idx ?? 0;
  const newIdx = newTier.idx ?? 0;
  const newColor = rankColorFor(newIdx) || "#FFD700";
  const prevColor = rankColorFor(prevIdx) || "#FFD700";
  const prevDiv = prevTier.division ?? 0;
  const newDiv = newTier.division ?? 0;
  // Division-up uses a calmer teal accent + smaller crest so it doesn't
  // upstage the main-tier promotions.
  const bannerColor = isDivision ? "#5BC0EB" : "#FFD700";
  const bannerText = isDivision ? "PROMOTED" : "RANK UP!";
  const crestSize = isDivision ? "w-[200px] h-[200px] sm:w-[240px] sm:h-[240px]" : "w-[260px] h-[260px] sm:w-[320px] sm:h-[320px]";
  const innerCrestPx = isDivision ? 130 : 170;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center cursor-pointer"
      onClick={onClose}
      data-testid="rankup-overlay"
      data-phase={phase}
      data-kind={kind}
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

      {/* White flash on shatter beat. */}
      {phase >= 1 && phase < 2 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(circle at 50% 45%, #ffffff 0%, transparent 55%)",
            animation: "rankup-flash 0.6s ease-out forwards",
            mixBlendMode: "screen",
          }}
        />
      )}

      {/* Star shower (phase 3) — fewer stars for division-ups so it reads
          as a smaller celebration. */}
      {phase >= 3 && (
        <div className="absolute inset-0 pointer-events-none" data-testid="rankup-stars">
          {[...Array(isDivision ? 12 : 24)].map((_, i) => {
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
        {/* Banner — text + color swap by kind. */}
        <div
          className={`font-display ${isDivision ? "text-4xl sm:text-6xl" : "text-5xl sm:text-7xl"} text-pow-shadow-lg flex items-center gap-3`}
          style={{
            color: bannerColor,
            animation: "rankup-banner-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
          data-testid="rankup-banner"
        >
          <ChevronUp size={isDivision ? 36 : 48} strokeWidth={4} className="text-[#06A35F]" />
          {bannerText}
          <ChevronUp size={isDivision ? 36 : 48} strokeWidth={4} className="text-[#06A35F]" />
        </div>

        {/* Crest transition area: previous shatters, new assembles. */}
        <div className={`relative my-6 sm:my-8 ${crestSize}`}>
          {/* Expanding ring shockwave during shatter beat. */}
          {phase >= 1 && phase < 3 && (
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: `6px solid ${newColor}`,
                animation: "rankup-ring-out 1.4s ease-out forwards",
                pointerEvents: "none",
                boxShadow: `0 0 24px ${newColor}aa`,
              }}
              data-testid="rankup-ring"
            />
          )}

          {/* Previous-tier crest — visible at phase 0, shatters at phase 1, gone by phase 2. */}
          {phase < 2 && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                animation: phase >= 1
                  ? "rankup-prev-shatter 0.7s ease-in forwards"
                  : "rankup-prev-in 0.45s ease-out both",
              }}
              data-testid="rankup-prev-shield"
            >
              <RankShield tier={prevIdx} division={prevDiv} color={prevColor} faded={false} sizePx={innerCrestPx} />
              <div className="absolute bottom-[-32px] font-anton uppercase tracking-widest text-sm text-neutral-400">
                {(prevTier.name || "BRONZE") + (divisionRoman(prevDiv) ? ` ${divisionRoman(prevDiv)}` : "")}
              </div>
            </div>
          )}

          {/* Shatter shards — 10 sparkles flying out in a starburst on phase 1. */}
          {phase >= 1 && phase < 2 && (
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(10)].map((_, i) => {
                const angle = (i * 36) * (Math.PI / 180);
                const dist = 120 + ((i * 7) % 60);
                return (
                  <Sparkles
                    key={i}
                    size={18 + (i % 3) * 4}
                    strokeWidth={3}
                    color={prevColor}
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      "--shard-tx": `${Math.cos(angle) * dist}px`,
                      "--shard-ty": `${Math.sin(angle) * dist}px`,
                      "--shard-rot": `${((i * 47) % 360)}deg`,
                      animation: `rankup-shard-fly 0.7s ${i * 0.02}s ease-out forwards`,
                      filter: `drop-shadow(0 0 6px ${prevColor})`,
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* New-tier crest — assembles on phase 2. */}
          {phase >= 2 && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                animation: "rankup-new-assemble 0.85s cubic-bezier(0.16, 1.4, 0.3, 1) both",
              }}
              data-testid="rankup-new-shield"
            >
              <RankShield tier={newIdx} division={newDiv} color={newColor} sizePx={innerCrestPx} />
              <div
                className="absolute bottom-[-32px] font-anton uppercase tracking-widest text-base sm:text-lg"
                style={{
                  color: newColor,
                  textShadow: `0 0 12px ${newColor}88`,
                }}
              >
                {(newTier.name || "BRONZE") + (divisionRoman(newDiv) ? ` ${divisionRoman(newDiv)}` : "")}
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

function RankShield({ tier, division, color, faded = false, sizePx = 170 }) {
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
        <AnimatedRankIcon
          tier={tier}
          division={division}
          size={sizePx}
          testid="rankup-crest-icon"
        />
      </div>
    </div>
  );
}
