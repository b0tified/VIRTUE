/* Comic-style respawn animation.

   Triggered by a `respawn` event from the engine when the local player
   transitions from dead → alive. Shows for ~1.1s and self-dismisses.

   Effects:
     - Flash of white that fades to transparent (revive shock).
     - Halftone burst rings expanding outward from the center.
     - "RESPAWN!" comic banner pops in with a slight overshoot.
     - Sparkle ring of stars rotates briefly.

   Props:
     - trigger: number | null    — timestamp (Date.now()) of the last respawn.
                                   Changing this value plays the animation.
*/
import { useEffect, useState } from "react";
import { Zap, Sparkles } from "lucide-react";

export default function RespawnOverlay({ trigger }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!trigger) return;
    setActive(true);
    const t = setTimeout(() => setActive(false), 1100);
    return () => clearTimeout(t);
  }, [trigger]);
  if (!active) return null;
  return (
    <div
      className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center overflow-hidden"
      data-testid="respawn-overlay"
    >
      {/* Revive flash — white wash that fades fast */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.35) 28%, rgba(0,0,0,0) 68%)",
          animation: "respawn-flash 0.7s ease-out forwards",
        }}
      />

      {/* Comic burst lines (rotating conic gradient) */}
      <div
        className="absolute"
        style={{
          width: "120vmax",
          height: "120vmax",
          background:
            "repeating-conic-gradient(from 0deg at 50% 50%, #FFD70033 0deg 4deg, transparent 4deg 14deg)",
          animation: "respawn-burst-spin 1.1s linear forwards",
          maskImage:
            "radial-gradient(circle at 50% 50%, black 8%, transparent 55%)",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 50%, black 8%, transparent 55%)",
        }}
      />

      {/* Expanding ring */}
      <div
        className="absolute rounded-full border-[6px] border-[#0055FF]"
        style={{
          width: 80,
          height: 80,
          animation: "respawn-ring-out 0.9s ease-out forwards",
          boxShadow: "0 0 30px #0055FF, inset 0 0 20px #0055FFaa",
        }}
      />
      <div
        className="absolute rounded-full border-[4px] border-[#E62429]"
        style={{
          width: 80,
          height: 80,
          animation: "respawn-ring-out 0.9s 0.15s ease-out forwards",
          opacity: 0,
          boxShadow: "0 0 24px #E62429, inset 0 0 16px #E62429aa",
        }}
      />

      {/* Sparkles ring */}
      <div className="absolute" style={{ animation: "respawn-sparkles-spin 1.1s linear forwards" }}>
        {[...Array(8)].map((_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          const r = 110;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          return (
            <Sparkles
              key={i}
              size={20}
              strokeWidth={3}
              style={{
                position: "absolute",
                left: x,
                top: y,
                color: i % 2 === 0 ? "#FFD700" : "#FFFFFF",
                filter: "drop-shadow(0 0 6px rgba(255,255,255,0.8))",
                animation: "respawn-sparkle-pop 0.9s ease-out forwards",
              }}
            />
          );
        })}
      </div>

      {/* RESPAWN! comic banner */}
      <div
        className="relative font-display text-6xl sm:text-7xl text-pow-shadow-lg flex items-center gap-3"
        style={{
          color: "#FFFFFF",
          textShadow:
            "0 0 14px rgba(0,85,255,0.85), 4px 4px 0 #0A0A0A, -1px -1px 0 #0A0A0A",
          animation: "respawn-banner-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        }}
        data-testid="respawn-banner"
      >
        <Zap size={42} strokeWidth={4} className="text-[#FFD700]" fill="#FFD700" />
        RESPAWN!
        <Zap size={42} strokeWidth={4} className="text-[#FFD700]" fill="#FFD700" />
      </div>
    </div>
  );
}
