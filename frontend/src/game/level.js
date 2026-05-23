// Shared XP + Level math. Used by Profile, PlayerCard, AvatarPicker.
// Server has matching constants in server.py (see `compute_level()`).
//
// XP formula:    xp = kills * 10  +  wins * 50  +  matches * 25
// Level curve:   xp_required_for(level) = 50 * level * (level + 1)
// So level 2 ≈ 300 xp, 5 ≈ 1500, 10 ≈ 5500, 25 ≈ 32500, 50 ≈ 127500.

export const XP_PER_KILL = 10;
export const XP_PER_WIN = 50;
export const XP_PER_MATCH = 25;
export const MAX_LEVEL = 100;

export function xpFromStats(stats = {}) {
  const k = stats.kills | 0;
  const w = stats.wins | 0;
  const m = stats.matches | 0;
  // Bonus XP granted by redeem codes / promotions. Server stores this in
  // stats.bonus_xp and surfaces it through the same /profile endpoint.
  const bonus = stats.bonus_xp | 0;
  return k * XP_PER_KILL + w * XP_PER_WIN + m * XP_PER_MATCH + bonus;
}

export function xpRequiredFor(level) {
  const n = Math.max(1, Math.min(MAX_LEVEL, level | 0));
  return 50 * n * (n + 1);
}

// Given total XP, return {level, xpIntoLevel, xpForNext, progress}.
export function levelFromXp(xp) {
  const totalXp = Math.max(0, xp | 0);
  let level = 1;
  let accumulated = 0;
  while (level < MAX_LEVEL) {
    const need = xpRequiredFor(level);
    if (accumulated + need > totalXp) break;
    accumulated += need;
    level += 1;
  }
  const xpForNext = xpRequiredFor(level);
  const xpIntoLevel = totalXp - accumulated;
  return {
    level,
    xpIntoLevel,
    xpForNext,
    progress: Math.max(0, Math.min(1, xpIntoLevel / xpForNext)),
    totalXp,
  };
}

// Combined helper for components that have raw stats but no precomputed xp.
export function levelFromStats(stats = {}) {
  return levelFromXp(xpFromStats(stats));
}
