/* Helper — builds the compact banner title string ("S2 · DIAMOND") for a
   user based on their `past_seasons[]` array + the currently-equipped
   `title_season`. Returns `null` when the user has no title equipped or
   the equipped season isn't in their past-seasons list.

   Special case: when `user.title_ultimate === true` AND the user is
   currently top-50 (`leaderboard_rank` in 1..50), the banner shows
   "ULTIMATE GOONER" instead — the flex title for top-50 Goonmasters. */
export function formatBannerTitle(user) {
  if (!user) return null;
  if (user.custom_title?.text) return user.custom_title.text;
  if (_isUltimateEquipped(user)) {
    // Live season Ultimate Gooner — stamp the current placement so a
    // top-50 player's banner reads "ULTIMATE GOONER · #7". The value
    // updates every leaderboard refresh.
    const rank = Number(user.leaderboard_rank);
    return Number.isFinite(rank) && rank >= 1 && rank <= 50
      ? `ULTIMATE GOONER · #${rank}`
      : "ULTIMATE GOONER";
  }
  const entry = _resolveEquippedEntry(user);
  if (!entry) return null;
  const tierName = (entry.tier_name || "").toString().toUpperCase();
  // Past-season Ultimate Gooner call-out — when the archived entry
  // carries a top-50 `leaderboard_rank`, weave the number into the
  // title so the banner reads "S3 · #7 GOONMASTER". Preserved
  // forever, unlike the live ULTIMATE title which lapses at rollover.
  const lb = Number(entry.leaderboard_rank);
  if (Number.isFinite(lb) && lb >= 1 && lb <= 50) {
    return `S${entry.season} · #${lb} ${tierName}`;
  }
  return `S${entry.season} · ${tierName}`;
}

/* Returns the tier index (0..7) of the currently-equipped title, or
   -1 when nothing is equipped. Callers use this to decide whether to
   apply the Master+ (>= 5) animated CSS class. Ultimate title reports
   tier 7 so it gets the top-tier goonmaster shimmer. */
export function bannerTitleTierIdx(user) {
  if (_isUltimateEquipped(user)) return 7;
  const entry = _resolveEquippedEntry(user);
  if (!entry) return -1;
  const t = Number(entry.tier);
  return Number.isFinite(t) ? t : -1;
}

/* Returns the CSS class(es) to attach to the banner-title span so
   Master (5), Grandmaster (6) and Goonmaster (7) titles animate with
   a subtle shimmer / sparkle. Diamond and below → empty string. */
export function bannerTitleAnimClass(user) {
  if (user?.custom_title?.text) return customTitleClass(user.custom_title.style);
  const idx = bannerTitleTierIdx(user);
  if (idx >= 7) return "banner-title-anim banner-title-anim-goonmaster";
  if (idx >= 6) return "banner-title-anim banner-title-anim-grandmaster";
  if (idx >= 5) return "banner-title-anim banner-title-anim-master";
  return "";
}

function _isUltimateEquipped(user) {
  if (!user || !user.title_ultimate) return false;
  const r = Number(user.leaderboard_rank);
  return Number.isFinite(r) && r >= 1 && r <= 50;
}

function _resolveEquippedEntry(user) {
  if (!user) return null;
  const equipped = user.title_season;
  if (equipped == null) return null;
  const past = Array.isArray(user.past_seasons) ? user.past_seasons : [];
  return past.find((e) => Number(e?.season) === Number(equipped)) || null;
}

/* Custom shop titles (admin Title Maker): style -> CSS class. */
export function customTitleClass(style) {
  if (style === "rainbow") return "custom-title-rainbow";
  if (style === "shimmer") return "banner-title-anim custom-title-shimmer";
  return "";
}

/* Inline color for custom shop titles; undefined keeps the banner default. */
export function bannerTitleStyle(user) {
  const c = user?.custom_title?.color;
  return c ? { color: c } : undefined;
}
