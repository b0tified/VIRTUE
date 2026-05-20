import { useEffect, useState } from "react";
import { Heart, Crosshair, Skull, Trophy, LogOut, Play } from "lucide-react";

export default function Hud({ hud, username, pointerLocked, onStart, onExit }) {
  const [showDmg, setShowDmg] = useState(false);
  useEffect(() => {
    if (!hud.damaged) return;
    setShowDmg(true);
    const t = setTimeout(() => setShowDmg(false), 450);
    return () => clearTimeout(t);
  }, [hud.damaged]);

  const you = hud.players.find((p) => p.id === hud.youId);
  const kills = you?.kills ?? 0;
  const deaths = you?.deaths ?? 0;

  return (
    <>
      {/* Crosshair */}
      {pointerLocked && hud.alive && <div className="crosshair" />}

      {/* Damage vignette */}
      {showDmg && <div className="dmg-vignette" />}

      {/* Top-left: connection / username */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2" data-testid="hud-top-left">
        <div className="hud-panel">
          <div className="text-[#FFD700]">{username}</div>
        </div>
        <div className="hud-panel" style={{ background: hud.connected ? "rgba(10,10,10,0.82)" : "rgba(230,36,41,0.92)" }}>
          <div>{hud.connected ? "ONLINE" : "DISCONNECTED"}</div>
        </div>
      </div>

      {/* Top-right: kill feed */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 items-end" data-testid="hud-kill-feed">
        {hud.killFeed.slice(0, 6).map((k) => (
          <div key={k.id} className="hud-panel kf-row" style={{ background: "rgba(10,10,10,0.85)" }}>
            <div>
              <span className="text-[#FFD700]">{k.shooter}</span>{" "}
              <Skull size={14} strokeWidth={3} className="inline -mt-1" />{" "}
              <span className="text-[#E62429]">{k.victim}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom-left: HP */}
      <div className="absolute bottom-6 left-6 z-20" data-testid="hud-health">
        <div className="hud-panel" style={{ background: "rgba(10,10,10,0.85)" }}>
          <div className="flex items-center gap-3">
            <Heart size={22} strokeWidth={3} className="text-[#E62429]" />
            <div className="font-display text-4xl">{hud.hp}</div>
            <div className="text-xs opacity-70">HP</div>
          </div>
          <div className="mt-2 w-56 h-3 border-2 border-white" style={{ transform: "skewX(0deg)" }}>
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

      {/* Bottom-right: Score */}
      <div className="absolute bottom-6 right-6 z-20 flex flex-col items-end gap-2" data-testid="hud-score">
        <div className="hud-panel">
          <div className="flex items-center gap-3">
            <Trophy size={20} strokeWidth={3} className="text-[#FFD700]" />
            <span className="text-[#FFD700] font-display text-3xl">{kills}</span>
            <span className="opacity-60">/</span>
            <span className="text-[#E62429] font-display text-3xl">{deaths}</span>
          </div>
        </div>
        <div className="hud-panel" style={{ background: "rgba(10,10,10,0.7)" }}>
          <div className="text-xs">TAB · SCOREBOARD</div>
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

      {/* Click-to-play overlay */}
      {!pointerLocked && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" data-testid="game-start-overlay">
          <div className="card-pow p-8 max-w-lg w-full">
            <div className="inline-block bg-[#FFD700] border-pow shadow-pow-sm px-3 py-1 -rotate-2 mb-4">
              <span className="font-anton uppercase tracking-widest">Arena</span>
            </div>
            <h2 className="font-display text-5xl uppercase text-[#E62429] text-pow-shadow">
              {hud.connected ? "READY!" : "CONNECTING..."}
            </h2>
            <p className="font-body mt-2 text-black">
              Click PLAY to lock your cursor and enter the arena. Press <span className="font-anton">ESC</span> to release.
            </p>
            <ul className="font-body text-sm mt-3 text-neutral-700 space-y-1">
              <li><span className="font-anton">WASD</span> — Move</li>
              <li><span className="font-anton">MOUSE</span> — Aim · <span className="font-anton">CLICK</span> — Shoot</li>
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
      )}

      {/* Scoreboard (Tab) */}
      {hud.showScoreboard && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6" data-testid="scoreboard-overlay">
          <div className="card-pow p-0 w-full max-w-2xl">
            <div className="bg-black text-white px-6 py-3 flex items-center justify-between">
              <div className="font-display text-3xl text-[#FFD700]">SCOREBOARD</div>
              <div className="font-anton uppercase text-sm tracking-widest">Free-For-All</div>
            </div>
            <div className="grid grid-cols-12 bg-[#FFD700] px-4 py-2 font-anton uppercase tracking-widest text-sm border-t-4 border-black">
              <div className="col-span-1">#</div>
              <div className="col-span-7">Player</div>
              <div className="col-span-2 text-right">Kills</div>
              <div className="col-span-2 text-right">Deaths</div>
            </div>
            {hud.players.map((p, i) => (
              <div
                key={p.id}
                className={`grid grid-cols-12 px-4 py-2 border-t-2 border-black ${p.id === hud.youId ? "bg-[#FFE680]" : "bg-white"}`}
              >
                <div className="col-span-1 font-display text-xl">{i + 1}</div>
                <div className="col-span-7 font-anton uppercase">{p.username}</div>
                <div className="col-span-2 text-right font-anton">{p.kills}</div>
                <div className="col-span-2 text-right font-anton">{p.deaths}</div>
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
