import { useEffect, useRef, useState } from "react";
import settingsStore from "@/game/settings";

/* Mobile / touchscreen controls.
   Renders two virtual joysticks (left = move WASD, right = look around) plus
   on-screen buttons: shoot, melee, reload, jump, weapon switch.
   Directly drives the engine via injected keyboard-like flags and yaw/pitch
   deltas. Auto-hides on desktops unless the user forces "always on" in
   settings. */
const TOUCH_KEY_MAP = ["w", "s", "a", "d"]; // 0=up, 1=down, 2=left, 3=right

function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    (window.navigator && window.navigator.maxTouchPoints > 0)
  );
}

export default function TouchControls({ engineRef, onShoot, onMelee, onReload, onSwitchWeapon, onToggleScoreboard }) {
  const [enabled, setEnabled] = useState(false);
  const [hudLayout, setHudLayout] = useState(() => settingsStore.get().hudLayout || settingsStore.DEFAULTS.hudLayout);
  const autoFireRef = useRef(!!settingsStore.get().touchAutoFire);
  const moveStickRef = useRef(null);
  const lookStickRef = useRef(null);
  // Track active touches so we can drive both sticks simultaneously.
  const stateRef = useRef({
    move: { touchId: null, baseX: 0, baseY: 0, dx: 0, dy: 0 },
    look: { touchId: null, lastX: 0, lastY: 0 },
    keys: new Set(),
    weapon: "primary",
  });
  // Auto-fire interval — runs only while the look pad is being touched AND
  // the touchAutoFire setting is enabled.
  const autoFireTimerRef = useRef(null);

  // React to settings changes (touchControls: auto/on/off + HUD layout edits).
  useEffect(() => {
    const unsub = settingsStore.subscribe((s) => {
      const mode = s.touchControls || "auto";
      setEnabled(mode === "on" || (mode === "auto" && isTouchDevice()));
      setHudLayout(s.hudLayout || settingsStore.DEFAULTS.hudLayout);
      autoFireRef.current = !!s.touchAutoFire;
    });
    return unsub;
  }, []);

  // Engine input wiring. We synthesize keyboard-style keys on the engine
  // (engine reads `this.keys` Set) and forward look deltas via yaw/pitch.
  useEffect(() => {
    if (!enabled) return;
    const e = engineRef.current;
    if (!e) return;
    e.touchActive = true;
    // Movement update loop @ 60Hz to feed the engine
    let raf = 0;
    const tick = () => {
      const eng = engineRef.current;
      if (eng) {
        const m = stateRef.current.move;
        const mag = Math.hypot(m.dx, m.dy);
        const dead = 0.18;
        const dirs = [false, false, false, false]; // up, down, left, right
        if (mag > dead) {
          const ny = m.dy / mag;  // -y is up in DOM, but stick: dy>0 = down
          const nx = m.dx / mag;
          if (ny < -0.35) dirs[0] = true;       // up = W
          if (ny >  0.35) dirs[1] = true;       // down = S
          if (nx < -0.35) dirs[2] = true;       // left = A
          if (nx >  0.35) dirs[3] = true;       // right = D
        }
        TOUCH_KEY_MAP.forEach((k, i) => {
          if (dirs[i]) eng.keys.add("Key" + k.toUpperCase());
          else eng.keys.delete("Key" + k.toUpperCase());
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Clear any latched virtual keys when disabling.
      const eng = engineRef.current;
      if (eng) {
        TOUCH_KEY_MAP.forEach((k) => eng.keys.delete("Key" + k.toUpperCase()));
        eng.touchActive = false;
      }
      // Stop auto-fire loop if it was running.
      if (autoFireTimerRef.current) {
        clearInterval(autoFireTimerRef.current);
        autoFireTimerRef.current = null;
      }
    };
  }, [enabled, engineRef]);

  if (!enabled) return null;

  // ----- Joystick handlers -----
  const onMoveStart = (e) => {
    const t = e.changedTouches[0];
    const rect = moveStickRef.current.getBoundingClientRect();
    stateRef.current.move.touchId = t.identifier;
    stateRef.current.move.baseX = rect.left + rect.width / 2;
    stateRef.current.move.baseY = rect.top + rect.height / 2;
    onMoveMove(e);
  };

  const onMoveMove = (e) => {
    const st = stateRef.current.move;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== st.touchId) continue;
      const dx = t.clientX - st.baseX;
      const dy = t.clientY - st.baseY;
      const max = 60;
      const mag = Math.min(max, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      st.dx = (Math.cos(a) * mag) / max;
      st.dy = (Math.sin(a) * mag) / max;
    }
  };

  const onMoveEnd = (e) => {
    const st = stateRef.current.move;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === st.touchId) {
        st.touchId = null;
        st.dx = 0; st.dy = 0;
      }
    }
  };

  // Look pad: any touch dragged in the right half rotates yaw/pitch.
  const onLookStart = (e) => {
    const t = e.changedTouches[0];
    const st = stateRef.current.look;
    st.touchId = t.identifier;
    st.lastX = t.clientX;
    st.lastY = t.clientY;
    // Start auto-fire loop if the setting is enabled. The shot only
    // fires while the crosshair is currently over an enemy — touching
    // the screen alone is no longer enough. Engine cooldown still gates
    // the actual shot rate.
    if (autoFireRef.current && !autoFireTimerRef.current) {
      const fire = () => {
        const eng = engineRef.current;
        if (!eng) return;
        if (eng.hasEnemyInCrosshair?.()) {
          eng._tryShoot?.(eng.yaw, eng.pitch);
        }
      };
      fire();
      autoFireTimerRef.current = setInterval(fire, 50);
    }
  };

  const onLookMove = (e) => {
    const st = stateRef.current.look;
    const eng = engineRef.current;
    if (!eng) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== st.touchId) continue;
      const dx = t.clientX - st.lastX;
      const dy = t.clientY - st.lastY;
      st.lastX = t.clientX;
      st.lastY = t.clientY;
      // Touch look sensitivity setting. Base 0.005 × user multiplier.
      // Apply the ADS multiplier so touch-aim slows down when aiming.
      const adsFactor = eng._adsSensFactor ? eng._adsSensFactor() : 1.0;
      const sens = 0.005 * (parseFloat(settingsStore.get()?.touchSensitivity) || 1.0) * adsFactor;
      eng.yaw -= dx * sens;
      eng.pitch = Math.max(-1.5, Math.min(1.5, eng.pitch - dy * sens));
    }
  };

  const onLookEnd = (e) => {
    const st = stateRef.current.look;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === st.touchId) {
        st.touchId = null;
      }
    }
    // Stop auto-fire when the look pad is released.
    if (st.touchId === null && autoFireTimerRef.current) {
      clearInterval(autoFireTimerRef.current);
      autoFireTimerRef.current = null;
    }
  };

  const pressShoot = () => {
    const eng = engineRef.current;
    if (eng) {
      // Use the gated path so ammo/reload state is respected on touch too.
      eng._tryShoot?.(eng.yaw, eng.pitch);
    }
    onShoot?.();
  };

  const pressMelee = () => {
    const eng = engineRef.current;
    if (eng) {
      eng.pendingMelee = true;
      eng.pendingMeleeAim = { yaw: eng.yaw, pitch: eng.pitch };
    }
    onMelee?.();
  };

  const pressJump = () => {
    const eng = engineRef.current;
    if (eng) {
      // Same path as Space key in engine input handler
      eng.keys.add("Space");
      setTimeout(() => eng.keys.delete("Space"), 60);
    }
  };

  const moveL = hudLayout?.move    || { x: 32, y: 32, scale: 1, opacity: 1 };
  const actL  = hudLayout?.actions || { x: 32, y: 32, scale: 1, opacity: 1 };
  const wepL  = hudLayout?.weapons || { x: 16, y: 16, scale: 1, opacity: 1 };
  const scbL  = hudLayout?.scoreboard || { x: 0, y: 16, scale: 1, opacity: 1 };

  return (
    <div className="absolute inset-0 z-30 pointer-events-none select-none" data-testid="touch-controls">
      {/* LEFT: move stick */}
      <div
        className="pointer-events-auto absolute rounded-full bg-white/10 border-2 border-white/30"
        style={{
          bottom: moveL.y,
          left: moveL.x,
          width: 144 * moveL.scale,
          height: 144 * moveL.scale,
          opacity: moveL.opacity,
        }}
        ref={moveStickRef}
        onTouchStart={onMoveStart}
        onTouchMove={onMoveMove}
        onTouchEnd={onMoveEnd}
        onTouchCancel={onMoveEnd}
        data-testid="touch-move-stick"
      >
        <Knob dx={stateRef.current.move.dx} dy={stateRef.current.move.dy} />
        <div className="absolute -top-6 left-0 right-0 text-center text-[10px] uppercase tracking-widest text-white/60">Move</div>
      </div>

      {/* RIGHT: look stick (pad takes up most of right side) */}
      <div
        className="pointer-events-auto absolute right-0 top-0 bottom-0 w-1/2"
        ref={lookStickRef}
        onTouchStart={onLookStart}
        onTouchMove={onLookMove}
        onTouchEnd={onLookEnd}
        onTouchCancel={onLookEnd}
        data-testid="touch-look-pad"
      />

      {/* RIGHT: action buttons (sit above the look pad, in pointer-events-auto bubble) */}
      <div
        className="pointer-events-auto absolute grid grid-cols-2 gap-3 z-40"
        style={{
          bottom: actL.y,
          right: actL.x,
          transform: `scale(${actL.scale})`,
          transformOrigin: "bottom right",
          opacity: actL.opacity,
        }}
      >
        <ActionBtn label="Reload" onPress={() => onReload?.()} color="#FFD700" testid="touch-reload" />
        <ActionBtn label="Melee"  onPress={pressMelee}        color="#9B59B6" testid="touch-melee" />
        <ActionBtn label="Jump"   onPress={pressJump}         color="#0055FF" testid="touch-jump" />
        {/* Fire button: hold for auto-fire on AK-47 (engine cooldown gates
            shots to the weapon's RPM, so calling _tryShoot every 50ms is
            safe — the function bails when the cooldown timer hasn't elapsed). */}
        <ActionBtn
          label="Fire"
          onPress={pressShoot}
          color="#E62429"
          big
          autoRepeatMs={50}
          testid="touch-fire"
        />
      </div>

      {/* Weapon switcher (top-right above look pad) */}
      <div
        className="pointer-events-auto absolute flex flex-col gap-1 z-40"
        style={{
          top: wepL.y,
          right: wepL.x,
          transform: `scale(${wepL.scale})`,
          transformOrigin: "top right",
          opacity: wepL.opacity,
        }}
      >
        {[
          { w: "primary",   k: "1", label: "AK"  },
          { w: "secondary", k: "2", label: "KAT" },
          { w: "tertiary",  k: "3", label: "LSR" },
        ].map((it) => (
          <button
            key={it.w}
            type="button"
            onTouchStart={(e) => { e.preventDefault(); onSwitchWeapon?.(it.w); }}
            className="bg-black/60 border border-white/30 rounded px-2 py-1 text-[10px] font-anton uppercase tracking-widest text-white"
            data-testid={`touch-weapon-${it.w}`}
          >
            {it.k} · {it.label}
          </button>
        ))}
      </div>

      {/* Scoreboard button (mobile-only press-and-hold to view; tap toggles) */}
      <button
        type="button"
        onTouchStart={(e) => { e.preventDefault(); onToggleScoreboard?.(true); }}
        onTouchEnd={(e) => { e.preventDefault(); onToggleScoreboard?.(false); }}
        onTouchCancel={(e) => { e.preventDefault(); onToggleScoreboard?.(false); }}
        className="pointer-events-auto absolute left-1/2 -translate-x-1/2 z-40 bg-black/70 border-2 border-white/40 rounded px-3 py-2 text-xs font-anton uppercase tracking-widest text-white active:bg-black/90"
        style={{
          top: scbL.y,
          transform: `translateX(-50%) scale(${scbL.scale})`,
          transformOrigin: "top center",
          opacity: scbL.opacity,
        }}
        data-testid="touch-scoreboard"
        aria-label="Hold to view scoreboard"
      >
        SCORE
      </button>
    </div>
  );
}

