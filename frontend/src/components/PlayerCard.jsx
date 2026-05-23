// PlayerCard — comic-style trading-card visual for any player.
// Used in: lobby header (your own card), death overlay (killer's card),
// friends list (each friend), friend search.
//
// Avatar pool: 5 themed lucide icons + a 6th "Peak Rank Crest" slot that
// dynamically renders the user's current peak rank icon over the rank color.
import {
  VenetianMask, Skull, Shield, Swords, Ghost,
  Trophy, Crown, Flame, Star, Zap, Bomb, Target, Skull as SkullIcon, Sparkles,
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
];

// 8 banner icons + 8 banner colors — must mirror Profile.jsx ordering.
const BANNER_ICONS = [Trophy, Crown, Flame, Star, Zap, Bomb, Target, SkullIcon];
const BANNER_COLORS = [
  { bg: "#E62429", fg: "#FFFFFF" }, { bg: "#0055FF", fg: "#FFFFFF" },
  { bg: "#FFD700", fg: "#0A0A0A" }, { bg: "#06A35F", fg: "#FFFFFF" },
  { bg: "#9B59B6", fg: "#FFFFFF" }, { bg: "#5BC0EB", fg: "#0A0A0A" },
  { bg: "#FF7B00", fg: "#FFFFFF" }, { bg: "#0A0A0A", fg: "#FFD700" },
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
  return (
    <span
      className="relative inline-flex items-center justify-center border-2 border-black shadow-pow-sm flex-shrink-0"
      style={{ width: size, height: size, background: meta.bg }}
      title={meta.label}
      data-testid={testid}
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

function BannerStrip({ iconIdx = 0, colorIdx = 0, height = 14 }) {
  const c = BANNER_COLORS[Math.max(0, Math.min(BANNER_COLORS.length - 1, colorIdx | 0))];
  const I = BANNER_ICONS[Math.max(0, Math.min(BANNER_ICONS.length - 1, iconIdx | 0))];
  return (
    <div
      className="relative w-full border-b-2 border-black flex items-center justify-end pr-1.5 overflow-hidden"
      style={{
        height,
        background: c.bg,
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 6px, transparent 6px 12px)",
      }}
      data-testid="player-card-banner"
    >
      <I size={Math.max(10, height - 4)} strokeWidth={3} style={{ color: c.fg }} />
      <Sparkles
        size={Math.max(8, height - 6)}
        strokeWidth={3}
        style={{ color: c.fg, opacity: 0.7 }}
        className="absolute left-1.5 top-1/2 -translate-y-1/2"
      />
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
      {showBanner && <BannerStrip iconIdx={bannerIcon} colorIdx={bannerColor} height={dims.banner} />}
      <div className="flex items-stretch">
        <div className="flex items-center justify-center px-2" style={{ background: avatarMeta(avatar, peakRankTier).bg }}>
          <Avatar idx={avatar} peakTier={peakRankTier} size={dims.avatarSize} online={online} testid={`${testid}-avatar`} />
        </div>
        <div className="flex flex-col px-3 py-1.5 justify-center min-w-0">
          <div className={`font-display uppercase ${dims.name} leading-tight truncate`} data-testid={`${testid}-username`}>
            {username}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span
              className={`font-anton uppercase tracking-widest px-2 py-0.5 border-2 border-black ${dims.rank}`}
              style={{ background: rankColor, color: rankTextColor }}
              data-testid={`${testid}-rank`}
            >
              {isBot ? "BOT" : rankName}
            </span>
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
