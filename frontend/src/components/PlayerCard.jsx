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
  Anchor, Cat, Dog, Rocket, Drama, Wind, Cherry, Bird, Diamond, Heart,
} from "lucide-react";
import { RANK_COLORS as TIER_COLORS, rankIconFor, rankColorFor, divisionRoman, isUltimateGooner } from "@/game/rankIcons";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import UltimateGoonerBadge from "@/components/UltimateGoonerBadge";

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
  // ─── 2026-06-29 expansion — 8 new icons ─────────────────────────────
  // First 4 are static, last 4 are animated (anim hooked into existing
  // CSS `avatar-anim-*` classes; each one falls back to a sane static
  // appearance if the class is missing).
  // idx 12 — Anchor (deep navy / gold)
  { Icon: Anchor,       bg: "#00254a", iconColor: "#FFD700", label: "Anchor" },
  // idx 13 — Cat (orange / cream)
  { Icon: Cat,          bg: "#FF7B00", iconColor: "#FFF1D6", label: "Cat" },
  // idx 14 — Dog (charcoal / soft gold)
  { Icon: Dog,          bg: "#3a2a1a", iconColor: "#FFD79A", label: "Dog" },
  // idx 15 — Rocket (deep teal / hot pink)
  { Icon: Rocket,       bg: "#004052", iconColor: "#ff3a8a", label: "Rocket" },
  // idx 16 — Drama Masks (ruby / cream)
  { Icon: Drama,        bg: "#7a0010", iconColor: "#fff1d6", label: "Drama" },
  // idx 17 — Cyclone Wind (animated, reusing the lightning animation
  // class for now since both are kinetic swirls)
  { Icon: Wind,          bg: "#0a3a5a", iconColor: "#9adcff", label: "Cyclone", anim: "lightning" },
  // idx 18 — Cherry (animated pulse via diamond class)
  { Icon: Cherry,        bg: "#3a0010", iconColor: "#ff3a6b", label: "Cherry Bomb", anim: "diamond" },
  // idx 19 — Phoenix (animated flame via flame class)
  { Icon: Bird,          bg: "#ff5500", iconColor: "#FFD700", label: "Phoenix",     anim: "flame" },
  // idx 20 — Sacred Diamond (animated diamond pulse)
  { Icon: Diamond,       bg: "#0a0a3a", iconColor: "#ff00ff", label: "Sacred Diamond", anim: "diamond" },
  // idx 21 — Heart Sigil (static, vivid red)
  { Icon: Heart,         bg: "#E62429", iconColor: "#fff1d6", label: "Heart Sigil" },
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
// `peakTier` + `peakDivision` only matter when `idx === 5` (Peak Crest):
// in that case the bubble renders the player's animated rank icon with
// division-aware ornaments instead of the static lucide icon.
export function Avatar({ idx = 0, peakTier = null, peakDivision = 0, size = 40, online = false, testid }) {
  const meta = avatarMeta(idx, peakTier);
  const I = meta.Icon;
  const animClass = meta.anim ? `avatar-anim-${meta.anim}` : "";
  // Peak Crest: render the same AnimatedRankIcon used everywhere else so
  // the avatar bubble matches the player's current/peak tier ornaments
  // (orbiting sparkles, halo ring, Goonmaster flame, etc.). Falls back
  // to the static icon path if peakTier wasn't supplied.
  const isAnimatedPeakCrest = meta.isPeakCrest && Number.isFinite(peakTier);
  return (
    <span
      className={`relative inline-flex items-center justify-center border-2 border-black shadow-pow-sm flex-shrink-0 ${animClass}`}
      style={{ width: size, height: size, background: meta.bg }}
      title={meta.label}
      data-testid={testid}
      data-anim={meta.anim || (isAnimatedPeakCrest ? "peakcrest" : undefined)}
    >
      {isAnimatedPeakCrest ? (
        <AnimatedRankIcon
          tier={peakTier}
          division={peakDivision}
          size={size}
          testid={testid ? `${testid}-rank-icon` : undefined}
        />
      ) : (
        <I size={Math.round(size * 0.55)} strokeWidth={3} style={{ color: meta.iconColor }} />
      )}
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

function BannerStrip({ iconIdx = 0, colorIdx = 0, height = 14, animated = false, level = null, title = null, titleClass = "" }) {
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
      {/* Centre: optional past-season title ("S2 · DIAMOND"). Sized a
          hair larger than the level chip so the flex is legible even
          on the small (sm) size banner strip in the lobby header. */}
      {title && (
        <span
          className={`absolute left-1/2 -translate-x-1/2 font-anton uppercase tracking-widest leading-none whitespace-nowrap pointer-events-none px-1 border border-black/40 bg-black/25 ${titleClass}`}
          style={{
            color: c.fg,
            fontSize: Math.max(9, height - 2),
            textShadow: "0 1px 0 rgba(0,0,0,0.85)",
          }}
          data-testid="player-card-banner-title"
        >
          {title}
        </span>
      )}
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
  rankDivision = 0,
  rankPoints = 0,
  peakRankTier = null,
  peakRankDivision = 0,
  bannerIcon = null,
  bannerColor = null,
  bannerAnimated = false,
  bannerTitle = null,   // e.g. "S2 · DIAMOND" — past-season peak-rank flex.
  bannerTitleClass = "", // Optional extra class for Master+ shimmer.
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
      {showBanner && <BannerStrip iconIdx={bannerIcon} colorIdx={bannerColor} height={dims.banner} animated={bannerAnimated} level={Number.isFinite(level) ? level : null} title={bannerTitle} titleClass={bannerTitleClass} />}
      <div className="flex items-stretch">
        <div className="flex items-center justify-center px-2" style={{ background: avatarMeta(avatar, peakRankTier).bg }}>
          <Avatar idx={avatar} peakTier={peakRankTier} peakDivision={peakRankDivision} size={dims.avatarSize} online={online} testid={`${testid}-avatar`} />
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
            {(() => {
              const ultimate = !isBot && isUltimateGooner(t, leaderboardRank);
              return (
                <>
                  <span
                    className={`font-anton uppercase tracking-widest px-2 py-0.5 border-2 border-black ${dims.rank}`}
                    style={{ background: rankColor, color: rankTextColor }}
                    data-testid={`${testid}-rank`}
                  >
                    {isBot ? "BOT" : (ultimate
                      ? "ULTIMATE GOONER"
                      : (rankName + (divisionRoman(rankDivision) ? ` ${divisionRoman(rankDivision)}` : "")))}
                  </span>
                  {/* Ultimate Gooner (top-50 Goonmaster) → flame + #N.
                      Other Goonmasters just show the plain rank pill. */}
                  {ultimate && (
                    <UltimateGoonerBadge
                      rank={leaderboardRank}
                      size={22}
                      data-testid={`${testid}-ultimate-gooner`}
                    />
                  )}
                </>
              );
            })()}
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
