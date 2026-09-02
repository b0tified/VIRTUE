/*
 * AdminFogLobby — Full-screen fog-forest background + seamless music
 * loop rendered ONLY on the admin account's /lobby route.
 *
 * Layers (back-to-front):
 *   1. `#1a1c1f` base — matches the reference photo's cool dark grey.
 *   2. SVG tree silhouettes (thin trunks + sparse conifer needles).
 *      Two layers at different depths so parallax reads on scroll.
 *   3. Two blurred radial fog clouds drifting horizontally in
 *      opposite directions at very different speeds — sells depth
 *      without needing multiple animated bitmap layers.
 *   4. Halftone dot overlay + subtle scanline for the comic-page
 *      grain that matches the rest of VIRTUE's aesthetic.
 *
 * All CSS animations — no canvas, no bitmap assets — so it stays
 * cheap on mobile and doesn't affect FPS if the admin opens dev
 * tools mid-session.
 *
 * The MP3 is streamed from the user-uploaded artifact and looped
 * seamlessly via the native HTMLAudio `loop` flag. We arm the tag
 * on mount and stop it on unmount so the audio is scoped strictly
 * to the /lobby page for admins.
 */
import { useEffect, useRef } from "react";

const MUSIC_URL =
  "https://customer-assets-wrfwihn1.emergentagent.net/job_blast-arena-servers/artifacts/4l14mia5_Avith%20Ortega%20-%20Recurring%20Tourism-%5BAudioTrimmer.com%5D.mp3";

