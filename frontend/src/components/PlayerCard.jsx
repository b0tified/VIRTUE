// PlayerCard — comic-style trading-card visual for any player.
// Used in: lobby header (your own card), death overlay (killer's card),
// friends list (each friend), friend search.
//
// Avatar pool: 5 themed lucide icons + a unique solid color per avatar idx.
// `tier` (0-7) drives the rank band color; `online` shows a green pulse dot.
import { VenetianMask, Skull, Shield, Swords, Ghost } from "lucide-react";

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

const AVATARS = [
  { Icon: VenetianMask, bg: "#E62429", iconColor: "#FFD700", label: "Mask" },
  { Icon: Skull,        bg: "#0A0A0A", iconColor: "#FFD700", label: "Skull" },
  { Icon: Shield,       bg: "#0055FF", iconColor: "#FFFFFF", label: "Shield" },
  { Icon: Swords,       bg: "#9B59B6", iconColor: "#FFFFFF", label: "Swords" },
  { Icon: Ghost,        bg: "#06A35F", iconColor: "#FFFFFF", label: "Ghost" },
];

export function avatarMeta(idx) {
  const i = Math.max(0, Math.min(AVATARS.length - 1, Number.isFinite(idx) ? idx : 0));
  return AVATARS[i];
}

export const AVATAR_COUNT = AVATARS.length;

// Small avatar bubble (used inline e.g. in scoreboards / friend rows).
export function Avatar({ idx = 0, size = 40, online = false, testid }) {
  const meta = avatarMeta(idx);
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

// Full player card with avatar + name + rank band + RP.
// size: "sm" (lobby header) | "md" (default, death overlay) | "lg"
export default function PlayerCard({
  username = "?",
  avatar = 0,
  rankTier = 0,
  rankName = "BRONZE",
  rankPoints = 0,
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
      ? { box: "w-12 h-12", name: "text-base", rank: "text-[10px]", points: "text-xs", avatarSize: 48 }
      : size === "lg"
      ? { box: "w-20 h-20", name: "text-3xl", rank: "text-sm", points: "text-base", avatarSize: 80 }
      : { box: "w-16 h-16", name: "text-xl", rank: "text-xs", points: "text-sm", avatarSize: 64 };

  return (
    <div
      className={`card-pow p-0 inline-flex items-stretch bg-white ${className}`}
      data-testid={testid}
    >
      <div className="flex items-center justify-center px-2" style={{ background: avatarMeta(avatar).bg }}>
        <Avatar idx={avatar} size={dims.avatarSize} online={online} testid={`${testid}-avatar`} />
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
  );
}
