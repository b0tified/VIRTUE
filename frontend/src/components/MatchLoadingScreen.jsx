/* MatchLoadingScreen.jsx — full-bleed overlay shown for ~1.4s when a
   player navigates from lobby into a match (quick-play, ranked, party).

   Uses the existing LobbyBackground as a static-feeling backdrop with
   a darker scrim + comic burst rays on top + animated MATCH STARTING
   banner. Self-dismisses via an internal timer when `open` is true.

   Props:
     - open      bool      — show the overlay (caller sets true before nav).
     - mode      string    — "casual" | "ranked" | "party" — controls the
                             label + color of the title.
     - username  string    — current player username for the bottom-right
                             "ENTERING AS …" line.
*/
import { useEffect, useState } from "react";
import LobbyBackground from "@/components/LobbyBackground";
import { Loader2, Zap } from "lucide-react";

const MODE_LABELS = {
  casual:   { title: "QUICK MATCH",   accent: "#FFD700" },
  ranked:   { title: "RANKED MATCH",  accent: "#E62429" },
  party:    { title: "PARTY MATCH",   accent: "#0055FF" },
  offline:  { title: "PRACTICE",      accent: "#9B59B6" },
};

export default function MatchLoadingScreen({ open, mode = "casual", username }) {
  const [dots, setDots] = useState("");
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 280);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;
  const meta = MODE_LABELS[mode] || MODE_LABELS.casual;

  return (
    <div
      className="fixed inset-0 z-[9000] overflow-hidden flex items-center justify-center"
      data-testid="match-loading-screen"
    >
      {/* LobbyBackground as the static base — same comic environment so
          the transition into the match feels continuous with the lobby. */}
      <div className="absolute inset-0 pointer-events-none">
        <LobbyBackground />
      </div>
      {/* Dark scrim */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(10,10,10,0.6) 0%, rgba(10,10,10,0.9) 70%, rgba(0,0,0,0.95) 100%)",
        }}
      />
      {/* Comic burst rays behind the title */}
      <div
        className="absolute"
        style={{
          width: "180vmax",
          height: "180vmax",
          background:
            `repeating-conic-gradient(from 0deg at 50% 50%, ${meta.accent}33 0deg 4deg, transparent 4deg 14deg)`,
          animation: "match-loading-burst-spin 18s linear infinite",
          maskImage:
            "radial-gradient(circle at 50% 50%, transparent 12%, black 30%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 50%, transparent 12%, black 30%, transparent 70%)",
        }}
      />
      {/* Content stack */}
      <div className="relative flex flex-col items-center justify-center gap-6 px-4 text-center">
        {/* Title */}
        <div
          className="font-display text-pow-shadow-lg flex items-center gap-3 leading-none text-5xl sm:text-7xl"
          style={{
            color: "#FFFFFF",
            textShadow: `0 0 18px ${meta.accent}99, 5px 5px 0 #0A0A0A, -1px -1px 0 #0A0A0A`,
            animation: "match-loading-banner-pop 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
          data-testid="match-loading-title"
        >
          <Zap size={36} strokeWidth={4} className="text-[#FFD700]" fill="#FFD700" />
          {meta.title}
          <Zap size={36} strokeWidth={4} className="text-[#FFD700]" fill="#FFD700" />
        </div>
        {/* Status row */}
        <div
          className="flex items-center gap-3 font-anton uppercase tracking-widest text-white/90 text-sm"
          data-testid="match-loading-status"
        >
          <Loader2 size={16} strokeWidth={3} className="animate-spin" />
          <span>LOADING ARENA{dots}</span>
        </div>
        {/* Username line */}
        {username && (
          <div className="font-anton uppercase tracking-widest text-[10px] text-white/50">
            ENTERING AS <span className="text-white">{username}</span>
          </div>
        )}
      </div>
    </div>
  );
}
