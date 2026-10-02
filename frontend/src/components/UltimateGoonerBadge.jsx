/* UltimateGoonerBadge — displayed for the top-50 GOONMASTER players.
 *
 * Renders a flame icon (matching Goonmaster's tier icon) with the
 * player's global leaderboard rank number overlaid centered on top.
 * Sized to match the surrounding rank pills.
 *
 * Usage:
 *   {isUltimateGooner(tier, rank) && <UltimateGoonerBadge rank={rank} size={22} />}
 *
 * `size` defaults to 22px which matches the standard rank pill height
 * in PlayerCard's medium variant; override for compact rows in the
 * scoreboard or friends list.
 */
import { Flame } from "lucide-react";

export default function UltimateGoonerBadge({ rank, size = 22, "data-testid": testid = "ultimate-gooner-badge" }) {
  if (!Number.isFinite(rank) || rank < 1 || rank > 50) return null;
  // Font size scales roughly linearly with the badge size; digits render
  // slightly smaller so a 2-digit "#48" fits without hitting the flame edges.
  const digitCount = String(rank).length;
  const fontPx = Math.max(8, Math.round(size * (digitCount >= 2 ? 0.42 : 0.5)));
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size + 6, height: size + 6 }}
      data-testid={testid}
      aria-label={`Ultimate Gooner — Rank #${rank}`}
    >
      {/* Warm halo behind the flame — sells the "top-tier prestige" look. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(255,200,60,0.55) 0%, rgba(255,120,20,0.25) 45%, transparent 70%)",
          filter: "blur(2px)",
        }}
      />
      {/* Flame silhouette — dark outline + gold fill for high contrast on
          any pill background. Uses lucide's Flame path so the icon lines
          up perfectly with Goonmaster's existing tier icon. */}
      <Flame
        size={size + 4}
        strokeWidth={3}
        color="#0A0A0A"
        fill="#FFD700"
        className="relative z-[1]"
      />
      {/* Rank number overlay — Bangers/Anton stack so it looks like a
          comic-book crest number. Positioned slightly lower than center
          to sit inside the flame's belly, not on its tip. */}
      <span
        className="absolute z-[2] font-anton leading-none pointer-events-none"
        style={{
          top: "58%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: `${fontPx}px`,
          color: "#0A0A0A",
          textShadow: "0 0 3px #FFD700, 0 0 6px #FFD700",
          letterSpacing: "0",
        }}
      >
        {rank}
      </span>
    </span>
  );
}
