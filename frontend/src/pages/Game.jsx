import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { GameEngine } from "@/game/engine";
import { GameSocket } from "@/game/network";
import audioBus from "@/game/audio";
import Hud from "@/components/Hud";

export default function Game() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const sockRef = useRef(null);
  const { user, accessToken } = useAuth();
  const nav = useNavigate();

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
          };
        });
      },
      onLocalUpdate: (ev) => {
        if (ev.type === "damaged") {
          setHud((h) => ({ ...h, damaged: Date.now() }));
          audioBus.hurt();
        } else if (ev.type === "remote-shot") {
          audioBus.gunshot();
        } else if (ev.type === "you-hit") {
          audioBus.hitmark();
          setHud((h) => ({ ...h, hitConfirm: Date.now() }));
        } else if (ev.type === "you-killed") {
          audioBus.killSfx();
          setHud((h) => ({ ...h, hitConfirm: Date.now() }));
        }
      },
    });
    engineRef.current = engine;
    engine.onShoot = () => audioBus.gunshot();
    engine.start();

    const sock = new GameSocket({
      onOpen: () => setHud((h) => ({ ...h, connected: true })),
      onClose: () => setHud((h) => ({ ...h, connected: false })),
      onMessage: (msg) => {
        if (msg.type === "pong") {
          const rtt = Date.now() - (msg.ts || 0);
          pingRef.current.value = rtt;
          return;
        }
        engineRef.current?.applyServerState(msg);
      },
    });
    sockRef.current = sock;
    sock.connect(accessToken);

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
      });
      if (snap.shoot) {
        sock.send({ type: "shoot", yaw: snap.yaw, pitch: snap.pitch });
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
    </div>
  );
}
