/* MatchLoadingScreen.jsx — global match transition overlay mounted at
   the App root so it survives the Lobby → /play route change.

   Lifecycle (event-driven, no `open` prop):
     1. `virtue-match-loading` fires (from QueueContext or navigateToMatch).
        Overlay mounts, shows a RANDOMLY-PICKED map preview while waiting.
     2. `virtue-match-loaded` fires from Game.jsx onMessage when the WS
        welcome arrives with the actual arena. Overlay swaps to the real
        map (with a "CONFIRMED: MAP_NAME" reveal animation) for ~900ms,
        then dismisses.
     3. Safety net: if `virtue-match-loaded` never arrives (network fail),
        the overlay auto-dismisses after 6s so the user isn't stuck.

   Event payloads:
     virtue-match-loading: { mode, username }
     virtue-match-loaded:  { map_id, map_name }
*/
import { useEffect, useRef, useState } from "react";
import LobbyBackground from "@/components/LobbyBackground";
import MapPreview from "@/components/MapPreview";
import { MAPS_META, pickRandomMapMeta } from "@/game/mapsMeta";
import { Loader2, Zap, Check } from "lucide-react";

const MODE_LABELS = {
  casual:   { title: "QUICK MATCH",   accent: "#FFD700" },
  ranked:   { title: "RANKED MATCH",  accent: "#E62429" },
  party:    { title: "PARTY MATCH",   accent: "#0055FF" },
  offline:  { title: "PRACTICE",      accent: "#9B59B6" },
};

const SAFETY_DISMISS_MS = 6000;     // hard fallback if welcome never arrives
const REVEAL_HOLD_MS    = 900;      // how long the "CONFIRMED" screen lingers

