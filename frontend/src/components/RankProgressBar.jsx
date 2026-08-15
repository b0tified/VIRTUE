/* RankProgressBar — comic-styled progress bar that shows how close a
   player is to their next sub-division (or next main tier when sitting
   at division I). Designed to slot under the lobby's rank badge and
   inside the Profile's Current Rank card so friends viewing a public
   profile can see how close someone is to promotion.

   Props:
     - tier:     main rank index 0..8 (Bronze..Emerald..Goonmaster)
     - division: 1 = top, 2 = mid, 3 = entry, 0 = Goonmaster (undivided)
     - points:   current RP (integer)
     - testid:   data-testid prefix (default "rank-progress")
     - compact:  if true, hide the "next" label (used in tight layouts)

   Behaviour:
     • Goonmaster (division 0): renders an inert "MAX RANK" pill instead
       of a bar — there's nothing left to promote to.
     • Otherwise: bar fills (points - division_low) / division_width. The
       right-hand label reads "→ NEXT TIER" (next division within tier OR
       next main tier when crossing the I → next-tier-III boundary).
*/
import { rankColorFor, RANK_NAMES, divisionRoman } from "@/game/rankIcons";

// Match RANK_TIERS in /app/backend/server.py — 9 tiers with EMERALD
// slotted between PLATINUM and DIAMOND. Every tier is exactly 300 RP
// wide (100 RP per division: III / II / I).
const RANK_THRESHOLDS = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400];
const GOONMASTER_IDX = RANK_THRESHOLDS.length - 1;   // 8

// Return the width in RP of one sub-division for a given tier. Every
// tier splits its span into 3 equal divisions:
//   Bronze..Grandmaster → 100 RP / division (all tiers now 300 RP wide)
// Goonmaster is undivided (returns 0).
function divisionWidthForTier(t) {
  if (t >= GOONMASTER_IDX) return 0;
  const span = RANK_THRESHOLDS[t + 1] - RANK_THRESHOLDS[t];
  return Math.max(1, Math.round(span / 3));
}

export default function RankProgressBar({
  tier = 0,
  division = 0,
  points = 0,
  compact = false,
  className = "",
  testid = "rank-progress",
}) {
  const t = Math.max(0, Math.min(GOONMASTER_IDX, Number.isFinite(tier) ? tier : 0));
  // Goonmaster is undivided — no progression bar.
  if (t >= GOONMASTER_IDX) {
    return (
      <div
        className={`inline-flex items-center gap-2 border-pow shadow-pow-sm bg-[#FFD700] text-black px-3 py-1 font-anton uppercase tracking-widest text-xs ${className}`}
        data-testid={`${testid}-max`}
      >
        <span>MAX RANK</span>
        <span className="opacity-70 tabular-nums">{points} RP</span>
      </div>
    );
  }
  const d = Math.max(1, Math.min(3, Number.isFinite(division) ? division : 3));
  const tierLow = RANK_THRESHOLDS[t];
  const divisionWidth = divisionWidthForTier(t);
  // Within the tier, sub-divisions are stacked from entry (III) → top (I):
  // [tierLow .. +width) (III), [tierLow+width .. +2*width) (II), [tierLow+2*width .. +3*width) (I).
  const divisionLow = tierLow + (3 - d) * divisionWidth;
  const divisionHigh = divisionLow + divisionWidth;
  const p = Math.max(divisionLow, Math.min(divisionHigh, Number.isFinite(points) ? points : divisionLow));
  const into = p - divisionLow;
  const pct = Math.max(0, Math.min(100, (into / divisionWidth) * 100));
  const color = rankColorFor(t);
  // Next milestone label.
  let nextLabel;
  if (d > 1) {
    // Promote within the same tier (III → II, II → I).
    nextLabel = `${RANK_NAMES[t]} ${divisionRoman(d - 1)}`;
  } else {
    // d == 1 → next promotion crosses into the next main tier's entry sub-div.
    const nextTierName = RANK_NAMES[Math.min(t + 1, RANK_NAMES.length - 1)];
    // Goonmaster has no division suffix.
    nextLabel = (t + 1) >= GOONMASTER_IDX ? nextTierName : `${nextTierName} III`;
  }
  return (
    <div className={`flex flex-col gap-1 ${className}`} data-testid={testid}>
      <div className="flex items-center justify-between text-[10px] sm:text-xs font-anton uppercase tracking-widest gap-2">
        <span className="text-neutral-500 tabular-nums" data-testid={`${testid}-current`}>
          {into} / {divisionWidth}
        </span>
        {!compact && (
          <span className="text-neutral-700" data-testid={`${testid}-next`}>
            <span className="opacity-50">→</span> {nextLabel}
          </span>
        )}
      </div>
      <div
        className="relative h-3 sm:h-3.5 border-2 border-black bg-neutral-100 overflow-hidden"
        title={`${into} / ${divisionWidth} RP to ${nextLabel}`}
      >
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}, ${color}cc)`,
            boxShadow: `inset 0 0 6px ${color}88`,
          }}
          data-testid={`${testid}-fill`}
          data-pct={Math.round(pct)}
        />
        {/* Diagonal stripes overlay for the comic feel. */}
        <div
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, #fff 0 4px, transparent 4px 10px)",
          }}
        />
      </div>
    </div>
  );
}
