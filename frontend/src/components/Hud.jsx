import { useEffect, useState } from "react";
import { Heart, Trophy, LogOut, Play, Activity, Wifi, Bot, Timer, Crosshair, Zap, Swords, Star, Smartphone, Monitor, Gamepad2 } from "lucide-react";
import { rankIconFor } from "@/game/rankIcons";
import PlayerCard from "@/components/PlayerCard";
import settingsStore from "@/game/settings";

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

export default function Hud({ hud, username, pointerLocked, onStart, onExit }) {
  const [showDmg, setShowDmg] = useState(false);
  const [showHit, setShowHit] = useState(false);
  const [gfx, setGfx] = useState(() => settingsStore.get());

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

  const fpsColor = hud.fps >= 50 ? "#34C759" : hud.fps >= 30 ? "#FFD700" : "#E62429";
  const pingColor = hud.ping > 0 && hud.ping <= 80 ? "#34C759" : hud.ping <= 200 ? "#FFD700" : "#E62429";

  const hudScale = Math.max(0.6, Math.min(1.4, gfx.hudScale ?? 1.0));
  const showFlash = gfx.showDamageFlash !== false;
  const showKf = gfx.showKillFeed !== false;
  const xhairStyle = gfx.crosshairStyle || "cross";
  const xhairColor = gfx.crosshairColor || "#FFD700";

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

      {/* Damage vignette */}
      {showDmg && showFlash && <div className="dmg-vignette" />}

      {/* Damage-direction indicators — red arcs around the screen edge
          pointing toward whoever shot you. Each marker fades over 1.5s. */}
      <DamageDirectionLayer markers={hud.damageMarkers || []} enabled={showFlash} />

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

      {/* Top-left: FPS / Ping / Username */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2" data-testid="hud-top-left">
        <div className="flex gap-2">
          <div className="hud-panel !py-1 !px-3" data-testid="hud-fps" title="Frames per second">
            <div className="flex items-center gap-2 text-sm">
              <Activity size={14} strokeWidth={3} style={{ color: fpsColor }} />
              <span className="opacity-70">FPS</span>
              <span className="font-anton" style={{ color: fpsColor }}>{hud.fps}</span>
            </div>
          </div>
          <div className="hud-panel !py-1 !px-3" data-testid="hud-ping" title="Round-trip time to server">
            <div className="flex items-center gap-2 text-sm">
              <Wifi size={14} strokeWidth={3} style={{ color: pingColor }} />
              <span className="opacity-70">PING</span>
              <span className="font-anton" style={{ color: pingColor }}>{hud.ping}</span>
              <span className="opacity-60 text-xs">ms</span>
            </div>
          </div>
        </div>
        <div className="hud-panel">
          <div className="text-[#FFD700]">{username}</div>
        </div>
        <div className="hud-panel" style={{ background: hud.connected ? "rgba(10,10,10,0.82)" : "rgba(230,36,41,0.92)" }}>
          <div>{hud.connected ? "ONLINE" : "DISCONNECTED"}</div>
        </div>
      </div>

      {/* Top-center: match timer */}
      {(hud.inQueue || hud.timeLeft != null) && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20" data-testid="hud-match-timer">
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
                <span className="text-xs opacity-80">{hud.isRanked ? "RANKED" : "QUICK"}</span>
                <span className="font-display text-3xl" data-testid="hud-time-left">{formatTime(hud.timeLeft)}</span>
              </div>
            </div>
          )}
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

      {/* Bottom-left: HP */}
      <div className="absolute bottom-6 left-6 z-20" data-testid="hud-health">
        <div className="hud-panel" style={{ background: hud.invuln ? "rgba(0,85,255,0.9)" : "rgba(10,10,10,0.85)" }}>
          <div className="flex items-center gap-3">
            <Heart size={22} strokeWidth={3} className="text-[#E62429]" />
            <div className="font-display text-4xl">{hud.hp}</div>
            <div className="text-xs opacity-80">HP{hud.invuln ? " · SHIELDED" : ""}</div>
          </div>
          <div className="mt-2 w-56 h-3 border-2 border-white">
            <div
              className="h-full"
              style={{
                width: `${Math.max(0, Math.min(100, hud.hp))}%`,
                background: hud.hp > 50 ? "#34C759" : hud.hp > 25 ? "#FFD700" : "#E62429",
                transition: "width 0.15s linear",
              }}
            />
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
                <div className="font-anton uppercase text-[10px] tracking-widest text-[#E62429] mt-1">PRESS R · RELOAD</div>
              )}
            </div>
          )
        )}

        <div className="hud-panel" style={{ background: hud.weapon === "secondary" ? "rgba(155,89,182,0.92)" : hud.weapon === "tertiary" ? "rgba(0,207,255,0.92)" : "rgba(255,215,0,0.92)", color: "#0A0A0A" }} data-testid="hud-weapon">
          <div className="text-xs">{hud.weapon === "secondary" ? "[2/V] KATANA" : hud.weapon === "tertiary" ? "[3] LASER" : "[1] AK-47"}</div>
        </div>
        <div className="hud-panel" style={{ background: "rgba(10,10,10,0.7)" }}>
          <div className="text-xs">TAB · SCOREBOARD · R · RELOAD</div>
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

      {/* Match end overlay */}
      {hud.matchEnd && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-6" data-testid="match-end-overlay">
          <div className="card-pow p-0 w-full max-w-2xl">
            <div className="bg-[#0055FF] text-white px-6 py-4 flex items-center justify-between">
              <div className="font-display text-4xl text-[#FFD700]">MATCH OVER</div>
              <div className="font-anton uppercase text-sm tracking-widest">
                {hud.isRanked ? "Returning to lobby..." : "Next match in 10s"}
              </div>
            </div>
            <div className="grid grid-cols-12 bg-[#FFD700] px-4 py-2 font-anton uppercase tracking-widest text-sm border-t-4 border-black">
              <div className="col-span-1">#</div>
              <div className="col-span-5">Player</div>
              <div className="col-span-2 text-right">Kills</div>
              <div className="col-span-2 text-right">Δ RP</div>
              <div className="col-span-2 text-right">Rank</div>
            </div>
            {(hud.matchEnd.placements || []).map((p, i) => {
              const c = RANK_COLORS[Math.max(0, Math.min(7, p.rank_tier ?? 0))];
              return (
                <div key={p.id} className={`grid grid-cols-12 px-4 py-2 border-t-2 border-black items-center ${i === 0 ? "bg-[#FFE680]" : "bg-white"}`} data-testid={`match-end-row-${i}`}>
                  <div className="col-span-1 font-display text-xl">{i + 1}</div>
                  <div className="col-span-5 font-anton uppercase flex items-center gap-2">
                    <span>{p.username}</span>
                    {p.is_placement && (
                      <span
                        className="inline-flex items-center gap-1 bg-[#9B59B6] text-white border-pow-thin px-1.5 text-[10px] font-anton uppercase"
                        title={`Placement match ${p.placement_match_number}/${p.placement_matches_total} — 2x RP, no loss`}
                        data-testid={`placement-badge-${i}`}
                      >
                        <Star size={10} strokeWidth={3} /> P{p.placement_match_number}/{p.placement_matches_total}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 text-right font-anton text-lg">{p.kills}</div>
                  <div className={`col-span-2 text-right font-display text-2xl ${p.delta >= 0 ? "text-[#06A35F]" : "text-[#E62429]"}`} data-testid={`match-end-delta-${i}`}>
                    {p.delta >= 0 ? "+" : ""}{p.delta}
                    {p.is_placement && p.delta > 0 && (
                      <span className="ml-1 text-xs font-anton text-[#9B59B6]">2x</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="inline-flex items-center gap-1 font-anton uppercase text-sm px-2 py-1" style={{ background: c, color: p.rank_tier === 7 ? "#FFD700" : "#0A0A0A" }}>
                      {(() => { const RI = rankIconFor(p.rank_tier ?? 0); return <RI size={12} strokeWidth={3} />; })()}
                      {p.rank_name}
                    </span>
                  </div>
                </div>
              );
            })}
            {(!hud.matchEnd.placements || hud.matchEnd.placements.length === 0) && (
              <div className="p-6 font-anton text-center uppercase">No ranked players this match</div>
            )}
          </div>
        </div>
      )}

      {/* Click-to-play overlay removed — clicking the canvas now requests
          pointer lock directly. (See Game.jsx canvas onClick wiring.) A small
          EXIT button stays in the top-left so users can leave before locking. */}
      {!pointerLocked && (
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
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" data-testid="scoreboard-overlay">
          <div className="card-pow p-0 w-full max-w-3xl">
            <div className="bg-black text-white px-6 py-3 flex items-center justify-between">
              <div className="font-display text-3xl text-[#FFD700]">SCOREBOARD</div>
              <div className="font-anton uppercase text-sm tracking-widest">Free-For-All</div>
            </div>
            <div className="grid grid-cols-12 bg-[#FFD700] px-4 py-2 font-anton uppercase tracking-widest text-sm border-t-4 border-black">
              <div className="col-span-1">#</div>
              <div className="col-span-1"></div>
              <div className="col-span-6">Player</div>
              <div className="col-span-2 text-right">Kills</div>
              <div className="col-span-2 text-right">Deaths</div>
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
                <div className="col-span-6 font-anton uppercase">{p.username}{p.id === hud.youId ? " · YOU" : ""}</div>
                <div className="col-span-2 text-right font-anton text-lg">{p.kills}</div>
                <div className="col-span-2 text-right font-anton text-lg">{p.deaths}</div>
              </div>
            ))}
            {hud.players.length === 0 && (
              <div className="p-6 font-anton text-center uppercase">No players yet</div>
            )}
          </div>
        </div>
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
function DamageDirectionLayer({ markers, enabled }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!markers || markers.length === 0) return;
    // Tick at 30 Hz so the fade is smooth. Stop once all markers are stale.
    const id = setInterval(() => {
      force((n) => (n + 1) & 1023);
    }, 33);
    return () => clearInterval(id);
  }, [markers]);
  if (!enabled || !markers || markers.length === 0) return null;
  const now = Date.now();
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
        // If no angle known, render a centered ring pulse.
        if (m.angle == null || !Number.isFinite(m.angle)) {
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
        const deg = (m.angle * 180) / Math.PI;
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

