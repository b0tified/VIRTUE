// PlayerCard — comic-style trading-card visual for any player.
// Used in: lobby header (your own card), death overlay (killer's card),
// friends list (each friend), friend search.
//
// Avatar pool: 5 themed icons + Peak Rank Crest (dynamic) + 3 animated specials
// (Flaming Skull / Pulsing Diamond / Swirling Lightning) — opt-in unlockables.
import {
  VenetianMask, Skull, Shield, Swords, Ghost,
  Trophy, Crown, Flame, Star, Zap, Bomb, Target, Skull as SkullIcon, Sparkles,
  Gem, Snowflake, Atom, Eye,
} from "lucide-react";
import { RANK_COLORS as TIER_COLORS, rankIconFor, rankColorFor } from "@/game/rankIcons";

const RANK_COLORS = TIER_COLORS;

const AVATARS = [
  { Icon: VenetianMask, bg: "#E62429", iconColor: "#FFD700", label: "Mask" },
  { Icon: Skull,        bg: "#0A0A0A", iconColor: "#FFD700", label: "Skull" },
  { Icon: Shield,       bg: "#0055FF", iconColor: "#FFFFFF", label: "Shield" },
  { Icon: Swords,       bg: "#9B59B6", iconColor: "#FFFFFF", label: "Swords" },
  { Icon: Ghost,        bg: "#06A35F", iconColor: "#FFFFFF", label: "Ghost" },
  // idx 5 — "Peak Rank Crest" (dynamic). Resolved per-user in avatarMeta().
  { Icon: Crown,        bg: "#FFD700", iconColor: "#0A0A0A", label: "Peak Crest", isPeakCrest: true },
  // idx 6 — Flaming Skull (animated, unlock: Level 5)
  { Icon: Flame,        bg: "#E62429", iconColor: "#FFD700", label: "Flaming Skull", anim: "flame" },
  // idx 7 — Pulsing Diamond (animated, unlock: Level 15 or Diamond peak)
  { Icon: Gem,          bg: "#5BC0EB", iconColor: "#FFFFFF", label: "Pulsing Diamond", anim: "diamond" },
  // idx 8 — Swirling Lightning (animated, unlock: Level 25 or Master peak)
  { Icon: Zap,          bg: "#FFD700", iconColor: "#0A0A0A", label: "Swirling Lightning", anim: "lightning" },
  // idx 9 — Frost Sigil (animated, unlock: Level 10)
  { Icon: Snowflake,    bg: "#0a2a6b", iconColor: "#9adcff", label: "Frost Sigil", anim: "frost" },
  // idx 10 — Quantum Core (animated, unlock: Level 20)
  { Icon: Atom,         bg: "#1a0033", iconColor: "#ff00ff", label: "Quantum Core", anim: "quantum" },
  // idx 11 — All-Seeing Eye (animated, unlock: Level 30 or Goonmaster peak)
  { Icon: Eye,          bg: "#000000", iconColor: "#ff3a3a", label: "All-Seeing Eye", anim: "eye" },
];

// Banner icons / colors — extended pool. Must mirror Profile.jsx ordering.
const BANNER_ICONS = [Trophy, Crown, Flame, Star, Zap, Bomb, Target, SkullIcon, Sparkles, Gem, Snowflake, Atom];
const BANNER_COLORS = [
  { bg: "#E62429", fg: "#FFFFFF" }, { bg: "#0055FF", fg: "#FFFFFF" },
  { bg: "#FFD700", fg: "#0A0A0A" }, { bg: "#06A35F", fg: "#FFFFFF" },
  { bg: "#9B59B6", fg: "#FFFFFF" }, { bg: "#5BC0EB", fg: "#0A0A0A" },
  { bg: "#FF7B00", fg: "#FFFFFF" }, { bg: "#0A0A0A", fg: "#FFD700" },
  // New: deep ocean, neon mint, rose, void purple.
  { bg: "#001a3a", fg: "#9adcff" }, { bg: "#00ffaa", fg: "#0A0A0A" },
  { bg: "#ff3a8a", fg: "#FFFFFF" }, { bg: "#3a0066", fg: "#ff00ff" },
];

export function avatarMeta(idx, peakTier = null) {
  const i = Math.max(0, Math.min(AVATARS.length - 1, Number.isFinite(idx) ? idx : 0));
  const meta = AVATARS[i];
  // For the Peak-Crest avatar, resolve icon + bg dynamically from peakTier.
  if (meta.isPeakCrest && Number.isFinite(peakTier)) {
    const tierIdx = Math.max(0, Math.min(7, peakTier));
    return {
      Icon: rankIconFor(tierIdx),
      bg: rankColorFor(tierIdx),
      iconColor: tierIdx === 7 ? "#FFD700" : "#0A0A0A",
      label: "Peak Crest",
      isPeakCrest: true,
    };
  }
  return meta;
}

export const AVATAR_COUNT = AVATARS.length;

// Small avatar bubble (used inline e.g. in scoreboards / friend rows).
export function Avatar({ idx = 0, peakTier = null, size = 40, online = false, testid }) {
  const meta = avatarMeta(idx, peakTier);
  const I = meta.Icon;
  const animClass = meta.anim ? `avatar-anim-${meta.anim}` : "";
  return (
    <span
      className={`relative inline-flex items-center justify-center border-2 border-black shadow-pow-sm flex-shrink-0 ${animClass}`}
      style={{ width: size, height: size, background: meta.bg }}
      title={meta.label}
      data-testid={testid}
      data-anim={meta.anim || undefined}
    >
      <I size={Math.round(size * 0.55)} strokeWidth={3} style={{ color: meta.iconColor }} />
      {online && (
        <span
          className="absolute -bottom-1 -right-1 block rounded-full border-2 border-black bg-[#06D6A0]"
          style={{ width: 12, height: 12 }}
          data-testid={`${testid}-online-dot`}
        />
      )}
    </span>
  );
}

