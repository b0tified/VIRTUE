import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { GameEngine } from "@/game/engine";
import { GameSocket } from "@/game/network";
import audioBus from "@/game/audio";
import settingsStore from "@/game/settings";
import Hud from "@/components/Hud";
import TouchControls from "@/components/TouchControls";

export default function Game() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const sockRef = useRef(null);
  const { user, accessToken } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode") === "ranked" ? "ranked" : "casual";

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
          audioBus.gunshot(ev.shooterId, ev.distance);
        } else if (ev.type === "you-hit") {
          audioBus.hitmark(!!ev.headshot);
          setHud((h) => ({ ...h, hitConfirm: Date.now(), hitHeadshot: !!ev.headshot }));
        } else if (ev.type === "you-killed") {
          audioBus.killSfx(!!ev.headshot);
          setHud((h) => ({ ...h, hitConfirm: Date.now(), hitHeadshot: !!ev.headshot }));
        } else if (ev.type === "footstep") {
          audioBus.footstep(ev.sprint);
        }
      },
    });
    engineRef.current = engine;

    // Apply persisted graphics + FPS-cap settings and keep them live.
    engine.applySettings(settingsStore.get());
    const unsubSettings = settingsStore.subscribe((s) => engine.applySettings(s));
    engine.onShoot = () => audioBus.gunshot(engine.youId, 0);
    engine.start();

    const sock = new GameSocket({
      onOpen: () => setHud((h) => ({ ...h, connected: true })),
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
          // Ranked: auto-return to lobby after showing results.
          if (mode === "ranked") {
            setTimeout(() => {
              try { document.exitPointerLock?.(); } catch {}
              nav("/lobby", { replace: true });
            }, 8000);
          }
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
    sock.connect(accessToken, mode);

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

  const handleStart = useCallback(() => {
    audioBus.stopLobbyMusic();
    engineRef.current?.requestPointerLock();
  }, []);

  const handleExit = () => {
    nav("/lobby");
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden" data-testid="game-page">
      <canvas ref={canvasRef} className="w-full h-full" data-testid="game-canvas" />
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
      />
    </div>
  );
}
