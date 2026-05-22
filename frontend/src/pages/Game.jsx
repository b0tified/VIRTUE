import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { GameEngine } from "@/game/engine";
import { GameSocket } from "@/game/network";
import audioBus from "@/game/audio";
import settingsStore from "@/game/settings";
import Hud from "@/components/Hud";
import TouchControls from "@/components/TouchControls";
import Chat from "@/components/Chat";

export default function Game() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const sockRef = useRef(null);
  const { user, accessToken } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const rawMode = searchParams.get("mode");
  const partyId = searchParams.get("party_id") || null;
  const mode = rawMode === "ranked"
    ? "ranked"
    : rawMode === "practice"
    ? "practice"
    : rawMode === "offline"
    ? "offline"
    : rawMode === "party" && partyId
    ? "party"
    : "casual";

  const [hud, setHud] = useState({
    hp: 100,
    alive: true,
    youId: null,
    players: [],
    killFeed: [],
    showScoreboard: false,
    damaged: 0,
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
          };
        });
      },
      onLocalUpdate: (ev) => {
        if (ev.type === "damaged") {
          setHud((h) => ({ ...h, damaged: Date.now() }));
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

    const sock = new GameSocket({
      onOpen: () => {
        setHud((h) => ({ ...h, connected: true }));
        // Tell server what input device the player is on so the scoreboard
        // can show the right platform icon next to each name.
        try {
          const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
          const hasController = (navigator.getGamepads?.() || []).some((g) => g);
          const platform = isTouch ? "mobile" : (hasController ? "controller" : "pc");
          sock.send({ type: "set_platform", platform });
          // Re-detect on first gamepad event (player plugs in a controller mid-match).
          window.addEventListener("gamepadconnected", () => {
            sock.send({ type: "set_platform", platform: isTouch ? "mobile" : "controller" });
          }, { once: true });
        } catch {}
      },
      onClose: (intentional) => {
        setHud((h) => ({ ...h, connected: false }));
        if (!intentional) {
          // Lost connection — kick back to lobby.
          try { document.exitPointerLock?.(); } catch {}
          nav("/lobby?disconnected=1", { replace: true });
        }
      },
      onMessage: (msg) => {
        if (msg.type === "pong") {
          const rtt = Date.now() - (msg.ts || 0);
          pingRef.current.value = rtt;
          return;
        }
        if (msg.type === "match_end") {
          setHud((h) => ({ ...h, matchEnd: msg }));
          // Auto-return to lobby after showing results (both casual + ranked).
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
          // Surface ranked timer + queue info into HUD
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
    });
    sockRef.current = sock;
    sock.connect(accessToken, mode, mode === "party" && partyId ? { party_id: partyId } : null);

    // Network send loop @ 20Hz
    const intervalId = setInterval(() => {
      if (!engineRef.current) return;
      const snap = engineRef.current.snapshot();
      sock.send({
        type: "input",
        x: snap.x,
        z: snap.z,
        yaw: snap.yaw,
        pitch: snap.pitch,
        ads: !!snap.ads,
      });
      // Mirror ADS into hud for the scope overlay.
      setHud((h) => (h.ads === !!snap.ads ? h : { ...h, ads: !!snap.ads }));
      if (snap.shoot) {
        const weapon = engineRef.current?.currentWeapon === "tertiary" ? "laser" : "ak47";
        sock.send({ type: "shoot", yaw: snap.yaw, pitch: snap.pitch, weapon });
      }
      if (snap.melee) {
        sock.send({ type: "melee", yaw: snap.yaw, pitch: snap.pitch });
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
      setPointerLocked(document.pointerLockElement === canvas);
    };
    document.addEventListener("pointerlockchange", onLockChange);

    const onKeyDown = (e) => {
      if (e.code === "Tab") {
        e.preventDefault();
        setHud((h) => ({ ...h, showScoreboard: true }));
      }
      if (e.code === "Digit1") {
        engineRef.current?.setWeapon("primary");
        setHud((h) => ({ ...h, weapon: "primary" }));
      }
      if (e.code === "Digit2" || e.code === "KeyV") {
        engineRef.current?.setWeapon("secondary");
        setHud((h) => ({ ...h, weapon: "secondary" }));
      }
      if (e.code === "Digit3") {
        engineRef.current?.setWeapon("tertiary");
        setHud((h) => ({ ...h, weapon: "tertiary" }));
      }
      if (e.code === "KeyR") {
        const w = engineRef.current?.currentWeapon === "tertiary" ? "laser" : "ak47";
        sock.send({ type: "reload", weapon: w });
      }
      if (e.code === "Escape") {
        // pointer lock auto-released
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "Tab") setHud((h) => ({ ...h, showScoreboard: false }));
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

  const handleExit = () => {
    nav("/lobby");
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden" data-testid="game-page">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        data-testid="game-canvas"
        onClick={() => {
          // Replaces the removed click-to-play overlay: clicking anywhere
          // on the canvas locks the pointer (must be a real user gesture).
          if (!pointerLocked) handleStart();
        }}
      />
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
