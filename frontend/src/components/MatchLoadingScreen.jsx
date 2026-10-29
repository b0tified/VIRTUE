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
import useTinyScreen from "@/hooks/useTinyScreen";
import { useModeNames, modeName } from "@/lib/modeNames";

const MODE_LABELS = {
  casual:   { get title() { return modeName("casual").toUpperCase(); },  accent: "#FFD700" },
  ranked:   { get title() { return `${modeName("ranked").toUpperCase()} MATCH`; }, accent: "#E62429" },
  party:    { get title() { return `${modeName("party").toUpperCase()} MATCH`; },  accent: "#0055FF" },
  offline:  { get title() { return modeName("practice").toUpperCase(); }, accent: "#9B59B6" },
};

// Sub-headline rendered under the big mode title. Drives directly from
// the server-confirmed `game_mode` payload that arrives with `welcome`.
// Before welcome we show a placeholder ("DEPLOYING...") for quick-match
// (which can roll FFA or TDM server-side) and the known mode for
// everything else (ranked = always FFA, practice = client picks TDM).
const GAME_MODE_LABELS = {
  ffa: { label: "FREE-FOR-ALL · LOBBY OF 4", short: "FFA" },
  tdm: { label: "TEAM DEATHMATCH · 4V4",     short: "TDM" },
};

const SAFETY_DISMISS_MS = 8000;     // hard fallback if welcome never arrives
const REVEAL_HOLD_MS    = 900;      // how long the "CONFIRMED" screen lingers

