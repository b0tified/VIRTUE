// Shared rank-icon and rank-color metadata so every component renders the same
// crest for a given tier (0..8 = Bronze .. Goonmaster). Emerald sits between
// Platinum and Diamond as a stepping-stone tier. Each main tier (except
// Goonmaster) is split into 3 sub-divisions (III → II → I, lowest → highest
// within the tier) — see `rankDivisionForPoints`.
//
// Icon set: custom chevron-based crests inspired by the Marvel Rivals
// rank ladder (Bronze single chevron → Goonmaster full crown-with-tail).
// See RankCrestIcons.jsx for the SVGs. Each crest is drop-in compatible
// with the previous lucide-react API (size/strokeWidth/color/style).
import { RANK_CREST_COMPONENTS } from "@/components/RankCrestIcons";

export const RANK_COLORS = [
  "#E67E22", // Bronze — warm orange (matches reference art)
  "#B8C4CC", // Silver — cool gray
  "#F1C40F", // Gold — bright yellow-gold
  "#A3E4B8", // Platinum — mint green
  "#2ECC71", // Emerald — bright green
  "#4A90E2", // Diamond — cornflower blue
  "#7BE04C", // Master — lime green
  "#8E44FF", // Grandmaster — purple
  "#D959D9", // Goonmaster — magenta (reference art's "Champion")
];

export const RANK_NAMES = [
  "BRONZE", "SILVER", "GOLD", "PLATINUM",
  "EMERALD",
  "DIAMOND", "MASTER", "GRANDMASTER", "GOONMASTER",
];

// Thresholds must match RANK_TIERS in /app/backend/server.py so a
// client-side fallback can compute the right division when the server
// payload predates this field. Every tier is 300 RP wide (100 per
// division). Emerald slot (index 4) at 1200 RP.
const RANK_THRESHOLDS = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400];

export const RANK_ICONS = RANK_CREST_COMPONENTS;

export function rankIconFor(tier) {
  const i = Math.max(0, Math.min(RANK_ICONS.length - 1, Number.isFinite(tier) ? tier : 0));
  return RANK_ICONS[i];
}
export function rankColorFor(tier) {
  const i = Math.max(0, Math.min(RANK_COLORS.length - 1, Number.isFinite(tier) ? tier : 0));
  return RANK_COLORS[i];
}
export function rankTextColorFor(tier) {
  // Goonmaster (black background) needs gold text. All others stay dark.
  return tier === RANK_COLORS.length - 1 ? "#FFD700" : "#0A0A0A";
}

// Returns 1 (highest sub-tier within the rank), 2 (middle), 3 (entry),
// or 0 for Goonmaster (undivided). Client-side fallback only —
// server stamps `rank_division` on payloads going forward.
export function rankDivisionForPoints(points, tier) {
  const t = Math.max(0, Math.min(RANK_THRESHOLDS.length - 1, Number.isFinite(tier) ? tier : 0));
  if (t >= RANK_THRESHOLDS.length - 1) return 0;       // Goonmaster
  const low = RANK_THRESHOLDS[t];
  const high = RANK_THRESHOLDS[t + 1];
  const span = Math.max(1, high - low);
  const p = Math.max(low, Math.min(high - 1, Number.isFinite(points) ? points : low));
  const frac = (p - low) / span;
  if (frac < 1 / 3) return 3;
  if (frac < 2 / 3) return 2;
  return 1;
}

// Returns the roman numeral string for a division: "I" / "II" / "III"
// (or "" for Goonmaster / unknown).
export function divisionRoman(division) {
  return { 1: "I", 2: "II", 3: "III" }[Number(division || 0)] || "";
}

// Returns true when the player is one of the top-50 GOONMASTER globals —
// the "ULTIMATE GOONER" tier. Top tier (last index) is the required
// base rank; leaderboardRank must be a finite integer in [1, 50].
export function isUltimateGooner(tier, leaderboardRank) {
  return (
    tier === RANK_NAMES.length - 1 &&
    Number.isFinite(leaderboardRank) &&
    leaderboardRank >= 1 &&
    leaderboardRank <= 50
  );
}

// Combined display label, e.g. "SILVER II" or "GOONMASTER". `name`
// defaults to the tier-mapped name when omitted. Falls back to just
// the tier name when division is missing/0. When the player qualifies
// for ULTIMATE GOONER (top-50 Goonmaster global), the label is
// upgraded — every pill / scoreboard row / match-end row reads the
// upgraded rank consistently.
export function rankLabelFor(tier, division, name = null, leaderboardRank = null) {
  if (isUltimateGooner(tier, leaderboardRank)) {
    return "ULTIMATE GOONER";
  }
  const baseIdx = Math.max(0, Math.min(RANK_NAMES.length - 1, Number.isFinite(tier) ? tier : 0));
  const base = name || RANK_NAMES[baseIdx];
  const rom = divisionRoman(division);
  return rom ? `${base} ${rom}` : base;
}
