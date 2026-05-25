/* MapPreview.jsx — top-down SVG minimap rendered from an arena's obstacle
   list. Used by the MatchLoadingScreen to give players a visual hint of
   the arena they're loading into.

   The arena coordinate system is centered at (0,0) with +x = east and
   +z = south. We map z → y in SVG (south pointing down) so the preview
   matches the in-game "north is up" convention. */
import { Crosshair } from "lucide-react";

export default function MapPreview({ map, size = 280, fill = false }) {
  if (!map) return null;
  // Footprint in arena coordinates ([-50, 50] each axis for our maps).
  const half = (map.size || 50) + 4;
  const vb = half * 2;                 // viewBox extent
  const inset = 6;                     // padded border so obstacles don't touch the frame
  const pal = map.palette || {};

  // Spawn dots (small lucide-ish markers) — derived from the obstacle list's
  // four corners for variety. Not exact match to server, just decorative.
  const corners = [
    { x: 35, z: 35 }, { x: -35, z: 35 },
    { x: 35, z: -35 }, { x: -35, z: -35 },
  ];

  // When `fill` is true, render at 100% of the parent — used by the
  // practice map selector cards (responsive aspect-square containers).
  const containerStyle = fill
    ? { width: "100%", height: "100%" }
    : { width: size, height: size };

  return (
    <div
      className="relative inline-block border-pow-thick bg-[#0A0A0A]"
      style={containerStyle}
      data-testid={`map-preview-${map.map_id}`}
    >
      <svg
        viewBox={`${-half - inset} ${-half - inset} ${vb + inset * 2} ${vb + inset * 2}`}
        className="block w-full h-full"
        aria-label={`Map preview: ${map.name}`}
      >
        {/* Ground */}
        <rect
          x={-half} y={-half} width={vb} height={vb}
          fill={pal.bg || "#5fae5f"}
        />
        {/* Halftone dot field — comic style texture */}
        <defs>
          <pattern id={`halftone-${map.map_id}`} width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="0.9" fill={pal.border || "#0A0A0A"} opacity="0.18" />
          </pattern>
        </defs>
        <rect x={-half} y={-half} width={vb} height={vb} fill={`url(#halftone-${map.map_id})`} />
        {/* Border */}
        <rect
          x={-half} y={-half} width={vb} height={vb}
          fill="none"
          stroke={pal.border || "#0A0A0A"}
          strokeWidth="2.2"
        />
        {/* Obstacles — rectangles drawn from each obstacle's footprint */}
        {map.obstacles.map((ob, i) => {
          const isCrate = ob.w <= 2 && ob.d <= 2 && ob.h <= 2;
          const isLandmark = ob.h >= 7;
          const fill = isLandmark
            ? (pal.accent || "#FFD700")
            : isCrate
            ? (pal.crate || "#ff7b00")
            : (pal.obstacle || "#b84a3a");
          return (
            <rect
              key={i}
              x={ob.x - ob.w / 2}
              y={ob.z - ob.d / 2}
              width={ob.w}
              height={ob.d}
              fill={fill}
              stroke={pal.border || "#0A0A0A"}
              strokeWidth="0.6"
            />
          );
        })}
        {/* Spawn markers */}
        {corners.map((c, i) => (
          <g key={i} transform={`translate(${c.x},${c.z})`}>
            <circle r="1.6" fill="#FFFFFF" stroke={pal.border || "#0A0A0A"} strokeWidth="0.5" />
            <circle r="0.7" fill={pal.border || "#0A0A0A"} />
          </g>
        ))}
        {/* North indicator */}
        <g transform={`translate(${half - 6},${-half + 6})`}>
          <circle r="3" fill="#0A0A0A" />
          <text x="0" y="0.8" fontSize="3" fontFamily="Anton, sans-serif" fill="#FFD700" textAnchor="middle">N</text>
        </g>
      </svg>
      {/* Crosshair pin at center for that "you are here / arena focus" feel */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        <Crosshair size={20} strokeWidth={3} className="text-white/30" />
      </div>
    </div>
  );
}
