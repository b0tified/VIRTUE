import { useEffect, useState } from "react";
import { Heart, Trophy, LogOut, Play, Activity, Wifi, Bot, Timer, Crosshair, Zap, Swords, Star, Smartphone, Monitor, Gamepad2, Flag, X, Check } from "lucide-react";
import { rankIconFor } from "@/game/rankIcons";
import PlayerCard from "@/components/PlayerCard";
import MatchResultOverlay from "@/components/MatchResultOverlay";
import settingsStore from "@/game/settings";
import api from "@/api";

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

const WEAPON_META = {
  ak47:   { Icon: Crosshair, color: "#FFD700", label: "AK-47" },
  laser:  { Icon: Zap,       color: "#00CFFF", label: "LASER" },
  katana: { Icon: Swords,    color: "#9B59B6", label: "KATANA" },
};

function WeaponIcon({ weapon }) {
  const meta = WEAPON_META[weapon] || WEAPON_META.ak47;
  const I = meta.Icon;
  return (
    <span
      className="inline-flex items-center justify-center border-pow-thin"
      style={{ background: meta.color, color: "#0A0A0A", width: 22, height: 22 }}
      title={meta.label}
      data-testid={`kf-weapon-${weapon}`}
    >
      <I size={13} strokeWidth={3} />
    </span>
  );
}

// Tiny pill showing the player's input platform: phone, monitor or gamepad.
function PlatformIcon({ platform }) {
  let Icon = Monitor;
  let label = "PC";
  if (platform === "mobile") { Icon = Smartphone; label = "Mobile"; }
  else if (platform === "controller") { Icon = Gamepad2; label = "Controller"; }
  return (
    <span
      className="inline-flex items-center justify-center border-pow-thin bg-white text-black"
      style={{ width: 22, height: 22 }}
      title={label}
      data-testid={`platform-${platform || "pc"}`}
    >
      <Icon size={13} strokeWidth={3} />
    </span>
  );
}

