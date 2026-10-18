import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import api from "@/api";
import {
  ArrowLeft, Crown, Trophy, Bot, Swords, History, WifiOff,
  Flame, Star, Zap, Bomb, Target, Skull, Sparkles, Award,
  Check, Lock, Gem, Snowflake, Atom, Shield, Users,
} from "lucide-react";
import { rankIconFor, divisionRoman, isUltimateGooner } from "@/game/rankIcons";
import UltimateGoonerBadge from "@/components/UltimateGoonerBadge";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import RankProgressBar from "@/components/RankProgressBar";
import { Avatar, AVATAR_COUNT } from "@/components/PlayerCard";
import { levelFromStats } from "@/game/level";
import { formatBannerTitle, bannerTitleAnimClass, bannerTitleStyle } from "@/game/bannerTitle";
import audioBus from "@/game/audio";
import WeaponLoadoutPicker from "@/components/WeaponLoadoutPicker";
import PublicProfileModal from "@/components/PublicProfileModal";
import { SeasonRecapView } from "@/components/SeasonRecapModal";
import PlacementTracker from "@/components/PlacementTracker";

// Avatar unlock gates — must mirror server.py set_avatar gating.
const AVATAR_LOCKS = {
  6: { level: 5,  tier: 0, label: "Flaming Skull" },        // tier 0 = no rank gate, level-only
  7: { level: 15, tier: 4, label: "Pulsing Diamond" },
  8: { level: 25, tier: 5, label: "Swirling Lightning" },
  9: { level: 10, tier: 0, label: "Frost Sigil" },
  10: { level: 20, tier: 4, label: "Quantum Core" },
  11: { level: 30, tier: 7, label: "All-Seeing Eye" },
};
const BANNER_ANIM_UNLOCK = { level: 10, tier: 2, label: "Animated Banner" };

function isAvatarUnlocked(idx, level, peakTier) {
  const g = AVATAR_LOCKS[idx];
  if (!g) return true;
  if (level >= g.level) return true;
  if (g.tier > 0 && peakTier >= g.tier) return true;
  return false;
}

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];

/* Turn any axios/FastAPI error into a readable, alert()-safe string.
   Handles three shapes:
     • `{detail: "string"}` — plain HTTPException.
     • `{detail: [{msg, loc, ...}, ...]}` — FastAPI validation errors.
     • Anything else — falls back to `e.message` or the passed default.
   Without this, validation errors alert() as "[object Object]"
   because the detail is an array of dicts. */
function _apiErrorMessage(err, fallback) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const msgs = d
      .map((e) => (typeof e === "string" ? e : e?.msg || null))
      .filter(Boolean);
    if (msgs.length) return msgs.join(" · ");
  }
  return err?.message || fallback;
}


// 12 banner icons + 12 banner colors, customizable from the profile.
const BANNER_ICONS = [
  { Icon: Trophy,    label: "Trophy" },
  { Icon: Crown,     label: "Crown" },
  { Icon: Flame,     label: "Flame" },
  { Icon: Star,      label: "Star" },
  { Icon: Zap,       label: "Bolt" },
  { Icon: Bomb,      label: "Bomb" },
  { Icon: Target,    label: "Target" },
  { Icon: Skull,     label: "Skull" },
  { Icon: Sparkles,  label: "Sparkles" },
  { Icon: Gem,       label: "Gem" },
  { Icon: Snowflake, label: "Frost" },
  { Icon: Atom,      label: "Quantum" },
];
const BANNER_COLORS = [
  { name: "RED",     bg: "#E62429", fg: "#FFFFFF" },
  { name: "BLUE",    bg: "#0055FF", fg: "#FFFFFF" },
  { name: "GOLD",    bg: "#FFD700", fg: "#0A0A0A" },
  { name: "GREEN",   bg: "#06A35F", fg: "#FFFFFF" },
  { name: "PURPLE",  bg: "#9B59B6", fg: "#FFFFFF" },
  { name: "CYAN",    bg: "#5BC0EB", fg: "#0A0A0A" },
  { name: "ORANGE",  bg: "#FF7B00", fg: "#FFFFFF" },
  { name: "BLACK",   bg: "#0A0A0A", fg: "#FFD700" },
  { name: "OCEAN",   bg: "#001a3a", fg: "#9adcff" },
  { name: "MINT",    bg: "#00ffaa", fg: "#0A0A0A" },
  { name: "ROSE",    bg: "#ff3a8a", fg: "#FFFFFF" },
  { name: "VOID",    bg: "#3a0066", fg: "#ff00ff" },
];

export function bannerIconMeta(idx) {
  const i = Math.max(0, Math.min(BANNER_ICONS.length - 1, Number.isFinite(idx) ? idx : 0));
  return BANNER_ICONS[i];
}
export function bannerColorMeta(idx) {
  const i = Math.max(0, Math.min(BANNER_COLORS.length - 1, Number.isFinite(idx) ? idx : 0));
  return BANNER_COLORS[i];
}

const MODE_META = {
  ranked:  { label: "RANKED",   color: "#0055FF", Icon: Trophy },
  casual:  { label: "QUICK",    color: "#E62429", Icon: Swords },
  offline: { label: "OFFLINE",  color: "#06A35F", Icon: WifiOff },
};

// TDM gets its own badge — different label/icon/color so a player
// glancing at their history can instantly tell team matches apart from
// solo FFA quick-plays. Picked from the `game_mode` field, layered on
// top of the `mode` mapping above.
const TDM_MODE_META = {
  Icon: Shield,
  label: "TDM 4V4",
  color: "#9B59B6",  // distinctive purple — stands out from FFA red
};

// Team outcome → label + accent color (matches the WIN/LOSS overlay in
// the in-match summary so the UI feels consistent across screens).
const TDM_OUTCOME_META = {
  win:  { label: "WIN",  color: "#06A35F" },
  loss: { label: "LOSS", color: "#E62429" },
  draw: { label: "DRAW", color: "#7A7A7A" },
};

