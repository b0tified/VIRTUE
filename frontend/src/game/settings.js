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
  // Mobile auto-fire — when on, the gun shoots continuously while the player
  // is touching the right-side look pad. Engine cooldown gates the actual
  // RPM. Off by default so the Fire button remains the canonical input.
  touchAutoFire: false,
  fovDegrees: 75,
  aimAssist: true,
  aimAssistStrength: 0.6,   // 0.0 - 1.0 — applied only when aimAssist is true
  mouseSensitivity: 1.0,    // 0.25 - 2.5
  // Per-input-method sensitivity. Mouse sens above stays as the master
  // value used by the engine when reading SENS_KEY in localStorage —
  // these are the additional sliders for controller + touch look.
  gamepadSensitivity: 1.0,  // 0.3 - 3.0 (multiplier on base 2.6 rad/sec)
  touchSensitivity: 1.0,    // 0.3 - 3.0 (multiplier on touch-drag yaw/pitch)
  // ADS sensitivity multiplier — applied on top of mouse/controller/touch
  // sensitivity when the player is aiming down sights. 1.0 = no change,
  // <1.0 = slower while ADS (typical FPS preference for precision aim).
  adsSensitivityMultiplier: 1.0, // 0.25 - 2.5
  // Extended graphics options ------------------------------------------------
  renderScale: 1.0,         // 0.5 - 1.5 (renderer pixel ratio multiplier)
  resolution: "native",     // "720p" | "900p" | "1080p" | "1440p" | "native" — preset bound to renderScale
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
  // More granular graphics knobs ---------------------------------------------
  textureQuality: "high",   // "low" | "medium" | "high" — toon-map filter / mipmap
  weaponDetail: "high",     // "low" | "medium" | "high" — viewmodel poly count
  particleDensity: 1.0,     // 0 (off) - 2.0 — multiplier for shells/sparks/grass
  grassDensity: 1.0,        // 0 (off) - 1.5 — multiplier for grass blade sprites
  cloudShadows: true,       // dynamic sky shadow blobs sweeping across the map
  vignette: true,           // soft dark corners overlay
  filmGrain: false,         // subtle animated grain texture
  chromaticAberration: false, // edge color fringing — adds cinematic flair
  scanlines: false,         // retro CRT scan lines overlay
  colorBlindMode: "off",    // "off" | "protanopia" | "deuteranopia" | "tritanopia"
  uiBlur: true,             // backdrop blur on HUD panels
  brightness: 1.0,          // 0.6 - 1.4 — multiplicative CSS filter
  contrast: 1.0,            // 0.7 - 1.3 — multiplicative CSS filter
  saturation: 1.0,          // 0.0 - 1.6 — multiplicative CSS filter
  showFps: false,           // small FPS counter (top-left)
  showPing: false,          // small ping counter next to FPS
  // Network — server region. Currently cosmetic (single-region deployment),
  // but persists the user's choice so we can route matchmaking to the
  // chosen region once additional gameservers come online.
  serverRegion: "auto",     // "auto" | "na-east" | "na-west" | "eu" | "sa" | "asia" | "oce"
  // Audio volumes (0..1). Replaces the old mute toggles in the UI but the
  // mute setters still work — setting volume = 0 is equivalent to mute.
  masterVolume: 0.9,
  musicVolume: 0.32,
  sfxVolume: 0.65,
  // Spatial / 3D Audio — when on, SFX events that carry a world position
  // (gunshots, remote spawn hums, melee swings, hit pings) are routed
  // through a Web Audio PannerNode so they stereo-pan and attenuate
  // based on the listener's head orientation. Off = legacy distance-only
  // volume falloff.
  audio3D: true,
  // Ray-traced lighting (cosmetic). Enables real-time soft shadow maps,
  // an additional directional sun + 3 colored point lights around the map,
  // and a brighter ambient pass for the cel-shaded toon materials. Costs
  // ~25-35% extra GPU on modern hardware; falls back gracefully on weak
  // devices (renderer just ignores the shadow flag).
  rayTracedLighting: false,
  // V-Sync — when true, the engine renders on a setTimeout loop instead of
  // requestAnimationFrame so it can tick faster than the display refresh.
  // Mostly reduces input latency on high-refresh monitors.
  disableVsync: false,
  // Frame Generation — render extra interpolated frames between physics
  // ticks. "off" = 1x (default), "2x" = render 2 frames per RAF, "3x" = 3.
  // Cheap on modern GPUs; helps perceived smoothness on 60Hz displays.
  frameGen: "off",
  // Animated lobby background — when true, the lobby uses the new
  // souped-up animated background (parallax meteors, pulsing crater
  // glow, drifting embers). Off = legacy static-ish background
  // (single sky gradient + slow drifting blobs). Defaulted on so new
  // players get the polish, but kept as a toggle for users who find
  // the motion distracting / battery-heavy.
  lobbyAnimatedBackground: true,
  // Lobby background variant picker — "auto" gates on the current season
  // (Season 1 → default, Season 2 → meteor, Season 3+ → snow). Any
  // finished-season variant unlocks in the Settings picker so players
  // can reminisce with a past season's aesthetic. Admin sees all
  // options unlocked regardless of season.
  //   Values: "auto" | "default" | "meteor" | "snow"
  lobbyBackgroundVariant: "auto",
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
