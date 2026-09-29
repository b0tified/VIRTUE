/* Custom rank crests — chevron-based, progressively more elaborate from
   Bronze → Goonmaster (was "Champion" in the reference art). Each icon is
   drop-in compatible with lucide-react's API so consumers can pass
   `size`, `strokeWidth`, `color`, `style`, `className` — same as
   `<Shield />`, `<Star />`, etc.

   Design principles (matches the referenced Marvel-Rivals-style set):
     • All icons share a 24×24 viewBox so scaling stays consistent.
     • Fills use `currentColor` (or the explicit `color` prop) so the
       existing per-tier color palette in rankIcons.js drives the paint.
     • Stroke stays a hair line — the crests are largely fill-based
       silhouettes so they read at any size (16px scoreboard chip →
       128px celebration).
     • Complexity ramps division-agnostic: Bronze = single chevron;
       every higher tier layers another wing, spike, or crown element
       until Goonmaster fans out a full crown-with-tail.
*/
import React from "react";

// Shared props helper — folds the lucide-compat API into <svg> attrs.
function _svgProps({
  size = 24,
  strokeWidth = 2,
  color = "currentColor",
  className = "",
  style = null,
  ...rest
}) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: color,
    stroke: color,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    style,
    xmlns: "http://www.w3.org/2000/svg",
    ...rest,
  };
}

/** BRONZE — single downward chevron. Cleanest silhouette in the set. */
export function BronzeCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      <path d="M3.5 6.5 L12 18 L20.5 6.5 L16 6.5 L12 11.5 L8 6.5 Z" />
    </svg>
  );
}

/** SILVER — chevron with an inner V, hinting at a second layer. */
export function SilverCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      <path d="M3.5 6.5 L12 18 L20.5 6.5 L16 6.5 L12 11.5 L8 6.5 Z" />
      <path d="M9.5 6.5 L12 9.5 L14.5 6.5 L13 6.5 L12 7.7 L11 6.5 Z" fillOpacity="0.85" />
    </svg>
  );
}

/** GOLD — double-stacked chevron. */
export function GoldCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      <path d="M3.5 4.5 L12 15 L20.5 4.5 L16 4.5 L12 8.6 L8 4.5 Z" />
      <path d="M5.5 10 L12 19 L18.5 10 L15 10 L12 13.5 L9 10 Z" fillOpacity="0.9" />
    </svg>
  );
}

/** PLATINUM — chevron flanked by short shoulder wings. */
export function PlatinumCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      {/* left wing */}
      <path d="M1.5 8 L4.5 6 L5.5 9 L3 11 Z" fillOpacity="0.9" />
      {/* right wing */}
      <path d="M22.5 8 L19.5 6 L18.5 9 L21 11 Z" fillOpacity="0.9" />
      {/* central chevron */}
      <path d="M4.5 5.5 L12 18 L19.5 5.5 L15 5.5 L12 10.5 L9 5.5 Z" />
    </svg>
  );
}

/** EMERALD — two chevrons + shoulder wings. */
export function EmeraldCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      <path d="M1.2 7.5 L4.5 5 L5.8 8.5 L3 11 Z" fillOpacity="0.85" />
      <path d="M22.8 7.5 L19.5 5 L18.2 8.5 L21 11 Z" fillOpacity="0.85" />
      <path d="M4 4.5 L12 14 L20 4.5 L16 4.5 L12 8.8 L8 4.5 Z" />
      <path d="M6 10 L12 19 L18 10 L15 10 L12 13.5 L9 10 Z" fillOpacity="0.85" />
    </svg>
  );
}

/** DIAMOND — three chevrons + wings extending upward. */
export function DiamondCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      <path d="M1 8 L3 4 L6 6 L4.5 10 Z" fillOpacity="0.85" />
      <path d="M23 8 L21 4 L18 6 L19.5 10 Z" fillOpacity="0.85" />
      <path d="M4 3.5 L12 12 L20 3.5 L16.5 3.5 L12 7.5 L7.5 3.5 Z" />
      <path d="M5 8 L12 15.5 L19 8 L15.5 8 L12 11.5 L8.5 8 Z" fillOpacity="0.9" />
      <path d="M6.5 13 L12 20 L17.5 13 L14.5 13 L12 15.7 L9.5 13 Z" fillOpacity="0.8" />
    </svg>
  );
}