export default function AdminFogLobby({ enabled }) {
  const audioRef = useRef(null);

  // Music lifecycle. `loop = true` gives a seamless restart the
  // instant playback reaches the end — the file the user uploaded
  // was already trimmed for a clean loop point.
  useEffect(() => {
    if (!enabled) return;
    // Some browsers block autoplay until the first user interaction.
    // Bind a one-shot pointerdown that kicks playback if the initial
    // .play() rejected. We tear it down on unmount either way.
    const a = new Audio(MUSIC_URL);
    a.loop = true;
    a.volume = 0.35;   // ambient bed — not overpowering
    a.preload = "auto";
    audioRef.current = a;
    let awaitingGesture = false;
    const kick = () => {
      awaitingGesture = false;
      a.play().catch(() => { /* swallow — user may navigate away */ });
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
      {/* Base */}
      <div className="absolute inset-0" style={{ background: "#1a1c1f" }} />

      {/* Far tree layer — pale, thin, tightly packed. Rendered inline
          as one wide SVG that repeats via `background-repeat`. */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(FAR_TREES_SVG)}")`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 68%",
          backgroundPosition: "0 100%",
          filter: "blur(2.5px)",
          animation: "admin-fog-parallax-far 90s linear infinite",
        }}
      />
      {/* Near tree layer — darker, taller trunks, sparser. */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(NEAR_TREES_SVG)}")`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 92%",
          backgroundPosition: "0 100%",
          animation: "admin-fog-parallax-near 55s linear infinite",
        }}
      />

      {/* Fog cloud A — drifts left, wide + soft. */}
      <div
        className="absolute -inset-1/2"
        style={{
          background:
            "radial-gradient(ellipse 55% 30% at 30% 55%, rgba(200,205,210,0.55) 0%, rgba(200,205,210,0.0) 60%)",
          filter: "blur(28px)",
          animation: "admin-fog-drift-a 42s ease-in-out infinite",
        }}
      />
      {/* Fog cloud B — drifts right, denser near ground level. */}
      <div
        className="absolute -inset-1/2"
        style={{
          background:
            "radial-gradient(ellipse 65% 22% at 55% 80%, rgba(220,225,230,0.70) 0%, rgba(220,225,230,0.0) 55%)",
          filter: "blur(32px)",
          animation: "admin-fog-drift-b 58s ease-in-out infinite",
        }}
      />
      {/* Fog cloud C — slow high hazy top. */}
      <div
        className="absolute -inset-1/2"
        style={{
          background:
            "radial-gradient(ellipse 80% 18% at 40% 20%, rgba(180,185,190,0.45) 0%, rgba(180,185,190,0.0) 60%)",
          filter: "blur(40px)",
          animation: "admin-fog-drift-c 80s ease-in-out infinite",
        }}
      />

      {/* Halftone + scanline grain — matches VIRTUE's comic aesthetic. */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-25"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1.5px)",
          backgroundSize: "6px 6px",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 3px)",
        }}
      />

      {/* Dark vignette so lobby UI in the foreground still reads clean. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      <style>{`
        @keyframes admin-fog-parallax-far {
          from { background-position:    0 100%; }
          to   { background-position: -1200px 100%; }
        }
        @keyframes admin-fog-parallax-near {
          from { background-position:    0 100%; }
          to   { background-position: -1600px 100%; }
        }
        @keyframes admin-fog-drift-a {
          0%   { transform: translate(0, 0);           opacity: 0.85; }
          50%  { transform: translate(6vw, -1.5vh);    opacity: 1;    }
          100% { transform: translate(0, 0);           opacity: 0.85; }
        }
        @keyframes admin-fog-drift-b {
          0%   { transform: translate(0, 0);           opacity: 0.9;  }
          50%  { transform: translate(-7vw, 1vh);      opacity: 1;    }
          100% { transform: translate(0, 0);           opacity: 0.9;  }
        }
        @keyframes admin-fog-drift-c {
          0%   { transform: translate(0, 0);           opacity: 0.7;  }
          50%  { transform: translate(4vw, 2vh);       opacity: 0.85; }
          100% { transform: translate(0, 0);           opacity: 0.7;  }
        }
      `}</style>
    </div>
  );
}

// -- Tree SVGs -------------------------------------------------------
// Each is 1600 wide × 600 tall — tiled horizontally via background-
// repeat. Colours picked to match the reference photo's murky teal
// blacks. Trees are simple stacked triangles with elongated trunks
// so they read as conifers even at heavy blur.

const NEAR_TREES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 600" preserveAspectRatio="none">
  <g fill="#0f1315">
    ${Array.from({ length: 18 }, (_, i) => {
      const x = i * 92 + (i % 3) * 7;
      const th = 340 + ((i * 71) % 190);
      const tw = 6 + (i % 3) * 2;
      const canopyBase = 600 - th;
      return `
        <rect x="${x - tw / 2}" y="${canopyBase + 40}" width="${tw}" height="${th}" />
        <polygon points="${x - 42},${canopyBase + 120} ${x + 42},${canopyBase + 120} ${x},${canopyBase - 20}" />
        <polygon points="${x - 34},${canopyBase + 80} ${x + 34},${canopyBase + 80} ${x},${canopyBase - 40}" />
        <polygon points="${x - 26},${canopyBase + 40} ${x + 26},${canopyBase + 40} ${x},${canopyBase - 55}" />
      `;
    }).join("")}
  </g>
</svg>`;

const FAR_TREES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 600" preserveAspectRatio="none">
  <g fill="#3a4144">
    ${Array.from({ length: 34 }, (_, i) => {
      const x = i * 48 + (i % 5) * 4;
      const th = 220 + ((i * 53) % 140);
      const tw = 3 + (i % 2);
      const canopyBase = 600 - th;
      return `
        <rect x="${x - tw / 2}" y="${canopyBase + 30}" width="${tw}" height="${th}" />
        <polygon points="${x - 20},${canopyBase + 60} ${x + 20},${canopyBase + 60} ${x},${canopyBase - 25}" />
        <polygon points="${x - 14},${canopyBase + 30} ${x + 14},${canopyBase + 30} ${x},${canopyBase - 40}" />
      `;
    }).join("")}
  </g>
</svg>`;