export default function Profile() {
  const { user, refreshMe } = useAuth();
  const s = user?.stats || { kills: 0, deaths: 0, matches: 0, wins: 0 };
  const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : String(s.kills);

  const currentRP = user?.rank_points ?? 0;
  const currentTier = Math.max(0, Math.min(8, user?.rank_tier ?? 0));
  const currentName = user?.rank_name || "BRONZE";
  const peakRP = user?.peak_rank_points ?? currentRP;
  const peakTier = Math.max(0, Math.min(8, user?.peak_rank_tier ?? currentTier));
  const peakName = user?.peak_rank_name || currentName;
  const inPlacements = !!user?.in_placements;
  const placementNote = inPlacements ? `Placements ${user?.placement_matches_played ?? 0}/${user?.placement_matches_total ?? 5}` : null;

  const bannerIcon = user?.banner_icon ?? 0;
  const bannerColor = user?.banner_color ?? 0;
  const bannerAnimated = !!user?.banner_animated;
  const avatarIdx = user?.avatar ?? 0;
  const lvl = user?.level
    ? { level: user.level, xpIntoLevel: user.xp_into_level ?? 0, xpForNext: user.xp_for_next ?? 100, totalXp: user.xp ?? 0 }
    : levelFromStats(user?.stats || {});
  const animatedBannerUnlocked =
    lvl.level >= BANNER_ANIM_UNLOCK.level || peakTier >= BANNER_ANIM_UNLOCK.tier;
  const [savingBanner, setSavingBanner] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  const updateBanner = async (nextIcon, nextColor, nextAnimated = bannerAnimated) => {
    setSavingBanner(true);
    try {
      await api.post("/profile/me/banner", {
        banner_icon: nextIcon,
        banner_color: nextColor,
        banner_animated: nextAnimated,
      });
      await refreshMe();
    } catch (e) {
      alert(_apiErrorMessage(e, "Could not save banner"));
    }
    setSavingBanner(false);
  };

  const updateAvatar = async (nextIdx) => {
    setSavingAvatar(true);
    try {
      await api.post("/profile/me/avatar", { avatar: nextIdx });
      await refreshMe();
    } catch (e) {
      // FastAPI validation errors are an ARRAY of {loc, msg, type, ...}
      // objects — alert()ing that directly prints "[object Object]".
      // Flatten to a readable string so users see the real reason.
      alert(_apiErrorMessage(e, "Could not save avatar"));
    }
    setSavingAvatar(false);
  };

  // ─────────────────────────────────────────────────────────────────
  // Past-season titles — an array of `{season, tier, tier_name, rp}`
  // stamped at each season rollover. The user can equip one via
  // `POST /profile/me/title` and it renders as a small "S2 · DIAMOND"
  // text overlay on their banner strip everywhere PlayerCard is used.
  // ─────────────────────────────────────────────────────────────────
  const pastSeasons = Array.isArray(user?.past_seasons) ? user.past_seasons : [];
  const equippedTitleSeason = user?.title_season ?? null;
  const titleUltimateEquipped = !!user?.title_ultimate;
  const leaderboardRankMe = Number(user?.leaderboard_rank);
  const canEquipUltimate = Number.isFinite(leaderboardRankMe) && leaderboardRankMe >= 1 && leaderboardRankMe <= 50;
  const [savingTitle, setSavingTitle] = useState(false);
  const updateTitle = async (season) => {
    setSavingTitle(true);
    try {
      await api.post("/profile/me/title", { season });
      await refreshMe();
    } catch (e) {
      alert(_apiErrorMessage(e, "Could not save title"));
    }
    setSavingTitle(false);
  };
  const updateTitleUltimate = async (equip) => {
    setSavingTitle(true);
    try {
      await api.post("/profile/me/title", { ultimate: !!equip });
      await refreshMe();
    } catch (e) {
      alert(_apiErrorMessage(e, "Could not save title"));
    }
    setSavingTitle(false);
  };

  const [history, setHistory] = useState(null); // null = loading, [] = empty
  const [historyError, setHistoryError] = useState(null);
  // Match scoreboard modal — opened by clicking a history row. Holds the
  // clicked match's roster + game_mode so the modal knows FFA vs TDM.
  const [openMatch, setOpenMatch] = useState(null);
  // Chained "click a player row → open their public profile" — the
  // scoreboard modal sets this via a callback so both modals can coexist
  // (the scoreboard stays open behind the profile view). Bots surface
  // the same modal in `isBot` mode so they render as a private profile
  // — visually indistinguishable from a real user with a locked profile.
  const [openProfile, setOpenProfile] = useState(null); // {username, isBot}
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/profile/me/history?limit=10");
        if (alive) setHistory(data);
      } catch (e) {
        if (alive) setHistoryError(e?.response?.data?.detail || e.message || "Failed to load history");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Past-seasons archive: every season where this user finished top-100
  // gets a row here. Loads once per profile mount.
  const [seasonHistory, setSeasonHistory] = useState(null);
  const [openRecap, setOpenRecap] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/me/season_recaps");
        if (alive) setSeasonHistory(Array.isArray(data?.seasons) ? data.seasons : []);
      } catch {
        if (alive) setSeasonHistory([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Per-tab music — chill lo-fi for the profile page. Stops when the
  // page unmounts so the lobby music can resume.
  useEffect(() => {
    audioBus.startProfileMusic?.();
    return () => { audioBus.stopMusic?.(); };
  }, []);

  return (
    <div className="min-h-screen bg-black halftone-dark text-white p-6 md:p-12" data-testid="profile-page">
      <Link to="/lobby" draggable={false} onDragStart={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }} className="btn-pow bg-neutral-900 text-white select-none" data-testid="profile-back-button">
        <span className="flex items-center gap-2"><ArrowLeft size={18} strokeWidth={3} /> BACK</span>
      </Link>

      <div className="max-w-4xl mx-auto mt-8">
        <div className="card-pow p-0 -rotate-1 overflow-hidden text-white" style={{ background: "#171717" }}>
          {/* User banner (icon + color) */}
          <ProfileBanner iconIdx={bannerIcon} colorIdx={bannerColor} animated={bannerAnimated} title={formatBannerTitle(user)} titleClass={bannerTitleAnimClass(user)} titleStyle={bannerTitleStyle(user)} />
          <div className="p-8 bg-neutral-900">
            <div className="inline-block bg-[#0055FF] text-white border-pow shadow-pow-sm px-3 py-1 -rotate-2 mb-3">
              <span className="font-anton uppercase tracking-widest">Profile</span>
            </div>
            <h1 className="font-display text-6xl uppercase text-pow-shadow" data-testid="profile-username">
              {user?.username}
            </h1>
          </div>
        </div>

        {/* Weapon loadout picker — moved to the TOP of profile per
            user request (2026-02-24) so it's the first customization
            they see. Loadout persists via /profile/me/weapon; the
            server reads it at WS connect. */}
        <SectionHeader title="Weapon Loadout" testid="profile-section-weapon" />
        <WeaponLoadoutPicker
          user={user}
          onChange={() => refreshMe?.()}
        />

        {/* Rank cards moved to the top — most important visual, gets
            prime real estate right under the hero. Current + peak side
            by side with the new RankProgressBar inside current. */}
        <SectionHeader title="Your Rank" testid="profile-section-rank" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <RankCard
            label={inPlacements ? "Predicted Rank" : "Current Rank"}
            predictedNote={placementNote}
            footer={inPlacements ? (
              <PlacementTracker played={user?.placement_matches_played ?? 0} total={user?.placement_matches_total ?? 5} testid="profile-placement-tracker" />
            ) : null}
            tier={currentTier}
            name={currentName}
            division={user?.rank_division ?? 0}
            points={currentRP}
            leaderboardRank={user?.leaderboard_rank ?? null}
            testid="profile-current-rank"
          />
          <RankCard
            label="Peak Rank"
            tier={peakTier}
            name={peakName}
            division={user?.peak_rank_division ?? 0}
            points={peakRP}
            leaderboardRank={user?.leaderboard_rank ?? null}
            predictedNote={inPlacements && peakRP <= currentRP ? placementNote : null}
            crown
            testid="profile-peak-rank"
          />
        </div>

        {/* Level + XP progress */}
        <SectionHeader title="Level & Progression" testid="profile-section-level" />
        <LevelCard level={lvl.level} xpInto={lvl.xpIntoLevel} xpForNext={lvl.xpForNext} totalXp={lvl.totalXp} />

        {/* Customization block — banner + avatar grouped together. */}
        <SectionHeader title="Customize" testid="profile-section-customize" />

        <BannerCustomizer
          iconIdx={bannerIcon}
          colorIdx={bannerColor}
          animated={bannerAnimated}
          animatedUnlocked={animatedBannerUnlocked}
          saving={savingBanner}
          onPickIcon={(i) => updateBanner(i, bannerColor)}
          onPickColor={(c) => updateBanner(bannerIcon, c)}
          onToggleAnimated={(v) => updateBanner(bannerIcon, bannerColor, v)}
        />

        {/* Avatar (profile photo) picker — idx 5 is the dynamic Peak Rank Crest,
            idx 6-8 are unlockable animated specials. */}
        <AvatarPicker
          avatarIdx={avatarIdx}
          peakTier={peakTier}
          peakDivision={user?.peak_rank_division ?? 0}
          playerLevel={lvl.level}
          saving={savingAvatar}
          onPick={updateAvatar}
        />

        {/* Past-season titles — flex your peak rank from every finished
            season on your banner. Empty until the player's first season
            rollover; hidden while there's nothing to show. */}
        <TitlePicker
          pastSeasons={pastSeasons}
          equippedSeason={equippedTitleSeason}
          ultimateEquipped={titleUltimateEquipped}
          canEquipUltimate={canEquipUltimate}
          leaderboardRank={leaderboardRankMe}
          saving={savingTitle}
          onPick={updateTitle}
          onPickUltimate={updateTitleUltimate}
        />

        <SectionHeader title="Stats" testid="profile-section-stats" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mt-6">
          <Stat label="KILLS" value={s.kills} color="#E62429" testid="profile-kills" />
          <Stat label="DEATHS" value={s.deaths} color="#0055FF" testid="profile-deaths" />
          <Stat label="MATCHES" value={s.matches} color="#FFD700" textColor="#0A0A0A" testid="profile-matches" />
          <Stat label="K/D" value={kd} color="#0A0A0A" testid="profile-kd" />
        </div>

        {/* Match History (last 10 matches) */}
        <div className="card-pow p-0 mt-8 overflow-hidden" data-testid="profile-history-card">
          <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
            <History size={18} strokeWidth={3} className="text-[#FFD700]" />
            <span className="font-anton uppercase tracking-widest">Match History</span>
            <span className="opacity-60 text-xs ml-auto">Last 10</span>
          </div>

          {history === null && historyError === null && (
            <div className="px-5 py-6 font-anton uppercase text-center text-neutral-500" data-testid="profile-history-loading">
              Loading...
            </div>
          )}

          {historyError && (
            <div className="px-5 py-6 font-anton uppercase text-center text-[#E62429]" data-testid="profile-history-error">
              {historyError}
            </div>
          )}

          {history !== null && history.length === 0 && (
            <div className="px-5 py-8 text-center" data-testid="profile-history-empty">
              <Bot size={32} strokeWidth={3} className="inline text-neutral-400" />
              <div className="font-anton uppercase mt-2 text-neutral-500">No matches yet — go drop into a Quick Match!</div>
            </div>
          )}

          {history !== null && history.length > 0 && (
            <>
              <div className="hidden md:grid grid-cols-12 bg-[#FFD700] px-4 py-2 font-anton uppercase tracking-widest text-sm border-t-4 border-black">
                <div className="col-span-2">Mode</div>
                <div className="col-span-2">Result</div>
                <div className="col-span-2 text-right">Kills</div>
                <div className="col-span-2 text-right">Deaths</div>
                <div className="col-span-2 text-right">Δ RP</div>
                <div className="col-span-2 text-right">Rank</div>
              </div>
              {history.map((m, i) => (
                <HistoryRow key={i} idx={i} m={m} onOpen={setOpenMatch} />
              ))}
            </>
          )}
        </div>

        {seasonHistory !== null && seasonHistory.length > 0 && (
          <div className="card-pow p-0 mt-8 overflow-hidden" data-testid="profile-season-history-card">
            <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
              <Trophy size={18} strokeWidth={3} className="text-[#FFD700]" />
              <span className="font-anton uppercase tracking-widest">Season History</span>
              <span className="opacity-60 text-xs ml-auto">Tap a season to view its recap</span>
            </div>
            <div className="hidden md:grid grid-cols-12 bg-[#FFD700] text-black px-4 py-2 font-anton uppercase tracking-widest text-sm border-t-4 border-black">
              <div className="col-span-2">Season</div>
              <div className="col-span-3">Final rank</div>
              <div className="col-span-2 text-right">Global #</div>
              <div className="col-span-2 text-right">Final RP</div>
              <div className="col-span-2 text-right">Kills</div>
              <div className="col-span-1" />
            </div>
            {seasonHistory.map((s, i) => {
              const tier = Math.max(0, Math.min(8, s.final?.tier ?? 0));
              return (
                <button
                  type="button"
                  key={s.season}
                  onClick={() => setOpenRecap(s)}
                  className={`w-full text-left grid grid-cols-12 px-4 py-3 border-t-2 border-black items-center hover:bg-neutral-700 transition-colors ${i % 2 === 0 ? "bg-neutral-900 text-white" : "bg-neutral-800 text-white"}`}
                  data-testid={`profile-season-row-${s.season}`}
                >
                  <div className="col-span-3 md:col-span-2 font-display text-2xl">S{s.season}</div>
                  <div className="col-span-5 md:col-span-3">
                    <span className="font-anton uppercase text-xs px-2 py-1" style={{ background: RANK_COLORS[tier], color: tier === 8 ? "#FFD700" : "#0A0A0A" }}>
                      {s.final?.name || "BRONZE"}
                    </span>
                  </div>
                  <div className="hidden md:block col-span-2 text-right font-display text-xl">{s.leaderboard_rank ? `#${s.leaderboard_rank}` : "—"}</div>
                  <div className="hidden md:block col-span-2 text-right font-anton text-lg">{s.final?.rp ?? 0}</div>
                  <div className="hidden md:block col-span-2 text-right font-anton">{s.full ? s.kills : "—"}</div>
                  <div className="col-span-4 md:col-span-1 text-right font-anton uppercase text-xs text-[#FFD700]">View</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {openRecap && (
        <SeasonRecapView recap={openRecap} nextSeason={openRecap.season + 1} onClose={() => setOpenRecap(null)} buttonLabel="Close" />
      )}
      {/* Match scoreboard — opened by clicking any history row that has
          a persisted roster. Displays every player who was in that match
          (real + bots) with kills/deaths. Clicking a real player opens
          their PublicProfileModal on top. */}
      {openMatch && (
        <MatchScoreboardModal
          match={openMatch}
          onClose={() => setOpenMatch(null)}
          onPickPlayer={(username, isBot) => setOpenProfile({ username, isBot })}
        />
      )}
      {openProfile && (
        <PublicProfileModal
          username={openProfile.username}
          isBot={openProfile.isBot}
          onClose={() => setOpenProfile(null)}
        />
      )}
    </div>
  );
}

/* Scoreboard modal for a single completed match.
   `match` is one row from /profile/me/history — it already carries the
   full `players` roster (name / kills / deaths / placement / team /
   is_bot) so the modal renders without a follow-up fetch. In TDM the
   roster is grouped by team; in FFA it's sorted by placement. Clicking
   a real player row lifts `onPickPlayer(username)` so the parent can
   open the existing PublicProfileModal. */
function MatchScoreboardModal({ match, onClose, onPickPlayer }) {
  const isTdm = match.game_mode === "tdm";
  const players = Array.isArray(match.players) ? match.players : [];
  const modeMeta = isTdm
    ? { label: "Team Deathmatch 4v4", color: "#9B59B6" }
    : (MODE_META[match.mode] || MODE_META.casual);
  const dateStr = match.ended_at ? new Date(match.ended_at).toLocaleString() : "";
  // Group by team for TDM; simple sorted list for FFA.
  const groups = isTdm
    ? [
        { key: "red",  label: "RED TEAM",  color: "#C1322B", rows: players.filter((p) => p.team === "red")  },
        { key: "blue", label: "BLUE TEAM", color: "#2858B4", rows: players.filter((p) => p.team === "blue") },
      ]
    : [{ key: "ffa", label: "STANDINGS", color: "#0A0A0A", rows: players }];

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-3 sm:p-6"
      data-testid="match-scoreboard-modal"
      onClick={onClose}
    >
      <div
        className="card-pow p-0 w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black text-white px-5 py-3 flex items-center gap-3">
          <span
            className="font-anton uppercase text-xs px-2 py-1"
            style={{ background: modeMeta.color, color: "#fff" }}
          >
            {modeMeta.label}
          </span>
          <div className="font-display text-xl sm:text-2xl text-[#FFD700] flex-1 truncate">
            MATCH SCOREBOARD
          </div>
          <button
            onClick={onClose}
            className="font-anton hover:opacity-80"
            data-testid="match-scoreboard-close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {dateStr && (
          <div className="px-5 py-2 text-xs font-anton uppercase tracking-widest text-neutral-400 bg-neutral-900 border-t-2 border-black">
            {dateStr}
          </div>
        )}
        {/* TDM header — team scoreline banner. Only rendered in TDM. */}
        {isTdm && (
          <div className="grid grid-cols-2 border-t-2 border-black">
            {[
              { label: "RED",  color: "#C1322B", score: match.team === "red"  ? match.team_score : match.enemy_team_score },
              { label: "BLUE", color: "#2858B4", score: match.team === "blue" ? match.team_score : match.enemy_team_score },
            ].map((t) => (
              <div key={t.label} className="px-4 py-3 flex items-center justify-between" style={{ background: t.color, color: "#fff" }}>
                <span className="font-anton uppercase tracking-widest text-sm">{t.label} TEAM</span>
                <span className="font-display text-3xl tabular-nums">{t.score ?? 0}</span>
              </div>
            ))}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <div
              className="px-4 py-1.5 font-anton uppercase tracking-widest text-xs border-t-2 border-black"
              style={{ background: g.color, color: "#fff" }}
            >
              {g.label}
            </div>
            <div className="grid grid-cols-12 bg-[#FFD700] px-4 py-1.5 font-anton uppercase tracking-widest text-xs border-t-2 border-black">
              <div className="col-span-1">#</div>
              <div className="col-span-1"></div>
              <div className="col-span-6">Player</div>
              <div className="col-span-2 text-right">K</div>
              <div className="col-span-2 text-right">D</div>
            </div>
            {g.rows.length === 0 ? (
              <div className="p-3 font-anton text-center uppercase text-sm bg-neutral-900 text-white border-t-2 border-black">
                No players
              </div>
            ) : g.rows.map((p, i) => {
              // Bots are clickable now too — their "private profile"
              // rendering makes them visually indistinguishable from
              // real users with locked-down profiles.
              const clickable = !!p.username;
              return (
                <div
                  key={`${g.key}-${i}`}
                  className={`grid grid-cols-12 px-4 py-2 border-t-2 border-black items-center ${i % 2 === 0 ? "bg-neutral-900 text-white" : "bg-neutral-800 text-white"} ${clickable ? "cursor-pointer hover:bg-[#FFE680] hover:text-black active:bg-[#FFD700] transition-colors" : ""}`}
                  onClick={clickable ? () => onPickPlayer?.(p.username, !!p.is_bot) : undefined}
                  role={clickable ? "button" : undefined}
                  aria-label={clickable ? `View ${p.username}'s profile` : undefined}
                  data-testid={`match-scoreboard-row-${g.key}-${i}`}
                >
                  <div className="col-span-1 font-display text-lg">
                    {isTdm ? (i + 1) : (p.placement || (i + 1))}
                  </div>
                  <div className="col-span-1">
                    {/* BOT badge removed from the scoreboard — bots now
                        look identical to private-profile real players. */}
                  </div>
                  <div className="col-span-6 font-anton uppercase truncate">{p.username || "—"}</div>
                  <div className="col-span-2 text-right font-anton text-lg">{p.kills ?? 0}</div>
                  <div className="col-span-2 text-right font-anton text-lg">{p.deaths ?? 0}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryRow({ idx, m, onOpen }) {
  // TDM rows use a dedicated badge + WIN/LOSS card in the placement
  // slot. FFA rows keep the original "Nth of M" placement card.
  const isTdm = m.game_mode === "tdm";
  const meta = isTdm
    ? { ...TDM_MODE_META, ...MODE_META[m.mode], Icon: TDM_MODE_META.Icon, label: TDM_MODE_META.label, color: TDM_MODE_META.color }
    : (MODE_META[m.mode] || MODE_META.casual);
  const M = meta.Icon;
  const rankColor = RANK_COLORS[Math.max(0, Math.min(8, ((rankIdxFromName(m.rank_name_after)) || 0)))];
  const deltaColor = m.rp_delta > 0 ? "#06A35F" : m.rp_delta < 0 ? "#E62429" : "#0A0A0A";
  const sign = m.rp_delta > 0 ? "+" : "";
  const outcome = isTdm ? (TDM_OUTCOME_META[m.team_outcome] || TDM_OUTCOME_META.draw) : null;
  // Only rows with a persisted roster are clickable — legacy rows before
  // the players[] snapshot landed just render as static rows so a click
  // doesn't pop an empty modal.
  const clickable = Array.isArray(m.players) && m.players.length > 0;
  // Per-row expand/collapse for the inline killcam replay panel. When
  // this row has `kill_events` we show a ▼ chevron on the far right;
  // clicking it toggles the panel without opening the scoreboard modal.
  const [expanded, setExpanded] = useState(false);
  const killEvents = Array.isArray(m.kill_events) ? m.kill_events : [];
  const hasReplays = killEvents.length > 0;
  return (
    <>
      <div
        className={`grid grid-cols-12 px-4 py-2 border-t-2 border-black items-center text-sm md:text-base ${idx % 2 === 0 ? "bg-neutral-900 text-white" : "bg-neutral-800 text-white"} ${clickable ? "cursor-pointer hover:bg-[#FFE680] hover:text-black active:bg-[#FFD700] transition-colors" : ""}`}
        onClick={clickable ? () => onOpen?.(m) : undefined}
        role={clickable ? "button" : undefined}
        aria-label={clickable ? "Click to view match scoreboard" : undefined}
        data-testid={`profile-history-row-${idx}`}
      >
      <div className="col-span-6 md:col-span-2 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 border-pow-thin px-2 py-1 font-anton uppercase text-xs"
          style={{ background: meta.color, color: "#fff" }}
          data-testid={`history-mode-${isTdm ? "tdm" : m.mode}`}
        >
          <M size={12} strokeWidth={3} /> {meta.label}
        </span>
        {/* RANKED badge alongside the TDM badge if this was a ranked TDM match.
            Hidden when the mode is already "ranked" (avoids double badge). */}
        {isTdm && m.mode === "ranked" && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 font-anton uppercase text-[10px]"
            style={{ background: MODE_META.ranked.color, color: "#fff" }}
            data-testid={`history-tdm-ranked-${idx}`}
          >
            <Trophy size={10} strokeWidth={3} /> RANKED
          </span>
        )}
      </div>
      {isTdm ? (
        // TDM result card — WIN/LOSS/DRAW badge + the team scoreline
        // (your team — enemy team) so the row reads at a glance.
        <div
          className="col-span-6 md:col-span-2 text-right md:text-left flex items-center gap-2 md:justify-start justify-end"
          data-testid={`history-tdm-result-${idx}`}
        >
          <span
            className="font-anton uppercase text-xs px-2 py-1"
            style={{ background: outcome.color, color: "#fff" }}
            data-testid={`history-tdm-outcome-${idx}`}
          >
            {outcome.label}
          </span>
          <span className="font-display text-xl tabular-nums" data-testid={`history-tdm-score-${idx}`}>
            {m.team_score ?? 0}<span className="text-neutral-400 mx-1">—</span>{m.enemy_team_score ?? 0}
          </span>
        </div>
      ) : (
        <div className="col-span-6 md:col-span-2 text-right md:text-left font-anton text-lg">
          {m.placement || "-"} <span className="text-neutral-400 text-xs">/ {m.total_players || "-"}</span>
        </div>
      )}
      <div className="col-span-4 md:col-span-2 md:text-right font-anton text-lg" data-testid={`history-kills-${idx}`}>
        <span className="md:hidden text-xs opacity-60 uppercase mr-1">K</span>{m.kills}
      </div>
      <div className="col-span-4 md:col-span-2 md:text-right font-anton text-lg" data-testid={`history-deaths-${idx}`}>
        <span className="md:hidden text-xs opacity-60 uppercase mr-1">D</span>{m.deaths}
      </div>
      <div className="col-span-4 md:col-span-2 md:text-right font-display text-2xl" style={{ color: deltaColor }} data-testid={`history-delta-${idx}`}>
        {m.is_placement ? (
          <span className="font-anton uppercase text-xs text-[#9B59B6]" data-testid={`history-placement-${idx}`}>Placement</span>
        ) : m.rp_delta !== 0 ? `${sign}${m.rp_delta}` : "—"}
      </div>
      <div className="col-span-12 md:col-span-2 mt-1 md:mt-0 md:text-right flex items-center gap-2 justify-start md:justify-end">
        <span
          className="inline-block font-anton uppercase text-xs px-2 py-1"
          style={{ background: rankColor, color: m.rank_name_after === "GOONMASTER" ? "#FFD700" : "#0A0A0A" }}
        >
          {m.rank_name_after || "BRONZE"}
        </span>
        {hasReplays && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="btn-pow bg-black text-[#FFD700] [&]:px-2 [&]:py-1 [&]:text-[10px] font-anton uppercase tracking-widest"
            data-testid={`history-replay-toggle-${idx}`}
            aria-label={expanded ? "Hide killcam" : "Show killcam replays"}
          >
            REPLAYS {expanded ? "▲" : "▼"}
          </button>
        )}
      </div>
    </div>
    {expanded && hasReplays && (
      <KillReplayPanel
        idx={idx}
        killEvents={killEvents}
        arenaSize={m.arena_size || 40}
        myUsername={m.username_hint}
        players={m.players || []}
      />
    )}
  </>
  );
}

function rankIdxFromName(name) {
  const arr = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "GOONMASTER"];
  return arr.indexOf((name || "BRONZE").toUpperCase());
}

/* Inline killcam panel — rendered under a HistoryRow when the user
   expands it via the ▼ REPLAYS button. Shows every kill involving the
   viewer (as shooter OR victim) with a small top-down diorama:
     - Arena outlined as a square (scaled to the row width).
     - Shooter marker (red) with a directional cone pointing along
       their yaw at the moment of the kill.
     - Victim marker (blue).
     - A dashed line between them representing the shot trajectory.
     - Metadata: timestamp within the match, weapon icon, headshot
       flag, killer/victim names.
   No playback controls (per user spec: "just view timeline / kill
   list") — each kill is a static snapshot. */
function KillReplayPanel({ idx, killEvents, arenaSize }) {
  const events = [...killEvents].sort((a, b) => (a.t_ms || 0) - (b.t_ms || 0));
  return (
    <div
      className="col-span-12 border-t-2 border-black bg-neutral-900 text-white px-4 py-3"
      data-testid={`history-replay-panel-${idx}`}
    >
      <div className="font-anton uppercase tracking-widest text-xs text-neutral-500 mb-2">
        Kill replays · {events.length} event{events.length === 1 ? "" : "s"}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {events.map((k, i) => (
          <KillReplayCard key={i} k={k} arenaSize={arenaSize} idx={idx} eventIdx={i} />
        ))}
      </div>
    </div>
  );
}

/* One kill entry — mini top-down SVG diorama + metadata line. */
function KillReplayCard({ k, arenaSize, idx, eventIdx }) {
  const size = Math.max(20, arenaSize);
  // Map world (x, z) in [-size, size] to SVG (0, 120).
  const toSvg = (x, z) => [
    ((x + size) / (2 * size)) * 120,
    ((z + size) / (2 * size)) * 120,
  ];
  const [sx, sz] = toSvg(k.shooter_x, k.shooter_z);
  const [vx, vz] = toSvg(k.victim_x, k.victim_z);
  // Shooter facing cone — 20° half-angle indicator so the viewer can
  // eyeball whether the shot came from behind or in front.
  const coneLen = 22;
  const yaw = k.shooter_yaw || 0;
  const cxA = sx + Math.sin(yaw + 0.35) * coneLen;
  const czA = sz - Math.cos(yaw + 0.35) * coneLen;
  const cxB = sx + Math.sin(yaw - 0.35) * coneLen;
  const czB = sz - Math.cos(yaw - 0.35) * coneLen;
  const cxT = sx + Math.sin(yaw) * coneLen;
  const czT = sz - Math.cos(yaw) * coneLen;

  const mm = Math.max(0, Math.floor((k.t_ms || 0) / 60000));
  const ss = String(Math.floor(((k.t_ms || 0) % 60000) / 1000)).padStart(2, "0");
  const timeLbl = `${mm}:${ss}`;
  const weaponLbl = k.weapon === "sniper" ? "SNIPER"
    : k.weapon === "laser" ? "LASER"
    : k.weapon === "katana" ? "MELEE"
    : "AK-47";
  const weaponColor = k.weapon === "sniper" ? "#9B59B6"
    : k.weapon === "laser" ? "#0055FF"
    : k.weapon === "katana" ? "#E62429"
    : "#0A0A0A";

  return (
    <div
      className="border-pow-thin bg-neutral-800 text-white p-2 flex gap-3 items-stretch"
      data-testid={`history-replay-card-${idx}-${eventIdx}`}
    >
      <svg viewBox="0 0 120 120" width="96" height="96" className="border-2 border-black bg-[#E8E8EA] shrink-0">
        {/* Arena outline is the SVG viewBox itself. */}
        {/* Shot line (dashed). */}
        <line x1={sx} y1={sz} x2={vx} y2={vz} stroke="#000" strokeWidth="1.5" strokeDasharray="3 2" />
        {/* Shooter cone. */}
        <polygon
          points={`${sx},${sz} ${cxA},${czA} ${cxT},${czT} ${cxB},${czB}`}
          fill="#E62429" fillOpacity="0.28"
          stroke="#E62429" strokeWidth="1"
        />
        {/* Victim marker. */}
        <circle cx={vx} cy={vz} r="5" fill="#0055FF" stroke="#000" strokeWidth="1.5" />
        {/* Shooter marker on top so the cone origin is visible. */}
        <circle cx={sx} cy={sz} r="5" fill="#E62429" stroke="#000" strokeWidth="1.5" />
        {k.headshot && (
          <text x={vx} y={vz - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill="#E62429">HS</text>
        )}
      </svg>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-anton uppercase text-[10px] tracking-widest bg-black text-white px-1.5 py-0.5">
            {timeLbl}
          </span>
          <span
            className="font-anton uppercase text-[10px] tracking-widest text-white px-1.5 py-0.5"
            style={{ background: weaponColor }}
          >
            {weaponLbl}
          </span>
          {k.headshot && (
            <span className="font-anton uppercase text-[10px] tracking-widest bg-[#E62429] text-white px-1.5 py-0.5">
              HEADSHOT
            </span>
          )}
        </div>
        <div className="font-anton uppercase text-sm truncate leading-tight">
          <span className="text-[#E62429]">{k.shooter_name || "—"}</span>
        </div>
        <div className="font-anton uppercase text-[10px] tracking-widest text-neutral-500 leading-tight">
          KILLED
        </div>
        <div className="font-anton uppercase text-sm truncate leading-tight">
          <span className="text-[#0055FF]">{k.victim_name || "—"}</span>
        </div>
      </div>
    </div>
  );
}

// Lightweight section header — small comic-style ribbon that breaks
// the long Profile page into scannable blocks. Sits above each major
// section (Your Rank / Level / Customize / Stats / History).
function SectionHeader({ title, testid }) {
  return (
    <div className="mt-10 mb-4 flex items-center gap-3" data-testid={testid}>
      <span className="inline-block bg-black text-[#FFD700] border-pow shadow-pow-sm px-3 py-1 font-display text-xl sm:text-2xl uppercase -rotate-1">
        {title}
      </span>
      <span className="flex-1 h-[3px] bg-black/80" />
    </div>
  );
}


function RankCard({ label, tier, name, division = 0, points, crown = false, leaderboardRank = null, testid, predictedNote = null, footer = null }) {
  const ultimate = isUltimateGooner(tier, leaderboardRank);
  const color = ultimate ? "#FFD700" : RANK_COLORS[Math.max(0, Math.min(8, tier))];
  const textColor = ultimate ? "#0A0A0A" : (tier === 8 ? "#FFD700" : "#0A0A0A");
  const roman = divisionRoman(division);
  return (
    <div className="card-pow p-0 overflow-hidden" style={{ background: "#171717" }} data-testid={testid}>
      <div className="bg-black text-white px-5 py-2 flex items-center gap-2">
        {crown && <Crown size={16} strokeWidth={3} className="text-[#FFD700]" />}
        <span className="font-anton uppercase tracking-widest text-sm">{label}</span>
        {predictedNote && (
          <span className="ml-auto font-anton uppercase tracking-widest text-xs text-[#FFD700]" data-testid={`${testid}-predicted-note`}>{predictedNote}</span>
        )}
      </div>
      <div className="flex items-stretch">
        <div className="font-display px-5 py-5 text-4xl uppercase flex-1 flex items-center gap-3" style={{ background: color, color: textColor }}>
          {ultimate ? (
            <UltimateGoonerBadge rank={leaderboardRank} size={54} data-testid={`${testid}-ultimate-badge`} />
          ) : (
            <AnimatedRankIcon
              tier={tier}
              division={division}
              size={60}
              testid={`${testid}-icon`}
            />
          )}
          <div className="flex flex-col leading-none">
            <span className={ultimate ? "text-3xl" : ""}>{ultimate ? "ULTIMATE GOONER" : name}</span>
            {roman && tier !== 8 && (
              <span className="font-anton tracking-widest text-base mt-1 opacity-90" data-testid={`${testid}-division`}>
                {roman}
              </span>
            )}
            {ultimate && (
              <span className="font-anton tracking-widest text-sm mt-1" data-testid={`${testid}-leaderboard-tag`}>
                #{leaderboardRank} GLOBAL
              </span>
            )}
          </div>
        </div>
        {!predictedNote && (
          <div className="bg-neutral-900 text-white px-5 py-5 font-display text-4xl border-l-2 border-black tabular-nums">
            {points}
            <span className="font-anton uppercase tracking-widest text-xs ml-1 opacity-60">RP</span>
          </div>
        )}
      </div>
      {/* Progression bar to the next sub-division (or next tier from I).
          Hidden for the Peak Rank card — peak is a static snapshot of the
          high-water mark, not something the player is actively climbing. */}
      {footer && <div className="px-5 py-3 bg-neutral-800 border-t-2 border-black">{footer}</div>}
      {!crown && !predictedNote && (
        <div className="px-5 py-3 bg-neutral-800 border-t-2 border-black" data-testid={`${testid}-progress-wrap`}>
          <RankProgressBar
            tier={tier}
            division={division}
            points={points}
            testid={`${testid}-progress`}
            onDark
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, textColor = "#fff", testid }) {
  return (
    <div className="card-pow p-6" style={{ background: color, color: textColor }} data-testid={testid}>
      <div className="font-anton uppercase tracking-widest text-sm opacity-80">{label}</div>
      <div className="font-display text-5xl mt-2">{value}</div>
    </div>
  );
}

function AvatarPicker({ avatarIdx, peakTier, peakDivision = 0, playerLevel, saving, onPick }) {
  return (
    <div className="card-pow p-0 mt-6 overflow-hidden" data-testid="avatar-picker">
      <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
        <Crown size={18} strokeWidth={3} className="text-[#FFD700]" />
        <span className="font-anton uppercase tracking-widest">Profile Photo</span>
        {saving && (
          <span className="ml-auto font-anton uppercase text-xs text-[#FFD700]" data-testid="avatar-saving">
            Saving...
          </span>
        )}
      </div>
      <div className="p-5 bg-neutral-900 text-white">
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: AVATAR_COUNT }).map((_, i) => {
            const active = i === avatarIdx;
            const isPeak = i === 5;
            const lockMeta = AVATAR_LOCKS[i];
            const unlocked = !lockMeta || isAvatarUnlocked(i, playerLevel, peakTier);
            const sublabel =
              isPeak ? "Peak Crest" :
              lockMeta && !unlocked ? (
                lockMeta.tier > 0
                  ? `LV ${lockMeta.level} OR T${lockMeta.tier}+`
                  : `LV ${lockMeta.level}`
              ) :
              lockMeta ? lockMeta.label.toUpperCase() :
              null;
            return (
              <button
                key={i}
                type="button"
                onClick={() => !saving && unlocked && onPick(i)}
                disabled={!unlocked || saving}
                className={`relative flex flex-col items-center gap-1 p-1 transition-transform ${active ? "translate-y-[-2px]" : "hover:translate-y-[-1px]"} ${!unlocked ? "opacity-60 cursor-not-allowed" : ""}`}
                data-testid={`avatar-option-${i}`}
                aria-pressed={active}
                aria-disabled={!unlocked}
                aria-label={unlocked ? (lockMeta?.label || (isPeak ? "Peak Rank Crest" : `Avatar ${i + 1}`)) : `Locked — ${sublabel}`}
              >
                <div className={`relative p-1 ${active ? "ring-4 ring-[#FFD700] rounded-sm" : ""}`}>
                  <Avatar idx={i} peakTier={peakTier} peakDivision={peakDivision} size={56} testid={`avatar-option-${i}-avatar`} />
                  {!unlocked && (
                    <span
                      className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-sm"
                      data-testid={`avatar-option-${i}-locked`}
                    >
                      <Lock size={22} strokeWidth={3} className="text-white" />
                    </span>
                  )}
                </div>
                {sublabel && (
                  <span className={`font-anton uppercase text-[10px] tracking-widest ${unlocked ? "text-neutral-700" : "text-neutral-500"}`}>
                    {sublabel}
                  </span>
                )}
                {active && unlocked && (
                  <Check size={14} strokeWidth={4} className="absolute -top-1 -right-1 text-[#06A35F] bg-white border-2 border-black rounded-full p-0.5" />
                )}
              </button>
            );
          })}
        </div>
        <p className="font-body text-xs text-neutral-500 mt-3">
          The <span className="font-anton uppercase">Peak Crest</span> dynamically shows your highest rank icon. Animated specials unlock at higher levels or peak ranks.
        </p>
      </div>
    </div>
  );
}

// Wide banner strip rendered above the username — shows the chosen icon over
// a diagonal-striped band of the chosen color. When `animated` is true, a
// CSS shimmer overlay sweeps across.
function ProfileBanner({ iconIdx, colorIdx, animated = false, title = null, titleClass = "", titleStyle }) {
  const c = bannerColorMeta(colorIdx);
  const I = bannerIconMeta(iconIdx).Icon;
  return (
    <div
      className={`relative h-24 md:h-28 border-b-4 border-black flex items-center justify-end px-6 overflow-hidden ${animated ? "banner-anim" : ""}`}
      style={{
        background: c.bg,
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.10) 0 14px, transparent 14px 28px)",
      }}
      data-testid="profile-banner"
      data-animated={animated || undefined}
    >
      {/* Past-season peak-rank title — big centred flex ("S2 · GRANDMASTER"). */}
      {title && (
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
          data-testid="profile-banner-title"
        >
          <span
            className={`font-display uppercase text-2xl md:text-3xl tracking-widest text-center px-3 py-1 border-2 border-black bg-black/25 ${titleClass.replace("custom-title-rainbow", "")}`}
            style={{
              color: c.fg,
              textShadow: "2px 2px 0 rgba(0,0,0,0.85)",
              ...titleStyle,
            }}
          >
            {titleClass.includes("custom-title-rainbow") ? <span className="custom-title-rainbow">{title}</span> : title}
          </span>
        </div>
      )}
      <I
        size={88}
        strokeWidth={3}
        style={{ color: c.fg }}
        className="drop-shadow-[3px_3px_0_rgba(0,0,0,0.85)]"
        data-testid="profile-banner-icon"
      />
      <Sparkles
        size={22}
        strokeWidth={3}
        style={{ color: c.fg, opacity: 0.7 }}
        className="absolute top-4 left-6"
      />
      <Award
        size={28}
        strokeWidth={3}
        style={{ color: c.fg, opacity: 0.55 }}
        className="absolute bottom-3 left-14"
      />
    </div>
  );
}

// Level + XP progress bar.
function LevelCard({ level, xpInto, xpForNext, totalXp }) {
  const pct = Math.max(0, Math.min(100, Math.round((xpInto / Math.max(1, xpForNext)) * 100)));
  return (
    <div className="card-pow p-0 mt-6 overflow-hidden" data-testid="profile-level-card">
      <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
        <Star size={18} strokeWidth={3} className="text-[#FFD700]" />
        <span className="font-anton uppercase tracking-widest">Level</span>
        <span className="ml-auto font-anton uppercase tracking-widest text-xs text-neutral-400" data-testid="profile-level-total-xp">
          {totalXp} XP TOTAL
        </span>
      </div>
      <div className="p-5 bg-neutral-900 text-white">
        <div className="flex items-end gap-4 mb-3">
          <div
            className="font-display text-6xl text-[#0055FF] leading-none tabular-nums"
            data-testid="profile-level-number"
          >
            {level}
          </div>
          <div className="flex-1 pb-2">
            <div className="flex items-center justify-between font-anton uppercase tracking-widest text-xs text-neutral-700 mb-1">
              <span>NEXT: LV {level + 1}</span>
              <span data-testid="profile-level-progress-text">
                {xpInto} / {xpForNext} XP
              </span>
            </div>
            <div className="h-3 border-2 border-black bg-neutral-200 overflow-hidden">
              <div
                className="h-full bg-[#FFD700]"
                style={{ width: `${pct}%`, transition: "width 0.4s ease" }}
                data-testid="profile-level-progress-bar"
              />
            </div>
          </div>
        </div>
        <p className="font-body text-xs text-neutral-500">
          +10 XP per kill · +50 XP per win · +25 XP per match completed.
        </p>
      </div>
    </div>
  );
}

function BannerCustomizer({ iconIdx, colorIdx, animated, animatedUnlocked, saving, onPickIcon, onPickColor, onToggleAnimated }) {
  return (
    <div className="card-pow p-0 mt-6 overflow-hidden" data-testid="banner-customizer">
      <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
        <Sparkles size={18} strokeWidth={3} className="text-[#FFD700]" />
        <span className="font-anton uppercase tracking-widest">Customize Banner</span>
        {saving && (
          <span className="ml-auto font-anton uppercase text-xs text-[#FFD700]" data-testid="banner-saving">
            Saving...
          </span>
        )}
      </div>
      <div className="p-5 bg-neutral-900 text-white">
        <div className="font-anton uppercase tracking-widest text-sm text-neutral-700 mb-2">Icon</div>
        <div className="flex flex-wrap gap-2 mb-5" data-testid="banner-icon-grid">
          {BANNER_ICONS.map((b, i) => {
            const I = b.Icon;
            const active = i === iconIdx;
            return (
              <button
                key={i}
                type="button"
                onClick={() => !saving && onPickIcon(i)}
                className={`w-14 h-14 border-2 border-black shadow-pow-sm flex items-center justify-center transition-transform ${active ? "translate-y-[-2px]" : "hover:translate-y-[-1px]"}`}
                style={{ background: active ? bannerColorMeta(colorIdx).bg : "#F4F4F5" }}
                aria-label={b.label}
                data-testid={`banner-icon-${i}`}
                aria-pressed={active}
              >
                <I size={28} strokeWidth={3} style={{ color: active ? bannerColorMeta(colorIdx).fg : "#0A0A0A" }} />
                {active && (
                  <Check
                    size={14}
                    strokeWidth={4}
                    className="absolute"
                    style={{ color: bannerColorMeta(colorIdx).fg, transform: "translate(16px,-16px)" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="font-anton uppercase tracking-widest text-sm text-neutral-700 mb-2">Color</div>
        <div className="flex flex-wrap gap-2 mb-5" data-testid="banner-color-grid">
          {BANNER_COLORS.map((c, i) => {
            const active = i === colorIdx;
            return (
              <button
                key={i}
                type="button"
                onClick={() => !saving && onPickColor(i)}
                className={`w-14 h-14 border-2 border-black shadow-pow-sm flex items-center justify-center transition-transform ${active ? "translate-y-[-2px]" : "hover:translate-y-[-1px]"}`}
                style={{ background: c.bg }}
                aria-label={c.name}
                data-testid={`banner-color-${i}`}
                aria-pressed={active}
              >
                {active && <Check size={22} strokeWidth={4} style={{ color: c.fg }} />}
              </button>
            );
          })}
        </div>

        {/* Animated banner toggle */}
        <div className="border-t border-neutral-200 pt-4">
          <button
            type="button"
            disabled={!animatedUnlocked || saving}
            onClick={() => onToggleAnimated(!animated)}
            className={`w-full flex items-center justify-between gap-3 rounded border-2 border-black px-4 py-2 transition-colors ${
              !animatedUnlocked
                ? "bg-neutral-100 text-neutral-400 cursor-not-allowed"
                : animated
                ? "bg-[#FFD700] text-black"
                : "bg-white hover:bg-neutral-50"
            }`}
            data-testid="banner-animated-toggle"
            aria-pressed={animated}
          >
            <div className="flex items-center gap-2">
              {animatedUnlocked ? (
                <Sparkles size={16} strokeWidth={3} />
              ) : (
                <Lock size={16} strokeWidth={3} />
              )}
              <span className="font-anton uppercase tracking-widest text-sm">Animated Banner</span>
            </div>
            <span className="font-anton uppercase tracking-widest text-xs">
              {animatedUnlocked ? (animated ? "ON" : "OFF") : `LV ${BANNER_ANIM_UNLOCK.level} OR GOLD+`}
            </span>
          </button>
          {animatedUnlocked && (
            <p className="font-body text-[11px] text-neutral-500 mt-1">
              Adds a sparkling shimmer sweep across your banner.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


/* TitlePicker — small card listing every finished season with the peak
   tier the user hit. Selecting one equips it as the banner title (e.g.
   "S2 · DIAMOND"); the "NONE" tile clears it. The whole card is hidden
   when the user has no past seasons yet AND they don't qualify for the
   Ultimate Gooner title (top-50 Goonmaster) so brand-new accounts don't
   see an empty state on their first sign-in. */
function TitlePicker({
  pastSeasons = [],
  equippedSeason = null,
  ultimateEquipped = false,
  canEquipUltimate = false,
  leaderboardRank = null,
  saving = false,
  onPick,
  onPickUltimate,
}) {
  // Sort newest-season first so the most recent flex is easiest to grab.
  const sorted = [...pastSeasons].sort((a, b) => Number(b?.season || 0) - Number(a?.season || 0));
  // Hide the card only when there's absolutely nothing to display.
  if (sorted.length === 0 && !canEquipUltimate && !ultimateEquipped) return null;
  const noneSelected = equippedSeason == null && !ultimateEquipped;
  return (
    <div className="mt-6" data-testid="profile-titles-card">
      <div className="flex items-center justify-between mb-2">
        <div className="font-anton uppercase tracking-widest text-xs opacity-70">
          Season Titles
        </div>
        <div className="font-anton uppercase tracking-widest text-[10px] opacity-50">
          Shown on your banner
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {/* None option */}
        <TitleTile
          selected={noneSelected}
          disabled={saving}
          onClick={() => onPick(null)}
          label="NONE"
          sublabel="No title"
          testid="profile-title-tile-none"
        />
        {/* Ultimate Gooner — special title above every season title.
            Only rendered when the user is currently top-50 (canEquip)
            OR still has it equipped from an earlier top-50 stint (so
            they can toggle it off cleanly if desired). The gold + flame
            styling matches the lobby / leaderboard treatment. */}
        {(canEquipUltimate || ultimateEquipped) && (
          <TitleTile
            selected={ultimateEquipped}
            disabled={saving || (!canEquipUltimate && !ultimateEquipped)}
            onClick={() => onPickUltimate(!ultimateEquipped)}
            label="ULTIMATE"
            sublabel={
              ultimateEquipped && Number.isFinite(leaderboardRank)
                ? `#${leaderboardRank} GOONER`
                : "GOONER"
            }
            testid="profile-title-tile-ultimate"
            variant="ultimate"
          />
        )}
        {sorted.map((entry) => {
          const s = Number(entry?.season || 0);
          const active = !ultimateEquipped && Number(equippedSeason) === s;
          const label = `S${s}`;
          const sub = String(entry?.tier_name || "").toUpperCase() || "UNRANKED";
          // Ultimate Gooners get a per-season leaderboard position
          // stamped at rollover. When present, we surface it as a
          // "#N" pill on the tile so equipping this season's title
          // in-game reads "S3 · #7 GOONMASTER".
          const lbRank = Number(entry?.leaderboard_rank || 0);
          return (
            <TitleTile
              key={s}
              selected={active}
              disabled={saving}
              onClick={() => onPick(s)}
              label={label}
              sublabel={sub}
              leaderboardRank={lbRank > 0 ? lbRank : null}
              testid={`profile-title-tile-s${s}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function TitleTile({ selected, disabled, onClick, label, sublabel, leaderboardRank = null, testid, variant = "default" }) {
  const isUltimate = variant === "ultimate";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`border-pow-thin p-3 text-left transition-all relative ${
        isUltimate
          ? "bg-gradient-to-br from-[#FFD700] via-[#FFE9A6] to-[#FFD700] text-black"
          : "bg-neutral-900 text-white"
      } ${
        selected ? "ring-4 ring-[#E62429] translate-y-[-2px]" : "hover:translate-y-[-1px]"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      {isUltimate && (
        <Flame
          size={16}
          strokeWidth={3}
          color="#0A0A0A"
          fill="#B80020"
          className="absolute top-2 right-2"
          data-testid={`${testid}-flame`}
        />
      )}
      {/* Season-end leaderboard placement pill — only shown on past-
          season title tiles when the player finished top-50 that
          season. Reads "#7" in bold gold so it visually communicates
          "you were an Ultimate Gooner". */}
      {!isUltimate && leaderboardRank != null && (
        <span
          className="absolute top-1.5 right-1.5 bg-[#FFD700] text-black font-anton text-[10px] tracking-wider px-1.5 py-0.5 border-2 border-black"
          data-testid={`${testid}-rank`}
          aria-label={`Season-end leaderboard placement: #${leaderboardRank}`}
        >
          #{leaderboardRank}
        </span>
      )}
      <div className="font-display text-2xl leading-none">{label}</div>
      <div className="font-anton uppercase tracking-widest text-[10px] opacity-70 mt-1">
        {sublabel}
      </div>
      {selected && (
        <span className="absolute mt-1 text-[9px] font-anton uppercase tracking-widest text-[#E62429]">
          Equipped
        </span>
      )}
    </button>
  );
}