function Knob({ dx, dy }) {
  return (
    <div
      className="absolute w-14 h-14 rounded-full bg-white/40 border-2 border-white pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        transform: `translate(-50%, -50%) translate(${(dx || 0) * 40}px, ${(dy || 0) * 40}px)`,
        transition: dx || dy ? "none" : "transform 120ms ease-out",
      }}
    />
  );
}

function ActionBtn({ label, onPress, color, big = false, testid, autoRepeatMs = 0 }) {
  // Auto-repeat handle (for the Fire button). When the touch is held, we
  // fire `onPress` every `autoRepeatMs` ms; engine-side cooldown gates the
  // actual shot rate so this is safe.
  const intervalRef = useRef(null);
  const startRepeat = (e) => {
    e.preventDefault();
    onPress();
    if (autoRepeatMs > 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => onPress(), autoRepeatMs);
    }
  };
  const stopRepeat = (e) => {
    if (e) e.preventDefault();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };
  // Cleanup on unmount.
  useEffect(() => () => stopRepeat(), []);
  return (
    <button
      type="button"
      onTouchStart={startRepeat}
      onTouchEnd={stopRepeat}
      onTouchCancel={stopRepeat}
      className={`rounded-full border-2 border-white text-white font-anton uppercase tracking-widest active:scale-95 transition-transform ${big ? "w-20 h-20 text-lg" : "w-16 h-16 text-xs"}`}
      style={{ background: color, boxShadow: "0 4px 0 #000" }}
      data-testid={testid}
    >
      {label}
    </button>
  );
}