function BannerStrip({ iconIdx = 0, colorIdx = 0, height = 14, animated = false, level = null }) {
  const c = BANNER_COLORS[Math.max(0, Math.min(BANNER_COLORS.length - 1, colorIdx | 0))];
  const I = BANNER_ICONS[Math.max(0, Math.min(BANNER_ICONS.length - 1, iconIdx | 0))];
  return (
    <div
      className={`relative w-full border-b-2 border-black flex items-center justify-between px-1.5 overflow-hidden ${animated ? "banner-anim" : ""}`}
      style={{
        height,
        background: c.bg,
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 6px, transparent 6px 12px)",
      }}
      data-testid="player-card-banner"
      data-animated={animated || undefined}
    >
      {/* Left side: sparkle + level chip */}
      <div className="flex items-center gap-1">
        <Sparkles size={Math.max(8, height - 6)} strokeWidth={3} style={{ color: c.fg, opacity: 0.85 }} />
        {Number.isFinite(level) && (
          <span
            className="font-anton uppercase tracking-widest leading-none"
            style={{
              color: c.fg,
              fontSize: Math.max(8, height - 4),
              textShadow: "0 1px 0 rgba(0,0,0,0.55)",
            }}
            data-testid="player-card-banner-level"
          >
            LV {level}
          </span>
        )}
      </div>
      <I size={Math.max(10, height - 4)} strokeWidth={3} style={{ color: c.fg }} />
    </div>
  );
}

// Full player card with avatar + name + rank band + RP.
// size: "sm" (lobby header) | "md" (default, death overlay) | "lg"
export default function PlayerCard({
  username = "?",
  avatar = 0,
  rankTier = 0,
  rankName = "BRONZE",
  rankPoints = 0,
  peakRankTier = null,
  bannerIcon = null,
  bannerColor = null,
  bannerAnimated = false,
  level = null,
  leaderboardRank = null, // Goonmaster-only: global leaderboard position (1 = top).
  isBot = false,
  online = false,
  size = "md",
  className = "",
  testid = "player-card",
}) {
  const t = Math.max(0, Math.min(7, rankTier));
  const rankColor = isBot ? "#9B59B6" : RANK_COLORS[t];
  const rankTextColor = isBot || t === 7 ? "#FFD700" : "#0A0A0A";

  const dims =
    size === "sm"
      ? { box: "w-12 h-12", name: "text-base", rank: "text-[10px]", points: "text-xs", avatarSize: 48, banner: 10 }
      : size === "lg"
      ? { box: "w-20 h-20", name: "text-3xl", rank: "text-sm", points: "text-base", avatarSize: 80, banner: 16 }
      : { box: "w-16 h-16", name: "text-xl", rank: "text-xs", points: "text-sm", avatarSize: 64, banner: 12 };

  const showBanner = !isBot && Number.isFinite(bannerIcon) && Number.isFinite(bannerColor);

  return (
    <div
      className={`card-pow p-0 bg-white flex flex-col ${className}`}
      data-testid={testid}
    >
      {showBanner && <BannerStrip iconIdx={bannerIcon} colorIdx={bannerColor} height={dims.banner} animated={bannerAnimated} level={Number.isFinite(level) ? level : null} />}
      <div className="flex items-stretch">
        <div className="flex items-center justify-center px-2" style={{ background: avatarMeta(avatar, peakRankTier).bg }}>
          <Avatar idx={avatar} peakTier={peakRankTier} size={dims.avatarSize} online={online} testid={`${testid}-avatar`} />
        </div>
        <div className="flex flex-col px-3 py-1.5 justify-center min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`font-display uppercase ${dims.name} leading-tight truncate`} data-testid={`${testid}-username`}>
              {username}
            </div>
            {!isBot && Number.isFinite(level) && (
              <span
                className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border-2 border-black bg-[#FFD700] text-[#0A0A0A] flex-shrink-0"
                data-testid={`${testid}-level`}
                title={`Level ${level}`}
              >
                LV {level}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span
              className={`font-anton uppercase tracking-widest px-2 py-0.5 border-2 border-black ${dims.rank}`}
              style={{ background: rankColor, color: rankTextColor }}
              data-testid={`${testid}-rank`}
            >
              {isBot ? "BOT" : rankName}
            </span>
            {/* Goonmaster-only: show the player's global leaderboard
                position (e.g. "#3") next to the rank pill. */}
            {!isBot && t === 7 && Number.isFinite(leaderboardRank) && leaderboardRank > 0 && (
              <span
                className={`font-anton uppercase tracking-widest px-2 py-0.5 border-2 border-black bg-[#FFD700] text-black ${dims.rank}`}
                data-testid={`${testid}-leaderboard-rank`}
                title="Global leaderboard rank"
              >
                #{leaderboardRank}
              </span>
            )}
            {!isBot && (
              <span className={`font-anton tabular-nums ${dims.points} text-neutral-700`} data-testid={`${testid}-rp`}>
                {rankPoints} RP
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
