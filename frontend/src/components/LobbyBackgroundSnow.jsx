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

// Tiers: [topY, bottomY, halfWidth]. Bottom edge is scalloped so boughs droop.
const TIERS = [
  [40, 118, 46], [78, 172, 66], [120, 228, 86], [166, 284, 104], [214, 332, 122],
];

function tierPath([top, bottom, hw], cx = 140) {
  const n = Math.max(4, Math.round(hw / 14));
  let d = `M${cx} ${top} `;
  d += `Q${cx + hw * 0.35} ${top + (bottom - top) * 0.45} ${cx + hw} ${bottom} `;
  for (let i = 1; i <= n; i++) {
    const x = cx + hw - (2 * hw * i) / n;
    const mx = x + hw / n;
    d += `Q${mx} ${bottom - 12 + (i % 2) * 3} ${x} ${bottom + (i % 2 ? -4 : 2)} `;
  }
  d += `Q${cx - hw * 0.35} ${top + (bottom - top) * 0.45} ${cx} ${top} Z`;
  return d;
}

const ORNAMENTS = [
  [122, 104, "#E62429"], [158, 132, "#FFD700"], [112, 156, "#2E7DFF"], [176, 186, "#E62429"],
  [96, 210, "#FFD700"], [140, 200, "#C0C0C0"], [190, 240, "#2E7DFF"], [82, 262, "#E62429"],
  [130, 258, "#FFD700"], [214, 300, "#E62429"], [64, 312, "#2E7DFF"], [110, 318, "#C0C0C0"],
  [168, 312, "#FFD700"],
];
const LIGHTS = [
  [138, 84, "#FFE27A"], [104, 134, "#FF6B6B"], [170, 160, "#7CFF6B"], [90, 186, "#FFE27A"],
  [150, 176, "#6BC8FF"], [120, 236, "#FF6B6B"], [70, 240, "#7CFF6B"], [206, 268, "#FFE27A"],
  [156, 284, "#6BC8FF"], [96, 290, "#FFE27A"], [44, 322, "#FF6B6B"], [196, 324, "#7CFF6B"],
  [236, 320, "#6BC8FF"], [140, 330, "#FF6B6B"],
];
// [x, y(bottom), w, h, body, ribbon]
const PRESENTS = [
  [22, 376, 62, 44, "#E62429", "#FFD700"],
  [70, 382, 46, 30, "#2E7DFF", "#FFFFFF"],
  [168, 380, 54, 52, "#1FA34A", "#E62429"],
  [214, 384, 50, 34, "#FFD700", "#9B1C1C"],
  [118, 388, 40, 24, "#9B59B6", "#FFD700"],
];

function Present({ x, y, w, h, body, ribbon }) {
  const top = y - h;
  const depth = 8;
  return (
    <g>
      <polygon points={`${x},${top} ${x + depth},${top - depth} ${x + w + depth},${top - depth} ${x + w},${top}`} fill={body} stroke="#0A0A0A" strokeWidth="3" strokeLinejoin="round" style={{ filter: "brightness(1.25)" }} />
      <polygon points={`${x + w},${top} ${x + w + depth},${top - depth} ${x + w + depth},${y - depth} ${x + w},${y}`} fill={body} stroke="#0A0A0A" strokeWidth="3" strokeLinejoin="round" style={{ filter: "brightness(0.7)" }} />
      <rect x={x} y={top} width={w} height={h} fill={body} stroke="#0A0A0A" strokeWidth="3.5" />
      <rect x={x + w / 2 - 4} y={top} width="8" height={h} fill={ribbon} stroke="#0A0A0A" strokeWidth="1.5" />
      <rect x={x} y={top + h / 2 - 3.5} width={w} height="7" fill={ribbon} stroke="#0A0A0A" strokeWidth="1.5" />
      <path d={`M${x + w / 2 + depth / 2} ${top - depth / 2} q-16 -16 -18 -2 q2 8 18 2 q16 -16 18 -2 q-2 8 -18 2`} fill={ribbon} stroke="#0A0A0A" strokeWidth="2.5" strokeLinejoin="round" />
    </g>
  );
}