export default function MatchLoadingScreen() {
  const [phase, setPhase] = useState("idle"); // 'idle' | 'loading' | 'confirmed'
  const [mode, setMode] = useState("casual");
  const [username, setUsername] = useState(null);
  const [previewMap, setPreviewMap] = useState(null); // pre-welcome guess
  const [actualMap, setActualMap]   = useState(null); // post-welcome truth
  const [dots, setDots] = useState("");
  const safetyTimerRef = useRef(null);
  const dismissTimerRef = useRef(null);

  const clearTimers = () => {
    if (safetyTimerRef.current)  { clearTimeout(safetyTimerRef.current);  safetyTimerRef.current = null; }
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
  };

  // virtue-match-loading: enter loading phase, pick a random preview map.
  useEffect(() => {
    const onLoading = (e) => {
      const m = e?.detail?.mode || "casual";
      setMode(m);
      setUsername(e?.detail?.username || null);
      setPreviewMap(pickRandomMapMeta());
      setActualMap(null);
      setPhase("loading");
      clearTimers();
      safetyTimerRef.current = setTimeout(() => setPhase("idle"), SAFETY_DISMISS_MS);
    };
    window.addEventListener("virtue-match-loading", onLoading);
    return () => window.removeEventListener("virtue-match-loading", onLoading);
  }, []);

  // virtue-match-loaded: reveal the real map briefly, then dismiss.
  useEffect(() => {
    const onLoaded = (e) => {
      const mid = e?.detail?.map_id;
      const meta = mid ? MAPS_META.find((m) => m.map_id === mid) : null;
      setActualMap(meta || null);
      setPhase("confirmed");
      clearTimers();
      dismissTimerRef.current = setTimeout(() => setPhase("idle"), REVEAL_HOLD_MS);
    };
    window.addEventListener("virtue-match-loaded", onLoaded);
    return () => window.removeEventListener("virtue-match-loaded", onLoaded);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => () => clearTimers(), []);

  // Animated dots (only while loading, not during the confirmed reveal).
  useEffect(() => {
    if (phase !== "loading") return;
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 280);
    return () => clearInterval(id);
  }, [phase]);

  if (phase === "idle") return null;
  const meta = MODE_LABELS[mode] || MODE_LABELS.casual;
  const showMap = phase === "confirmed" && actualMap ? actualMap : previewMap;
  // Did the preview match the actual map? Used to colour the reveal badge.
  const matched = phase === "confirmed" && actualMap && previewMap && actualMap.map_id === previewMap.map_id;

  return (
    <div
      className="fixed inset-0 z-[9000] overflow-hidden flex items-center justify-center"
      data-testid="match-loading-screen"
      data-phase={phase}
    >
      <div className="absolute inset-0 pointer-events-none">
        <LobbyBackground />
      </div>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(10,10,10,0.6) 0%, rgba(10,10,10,0.9) 70%, rgba(0,0,0,0.95) 100%)",
        }}
      />
      <div
        className="absolute"
        style={{
          width: "180vmax",
          height: "180vmax",
          background:
            `repeating-conic-gradient(from 0deg at 50% 50%, ${meta.accent}33 0deg 4deg, transparent 4deg 14deg)`,
          animation: "match-loading-burst-spin 18s linear infinite",
          maskImage: "radial-gradient(circle at 50% 50%, transparent 12%, black 30%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 50%, transparent 12%, black 30%, transparent 70%)",
        }}
      />
      <div className="relative flex flex-col items-center justify-center gap-5 px-4 text-center">
        <div
          className="font-display text-pow-shadow-lg flex items-center gap-3 leading-none text-4xl sm:text-6xl"
          style={{
            color: "#FFFFFF",
            textShadow: `0 0 18px ${meta.accent}99, 5px 5px 0 #0A0A0A, -1px -1px 0 #0A0A0A`,
            animation: "match-loading-banner-pop 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
          data-testid="match-loading-title"
        >
          <Zap size={32} strokeWidth={4} className="text-[#FFD700]" fill="#FFD700" />
          {meta.title}
          <Zap size={32} strokeWidth={4} className="text-[#FFD700]" fill="#FFD700" />
        </div>

        {showMap && (
          <div
            className="flex flex-col items-center gap-2"
            style={{ animation: "match-loading-banner-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 120ms both" }}
            data-testid="match-loading-map"
            key={showMap.map_id /* re-mount on map swap so the pop-in re-fires */}
          >
            <MapPreview map={showMap} size={260} />
            <div className="flex items-center gap-2 font-anton uppercase tracking-widest text-white/60 text-[10px]">
              <span>MAP</span>
              <span
                className="text-white text-base"
                style={{ textShadow: `0 0 8px ${showMap.palette?.obstacle || "#fff"}cc, 2px 2px 0 #0A0A0A` }}
                data-testid="match-loading-map-name"
              >
                {showMap.name}
              </span>
            </div>
            <div className="font-anton uppercase tracking-widest text-[10px] text-white/45 max-w-xs">
              {showMap.tagline}
            </div>
          </div>
        )}

        {/* Status row — loading spinner OR a "CONFIRMED" badge once welcome arrives. */}
        {phase === "loading" ? (
          <div
            className="flex items-center gap-3 font-anton uppercase tracking-widest text-white/90 text-sm"
            data-testid="match-loading-status"
          >
            <Loader2 size={16} strokeWidth={3} className="animate-spin" />
            <span>LOADING ARENA{dots}</span>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 px-3 py-1.5 border-2 border-black"
            style={{
              background: matched ? "#06A35F" : "#FFD700",
              color: matched ? "#FFFFFF" : "#0A0A0A",
              animation: "match-loading-banner-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both",
            }}
            data-testid="match-loading-confirmed"
          >
            <Check size={16} strokeWidth={4} />
            <span className="font-anton uppercase tracking-widest text-sm">
              {matched ? "CONFIRMED" : "MAP LOCKED"}
              {actualMap ? ` · ${actualMap.name}` : ""}
            </span>
          </div>
        )}

        {username && (
          <div className="font-anton uppercase tracking-widest text-[10px] text-white/50">
            ENTERING AS <span className="text-white">{username}</span>
          </div>
        )}
      </div>
    </div>
  );
}
