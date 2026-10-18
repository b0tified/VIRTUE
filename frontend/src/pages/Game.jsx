import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";
import { GameEngine } from "@/game/engine";
import { GameSocket } from "@/game/network";
import { LocalSim } from "@/game/localSim";
import audioBus from "@/game/audio";
import settingsStore from "@/game/settings";
import { detectIsMobile } from "@/game/useIsMobile";
import Hud, { ReportPlayerModal } from "@/components/Hud";
import TouchControls from "@/components/TouchControls";
import Chat from "@/components/Chat";
import SettingsModal from "@/components/SettingsModal";
import FriendsModal from "@/components/FriendsModal";
import RespawnOverlay from "@/components/RespawnOverlay";
import DeathOverlay from "@/components/DeathOverlay";
import { useQueue } from "@/context/QueueContext";
import { Menu, Settings as SettingsIcon, UserPlus, LogOut, Play, Flag, X as XIcon } from "lucide-react";

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
  // Forced map id for practice / offline runs — set by the lobby's map
  // selector. Ignored for real-WS modes (server picks).
  const mapIdParam = searchParams.get("map") || null;
  const mode = spectateTarget
    ? "spectate"
    : rawMode === "ranked"
    ? "ranked"
    : rawMode === "practice"
    ? "practice"
    : rawMode === "offline"
    ? "offline"
    : rawMode === "bigffa"
    ? "bigffa"
    : rawMode === "party" && partyId
    ? "party"
    : "casual";
  const isSpectator = mode === "spectate";

  // If the player joins any in-game mode while a ranked queue is still
  // active, cancel it. Otherwise a match could pop mid-game and the
  // "Match Found" toast + auto-nav to /play?mode=ranked would yank
  // them out of the current match into a loading screen. Ranked mode
  // itself is the legitimate destination so we skip the cancel there.
  const queueCtx = useQueue();
  useEffect(() => {
    if (mode !== "ranked" && queueCtx?.queueState && !queueCtx.queueState.matched) {
      queueCtx.cancelRanked?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
    // Set to Date.now() when the WebGL context is lost so the shell
    // can render a "Recovering graphics..." overlay while the auto
    // page-reload fires. Null while the context is healthy.
    glLost: null,
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
    // Loadout choice ("ak47" | "sniper") — seeded from the auth user
    // so the HUD label is correct on first render (before the first
    // server state broadcast). Updated per-tick from
    // engineRef.current.primaryWeaponId.
    primaryWeaponId: user?.primary_weapon === "sniper" ? "sniper" : "ak47",
  });
  const [pointerLocked, setPointerLocked] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [showPause, setShowPause] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isTouchDevice] = useState(() => detectIsMobile());
  // Pause-menu player-report flow. `showReportPicker` toggles a modal
  // that lists every other in-match player (bots hidden). Clicking a
  // row sets `reportTarget` which opens ReportPlayerModal.
  const [showReportPicker, setShowReportPicker] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  // Timestamp of the last respawn — used to (re)trigger RespawnOverlay.
  const [respawnAt, setRespawnAt] = useState(null);
  // Timestamp of the last local death — used to (re)trigger DeathOverlay.
  const [diedAt, setDiedAt] = useState(null);
  const [showGameSettings, setShowGameSettings] = useState(false);
  const [showGameFriends, setShowGameFriends] = useState(false);
  // Brief green "+HP" flash whenever the server grants on-kill health.
  const [killHealFlash, setKillHealFlash] = useState(null);
  useEffect(() => {
    if (!killHealFlash) return;
    const t = setTimeout(() => setKillHealFlash(null), 1100);
    return () => clearTimeout(t);
  }, [killHealFlash]);
  const pingRef = useRef({ lastSent: 0, value: 0 });
  // Timeout id for the 15s auto-fallback after match_end. Stored in a ref so
  // the Play Again / Lobby buttons can cancel it (otherwise the page would
  // still bounce to lobby 15s after a successful in-place Play Again).
  const matchEndFallbackRef = useRef(null);

  // Setup engine + socket
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas, {
      mode,
      onState: (msg) => {
        // Build kill feed
        const newKills = (msg.events || []).filter((e) => e.type === "kill");
        // Detect a kill_heal event aimed at the local player so we can
        // flash a green "+30" HP toast.
        const youId = engineRef.current?.youId;
        const myHeal = (msg.events || []).find(
          (e) => e.type === "kill_heal" && e.player_id === youId,
        );
        if (myHeal) {
          setKillHealFlash({ id: Date.now(), amount: myHeal.amount });
        }
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
            // Primary-slot weapon id ("ak47" | "sniper"). Piped into
            // hud state so the bottom-right weapon label + colour
            // reflect the equipped loadout (Hud.jsx keys on this
            // field). Sourced from the engine mirror which itself is
            // updated from the server-authoritative `p.weapon`.
            primaryWeaponId: engineRef.current?.primaryWeaponId || "ak47",
            // Mirror laser heat + overheat state so the HUD can swap the
            // ammo block for a heat bar while the laser is equipped.
            laserHeat: you?.laser_heat ?? 0,
            laserOverheated: !!you?.laser_overheated,
            laserFiring: !!you?.laser_firing,
            // TDM payload — pull from engine's cached state, not the
            // raw msg, because state DELTAS only include changed top
            // fields. Reading msg.game_mode directly would collapse to
            // "ffa" on every tick after the first.
            gameMode: engineRef.current?._gameMode || "ffa",
            teamScores: engineRef.current?._teamScores || null,
            tdmKillTarget: engineRef.current?._tdmKillTarget || null,
            // Crosshair currently aimed at a teammate? Engine raycasts
            // a 7° cone each state frame; HUD tints the reticle blue +
            // shows a small "TEAMMATE" tag when this is true so the
            // player knows to hold fire.
            crosshairOnTeammate: engineRef.current?.isCrosshairOnTeammate?.() || false,
            // Minimap snapshot — null in FFA. Fed to the TDM minimap
            // overlay so it can render arena outline + team blips.
            minimap: engineRef.current?.getMinimapData?.() || null,
            // Spawn immunity flag — surfaces as a top-of-screen banner so
            // the player knows damage isn't being dealt to them this brief
            // window.
            invuln: !!you?.invuln,
          };
        });
      },
      onLocalUpdate: (ev) => {
        if (ev.type === "damaged") {
          // Build a damage-indicator marker so the HUD can show an arc pointing
          // toward the shooter. We store the shooter id + their last known
          // world position so the HUD can re-resolve the arc each frame and
          // follow the shooter if they move (see DamageDirectionLayer).
          let angleRad = null;
          if (ev.from) {
            const you = engineRef.current;
            if (you) {
              const dx = ev.from.x - you.position.x;
              const dz = ev.from.z - you.position.z;
              // World yaw=0 points along -Z (see engine input math). The
              // player's facing bearing in this same convention is `-yaw`
              // (atan2(-sin(yaw), cos(yaw)) = -yaw), so the bearing of the
              // shooter *relative to the player's facing* is:
              //   screenAngle = worldAngle - playerForwardBearing
              //               = atan2(dx, -dz) + yaw
              // 0 = front, +π/2 = right, ±π = behind, -π/2 = left. Earlier
              // versions used `- yaw` which inverted the arc once the
              // player had rotated more than ~90° (the indicator pointed
              // forward when shot from behind, etc.).
              const worldAngle = Math.atan2(dx, -dz);
              angleRad = worldAngle + (ev.yaw ?? 0);
              while (angleRad > Math.PI) angleRad -= 2 * Math.PI;
              while (angleRad < -Math.PI) angleRad += 2 * Math.PI;
            }
          }
          setHud((h) => ({
            ...h,
            damaged: Date.now(),
            damageMarkers: [
              ...(h.damageMarkers || []).filter((m) => Date.now() - m.ts < 1500),
              { ts: Date.now(), angle: angleRad, shooterId: ev.shooterId || null, from: ev.from || null },
            ].slice(-5),
          }));
          audioBus.hurt();
        } else if (ev.type === "remote-shot") {
          audioBus.gunshot(ev.shooterId, ev.distance, ev.weapon || "ak47", ev.pos || null);
        } else if (ev.type === "remote-respawn") {
          audioBus.remoteRespawn?.(ev.distance, ev.pos || null);
        } else if (ev.type === "you-hit") {
          audioBus.hitmark(!!ev.headshot);
          setHud((h) => ({ ...h, hitConfirm: Date.now(), hitHeadshot: !!ev.headshot }));
        } else if (ev.type === "you-killed") {
          audioBus.killSfx(!!ev.headshot);
          setHud((h) => ({ ...h, hitConfirm: Date.now(), hitHeadshot: !!ev.headshot }));
        } else if (ev.type === "footstep") {
          audioBus.footstep(ev.sprint);
        } else if (ev.type === "remote-footstep") {
          audioBus.remoteFootstep?.(!!ev.sprint, ev.distance || 0, ev.pos || null);
        } else if (ev.type === "killed-by") {
          // Show the killer's PlayerCard on the death overlay.
          setHud((h) => ({ ...h, lastKiller: ev.killer }));
        } else if (ev.type === "reload-pressed") {
          // Use the engine's current primary loadout id — hardcoding
          // "ak47" here was flipping sniper users back to AK on every
          // reload (server treats the message as authoritative).
          const eng = engineRef.current;
          const w = eng?.currentWeapon === "tertiary"
            ? "laser"
            : (eng?.primaryWeaponId || "ak47");
          sockRef.current?.send({ type: "reload", weapon: w });
        } else if (ev.type === "webgl-context-lost") {
          // Laptop integrated GPUs sometimes drop the WebGL context
          // when a second player joins (VRAM pressure). Audio + JS
          // keep running so the game *looks* frozen. Show an overlay
          // and auto-reload after 2s — the fastest way back to a
          // usable state without a manual page refresh.
          setHud((h) => ({ ...h, glLost: Date.now() }));
          setTimeout(() => {
            try { window.location.reload(); } catch { /* no-op */ }
          }, 2200);
        } else if (ev.type === "webgl-context-restored") {
          // If the browser restores the context before the reload
          // timer fires, clear the overlay flag. We still let the
          // scheduled reload happen because Three.js buffers/textures
          // aren't automatically re-uploaded on restore — a fresh
          // page + rejoin is the only reliably-clean recovery.
          setHud((h) => ({ ...h, glLost: null }));
        } else if (ev.type === "laser-beam-start") {
          audioBus.laserBeamStart();
        } else if (ev.type === "laser-beam-stop") {
          audioBus.laserBeamStop();
        } else if (ev.type === "laser-overheat") {
          audioBus.laserOverheat();
          setHud((h) => ({ ...h, laserOverheat: Date.now() }));
        } else if (ev.type === "reload-start") {
          audioBus.reload(ev.weapon || "ak47");
        } else if (ev.type === "jump") {
          // Broadcast the local player's jump to the server so other
          // clients see the arc + play the "someone jumped" reads on
          // remote humanoids. The server clamps the arc to 650ms and
          // ignores repeats while airborne so we don't over-send.
          sockRef.current?.send({ type: "jump" });
        } else if (ev.type === "respawn") {
          // Local player just transitioned dead → alive. Play the comic
          // respawn animation + revive SFX, and clear the last-killer so
          // the death overlay's killer card doesn't bleed into next life.
          audioBus.respawnSfx?.();
          setRespawnAt(Date.now());
          setHud((h) => ({ ...h, lastKiller: null, damageMarkers: [] }));
        } else if (ev.type === "died") {
          // Edge-triggered local death — play the K.O. burst overlay.
          audioBus.deathSfx?.();
          setDiedAt(Date.now());
        }
      },
    });
    engineRef.current = engine;
    // Seed the engine's primary-weapon id from the player's lobby
    // loadout choice so HUD ammo / label / hipfire gate are correct
    // BEFORE the first server state broadcast lands (~50-200ms after
    // WS connect). Without this, sniper users see "AK-47 25/25" for
    // a beat, then the label flips once state arrives.
    if (user?.primary_weapon === "ak47" || user?.primary_weapon === "sniper") {
      engine.primaryWeaponId = user.primary_weapon;
      // Swap the viewmodel + muzzle flash to match — otherwise sniper
      // users would see the AK model rendered until the first server
      // state broadcast triggers the re-selection.
      engine._applyPrimarySelection?.();
    }
    // Expose for in-browser debugging + e2e tests (cheap, single-instance).
    try { window.__virtueEngine = engine; } catch {}

    // Apply persisted graphics + FPS-cap settings and keep them live.
    engine.applySettings(settingsStore.get());
    audioBus.set3DAudio?.(settingsStore.get().audio3D !== false);
    const unsubSettings = settingsStore.subscribe((s) => {
      engine.applySettings(s);
      audioBus.set3DAudio?.(s.audio3D !== false);
    });
    engine.onShoot = () => {
      // Route the SFX by the currently-held weapon. Sniper now has its
      // own dedicated `_sniperShot` in the audio bus (loud + booming).
      // Secondary = melee — user renamed the katana to "MELEE" and it
      // plays a punch/thud SFX so local swings feel snappy.
      let w;
      if (engine.currentWeapon === "tertiary") w = "laser";
      else if (engine.currentWeapon === "secondary") w = "melee";
      else w = engine.primaryWeaponId || "ak47";
      audioBus.gunshot(engine.youId, 0, w);
    };
    engine.start();

    // Practice + Offline normally run on a local sim (no server) for
    // zero-latency private play. TDM however requires the server's team
    // logic — friendly-fire suppression, team-balanced spawns, team
    // score tracking — none of which exist in LocalSim. So when the
    // user picks TDM in the selector (`?tdm=1`) we fall back to the
    // real server's dedicated TDM rooms (`tdm_room`, `practice_tdm_room`,
    // or per-user offline TDM).
    const wantsTdm = searchParams.get("tdm") === "1";
    const offlineCapable = !wantsTdm && (mode === "offline" || mode === "practice");
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
        if (msg.type === "welcome") {
          // The engine handles the actual welcome (camera + arena rebuild).
          // We just notify the global MatchLoadingScreen so it can swap
          // its preview to the actual server-selected map and dismiss.
          try {
            window.dispatchEvent(new CustomEvent("virtue-match-loaded", {
              detail: {
                map_id: msg.arena?.map_id || null,
                map_name: msg.arena?.name || null,
                // Server-confirmed mode (e.g. quick-match may roll FFA or
                // TDM 50/50). The loading screen swaps its subtitle to
                // the truth on welcome so the player knows what they're
                // dropping into.
                game_mode: msg.game_mode || "ffa",
                is_ranked: !!msg.is_ranked,
                is_practice: !!msg.is_practice,
              },
            }));
          } catch {}
          // Tell the server our local 3D scene + audio are ready so the
          // room can start its pre-match countdown. The server holds
          // every shoot/move blocked until ALL real players have sent
          // this — late joiners (mid-match) hit a no-op handler. We
          // delay slightly so the HUD has time to mount and the
          // loading-screen confirm animation can wind down.
          setTimeout(() => {
            try { sock.send({ type: "loaded" }); } catch {}
          }, 200);
          // Don't return — let the engine consume the welcome too.
        }
        if (msg.type === "pong") {
          const rtt = Date.now() - (msg.ts || 0);
          pingRef.current.value = rtt;
          // Surface ping for any subscribers (e.g. PerfCounter chip).
          try { window.dispatchEvent(new CustomEvent("virtue-ping", { detail: rtt })); } catch {}
          return;
        }
        if (msg.type === "match_end") {
          setHud((h) => ({ ...h, matchEnd: msg }));
          // Find this player's placement so we can persist a pending
          // rank-up overlay payload. Overlay no longer fires IN-GAME —
          // it only plays once the player is back on /lobby so the
          // celebration isn't competing with the match-end scoreboard.
          // The lobby reads `virtue.pendingRankUp` from localStorage
          // on mount and dispatches `virtue-rankup` 600ms later.
          const youId = engineRef.current?.youId;
          const mine = (msg.placements || []).find((p) => p.id === youId);
          if (mine && !mine.is_placement) {
            const tierChanged = (mine.rank_change || 0) > 0;
            // Sub-division promotion (lower number = higher division: 3 → 2 → 1).
            const prevDiv = mine.prev_rank_division ?? 0;
            const newDiv = mine.rank_division ?? 0;
            const divisionUp = !tierChanged && prevDiv > 0 && newDiv > 0 && newDiv < prevDiv;
            if (tierChanged || divisionUp) {
              const payload = {
                prevTier: { idx: mine.prev_rank_tier ?? 0, name: mine.prev_rank_name || "BRONZE", division: prevDiv },
                newTier:  { idx: mine.rank_tier ?? 0,      name: mine.rank_name || "BRONZE",      division: newDiv },
                rpDelta:  mine.delta ?? 0,
                newPoints: mine.new_points ?? 0,
                kind: tierChanged ? "tier" : "division",
              };
              // Stash for the lobby to replay on return. No in-game
              // overlay — intentionally silent until the player is
              // back in the main lobby.
              try {
                localStorage.setItem("virtue.pendingRankUp", JSON.stringify(payload));
              } catch {}
            }
          }
          // Disconnect from the server immediately so the room's next
          // intermission/match_start can't yank the player back into
          // active gameplay before they've acknowledged the result. The
          // overlay stays visible until they click Back to Lobby (or the
          // AFK fallback below fires). Intentional close → no
          // "?disconnected=1" toast.
          try { document.exitPointerLock?.(); } catch {}
          try { sockRef.current?.close?.(); } catch {}
          // AFK fallback: auto-drop them to lobby after 20s so a closed
          // tab / minimised window can't strand them on the overlay
          // forever. The Back to Lobby button cancels this.
          if (matchEndFallbackRef.current) clearTimeout(matchEndFallbackRef.current);
          matchEndFallbackRef.current = setTimeout(() => {
            matchEndFallbackRef.current = null;
            nav("/lobby", { replace: true });
          }, 20000);
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
          // Only honour match_start when we don't already have a
          // match-end overlay up. After end_match, we close the socket
          // (see match_end handler) so this branch only fires for the
          // very first match join.
          setHud((h) => h.matchEnd ? h : { ...h, matchEnd: null });
          return;
        }
        if (msg.type === "state" || msg.type === "state_delta") {
          // Top-level HUD fields are only present on the keyframe and
          // whenever they change in a delta. Merge non-undefined values
          // and keep previous HUD values otherwise so the bar doesn't
          // flicker between deltas.
          setHud((h) => ({
            ...h,
            timeLeft: msg.time_left !== undefined ? msg.time_left : h.timeLeft,
            isRanked: msg.is_ranked !== undefined ? !!msg.is_ranked : h.isRanked,
            inQueue: msg.in_queue !== undefined ? !!msg.in_queue : h.inQueue,
            realCount: msg.real_count !== undefined ? msg.real_count : h.realCount,
            minRealPlayers: msg.min_real_players !== undefined ? msg.min_real_players : h.minRealPlayers,
          }));
        }
        engineRef.current?.applyServerState(msg);
      },
    };
    // Offline / Practice → local simulation (no network required).
    // Everything else → real WebSocket.
    const sock = offlineCapable
      ? new LocalSim({ ...sockHandlers, user, mode, mapId: mapIdParam })
      : new GameSocket(sockHandlers);
    sockRef.current = sock;
    // Expose socket on window for E2E test injection of synthetic
    // match_end / match_start payloads. Safe no-op in production.
    try { window.__virtue_sock = sock; } catch {}
    if (offlineCapable) {
      sock.connect();
    } else {
      // `?tdm=1` survives the route hand-off from the lobby's
      // PracticeMapSelector and tells the server to route this join
      // into the team-mode room (practice/offline) — and for casual
      // quick-match, forces TDM rather than letting the 50% roll decide.
      // (Reuses `wantsTdm` computed above.)
      // `?map=<id>` is forwarded to the server for offline/practice
      // solo modes so the map the player picked in the selector
      // actually gets used instead of the room's stale random roll.
      // `?force_map=<id>` is an admin-only equivalent used by QA /
      // preview screenshot tooling.
      const forceMap = searchParams.get("force_map") || null;
      const pickedMap = searchParams.get("map") || null;
      const soloMap = (mode === "offline" || mode === "practice") && pickedMap ? { map: pickedMap } : {};
      // Mobile-only matchmaking flags — mirror what /queue POSTs send.
      // The server uses `mobile_only=1` to nerf bots + tag them mobile
      // on the scoreboard. `mobile=1` is informational (renders the
      // phone chip beside the caller's own name for other players).
      const platformFlags = (() => {
        try {
          const isMobile = detectIsMobile();
          const pref = !!settingsStore.get().mobileOnlyMatchmaking;
          const flags = {};
          if (isMobile) flags.mobile = 1;
          if (isMobile && pref) flags.mobile_only = 1;
          return flags;
        } catch { return {}; }
      })();
      // Casual quick-match mode preference — forwarded as a WS URL
      // param so the router honours it even if MATCHED_USERS was
      // cleared out from under us (e.g. reconnect after a transient
      // WS drop, race with the pop after the initial connect). The
      // matchmaker's decision on MATCHED_USERS[uid].tdm remains the
      // primary signal; `mode_pref` is only used as a fallback when
      // that entry is missing. Ranked / party / spectate / offline /
      // practice / bigffa ignore this param.
      const casualModePref = (() => {
        try {
          const p = (settingsStore.get().quickMatchModePref || "both").toLowerCase();
          return p === "ffa" || p === "tdm" ? p : null;
        } catch { return null; }
      })();
      const extra =
        mode === "party" && partyId
          ? { party_id: partyId, ...(wantsTdm ? { tdm: 1 } : {}), ...(forceMap ? { force_map: forceMap } : {}), ...platformFlags }
          : mode === "spectate" && spectateTarget
          ? { target: spectateTarget }
          : {
              ...(wantsTdm ? { tdm: 1 } : {}),
              ...(forceMap ? { force_map: forceMap } : {}),
              ...soloMap,
              ...platformFlags,
              ...(mode === "casual" && casualModePref ? { mode_pref: casualModePref } : {}),
            };
      sock.connect(accessToken, mode, Object.keys(extra || {}).length ? extra : null);
    }

    // Network send loop @ 20Hz
    // Helper: resolve the network `weapon` id from the engine state.
    // Tertiary slot is always "laser"; primary slot mirrors the
    // player's loadout ("ak47" or "sniper"). Used by BOTH the input
    // tick (line ~465) and the shoot payload (line ~495) — the drift
    // between these two call sites is what previously broke sniper
    // equip in-game (input tick hardcoded "ak47" and clobbered the
    // server-side loadout every 50ms).
    const resolveNetworkWeapon = () => {
      const eng = engineRef.current;
      if (eng?.currentWeapon === "tertiary") return "laser";
      return eng?.primaryWeaponId || "ak47";
    };
    const intervalId = setInterval(() => {
      if (!engineRef.current) return;
      // Spectators don't send any input — server ignores it anyway.
      if (engineRef.current.isSpectator) return;
      const snap = engineRef.current.snapshot();
      const curWeapon = resolveNetworkWeapon();
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
        // Uses the same resolveNetworkWeapon helper so server sees the
        // right weapon (sniper has 1 mag, 200 dmg, ads_only). Falls
        // back to "ak47" if primary hasn't yet resolved from a server
        // broadcast.
        const weapon = resolveNetworkWeapon();
        // Pass our last-measured RTT so the server can lag-compensate the
        // shot (rewinds each target to where the shooter actually saw
        // them). Clamped server-side to a safe 0..300ms window.
        //
        // `ads` is echoed on the shoot message so the sniper's ads_only
        // gate applies to the shot's own ADS state (not whatever the
        // last 20Hz input tick happened to report). Without this, a
        // right-click-then-immediately-left-click sequence could arrive
        // at the server before the input tick's `ads: true` propagated,
        // causing the very first sniper shot after ADS to be rejected.
        sock.send({
          type: "shoot",
          yaw: snap.shootYaw,
          pitch: snap.shootPitch,
          weapon,
          ads: !!snap.ads,
          ping_ms: pingRef.current?.value | 0,
        });
      }
      if (snap.melee) {
        sock.send({ type: "melee", yaw: snap.meleeYaw, pitch: snap.meleePitch });
      }
    }, 1000 / 20);

    // Ping loop @ 1Hz
    const pingId = setInterval(() => {
      sock.send({ type: "ping", ts: Date.now() });
    }, 1000);

    // FPS/ping display refresh @ 4Hz. Also samples the engine's
    // pre-match countdown state so the on-screen overlay can tick down
    // from 3 → 2 → 1 without needing a dedicated 1Hz timer.
    const statsId = setInterval(() => {
      setHud((h) => ({
        ...h,
        fps: engineRef.current?.getFps() ?? 0,
        ping: pingRef.current.value,
        countdown: engineRef.current?.getCountdownState?.() || null,
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
        // HOLD-to-show: while Tab is held, the scoreboard is visible.
        // Releasing Tab hides it (see onKeyUp). Reporting has moved
        // into the pause menu (ESC → REPORT PLAYER) so we no longer
        // need to release pointer-lock here.
        setHud((h) => (h.showScoreboard ? h : { ...h, showScoreboard: true }));
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
        // Spectator mode: no pause menu (the pause overlay is gated
        // `!isSpectator`). Instead, ESC drops the user straight back
        // to the lobby — same nav target as the corner LEAVE button
        // — so spectators aren't stuck watching until the target
        // dies / disconnects. Called unconditionally on ESC; a
        // no-op if spectateTarget is somehow null.
        if (isSpectator) {
          try { document.exitPointerLock?.(); } catch {}
          nav(`/lobby?spectate_ended=1&target=${encodeURIComponent(spectateTarget || "")}`, { replace: true });
          return;
        }
        // pointer lock auto-released by the browser. Surface a pause overlay
        // with a prominent LEAVE MATCH button — the tiny corner EXIT used to
        // get missed.
        setShowPause(true);
      }
    };
    const onKeyUp = (e) => {
      const kb = settingsStore.get()?.keybinds || {};
      if (e.code === (kb.scoreboard || "Tab")) {
        // Hide scoreboard when Tab is released (hold-to-show).
        setHud((h) => (h.showScoreboard ? { ...h, showScoreboard: false } : h));
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    return () => {
      clearInterval(intervalId);
      clearInterval(pingId);
      clearInterval(statsId);
      // Clear the 15s auto-fallback timer if it was armed.
      if (matchEndFallbackRef.current) {
        clearTimeout(matchEndFallbackRef.current);
        matchEndFallbackRef.current = null;
      }
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
    // Clear the server-side matched/queue state AND set the client
    // cancel guards so the /lobby QueueContext background polls (which
    // fire every 3s once we leave the /play route) don't see a stale
    // `matched: true` and yank us right back into a match. Without
    // this, users pressing EXIT would bounce between /lobby → /play
    // in a loop until the server's on-disconnect cleanup finally
    // fired (~5-10s later on slow networks).
    try { queueCtx?.cancelRanked?.(); } catch { /* no-op */ }
    try { queueCtx?.cancelCasual?.(); } catch { /* no-op */ }
    // Party Custom Lobby: mark the user as opted-out of the CURRENT
    // start-session so the /party/me poller on /lobby stops seeing
    // `match_starting=true` for us. Without this, PartyPanel's
    // useEffect immediately re-navigates non-leader members back to
    // /play — the "leave match just brings you back into game if
    // you are not the host" bug. Fire-and-forget: if this 200ms
    // request loses to the /lobby poll we still have the client-side
    // cancel guards below to bridge one poll cycle.
    if (mode === "party") {
      try { api.post("/party/leave-match").catch(() => {}); } catch { /* no-op */ }
    }
    nav("/lobby");
  }, [nav, queueCtx, mode]);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden" data-testid="game-page">
      {/* WebGL context-lost recovery overlay. Some laptops (integrated
          GPU + power-save + hybrid graphics) drop the WebGL context
          when a second player joins the match, freezing the canvas
          while audio + WebSockets keep running. When the engine
          reports the loss, this overlay covers the frozen canvas and
          the shell auto-reloads after ~2s. */}
      {hud.glLost ? (
        <div
          className="absolute inset-0 z-[70] flex items-center justify-center bg-black/90 text-white pointer-events-auto"
          data-testid="webgl-recover-overlay"
        >
          <div className="text-center px-6 max-w-md">
            <div className="mx-auto mb-5 h-12 w-12 rounded-full border-4 border-white/20 border-t-white animate-spin" />
            <div className="text-2xl font-extrabold tracking-wide mb-2" style={{ fontFamily: "Bangers, Anton, sans-serif", letterSpacing: "0.05em" }}>
              GRAPHICS HICCUP
            </div>
            <div className="text-sm opacity-80">
              Your GPU dropped its context. Reloading to recover…
            </div>
          </div>
        </div>
      ) : null}
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
          // Clicking the canvas locks the pointer (must be a real user
          // gesture). Skip when any UI overlay is open — pause, scoreboard,
          // or spectator — so clicks on those overlays don't yank the
          // cursor back into the game.
          if (!pointerLocked && !isSpectator && !showPause && !hud.showScoreboard) handleStart();
        }}
      />
      {isSpectator && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2" data-testid="spectate-banner-wrap">
          <div className="bg-[#FFD700] text-black border-pow shadow-pow-sm px-4 py-1 font-anton uppercase tracking-widest text-sm" data-testid="spectate-banner">
            SPECTATING · {spectateTarget}
          </div>
          {/* Explicit LEAVE button — the pause menu (which normally
              holds the exit) is gated `!isSpectator`, so without this
              button spectators had no way to bail out short of typing
              `/lobby` into the URL bar. Uses the same nav destination
              as the pause-menu EXIT: back to the lobby with a
              `spectate_ended=1` marker so the lobby can toast the
              "you stopped spectating <target>" chip. */}
          <button
            onClick={() => {
              try { document.exitPointerLock?.(); } catch {}
              nav(`/lobby?spectate_ended=1&target=${encodeURIComponent(spectateTarget || "")}`, { replace: true });
            }}
            className="btn-pow bg-[#E62429] text-white [&]:px-3 [&]:py-1 [&]:text-xs"
            data-testid="spectate-leave-button"
            aria-label="Stop spectating and return to lobby"
          >
            <span className="flex items-center gap-1"><LogOut size={12} strokeWidth={3} /> LEAVE</span>
          </button>
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
        engineRef={engineRef}
        onCloseScoreboard={() => setHud((h) => ({ ...h, showScoreboard: false }))}
        onLobby={() => {
          if (matchEndFallbackRef.current) {
            clearTimeout(matchEndFallbackRef.current);
            matchEndFallbackRef.current = null;
          }
          try { document.exitPointerLock?.(); } catch {}
          nav("/lobby", { replace: true });
        }}      />
      {/* Pre-match 3-2-1 countdown overlay. Visible while the server
          says `match_started === false`. Two flavours:
            - `secondsLeft === null` → still waiting on other players'
              loading screens. We show a "GET READY" placeholder so the
              player knows the freeze is intentional.
            - `secondsLeft` is a number → big animated digit that pops
              with each tick. "GO!" reveals as the digit hits 0. */}
      {hud.countdown && !isSpectator && (
        <PreMatchCountdownOverlay state={hud.countdown} />
      )}

      {showPause && !isSpectator && (
        <div
          className="absolute inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-3"
          data-testid="pause-overlay"
        >
          <div className="card-pow p-0 w-[min(440px,92vw)] tiny:w-[min(620px,92vw)] my-auto">
            <div className="bg-black text-white px-6 py-4 tiny:py-2 font-display text-4xl tiny:text-2xl text-pow-shadow-lg flex items-center justify-between">
              <span>PAUSED</span>
              <span className="text-[#FFD700] text-xl">ESC</span>
            </div>
            <div className="bg-white p-5 space-y-3 tiny:p-3 tiny:space-y-0 tiny:grid tiny:grid-cols-2 tiny:gap-2 [&>button]:tiny:py-1.5 [&>button]:tiny:text-base">
              <button
                onClick={() => {
                  setShowPause(false);
                  if (!isTouchDevice) handleStart();
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
                onClick={() => setShowReportPicker(true)}
                className="btn-pow bg-[#9B59B6] text-white w-full text-lg [&]:py-2.5"
                data-testid="pause-report-button"
              >
                <span className="flex items-center justify-center gap-2"><Flag size={18} strokeWidth={3} /> REPORT PLAYER</span>
              </button>
              {/* Leave Match — hidden in ranked. Quitting a ranked
                  match drops a placement on every other player and
                  costs the queue real time, so we strip the convenient
                  exit. The penalty system (`/queue/ranked` 403 with a
                  10-minute ban) still applies if the player force-
                  closes the tab, but at least we don't make rage-
                  quitting one-click easy. */}
              {!hud.isRanked && (
                <button
                  onClick={handleExit}
                  className="btn-pow bg-[#E62429] text-white w-full text-xl [&]:py-3 tiny:col-span-2"
                  data-testid="pause-leave-button"
                >
                  <span className="flex items-center justify-center gap-2"><LogOut size={18} strokeWidth={3} /> LEAVE MATCH</span>
                </button>
              )}
              {hud.isRanked && (
                <div
                  className="text-center font-anton uppercase tracking-widest text-[11px] text-[#E62429] px-2 py-2 border-pow-thin bg-[#FFE4E4] tiny:col-span-2"
                  data-testid="pause-ranked-no-leave"
                >
                  Ranked matches can't be left mid-game. Quitting will lock you out of ranked queue for 10 minutes.
                </div>
              )}
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
          className={`absolute z-40 btn-pow bg-black text-white [&]:px-3 [&]:py-2 [&]:text-xs ${isTouchDevice ? "top-[124px] left-3" : "top-3 right-3"}`}
          data-testid="game-menu-button"
          aria-label="Menu (ESC)"
        >
          <span className="flex items-center gap-1"><Menu size={16} strokeWidth={3} /></span>
        </button>
      )}
      {isTouchDevice && !showPause && !isSpectator && !hud.isRanked && (
        <button
          onClick={() => setShowLeaveConfirm(true)}
          className="absolute top-[124px] left-[60px] z-40 btn-pow bg-[#E62429] text-white [&]:px-3 [&]:py-2 [&]:text-xs"
          data-testid="mobile-leave-button"
          aria-label="Leave match"
        >
          <span className="flex items-center gap-1 font-anton uppercase tracking-widest"><LogOut size={14} strokeWidth={3} /> LEAVE</span>
        </button>
      )}
      {showLeaveConfirm && (
        <div className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center p-4" data-testid="leave-confirm-modal">
          <div className="card-pow p-0 w-[min(360px,92vw)]">
            <div className="bg-black text-white px-5 py-3 font-display text-2xl">LEAVE MATCH?</div>
            <div className="bg-white p-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="btn-pow bg-white text-black [&]:py-2"
                data-testid="leave-confirm-cancel"
              >
                <span className="font-anton uppercase tracking-widest">STAY</span>
              </button>
              <button
                onClick={() => { setShowLeaveConfirm(false); handleExit(); }}
                className="btn-pow bg-[#E62429] text-white [&]:py-2"
                data-testid="leave-confirm-yes"
              >
                <span className="font-anton uppercase tracking-widest">LEAVE</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-match Settings + Friends modals (reuse lobby components). */}
      <SettingsModal open={showGameSettings} onClose={() => setShowGameSettings(false)} />
      <FriendsModal open={showGameFriends} onClose={() => setShowGameFriends(false)} />

      {/* Player-report picker — opened from the pause menu.
          Lists every other in-match player (bots hidden). Selecting
          one opens ReportPlayerModal with that target. */}
      {showReportPicker && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          style={{ pointerEvents: "auto" }}
          data-testid="report-picker-modal"
        >
          <div className="card-pow p-0 w-[min(520px,94vw)] max-h-[80vh] flex flex-col">
            <div className="bg-black text-white px-5 py-3 flex items-center justify-between">
              <div className="font-display text-2xl text-[#FFD700] flex items-center gap-2">
                <Flag size={20} strokeWidth={3} /> REPORT PLAYER
              </div>
              <button
                onClick={() => setShowReportPicker(false)}
                className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1"
                data-testid="report-picker-close-btn"
                aria-label="Close"
              >
                <XIcon size={14} strokeWidth={3} />
              </button>
            </div>
            <div className="bg-white p-3 space-y-2 overflow-y-auto">
              <div className="font-anton uppercase tracking-widest text-xs opacity-70 px-2 py-1">
                Select a player to report:
              </div>
              {(() => {
                const eligible = (hud.players || []).filter(
                  (p) => p && !p.is_bot && p.id !== hud.youId,
                );
                if (eligible.length === 0) {
                  return (
                    <div
                      className="font-anton uppercase text-sm text-center py-6 opacity-60"
                      data-testid="report-picker-empty"
                    >
                      No other real players in this match
                    </div>
                  );
                }
                return eligible.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setReportTarget(p);
                      setShowReportPicker(false);
                    }}
                    className="w-full border-pow-thin bg-[#F4F4F5] hover:bg-[#FFE680] active:bg-[#FFD700] px-3 py-2 flex items-center justify-between transition-colors"
                    data-testid={`report-picker-row-${i}`}
                  >
                    <span className="font-anton uppercase truncate">{p.username}</span>
                    <span className="font-anton uppercase text-xs text-[#E62429] flex items-center gap-1">
                      <Flag size={12} strokeWidth={3} /> REPORT
                    </span>
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Report submission modal — opened once a target has been picked.
          Reuses the exact same component the scoreboard used to render. */}
      {reportTarget && (
        <ReportPlayerModal
          target={reportTarget}
          onClose={() => setReportTarget(null)}
        />
      )}

      {/* Rank-up celebration is NOT shown in-game. match_end stashes a
          `virtue.pendingRankUp` payload in localStorage; the Lobby reads
          and dispatches it 600ms after /lobby mount so the celebration
          plays only when the player is back on the main lobby. */}
      {/* Comic-style respawn flash, plays for ~1.1s after each respawn. */}
      <RespawnOverlay trigger={respawnAt} />
      {/* Comic K.O. burst, plays for ~1.4s when the local player dies. */}
      <DeathOverlay trigger={diedAt} />
      {/* Green "+HP" flash whenever the server grants kill-heal. Floats
          up + fades in ~1.1s. Pointer-events:none so it never blocks the
          game canvas. */}
      {killHealFlash && (
        <div
          key={killHealFlash.id}
          className="absolute z-30 left-1/2 top-[58%] -translate-x-1/2 pointer-events-none"
          data-testid="kill-heal-flash"
        >
          <div
            className="font-display text-5xl text-pow-shadow-lg"
            style={{
              color: "#06D6A0",
              textShadow: "0 0 8px rgba(6,214,160,0.65), 2px 4px 0 rgba(0,0,0,0.85)",
              animation: "killheal-float 1.1s ease-out forwards",
            }}
          >
            +{killHealFlash.amount} HP
          </div>
        </div>
      )}
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

/* PreMatchCountdownOverlay — full-screen frozen-state overlay shown while
   the server holds `match_started === false`. Two visual phases:
     1. "GET READY" placeholder when `secondsLeft === null` (server is
        still waiting on at least one teammate's loading screen).
     2. Big animated digit (3 → 2 → 1 → GO!) once the server has
        actually started the countdown. Each tick mounts a fresh node
        via React's `key={secondsLeft}` so the pop animation replays
        without needing JS keyframes. */
function PreMatchCountdownOverlay({ state }) {
  const { secondsLeft } = state || {};
  const isWaiting = secondsLeft === null || secondsLeft === undefined;
  // 0 → "GO!", positive → the digit, null → "GET READY"
  const display = isWaiting ? "GET READY" : (secondsLeft <= 0 ? "GO!" : String(secondsLeft));
  const accent = isWaiting ? "#FFD700" : (secondsLeft <= 0 ? "#06A35F" : "#E62429");
  return (
    <div
      className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center"
      data-testid="prematch-countdown-overlay"
    >
      {/* Dim the underlying scene a touch so the digit pops without
          fully blacking out the arena — the player still sees the
          spawn area and their teammates. */}
      <div className="absolute inset-0 bg-black/35" />
      <div
        key={display}
        className="relative font-display text-pow-shadow-lg leading-none select-none"
        style={{
          fontSize: isWaiting ? "clamp(56px, 9vw, 132px)" : "clamp(140px, 22vw, 320px)",
          color: "#FFFFFF",
          textShadow: `0 0 30px ${accent}cc, 6px 6px 0 #0A0A0A, -2px -2px 0 #0A0A0A`,
          animation: "match-loading-banner-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        }}
        data-testid="prematch-countdown-digit"
      >
        {display}
      </div>
      {!isWaiting && (
        <div
          className="absolute bottom-[18vh] font-anton uppercase tracking-[0.4em] text-base sm:text-lg text-white/80"
          style={{ textShadow: "2px 2px 0 #0A0A0A" }}
        >
          MATCH STARTING — HOLD POSITION
        </div>
      )}
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
   every pong. Off by default — toggle in Settings → Video. The big green
   in-HUD chips were removed; this is the small mono fallback that opts in. */
export function PerfCounter() {
  const [s, setS] = useState(() => settingsStore.get());
  const [fps, setFps] = useState(0);
  const [ping, setPing] = useState(null);
  // `autoPerfActive` mirrors the engine's watchdog state via the two
  // custom events emitted from `_autoPerfEngage` / `_autoPerfDisengage`.
  // Shown as a small pill next to FPS so the user knows the engine
  // dialled quality down for them — no more silent switch.
  const [autoPerfActive, setAutoPerfActive] = useState(false);
  useEffect(() => settingsStore.subscribe(setS), []);
  useEffect(() => {
    const onEng = () => setAutoPerfActive(true);
    const onDis = () => setAutoPerfActive(false);
    window.addEventListener("virtue-autoperf-engaged", onEng);
    window.addEventListener("virtue-autoperf-disengaged", onDis);
    return () => {
      window.removeEventListener("virtue-autoperf-engaged", onEng);
      window.removeEventListener("virtue-autoperf-disengaged", onDis);
    };
  }, []);
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
  if (!s.showFps && !s.showPing && !autoPerfActive) return null;
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
      {autoPerfActive && (
        <span
          className="px-1.5 py-0.5 rounded bg-[#FFB000] text-black tabular-nums font-bold"
          data-testid="perf-auto-perf-chip"
          aria-label="Auto Performance mode is active — the engine dropped resolution and fog to boost FPS."
        >
          AUTO PERF
        </span>
      )}
    </div>
  );
}
