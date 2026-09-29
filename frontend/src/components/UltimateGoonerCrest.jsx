/* UltimateGoonerCrest — full-fat animated Ultimate Gooner emblem.

   Used by:
     • Lobby `RankBadge` — the giant gold-and-flame pill up top of the
       page when the local user is top-50 Goonmaster.
     • PlayerCard `Avatar` (Peak Crest, idx 5) — the trading-card
       avatar bubble when the player's peak rank is Ultimate Gooner.

   Every layer is a `position: absolute` sibling on top of a
   `position: relative` root so the crest scales cleanly from ~36px
   (avatar bubble) up to ~64px (lobby rank pill).

   Layers, back → front:
     1. `ug-crest-halo`     — pulsing radial gold→red glow (2.2s cycle)
     2. `ug-crest-rays`     — 8 rotating gold rays behind the flame
                              (spins 6s / one full rotation, ease-linear)
     3. `ug-crest-star-*`   — 3 orbiting star sparks (counter-rotating,
                              1.4s / 2.0s / 2.6s to break repetition)
     4. `ug-crest-flame`    — the lucide Flame icon w/ anim-flame-flicker
                              (existing keyframes) + drop-shadow
     5. `ug-crest-scanline` — 1-frame gold sheen sweeping across every
                              3.5s (subtle gloss, sells the prestige)

   `size` sets the container edge in px; every layer is size-relative
   so proportions stay honest at any resolution.

   `rank` (optional 1..50): when supplied, overlays the leaderboard
   position as a bold Bangers/Anton number in the flame's belly,
   matching UltimateGoonerBadge's rank chip. Omit for a clean crest
   (lobby pill uses this — the "#N" sits beside it as its own pill).
*/
import { Flame } from "lucide-react";

export default function UltimateGoonerCrest({
  size = 48,
  rank = null,
  className = "",
  paused: pausedProp = false,
  "data-testid": testid = "ultimate-gooner-crest",
}) {
  // Motion default: ON everywhere (including mobile). Previously
  // auto-paused on touch devices as a perf safeguard, but the crest
  // is a hero element in the lobby rank pill + PlayerCard peak-crest
  // avatar + tiers modal — killing the motion on phones made the
  // pinnacle rank feel flat. Modern mobile GPUs handle the composite
  // fine at the number of instances we render. Callers can still opt
  // out with `paused={true}` for screenshots / PDFs.
  const paused = !!pausedProp;
  const showRank = Number.isFinite(rank) && rank >= 1 && rank <= 50;
  const digitCount = showRank ? String(rank).length : 1;
  const fontPx = Math.max(8, Math.round(size * (digitCount >= 2 ? 0.32 : 0.38)));
  return (
    <span
      className={`ug-crest inline-flex items-center justify-center relative ${paused ? "ug-crest-paused" : ""} ${className}`}
      style={{ width: size, height: size }}
      data-testid={testid}
      data-paused={paused ? "true" : "false"}
      title={showRank ? `Ultimate Gooner — Rank #${rank}` : "Ultimate Gooner"}
    >
      {/* 1. Pulsing radial halo behind everything else. */}
      <span aria-hidden className="ug-crest-halo" />

      {/* 2. Rotating spoke rays — CSS-only conic-gradient trick so we
             don't have to inline 8 SVG lines. */}
      <span aria-hidden className="ug-crest-rays" />

      {/* 3. Orbiting sparks — three tiny gold pips on independent orbits.
             The pip is a positioned pseudo-element inside each rotator so
             the parent handles the spin and the child stays a stable
             gold dot. */}
      <span aria-hidden className="ug-crest-orbit ug-crest-orbit-a">
        <span className="ug-crest-spark" />
      </span>
      <span aria-hidden className="ug-crest-orbit ug-crest-orbit-b">
        <span className="ug-crest-spark ug-crest-spark-sm" />
      </span>
      <span aria-hidden className="ug-crest-orbit ug-crest-orbit-c">
        <span className="ug-crest-spark ug-crest-spark-sm" />
      </span>

      {/* 4. The flame — the actual crest silhouette. Size is 62% of the
             container to leave room for the halo + rays. */}
      <Flame
        size={Math.round(size * 0.62)}
        strokeWidth={3}
        color="#0A0A0A"
        fill="#FFD700"
        className="ug-crest-flame relative"
      />

      {/* 5. Gold sheen sweep — a slim diagonal highlight that scrolls
             across the flame every ~3.5s. Absolutely last so it lands
             on top. */}
      <span aria-hidden className="ug-crest-sheen" />

      {/* Optional rank chip — kept as a subtle overlay so callers who
          already render a "#N" beside the crest (e.g. lobby RankBadge)
          can omit it. */}
      {showRank && (
        <span
          className="ug-crest-rank-chip"
          style={{ fontSize: `${fontPx}px` }}
          data-testid={`${testid}-rank`}
        >
          {rank}
        </span>
      )}
    </span>
  );
}