export default function MatchLoadingScreen() {
  useModeNames();
  const [phase, setPhase] = useState("idle"); // 'idle' | 'loading' | 'confirmed'
  const [mode, setMode] = useState("casual");
  const [username, setUsername] = useState(null);
  // Hint from the caller about the game mode (e.g. practice TDM passes
  // `tdm: true`). Used as the initial sub-headline before welcome
  // confirms. Quick-match leaves this null (server rolls FFA or TDM).
  const [gameModeHint, setGameModeHint] = useState(null);
  // Authoritative `game_mode` from the server welcome — overrides
  // `gameModeHint` once we know for sure.
  const [serverGameMode, setServerGameMode] = useState(null);
  const [previewMap, setPreviewMap] = useState(null); // pre-welcome guess
  const [actualMap, setActualMap]   = useState(null); // post-welcome truth
  const [dots, setDots] = useState("");
  const safetyTimerRef = useRef(null);
  const dismissTimerRef = useRef(null);
  const tiny = useTinyScreen();

  const clearTimers = () => {
    if (safetyTimerRef.current)  { clearTimeout(safetyTimerRef.current);  safetyTimerRef.current = null; }
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
  };

  // virtue-match-loading: enter loading phase, pick a random preview map.
  // Guard: once phase went through the full loading→confirmed→idle cycle
  // AND the user is inside a match route, IGNORE further loading events.
  // Without this, any stray/orphaned queue-poll re-firing the event
  // (e.g. a leftover casual poll interval after a race) would resurrect
  // the loading overlay ON TOP of live gameplay.
  const phaseRef = useRef(phase);
  const consumedRef = useRef(false);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => {
    const onLoading = (e) => {
      const inMatchRoute = typeof window !== "undefined"
        && window.location?.pathname?.startsWith("/play");
      // If we've already completed one loading cycle for this match
      // (phase idle after confirmed) AND we're already inside the match
      // route, drop the event — it's a stray fire, not a fresh queue.
      if (inMatchRoute && consumedRef.current) return;
      const m = e?.detail?.mode || "casual";
      setMode(m);
      setUsername(e?.detail?.username || null);
      // Caller-known game mode hint (e.g. PracticeMapSelector passes
      // `tdm: true` when the user explicitly picks TDM). Quick-match
      // leaves it null because the server flips the coin.
      const tdmHint = !!e?.detail?.tdm;
      setGameModeHint(e?.detail?.game_mode || (tdmHint ? "tdm" : null));
      setServerGameMode(null);
      setPreviewMap(pickRandomMapMeta());
      setActualMap(null);
      setPhase("loading");
      clearTimers();
      safetyTimerRef.current = setTimeout(() => {
        setPhase("idle");
        // Latch as consumed even on the safety-timeout path — otherwise
        // a stray virtue-match-loading fired later (during gameplay)
        // could still resurrect the overlay. Belt-and-braces defence
        // matching the confirmed→idle path.
        consumedRef.current = true;
      }, SAFETY_DISMISS_MS);
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
      // Capture the server-confirmed game mode so the subtitle locks in
      // (e.g. quick-match transitions from "DEPLOYING..." to "FFA" or
      // "TDM 4V4" the instant welcome arrives).
      if (e?.detail?.game_mode) setServerGameMode(e.detail.game_mode);
      setPhase("confirmed");
      clearTimers();
      dismissTimerRef.current = setTimeout(() => {
        setPhase("idle");
        // Latch: any stray virtue-match-loading fired after this point
        // (while still on /play) will be ignored.
        consumedRef.current = true;
      }, REVEAL_HOLD_MS);
    };
    window.addEventListener("virtue-match-loaded", onLoaded);
    return () => window.removeEventListener("virtue-match-loaded", onLoaded);
  }, []);

  // Reset the "consumed" latch when the user leaves the match route —
  // the next queue → match flow starts a fresh cycle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      if (!window.location?.pathname?.startsWith("/play")) {
        consumedRef.current = false;
      }
    };
    check();
    window.addEventListener("popstate", check);
    // React Router doesn't emit popstate on nav() — poll cheaply.
    const id = setInterval(check, 500);
    return () => {
      window.removeEventListener("popstate", check);
      clearInterval(id);
    };
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
  // Resolved game-mode for the subtitle. Order: server welcome → caller
  // hint → mode-implied fallback (ranked is always FFA, party → FFA).
  const resolvedMode = serverGameMode || gameModeHint
    || (mode === "ranked" || mode === "party" ? "ffa" : null);
  const modeLabel = resolvedMode ? GAME_MODE_LABELS[resolvedMode]?.label : null;

  return (
    <div
      // Mobile fit: title + mode chip + map preview + status row stack
      // was taller than a portrait iPhone viewport, cropping the bottom
      // status chip. Switched from overflow-hidden/items-center to
      // overflow-y-auto/items-start on mobile so the full stack is
      // reachable via scroll. Decorative conic burst stays position:
      // absolute so it still fills the whole screen regardless of the
      // scroll container.
      className="fixed inset-0 z-[9000] overflow-y-auto flex items-start justify-center"
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
      <div className="relative flex flex-col items-center justify-center gap-3 sm:gap-5 tiny:gap-1.5 sm:tiny:gap-1.5 px-4 py-10 sm:py-6 tiny:py-2 sm:tiny:py-2 text-center min-h-full w-full">
        <div
          className="font-display text-pow-shadow-lg flex items-center gap-2 sm:gap-3 leading-none text-3xl sm:text-6xl sm:tiny:text-3xl"
          style={{
            color: "#FFFFFF",
            textShadow: `0 0 18px ${meta.accent}99, 5px 5px 0 #0A0A0A, -1px -1px 0 #0A0A0A`,
            animation: "match-loading-banner-pop 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
          data-testid="match-loading-title"
        >
          <Zap size={24} strokeWidth={4} className="text-[#FFD700] sm:w-8 sm:h-8" fill="#FFD700" />
          {meta.title}
          <Zap size={24} strokeWidth={4} className="text-[#FFD700] sm:w-8 sm:h-8" fill="#FFD700" />
        </div>

        {/* Mode subtitle — FFA vs TDM. Locked-in label after welcome,
            "DEPLOYING..." placeholder before (only for casual/quick where
            the server flips the coin). */}
        <div
          className="flex items-center gap-2 px-3 py-1 border-2 border-black"
          style={{
            background: resolvedMode === "tdm" ? "#0055FF" : (resolvedMode === "ffa" ? "#FFD700" : "rgba(255,255,255,0.12)"),
            color: resolvedMode === "tdm" ? "#FFFFFF" : (resolvedMode === "ffa" ? "#0A0A0A" : "#FFFFFF"),
            boxShadow: "3px 3px 0 0 #0A0A0A",
            animation: "match-loading-banner-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 60ms both",
          }}
          data-testid="match-loading-game-mode"
          data-game-mode={resolvedMode || "unknown"}
        >
          <span className="font-anton uppercase tracking-widest text-sm">
            {modeLabel || "DEPLOYING…"}
          </span>
        </div>

        {showMap && (
          <div
            className="flex flex-col items-center gap-2"
            style={{ animation: "match-loading-banner-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 120ms both" }}
            data-testid="match-loading-map"
            key={showMap.map_id /* re-mount on map swap so the pop-in re-fires */}
          >
            <MapPreview map={showMap} size={tiny ? Math.max(110, Math.round(window.innerHeight * 0.38)) : 220} />
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
