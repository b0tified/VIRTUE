import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { GameEngine } from "@/game/engine";
import { GameSocket } from "@/game/network";
import { LocalSim } from "@/game/localSim";
import audioBus from "@/game/audio";
import settingsStore from "@/game/settings";
import Hud from "@/components/Hud";
import TouchControls from "@/components/TouchControls";
import Chat from "@/components/Chat";
import SettingsModal from "@/components/SettingsModal";
import FriendsModal from "@/components/FriendsModal";
import { Menu, Settings as SettingsIcon, UserPlus, LogOut, Play } from "lucide-react";

export default function Game() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const sockRef = useRef(null);
  const { user, accessToken } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { username: spectateTarget } = useParams();
  const rawMode = spectateTarget ? "spectate" : searchParams.get("mode");
  const partyId = searchParams.get("party_id") || null;
  const mode = spectateTarget
    ? "spectate"
    : rawMode === "ranked"
    ? "ranked"
    : rawMode === "practice"
    ? "practice"
    : rawMode === "offline"
    ? "offline"
    : rawMode === "party" && partyId
    ? "party"
    : "casual";
  const isSpectator = mode === "spectate";

  const [hud, setHud] = useState({
    hp: 100,
    alive: true,
    youId: null,
    players: [],
    killFeed: [],
    showScoreboard: false,
    damaged: 0,
    damageMarkers: [],
    hitConfirm: 0,
    connected: false,
    fps: 0,
    ping: 0,
    invuln: false,
    isRanked: mode === "ranked",
    timeLeft: null,
    matchEnd: null,
    inQueue: false,
    realCount: 0,
    minRealPlayers: 2,
    weapon: "primary",
  });
  const [pointerLocked, setPointerLocked] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [showPause, setShowPause] = useState(false);
  const [showGameSettings, setShowGameSettings] = useState(false);
  const [showGameFriends, setShowGameFriends] = useState(false);
  const pingRef = useRef({ lastSent: 0, value: 0 });

  // Setup engine + socket
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas, {
      onState: (msg) => {
        // Build kill feed
        const newKills = (msg.events || []).filter((e) => e.type === "kill");
        setHud((h) => {
          let kf = h.killFeed;
          if (newKills.length) {
            kf = [
              ...newKills.map((k) => ({
                id: Math.random().toString(36).slice(2),
                shooter: k.shooter_name,
                victim: k.victim_name,
                weapon: k.weapon || (k.melee ? "katana" : "ak47"),
                ts: Date.now(),
              })),
              ...h.killFeed,
            ].slice(0, 6);
          }
          // Sort players by kills desc
          const players = [...msg.players].sort((a, b) => b.kills - a.kills);
          const you = players.find((p) => p.id === engineRef.current?.youId);
          return {
            ...h,
            youId: engineRef.current?.youId,
            players,
            killFeed: kf,
            hp: you ? you.hp : h.hp,
            alive: you ? you.alive : h.alive,
            invuln: you ? !!you.invuln : false,
            // Clear killer card when you respawn alive again.
            lastKiller: you && you.alive ? null : h.lastKiller,
            ammo: you?.ammo ?? h.ammo,
            magSize: you?.mag_size ?? h.magSize,
            reloading: you?.reloading ?? false,
            reloadProgress: you?.reload_progress ?? 1,
            spread: you?.spread ?? 0,
            // Mirror laser heat + overheat state so the HUD can swap the
            // ammo block for a heat bar while the laser is equipped.
            laserHeat: you?.laser_heat ?? 0,
            laserOverheated: !!you?.laser_overheated,
            laserFiring: !!you?.laser_firing,
          };
        });
      },
      onLocalUpdate: (ev) => {
        if (ev.type === "damaged") {
          // Build a damage-indicator marker so the HUD can show an arc pointing
          // toward the shooter. We also compute the angle relative to the
          // player's current facing here so the engine snapshot used in the
          // HUD doesn't have to know world coords.
          let angleRad = null;
          if (ev.from) {
            const you = engineRef.current;
            if (you) {
              const dx = ev.from.x - you.position.x;
              const dz = ev.from.z - you.position.z;
              // World yaw=0 points along -Z (see engine input math). Compute
              // angle in world XY plane → atan2(dx, -dz). Subtracting the
              // player's yaw rotates it into HUD/screen space (0 = forward,
              // π/2 = right, ±π = behind).
              const worldAngle = Math.atan2(dx, -dz);
              angleRad = worldAngle - (ev.yaw ?? 0);
              // Normalize to [-π, π]
              while (angleRad > Math.PI) angleRad -= 2 * Math.PI;
              while (angleRad < -Math.PI) angleRad += 2 * Math.PI;
            }
          }
          setHud((h) => ({
            ...h,
            damaged: Date.now(),
            damageMarkers: [
              ...(h.damageMarkers || []).filter((m) => Date.now() - m.ts < 1500),
              { ts: Date.now(), angle: angleRad },
            ].slice(-5),
          }));
          audioBus.hurt();
        } else if (ev.type === "remote-shot") {
          audioBus.gunshot(ev.shooterId, ev.distance, ev.weapon || "ak47");
        } else if (ev.type === "you-hit") {
          audioBus.hitmark(!!ev.headshot);
          setHud((h) => ({ ...h, hitConfirm: Date.now(), hitHeadshot: !!ev.headshot }));
        } else if (ev.type === "you-killed") {
          audioBus.killSfx(!!ev.headshot);
          setHud((h) => ({ ...h, hitConfirm: Date.now(), hitHeadshot: !!ev.headshot }));
        } else if (ev.type === "footstep") {
          audioBus.footstep(ev.sprint);
        } else if (ev.type === "killed-by") {
          // Show the killer's PlayerCard on the death overlay.
          setHud((h) => ({ ...h, lastKiller: ev.killer }));
        } else if (ev.type === "reload-pressed") {
          const w = engineRef.current?.currentWeapon === "tertiary" ? "laser" : "ak47";
          sockRef.current?.send({ type: "reload", weapon: w });
        } else if (ev.type === "laser-beam-start") {
          audioBus.laserBeamStart();
        } else if (ev.type === "laser-beam-stop") {
          audioBus.laserBeamStop();
        } else if (ev.type === "laser-overheat") {
          audioBus.laserOverheat();
          setHud((h) => ({ ...h, laserOverheat: Date.now() }));
        } else if (ev.type === "reload-start") {
          audioBus.reload(ev.weapon || "ak47");
        }
      },
    });
    engineRef.current = engine;

    // Apply persisted graphics + FPS-cap settings and keep them live.
    engine.applySettings(settingsStore.get());
    const unsubSettings = settingsStore.subscribe((s) => engine.applySettings(s));
    engine.onShoot = () => {
      const w = engine.currentWeapon === "tertiary" ? "laser" : "ak47";
      audioBus.gunshot(engine.youId, 0, w);
    };
    engine.start();

    const offlineCapable = mode === "offline" || mode === "practice";
    const sockHandlers = {
      onOpen: () => {
        setHud((h) => ({ ...h, connected: true }));
        try {
          const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
          const hasController = (navigator.getGamepads?.() || []).some((g) => g);
          const platform = isTouch ? "mobile" : (hasController ? "controller" : "pc");
          sock.send({ type: "set_platform", platform });
          window.addEventListener("gamepadconnected", () => {
            sock.send({ type: "set_platform", platform: isTouch ? "mobile" : "controller" });
          }, { once: true });
        } catch {}
      },
      onClose: (intentional) => {
        setHud((h) => ({ ...h, connected: false }));
        if (!intentional) {
          try { document.exitPointerLock?.(); } catch {}
          if (isSpectator && spectateTarget) {
            nav(`/lobby?spectate_ended=1&target=${encodeURIComponent(spectateTarget)}`, { replace: true });
          } else {
            nav("/lobby?disconnected=1", { replace: true });
          }
        }
      },
      onMessage: (msg) => {
        if (msg.type === "pong") {
          const rtt = Date.now() - (msg.ts || 0);
          pingRef.current.value = rtt;
          // Surface ping for any subscribers (e.g. PerfCounter chip).
          try { window.dispatchEvent(new CustomEvent("virtue-ping", { detail: rtt })); } catch {}
          return;
        }
        if (msg.type === "match_end") {
          setHud((h) => ({ ...h, matchEnd: msg }));
          setTimeout(() => {
            try { document.exitPointerLock?.(); } catch {}
            nav("/lobby", { replace: true });
          }, 8000);
          return;
        }
        if (msg.type === "chat") {
          setChatMessages((prev) => [
            ...prev.slice(-30),
            { id: `${msg.id}-${msg.ts}-${Math.random().toString(36).slice(2,6)}`, username: msg.username, is_bot: !!msg.is_bot, text: msg.text },
          ]);
          return;
        }
        if (msg.type === "match_start") {
          setHud((h) => ({ ...h, matchEnd: null }));
          return;
        }
        if (msg.type === "state") {
          setHud((h) => ({
            ...h,
            timeLeft: msg.time_left ?? null,
            isRanked: !!msg.is_ranked,
            inQueue: !!msg.in_queue,
            realCount: msg.real_count ?? 0,
            minRealPlayers: msg.min_real_players ?? 2,
          }));
        }
        engineRef.current?.applyServerState(msg);
      },
    };
    // Offline / Practice → local simulation (no network required).
    // Everything else → real WebSocket.
    const sock = offlineCapable
      ? new LocalSim({ ...sockHandlers, user, mode })
      : new GameSocket(sockHandlers);
    sockRef.current = sock;
    if (offlineCapable) {
      sock.connect();
    } else {
      sock.connect(
        accessToken,
        mode,
        mode === "party" && partyId
          ? { party_id: partyId }
          : mode === "spectate" && spectateTarget
          ? { target: spectateTarget }
          : null
      );
    }

    // Network send loop @ 20Hz
    const intervalId = setInterval(() => {
      if (!engineRef.current) return;
      // Spectators don't send any input — server ignores it anyway.
      if (engineRef.current.isSpectator) return;
      const snap = engineRef.current.snapshot();
      const curWeapon =
        engineRef.current?.currentWeapon === "tertiary" ? "laser" : "ak47";
      sock.send({
        type: "input",
        x: snap.x,
        z: snap.z,
        yaw: snap.yaw,
        pitch: snap.pitch,
        ads: !!snap.ads,
        // Tell the server which weapon we currently have equipped so it can
        // gate continuous-fire (laser) and resolve hit-scan shots against the
        // correct config. Without this the server never sees "laser" and the
        // beam tick is silently skipped.
        weapon: curWeapon,
        // Continuous laser fire — server applies per-tick damage + heat while
        // this is true (subject to overheat lockout).
        laser_firing: !!snap.laser_firing,
      });
      // Mirror ADS into hud for the scope overlay.
      setHud((h) => (h.ads === !!snap.ads ? h : { ...h, ads: !!snap.ads }));
      if (snap.shoot) {
        const weapon = engineRef.current?.currentWeapon === "tertiary" ? "laser" : "ak47";
        sock.send({ type: "shoot", yaw: snap.shootYaw, pitch: snap.shootPitch, weapon });
      }
      if (snap.melee) {
        sock.send({ type: "melee", yaw: snap.meleeYaw, pitch: snap.meleePitch });
      }
    }, 1000 / 20);

    // Ping loop @ 1Hz
    const pingId = setInterval(() => {
      sock.send({ type: "ping", ts: Date.now() });
    }, 1000);

    // FPS/ping display refresh @ 4Hz
    const statsId = setInterval(() => {
      setHud((h) => ({
        ...h,
        fps: engineRef.current?.getFps() ?? 0,
        ping: pingRef.current.value,
      }));
    }, 250);

    const onLockChange = () => {
      const locked = document.pointerLockElement === canvas;
      setPointerLocked(locked);
      if (locked) setShowPause(false); // resume → dismiss pause overlay
    };
    document.addEventListener("pointerlockchange", onLockChange);

    const onKeyDown = (e) => {
      const kb = settingsStore.get()?.keybinds || {};
      if (e.code === (kb.scoreboard || "Tab")) {
        e.preventDefault();
        setHud((h) => ({ ...h, showScoreboard: true }));
      }
      if (e.code === (kb.weapon1 || "Digit1")) {
        engineRef.current?.setWeapon("primary");
        setHud((h) => ({ ...h, weapon: "primary" }));
      }
      if (e.code === (kb.weapon2 || "Digit2")) {
        engineRef.current?.setWeapon("secondary");
        setHud((h) => ({ ...h, weapon: "secondary" }));
      }
      if (e.code === (kb.weapon3 || "Digit3")) {
        engineRef.current?.setWeapon("tertiary");
        setHud((h) => ({ ...h, weapon: "tertiary" }));
      }
      if (e.code === (kb.reload || "KeyR")) {
        const w = engineRef.current?.currentWeapon === "tertiary" ? "laser" : "ak47";
        sock.send({ type: "reload", weapon: w });
      }
      if (e.code === "Escape") {
        // pointer lock auto-released by the browser. Surface a pause overlay
        // with a prominent LEAVE MATCH button — the tiny corner EXIT used to
        // get missed.
        setShowPause(true);
      }
    };
    const onKeyUp = (e) => {
      const kb = settingsStore.get()?.keybinds || {};
      if (e.code === (kb.scoreboard || "Tab")) setHud((h) => ({ ...h, showScoreboard: false }));
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    return () => {
      clearInterval(intervalId);
      clearInterval(pingId);
      clearInterval(statsId);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      unsubSettings();
      sock.close();
      engine.dispose();
      // Safety: cut the continuous laser hum if the player navigates away
      // mid-beam — otherwise it'd keep playing into the lobby.
      audioBus.laserBeamStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-skip the click-to-lock overlay on touch devices (no pointer lock there).
  useEffect(() => {
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (isTouch) {
      audioBus.stopLobbyMusic();
      setPointerLocked(true);
    }
  }, []);

  const [pointerLockBlocked, setPointerLockBlocked] = useState(false);

  useEffect(() => {
    const onBlocked = () => setPointerLockBlocked(true);
    window.addEventListener("virtue-pointerlock-blocked", onBlocked);
    return () => window.removeEventListener("virtue-pointerlock-blocked", onBlocked);
  }, []);

  const handleStart = useCallback(() => {
    audioBus.stopLobbyMusic();
    engineRef.current?.requestPointerLock();
  }, []);

  const handleExit = useCallback(() => {
    // Release pointer lock first — the navigate sometimes fired while the
    // browser was still holding the lock, which made the lobby look frozen.
    // Closing the WS explicitly here also avoids a race with the useEffect
    // cleanup on the slower devices.
    try { document.exitPointerLock?.(); } catch {}
    try { sockRef.current?.close(); } catch {}
    setShowPause(false);
    setShowGameSettings(false);
    setShowGameFriends(false);
    audioBus.laserBeamStop();
    nav("/lobby");
  }, [nav]);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden" data-testid="game-page">
      {/* Post-FX overlays + CSS filter wrapper. These hook into the new
          graphics settings (brightness/contrast/saturation/scanlines/etc.)
          without touching the WebGL renderer — purely CSS so they cost
          virtually nothing on a healthy GPU. */}
      <PostFxLayer />
      <PerfCounter />
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        data-testid="game-canvas"
        onClick={() => {
          // Replaces the removed click-to-play overlay: clicking anywhere
          // on the canvas locks the pointer (must be a real user gesture).
          // Spectators don't need pointer lock — they just watch.
          if (!pointerLocked && !isSpectator && !showPause) handleStart();
        }}
      />
      {isSpectator && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 bg-[#FFD700] text-black border-pow shadow-pow-sm px-4 py-1 font-anton uppercase tracking-widest text-sm" data-testid="spectate-banner">
          SPECTATING · {spectateTarget}
        </div>
      )}
      {pointerLockBlocked && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 max-w-md px-4">
          <div className="card-pow p-0 overflow-hidden">
            <div className="bg-[#FFD700] text-black px-4 py-2 font-anton uppercase tracking-widest text-sm">
              Mouse capture blocked
            </div>
            <div className="bg-white px-4 py-3 text-sm">
              <p className="font-body mb-2">
                This preview is running inside a sandboxed iframe that disallows pointer lock.
              </p>
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-pow bg-[#E62429] text-white inline-block [&]:px-3 [&]:py-1.5 [&]:text-xs"
                data-testid="open-in-new-tab"
              >
                <span>OPEN IN NEW TAB</span>
              </a>
              <p className="font-body text-xs text-neutral-500 mt-2">
                The deployed app at blast-arena-servers.emergent.host works without this restriction.
              </p>
            </div>
          </div>
        </div>
      )}
      <Hud
        hud={hud}
        username={user?.username}
        pointerLocked={pointerLocked}
        onStart={handleStart}
        onExit={handleExit}
      />
      {showPause && !isSpectator && (
        <div
          className="absolute inset-0 z-40 bg-black/70 flex items-center justify-center"
          data-testid="pause-overlay"
        >
          <div className="card-pow p-0 w-[min(440px,92vw)]">
            <div className="bg-black text-white px-6 py-4 font-display text-4xl text-pow-shadow-lg flex items-center justify-between">
              <span>PAUSED</span>
              <span className="text-[#FFD700] text-xl">ESC</span>
            </div>
            <div className="bg-white p-5 space-y-3">
              <button
                onClick={() => {
                  setShowPause(false);
                  handleStart();
                }}
                className="btn-pow bg-[#06A35F] text-white w-full text-xl [&]:py-3"
                data-testid="pause-resume-button"
              >
                <span className="flex items-center justify-center gap-2"><Play size={18} strokeWidth={3} /> RESUME</span>
              </button>
              <button
                onClick={() => setShowGameSettings(true)}
                className="btn-pow bg-white text-black w-full text-lg [&]:py-2.5"
                data-testid="pause-settings-button"
              >
                <span className="flex items-center justify-center gap-2"><SettingsIcon size={18} strokeWidth={3} /> SETTINGS</span>
              </button>
              <button
                onClick={() => setShowGameFriends(true)}
                className="btn-pow bg-[#06A35F] text-white w-full text-lg [&]:py-2.5"
                data-testid="pause-friends-button"
              >
                <span className="flex items-center justify-center gap-2"><UserPlus size={18} strokeWidth={3} /> FRIENDS</span>
              </button>
              <button
                onClick={handleExit}
                className="btn-pow bg-[#E62429] text-white w-full text-xl [&]:py-3"
                data-testid="pause-leave-button"
              >
                <span className="flex items-center justify-center gap-2"><LogOut size={18} strokeWidth={3} /> LEAVE MATCH</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-match Menu button — always visible so touch users + players
          locked in pointer-lock can open the pause overlay (and from there
          Settings / Friends / Leave Match) without needing ESC. */}
      {!showPause && (
        <button
          onClick={() => {
            try { document.exitPointerLock?.(); } catch {}
            setShowPause(true);
          }}
          className="absolute top-3 right-3 z-30 btn-pow bg-black text-white [&]:px-3 [&]:py-2 [&]:text-xs"
          data-testid="game-menu-button"
          title="Menu (ESC)"
        >
          <span className="flex items-center gap-1"><Menu size={16} strokeWidth={3} /></span>
        </button>
      )}

      {/* In-match Settings + Friends modals (reuse lobby components). */}
      <SettingsModal open={showGameSettings} onClose={() => setShowGameSettings(false)} />
      <FriendsModal open={showGameFriends} onClose={() => setShowGameFriends(false)} />
      <TouchControls
        engineRef={engineRef}
        onShoot={() => {}}
        onMelee={() => {}}
        onReload={() => {
          const w = engineRef.current?.currentWeapon === "tertiary" ? "laser" : "ak47";
          sockRef.current?.send({ type: "reload", weapon: w });
        }}
        onSwitchWeapon={(w) => {
          engineRef.current?.setWeapon(w);
          setHud((h) => ({ ...h, weapon: w }));
        }}
        onToggleScoreboard={(show) => setHud((h) => ({ ...h, showScoreboard: !!show }))}
      />
      <Chat
        messages={chatMessages}
        onSend={(text) => sockRef.current?.send({ type: "chat", text })}
        hidden={"ontouchstart" in window || navigator.maxTouchPoints > 0}
      />
    </div>
  );
}

/* Layered post-FX driven entirely by the settings store. Sits above the
   canvas but below the HUD (z-1). Each effect is its own div so it can
   blend mode / opacity independently. CSS-only so no engine surgery. */
function PostFxLayer() {
  const [s, setS] = useState(() => settingsStore.get());
  useEffect(() => settingsStore.subscribe(setS), []);
  // Mirror uiBlur to a body class so the HUD panels strip backdrop-filter.
  useEffect(() => {
    const enabled = s.uiBlur !== false;
    document.documentElement.classList.toggle("virtue-no-ui-blur", !enabled);
    return () => document.documentElement.classList.remove("virtue-no-ui-blur");
  }, [s.uiBlur]);
  // Build a single CSS filter string for brightness/contrast/saturation
  // and color-blind LMS shifts. Empty string = browser uses default.
  const cb = s.colorBlindMode;
  const cbHue =
    cb === "protanopia" ? "hue-rotate(-12deg) saturate(0.85)" :
    cb === "deuteranopia" ? "hue-rotate(12deg) saturate(0.85)" :
    cb === "tritanopia" ? "hue-rotate(40deg) saturate(0.9)" : "";
  const filter = [
    `brightness(${s.brightness ?? 1})`,
    `contrast(${s.contrast ?? 1})`,
    `saturate(${s.saturation ?? 1})`,
    cbHue,
  ].filter(Boolean).join(" ");
  return (
    <>
      {/* Global color filter — applied to the canvas via a sibling overlay
          using `mix-blend-mode: none`. Trick: we set a wrapper around #root
          when we'd need to filter the canvas; instead we just paint a
          semitransparent backdrop. Brightness/contrast actually need to
          target the canvas directly so we toggle a body class. */}
      <BodyFilter filter={filter} />
      {s.vignette !== false && (
        <div
          className="pointer-events-none fixed inset-0 z-[1]"
          style={{
            background:
              "radial-gradient(circle at center, transparent 55%, rgba(0,0,0,0.55) 100%)",
          }}
          data-testid="postfx-vignette"
        />
      )}
      {s.filmGrain && (
        <div
          className="pointer-events-none fixed inset-0 z-[2] mix-blend-overlay opacity-25"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.7'/></svg>\")",
            backgroundSize: "180px 180px",
            animation: "grain-jitter 0.4s steps(2) infinite",
          }}
          data-testid="postfx-film-grain"
        />
      )}
      {s.chromaticAberration && (
        <div
          className="pointer-events-none fixed inset-0 z-[2]"
          style={{
            boxShadow:
              "inset 0 0 0 1px rgba(255,0,80,0.10), inset 0 0 0 2px rgba(0,180,255,0.10)",
            mixBlendMode: "screen",
          }}
          data-testid="postfx-chromatic-aberration"
        />
      )}
      {s.scanlines && (
        <div
          className="pointer-events-none fixed inset-0 z-[2] opacity-25"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, rgba(0,0,0,0.5) 0 1px, transparent 1px 3px)",
          }}
          data-testid="postfx-scanlines"
        />
      )}
    </>
  );
}

