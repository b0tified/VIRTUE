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
import { useEffect } from "react";
import audioBus from "@/game/audio";

const MUSIC_URL =
  "https://customer-assets-wrfwihn1.emergentagent.net/job_blast-arena-servers/artifacts/4l14mia5_Avith%20Ortega%20-%20Recurring%20Tourism-%5BAudioTrimmer.com%5D.mp3";

export default function AdminFogLobby({ enabled }) {
  useEffect(() => {
    if (!enabled) return;
    audioBus.startFogAmbient(MUSIC_URL);
    return () => { audioBus.stopFogAmbient(); };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      data-testid="admin-fog-lobby-bg"
      aria-hidden
    >
      {/* Vertical atmospheric gradient — pale grey-blue haze top,
          murky forest earth bottom. Roughly matches the reference
          photo's light distribution. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(
              180deg,
              #c9d1d3 0%,
              #b3bec1 22%,
              #8e9a9d 42%,
              #566065 62%,
              #2b3236 82%,
              #1c2124 100%)`,
        }}
      />

      {/* Far tree layer — pale, more numerous, blurred. Sits BEHIND
          the mid + ground fog so distance reads correctly. */}
      <svg
        className="absolute inset-x-0 bottom-0 w-full pointer-events-none"
        style={{ height: "78%", opacity: 0.55, filter: "blur(1.6px)" }}
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
          filter: "blur(28px)",
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
          filter: "blur(34px)",
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
          background:
            "linear-gradient(90deg, rgba(210,215,220,0) 0%, rgba(210,215,220,0.30) 40%, rgba(210,215,220,0.30) 60%, rgba(210,215,220,0) 100%)",
          filter: "blur(22px)",
          animation: "admin-fog-drift-eye 70s ease-in-out infinite",
        }}
      />

      {/* Photographic film grain — noise-like halftone at very low
          opacity, no dot pattern so it feels more like a foggy photo
          than a comic panel. */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-[0.14]"
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
          animation: admin-fog-sway-near 5.4s ease-in-out infinite;
        }
        .admin-fog-crown-far {
          animation: admin-fog-sway-far 7.2s ease-in-out infinite;
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