function formatTime(seconds) {
  if (seconds == null) return "--:--";
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function Hud({ hud, username, pointerLocked, onStart, onExit, engineRef, onLobby, onCloseScoreboard }) {
  const [showDmg, setShowDmg] = useState(false);
  const [showHit, setShowHit] = useState(false);
  const [gfx, setGfx] = useState(() => settingsStore.get());
  // Active player-report target (cleared on submit or close). Lives at
  // HUD root so the modal renders above the scoreboard overlay.
  const [reportTarget, setReportTarget] = useState(null);

  // React to live graphics settings (HUD scale, crosshair, toggles).
  useEffect(() => settingsStore.subscribe(setGfx), []);

  useEffect(() => {
    if (!hud.damaged) return;
    setShowDmg(true);
    const t = setTimeout(() => setShowDmg(false), 450);
    return () => clearTimeout(t);
  }, [hud.damaged]);

  useEffect(() => {
    if (!hud.hitConfirm) return;
    setShowHit(true);
    const t = setTimeout(() => setShowHit(false), 220);
    return () => clearTimeout(t);
  }, [hud.hitConfirm]);

  const you = hud.players.find((p) => p.id === hud.youId);
  const kills = you?.kills ?? 0;
  const deaths = you?.deaths ?? 0;

  const hudScale = Math.max(0.6, Math.min(1.4, gfx.hudScale ?? 1.0));
  const showFlash = gfx.showDamageFlash !== false;
  const showKf = gfx.showKillFeed !== false;
  const xhairStyle = gfx.crosshairStyle || "cross";
  // Crosshair colour. In TDM, when the local player's reticle is over
  // a teammate, override the user's preferred colour with a friendly
  // blue tint — same convention as every team shooter ("don't shoot
  // your teammate"). Falls back to the user setting otherwise.
  const xhairColor = hud.crosshairOnTeammate ? "#3aa1ff" : (gfx.crosshairColor || "#FFD700");

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        transform: hudScale !== 1 ? `scale(${hudScale})` : undefined,
        transformOrigin: "top left",
      }}
      data-testid="hud-root"
    >
      {/* ADS scope overlay — circular reticle you see through, dark vignette outside. */}
      {hud.ads && hud.weapon !== "secondary" && pointerLocked && hud.alive && (
        <div className="ads-scope-wrap" data-testid="ads-scope">
          <div className="ads-scope-mask" />
          <div className="ads-scope-ring" />
          <div className="ads-scope-cross-h" />
          <div className="ads-scope-cross-v" />
          <div className="ads-scope-dot" />
        </div>
      )}

      {/* Crosshair — Overwatch-style: 4 ticks that grow with current spread.
          Hidden while aiming down sights (the scope reticle replaces it). */}
      {pointerLocked && hud.alive && !hud.ads && (
        <DynamicCrosshair spread={hud.spread || 0} showHit={showHit} headshot={!!hud.hitHeadshot} style={xhairStyle} color={xhairColor} />
      )}

      {/* TDM-only friendly-fire hint — small chevron-style tag just below
          the reticle when the crosshair is on a teammate. Helps players
          (esp. controller/touch users) avoid wasting bullets on allies. */}
      {pointerLocked && hud.alive && hud.gameMode === "tdm" && hud.crosshairOnTeammate && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-6 px-2 py-0.5 font-anton uppercase tracking-widest text-[10px] pointer-events-none"
          style={{ color: "#3aa1ff", background: "rgba(10,10,10,0.7)", border: "1px solid #3aa1ff" }}
          data-testid="hud-friendly-tag"
        >
          ▲ TEAMMATE
        </div>
      )}

      {/* Damage vignette */}
      {showDmg && showFlash && <div className="dmg-vignette" />}

      {/* Damage-direction indicators — red arcs around the screen edge
          pointing toward whoever shot you. Each marker fades over 1.5s. */}
      <DamageDirectionLayer markers={hud.damageMarkers || []} enabled={showFlash} engineRef={engineRef} />

      {/* Spawn-immunity banner — fixed top, only visible while the local
          player is invuln. Pulses to draw attention so the player knows they
          can't be damaged this brief window. */}
      {hud.alive && hud.invuln && (
        <div
          className="pointer-events-none fixed top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 border-pow shadow-pow-sm"
          style={{
            background: "#FFD700",
            color: "#0A0A0A",
            animation: "invuln-pulse 1.0s ease-in-out infinite",
          }}
          data-testid="hud-invuln-banner"
        >
          <span className="font-anton uppercase tracking-widest text-xs sm:text-sm">SPAWN PROTECTED</span>
        </div>
      )}

      {/* Hit confirm pop near crosshair */}
      {showHit && pointerLocked && (
        <div className="hit-pop" data-testid="hit-pop" style={hud.hitHeadshot ? { color: "#FFD700" } : undefined}>
          {hud.hitHeadshot ? "HEADSHOT!" : "HIT!"}
        </div>
      )}

      {/* Top-left: Username + connection chip. (FPS/Ping counters
          removed per user request — they cluttered the HUD with green
          chips during play.) */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2" data-testid="hud-top-left">
        <div className="hud-panel">
          <div className="text-[#FFD700]">{username}</div>
        </div>
        <div className="hud-panel" style={{ background: hud.connected ? "rgba(10,10,10,0.82)" : "rgba(230,36,41,0.92)" }}>
          <div>{hud.connected ? "ONLINE" : "DISCONNECTED"}</div>
        </div>
      </div>

      {/* Top-center: match timer (+ TDM team score badge when in team mode) */}
      {(hud.inQueue || hud.timeLeft != null) && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2" data-testid="hud-match-timer">
          {hud.inQueue ? (
            <div className="hud-panel" style={{ background: "rgba(0,85,255,0.92)" }}>
              <div className="flex items-center gap-3">
                <Timer size={20} strokeWidth={3} />
                <span className="text-xs opacity-80">QUEUEING</span>
                <span className="font-display text-2xl" data-testid="hud-queue-count">{hud.realCount}/{hud.minRealPlayers}</span>
              </div>
            </div>
          ) : (
            <div className="hud-panel" style={{ background: hud.timeLeft < 30 ? "rgba(230,36,41,0.95)" : (hud.isRanked ? "rgba(0,85,255,0.92)" : "rgba(10,10,10,0.85)") }}>
              <div className="flex items-center gap-3">
                <Timer size={20} strokeWidth={3} />
                <span className="text-xs opacity-80">{hud.isRanked ? "RANKED" : (hud.gameMode === "tdm" ? "TDM 3V3" : "QUICK")}</span>
                <span className="font-display text-3xl" data-testid="hud-time-left">{formatTime(hud.timeLeft)}</span>
              </div>
            </div>
          )}
          {/* TDM-only: polished team-kill scoreboard. Two team-coloured
              columns (RED / BLUE) on either side of a central target
              indicator. The local player's team gets a gold underline so
              they always know which column to track. */}
          {hud.gameMode === "tdm" && hud.teamScores && (
            <TdmTeamScoreboard
              red={hud.teamScores.red ?? 0}
              blue={hud.teamScores.blue ?? 0}
              target={hud.tdmKillTarget || 30}
              myTeam={hud.minimap?.you?.team || null}
            />
          )}
        </div>
      )}

      {/* TDM-only: corner minimap with arena outline + team blips.
          Placed top-left so it doesn't compete with the killfeed (top-right),
          score/ammo (bottom-right), or health bar (bottom-left). FFA is
          unaffected — the panel never renders outside team mode. */}
      {hud.gameMode === "tdm" && hud.minimap && (
        <div className="absolute top-4 left-4 z-20" data-testid="hud-tdm-minimap">
          <TdmMinimap data={hud.minimap} />
        </div>
      )}

      {/* Top-right: kill feed */}
      {showKf && (
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 items-end max-w-[420px]" data-testid="hud-kill-feed">
        {hud.killFeed.slice(0, 6).map((k) => (
          <div key={k.id} className="hud-panel kf-row" style={{ background: "rgba(10,10,10,0.88)" }} data-testid={`kf-row-${k.weapon || "ak47"}`}>
            <div className="flex items-center gap-2">
              <span className="text-[#FFD700]">{k.shooter}</span>
              <WeaponIcon weapon={k.weapon} />
              <span className="text-[#E62429]">{k.victim}</span>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Bottom-left: HP — comic-style angular badge with shield glow when
          invulnerable, gradient fill, pulse-on-low-hp, and a soft shadow
          stroke for the number so it stays legible over busy scenes. */}
      <div className="absolute bottom-6 left-6 z-20" data-testid="hud-health">
        <div
          className={`relative px-4 pt-2 pb-3 flex flex-col gap-2 min-w-[260px] ${
            hud.hp <= 25 && hud.alive ? "anim-lowhp-pulse" : ""
          }`}
          style={{ color: "#fff" }}
        >
          {/* Top row: heart icon, big HP number, status label */}
          <div className="flex items-center gap-3">
            <div
              className="relative w-10 h-10 flex items-center justify-center"
              style={{
                background: hud.invuln ? "#FFD700" : "#E62429",
                boxShadow: hud.hp <= 25 ? "0 0 14px #E62429" : "0 0 8px rgba(230,36,41,0.5)",
              }}
            >
              <Heart size={22} strokeWidth={3} className="text-white" fill="currentColor" />
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span
                  className="font-display text-4xl leading-none"
                  style={{ textShadow: "3px 3px 0 #0A0A0A, -1px -1px 0 #0A0A0A" }}
                  data-testid="hud-hp-value"
                >
                  {hud.hp}
                </span>
                <span className="font-anton uppercase tracking-widest text-xs opacity-70">/ 100</span>
              </div>
              <div className="font-anton uppercase tracking-widest text-[10px] mt-0.5"
                style={{ color: hud.invuln ? "#FFD700" : hud.hp <= 25 ? "#FF6B6B" : "#9af0c8" }}>
                {hud.invuln ? "● SHIELDED" : hud.hp <= 25 ? "⚠ CRITICAL" : hud.hp <= 50 ? "● INJURED" : "● HEALTHY"}
              </div>
            </div>
          </div>
          {/* Segmented health bar — 5 bars of 20HP each, makes it easier
              to read state at a glance vs. a continuous fill. All segments
              share the same color (based on current HP) so the bar reads
              as "X bars remaining" rather than a static gradient. */}
          <div className="flex gap-1 h-4">
            {[0, 20, 40, 60, 80].map((threshold) => {
              const segPct = Math.max(0, Math.min(20, hud.hp - threshold)) / 20;
              const segColor = hud.invuln
                ? "#FFD700"
                : hud.hp > 50 ? "#34C759"
                : hud.hp > 25 ? "#FFD700"
                : "#E62429";
              return (
                <div
                  key={threshold}
                  className="flex-1 relative overflow-hidden"
                  style={{ background: "rgba(0,0,0,0.55)" }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      width: `${segPct * 100}%`,
                      background: `linear-gradient(180deg, ${segColor} 0%, ${segColor}aa 100%)`,
                      transition: "width 0.2s ease-out, background 0.2s",
                      boxShadow: segPct > 0 && hud.hp <= 25 ? `0 0 8px ${segColor}` : "none",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom-right: Score + weapon + ammo */}
      <div className="absolute bottom-6 right-6 z-20 flex flex-col items-end gap-2" data-testid="hud-score">
        <div className="hud-panel">
          <div className="flex items-center gap-3">
            <Trophy size={20} strokeWidth={3} className="text-[#FFD700]" />
            <span className="text-[#FFD700] font-display text-3xl">{kills}</span>
            <span className="opacity-60">/</span>
            <span className="text-[#E62429] font-display text-3xl">{deaths}</span>
          </div>
        </div>

        {/* Ammo + reload (AK) — or heat bar (laser). Hidden for katana. */}
        {hud.weapon === "tertiary" ? (
          <div
            className="hud-panel"
            style={{
              background: hud.laserOverheated ? "rgba(230,36,41,0.92)" : "rgba(10,10,10,0.85)",
              transition: "background 0.18s linear",
            }}
            data-testid="hud-laser-heat"
            data-overheated={hud.laserOverheated || undefined}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-anton uppercase tracking-widest text-[10px] opacity-90">
                {hud.laserOverheated ? "OVERHEATED" : "HEAT"}
              </span>
              <span className="font-display text-2xl tabular-nums leading-none">
                {Math.round(Math.min(1, Math.max(0, hud.laserHeat || 0)) * 100)}%
              </span>
            </div>
            {/* Heat bar — fills cyan→yellow→red as heat climbs. The fill width
                tracks server-side `laser_heat` so it stays accurate across
                lag spikes. */}
            <div
              className="w-40 h-3 border-2 border-white/70 overflow-hidden relative"
              data-testid="hud-laser-heat-bar"
            >
              <div
                className="h-full"
                style={{
                  width: `${Math.min(100, Math.max(0, (hud.laserHeat || 0) * 100))}%`,
                  background:
                    (hud.laserHeat || 0) > 0.85
                      ? "#E62429"
                      : (hud.laserHeat || 0) > 0.55
                      ? "#FFD700"
                      : "#00CFFF",
                  transition: "width 0.08s linear, background 0.2s linear",
                  boxShadow: (hud.laserHeat || 0) > 0.55 ? "0 0 8px rgba(255,68,0,0.6)" : "none",
                }}
              />
              {/* Overheat-threshold tick at 100% (already at the edge). */}
            </div>
            {hud.laserOverheated && (
              <div className="font-anton uppercase text-[10px] tracking-widest text-white mt-1 animate-pulse">
                COOLING…
              </div>
            )}
          </div>
        ) : (
          hud.weapon !== "secondary" && hud.ammo != null && (
            <div className="hud-panel" style={{ background: "rgba(10,10,10,0.85)" }} data-testid="hud-ammo">
              <div className="flex items-end gap-2">
                <span
                  className="font-display text-4xl tabular-nums"
                  style={{ color: hud.ammo === 0 ? "#E62429" : hud.ammo <= Math.max(3, Math.floor((hud.magSize || 1) * 0.2)) ? "#FFD700" : "#FFFFFF" }}
                >
                  {hud.ammo}
                </span>
                <span className="font-anton text-lg text-white/60 mb-1">/ {hud.magSize ?? "—"}</span>
              </div>
              {hud.reloading && (
                <div className="mt-1 w-32 h-1.5 border border-white/40 overflow-hidden" data-testid="hud-reload-bar">
                  <div
                    className="h-full bg-[#FFD700] transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, (hud.reloadProgress || 0) * 100))}%` }}
                  />
                </div>
              )}
              {!hud.reloading && hud.ammo === 0 && (
                <div className="font-anton uppercase text-[10px] tracking-widest text-[#E62429] mt-1 animate-pulse">LOW AMMO</div>
              )}
            </div>
          )
        )}

        <div className="hud-panel" style={{ background: hud.weapon === "secondary" ? "rgba(155,89,182,0.92)" : hud.weapon === "tertiary" ? "rgba(0,207,255,0.92)" : "rgba(255,215,0,0.92)", color: "#0A0A0A" }} data-testid="hud-weapon">
          <div className="text-xs">{hud.weapon === "secondary" ? "KATANA" : hud.weapon === "tertiary" ? "LASER" : "AK-47"}</div>
        </div>
      </div>

      {/* Death overlay */}
      {!hud.alive && pointerLocked && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/60" data-testid="death-overlay">
          <div className="text-center">
            <div className="font-display text-7xl sm:text-8xl text-[#E62429] text-pow-shadow-lg">YOU'RE DOWN!</div>
            <div className="font-anton uppercase tracking-widest text-white mt-3">Respawning...</div>
          </div>
          {hud.lastKiller && (
            <div className="mt-6 flex flex-col items-center" data-testid="death-killer-card">
              <div className="font-anton uppercase tracking-widest text-xs text-white/70 mb-2">Killed by</div>
              <PlayerCard
                size="md"
                username={hud.lastKiller.username}
                avatar={hud.lastKiller.avatar}
                rankTier={hud.lastKiller.rankTier}
                rankName={hud.lastKiller.rankName}
                rankPoints={hud.lastKiller.rankPoints}
                peakRankTier={hud.lastKiller.peakRankTier ?? hud.lastKiller.rankTier}
                bannerIcon={hud.lastKiller.bannerIcon ?? null}
                bannerColor={hud.lastKiller.bannerColor ?? null}
                bannerAnimated={!!hud.lastKiller.bannerAnimated}
                level={hud.lastKiller.level ?? 1}
                isBot={!!hud.lastKiller.isBot}
                testid="killer-card"
              />
            </div>
          )}
        </div>
      )}

      {/* Match end overlay — Victory / Defeat splash with placement stats */}
      {hud.matchEnd && (
        <MatchResultOverlay
          matchEnd={hud.matchEnd}
          youId={hud.youId}
          isRanked={!!hud.isRanked}
          onLobby={onLobby}
        />
      )}

      {/* Click-to-play overlay removed — clicking the canvas now requests
          pointer lock directly. (See Game.jsx canvas onClick wiring.) A small
          EXIT button stays in the top-left so users can leave before locking,
          BUT it's hidden in ranked — the pause menu shows a "Quitting bans
          you for 10 minutes" warning instead, gated on `hud.isRanked`. */}
      {!pointerLocked && !hud.isRanked && (
        <button
          onClick={onExit}
          className="absolute top-4 left-4 z-30 btn-pow bg-white text-black [&]:px-3 [&]:py-2 [&]:text-xs"
          data-testid="game-exit-button"
        >
          <span className="flex items-center gap-2"><LogOut size={16} strokeWidth={3} /> EXIT</span>
        </button>
      )}

      {/* Scoreboard (Tab) */}
      {hud.showScoreboard && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" style={{ pointerEvents: "auto" }} data-testid="scoreboard-overlay">
          <div className="card-pow p-0 w-full max-w-3xl">
            <div className="bg-black text-white px-6 py-3 flex items-center justify-between">
              <div className="font-display text-3xl text-[#FFD700]">SCOREBOARD</div>
              <div className="flex items-center gap-3">
                <div className="font-anton uppercase text-sm tracking-widest">
                  {hud.gameMode === "tdm" ? "Team Deathmatch 3v3" : "Free-For-All"}
                </div>
                <button
                  onClick={() => onCloseScoreboard?.()}
                  className="btn-pow bg-[#E62429] text-white [&]:px-3 [&]:py-1 [&]:text-xs flex items-center gap-1"
                  data-testid="scoreboard-close-btn"
                  title="Close scoreboard (Tab)"
                >
                  <X size={12} strokeWidth={3} /> CLOSE
                </button>
              </div>
            </div>
            {hud.gameMode === "tdm" ? (
              <TdmScoreboardBody
                players={hud.players}
                youId={hud.youId}
                myTeam={hud.minimap?.you?.team || null}
                teamScores={hud.teamScores}
                target={hud.tdmKillTarget || 30}
                onReport={setReportTarget}
              />
            ) : (
              <>
                <div className="grid grid-cols-12 bg-[#FFD700] px-4 py-2 font-anton uppercase tracking-widest text-sm border-t-4 border-black">
                  <div className="col-span-1">#</div>
                  <div className="col-span-1"></div>
                  <div className="col-span-4">Player</div>
                  <div className="col-span-2 text-right">Kills</div>
                  <div className="col-span-2 text-right">Deaths</div>
                  <div className="col-span-2 text-right opacity-60">·</div>
                </div>
                {hud.players.map((p, i) => (
                  <div
                    key={p.id}
                    className={`grid grid-cols-12 px-4 py-2 border-t-2 border-black items-center ${
                      p.id === hud.youId ? "bg-[#FFE680]" : i % 2 === 0 ? "bg-white" : "bg-[#F4F4F5]"
                    }`}
                    data-testid={`scoreboard-row-${i}`}
                  >
                    <div className="col-span-1 font-display text-xl">{i + 1}</div>
                    <div className="col-span-1">
                      {p.is_bot ? (
                        <span className="inline-flex items-center gap-1 bg-[#9B59B6] text-white border-pow-thin px-2 text-xs font-anton uppercase">
                          <Bot size={12} strokeWidth={3} /> BOT
                        </span>
                      ) : (
                        <PlatformIcon platform={p.platform} />
                      )}
                    </div>
                    <div className="col-span-4 font-anton uppercase truncate">{p.username}{p.id === hud.youId ? " · YOU" : ""}</div>
                    <div className="col-span-2 text-right font-anton text-lg">{p.kills}</div>
                    <div className="col-span-2 text-right font-anton text-lg">{p.deaths}</div>
                    <div className="col-span-2 flex justify-end">
                      {p.id !== hud.youId && !p.is_bot && (
                        <button
                          onClick={() => setReportTarget(p)}
                          className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1 [&]:text-[10px] flex items-center gap-1"
                          data-testid={`scoreboard-report-${i}`}
                          title={`Report ${p.username}`}
                        >
                          <Flag size={11} strokeWidth={3} /> REPORT
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {hud.players.length === 0 && (
                  <div className="p-6 font-anton text-center uppercase">No players yet</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {reportTarget && (
        <ReportPlayerModal
          target={reportTarget}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}

// Overwatch-style dynamic crosshair: 4 ticks that spread outward as the
// shooter's accumulated recoil (spread) grows. Server reports `spread` in
// radians; we map it linearly to a pixel gap. Heads-up: hit confirmation
// briefly recolors the ticks (gold on body, red on headshot).
function DynamicCrosshair({ spread, showHit, headshot, style = "cross", color = "#FFD700" }) {
  // 0 rad → 4px gap, 0.16 rad (max) → 22px gap
  const gap = 4 + Math.min(22, Math.round((spread / 0.16) * 18));
  const len = 8;
  const thickness = 2;
  const liveColor = showHit ? (headshot ? "#FFD700" : "#FFFFFF") : color;
  const shadow = "0 0 0 1px #000";
  const common = { position: "absolute", background: liveColor, boxShadow: shadow, pointerEvents: "none" };
  const dotOnly = style === "dot";
  const plusOnly = style === "plus"; // no center dot, 4 ticks
  const circle = style === "circle";
  return (
    <div
      className="pointer-events-none"
      style={{
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: 0,
        height: 0,
        zIndex: 20,
      }}
      data-testid="crosshair"
      data-crosshair-style={style}
    >
      {!plusOnly && !circle && (
        <div style={{ ...common, width: 3, height: 3, left: -1.5, top: -1.5 }} />
      )}
      {circle && (
        <div
          style={{
            position: "absolute",
            width: 22,
            height: 22,
            left: -11,
            top: -11,
            border: `2px solid ${liveColor}`,
            borderRadius: "50%",
            boxShadow: shadow,
          }}
        />
      )}
      {!dotOnly && !circle && (
        <>
          <div style={{ ...common, width: thickness, height: len, left: -thickness / 2, top: -(gap + len) }} />
          <div style={{ ...common, width: thickness, height: len, left: -thickness / 2, top: gap }} />
          <div style={{ ...common, width: len, height: thickness, left: -(gap + len), top: -thickness / 2 }} />
          <div style={{ ...common, width: len, height: thickness, left: gap, top: -thickness / 2 }} />
        </>
      )}
    </div>
  );
}

/* Damage-direction indicator layer.

   For each recent damage marker, render a red arc on the inside edge of the
   screen rotated to point toward the shooter. Markers without a known
   angle (shooter despawned / not in our state) render as a centered ring
   pulse so the player still gets some feedback.

   The arc is drawn with a wide partial border on a square element rotated
   into position. Opacity fades over the 1500ms marker lifetime. */
function DamageDirectionLayer({ markers, enabled, engineRef }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!markers || markers.length === 0) return;
    // Tick at 30 Hz so the fade is smooth and any live-tracked shooter's
    // arc follows them as they move. Stop once all markers are stale.
    const id = setInterval(() => {
      force((n) => (n + 1) & 1023);
    }, 33);
    return () => clearInterval(id);
  }, [markers]);
  if (!enabled || !markers || markers.length === 0) return null;
  const now = Date.now();
  // Live-resolve the current angle for a marker using the shooter's latest
  // known world position (so the arc follows them as they reposition).
  // Falls back to the snapshot angle captured when the shot landed.
  const resolveAngle = (m) => {
    const eng = engineRef?.current;
    if (!eng) return m.angle;
    // Prefer a live lookup by shooterId — server pushes positions every
    // tick, so entry.mesh.position stays current.
    let sx = null, sz = null;
    if (m.shooterId) {
      const entry = eng.players?.get?.(m.shooterId);
      if (entry?.mesh) { sx = entry.mesh.position.x; sz = entry.mesh.position.z; }
    }
    if (sx == null && m.from) { sx = m.from.x; sz = m.from.z; }
    if (sx == null) return m.angle;
    const dx = sx - eng.position.x;
    const dz = sz - eng.position.z;
    // Screen-space bearing of the shooter: atan2(dx, -dz) is world bearing
    // (0=+forward = -Z), and player facing bearing is -yaw, so:
    //   screen = world - facingBearing = atan2(dx, -dz) + yaw.
    let a = Math.atan2(dx, -dz) + (eng.yaw || 0);
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-testid="damage-direction-layer"
    >
      {markers.map((m, i) => {
        const age = now - m.ts;
        if (age > 1500) return null;
        const t = age / 1500;       // 0 -> 1 over lifetime
        const opacity = (1 - t) * 0.85;
        const scale = 0.92 + 0.12 * t; // grows slightly as it fades
        const liveAngle = resolveAngle(m);
        // If no angle known, render a centered ring pulse.
        if (liveAngle == null || !Number.isFinite(liveAngle)) {
          return (
            <div
              key={`${m.ts}-${i}`}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 220 * scale,
                height: 220 * scale,
                transform: "translate(-50%, -50%)",
                border: "6px solid #ff3a3a",
                borderRadius: "50%",
                opacity: opacity * 0.5,
                boxShadow: "0 0 28px rgba(255,58,58,0.45)",
              }}
              data-testid="damage-direction-omni"
            />
          );
        }
        // Convert angle (0=forward, π/2=right, π=behind, -π/2=left) to
        // CSS rotation. CSS rotation is clockwise from the top, which
        // matches our convention (0 = up = forward) directly.
        const deg = (liveAngle * 180) / Math.PI;
        // The arc element sits in the screen center and we rotate it; its
        // visual is a 70°-wide arc that lives near the top of a square.
        return (
          <div
            key={`${m.ts}-${i}`}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "min(560px, 60vmin)",
              height: "min(560px, 60vmin)",
              transform: `translate(-50%, -50%) rotate(${deg}deg) scale(${scale})`,
              transformOrigin: "center center",
              opacity,
              pointerEvents: "none",
            }}
            data-testid="damage-direction-arc"
            data-angle-deg={Math.round(deg)}
          >
            {/* The arc itself — a 70°-wide wedge of a circle, drawn with an
                SVG path so we can taper its ends. Sits at the top of the
                square (i.e. straight ahead of the player). */}
            <svg
              viewBox="0 0 100 100"
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid meet"
              style={{ display: "block" }}
            >
              <defs>
                <linearGradient id="dmgArcGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#ff3a3a" stopOpacity="0.05" />
                  <stop offset="50%" stopColor="#ff3a3a" stopOpacity="1" />
                  <stop offset="100%" stopColor="#ff3a3a" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              {/* Arc: center (50,50), radius 44, from -35deg to +35deg
                  measured from straight up. Using polar conversion:
                  x = 50 + 44 * sin(theta), y = 50 - 44 * cos(theta). */}
              <path
                d="M 24.76 14.74 A 44 44 0 0 1 75.24 14.74"
                fill="none"
                stroke="url(#dmgArcGrad)"
                strokeWidth="6"
                strokeLinecap="round"
                style={{ filter: "drop-shadow(0 0 6px rgba(255,58,58,0.6))" }}
              />
              {/* Smaller inner tick — a chevron pointing inward for clarity. */}
              <path
                d="M 45 6 L 50 1 L 55 6"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

const REPORT_REASONS = [
  { id: "cheating",       label: "Cheating / Aimbot" },
  { id: "harassment",     label: "Harassment / Toxic Chat" },
  { id: "offensive_name", label: "Offensive Username" },
  { id: "other",          label: "Other" },
];

/* Modal that lets a player file a moderation report against another
   in-match player. Submitted reports persist on the backend (deduped per
   reporter/target/reason within 1 hour). Modal closes after success and
   auto-dismisses any error within 4s. */
function ReportPlayerModal({ target, onClose }) {
  const [reason, setReason] = useState(REPORT_REASONS[0].id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {kind:'ok'|'err', text}

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const { data } = await api.post("/reports/player", {
        reported_username: target.username,
        reason,
        note: note.trim() || null,
      });
      setStatus({ kind: "ok", text: data?.deduped ? "Already on file — thanks." : "Report submitted. Thanks!" });
      setTimeout(onClose, 1400);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Couldn't file the report.";
      setStatus({ kind: "err", text: typeof msg === "string" ? msg : "Couldn't file the report." });
      setTimeout(() => setStatus(null), 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      style={{ pointerEvents: "auto" }}
      data-testid="report-player-modal"
    >
      <div className="card-pow p-0 w-full max-w-md">
        <div className="bg-[#E62429] text-white px-4 py-3 flex items-center justify-between">
          <div className="font-display text-2xl flex items-center gap-2">
            <Flag size={20} strokeWidth={3} /> REPORT PLAYER
          </div>
          <button
            onClick={onClose}
            className="btn-pow bg-black text-white [&]:px-2 [&]:py-1"
            data-testid="report-close-btn"
          >
            <X size={14} strokeWidth={3} />
          </button>
        </div>
        <div className="bg-white p-4 space-y-3">
          <div className="font-anton uppercase tracking-widest text-sm">
            Reporting: <span className="text-[#E62429]">{target.username}</span>
          </div>
          <div className="space-y-1.5">
            {REPORT_REASONS.map((r) => (
              <label
                key={r.id}
                className={`flex items-center gap-2 border-pow-thin px-3 py-2 cursor-pointer ${reason === r.id ? "bg-[#FFE680]" : "bg-neutral-50"}`}
                data-testid={`report-reason-${r.id}`}
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={r.id}
                  checked={reason === r.id}
                  onChange={() => setReason(r.id)}
                  className="accent-[#E62429]"
                />
                <span className="font-anton uppercase text-sm">{r.label}</span>
              </label>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="Optional note (max 500 chars)"
            className="w-full border-pow-thin bg-neutral-50 p-2 text-sm font-mono"
            rows={3}
            data-testid="report-note-input"
          />
          {status && (
            <div
              className={`flex items-center gap-2 px-3 py-2 border-pow-thin ${
                status.kind === "ok" ? "bg-[#E4F7EC] text-[#0a4f2a]" : "bg-[#FFE4E4] text-[#7a1115]"
              }`}
              data-testid="report-status"
            >
              {status.kind === "ok" ? <Check size={14} strokeWidth={3} /> : <Flag size={14} strokeWidth={3} />}
              <span className="font-anton uppercase tracking-widest text-xs">{status.text}</span>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 btn-pow bg-neutral-200 text-black"
              data-testid="report-cancel-btn"
            >
              CANCEL
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 btn-pow bg-[#E62429] text-white"
              data-testid="report-submit-btn"
            >
              {busy ? "SENDING…" : "SUBMIT"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



/* ──────────────────────────────────────────────────────────────────
   TDM-only HUD panels
   ────────────────────────────────────────────────────────────────── */

/* TDM Tab-scoreboard body — splits the player list into two team-coloured
   sections (RED / BLUE) with per-team totals at the top of each section.
   The local player's team rises to the top so they always see their squad
   first. Bot badges are suppressed in TDM (the team colour already
   communicates allegiance — a "BOT" tag on a friendly is just noise). */
function TdmScoreboardBody({ players, youId, myTeam, teamScores, target, onReport }) {
  const ts = teamScores || { red: 0, blue: 0 };
  // Stable per-team kill leaderboards.
  const sortRows = (team) =>
    players
      .filter((p) => p.team === team)
      .sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0));
  const redRows  = sortRows("red");
  const blueRows = sortRows("blue");
  // Section order: local player's team first.
  const sections = (myTeam === "blue")
    ? [
        { key: "blue", color: "#3aa1ff", label: "BLUE TEAM", rows: blueRows, score: ts.blue ?? 0 },
        { key: "red",  color: "#E62429", label: "RED TEAM",  rows: redRows,  score: ts.red  ?? 0 },
      ]
    : [
        { key: "red",  color: "#E62429", label: "RED TEAM",  rows: redRows,  score: ts.red  ?? 0 },
        { key: "blue", color: "#3aa1ff", label: "BLUE TEAM", rows: blueRows, score: ts.blue ?? 0 },
      ];
  return (
    <div data-testid="scoreboard-tdm">
      {/* Top banner: side-by-side team scores so the player can read the
          match state at a glance even before scrolling rows. */}
      <div className="grid grid-cols-2 bg-black text-white border-t-4 border-black">
        <div className="px-4 py-3 flex items-center justify-between border-r-2 border-black"
             style={{ background: "rgba(230,36,41,0.18)" }}>
          <span className="font-anton uppercase tracking-widest text-sm" style={{ color: "#E62429" }}>RED</span>
          <span className="font-display text-3xl tabular-nums" data-testid="scoreboard-tdm-red-score">{ts.red ?? 0}</span>
        </div>
        <div className="px-4 py-3 flex items-center justify-between"
             style={{ background: "rgba(58,161,255,0.18)" }}>
          <span className="font-display text-3xl tabular-nums" data-testid="scoreboard-tdm-blue-score">{ts.blue ?? 0}</span>
          <span className="font-anton uppercase tracking-widest text-sm" style={{ color: "#3aa1ff" }}>BLUE</span>
        </div>
      </div>
      <div className="bg-black text-white px-4 py-1 text-center font-anton uppercase tracking-widest text-[10px] opacity-80 border-t-2 border-black">
        First to {target} kills wins
      </div>
      {sections.map((sec) => (
        <div key={sec.key} data-testid={`scoreboard-tdm-section-${sec.key}`}>
          {/* Section header with team colour bar */}
          <div className="px-4 py-2 flex items-center justify-between border-t-4 border-black"
               style={{ background: sec.color, color: "#0A0A0A" }}>
            <span className="font-anton uppercase tracking-widest text-sm">
              {sec.label}{sec.key === myTeam ? " · YOUR SQUAD" : ""}
            </span>
            <span className="font-display text-2xl tabular-nums">{sec.score}</span>
          </div>
          {/* Column headers */}
          <div className="grid grid-cols-12 bg-[#FFD700] px-4 py-1.5 font-anton uppercase tracking-widest text-xs border-t-2 border-black">
            <div className="col-span-1">#</div>
            <div className="col-span-1"></div>
            <div className="col-span-4">Player</div>
            <div className="col-span-2 text-right">Kills</div>
            <div className="col-span-2 text-right">Deaths</div>
            <div className="col-span-2 text-right opacity-60">·</div>
          </div>
          {sec.rows.length === 0 ? (
            <div className="p-4 font-anton text-center uppercase text-sm bg-white border-t-2 border-black">
              No players on this team
            </div>
          ) : sec.rows.map((p, i) => (
            <div
              key={p.id}
              className={`grid grid-cols-12 px-4 py-2 border-t-2 border-black items-center ${
                p.id === youId ? "bg-[#FFE680]" : i % 2 === 0 ? "bg-white" : "bg-[#F4F4F5]"
              }`}
              data-testid={`scoreboard-tdm-row-${sec.key}-${i}`}
            >
              <div className="col-span-1 font-display text-lg">{i + 1}</div>
              <div className="col-span-1">
                {/* In TDM, suppress the BOT badge — team colour already
                    communicates the only thing that matters (friend/foe). */}
                {!p.is_bot && <PlatformIcon platform={p.platform} />}
              </div>
              <div className="col-span-4 font-anton uppercase truncate">{p.username}{p.id === youId ? " · YOU" : ""}</div>
              <div className="col-span-2 text-right font-anton text-lg">{p.kills}</div>
              <div className="col-span-2 text-right font-anton text-lg">{p.deaths}</div>
              <div className="col-span-2 flex justify-end">
                {p.id !== youId && !p.is_bot && (
                  <button
                    onClick={() => onReport?.(p)}
                    className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1 [&]:text-[10px] flex items-center gap-1"
                    data-testid={`scoreboard-tdm-report-${sec.key}-${i}`}
                    title={`Report ${p.username}`}
                  >
                    <Flag size={11} strokeWidth={3} /> REPORT
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* Polished team-kill scoreboard.
   Two team-coloured columns sandwiching a central "TO 30" target tag.
   The local player's team gets a gold underline so they always know
   which side to track. Whichever team is ahead gets a subtle pulse to
   sell momentum. */
function TdmTeamScoreboard({ red, blue, target, myTeam }) {
  const redAhead  = red > blue;
  const blueAhead = blue > red;
  const Col = ({ team, value, color, mine, ahead }) => (
    <div
      className="flex flex-col items-center px-3 py-1 border-2 border-black"
      style={{
        background: ahead ? color : "rgba(10,10,10,0.85)",
        color: ahead ? "#fff" : color,
        boxShadow: mine ? "inset 0 -3px 0 0 #FFD700" : undefined,
        minWidth: 56,
      }}
      data-testid={`hud-tdm-${team}-col`}
    >
      <span className="font-anton uppercase tracking-widest text-[10px] opacity-80 leading-none">{team}</span>
      <span className="font-display text-3xl leading-none tabular-nums" data-testid={`hud-tdm-${team}`}>{value}</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5" data-testid="hud-tdm-score">
      <Col team="red"  value={red}  color="#E62429" mine={myTeam === "red"}  ahead={redAhead} />
      <div className="font-anton uppercase tracking-widest text-[10px] text-white/80 bg-black/60 border-2 border-black px-2 py-1">
        FIRST TO<br />
        <span className="font-display text-base text-[#FFD700] leading-none">{target}</span>
      </div>
      <Col team="blue" value={blue} color="#3aa1ff" mine={myTeam === "blue"} ahead={blueAhead} />
    </div>
  );
}

/* Top-down minimap for TDM matches.
   Renders the arena outline (size + obstacle footprints), the local
   player as a yellow facing-direction arrow, teammates as blue dots
   (chevron + outline so they pop), enemies as red dots. The SVG is
   transformed so world (0,0) sits at the centre of the panel and the
   ±size/2 extents fit the viewBox. */
const MAP_PX = 160;       // panel size on screen
function TdmMinimap({ data }) {
  if (!data) return null;
  const half = (data.size || 50) / 2;
  // Convert world (x,z) to SVG-space (cx,cy). World +z is "north" on the
  // ground plane in three.js (away from the camera at yaw=0). Render +z
  // as DOWN on the map (typical convention) so spinning the camera the
  // same direction also rotates the minimap-correct way.
  const toSvg = (x, z) => [
    ((x + half) / data.size) * MAP_PX,
    ((z + half) / data.size) * MAP_PX,
  ];
  // Local-player arrow vertices in svg space (rotate by -yaw so +yaw=look right == arrow points right).
  const [px, py] = toSvg(data.you.x, data.you.z);
  // Three.js yaw 0 looks down -Z (UP on map). Convert to SVG rotation:
  // svgRotate° = -yaw_rad in degrees - 90 (so arrow points up at yaw=0).
  const arrowDeg = (-data.you.yaw * 180 / Math.PI);
  return (
    <div
      className="card-pow bg-black/70 p-1.5 border-2 border-black"
      style={{ width: MAP_PX + 12, boxShadow: "3px 3px 0 0 #000" }}
    >
      <div className="font-anton uppercase tracking-widest text-[9px] text-[#FFD700] text-center leading-none pb-1">
        TDM RADAR
      </div>
      <svg
        width={MAP_PX} height={MAP_PX}
        viewBox={`0 0 ${MAP_PX} ${MAP_PX}`}
        style={{ background: "rgba(20,18,30,0.92)", display: "block" }}
        data-testid="hud-tdm-minimap-svg"
      >
        {/* Arena floor border. */}
        <rect x="0.5" y="0.5" width={MAP_PX - 1} height={MAP_PX - 1} fill="none" stroke="#444" strokeWidth="1" />
        {/* Obstacles — faded grey rectangles. */}
        {data.obstacles.map((o, i) => {
          const w = (o.w / data.size) * MAP_PX;
          const d = (o.d / data.size) * MAP_PX;
          const [cx, cy] = toSvg(o.x - o.w / 2, o.z - o.d / 2);
          return <rect key={i} x={cx} y={cy} width={w} height={d} fill="#6b6678" opacity="0.55" />;
        })}
        {/* Other players. Teammates blue + chevron, enemies red. */}
        {data.others.map((p) => {
          const [cx, cy] = toSvg(p.x, p.z);
          const isTeam = data.you.team && p.team === data.you.team;
          const color = isTeam ? "#3aa1ff" : "#E62429";
          return (
            <g key={p.id} data-testid={`minimap-dot-${isTeam ? "team" : "enemy"}`}>
              <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="#000" strokeWidth="1" />
              {isTeam && (
                <polygon points={`${cx},${cy - 6} ${cx - 3},${cy - 2} ${cx + 3},${cy - 2}`} fill="#3aa1ff" stroke="#000" strokeWidth="0.8" />
              )}
            </g>
          );
        })}
        {/* Local-player facing-direction arrow — gold so it pops. */}
        <g transform={`translate(${px}, ${py}) rotate(${arrowDeg})`} data-testid="minimap-self">
          <polygon points="0,-7 -5,5 0,2 5,5" fill="#FFD700" stroke="#000" strokeWidth="1" />
        </g>
      </svg>
    </div>
  );
}

