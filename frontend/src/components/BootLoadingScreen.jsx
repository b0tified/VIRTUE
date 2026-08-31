/*
 * BootLoadingScreen — Full-screen intro shown on first app load.
 *
 * Why it exists: fresh players hit /login or /lobby with zero context.
 * A short branded splash sets the tone (comic-book FPS, gritty
 * yellow/red palette) and gives us cover to warm up Three.js + audio
 * without the user noticing chunk-download hitches on the next
 * screen.
 *
 * Enforced 8-second minimum:
 *   - Fast connections still see the full splash so the "premium AAA
 *     boot" feel is preserved. This matches the user's exact spec:
 *     "make it take at least 8 seconds to load lobby".
 *   - We DO NOT block a slower page load — if the auth check + font
 *     load stretch beyond 8s the splash simply stays visible until
 *     they finish. `onDone` fires once both the timer and the auth
 *     probe have resolved.
 *
 * Plays on EVERY page load / refresh: React state defaults to
 * `visible: true` on mount, and we do NOT persist "already played"
 * across refreshes. Route changes within a session (lobby → profile
 * → lobby) keep the App component mounted so the splash's `visible`
 * stays `false` and doesn't replay — only a real refresh remounts
 * the tree and resets the splash.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import api from "@/api";

const MIN_DURATION_MS = 8000;

export default function BootLoadingScreen({ onDone }) {
  // Always start visible on mount. A page refresh unmounts the whole
  // React tree so this always fires; a route change within the tab
  // does not remount App, so `visible` correctly stays `false` after
  // its one-time transition.
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(0);   // 0..100 driven by the timer
  // Current season number — fetched from GET /api/season on mount so
  // the subtitle stays truthful the day the season rolls (never
  // hard-code the year). Falls back to a blank string until the
  // request lands; the layout keeps the height reserved so there's
  // no shift when the number pops in.
  const [seasonNum, setSeasonNum] = useState(null);
  const startedAtRef = useRef(0);
  const doneFiredRef = useRef(false);

  // One-shot season probe — cheap, unauthenticated, safe to run every
  // boot. If it fails the subtitle just falls back to "CURRENT SEASON".
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/season");
        if (!cancelled && data && typeof data.season_number === "number") {
          setSeasonNum(data.season_number);
        }
      } catch { /* subtitle just falls back — no user-visible error */ }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // Progress + minimum-duration gate. RAF (not setInterval) so the
  // bar animates smoothly at the device's refresh rate.
  useEffect(() => {
    if (!visible) return;
    startedAtRef.current = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - startedAtRef.current;
      const pct = Math.min(100, (elapsed / MIN_DURATION_MS) * 100);
      setProgress(pct);
      if (elapsed >= MIN_DURATION_MS) {
        if (!doneFiredRef.current) {
          doneFiredRef.current = true;
          // Short fade-out grace so the "READY UP" pulse can settle
          // before the lobby paints — feels less abrupt than a hard cut.
          setTimeout(() => {
            setVisible(false);
            try { onDone?.(); } catch {}
          }, 400);
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, onDone]);

  // Deterministic speed-line positions per mount so they don't flicker
  // between renders. useMemo keeps them stable across the progress
  // re-renders that fire ~60x/second.
  const speedLines = useMemo(() => (
    Array.from({ length: 14 }, (_, i) => ({
      top: 4 + (i * 6.7 % 92),
      dur: 1.1 + ((i * 37) % 60) / 40,
      delay: (i * 0.17) % 1.4,
      widthPct: 40 + ((i * 53) % 55),
      opacity: 0.22 + ((i * 11) % 6) / 30,
    }))
  ), []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center overflow-hidden select-none"
      data-testid="boot-loading-screen"
      style={{
        background:
          "radial-gradient(ellipse at 30% 20%, #2d1210 0%, #14060a 55%, #060205 100%)",
      }}
    >
      {/* Halftone dot pattern — pure CSS, no assets, sits behind everything. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: "radial-gradient(#FFD700 1px, transparent 1.5px)",
          backgroundSize: "22px 22px",
          animation: "boot-halftone-drift 14s linear infinite",
        }}
      />

      {/* Kinetic speed lines that streak across the screen — pure CSS. */}
      {speedLines.map((sl, i) => (
        <div
          key={i}
          aria-hidden
          className="absolute h-[2px]"
          style={{
            top: `${sl.top}%`,
            left: "-40%",
            width: `${sl.widthPct}%`,
            background:
              "linear-gradient(90deg, transparent 0%, #E62429 40%, #FFD700 65%, transparent 100%)",
            opacity: sl.opacity,
            filter: "blur(0.4px)",
            animation: `boot-speedline ${sl.dur}s cubic-bezier(0.3, 0.7, 0.9, 1) ${sl.delay}s infinite`,
          }}
        />
      ))}

      {/* Central logo block — animates in with a "POW!" pop. */}
      <div className="relative z-10 flex flex-col items-center gap-3 mb-16 px-6 text-center">
        <div
          className="font-display text-[12vw] sm:text-[9rem] leading-none tracking-tight"
          style={{
            WebkitTextStroke: "3px #0A0A0A",
            textShadow: "6px 6px 0 rgba(0,0,0,0.75), 10px 10px 0 #0A0A0A",
            animation: "boot-logo-pop 0.9s cubic-bezier(0.3, 1.6, 0.6, 1) both",
          }}
          data-testid="boot-logo"
        >
          {/* Split the wordmark to match the Lobby palette exactly —
              VIR in gold (#FFD700), TUE in comic red (#E62429). The
              parent gets no color; each span owns its own so the
              text-shadow above still renders as a black offset behind
              both halves. */}
          <span style={{ color: "#FFD700" }}>VIR</span>
          <span style={{ color: "#E62429" }}>TUE</span>
        </div>
        <div
          className="font-anton uppercase tracking-[0.4em] text-white/80 text-xs sm:text-sm"
          data-testid="boot-subtitle"
          style={{ animation: "boot-fadein 0.9s ease-out 0.3s both" }}
        >
          {seasonNum != null ? `Season ${seasonNum}` : "Current Season"}
        </div>
      </div>

      {/* Progress bar — a chunky black-bordered POW bar with a red fill
          streaking behind a gold cap. */}
      <div className="relative z-10 w-[80%] max-w-[540px] mb-3">
        <div
          className="h-6 bg-black/70 border-[3px] border-black relative overflow-hidden"
          style={{ boxShadow: "6px 6px 0 rgba(0,0,0,0.8)" }}
          data-testid="boot-progress-track"
        >
          <div
            className="h-full transition-none"
            style={{
              width: `${progress}%`,
              background:
                "linear-gradient(90deg, #E62429 0%, #FF5A2B 55%, #FFD700 100%)",
              boxShadow: "inset 0 -4px 0 rgba(0,0,0,0.25)",
            }}
            data-testid="boot-progress-fill"
          />
          {/* Animated shimmer glint gliding across the fill for kineticism. */}
          <div
            aria-hidden
            className="absolute top-0 bottom-0 w-16 pointer-events-none"
            style={{
              left: `${Math.max(0, progress - 12)}%`,
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)",
              filter: "blur(2px)",
              opacity: progress > 4 && progress < 99 ? 1 : 0,
              transition: "opacity 200ms ease",
            }}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <div
            className="font-anton uppercase tracking-widest text-[11px] text-white/80 min-h-[1.1em]"
            data-testid="boot-tip"
          >
            Loading
          </div>
          <div className="font-display text-lg text-[#FFD700] tabular-nums">
            {Math.floor(progress)}%
          </div>
        </div>
      </div>

      {/* Local keyframes — scoped via a style tag so this component ships
          in one file. Small enough that the extra <style> block is fine. */}
      <style>{`
        @keyframes boot-speedline {
          0%   { transform: translateX(0);      opacity: 0; }
          10%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateX(260%);   opacity: 0; }
        }
        @keyframes boot-logo-pop {
          0%   { transform: translateY(-24px) scale(0.6) rotate(-4deg); opacity: 0; }
          60%  { transform: translateY(4px)   scale(1.08) rotate(1deg); opacity: 1; }
          100% { transform: translateY(0)     scale(1)    rotate(0deg); opacity: 1; }
        }
        @keyframes boot-fadein {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes boot-halftone-drift {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-40px, -40px, 0); }
        }
      `}</style>
    </div>
  );
}
