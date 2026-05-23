// Shared rank-icon and rank-color metadata so every component renders the same
// crest for a given tier (0..7 = Bronze .. Goonmaster).
import { Shield, Award, Star, Gem, Trophy, Sword, Skull, Flame } from "lucide-react";

export const RANK_COLORS = [
  "#CD7F32", // Bronze
  "#C0C0C0", // Silver
  "#FFD700", // Gold
  "#5BC0EB", // Platinum
  "#9D4EDD", // Diamond
  "#E63946", // Master
  "#06D6A0", // Grandmaster
  "#000000", // Goonmaster
];

export const RANK_NAMES = [
  "BRONZE", "SILVER", "GOLD", "PLATINUM",
  "DIAMOND", "MASTER", "GRANDMASTER", "GOONMASTER",
];

export const RANK_ICONS = [
  Shield, Award, Star, Gem, Trophy, Sword, Skull, Flame,
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
  return tier === 7 ? "#FFD700" : "#0A0A0A";
}
