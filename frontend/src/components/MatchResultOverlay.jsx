/* Match result overlay — replaces the old generic "MATCH OVER" panel.
   When the local player finishes 1st we show a golden VICTORY splash
   (radial burst + halftone + confetti). For any other placement we show
   a red DEFEAT splash (cracked-glass shatter overlay). The placement
   table is still rendered below so the player can see kills / Δ RP /
   final rank for every participant. */
import { useEffect, useMemo, useState } from "react";
import { Trophy, Skull, Star, Crosshair, Target, Home } from "lucide-react";
import { rankIconFor } from "@/game/rankIcons";

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

export default function MatchResultOverlay({ matchEnd, youId, isRanked, onLobby }) {
  const placements = matchEnd?.placements || [];
  // Find the local player's row. If they aren't in placements (e.g. spectator
  // or a late joiner the server didn't include) we still render a defeat
  // screen — it reads less harshly than no overlay at all.
  const mine = placements.find((p) => p.id === youId) || placements.find((p) => p.user_id === youId);
  const myPlacement = mine ? placements.findIndex((p) => p === mine) + 1 : null;
  const isVictory = myPlacement === 1;
  const palette = isVictory
    ? {
        accent: "#FFD700",
        accentDark: "#a36a00",
        ink: "#0A0A0A",
        bgFrom: "#FFD700",
        bgTo: "#FF9500",
        headline: "VICTORY!",
        sub: "1st Place",
        Icon: Trophy,
      }
    : {
        accent: "#E62429",
        accentDark: "#7a1115",
        ink: "#FFFFFF",
        bgFrom: "#240000",
        bgTo: "#7a1115",
        headline: "DEFEAT",
        sub: myPlacement ? `${ordinal(myPlacement)} Place` : "Eliminated",
        Icon: Skull,
      };

  // Stagger entry animation — splash, then headline, then stats, then table.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setStage(1), 60);
    const b = setTimeout(() => setStage(2), 320);
    const c = setTimeout(() => setStage(3), 620);
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, []);

  // Confetti positions are randomised once per mount so the burst feels
  // organic. Only renders for victory.
  const confetti = useMemo(
    () => Array.from({ length: 26 }, (_, i) => ({
      key: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      dur: 2.2 + Math.random() * 1.6,
      tilt: Math.random() * 360,
      color: ["#FFD700", "#FF9500", "#FFFFFF", "#0055FF", "#E62429"][i % 5],
    })),
    [],
  );

  return (
    <div
      className="absolute inset-0 z-50 overflow-hidden flex items-center justify-center px-4 py-6 pointer-events-auto"
      data-testid="match-end-overlay"
      data-result={isVictory ? "victory" : "defeat"}
      style={{
        background: `radial-gradient(ellipse at center, ${palette.bgFrom}cc 0%, ${palette.bgTo} 60%, #000 100%)`,
      }}
    >
      {/* Halftone dot pattern (comic style) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30 mix-blend-overlay"
        style={{
          backgroundImage: `radial-gradient(${palette.ink} 1.5px, transparent 1.5px)`,
          backgroundSize: "14px 14px",
        }}
        aria-hidden="true"
      />

      {/* Victory radial-burst spokes */}
      {isVictory && (
        <div
          className="absolute inset-0 pointer-events-none animate-[spin_18s_linear_infinite]"
          style={{
            background: `conic-gradient(${palette.accent} 0deg 8deg, transparent 8deg 22deg, ${palette.accent} 22deg 30deg, transparent 30deg 60deg, ${palette.accent} 60deg 68deg, transparent 68deg 90deg, ${palette.accent} 90deg 98deg, transparent 98deg 120deg, ${palette.accent} 120deg 128deg, transparent 128deg 180deg, ${palette.accent} 180deg 188deg, transparent 188deg 220deg, ${palette.accent} 220deg 228deg, transparent 228deg 270deg, ${palette.accent} 270deg 278deg, transparent 278deg 320deg, ${palette.accent} 320deg 328deg, transparent 328deg 360deg)`,
            maskImage: "radial-gradient(circle at center, black 0%, black 25%, transparent 60%)",
            WebkitMaskImage: "radial-gradient(circle at center, black 0%, black 25%, transparent 60%)",
            opacity: 0.45,
          }}
          aria-hidden="true"
        />
      )}

      {/* Defeat shatter cracks (subtle radial lines) */}
      {!isVictory && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "repeating-conic-gradient(from 0deg at 50% 50%, rgba(0,0,0,0.0) 0deg 12deg, rgba(0,0,0,0.55) 12deg 12.2deg)",
            maskImage: "radial-gradient(circle at center, transparent 8%, black 60%, transparent 95%)",
            WebkitMaskImage: "radial-gradient(circle at center, transparent 8%, black 60%, transparent 95%)",
            opacity: 0.7,
          }}
          aria-hidden="true"
        />
      )}

      {/* Confetti for victory only */}
      {isVictory && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {confetti.map((c) => (
            <span
              key={c.key}
              className="absolute top-[-20px] block w-2 h-3 rounded-sm"
              style={{
                left: `${c.left}%`,
                background: c.color,
                transform: `rotate(${c.tilt}deg)`,
                animation: `match-confetti ${c.dur}s linear ${c.delay}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* Local keyframes (no Tailwind config edit needed) */}
      <style>{`
        @keyframes match-confetti {
          0%   { transform: translateY(0) rotate(0deg); opacity: 0; }
          5%   { opacity: 1; }
          100% { transform: translateY(120vh) rotate(720deg); opacity: 0.9; }
        }
        @keyframes match-pop-in {
          0%   { transform: scale(0.6) rotate(-6deg); opacity: 0; }
          60%  { transform: scale(1.08) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes match-slide-up {
          0%   { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <div className="relative w-full max-w-3xl flex flex-col items-stretch gap-4">
        {/* Hero headline card — diagonally striped band over a thick black border */}
        <div
          className="relative card-pow p-0 overflow-hidden"
          style={{
            background: palette.accent,
            color: palette.ink,
            transform: stage >= 1 ? "none" : "scale(0.85)",
            opacity: stage >= 1 ? 1 : 0,
            animation: stage >= 1 ? "match-pop-in 480ms cubic-bezier(.2,1.2,.4,1) both" : "none",
          }}
          data-testid={`match-result-headline-${isVictory ? "victory" : "defeat"}`}
        >
          {/* diagonal stripes overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-25"
            style={{
              background: `repeating-linear-gradient(45deg, transparent 0 16px, ${palette.ink} 16px 18px)`,
            }}
            aria-hidden="true"
          />
          <div className="relative px-6 py-5 flex items-center gap-5">
            <div
              className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center border-4 border-black"
              style={{ background: palette.ink, color: palette.accent }}
            >
              <palette.Icon size={56} strokeWidth={3} />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="font-display leading-none uppercase tracking-tight"
                style={{ fontSize: "clamp(2.5rem, 7vw, 5rem)" }}
              >
                {palette.headline}
              </div>
              <div className="font-anton uppercase tracking-widest text-sm sm:text-base mt-1 flex items-center gap-2">
                {palette.sub}
                {mine && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 border-2 text-xs"
                    style={{ background: palette.ink, color: palette.accent, borderColor: palette.ink }}
                  >
                    {isRanked ? "RANKED" : "QUICK MATCH"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stat strip — your kills / deaths / RP delta (or placement) */}
        {mine && (
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            style={{
              opacity: stage >= 2 ? 1 : 0,
              animation: stage >= 2 ? "match-slide-up 360ms ease-out both" : "none",
            }}
          >
            <StatTile icon={<Star size={16} strokeWidth={3} />}      label="Placement" value={myPlacement ? ordinal(myPlacement) : "—"} accent={palette.accent} testid="match-result-stat-placement" />
            <StatTile icon={<Crosshair size={16} strokeWidth={3} />} label="Kills"     value={mine.kills ?? 0} accent={palette.accent} testid="match-result-stat-kills" />
            <StatTile icon={<Target size={16} strokeWidth={3} />}    label="Deaths"    value={mine.deaths ?? 0} accent={palette.accent} testid="match-result-stat-deaths" />
            {isRanked ? (
              <StatTile
                icon={<Trophy size={16} strokeWidth={3} />}
                label="RP"
                value={`${(mine.delta ?? 0) >= 0 ? "+" : ""}${mine.delta ?? 0}${mine.is_placement && (mine.delta ?? 0) > 0 ? " ×2" : ""}`}
                accent={(mine.delta ?? 0) >= 0 ? "#06A35F" : "#E62429"}
                testid="match-result-stat-rp"
              />
            ) : (
              <StatTile
                icon={<Trophy size={16} strokeWidth={3} />}
                label="K/D"
                value={mine.deaths > 0 ? (mine.kills / mine.deaths).toFixed(2) : (mine.kills || 0).toFixed(2)}
                accent={palette.accent}
                testid="match-result-stat-kd"
              />
            )}
          </div>
        )}

        {/* Compact placement table — collapsible visual weight under the hero */}
        {placements.length > 0 && (
          <div
            className="card-pow p-0 bg-white overflow-hidden"
            style={{
              opacity: stage >= 3 ? 1 : 0,
              animation: stage >= 3 ? "match-slide-up 360ms ease-out both" : "none",
            }}
          >
            <div className="grid grid-cols-12 bg-[#FFD700] px-3 py-2 font-anton uppercase tracking-widest text-xs border-b-4 border-black">
              <div className="col-span-1">#</div>
              <div className="col-span-5">Player</div>
              <div className="col-span-2 text-right">Kills</div>
              <div className="col-span-2 text-right">{isRanked ? "Δ RP" : "K/D"}</div>
              <div className="col-span-2 text-right">Rank</div>
            </div>
            <div className="max-h-[34vh] overflow-y-auto">
              {placements.map((p, i) => {
                const c = RANK_COLORS[Math.max(0, Math.min(7, p.rank_tier ?? 0))];
                const isMe = p === mine;
                return (
                  <div
                    key={p.id}
                    className={`grid grid-cols-12 px-3 py-1.5 border-t border-black/15 items-center text-sm ${
                      isMe ? "bg-[#FFE680]" : i === 0 ? "bg-[#FFF6CC]" : "bg-white"
                    }`}
                    data-testid={`match-end-row-${i}`}
                  >
                    <div className="col-span-1 font-display text-lg">{i + 1}</div>
                    <div className="col-span-5 font-anton uppercase truncate flex items-center gap-1">
                      <span>{p.username}</span>
                      {isMe && <span className="text-[9px] text-neutral-500">(YOU)</span>}
                      {p.is_placement && (
                        <span
                          className="inline-flex items-center gap-1 bg-[#9B59B6] text-white border-pow-thin px-1 text-[9px]"
                          title={`Placement ${p.placement_match_number}/${p.placement_matches_total}`}
                          data-testid={`placement-badge-${i}`}
                        >
                          <Star size={9} strokeWidth={3} /> P{p.placement_match_number}/{p.placement_matches_total}
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 text-right font-anton">{p.kills}</div>
                    <div
                      className={`col-span-2 text-right font-display text-lg ${
                        isRanked
                          ? ((p.delta ?? 0) >= 0 ? "text-[#06A35F]" : "text-[#E62429]")
                          : "text-black"
                      }`}
                      data-testid={`match-end-delta-${i}`}
                    >
                      {isRanked ? (
                        <>
                          {(p.delta ?? 0) >= 0 ? "+" : ""}{p.delta ?? 0}
                          {p.is_placement && (p.delta ?? 0) > 0 && (
                            <span className="ml-1 text-[10px] font-anton text-[#9B59B6]">2x</span>
                          )}
                        </>
                      ) : (
                        (p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : (p.kills || 0).toFixed(2))
                      )}
                    </div>
                    <div className="col-span-2 text-right">
                      <span
                        className="inline-flex items-center gap-1 font-anton uppercase text-[11px] px-1.5 py-0.5"
                        style={{ background: c, color: p.rank_tier === 7 ? "#FFD700" : "#0A0A0A" }}
                      >
                        {(() => { const RI = rankIconFor(p.rank_tier ?? 0); return <RI size={11} strokeWidth={3} />; })()}
                        {p.rank_name}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div
          className="flex justify-center"
          style={{
            opacity: stage >= 3 ? 1 : 0,
            animation: stage >= 3 ? "match-slide-up 360ms ease-out 60ms both" : "none",
          }}
        >
          <button
            onClick={onLobby}
            className="btn-pow bg-white text-black w-full sm:w-auto sm:min-w-[260px] [&]:py-3"
            data-testid="match-result-lobby"
          >
            <span className="flex items-center justify-center gap-2 font-anton uppercase tracking-widest">
              <Home size={18} strokeWidth={3} /> Back to Lobby
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, accent, testid }) {
  return (
    <div
      className="card-pow bg-white p-3 flex items-center gap-3"
      data-testid={testid}
    >
      <div
        className="w-9 h-9 flex items-center justify-center border-2 border-black"
        style={{ background: accent, color: "#0A0A0A" }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-500">{label}</div>
        <div className="font-display text-xl leading-tight" style={{ color: accent === "#FFD700" || accent === "#06A35F" ? "#0A0A0A" : accent }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function ordinal(n) {
  if (n == null) return "—";
  const s = ["TH", "ST", "ND", "RD"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
