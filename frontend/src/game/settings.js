/* Tiny persistent settings store. Values are mirrored to localStorage and
   broadcast through a typed event so the engine + HUD can react live. */

const KEY = "virtue-settings-v1";
const EVT = "virtue-settings-changed";

const DEFAULTS = Object.freeze({
  graphics: "high",         // "low" | "medium" | "high"
  shadows: true,
  antialias: true,
  fpsCap: 0,                // 0 = unlimited, else 30/60/120/144
  touchControls: "auto",    // "auto" | "on" | "off"
  fovDegrees: 75,
  aimAssist: true,
  mouseSensitivity: 1.0,    // 0.25 - 2.5
  // Extended graphics options ------------------------------------------------
  renderScale: 1.0,         // 0.5 - 1.5 (renderer pixel ratio multiplier)
  viewDistance: 140,        // 60 - 200 meters (camera far plane)
  bloom: false,             // toggle screen-space bloom (cheap canvas blur)
  motionBlur: false,        // toggle motion blur on rapid camera turns
  cameraBob: true,          // viewmodel + camera bob while sprinting
  screenShake: true,        // hit / kill screen-shake feedback
  showDamageFlash: true,    // red border flash when taking damage
  highContrastOutlines: false, // thicker comic outlines for accessibility
  crosshairStyle: "cross",  // "dot" | "cross" | "plus" | "circle"
  crosshairColor: "#FFD700",
  hudScale: 1.0,            // 0.75 - 1.25
  showDamageNumbers: true,  // floating damage numbers on hits
  showKillFeed: true,       // top-right kill feed
  // Keyboard binds (KeyboardEvent.code strings). One primary code per action.
  keybinds: {
    forward: "KeyW",
    back: "KeyS",
    left: "KeyA",
    right: "KeyD",
    jump: "Space",
    sprint: "ShiftLeft",
    crouch: "ControlLeft",
    reload: "KeyR",
    melee: "KeyV",
    adsToggle: "KeyZ",   // alt to right-mouse-button hold
    weapon1: "Digit1",
    weapon2: "Digit2",
    weapon3: "Digit3",
    scoreboard: "Tab",
  },
  // Gamepad button mapping (standard layout indices). Override with any index.
  controllerBinds: {
    jump: 0,        // A
    melee: 2,       // X
    reload: 1,      // B
    weaponCycle: 3, // Y
    shoot: 7,       // RT
    ads: 6,         // LT
    weaponNext: 5,  // RB
    weaponPrev: 4,  // LB
  },
  // Mobile HUD layout — per-control position (px from container edges) +
  // size scale + opacity. Position basis: each control has its own anchor
  // (see TouchControls.jsx); these offsets are applied on top.
  hudLayout: {
    move:        { x: 32,  y: 32,  scale: 1.0, opacity: 1.0 },
    actions:     { x: 32,  y: 32,  scale: 1.0, opacity: 1.0 },
    weapons:     { x: 16,  y: 16,  scale: 1.0, opacity: 1.0 },
    scoreboard:  { x: 0,   y: 16,  scale: 1.0, opacity: 1.0 },
  },
});

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...(parsed || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

let cache = read();

function broadcast() {
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: { ...cache } })); } catch {}
}

export const settingsStore = {
  get: () => ({ ...cache }),
  set: (patch) => {
    cache = { ...cache, ...(patch || {}) };
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
    broadcast();
  },
  reset: () => {
    cache = { ...DEFAULTS };
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
    broadcast();
  },
  subscribe: (fn) => {
    const handler = (e) => fn(e.detail);
    window.addEventListener(EVT, handler);
    // Send current value immediately for convenience.
    Promise.resolve().then(() => fn({ ...cache }));
    return () => window.removeEventListener(EVT, handler);
  },
  DEFAULTS,
};

export default settingsStore;
