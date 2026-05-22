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
