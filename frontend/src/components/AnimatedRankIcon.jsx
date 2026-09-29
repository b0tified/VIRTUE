/* AnimatedRankIcon — animated, division-aware rank crest.

   Renders the lucide icon for a tier (0..7) wrapped in layered ornaments
   that scale with the division (1 = top, 2 = mid, 3 = entry, 0 =
   Goonmaster). The higher the division, the more detail the crest gets:

     • Division 3 (entry): plain icon with a soft pulse glow.
     • Division 2 (middle): adds a single slow-orbiting accent star and
       a brighter pulse.
     • Division 1 (top): adds a rotating halo ring, two counter-orbiting
       accent stars, and the strongest pulse.
     • Goonmaster: special — flame flicker behind, rotating gold trim,
       continuous spark shimmer.

   Animations live in /app/frontend/src/index.css under the
   `@keyframes rank-*` block. The component is a pure presentational
   wrapper around the existing `rankIconFor` icons.
*/
import { rankIconFor, rankColorFor } from "@/game/rankIcons";
import { Sparkles, Star } from "lucide-react";

export default function AnimatedRankIcon({
  tier = 0,
  division = 0,
  size = 64,
  // When true, animations are paused — used by static contexts like
  // PDFs or screenshots. Defaults to `false` (motion ON everywhere,
  // including mobile). Previously auto-paused on touch devices as a
  // perf safeguard, but that also killed the rank pulse in the lobby
  // rank pill and tiers modal on phones — where the crest is a hero
  // element. Modern mobile GPUs handle the composite cost fine at the
  // number of instances we render (rank pill + a few list rows).
  paused: pausedProp = false,
  className = "",
  testid = "animated-rank-icon",
}) {
  const paused = !!pausedProp;
  const t = Math.max(0, Math.min(8, Number.isFinite(tier) ? tier : 0));
  const d = t === 8 ? 0 : Math.max(1, Math.min(3, Number.isFinite(division) ? division : 3));
  const Icon = rankIconFor(t);
  const color = rankColorFor(t);
  const isGoon = t === 8;
  // Intensity ramp keyed to division (1 = strongest). Goonmaster is
  // treated as "always max" because it has no sub-divisions.
  const intensity = isGoon ? "goon" : `div${d}`;
  return (
    <span
      className={`rank-icon-anim rank-icon-${intensity} ${className}`}
      data-paused={paused ? "true" : "false"}
      data-tier={t}
      data-division={d}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        width: size,
        height: size,
        // Expose color as a CSS var so keyframes can use it.
        "--rank-color": color,
      }}
      data-testid={testid}
    >
      {/* Soft pulse glow — sits BEHIND the icon. Strength scales with division. */}
      <span aria-hidden="true" className="rank-icon-glow" />

      {/* Halo ring (division 1 + Goonmaster only). */}
      {(d === 1 || isGoon) && (
        <span aria-hidden="true" className="rank-icon-halo" />
      )}

      {/* Orbit accents — orbiting sparkles whose count grows with division. */}
      {(d <= 2 || isGoon) && (
        <span aria-hidden="true" className="rank-icon-orbit rank-icon-orbit-a">
          <Sparkles size={Math.max(8, Math.round(size * 0.18))} strokeWidth={3} color={color} />
        </span>
      )}
      {(d === 1 || isGoon) && (
        <span aria-hidden="true" className="rank-icon-orbit rank-icon-orbit-b">
          <Star size={Math.max(8, Math.round(size * 0.16))} strokeWidth={3} color={color} fill={color} />
        </span>
      )}

      {/* Goonmaster-only flame flicker layer behind everything. */}
      {isGoon && (
        <span aria-hidden="true" className="rank-icon-goon-flame" />
      )}

      {/* Goonmaster gold shimmer overlay. */}
      {isGoon && (
        <span aria-hidden="true" className="rank-icon-goon-shimmer" />
      )}

      {/* The base lucide icon. */}
      <Icon
        size={Math.round(size * 0.62)}
        strokeWidth={3}
        color={isGoon ? "#FFD700" : color}
        style={{
          position: "relative",
          zIndex: 2,
          filter: "drop-shadow(0 2px 0 rgba(0,0,0,0.45))",
        }}
      />
    </span>
  );
}
