import { useEffect, useState } from "react";
import { Heart, Trophy, LogOut, Play, Activity, Wifi, Bot, User, Timer, Crosshair, Zap, Swords, Star } from "lucide-react";

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

  return (
    <>
      {/* Crosshair — Overwatch-style: 4 ticks that grow with current spread */}
      {pointerLocked && hud.alive && (
        <DynamicCrosshair spread={hud.spread || 0} showHit={showHit} headshot={!!hud.hitHeadshot} />
      )}

      {/* Damage vignette */}
      {showDmg && <div className="dmg-vignette" />}

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

      {/* Top-center: match timer (ranked only) */}
      {hud.isRanked && (hud.inQueue || hud.timeLeft != null) && (
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
            <div className="hud-panel" style={{ background: hud.timeLeft < 30 ? "rgba(230,36,41,0.95)" : "rgba(0,85,255,0.92)" }}>
              <div className="flex items-center gap-3">
                <Timer size={20} strokeWidth={3} />
                <span className="text-xs opacity-80">RANKED</span>
                <span className="font-display text-3xl" data-testid="hud-time-left">{formatTime(hud.timeLeft)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top-right: kill feed */}
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

        {/* Ammo + reload (only for ranged weapons; hidden for katana) */}
        {hud.weapon !== "secondary" && hud.ammo != null && (
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
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60" data-testid="death-overlay">
          <div className="text-center">
            <div className="font-display text-8xl text-[#E62429] text-pow-shadow-lg">YOU'RE DOWN!</div>
            <div className="font-anton uppercase tracking-widest text-white mt-3">Respawning...</div>
          </div>
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
                    <span className="font-anton uppercase text-sm px-2 py-1" style={{ background: c, color: p.rank_tier === 7 ? "#FFD700" : "#0A0A0A" }}>
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

      {/* Click-to-play overlay */}
      {!pointerLocked && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" data-testid="game-start-overlay">
          <div className="relative">
            <div className="absolute -top-6 -left-6 bg-[#FFD700] border-pow shadow-pow-sm px-4 py-1 -rotate-6 z-10">
              <span className="font-display text-2xl uppercase">VIRTUE</span>
            </div>
            <div className="card-pow p-8 max-w-lg w-full">
              <div className="inline-block bg-[#E62429] text-white border-pow shadow-pow-sm px-3 py-1 -rotate-2 mb-4">
                <span className="font-anton uppercase tracking-widest">{hud.isRanked ? "Ranked · FFA" : "Arena · FFA"}</span>
              </div>
              <h2 className="font-display text-5xl uppercase text-[#E62429] text-pow-shadow">
                {hud.connected ? "READY!" : "CONNECTING..."}
              </h2>
              <p className="font-body mt-2 text-black">
                Click PLAY to lock your cursor and enter the arena. You'll spawn with a 3-second shield. Press <span className="font-anton">ESC</span> to release the cursor.
              </p>
              <ul className="font-body text-sm mt-3 text-neutral-700 space-y-1">
                <li><span className="font-anton">WASD</span> — Move</li>
                <li><span className="font-anton">MOUSE</span> — Aim · <span className="font-anton">CLICK</span> — Shoot/Slash</li>
                <li><span className="font-anton">1</span> AK-47 · <span className="font-anton">2/V</span> Katana · <span className="font-anton">3</span> Laser</li>
                <li><span className="font-anton">RIGHT-CLICK</span> — Aim Down Sights</li>
                <li><span className="font-anton">SHIFT</span> — Sprint · <span className="font-anton">TAB</span> — Scoreboard</li>
              </ul>
              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={onStart} className="btn-pow bg-[#E62429] text-white text-2xl" data-testid="game-start-button">
                  <span className="flex items-center gap-2"><Play size={20} strokeWidth={3} /> PLAY</span>
                </button>
                <button onClick={onExit} className="btn-pow bg-white text-black" data-testid="game-exit-button">
                  <span className="flex items-center gap-2"><LogOut size={18} strokeWidth={3} /> EXIT</span>
                </button>
              </div>
            </div>
          </div>
        </div>
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
                    <span className="inline-flex items-center gap-1 bg-[#0055FF] text-white border-pow-thin px-2 text-xs font-anton uppercase">
                      <User size={12} strokeWidth={3} /> P
                    </span>
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
    </>
  );
}

// Overwatch-style dynamic crosshair: 4 ticks that spread outward as the
// shooter's accumulated recoil (spread) grows. Server reports `spread` in
// radians; we map it linearly to a pixel gap. Heads-up: hit confirmation
// briefly recolors the ticks (gold on body, red on headshot).
function DynamicCrosshair({ spread, showHit, headshot }) {
  // 0 rad → 4px gap, 0.16 rad (max) → 22px gap
  const gap = 4 + Math.min(22, Math.round((spread / 0.16) * 18));
  const len = 8;
  const thickness = 2;
  const color = showHit ? (headshot ? "#FFD700" : "#FFFFFF") : "#FFFFFF";
  const shadow = "0 0 0 1px #000";
  const common = { position: "absolute", background: color, boxShadow: shadow, pointerEvents: "none" };
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
    >
      {/* center dot */}
      <div style={{ ...common, width: 3, height: 3, left: -1.5, top: -1.5 }} />
      {/* top */}
      <div style={{ ...common, width: thickness, height: len, left: -thickness / 2, top: -(gap + len) }} />
      {/* bottom */}
      <div style={{ ...common, width: thickness, height: len, left: -thickness / 2, top: gap }} />
      {/* left */}
      <div style={{ ...common, width: len, height: thickness, left: -(gap + len), top: -thickness / 2 }} />
      {/* right */}
      <div style={{ ...common, width: len, height: thickness, left: gap, top: -thickness / 2 }} />
    </div>
  );
}
