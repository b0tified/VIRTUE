/*
 * AdminFogLobby — Full-screen misty-forest background + seamless
 * music loop rendered ONLY on the admin account's /lobby route.
 *
 * Photo-realistic-leaning stack (all CSS/SVG, no bitmap assets):
 *   1. Vertical gradient sky→ground evoking the reference image's
 *      pale-blue/grey haze fading into damp earth-brown.
 *   2. Two SVG tree layers (near-dark + far-pale) with dozens of
 *      hand-plotted conifer trunks. Trees SWAY in the wind via a
 *      transform-origin at their base — no horizontal scrolling
 *      per the user's request.
 *   3. Three drifting fog cloud gradients at different depths +
 *      speeds, sitting ABOVE the far trees but BELOW the near ones
 *      so distance reads correctly (fog occludes distant trees more
 *      than nearby ones).
 *   4. Subtle grain + vignette so the foreground UI stays readable.
 *
 * All costs stay tiny: three transform keyframes + one background-
 * position tween. Fine for mobile.
 *
 * The MP3 is streamed from the uploaded artifact and looped
 * seamlessly via HTMLAudio `loop`. On unmount we pause+rewind so
 * the audio is strictly scoped to /lobby.
 */
import { useEffect, useRef } from "react";

const MUSIC_URL =
  "https://customer-assets-wrfwihn1.emergentagent.net/job_blast-arena-servers/artifacts/4l14mia5_Avith%20Ortega%20-%20Recurring%20Tourism-%5BAudioTrimmer.com%5D.mp3";

export default function AdminFogLobby({ enabled }) {
  const audioRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    const a = new Audio(MUSIC_URL);
    a.loop = true;
    a.volume = 0.35;
    a.preload = "auto";
    audioRef.current = a;
    let awaitingGesture = false;
    const kick = () => {
      awaitingGesture = false;
      a.play().catch(() => {});
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
    a.play().catch(() => {
      awaitingGesture = true;
      window.addEventListener("pointerdown", kick, { once: true });
      window.addEventListener("keydown", kick, { once: true });
    });
    return () => {
      try { a.pause(); a.currentTime = 0; } catch {}
      audioRef.current = null;
      if (awaitingGesture) {
        window.removeEventListener("pointerdown", kick);
        window.removeEventListener("keydown", kick);
      }
    };
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

      {/* Far tree layer — pale, more numerous, sits BEHIND fog A/B/C
          so distance reads correctly. Base transform-origin so the
          sway pivots from the ground. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[70%]"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(FAR_TREES_SVG)}")`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "0 100%",
          opacity: 0.55,
          filter: "blur(1.5px)",
          transformOrigin: "50% 100%",
          animation: "admin-fog-sway-far 7s ease-in-out infinite",
          willChange: "transform",
        }}
      />

      {/* Mid fog band — high thin haze weaving between the two tree
          layers. Slow horizontal drift for a lived-in breath. */}
      <div
        className="absolute -inset-x-1/2 top-[18%] h-[35%]"
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

      {/* Near tree layer — darker, taller, sparser. Sits ABOVE the
          fog so nearby trees remain sharp. Sway phase intentionally
          offset from the far layer for depth. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[92%]"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(NEAR_TREES_SVG)}")`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "0 100%",
          opacity: 0.95,
          transformOrigin: "50% 100%",
          animation: "admin-fog-sway-near 5s ease-in-out infinite",
          willChange: "transform",
        }}
      />

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
        /* Trees rock a tiny amount from their base — the amplitudes
           (0.6deg / 0.9deg) are small enough to look like real wind
           on a still day but large enough to be visible. */
        @keyframes admin-fog-sway-near {
          0%   { transform: rotate(-0.6deg) skewX(-0.3deg); }
          50%  { transform: rotate( 0.9deg) skewX( 0.4deg); }
          100% { transform: rotate(-0.6deg) skewX(-0.3deg); }
        }
        @keyframes admin-fog-sway-far {
          0%   { transform: rotate( 0.5deg) skewX( 0.25deg); }
          50%  { transform: rotate(-0.7deg) skewX(-0.35deg); }
          100% { transform: rotate( 0.5deg) skewX( 0.25deg); }
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

// -- Tree SVGs -------------------------------------------------------
// Each SVG is 1600 wide × 600 tall. Trees stacked triangles for a
// conifer silhouette. Deterministic random-looking placement via a
// small pseudo-random walk so the layout doesn't look tiled.

function _mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _tree(x, canopyBase, height, trunkW, color) {
  return `
    <rect x="${x - trunkW / 2}" y="${canopyBase + height * 0.15}" width="${trunkW}" height="${height * 0.85}" fill="${color}"/>
    <polygon points="${x - height * 0.14},${canopyBase + height * 0.22} ${x + height * 0.14},${canopyBase + height * 0.22} ${x},${canopyBase - height * 0.05}" fill="${color}"/>
    <polygon points="${x - height * 0.11},${canopyBase + height * 0.10} ${x + height * 0.11},${canopyBase + height * 0.10} ${x},${canopyBase - height * 0.12}" fill="${color}"/>
    <polygon points="${x - height * 0.085},${canopyBase - height * 0.02} ${x + height * 0.085},${canopyBase - height * 0.02} ${x},${canopyBase - height * 0.18}" fill="${color}"/>
  `;
}

// Near layer — darker, taller, more variety. 22 trees, hand-jittered
// with a seeded RNG so the same pattern renders on every load.
const NEAR_TREES_SVG = (() => {
  const rand = _mulberry(1337);
  const parts = [];
  let x = 20;
  for (let i = 0; i < 22; i++) {
    const height = 300 + rand() * 260;
    const trunkW = 5 + rand() * 4;
    const yBase = 600;                       // bottom of frame
    parts.push(_tree(x, yBase, height, trunkW, "#0b0f11"));
    // Occasional lighter tree in the middle distance for depth.
    if (i % 3 === 0) {
      const h2 = 220 + rand() * 140;
      parts.push(_tree(x + 30 + rand() * 22, yBase, h2, 3 + rand() * 2, "#1a2124"));
    }
    x += 55 + rand() * 40;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 600" preserveAspectRatio="none">${parts.join("")}</svg>`;
})();

// Far layer — pale, thinner, denser to sell forest depth. 42 trees.
const FAR_TREES_SVG = (() => {
  const rand = _mulberry(4242);
  const parts = [];
  let x = 10;
  for (let i = 0; i < 42; i++) {
    const height = 180 + rand() * 200;
    const trunkW = 2 + rand() * 2;
    const yBase = 600;
    parts.push(_tree(x, yBase, height, trunkW, "#4a5559"));
    x += 30 + rand() * 20;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 600" preserveAspectRatio="none">${parts.join("")}</svg>`;
})();
