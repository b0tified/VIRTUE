/* Helper — builds the compact banner title string ("S2 · DIAMOND") for a
   user based on their `past_seasons[]` array + the currently-equipped
   `title_season`. Returns `null` when the user has no title equipped or
   the equipped season isn't in their past-seasons list. */
export function formatBannerTitle(user) {
  if (!user) return null;
  const entry = _resolveEquippedEntry(user);
  if (!entry) return null;
  const tierName = (entry.tier_name || "").toString().toUpperCase();
  return `S${entry.season} · ${tierName}`;
}

/* Returns the tier index (0..7) of the currently-equipped title, or
   -1 when nothing is equipped. Callers use this to decide whether to
   apply the Master+ (>= 5) animated CSS class. */
export function bannerTitleTierIdx(user) {
  const entry = _resolveEquippedEntry(user);
  if (!entry) return -1;
  const t = Number(entry.tier);
  return Number.isFinite(t) ? t : -1;
}

/* Returns the CSS class(es) to attach to the banner-title span so
   Master (5), Grandmaster (6) and Goonmaster (7) titles animate with
   a subtle shimmer / sparkle. Diamond and below → empty string. */
export function bannerTitleAnimClass(user) {
  const idx = bannerTitleTierIdx(user);
  if (idx >= 7) return "banner-title-anim banner-title-anim-goonmaster";
  if (idx >= 6) return "banner-title-anim banner-title-anim-grandmaster";
  if (idx >= 5) return "banner-title-anim banner-title-anim-master";
  return "";
}

function _resolveEquippedEntry(user) {
  if (!user) return null;
  const equipped = user.title_season;
  if (equipped == null) return null;
  const past = Array.isArray(user.past_seasons) ? user.past_seasons : [];
  return past.find((e) => Number(e?.season) === Number(equipped)) || null;
}