function ChristmasTree({ animated }) {
  return (
    <div
      className="absolute bottom-0 left-[46%] -translate-x-1/2 pointer-events-none w-[44vmin] min-w-[170px] max-w-[400px]"
      aria-hidden
      data-testid="lobby-snow-christmas-tree"
    >
      <svg viewBox="0 0 280 400" className="w-full h-auto drop-shadow-[6px_6px_0_rgba(0,0,0,0.3)]">
        <defs>
          <linearGradient id="xmas-needles" x1="0" x2="1" y1="0" y2="0.3">
            <stop offset="0" stopColor="#0E4D22" />
            <stop offset="0.55" stopColor="#1C7A36" />
            <stop offset="1" stopColor="#2E9A4A" />
          </linearGradient>
          <linearGradient id="xmas-trunk" x1="0" x2="1">
            <stop offset="0" stopColor="#4A2A12" />
            <stop offset="1" stopColor="#8A5A2E" />
          </linearGradient>
          <radialGradient id="xmas-shine" cx="0.35" cy="0.3" r="0.7">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
            <stop offset="0.35" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="140" cy="388" rx="136" ry="12" fill="#F4FAFF" stroke="#0A0A0A" strokeWidth="3" />
        <rect x="126" y="326" width="28" height="56" fill="url(#xmas-trunk)" stroke="#0A0A0A" strokeWidth="4" />
        {[...TIERS].reverse().map((t, i) => (
          <g key={i}>
            <path d={tierPath(t)} fill="url(#xmas-needles)" stroke="#0A0A0A" strokeWidth="4.5" strokeLinejoin="round" />
            <path d={tierPath([t[0] + (t[1] - t[0]) * 0.55, t[1] - 2, t[2] * 0.82])} fill="#0B3D1B" opacity="0.45" />
            <path d={`M${140 - t[2] * 0.25} ${t[0] + (t[1] - t[0]) * 0.32} Q140 ${t[0] + (t[1] - t[0]) * 0.22} ${140 + t[2] * 0.3} ${t[0] + (t[1] - t[0]) * 0.34}`} fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
          </g>
        ))}
        <path d="M92 148 Q140 172 196 140 M62 214 Q140 246 214 206 M40 276 Q140 312 236 268" fill="none" stroke="#FFD700" strokeWidth="2.5" strokeDasharray="2 5" strokeLinecap="round" opacity="0.9" />
        {LIGHTS.map(([x, y, c], i) => (
          <circle key={`l${i}`} cx={x} cy={y} r="4" fill={c}
            className={animated ? "lobby-tree-light" : undefined}
            style={{ filter: `drop-shadow(0 0 4px ${c})`, ...(animated ? { animationDelay: `${(i % 5) * 0.35}s` } : {}) }} />
        ))}
        {ORNAMENTS.map(([x, y, c], i) => (
          <g key={`o${i}`}>
            <line x1={x} y1={y - 12} x2={x} y2={y - 7} stroke="#0A0A0A" strokeWidth="1.5" />
            <circle cx={x} cy={y} r="7.5" fill={c} stroke="#0A0A0A" strokeWidth="2.5" />
            <circle cx={x} cy={y} r="7.5" fill="url(#xmas-shine)" />
          </g>
        ))}
        <polygon
          points="140,6 149,28 173,28 154,42 161,66 140,52 119,66 126,42 107,28 131,28"
          fill="#FFD700" stroke="#0A0A0A" strokeWidth="4" strokeLinejoin="round"
          className={animated ? "lobby-tree-star" : undefined}
          style={{ filter: "drop-shadow(0 0 6px rgba(255,215,0,0.8))" }}
        />
        {PRESENTS.map(([x, y, w, h, body, ribbon], i) => (
          <Present key={`p${i}`} x={x} y={y} w={w} h={h} body={body} ribbon={ribbon} />
        ))}
      </svg>
    </div>
  );
}
