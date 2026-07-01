/* Helper — builds the compact banner title string ("S2 · DIAMOND") for a
   user based on their `past_seasons[]` array + the currently-equipped
   `title_season`. Returns `null` when the user has no title equipped or
   the equipped season isn't in their past-seasons list. */
export function formatBannerTitle(user) {
  if (!user) return null;
  const equipped = user.title_season;
  if (equipped == null) return null;
  const past = Array.isArray(user.past_seasons) ? user.past_seasons : [];
  const entry = past.find((e) => Number(e?.season) === Number(equipped));
  if (!entry) return null;
  const tierName = (entry.tier_name || "").toString().toUpperCase();
  return `S${entry.season} · ${tierName}`;
}
