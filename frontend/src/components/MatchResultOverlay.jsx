/* Match result overlay — replaces the old generic "MATCH OVER" panel.
   When the local player finishes 1st we show a golden VICTORY splash
   (radial burst + halftone + confetti). For any other placement we show
   a red DEFEAT splash (cracked-glass shatter overlay). The placement
   table is still rendered below so the player can see kills / Δ RP /
   final rank for every participant. */
import { useEffect, useMemo, useState } from "react";
import { Trophy, Skull, Star, Crosshair, Target, Home, Users, Handshake } from "lucide-react";
import { rankIconFor, divisionRoman } from "@/game/rankIcons";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import audioBus from "@/game/audio";

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];
// Team accent colors — matches the in-game team tint (red / blue).
const TEAM_COLORS = { red: "#E62429", blue: "#0055FF" };
const TEAM_LABELS = { red: "TEAM RED", blue: "TEAM BLUE" };

export default function MatchResultOverlay({ matchEnd, youId, isRanked, onLobby }) {
  const placements = matchEnd?.placements || [];
  // TDM detection — the server tags the match_end payload with
  // `game_mode: "tdm"` and includes `team_scores` + `winning_team` +
  // per-placement `team`. For FFA we fall back to the legacy
  // "1st place wins" logic.
  const isTdm = matchEnd?.game_mode === "tdm";
  const teamScores = matchEnd?.team_scores || null;
  const winningTeam = matchEnd?.winning_team ?? null; // null = draw for tdm
  // Find the local player's row. If they aren't in placements (e.g. spectator
  // or a late joiner the server didn't include) we still render a defeat
  // screen — it reads less harshly than no overlay at all.
  const mine = placements.find((p) => p.id === youId) || placements.find((p) => p.user_id === youId);
  const myPlacement = mine ? placements.findIndex((p) => p === mine) + 1 : null;
  const myTeam = mine?.team || null;

  // Determine outcome: TDM uses team win/loss/draw, FFA uses placement.
  let outcome; // "victory" | "defeat" | "draw"
  if (isTdm) {
    if (!myTeam) {
      // Edge case: match_end arrived before youId propagated through the
      // HUD state loop (or the local player isn't in placements). Fall
      // back to a neutral STALEMATE-style overlay rather than
      // misclassifying the player as a loser.
      outcome = "draw";
    } else if (winningTeam === null) {
      outcome = "draw";
    } else if (myTeam === winningTeam) {
      outcome = "victory";
    } else {
      outcome = "defeat";
    }
  } else {
    outcome = myPlacement === 1 ? "victory" : "defeat";
  }
  const isVictory = outcome === "victory";
  const isDraw = outcome === "draw";

  // Build palette per outcome. TDM keeps the same gold/red baseline
  // but uses a distinct silver-blue palette for DRAW so the player can
  // tell instantly that neither team won.
  let palette;
  if (isDraw) {
    palette = {
      accent: "#C0C0C0",
      accentDark: "#5a5a5a",
      ink: "#0A0A0A",
      bgFrom: "#5BC0EB",
      bgTo: "#2b3a55",
      headline: "STALEMATE",
      sub: teamScores ? `${teamScores.red} — ${teamScores.blue}` : "Tied",
      Icon: Handshake,
    };
  } else if (isVictory) {
    palette = {
      accent: "#FFD700",
      accentDark: "#a36a00",
      ink: "#0A0A0A",
      bgFrom: "#FFD700",
      bgTo: "#FF9500",
      headline: isTdm ? "TEAM VICTORY!" : "VICTORY!",
      sub: isTdm
        ? (myTeam ? `${TEAM_LABELS[myTeam]} · ${teamScores?.[myTeam] ?? 0} — ${teamScores?.[myTeam === "red" ? "blue" : "red"] ?? 0}` : "Team Wins")
        : "1st Place",
      Icon: isTdm ? Users : Trophy,
    };
  } else {
    palette = {
      accent: "#E62429",
      accentDark: "#7a1115",
      ink: "#FFFFFF",
      bgFrom: "#240000",
      bgTo: "#7a1115",
      headline: isTdm ? "TEAM DEFEAT" : "DEFEAT",
      sub: isTdm
        ? (myTeam ? `${TEAM_LABELS[myTeam]} · ${teamScores?.[myTeam] ?? 0} — ${teamScores?.[myTeam === "red" ? "blue" : "red"] ?? 0}` : "Team Wiped")
        : (myPlacement ? `${ordinal(myPlacement)} Place` : "Eliminated"),
      Icon: isTdm ? Users : Skull,
    };
  }

  // Stagger entry animation — splash, then headline, then stats, then table.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setStage(1), 60);
    const b = setTimeout(() => setStage(2), 320);
    const c = setTimeout(() => setStage(3), 620);
    // Play the result sting exactly once when the overlay mounts.
    // Draw uses the defeat sting (softer than victory) since neither
    // team won — but the palette communicates it clearly.
    try {
      if (isVictory) audioBus.victory?.();
      else audioBus.defeat?.();
    } catch {}
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Mobile fit: content stack (hero + TDM band + stat tiles + "Back
      // to Lobby" button) overflows a portrait iPhone viewport. Was
      // `overflow-hidden` which clipped the bottom button off-screen.
      // Now scrolls vertically with top-aligned content on mobile
      // (items-start) and keeps the centered feel on tablet/desktop
      // (sm:items-center). pb-10 reserves safe-area so the lobby
      // button never kisses the bottom edge.
      className="absolute inset-0 z-50 overflow-y-auto flex items-start sm:items-center justify-center px-4 pt-4 pb-10 sm:py-6 pointer-events-auto"
      data-testid="match-end-overlay"
      data-result={outcome}
      data-game-mode={isTdm ? "tdm" : "ffa"}
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
          data-testid={`match-result-headline-${outcome}`}
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
                    {isRanked ? "RANKED" : "QUICK MATCH"}{isTdm ? " · TDM" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* TDM scoreboard band — big RED N — M BLUE with the winning
            team's side glowing gold. Only rendered for TDM matches. */}
        {isTdm && teamScores && (
          <div
            className="card-pow p-0 overflow-hidden"
            style={{
              opacity: stage >= 1 ? 1 : 0,
              animation: stage >= 1 ? "match-slide-up 380ms ease-out 120ms both" : "none",
            }}
            data-testid="match-result-tdm-scoreboard"
          >
            <div className="grid grid-cols-2 bg-black">
              {["red", "blue"].map((t) => {
                const isWinner = winningTeam === t;
                const isMine = myTeam === t;
                return (
                  <div
                    key={t}
                    className="relative px-4 py-4 flex items-center justify-center gap-3 border-r-4 border-black last:border-r-0"
                    style={{
                      background: TEAM_COLORS[t],
                      color: "#FFFFFF",
                      // Winner side gets a bright gold inset ring for a
                      // "trophy plaque" feel; loser side stays flat.
                      boxShadow: isWinner ? "inset 0 0 0 4px #FFD700" : "none",
                    }}
                    data-testid={`match-result-team-${t}`}
                    data-team-winner={isWinner ? "true" : "false"}
                  >
                    <Users size={24} strokeWidth={3} />
                    <div className="flex flex-col items-start leading-none">
                      <div className="font-anton uppercase tracking-widest text-xs opacity-90">
                        {TEAM_LABELS[t]}{isMine ? " · YOU" : ""}
                      </div>
                      <div
                        className="font-display text-5xl sm:text-6xl tabular-nums"
                        style={{ textShadow: "3px 3px 0 #0A0A0A" }}
                        data-testid={`match-result-team-score-${t}`}
                      >
                        {teamScores[t] ?? 0}
                      </div>
                    </div>
                    {isWinner && (
                      <div
                        className="absolute top-1 right-1 px-1.5 py-0.5 font-anton uppercase tracking-widest text-[10px] border-2 border-black"
                        style={{ background: "#FFD700", color: "#0A0A0A" }}
                      >
                        WIN
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
                const c = RANK_COLORS[Math.max(0, Math.min(8, p.rank_tier ?? 0))];
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
                      {isTdm && p.team && (
                        <span
                          className="inline-block w-2 h-4 rounded-sm border border-black"
                          style={{ background: TEAM_COLORS[p.team] || "#666" }}
                          aria-label={TEAM_LABELS[p.team]}
                          data-testid={`match-end-team-tag-${i}`}
                        />
                      )}
                      <span>{p.username}</span>
                      {isMe && <span className="text-[9px] text-neutral-500">(YOU)</span>}
                      {p.is_placement && (
                        <span
                          className="inline-flex items-center gap-1 bg-[#9B59B6] text-white border-pow-thin px-1 text-[9px]"
                          aria-label={`Placement ${p.placement_match_number}/${p.placement_matches_total}`}
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
                        style={{ background: c, color: p.rank_tier === 8 ? "#FFD700" : "#0A0A0A" }}
                        data-testid={`match-result-rank-${i}`}
                      >
                        {/* Animated rank icon — every scoreboard row now
                            shows the tier's ornament (division sparkles,
                            halo ring, Goonmaster flame flicker) instead
                            of a static lucide crest. Bumps disguised
                            high-tier bots up to the same visual polish
                            as real players. Falls back to a static icon
                            when rank_tier is missing. */}
                        {Number.isFinite(p.rank_tier) ? (
                          <AnimatedRankIcon
                            tier={p.rank_tier}
                            division={p.rank_division ?? 3}
                            size={12}
                            testid={`match-result-rank-icon-${i}`}
                          />
                        ) : (() => { const RI = rankIconFor(p.rank_tier ?? 0); return <RI size={11} strokeWidth={3} />; })()}
                        {p.rank_name}{divisionRoman(p.rank_division) ? ` ${divisionRoman(p.rank_division)}` : ""}
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
