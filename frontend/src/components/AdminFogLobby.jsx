/*
 * AdminFogLobby — Full-screen misty-forest background + seamless
 * music loop rendered ONLY on the admin account's /lobby route.
 *
 * Visual stack (all CSS/SVG, no bitmap assets):
 *   1. Vertical gradient sky→ground evoking the reference image's
 *      pale-blue/grey haze fading into damp earth-brown.
 *   2. Two inline-SVG tree layers (near-dark + far-pale) with hand-
 *      plotted TALL conifers. Each tree is a `<g>` containing a
 *      static trunk `<rect>` + a `<g class="crown">` holding the
 *      branch polygons. Only the crowns sway — via a CSS keyframe
 *      that skews/rotates them around `transform-origin: 50% 100%`
 *      (base of the crown, i.e. top of the trunk). Trunks stay
 *      anchored. Each crown gets a staggered animation-delay so the
 *      wind reads as a wave rolling through the forest instead of
 *      every branch swaying in lockstep.
 *   3. Three drifting fog cloud gradients at different depths +
 *      speeds, sitting ABOVE the far trees but BELOW the near ones
 *      so distance reads correctly (fog occludes distant trees more
 *      than nearby ones).
 *   4. Subtle grain + vignette so the foreground UI stays readable.
 *
 * Audio: The MP3 is streamed through the global `audioBus` so its
 * volume follows the master + music sliders (and the mute toggles).
 * On unmount we call `audioBus.stopFogAmbient()` which pauses AND
 * disconnects the node, so the track cannot leak into a match.
 */
import { useEffect, useState } from "react";
import audioBus from "@/game/audio";

const ANDROID_LITE = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");

const MUSIC_URL =
  "https://customer-assets-wrfwihn1.emergentagent.net/job_blast-arena-servers/artifacts/4l14mia5_Avith%20Ortega%20-%20Recurring%20Tourism-%5BAudioTrimmer.com%5D.mp3";

