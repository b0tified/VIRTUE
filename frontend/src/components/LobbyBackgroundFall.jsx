// Fall lobby: warm sunset sky, rolling hills, autumn trees, falling leaves.
const LEAF_COLORS = ["#E2561B", "#F28C28", "#C7361F", "#E8B12A", "#9C3A12", "#D9701E"];

const MAPLE = "M0 -14 L3 -6 L10 -9 L7 -2 L13 1 L6 3 L8 10 L1 6 L0 14 L-1 6 L-8 10 L-6 3 L-13 1 L-7 -2 L-10 -9 L-3 -6 Z";
const OAK = "M0 -14 C5 -12 3 -8 7 -7 C11 -6 6 -2 9 0 C12 3 6 4 7 7 C8 11 2 9 0 14 C-2 9 -8 11 -7 7 C-6 4 -12 3 -9 0 C-6 -2 -11 -6 -7 -7 C-3 -8 -5 -12 0 -14 Z";

// [left%, delay s, duration s, size px, shape, colorIdx]
const LEAVES = [
  [4, 0, 11, 26, 0, 0], [11, 3.2, 13, 20, 1, 3], [18, 6.5, 10, 30, 0, 2], [26, 1.4, 12, 22, 1, 1],
  [33, 8.1, 14, 18, 0, 4], [40, 4.4, 11, 28, 1, 5], [48, 0.8, 13, 24, 0, 3], [55, 5.9, 10, 20, 1, 0],
  [62, 2.6, 12, 32, 0, 1], [69, 7.3, 14, 22, 1, 2], [76, 1.9, 11, 26, 0, 5], [83, 9.0, 13, 18, 1, 3],
  [90, 3.8, 10, 28, 0, 0], [96, 6.1, 12, 22, 1, 4], [22, 10.5, 9, 34, 0, 1], [58, 11.2, 9, 30, 1, 2],
];

function Leaf({ size, shape, color, style, className }) {
  return (
    <svg viewBox="-15 -15 30 30" width={size} height={size} className={className} style={style}>
      <path d={shape ? OAK : MAPLE} fill={color} stroke="#3A1A08" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M0 -10 L0 14" stroke="#3A1A08" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function AutumnTree({ x, scale, flip }) {
  return (
    <g transform={`translate(${x} 0) scale(${flip ? -scale : scale} ${scale})`}>
      <path d="M-6 0 L-4 -60 Q-20 -80 -30 -84 M-4 -60 L-3 -95 M-3 -80 Q12 -96 24 -98" stroke="#3A1F10" strokeWidth="9" fill="none" strokeLinecap="round" />
      <circle cx="-30" cy="-100" r="26" fill="#C7361F" stroke="#0A0A0A" strokeWidth="4" />
      <circle cx="22" cy="-112" r="30" fill="#E2561B" stroke="#0A0A0A" strokeWidth="4" />
      <circle cx="-6" cy="-130" r="32" fill="#F28C28" stroke="#0A0A0A" strokeWidth="4" />
      <circle cx="-14" cy="-138" r="10" fill="#FFC15A" opacity="0.7" />
    </g>
  );
}

function Landscape() {
  return (
    <svg className="absolute bottom-0 left-0 w-full h-[42%]" viewBox="0 0 1600 400" preserveAspectRatio="none" aria-hidden>
      <path d="M0 220 Q200 150 420 200 T860 180 T1300 170 T1600 190 L1600 400 L0 400 Z" fill="#B5532A" opacity="0.55" />
      <path d="M0 280 Q260 220 560 270 T1100 250 T1600 260 L1600 400 L0 400 Z" fill="#8C3B1E" stroke="#0A0A0A" strokeWidth="4" />
    </svg>
  );
}

export default function LobbyBackgroundFall({ animated = true }) {
  return (
    <>
      <div className="absolute inset-0 lobby-fall-sky" aria-hidden />
      <div className="absolute inset-0 lobby-fall-sun" aria-hidden />
      <div className="absolute inset-0 lobby-fall-halftone" aria-hidden />
      <Landscape />
      <svg className="absolute bottom-[10%] left-[1%] h-[38%]" viewBox="-80 -180 160 185" aria-hidden><AutumnTree x={0} scale={1} /></svg>
      <svg className="absolute bottom-[8%] left-[46%] -translate-x-1/2 h-[52%]" viewBox="-80 -180 160 185" aria-hidden><AutumnTree x={0} scale={1} flip /></svg>
      <svg className="absolute bottom-[12%] right-[9%] h-[26%]" viewBox="-80 -180 160 185" aria-hidden><AutumnTree x={0} scale={1} flip /></svg>
      <svg className="absolute bottom-[8%] right-[0%] h-[44%]" viewBox="-80 -180 160 185" aria-hidden><AutumnTree x={0} scale={1} /></svg>
      <div className="absolute bottom-0 left-0 w-full h-[9%] bg-[#5E2A14] border-t-4 border-black" aria-hidden />
      <svg className="absolute bottom-[3%] left-[46%] -translate-x-1/2 w-[30vmin]" viewBox="-60 -20 120 30" aria-hidden>
        {[[-44, 0, 0], [-28, -6, 3], [-12, 2, 1], [0, -8, 5], [14, 0, 2], [28, -5, 0], [42, 1, 3], [-20, -12, 4], [20, -12, 1]].map(([x, y, c], i) => (
          <path key={i} d={i % 2 ? OAK : MAPLE} transform={`translate(${x} ${y}) rotate(${i * 53}) scale(0.7)`} fill={LEAF_COLORS[c]} stroke="#3A1A08" strokeWidth="1.6" />
        ))}
      </svg>
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden data-testid="lobby-fall-leaves">
        {LEAVES.map(([left, delay, dur, size, shape, ci], i) =>
          animated ? (
            <div key={i} className="lobby-fall-leaf" style={{ left: `${left}%`, animationDelay: `-${delay}s`, animationDuration: `${dur}s` }}>
              <Leaf size={size} shape={shape} color={LEAF_COLORS[ci]} className="lobby-fall-leaf-sway" style={{ animationDuration: `${2.6 + (i % 4) * 0.5}s` }} />
            </div>
          ) : (
            <Leaf key={i} size={size} shape={shape} color={LEAF_COLORS[ci]} className="absolute"
              style={{ left: `${left}%`, top: `${(i * 37) % 70 + 5}%`, transform: `rotate(${i * 47}deg)` }} />
          )
        )}
      </div>
    </>
  );
}