/** MASTER — chevron with a crown crest above (small spikes) + wings. */
export function MasterCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      {/* crown spikes */}
      <path d="M8 5 L9 2 L10 5 Z" />
      <path d="M11 4 L12 1 L13 4 Z" />
      <path d="M14 5 L15 2 L16 5 Z" />
      {/* wings */}
      <path d="M1 9 L4 6.5 L5.5 10 L3 12 Z" fillOpacity="0.85" />
      <path d="M23 9 L20 6.5 L18.5 10 L21 12 Z" fillOpacity="0.85" />
      {/* central chevron */}
      <path d="M4.5 6 L12 18 L19.5 6 L15.5 6 L12 11 L8.5 6 Z" />
      {/* inner accent */}
      <path d="M9 10 L12 14 L15 10 L13.5 10 L12 12 L10.5 10 Z" fillOpacity="0.85" />
    </svg>
  );
}

/** GRANDMASTER — layered crown with side wings + double chevron. */
export function GrandmasterCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      {/* crown row */}
      <path d="M7 5 L8 1.5 L9 5 Z" />
      <path d="M10 4 L11 1 L12 3.5 L13 1 L14 4 Z" />
      <path d="M15 5 L16 1.5 L17 5 Z" />
      {/* wings outer */}
      <path d="M0.5 10 L3.5 6 L5.5 9.5 L3 12.5 Z" fillOpacity="0.9" />
      <path d="M23.5 10 L20.5 6 L18.5 9.5 L21 12.5 Z" fillOpacity="0.9" />
      {/* wings inner (below outer, more subtle) */}
      <path d="M2 13 L4.5 10 L6 12.5 L4 15 Z" fillOpacity="0.7" />
      <path d="M22 13 L19.5 10 L18 12.5 L20 15 Z" fillOpacity="0.7" />
      {/* central chevron */}
      <path d="M5 6 L12 17 L19 6 L15.5 6 L12 11 L8.5 6 Z" />
      {/* inner chevron */}
      <path d="M6.5 11 L12 19 L17.5 11 L14.5 11 L12 14.5 L9.5 11 Z" fillOpacity="0.9" />
    </svg>
  );
}

/** GOONMASTER — reference image's "CHAMPION" crest, remapped. Full
    crown, extended wings, and a downward tail flourish. */
export function GoonmasterCrest(props) {
  return (
    <svg {..._svgProps(props)}>
      {/* tall crown spikes */}
      <path d="M6.5 4.5 L7.5 0.5 L8.5 4.5 Z" />
      <path d="M9 4 L10 0 L11 3.5 L12 0 L13 0 L14 3.5 L15 0 L16 4 Z" />
      <path d="M15.5 4.5 L16.5 0.5 L17.5 4.5 Z" />
      {/* outer wing pair */}
      <path d="M0 10 L3 5.5 L5.5 9.5 L2.5 13 Z" fillOpacity="0.95" />
      <path d="M24 10 L21 5.5 L18.5 9.5 L21.5 13 Z" fillOpacity="0.95" />
      {/* inner wing pair */}
      <path d="M1.5 13.5 L4.5 10.5 L6 13.5 L3.5 16 Z" fillOpacity="0.75" />
      <path d="M22.5 13.5 L19.5 10.5 L18 13.5 L20.5 16 Z" fillOpacity="0.75" />
      {/* central shield chevron */}
      <path d="M5 5.5 L12 16 L19 5.5 L15 5.5 L12 10 L9 5.5 Z" />
      {/* inner chevron */}
      <path d="M6.5 10 L12 18 L17.5 10 L14.5 10 L12 13.5 L9.5 10 Z" fillOpacity="0.92" />
      {/* tail flourish */}
      <path d="M9.5 18 L12 23 L14.5 18 L13 18 L12 20 L11 18 Z" fillOpacity="0.85" />
    </svg>
  );
}

/** Convenience map for rankIcons.js. Order MUST match RANK_NAMES: */
export const RANK_CREST_COMPONENTS = [
  BronzeCrest,       // 0 Bronze
  SilverCrest,       // 1 Silver
  GoldCrest,         // 2 Gold
  PlatinumCrest,     // 3 Platinum
  EmeraldCrest,      // 4 Emerald
  DiamondCrest,      // 5 Diamond
  MasterCrest,       // 6 Master
  GrandmasterCrest,  // 7 Grandmaster
  GoonmasterCrest,   // 8 Goonmaster (reference art's "Champion")
];
