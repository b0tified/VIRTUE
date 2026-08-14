// Shared rank-icon and rank-color metadata so every component renders the same
// crest for a given tier (0..8 = Bronze .. Goonmaster). Emerald sits between
// Platinum and Diamond as a stepping-stone tier. Each main tier (except
// Goonmaster) is split into 3 sub-divisions (III → II → I, lowest → highest
// within the tier) — see `rankDivisionForPoints`.
import { Shield, Award, Star, Gem, Trophy, Sword, Skull, Flame, Sparkles } from "lucide-react";

export const RANK_COLORS = [
  "#CD7F32", // Bronze
  "#C0C0C0", // Silver
  "#FFD700", // Gold
  "#5BC0EB", // Platinum
  "#2ECC71", // Emerald (new — bright green)
  "#9D4EDD", // Diamond
  "#E63946", // Master
  "#06D6A0", // Grandmaster
  "#000000", // Goonmaster
];

export const RANK_NAMES = [
  "BRONZE", "SILVER", "GOLD", "PLATINUM",
  "EMERALD",
  "DIAMOND", "MASTER", "GRANDMASTER", "GOONMASTER",
];

// Thresholds must match RANK_TIERS in /app/backend/server.py so a
// client-side fallback can compute the right division when the server
// payload predates this field. Emerald slot (index 4) at 1050 RP.
const RANK_THRESHOLDS = [0, 300, 600, 900, 1050, 1350, 1650, 1950, 2250];

export const RANK_ICONS = [
  Shield, Award, Star, Trophy,
  Sparkles,           // Emerald — twinkly sparkles
  Gem, Sword, Skull, Flame,
];

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