/* Toggle a CSS filter on <html> based on settings. We use a side-effect-only
   component so we don't need to wrap the whole tree in an extra div. */
function BodyFilter({ filter }) {
  useEffect(() => {
    document.documentElement.style.setProperty("--virtue-postfx-filter", filter);
    document.documentElement.classList.add("virtue-postfx-active");
    return () => {
      document.documentElement.style.removeProperty("--virtue-postfx-filter");
      document.documentElement.classList.remove("virtue-postfx-active");
    };
  }, [filter]);
  return null;
}

/* Tiny FPS / ping counter shown in the top-left when enabled. Subscribes to
   the engine's render tick via requestAnimationFrame for a smoothed FPS, and
   to the existing ping channel via the global event the engine emits on
   every pong. */
export function PerfCounter() {
  const [s, setS] = useState(() => settingsStore.get());
  const [fps, setFps] = useState(0);
  const [ping, setPing] = useState(null);
  useEffect(() => settingsStore.subscribe(setS), []);
  useEffect(() => {
    if (!s.showFps) return;
    let last = performance.now();
    let acc = 0;
    let count = 0;
    let raf;
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      acc += dt;
      count += 1;
      if (acc >= 500) {
        setFps(Math.round((1000 * count) / acc));
        acc = 0;
        count = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.showFps]);
  useEffect(() => {
    if (!s.showPing) return;
    const onPing = (e) => {
      const v = e?.detail;
      if (typeof v === "number") setPing(Math.round(v));
    };
    window.addEventListener("virtue-ping", onPing);
    return () => window.removeEventListener("virtue-ping", onPing);
  }, [s.showPing]);
  if (!s.showFps && !s.showPing) return null;
  return (
    <div
      className="pointer-events-none fixed top-2 left-2 z-30 font-mono text-xs flex gap-2"
      data-testid="perf-counter"
    >
      {s.showFps && (
        <span
          className="px-1.5 py-0.5 rounded bg-black/70 text-white tabular-nums"
          data-testid="perf-fps"
        >
          {fps} FPS
        </span>
      )}
      {s.showPing && ping !== null && (
        <span
          className="px-1.5 py-0.5 rounded bg-black/70 text-white tabular-nums"
          data-testid="perf-ping"
        >
          {ping} MS
        </span>
      )}
    </div>
  );
}

