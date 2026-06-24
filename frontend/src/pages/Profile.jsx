import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import api from "@/api";
import {
  ArrowLeft, Crown, Trophy, Bot, Swords, History, WifiOff,
  Flame, Star, Zap, Bomb, Target, Skull, Sparkles, Award,
  Check, Lock, Gem, Snowflake, Atom, Shield, Users,
} from "lucide-react";
import { rankIconFor, divisionRoman } from "@/game/rankIcons";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import { Avatar, AVATAR_COUNT } from "@/components/PlayerCard";
import { levelFromStats } from "@/game/level";
import { LEVEL_REWARDS } from "@/game/levelRewards";
import audioBus from "@/game/audio";

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

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

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
  label: "TDM 3V3",
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
  const currentTier = Math.max(0, Math.min(7, user?.rank_tier ?? 0));
  const currentName = user?.rank_name || "BRONZE";
  const peakRP = user?.peak_rank_points ?? currentRP;
  const peakTier = Math.max(0, Math.min(7, user?.peak_rank_tier ?? currentTier));
  const peakName = user?.peak_rank_name || currentName;

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
      alert(e.response?.data?.detail || "Could not save banner");
    }
    setSavingBanner(false);
  };

  const updateAvatar = async (nextIdx) => {
    setSavingAvatar(true);
    try {
      await api.post("/profile/me/avatar", { avatar: nextIdx });
      await refreshMe();
    } catch (e) {
      alert(e.response?.data?.detail || "Could not save avatar");
    }
    setSavingAvatar(false);
  };

  const [history, setHistory] = useState(null); // null = loading, [] = empty
  const [historyError, setHistoryError] = useState(null);
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
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/me/season_history");
        if (alive) setSeasonHistory(Array.isArray(data) ? data : []);
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
    <div className="min-h-screen bg-[#F4F4F5] halftone-light p-6 md:p-12" data-testid="profile-page">
      <Link to="/lobby" draggable={false} onDragStart={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }} className="btn-pow bg-white text-black select-none" data-testid="profile-back-button">
        <span className="flex items-center gap-2"><ArrowLeft size={18} strokeWidth={3} /> BACK</span>
      </Link>

      <div className="max-w-4xl mx-auto mt-8">
        <div className="card-pow p-0 -rotate-1 overflow-hidden">
          {/* User banner (icon + color) */}
          <ProfileBanner iconIdx={bannerIcon} colorIdx={bannerColor} animated={bannerAnimated} />
          <div className="p-8">
            <div className="inline-block bg-[#0055FF] text-white border-pow shadow-pow-sm px-3 py-1 -rotate-2 mb-3">
              <span className="font-anton uppercase tracking-widest">Profile</span>
            </div>
            <h1 className="font-display text-6xl uppercase text-pow-shadow" data-testid="profile-username">
              {user?.username}
            </h1>
          </div>
        </div>

        {/* Level + XP progress */}
        <LevelCard level={lvl.level} xpInto={lvl.xpIntoLevel} xpForNext={lvl.xpForNext} totalXp={lvl.totalXp} />

        {/* Level progression rewards (1-10) */}
        <LevelRewardsCard currentLevel={lvl.level} />

        {/* Banner customization */}
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
          playerLevel={lvl.level}
          saving={savingAvatar}
          onPick={updateAvatar}
        />

        {/* Rank cards: current + peak */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-8">
          <RankCard
            label="Current Rank"
            tier={currentTier}
            name={currentName}
            division={user?.rank_division ?? 0}
            points={currentRP}
            testid="profile-current-rank"
          />
          <RankCard
            label="Peak Rank"
            tier={peakTier}
            name={peakName}
            division={user?.peak_rank_division ?? 0}
            points={peakRP}
            crown
            testid="profile-peak-rank"
          />
        </div>

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
                <HistoryRow key={i} idx={i} m={m} />
              ))}
            </>
          )}
        </div>

        {/* Past Seasons — every archived season where the user finished
            top-100 shows here. Quiet section: only renders when at least
            one archived placement exists so brand-new accounts don't see
            a confusing empty card. */}
        {seasonHistory !== null && seasonHistory.length > 0 && (
          <div className="card-pow p-0 mt-8 overflow-hidden" data-testid="profile-season-history-card">
            <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
              <Trophy size={18} strokeWidth={3} className="text-[#FFD700]" />
              <span className="font-anton uppercase tracking-widest">Past Seasons</span>
              <span className="opacity-60 text-xs ml-auto">Your top-100 finishes</span>
            </div>
            <div className="hidden md:grid grid-cols-12 bg-[#FFD700] px-4 py-2 font-anton uppercase tracking-widest text-sm border-t-4 border-black">
              <div className="col-span-2">Season</div>
              <div className="col-span-3">Tier</div>
              <div className="col-span-2 text-right">Global #</div>
              <div className="col-span-2 text-right">Final RP</div>
              <div className="col-span-3 text-right">Kills</div>
            </div>
            {seasonHistory.map((s, i) => {
              const tier = Math.max(0, Math.min(7, s.rank_tier ?? 0));
              const color = RANK_COLORS[tier];
              return (
                <div
                  key={s.season_number}
                  className={`grid grid-cols-12 px-4 py-3 border-t-2 border-black items-center ${i % 2 === 0 ? "bg-white" : "bg-[#F4F4F5]"}`}
                  data-testid={`profile-season-row-${s.season_number}`}
                >
                  <div className="col-span-2 font-display text-2xl">S{s.season_number}</div>
                  <div className="col-span-3">
                    <span
                      className="font-anton uppercase text-xs px-2 py-1"
                      style={{ background: color, color: tier === 7 ? "#FFD700" : "#0A0A0A" }}
                    >
                      {s.rank_name || "BRONZE"}
                    </span>
                  </div>
                  <div className="col-span-2 text-right font-display text-xl">#{s.rank}</div>
                  <div className="col-span-2 text-right font-anton text-lg">{s.rank_points}</div>
                  <div className="col-span-3 text-right font-anton">{s.kills}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ idx, m }) {
  // TDM rows use a dedicated badge + WIN/LOSS card in the placement
  // slot. FFA rows keep the original "Nth of M" placement card.
  const isTdm = m.game_mode === "tdm";
  const meta = isTdm
    ? { ...TDM_MODE_META, ...MODE_META[m.mode], Icon: TDM_MODE_META.Icon, label: TDM_MODE_META.label, color: TDM_MODE_META.color }
    : (MODE_META[m.mode] || MODE_META.casual);
  const M = meta.Icon;
  const rankColor = RANK_COLORS[Math.max(0, Math.min(7, ((rankIdxFromName(m.rank_name_after)) || 0)))];
  const deltaColor = m.rp_delta > 0 ? "#06A35F" : m.rp_delta < 0 ? "#E62429" : "#0A0A0A";
  const sign = m.rp_delta > 0 ? "+" : "";
  const outcome = isTdm ? (TDM_OUTCOME_META[m.team_outcome] || TDM_OUTCOME_META.draw) : null;
  return (
    <div
      className={`grid grid-cols-12 px-4 py-2 border-t-2 border-black items-center text-sm md:text-base ${idx % 2 === 0 ? "bg-white" : "bg-[#F4F4F5]"}`}
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
        {m.rp_delta !== 0 ? `${sign}${m.rp_delta}` : "—"}
        {m.is_placement && m.rp_delta > 0 && (
          <span className="ml-1 text-xs font-anton text-[#9B59B6]">2x</span>
        )}
      </div>
      <div className="col-span-12 md:col-span-2 mt-1 md:mt-0 md:text-right">
        <span
          className="inline-block font-anton uppercase text-xs px-2 py-1"
          style={{ background: rankColor, color: m.rank_name_after === "GOONMASTER" ? "#FFD700" : "#0A0A0A" }}
        >
          {m.rank_name_after || "BRONZE"}
        </span>
      </div>
    </div>
  );
}

function rankIdxFromName(name) {
  const arr = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "MASTER", "GRANDMASTER", "GOONMASTER"];
  return arr.indexOf((name || "BRONZE").toUpperCase());
}

function RankCard({ label, tier, name, division = 0, points, crown = false, testid }) {
  const color = RANK_COLORS[Math.max(0, Math.min(7, tier))];
  const textColor = tier === 7 ? "#FFD700" : "#0A0A0A";
  const roman = divisionRoman(division);
  return (
    <div className="card-pow p-0 overflow-hidden" data-testid={testid}>
      <div className="bg-black text-white px-5 py-2 flex items-center gap-2">
        {crown && <Crown size={16} strokeWidth={3} className="text-[#FFD700]" />}
        <span className="font-anton uppercase tracking-widest text-sm">{label}</span>
      </div>
      <div className="flex items-stretch">
        <div className="font-display px-5 py-5 text-4xl uppercase flex-1 flex items-center gap-3" style={{ background: color, color: textColor }}>
          <AnimatedRankIcon
            tier={tier}
            division={division}
            size={60}
            testid={`${testid}-icon`}
          />
          <div className="flex flex-col leading-none">
            <span>{name}</span>
            {roman && tier !== 7 && (
              <span className="font-anton tracking-widest text-base mt-1 opacity-90" data-testid={`${testid}-division`}>
                {roman}
              </span>
            )}
          </div>
        </div>
        <div className="bg-white px-5 py-5 font-display text-4xl border-l-2 border-black tabular-nums">
          {points}
          <span className="font-anton uppercase tracking-widest text-xs ml-1 opacity-60">RP</span>
        </div>
      </div>
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

function AvatarPicker({ avatarIdx, peakTier, playerLevel, saving, onPick }) {
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
      <div className="p-5 bg-white">
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
                title={unlocked ? (lockMeta?.label || (isPeak ? "Peak Rank Crest" : `Avatar ${i + 1}`)) : `Locked — ${sublabel}`}
              >
                <div className={`relative p-1 ${active ? "ring-4 ring-[#FFD700] rounded-sm" : ""}`}>
                  <Avatar idx={i} peakTier={peakTier} size={56} testid={`avatar-option-${i}-avatar`} />
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
function ProfileBanner({ iconIdx, colorIdx, animated = false }) {
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
      <div className="p-5 bg-white">
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

// LevelRewardsCard — 10-row progression tab showing what unlocks at each level.
// Earned rows pop with the accent color; locked rows are dimmed with a padlock.
function LevelRewardsCard({ currentLevel }) {
  return (
    <div className="card-pow p-0 mt-6 overflow-hidden" data-testid="level-rewards-card">
      <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
        <Trophy size={18} strokeWidth={3} className="text-[#FFD700]" />
        <span className="font-anton uppercase tracking-widest">Progression Rewards</span>
        <span
          className="ml-auto font-anton uppercase tracking-widest text-xs text-neutral-400"
          data-testid="level-rewards-current"
        >
          LV {currentLevel} / 10
        </span>
      </div>
      <div className="p-4 bg-white space-y-2">
        {LEVEL_REWARDS.map((r) => {
          const earned = currentLevel >= r.level;
          const isNext = !earned && currentLevel + 1 === r.level;
          const I = r.Icon;
          return (
            <div
              key={r.level}
              className={`relative flex items-stretch border-2 border-black transition-transform ${earned ? "bg-white" : "bg-neutral-100"} ${isNext ? "ring-4 ring-[#FFD700] -translate-y-0.5" : ""}`}
              data-testid={`reward-row-${r.level}`}
              data-earned={earned || undefined}
            >
              <div
                className="w-16 sm:w-20 flex items-center justify-center font-display text-3xl sm:text-4xl border-r-2 border-black"
                style={{
                  background: earned ? r.accent : "#E5E7EB",
                  color: earned ? (r.accent === "#FFD700" ? "#0A0A0A" : "#FFFFFF") : "#9CA3AF",
                }}
              >
                {r.level}
              </div>
              <div className="flex-1 px-3 py-2 flex items-start gap-2">
                <I
                  size={22}
                  strokeWidth={3}
                  className="mt-0.5 flex-shrink-0"
                  style={{ color: earned ? r.accent : "#9CA3AF" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`font-anton uppercase tracking-widest text-sm ${earned ? "text-black" : "text-neutral-500"} truncate`}
                    >
                      {r.title}
                    </span>
                    {r.big && (
                      <span className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border-2 border-black bg-[#FFD700] text-black">
                        KEY UNLOCK
                      </span>
                    )}
                  </div>
                  <p className={`font-body text-xs leading-snug mt-0.5 ${earned ? "text-neutral-700" : "text-neutral-500"}`}>
                    {r.desc}
                  </p>
                  {r.secondary && (
                    <p className={`font-body text-[11px] mt-0.5 italic ${earned ? "text-neutral-600" : "text-neutral-400"}`}>
                      {r.secondary}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0 self-center pl-1">
                  {earned ? (
                    <span
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-black"
                      style={{ background: "#06A35F" }}
                      title="Unlocked"
                      data-testid={`reward-row-${r.level}-unlocked`}
                    >
                      <Check size={14} strokeWidth={4} className="text-white" />
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-black bg-neutral-300"
                      title={`Unlocks at Level ${r.level}`}
                      data-testid={`reward-row-${r.level}-locked`}
                    >
                      <Lock size={14} strokeWidth={3} className="text-neutral-600" />
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <p className="font-body text-[11px] text-neutral-500 mt-2 pt-1">
          Rewards apply automatically — no claim needed. More tiers coming soon.
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
      <div className="p-5 bg-white">
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
                title={b.label}
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
                title={c.name}
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