export default function AdminFogLobby({ enabled }) {
  // Lightning flash key — bumps every strike so the flash overlay
  // restarts its animation without keyframe stutter.
  const [flash, setFlash] = useState({ id: 0, intensity: 0, forked: false });

  useEffect(() => {
    if (!enabled) return;
    // Ambient MP3 back on per user request. Thunder audio removed
    // below in the lightning scheduler so we get the storm visuals
    // without the loud rumble under the music.
    audioBus.startFogAmbient(MUSIC_URL);
    return () => { try { audioBus.stopFogAmbient(); } catch {} };
  }, [enabled]);

  // Lightning + thunder scheduler. Random strike every 6-14s. Each
  // strike is either a single flash or a rapid double-flash. Thunder
  // AUDIO was removed per user request — flashes stay silent so the
  // lobby MP3 has clean airtime.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer;
    const strike = () => {
      if (!alive) return;
      const intensity = 0.65 + Math.random() * 0.35;   // 0.65..1.0
      const forked = Math.random() > 0.55;              // ~45% show a bolt
      setFlash((f) => ({ id: f.id + 1, intensity, forked }));
      // Optional quick re-flash (looks like the strike pulsing through
      // the clouds) — 30% chance.
      if (Math.random() < 0.3) {
        setTimeout(() => {
          if (!alive) return;
          setFlash((f) => ({ id: f.id + 1, intensity: intensity * 0.65, forked: false }));
        }, 120 + Math.random() * 90);
      }
      // Thunder audio disabled — flashes still fire visually so the
      // storm reads, but no rumble under the lobby MP3.
      // (was: setTimeout(() => audioBus.thunder(), 200 + rand()*550))
      timer = setTimeout(strike, 6000 + Math.random() * 8000);
    };
    // First strike after 2-4s so the effect kicks in shortly after login.
    timer = setTimeout(strike, 2000 + Math.random() * 2000);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [enabled]);

  if (!enabled) return null;
  // Android GPUs flicker with animated CSS blur, blend modes and SVG
  // transform animations — use a composited-only variant there.
  const lite = ANDROID_LITE;
  const blur = (px) => (lite ? undefined : `blur(${px}px)`);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      data-testid="admin-fog-lobby-bg"
      aria-hidden
    >
      {/* Vertical atmospheric gradient — heavy storm sky: bruised
          slate top, near-black earth bottom. Darker than the calm-fog
          palette so the lightning flashes read as bright. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(
              180deg,
              #3d434a 0%,
              #2b323a 22%,
              #1e242b 42%,
              #141a20 62%,
              #0b0f13 82%,
              #05080a 100%)`,
        }}
      />

      {/* Far tree layer — pale, more numerous, blurred. Sits BEHIND
          the mid + ground fog so distance reads correctly. */}
      <svg
        className="absolute inset-x-0 bottom-0 w-full pointer-events-none"
        style={{ height: "78%", opacity: 0.55, filter: blur(1.6) }}
        viewBox="0 0 1600 780"
        preserveAspectRatio="xMidYMax slice"
      >
        {FAR_TREES.map((t, i) => (
          <TreeGlyph key={`f${i}`} tree={t} className="admin-fog-crown-far" />
        ))}
      </svg>

      {/* Mid fog band — high thin haze weaving between the two tree
          layers. Slow horizontal drift for a lived-in breath. */}
      <div
        className="absolute -inset-x-1/2 top-[16%] h-[36%]"
        style={{
          background:
            "radial-gradient(ellipse 55% 60% at 40% 50%, rgba(220,225,228,0.55) 0%, rgba(220,225,228,0) 60%)",
          filter: blur(28),
          willChange: "transform",
          animation: "admin-fog-drift-mid 45s ease-in-out infinite",
        }}
      />

      {/* Ground fog — dense soft band hugging the bottom third, drifts
          rightward. Placed BEHIND the near-tree layer so nearby trees
          punch through the mist instead of being blanketed by it. */}
      <div
        className="absolute -inset-x-1/2 bottom-0 h-[45%]"
        style={{
          background:
            "radial-gradient(ellipse 60% 55% at 55% 85%, rgba(230,235,238,0.65) 0%, rgba(230,235,238,0) 55%)",
          filter: blur(34),
          willChange: "transform",
          animation: "admin-fog-drift-ground 55s ease-in-out infinite",
        }}
      />

      {/* Near tree layer — darker, TALL, sparser. Sits ABOVE the fog
          so nearby trees remain sharp against the mist. Crowns sway
          independently from their trunks; each tree has its own
          phase offset so the wind reads as a rolling wave. */}
      <svg
        className="absolute inset-x-0 bottom-0 w-full pointer-events-none"
        style={{ height: "98%", opacity: 0.96 }}
        viewBox="0 0 1600 980"
        preserveAspectRatio="xMidYMax slice"
      >
        {NEAR_TREES.map((t, i) => (
          <TreeGlyph key={`n${i}`} tree={t} className="admin-fog-crown-near" />
        ))}
      </svg>

      {/* Faint horizontal haze at eye level — completes the wall-of-
          mist effect from the reference. Sits above trees so distant
          trunks fade into it. */}
      <div
        className="absolute -inset-x-1/2 top-[45%] h-[20%]"
        style={{
          background: lite
            ? "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(210,215,220,0.30) 0%, rgba(210,215,220,0.18) 45%, rgba(210,215,220,0) 100%)"
            : "linear-gradient(90deg, rgba(210,215,220,0) 0%, rgba(210,215,220,0.30) 40%, rgba(210,215,220,0.30) 60%, rgba(210,215,220,0) 100%)",
          filter: blur(22),
          willChange: "transform",
          animation: "admin-fog-drift-eye 70s ease-in-out infinite",
        }}
      />

      {/* -------- HEAVY STORM: rain + lightning -------- */}
      {/* Rain: two SVG layers of diagonal streaks at different speeds
          + tile offsets for parallax depth. Each SVG is a small tile
          repeated across the viewport; the CSS animation slides the
          background-position diagonally so streaks fall consistently
          without React re-renders. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(RAIN_SVG_BACK)}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "220px 300px",
          opacity: 0.55,
          animation: `admin-storm-rain-back${lite ? "-lite" : ""} 0.9s linear infinite`,
          mixBlendMode: lite ? undefined : "screen",
          ...(lite ? { top: "-400px", height: "calc(100% + 400px)", right: "-120px", willChange: "transform" } : {}),
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(RAIN_SVG_FRONT)}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "180px 260px",
          opacity: 0.72,
          animation: `admin-storm-rain-front${lite ? "-lite" : ""} 0.55s linear infinite`,
          mixBlendMode: lite ? undefined : "screen",
          ...(lite ? { top: "-400px", height: "calc(100% + 400px)", right: "-120px", willChange: "transform" } : {}),
        }}
      />

      {/* Wind-driven rain streak (occasional heavier gust). Sits below
          the near trees so trunks still occlude the drops in front of
          them. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(RAIN_SVG_GUST)}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "300px 380px",
          opacity: 0.38,
          animation: `admin-storm-rain-gust${lite ? "-lite" : ""} 1.3s linear infinite`,
          mixBlendMode: lite ? undefined : "screen",
          ...(lite ? { top: "-400px", height: "calc(100% + 400px)", right: "-120px", willChange: "transform" } : {}),
        }}
      />

      {/* Lightning flash overlay — a full-screen white wash whose
          opacity animates from `intensity` → 0 over ~380ms every
          time the strike counter bumps. The `key={flash.id}` on the
          outer div forces the animation to restart cleanly. */}
      <div
        key={`flash-${flash.id}`}
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.98) 0%, rgba(200,220,255,0.55) 35%, rgba(120,150,200,0) 70%)",
          opacity: 0,
          animation: flash.id > 0 ? `admin-storm-flash ${380}ms ease-out` : "none",
          "--flash-peak": flash.intensity,
        }}
      />

      {/* Fork bolt SVG — drawn only on strikes with `forked=true`, and
          only for ~120ms so it feels like a real streak crackle. */}
      {flash.forked && flash.id > 0 && (
        <svg
          key={`bolt-${flash.id}`}
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid slice"
          style={{ animation: "admin-storm-bolt 220ms ease-out forwards", opacity: 0 }}
        >
          <defs>
            <filter id="bolt-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d={buildBoltPath(flash.id)}
            stroke="#f0f6ff"
            strokeWidth="3"
            fill="none"
            filter="url(#bolt-glow)"
          />
        </svg>
      )}

      {/* Photographic film grain — noise-like halftone at very low
          opacity, no dot pattern so it feels more like a foggy photo
          than a comic panel. */}
      <div
        className={`absolute inset-0 opacity-[0.14] ${lite ? "hidden" : "mix-blend-overlay"}`}
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.6) 0.6px, transparent 0.9px)",
          backgroundSize: "3px 3px",
        }}
      />

      {/* Corner vignette so UI stays legible against the pale mid-frame. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      <style>{`
        /* Only the CROWNS sway. transform-box: fill-box lets SVG groups
           use CSS transform-origin relative to their own bounding box,
           so the crown pivots at its base (top of the trunk). */
        .admin-fog-crown-near, .admin-fog-crown-far {
          transform-box: fill-box;
          transform-origin: 50% 100%;
          will-change: transform;
        }
        .admin-fog-crown-near {
          animation: ${lite ? "none" : "admin-fog-sway-near 5.4s ease-in-out infinite"};
        }
        .admin-fog-crown-far {
          animation: ${lite ? "none" : "admin-fog-sway-far 7.2s ease-in-out infinite"};
        }
        /* Amplitude tuned to look like a light wind: 2.0deg / 1.4deg
           tilt + a matching horizontal skew so the branch tips travel
           further than the base of the crown (which is what real trees
           do). Trunks below are on the parent <g> and don't animate. */
        @keyframes admin-fog-sway-near {
          0%   { transform: rotate(-2.0deg) skewX(-1.2deg); }
          25%  { transform: rotate( 0.8deg) skewX( 0.5deg); }
          50%  { transform: rotate( 2.4deg) skewX( 1.5deg); }
          75%  { transform: rotate( 0.6deg) skewX( 0.4deg); }
          100% { transform: rotate(-2.0deg) skewX(-1.2deg); }
        }
        @keyframes admin-fog-sway-far {
          0%   { transform: rotate( 1.4deg) skewX( 0.8deg); }
          50%  { transform: rotate(-1.8deg) skewX(-1.0deg); }
          100% { transform: rotate( 1.4deg) skewX( 0.8deg); }
        }
        @keyframes admin-fog-drift-mid {
          0%   { transform: translate(0, 0);           opacity: 0.85; }
          50%  { transform: translate(6vw, -1vh);      opacity: 1;    }
          100% { transform: translate(0, 0);           opacity: 0.85; }
        }
        @keyframes admin-fog-drift-ground {
          0%   { transform: translate(0, 0);           opacity: 0.9;  }
          50%  { transform: translate(-7vw, 0.5vh);    opacity: 1;    }
          100% { transform: translate(0, 0);           opacity: 0.9;  }
        }
        @keyframes admin-fog-drift-eye {
          0%   { transform: translateX(0);   opacity: 0.85; }
          50%  { transform: translateX(4vw); opacity: 1;    }
          100% { transform: translateX(0);   opacity: 0.85; }
        }
        /* Rain: slide the tiled streak texture DOWN-and-slightly-RIGHT
           each frame. Values match the tile size so the loop is
           perfectly seamless. Wind angle is baked into the SVG streaks
           themselves (~12deg tilt) — animating background-position
           along both axes just re-projects that streak. */
        @keyframes admin-storm-rain-back {
          from { background-position: 0 0; }
          to   { background-position: -55px 300px; }
        }
        @keyframes admin-storm-rain-front {
          from { background-position: 0 0; }
          to   { background-position: -72px 260px; }
        }
        @keyframes admin-storm-rain-gust {
          from { background-position: 0 0; }
          to   { background-position: -100px 380px; }
        }
        @keyframes admin-storm-rain-back-lite  { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-55px, 300px, 0); } }
        @keyframes admin-storm-rain-front-lite { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-72px, 260px, 0); } }
        @keyframes admin-storm-rain-gust-lite  { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-100px, 380px, 0); } }
        /* Lightning: white/blue wash flashes on, snaps to peak in the
           first 30ms, and decays over the rest. --flash-peak is set
           inline per strike so intensity varies naturally between hits. */
        @keyframes admin-storm-flash {
          0%   { opacity: 0; }
          8%   { opacity: var(--flash-peak, 0.9); }
          22%  { opacity: calc(var(--flash-peak, 0.9) * 0.55); }
          40%  { opacity: calc(var(--flash-peak, 0.9) * 0.75); }
          100% { opacity: 0; }
        }
        /* Fork bolt: flick on for ~120ms then fade. */
        @keyframes admin-storm-bolt {
          0%   { opacity: 0; }
          15%  { opacity: 1; }
          55%  { opacity: 0.55; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// -- Tree rendering -------------------------------------------------

/* A single tree = static trunk `<rect>` + swaying crown `<g>`. The
   parent `<g>` positions it in the SVG viewBox; the crown group is
   what CSS animates. Each crown gets its own animation-delay + phase
   flip so a wall of trees doesn't sway in lockstep. */
function TreeGlyph({ tree, className }) {
  const { x, baseY, height, trunkW, color, trunkColor, delay, flip } = tree;
  // Crown occupies the top ~88% of the tree — trunk pokes through the
  // bottom for anchoring. baseY is the ground line in the viewBox.
  const trunkTop = baseY - height * 0.14;   // where trunk ends & crown starts
  const crownTop = baseY - height;          // tallest point of the tree
  return (
    <g>
      {/* Trunk — dead-simple rectangle, stays perfectly still. */}
      <rect
        x={x - trunkW / 2}
        y={trunkTop}
        width={trunkW}
        height={baseY - trunkTop}
        fill={trunkColor}
      />
      {/* Crown group — CSS animates this. transform-origin is set via
          the shared class so the pivot sits at 50% of the crown's own
          bounding box's bottom = right at the top of the trunk. */}
      <g
        className={className}
        style={{
          animationDelay: `${delay}s`,
          transform: flip ? "scaleX(-1)" : undefined,
        }}
      >
        {buildBranches(x, trunkTop, crownTop, height, color)}
      </g>
    </g>
  );
}

/* Build a stack of triangular branch layers for a conifer silhouette.
   Wider at the base, narrower at the tip. Each layer's Y range dips
   slightly BELOW the next-higher layer for the classic drooping-pine
   look (branches overlap so the tree reads as a continuous shape, not
   a stack of separate triangles). */
function buildBranches(x, trunkTop, crownTop, height, color) {
  const crownH = trunkTop - crownTop;
  // Number of branch layers scales with tree height for perceived
  // detail on the larger foreground trees.
  const layers = height > 380 ? 8 : height > 260 ? 7 : 6;
  const els = [];
  for (let i = 0; i < layers; i++) {
    // 0 = base (widest), layers-1 = tip (narrowest)
    const t = i / (layers - 1);
    const layerY = trunkTop - crownH * (i / layers);
    // Width tapers linearly, base a bit wider than a right-triangle would give.
    const halfW = height * (0.24 * (1 - t) + 0.045);
    // Each layer drops slightly below the next-higher layer's tip so
    // the pine reads as a continuous droopy silhouette.
    const droop = crownH * 0.16;
    const tipY = layerY - crownH * (1 / layers) - droop * (1 - t) * 0.4;
    const leftX = x - halfW;
    const rightX = x + halfW;
    els.push(
      <polygon
        key={i}
        points={`${leftX},${layerY} ${rightX},${layerY} ${x},${tipY}`}
        fill={color}
      />
    );
    // Subtle inner shading layer on the larger trees adds depth without
    // costing another animation.
    if (layers >= 7) {
      els.push(
        <polygon
          key={`${i}-s`}
          points={`${x - halfW * 0.55},${layerY} ${x + halfW * 0.55},${layerY} ${x},${tipY + crownH * 0.03}`}
          fill={color}
          opacity={0.55}
        />
      );
    }
  }
  return els;
}

// Seeded RNG so the exact same forest renders on every load (no visual
// jitter between navigations).
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Near layer: 18 dark, TALL foreground trees + occasional midground
// filler tree. Trees are much taller than before (up to ~820px in a
// 980-tall viewBox) so they truly dominate the frame like real forest.
const NEAR_TREES = (() => {
  const rand = mulberry(1337);
  const out = [];
  let x = 40;
  let i = 0;
  while (x < 1600) {
    const height = 560 + rand() * 260;         // 560..820 (tall!)
    const trunkW = 7 + rand() * 5;
    out.push({
      x,
      baseY: 980,
      height,
      trunkW,
      color: "#0b0f11",
      trunkColor: "#080b0d",
      delay: rand() * 4,                       // stagger 0..4s
      flip: rand() > 0.5,
    });
    // Occasional slightly-shorter darker sibling tree offset ~40px
    if (i % 3 === 0) {
      const h2 = 400 + rand() * 180;
      out.push({
        x: x + 34 + rand() * 24,
        baseY: 980,
        height: h2,
        trunkW: 4 + rand() * 2,
        color: "#141b1e",
        trunkColor: "#0d1214",
        delay: rand() * 4,
        flip: rand() > 0.5,
      });
    }
    x += 78 + rand() * 42;
    i++;
  }
  return out;
})();

// Far layer: 36 pale midground trees for depth. Shorter + thinner than
// near trees; sway is slower + smaller amplitude via the far-crown class.
const FAR_TREES = (() => {
  const rand = mulberry(4242);
  const out = [];
  let x = 20;
  while (x < 1600) {
    const height = 240 + rand() * 200;
    const trunkW = 3 + rand() * 2;
    out.push({
      x,
      baseY: 780,
      height,
      trunkW,
      color: "#4a5559",
      trunkColor: "#3d4649",
      delay: rand() * 5,
      flip: rand() > 0.5,
    });
    x += 40 + rand() * 26;
  }
  return out;
})();

// -- Storm helpers --------------------------------------------------

/* Build a jagged lightning bolt path. Starts at the top of the frame
   in a random-ish X position (deterministic per strike id so
   consecutive strikes look distinct without React re-renders churning
   on every animation frame), zig-zags downward with a couple of
   branches for realism. Returns an SVG path `d` string. */
function buildBoltPath(id) {
  const rand = mulberry(id * 7919 + 13);
  const startX = 320 + rand() * 960;                // 320..1280
  const segments = 7 + Math.floor(rand() * 4);      // 7..10
  const points = [`M ${startX.toFixed(0)} 0`];
  let x = startX;
  let y = 0;
  for (let i = 0; i < segments; i++) {
    const dy = 90 + rand() * 60;                    // vertical step
    const dx = (rand() - 0.5) * 220;                // lateral wobble
    x += dx;
    y += dy;
    points.push(`L ${x.toFixed(0)} ${y.toFixed(0)}`);
  }
  // Optional fork ~2/3 of the way down.
  const forkStart = Math.floor(segments * 0.55);
  if (points.length > forkStart + 1) {
    const forkPoint = points[forkStart];
    const fx = parseFloat(forkPoint.split(" ")[1]);
    const fy = parseFloat(forkPoint.split(" ")[2]);
    const forkLen = 3 + Math.floor(rand() * 3);
    let bx = fx;
    let by = fy;
    let branch = ` M ${bx} ${by}`;
    for (let i = 0; i < forkLen; i++) {
      bx += (rand() - 0.2) * 140;
      by += 60 + rand() * 40;
      branch += ` L ${bx.toFixed(0)} ${by.toFixed(0)}`;
    }
    return points.join(" ") + branch;
  }
  return points.join(" ");
}

/* Build a rain-streak SVG tile. Streaks are short white lines tilted
   ~12deg from vertical (wind blowing right). `count` controls density,
   `alpha` the base opacity, `width` the stroke thickness. Same tile is
   repeated across the whole viewport via CSS background-repeat. */
function makeRainTileSVG({ tileW, tileH, count, alpha, width, length, tilt = 12 }) {
  const rand = mulberry(count * 101 + tileW);
  const streaks = [];
  for (let i = 0; i < count; i++) {
    const x1 = rand() * tileW;
    const y1 = rand() * tileH;
    const rad = (tilt * Math.PI) / 180;
    const x2 = x1 + Math.sin(rad) * length;
    const y2 = y1 + Math.cos(rad) * length;
    streaks.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(220,232,245,${alpha})" stroke-width="${width}" stroke-linecap="round"/>`
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tileW} ${tileH}" width="${tileW}" height="${tileH}">${streaks.join("")}</svg>`;
}

const RAIN_SVG_BACK  = makeRainTileSVG({ tileW: 220, tileH: 300, count: 24, alpha: 0.45, width: 1.0, length: 22 });
const RAIN_SVG_FRONT = makeRainTileSVG({ tileW: 180, tileH: 260, count: 34, alpha: 0.85, width: 1.5, length: 30 });
const RAIN_SVG_GUST  = makeRainTileSVG({ tileW: 300, tileH: 380, count: 14, alpha: 0.72, width: 2.2, length: 44, tilt: 16 });
