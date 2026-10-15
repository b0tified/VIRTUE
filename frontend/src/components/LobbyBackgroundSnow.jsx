// LobbyBackgroundSnow — winter lobby backdrop, gated to admin accounts
// for now while we validate the aesthetic.
//
// Structure mirrors LobbyBackgroundMeteor so the visual style is
// consistent across seasonal themes:
//   * Cool blue-to-white sky gradient (arctic overcast).
//   * Halftone snowfall + parallax flake layers (back / mid / front)
//     — front flakes are big and fast, back flakes are tiny and slow.
//   * Frost-tinted pulsing blobs so the corners of the screen glow
//     like an aurora peeking through.
//   * Floating comic-style words re-themed for the winter mood.
//   * A slow horizon shimmer (like frost catching the light).
//
// `animated=false` renders the calm subset (sky + one halftone layer
// + slow blob) for low-motion / battery-saver users.
//
// All keyframes/classes live in index.css prefixed with `lobby-snow-`
// so they don't collide with the meteor/default backgrounds.

export default function LobbyBackgroundSnow({ animated = true }) {
  if (!animated) {
    return (
      <>
        <div className="absolute inset-0 lobby-snow-sky" aria-hidden />
        <div className="absolute inset-0 lobby-snow-halftone" aria-hidden style={{ opacity: 0.45 }} />
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div className="lobby-bg-blob blob-snow-cyan" style={{ top: "30%", left: "30%" }} />
        </div>
        <ChristmasTree animated={false} />
      </>
    );
  }
  return (
    <>
      {/* Sky — deep steel blue overhead fading to milky white at the
          bottom horizon, like an overcast blizzard morning. */}
      <div className="absolute inset-0 lobby-snow-sky" aria-hidden />

      {/* Aurora glow — soft cyan halo along the top-third that pulses
          slowly, evoking pale northern lights bleeding through cloud. */}
      <div className="absolute inset-0 lobby-snow-aurora lobby-snow-pulse" aria-hidden />

      {/* Halftone — cool blue dots at low opacity, ties the palette in. */}
      <div className="absolute inset-0 lobby-snow-halftone" aria-hidden />

      {/* Falling snowflakes — 3 parallax layers. `snow-back` is small,
          slow, and dim; `snow-front` is big, fast, and bright. Each
          flake is a pure-CSS radial-gradient dot, no images. Positions
          / delays are hand-picked so the field feels random without
          leaving big empty vertical stripes. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {/* Back layer — 10 tiny flakes */}
        <div className="lobby-snow-flake flake-back" style={{ left: "5%",  animationDelay: "0.0s", animationDuration: "12s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "13%", animationDelay: "2.4s", animationDuration: "13s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "22%", animationDelay: "4.8s", animationDuration: "11s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "31%", animationDelay: "1.1s", animationDuration: "14s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "42%", animationDelay: "6.7s", animationDuration: "12s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "54%", animationDelay: "3.5s", animationDuration: "13s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "65%", animationDelay: "0.9s", animationDuration: "12s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "76%", animationDelay: "5.3s", animationDuration: "14s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "86%", animationDelay: "2.0s", animationDuration: "11s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "95%", animationDelay: "4.1s", animationDuration: "13s" }} />
        {/* Mid layer — 8 medium flakes */}
        <div className="lobby-snow-flake"            style={{ left: "8%",  animationDelay: "1.2s", animationDuration: "8s" }} />
        <div className="lobby-snow-flake"            style={{ left: "20%", animationDelay: "3.6s", animationDuration: "7s" }} />
        <div className="lobby-snow-flake"            style={{ left: "34%", animationDelay: "0.5s", animationDuration: "9s" }} />
        <div className="lobby-snow-flake"            style={{ left: "48%", animationDelay: "5.9s", animationDuration: "8s" }} />
        <div className="lobby-snow-flake"            style={{ left: "60%", animationDelay: "2.7s", animationDuration: "7s" }} />
        <div className="lobby-snow-flake"            style={{ left: "72%", animationDelay: "4.4s", animationDuration: "9s" }} />
        <div className="lobby-snow-flake"            style={{ left: "83%", animationDelay: "1.8s", animationDuration: "8s" }} />
        <div className="lobby-snow-flake"            style={{ left: "92%", animationDelay: "6.1s", animationDuration: "7s" }} />
        {/* Front layer — 5 big fast flakes */}
        <div className="lobby-snow-flake flake-front" style={{ left: "15%", animationDelay: "0.0s", animationDuration: "4.5s" }} />
        <div className="lobby-snow-flake flake-front" style={{ left: "38%", animationDelay: "2.1s", animationDuration: "5.2s" }} />
        <div className="lobby-snow-flake flake-front" style={{ left: "56%", animationDelay: "4.4s", animationDuration: "4.0s" }} />
        <div className="lobby-snow-flake flake-front" style={{ left: "72%", animationDelay: "1.3s", animationDuration: "5.8s" }} />
        <div className="lobby-snow-flake flake-front" style={{ left: "88%", animationDelay: "3.6s", animationDuration: "4.7s" }} />
      </div>

      <ChristmasTree animated />

      {/* Drifting frost blobs — cyan + pale-blue palette. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-bg-blob blob-snow-cyan   lobby-bg-blob-breathe" style={{ top: "12%", left: "55%" }} />
        <div className="lobby-bg-blob blob-snow-ice    lobby-bg-blob-breathe" style={{ top: "65%", left: "30%", animationDelay: "1.4s" }} />
        <div className="lobby-bg-blob blob-snow-white  lobby-bg-blob-breathe" style={{ top: "30%", left: "12%", animationDelay: "2.8s" }} />
      </div>

      {/* Horizon shimmer — slow horizontal sweep, like frost catching
          reflected light along the ground line. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-snow-shimmer" />
      </div>
    </>
  );
}

const LIGHTS = [
  [100, 92, "#E62429"], [84, 128, "#FFD700"], [118, 140, "#2ECCFF"], [70, 176, "#FFD700"],
  [104, 186, "#E62429"], [136, 170, "#7CFF6B"], [58, 226, "#2ECCFF"], [92, 236, "#FFD700"],
  [128, 226, "#E62429"], [154, 240, "#7CFF6B"], [46, 280, "#E62429"], [80, 292, "#7CFF6B"],
  [116, 288, "#2ECCFF"], [150, 296, "#FFD700"], [168, 280, "#E62429"],
];

function ChristmasTree({ animated }) {
  return (
    <div
      className="absolute bottom-0 left-[46%] -translate-x-1/2 pointer-events-none w-[36vmin] min-w-[140px] max-w-[340px]"
      aria-hidden
      data-testid="lobby-snow-christmas-tree"
    >
      <svg viewBox="0 0 200 340" className="w-full h-auto drop-shadow-[6px_6px_0_rgba(0,0,0,0.35)]">
        <ellipse cx="100" cy="332" rx="96" ry="10" fill="#FFFFFF" stroke="#0A0A0A" strokeWidth="4" />
        <rect x="86" y="290" width="28" height="40" fill="#7A4A23" stroke="#0A0A0A" strokeWidth="5" />
        <polygon points="100,150 192,314 8,314" fill="#1E8C3A" stroke="#0A0A0A" strokeWidth="6" strokeLinejoin="round" />
        <polygon points="100,96 172,236 28,236" fill="#24A346" stroke="#0A0A0A" strokeWidth="6" strokeLinejoin="round" />
        <polygon points="100,46 150,160 50,160" fill="#2DBF55" stroke="#0A0A0A" strokeWidth="6" strokeLinejoin="round" />
        <path d="M60 150 Q100 170 142 146 M40 226 Q100 252 162 222 M22 304 Q100 330 180 300" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" opacity="0.85" />
        {LIGHTS.map(([x, y, c], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="6"
            fill={c}
            stroke="#0A0A0A"
            strokeWidth="2.5"
            className={animated ? "lobby-tree-light" : undefined}
            style={animated ? { animationDelay: `${(i % 5) * 0.35}s` } : undefined}
          />
        ))}
        <polygon
          points="100,10 109,34 134,34 114,49 121,73 100,58 79,73 86,49 66,34 91,34"
          fill="#FFD700"
          stroke="#0A0A0A"
          strokeWidth="4"
          strokeLinejoin="round"
          className={animated ? "lobby-tree-star" : undefined}
        />
      </svg>
    </div>
  );
}
