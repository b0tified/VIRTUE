/* Comic-style death animation.

   Triggered by a `died` event from the engine when the local player
   transitions alive → dead. Plays a one-shot red-burst K.O. banner that
   overlays for ~1.4s, then yields back to the regular Hud "YOU'RE DOWN!"
   death screen (which stays until respawn).

   Effects:
     - Red flash that fades to transparent.
     - Halftone red burst lines expanding outward.
     - "K.O.!" comic banner pops in with a hard shake.
     - Cracked-glass radial vignette darkens screen edges.

   Props:
     - trigger: number | null    — Date.now() timestamp of the latest death.
                                   Changing this value (re)plays the animation.
*/
import { useEffect, useState } from "react";
import { Skull, Zap } from "lucide-react";

export default function DeathOverlay({ trigger }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!trigger) return;
    setActive(true);
    const t = setTimeout(() => setActive(false), 1400);
    return () => clearTimeout(t);
  }, [trigger]);
  if (!active) return null;
  return (
    <div
      className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center overflow-hidden"
      data-testid="death-anim-overlay"
    >
      {/* Red shock flash — saturates the screen briefly */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,40,40,0.9) 0%, rgba(160,0,0,0.55) 40%, rgba(0,0,0,0.0) 75%)",
          animation: "death-flash 0.9s ease-out forwards",
        }}
      />

      {/* Vignette that lingers under the K.O. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, transparent 30%, rgba(0,0,0,0.55) 75%, rgba(0,0,0,0.9) 100%)",
          animation: "death-vignette 1.4s ease-out forwards",
        }}
      />

      {/* Comic red burst lines */}
      <div
        className="absolute"
        style={{
          width: "140vmax",
          height: "140vmax",
          background:
            "repeating-conic-gradient(from 0deg at 50% 50%, #E6242966 0deg 4deg, transparent 4deg 18deg)",
          animation: "death-burst-spin 1.4s linear forwards",
          maskImage:
            "radial-gradient(circle at 50% 50%, transparent 10%, black 28%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 50%, transparent 10%, black 28%, transparent 70%)",
        }}
      />

      {/* K.O.! comic banner — heavy shake */}
      <div
        className="relative font-display text-7xl sm:text-8xl flex items-center gap-4"
        style={{
          color: "#FFFFFF",
          textShadow:
            "0 0 18px rgba(230,36,41,0.9), 5px 5px 0 #0A0A0A, -1px -1px 0 #0A0A0A",
          animation: "death-banner-pop 1.4s cubic-bezier(0.16, 1.4, 0.3, 1) forwards",
        }}
        data-testid="death-banner"
      >
        <Skull size={56} strokeWidth={3} className="text-[#E62429]" fill="#E62429" />
        K.O.!
        <Skull size={56} strokeWidth={3} className="text-[#E62429]" fill="#E62429" />
      </div>

      {/* Sub-banner: lightning + label */}
      <div
        className="absolute mt-44 font-anton uppercase tracking-[0.4em] text-sm sm:text-base text-white/85 flex items-center gap-2"
        style={{
          animation: "death-sub-fade 1.4s ease-out 0.25s forwards",
          opacity: 0,
          textShadow: "0 2px 0 #0A0A0A",
        }}
        data-testid="death-sub-banner"
      >
        <Zap size={16} strokeWidth={3} className="text-[#FFD700]" fill="#FFD700" />
        ELIMINATED
        <Zap size={16} strokeWidth={3} className="text-[#FFD700]" fill="#FFD700" />
      </div>
    </div>
  );
}
