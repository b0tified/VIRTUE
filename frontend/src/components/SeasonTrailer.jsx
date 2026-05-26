/* SeasonTrailer — pre-match cinematic intro that plays once before the
   game canvas mounts. Currently used to tease "SEASON 2" with a mini
   meteor smashing into the arena.

   Implementation is intentionally CSS/divs only — no Three.js scene, no
   audio loading. The meteor is a glowing orb with a stretched flame
   trail rotating + translating diagonally across the screen. When it
   "impacts" the centre we crossfade a white flash, a comic K.O.-style
   shockwave ring, and the SEASON 2 wordmark with our existing pow
   shadow + halftone backdrop.

   Total duration: ~4.6s. `onComplete()` fires on unmount, which the
   parent uses to dismiss + continue to the game.

   Skippable: any click/key dismisses early so it never blocks gameplay
   if the admin sees it twice in a row. */
import { useEffect, useRef } from "react";
import audioBus from "@/game/audio";

export default function SeasonTrailer({ onComplete, durationMs = 4600 }) {
  const completedRef = useRef(false);
  const finish = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  };

  useEffect(() => {
    // Auto-complete after the full animation.
    const t = setTimeout(finish, durationMs);
    // Click/keypress = skip.
    const skip = () => finish();
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("click", skip, { once: true });
    // Impact thunder — reuses the existing thunder SFX at impact time.
    const thunder = setTimeout(() => {
      try { audioBus.thunder?.(); } catch {}
    }, 1700);
    return () => {
      clearTimeout(t);
      clearTimeout(thunder);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("click", skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] overflow-hidden bg-black select-none"
      style={{ animation: "trailer-fade-out 0.5s ease-out forwards", animationDelay: `${durationMs - 500}ms` }}
      data-testid="season-trailer"
    >
      {/* Starfield + halftone backdrop. Pure CSS radial gradients so we
          don't ship an extra asset. */}
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, #1a1240 0%, #03081f 55%, #000000 100%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 8% 12%, rgba(255,255,255,0.7) 0 1px, transparent 2px)," +
            "radial-gradient(circle at 22% 38%, rgba(255,255,255,0.55) 0 1px, transparent 2px)," +
            "radial-gradient(circle at 71% 14%, rgba(255,255,255,0.6) 0 1px, transparent 2px)," +
            "radial-gradient(circle at 86% 41%, rgba(255,255,255,0.5) 0 1px, transparent 2px)," +
            "radial-gradient(circle at 14% 78%, rgba(255,255,255,0.6) 0 1px, transparent 2px)," +
            "radial-gradient(circle at 60% 88%, rgba(255,255,255,0.55) 0 1px, transparent 2px)",
          backgroundSize: "cover",
        }}
      />

      {/* Mini meteor — glowing orb with stretched fire trail. Travels
          diagonally from top-right to centre over 1.7s. */}
      <div
        className="absolute"
        data-testid="season-trailer-meteor"
        style={{
          top: "0%",
          left: "0%",
          width: 0,
          height: 0,
          animation: "trailer-meteor-fly 1.7s cubic-bezier(0.4, 0.0, 0.4, 0.7) forwards",
        }}
      >
        {/* Trail (long stretched glow behind the meteor) */}
        <div
          style={{
            position: "absolute",
            width: 380,
            height: 26,
            transform: "translate(-380px, -13px) rotate(0deg)",
            background:
              "linear-gradient(90deg, rgba(255,180,40,0) 0%, rgba(255,180,40,0.4) 30%, rgba(255,230,120,0.85) 75%, rgba(255,255,255,1) 100%)",
            filter: "blur(6px)",
            borderRadius: 999,
          }}
        />
        {/* Meteor core */}
        <div
          style={{
            position: "absolute",
            width: 56,
            height: 56,
            transform: "translate(-28px, -28px)",
            background:
              "radial-gradient(circle at 30% 30%, #fff7a0 0%, #ffd246 35%, #ff7a1e 65%, #6b1a0a 100%)",
            borderRadius: 999,
            boxShadow: "0 0 36px 12px rgba(255, 180, 40, 0.85), 0 0 80px 24px rgba(255, 100, 0, 0.45)",
            border: "2px solid #2a1300",
          }}
        />
      </div>

      {/* Impact flash — fires for 250ms at the moment of contact. */}
      <div
        className="absolute inset-0 bg-white pointer-events-none"
        style={{
          opacity: 0,
          animation: "trailer-impact-flash 0.25s ease-out 1.65s forwards",
        }}
      />

      {/* Shockwave rings expanding from impact point. */}
      <div
        className="absolute left-1/2 top-1/2 pointer-events-none"
        style={{
          width: 80,
          height: 80,
          marginLeft: -40,
          marginTop: -40,
          border: "6px solid #FFD700",
          borderRadius: 999,
          opacity: 0,
          animation: "trailer-shockwave 1.6s ease-out 1.7s forwards",
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 pointer-events-none"
        style={{
          width: 80,
          height: 80,
          marginLeft: -40,
          marginTop: -40,
          border: "4px solid #E62429",
          borderRadius: 999,
          opacity: 0,
          animation: "trailer-shockwave 1.8s ease-out 1.9s forwards",
        }}
      />

      {/* Crater scorch — radial gradient growing from centre. */}
      <div
        className="absolute left-1/2 top-1/2 pointer-events-none"
        style={{
          width: 600,
          height: 600,
          marginLeft: -300,
          marginTop: -300,
          background:
            "radial-gradient(circle, rgba(255,200,60,0.85) 0%, rgba(255,90,10,0.55) 25%, rgba(60,10,0,0.4) 55%, transparent 80%)",
          filter: "blur(8px)",
          opacity: 0,
          transform: "scale(0.2)",
          animation: "trailer-crater 1.4s ease-out 1.7s forwards",
        }}
      />

      {/* SEASON 2 wordmark — drops in after impact with comic pow shadow. */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{
          opacity: 0,
          animation: "trailer-title-in 0.6s cubic-bezier(0.4, 1.6, 0.6, 1) 2.0s forwards",
        }}
      >
        <div className="text-center">
          <div
            className="font-display text-pow-shadow-lg leading-none"
            style={{
              fontSize: "clamp(48px, 12vw, 180px)",
              color: "#FFD700",
              letterSpacing: "0.03em",
              textShadow:
                "4px 6px 0 rgba(0,0,0,0.95), 0 0 30px rgba(255, 200, 80, 0.55)",
            }}
            data-testid="season-trailer-title"
          >
            SEASON
          </div>
          <div
            className="font-display leading-none mt-2"
            style={{
              fontSize: "clamp(96px, 22vw, 360px)",
              color: "#E62429",
              letterSpacing: "0.02em",
              textShadow:
                "6px 8px 0 rgba(0,0,0,0.95), 0 0 40px rgba(230, 36, 41, 0.55)",
            }}
          >
            2
          </div>
          <div
            className="font-anton uppercase tracking-widest text-base sm:text-lg mt-4"
            style={{ color: "#FFD700", opacity: 0.85 }}
          >
            ARRIVES NOW
          </div>
        </div>
      </div>

      {/* Skip hint, faint bottom-right. */}
      <div className="absolute bottom-4 right-4 font-anton uppercase tracking-widest text-xs text-white/40">
        click to skip
      </div>
    </div>
  );
}
