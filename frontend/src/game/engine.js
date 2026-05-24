import * as THREE from "three";
import settingsStore from "@/game/settings";

const SENS_KEY = "virtue.mouseSensitivity";

function _bind(name, fallback) {
  try {
    const kb = settingsStore.get()?.keybinds;
    if (kb && typeof kb[name] === "string" && kb[name]) return kb[name];
  } catch {}
  return fallback;
}
function _ctrlBind(name, fallback) {
  try {
    const cb = settingsStore.get()?.controllerBinds;
    if (cb && Number.isFinite(cb[name])) return cb[name];
  } catch {}
  return fallback;
}

export class GameEngine {
  constructor(canvas, { onState, onLocalUpdate, onShoot } = {}) {
    this.canvas = canvas;
    this.onState = onState || (() => {});
    this.onLocalUpdate = onLocalUpdate || (() => {});
    this.onShoot = onShoot || (() => {});

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ddff6); // sky blue
    this.scene.fog = new THREE.Fog(0xbfe2ff, 70, 130);

    this.camera = new THREE.PerspectiveCamera(78, canvas.clientWidth / canvas.clientHeight, 0.05, 500);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Toon ramp
    const gradient = new Uint8Array([60, 130, 200, 255]);
    this.toonMap = new THREE.DataTexture(gradient, gradient.length, 1, THREE.RedFormat);
    this.toonMap.needsUpdate = true;
    this.toonMap.magFilter = THREE.NearestFilter;
    this.toonMap.minFilter = THREE.NearestFilter;

    // Lights
    this.scene.add(new THREE.HemisphereLight(0xfff2a8, 0x4c7d3a, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(40, 60, 30);
    this.scene.add(sun);
    this._sun = sun;
    // "Ray-Traced Lighting" preset — adds three colored point lights around
    // the arena + enables shadow casting on the sun + bumps the renderer to
    // a higher-quality output tone-mapping curve. Toggled by applySettings.
    // (No actual WebGPU ray tracing — this is the closest we get in WebGL
    // without a custom shader pipeline.)
    this._rtLights = [];
    const RT_LIGHTS = [
      { pos: [25, 12, 25], color: 0xff7a3a }, // warm orange
      { pos: [70, 12, 25], color: 0x66c8ff }, // cool cyan
      { pos: [50, 16, 70], color: 0xff7ed6 }, // magenta accent
    ];
    for (const { pos, color } of RT_LIGHTS) {
      const p = new THREE.PointLight(color, 0, 40, 2);
      p.position.set(...pos);
      p.castShadow = false; // Enabled by applySettings(rayTracedLighting=true)
      this.scene.add(p);
      this._rtLights.push(p);
    }
    this._ambientFill = new THREE.AmbientLight(0xffffff, 0.0);
    this.scene.add(this._ambientFill);

    // Player state
    this.position = new THREE.Vector3(35, 1.8, 35);
    this.yaw = 0;
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;

    // Input
    this.keys = new Set();
    this.locked = false;
    this.pendingShoot = false;
    this.recoil = 0;
    // Local ammo/reload mirror (updated from server state).
    // Used to gate client-side fire prediction so we don't play a muzzle
    // flash + gunshot SFX while reloading or empty.
    this.localAmmo = { ak47: 25, laser: 60 };
    this.localReloading = false;
    // AK reload animation state. _reloadT animates 0→1 across the reload
    // duration; the viewmodel + magazine sub-group are transformed each
    // frame in _update().
    this._reloadT = 0;
    this._reloadDurMs = 1500;
    this._reloadWeapon = null;
    this.localLaserHeat = 0;
    this.localLaserOverheated = false;
    this._laserFireHeld = false;
    this._remoteBeams = new Map(); // shooterId -> {ts, x,y,z,yaw,pitch,hitDist}
    // Jump / vertical physics
    this.vy = 0;
    this.onGround = true;
    // Gamepad
    this._gamepadEnabled = true;
    this._gpPrev = { fire: false, melee: false, jump: false, reload: false, weapon: false, ads: false };
    // Aim assist (gamepad + touch users get a soft snap toward enemies)
    this._aimAssistStrength = 0.6;
    this.touchActive = false;
    this.gamepadConnected = false;
    // Graphics / FPS cap
    this._frameMinMs = 0;
    this._settings = null;

    // Footstep cadence
    this._footAcc = 0;

    // Network state
    this.youId = null;
    this.players = new Map();
    this.bullets = [];

    // World
    this._buildArena();
    this._buildWeapon();
    this._buildLaserBeam();

    // Listeners
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onResize = this._onResize.bind(this);

    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    document.addEventListener("mousedown", this._onMouseDown);
    document.addEventListener("mouseup", this._onMouseUp);
    document.addEventListener("contextmenu", this._onContextMenu);
    window.addEventListener("resize", this._onResize);

    this.lastTime = performance.now();
    this.running = false;
    this._fpsFrames = 0;
    this._fpsLastT = performance.now();
    this.fps = 0;
  }

  getFps() { return this.fps; }

  getSensitivity() {
    const v = parseFloat(localStorage.getItem(SENS_KEY));
    return Number.isFinite(v) && v > 0 ? v : 1.0;
  }
  setSensitivity(v) {
    localStorage.setItem(SENS_KEY, String(v));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this._loop();
  }

  dispose() {
    this.running = false;
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    document.removeEventListener("mousedown", this._onMouseDown);
    document.removeEventListener("mouseup", this._onMouseUp);
    document.removeEventListener("contextmenu", this._onContextMenu);
    window.removeEventListener("resize", this._onResize);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.renderer.dispose();
  }

  requestPointerLock() {
    // Wrapped in try/catch because some preview iframes (Emergent dev) are
    // sandboxed without `allow-pointer-lock` and would otherwise throw a
    // SecurityError that surfaces in the red runtime overlay. On the
    // production app (not in an iframe) this works fine.
    try {
      const p = this.canvas.requestPointerLock?.();
      // Newer browsers return a Promise; swallow its rejection too.
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (err) {
      try {
        window.dispatchEvent(new CustomEvent("virtue-pointerlock-blocked", { detail: { message: String(err?.message || err) } }));
      } catch {}
    }
  }
  _onPointerLockChange() { this.locked = document.pointerLockElement === this.canvas; }
  _onMouseMove(e) {
    if (!this.locked) return;
    const sens = 0.0022 * this.getSensitivity();
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
  }
  _onKeyDown(e) {
    this.keys.add(e.code);
    // Prevent default for the scoreboard binding (don't let TAB blur focus).
    if (e.code === _bind("scoreboard", "Tab")) e.preventDefault();
    // Weapon-digit hotkeys (bindable).
    const order = ["primary", "secondary", "tertiary"];
    if (e.code === _bind("weapon1", "Digit1")) this.setWeapon("primary");
    else if (e.code === _bind("weapon2", "Digit2")) this.setWeapon("secondary");
    else if (e.code === _bind("weapon3", "Digit3")) this.setWeapon("tertiary");
    else if (e.code === _bind("reload", "KeyR")) {
      this.localReloading = true;
      this.onLocalUpdate?.({ type: "reload-pressed" });
    } else if (e.code === _bind("melee", "KeyV") && this.alive && this.locked) {
      this.pendingMelee = true;
      this.pendingMeleeAim = { yaw: this.yaw, pitch: this.pitch };
    } else if (e.code === _bind("adsToggle", "KeyZ")) {
      if (this.currentWeapon !== "secondary") this.setADS(!this.ads);
    }
    // Avoid unused 'order' warning if user never binds digits to existing keys.
    void order;
  }
  _onKeyUp(e) { this.keys.delete(e.code); }

  // True iff a ranged shot is currently allowed (alive + not reloading + has ammo).
  // Katana (secondary) is never gated by ammo/reload.
  _canFireRanged() {
    if (!this.alive) return false;
    if (this.currentWeapon === "secondary") return true;
    if (this.localReloading) return false;
    const w = this.currentWeapon === "tertiary" ? "laser" : "ak47";
    return (this.localAmmo[w] ?? 0) > 0;
  }

  // Try to trigger a shot; if empty, auto-request a reload from the network layer.
  _tryShoot(aimYaw, aimPitch) {
    if (this.currentWeapon === "secondary") {
      // melee path
      this.pendingMelee = true;
      this.pendingMeleeAim = { yaw: aimYaw, pitch: aimPitch };
      return;
    }
    if (this.currentWeapon === "tertiary") {
      // Laser is continuous fire — begin the beam (gated server-side by
      // overheat). The mouse-up handler clears _laserFireHeld.
      this._laserFireHeld = true;
      return;
    }
    if (this.localReloading) return;
    const w = "ak47";
    if ((this.localAmmo[w] ?? 0) <= 0) {
      // Empty — kick off a reload locally and tell the server.
      this.localReloading = true;
      this.onLocalUpdate?.({ type: "reload-pressed" });
      return;
    }
    this.pendingShoot = true;
    this.pendingShootAim = { yaw: aimYaw, pitch: aimPitch };
    // Optimistically decrement local ammo so back-to-back clicks within one
    // 20Hz tick still see an updated value. Server is authoritative.
    this.localAmmo[w] = Math.max(0, (this.localAmmo[w] ?? 0) - 1);
    if (this.localAmmo[w] === 0) {
      // Auto-trigger reload after the last bullet — server will confirm.
      this.localReloading = true;
      // Defer the reload-pressed event so the shot fires first.
      setTimeout(() => this.onLocalUpdate?.({ type: "reload-pressed" }), 40);
    }
  }

  _onMouseDown(e) {
    if (!this.locked || !this.alive) return;
    if (e.button === 2) {
      // Right-click → ADS (only meaningful for primary/laser)
      if (this.currentWeapon !== "secondary") this.setADS(true);
      return;
    }
    this._tryShoot(this.yaw, this.pitch);
  }

  _onMouseUp(e) {
    if (e.button === 2) this.setADS(false);
    if (e.button === 0) this._laserFireHeld = false; // stop continuous beam
  }

  _onContextMenu(e) {
    if (this.locked) e.preventDefault();
  }
  _onResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _toonMat(color) { return new THREE.MeshToonMaterial({ color, gradientMap: this.toonMap }); }

  _outlined(geometry, color, outlineScale = 1.05) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, this._toonMat(color));
    group.add(mesh);
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide });
    const outline = new THREE.Mesh(geometry, outlineMat);
    outline.scale.multiplyScalar(outlineScale);
    group.add(outline);
    return group;
  }

  // -------- Arena --------
  _buildArena() {
    const SIZE = 50;
    // Grass floor
    const floorGeo = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2, 32, 32);
    const grassTex = this._makeGrassTexture();
    const floorMat = new THREE.MeshToonMaterial({ map: grassTex, gradientMap: this.toonMap });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // A few "grass blade" sprite-decals (taller, with wind sway in update())
    const bladeGeo = new THREE.ConeGeometry(0.07, 0.85, 4);
    const bladeMat = this._toonMat(0x4caf50);
    this._grassBlades = [];
    for (let i = 0; i < 280; i++) {
      const b = new THREE.Mesh(bladeGeo, bladeMat);
      b.position.set((Math.random() - 0.5) * SIZE * 2, 0.42, (Math.random() - 0.5) * SIZE * 2);
      b.rotation.y = Math.random() * Math.PI;
      // Per-blade wind data: base lean (Z-rotation), phase offset, sway amount.
      b.userData.windPhase = Math.random() * Math.PI * 2;
      b.userData.windAmount = 0.12 + Math.random() * 0.10;  // radians
      b.userData.baseY = b.position.y;
      this.scene.add(b);
      this._grassBlades.push(b);
    }

    // Outer walls — themed comic-style brick walls with yellow/red trim,
    // posts at intervals, and a pop-art halftone overlay.
    const WALL_BG = 0x1A1A2E;        // dark navy panels
    const WALL_TRIM = 0xFFD700;      // yellow comic trim
    const WALL_ACCENT = 0xE62429;    // red accent stripe
    const wallH = 6;
    const wallT = 1.2;
    const buildWall = (x, z, w, d, horizontal) => {
      const group = new THREE.Group();
      // Main wall slab
      const slab = this._outlined(new THREE.BoxGeometry(w, wallH, d), WALL_BG, 1.02);
      slab.position.set(0, wallH / 2, 0);
      group.add(slab);
      // Bright top trim (top 0.45m)
      const trimGeo = new THREE.BoxGeometry(w + 0.05, 0.5, d + 0.05);
      const trim = new THREE.Mesh(trimGeo, this._toonMat(WALL_TRIM));
      trim.position.set(0, wallH - 0.25, 0);
      group.add(trim);
      // Mid red accent stripe (at ~head height)
      const accentGeo = new THREE.BoxGeometry(w + 0.04, 0.25, d + 0.04);
      const accent = new THREE.Mesh(accentGeo, this._toonMat(WALL_ACCENT));
      accent.position.set(0, wallH * 0.55, 0);
      group.add(accent);
      // Posts every ~10m (vertical pillars). Post cross-section spans the
      // wall thickness (NOT its length) so it doesn't blanket the map.
      const span = horizontal ? w : d;
      const numPosts = Math.max(2, Math.floor(span / 10));
      const postMat = this._toonMat(0x0A0A0A);
      const postSizeX = horizontal ? 0.5 : w + 0.4;  // along wall thickness for vertical walls
      const postSizeZ = horizontal ? d + 0.4 : 0.5;  // along wall thickness for horizontal walls
      for (let i = 0; i <= numPosts; i++) {
        const t = (i / numPosts) - 0.5;
        const px = horizontal ? t * span : 0;
        const pz = horizontal ? 0 : t * span;
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(postSizeX, wallH + 0.4, postSizeZ),
          postMat,
        );
        post.position.set(px, (wallH + 0.4) / 2, pz);
        group.add(post);
      }
      group.position.set(x, 0, z);
      this.scene.add(group);
    };
    buildWall(0, -SIZE - wallT / 2, SIZE * 2 + wallT * 2, wallT, true);
    buildWall(0, SIZE + wallT / 2, SIZE * 2 + wallT * 2, wallT, true);
    buildWall(-SIZE - wallT / 2, 0, wallT, SIZE * 2, false);
    buildWall(SIZE + wallT / 2, 0, wallT, SIZE * 2, false);

    // Buildings (matches server obstacle list)
    this.obstacles = [
      { x: 0, z: 0, w: 6, h: 8, d: 6, color: 0xb84a3a },
      { x: 9, z: 0, w: 3, h: 1.2, d: 3, color: 0xffd700 },
      { x: -9, z: 0, w: 3, h: 1.2, d: 3, color: 0xffd700 },
      { x: 0, z: 9, w: 3, h: 1.2, d: 3, color: 0xffd700 },
      { x: 0, z: -9, w: 3, h: 1.2, d: 3, color: 0xffd700 },

      { x: 18, z: 14, w: 4, h: 3, d: 8, color: 0xc94a4f },
      { x: 26, z: 24, w: 6, h: 4, d: 3, color: 0x386bbf },
      { x: 14, z: 28, w: 3, h: 5, d: 3, color: 0xd9aa3c },
      { x: 30, z: 12, w: 3, h: 3, d: 5, color: 0xb84a3a },

      { x: -18, z: -14, w: 8, h: 3, d: 4, color: 0xc94a4f },
      { x: -26, z: -24, w: 3, h: 4, d: 8, color: 0x386bbf },
      { x: -10, z: -28, w: 6, h: 3, d: 3, color: 0xd9aa3c },
      { x: -30, z: -12, w: 3, h: 3, d: 5, color: 0x386bbf },

      { x: -18, z: 14, w: 4, h: 5, d: 4, color: 0x386bbf },
      { x: -28, z: 20, w: 3, h: 4, d: 6, color: 0xc94a4f },
      { x: -5, z: 22, w: 10, h: 3, d: 3, color: 0xd9aa3c },
      { x: -32, z: 5, w: 3, h: 4, d: 4, color: 0xb84a3a },

      { x: 20, z: -18, w: 6, h: 4, d: 4, color: 0xd9aa3c },
      { x: 28, z: -22, w: 3, h: 5, d: 8, color: 0x386bbf },
      { x: 8, z: -22, w: 3, h: 6, d: 3, color: 0xc94a4f },
      { x: 32, z: -5, w: 3, h: 4, d: 4, color: 0x386bbf },

      { x: -35, z: 30, w: 8, h: 4, d: 2, color: 0x4a4a4a },
      { x: 35, z: -30, w: 8, h: 4, d: 2, color: 0x4a4a4a },
      { x: -38, z: -35, w: 2, h: 4, d: 8, color: 0x4a4a4a },
      { x: 38, z: 35, w: 2, h: 4, d: 8, color: 0x4a4a4a },

      // crates
      { x: 4, z: 14, w: 1.6, h: 1.6, d: 1.6, color: 0xff7b00, crate: true },
      { x: -4, z: -14, w: 1.6, h: 1.6, d: 1.6, color: 0xff7b00, crate: true },
      { x: 14, z: -4, w: 1.6, h: 1.6, d: 1.6, color: 0xff7b00, crate: true },
      { x: -14, z: 4, w: 1.6, h: 1.6, d: 1.6, color: 0xff7b00, crate: true },
    ];

    this.obstacles.forEach((ob) => this._buildBuilding(ob));

    // Center floating "VIRTUE" sign
    const signCanvas = document.createElement("canvas");
    signCanvas.width = 256; signCanvas.height = 96;
    const sc = signCanvas.getContext("2d");
    sc.fillStyle = "#FFD700"; sc.fillRect(0, 0, 256, 96);
    sc.strokeStyle = "#0A0A0A"; sc.lineWidth = 8; sc.strokeRect(4, 4, 248, 88);
    sc.font = "bold 64px Bangers, Anton, sans-serif";
    sc.fillStyle = "#E62429"; sc.textAlign = "center"; sc.textBaseline = "middle";
    sc.strokeStyle = "#0A0A0A"; sc.lineWidth = 4;
    sc.strokeText("VIRTUE", 128, 50);
    sc.fillText("VIRTUE", 128, 50);
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide }));
    sign.position.set(0, 11, 0);
    this.scene.add(sign);
    this._sign = sign;

    // Sky dome — vertical gradient texture (deep blue → warm horizon) baked
    // onto a sphere. Adds depth without breaking the comic flat-shading.
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 8; skyCanvas.height = 256;
    const skc = skyCanvas.getContext("2d");
    const grd = skc.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0.00, "#1E2A6A");   // zenith — deep navy
    grd.addColorStop(0.35, "#3F6FCC");   // mid sky — comic blue
    grd.addColorStop(0.68, "#9DDFF6");   // pale blue
    grd.addColorStop(0.88, "#FFD89C");   // warm horizon
    grd.addColorStop(1.00, "#FF7B7B");   // sunset glow at the bottom rim
    skc.fillStyle = grd; skc.fillRect(0, 0, 8, 256);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(140, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false }),
    );
    this.scene.add(sky);
    // Sun — bright yellow disc with a halo
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(7, 24),
      new THREE.MeshBasicMaterial({ color: 0xFFE680 }),
    );
    sun.position.set(-60, 38, -100);
    sun.lookAt(0, 30, 0);
    this.scene.add(sun);
    const sunHalo = new THREE.Mesh(
      new THREE.CircleGeometry(10, 24),
      new THREE.MeshBasicMaterial({ color: 0xFFC857, transparent: true, opacity: 0.45 }),
    );
    sunHalo.position.copy(sun.position).multiplyScalar(0.995);
    sunHalo.lookAt(0, 30, 0);
    this.scene.add(sunHalo);
    // Clouds — varied sizes + multi-puff shapes (drift slowly each frame).
    const cloudMat = this._toonMat(0xffffff);
    this._clouds = [];
    for (let i = 0; i < 22; i++) {
      const cluster = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const r = 1.6 + Math.random() * 2.2;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), cloudMat);
        puff.position.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 5);
        cluster.add(puff);
      }
      cluster.position.set((Math.random() - 0.5) * 160, 22 + Math.random() * 14, (Math.random() - 0.5) * 160);
      // Drift speed: 0.6 to 1.4 units/sec in a consistent direction.
      cluster.userData.driftX = 0.6 + Math.random() * 0.8;
      cluster.userData.bob = Math.random() * Math.PI * 2;
      this.scene.add(cluster);
      this._clouds.push(cluster);
    }
    // Distant birds — tiny V-shaped sprites that fly across the sky in a
    // wide arc, and flap their wings every ~0.25s for life.
    this._birds = [];
    for (let i = 0; i < 6; i++) {
      const bird = new THREE.Group();
      const wm = this._toonMat(0x0A0A0A);
      const lw = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.1), wm);
      lw.rotation.z = 0.45;
      lw.position.x = -0.3;
      const rw = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.1), wm);
      rw.rotation.z = -0.45;
      rw.position.x = 0.3;
      bird.add(lw); bird.add(rw);
      bird.position.set(-40 + i * 12, 28 + (i % 2) * 3, -50 - (i % 3) * 6);
      // Animate state: heading angle, speed, flap phase. We'll loop them
      // around the arena center on a big slow circle so they're always
      // visible somewhere.
      bird.userData.angle = (i / 6) * Math.PI * 2;
      bird.userData.radius = 60 + (i % 3) * 10;
      bird.userData.height = 26 + (i % 2) * 4;
      bird.userData.speed = 0.18 + (i % 3) * 0.04; // rad/sec
      bird.userData.flapPhase = Math.random() * Math.PI * 2;
      bird.userData.flapHz = 6 + (i % 3) * 0.7;
      bird.userData.lw = lw;
      bird.userData.rw = rw;
      this.scene.add(bird);
      this._birds.push(bird);
    }

    // ===== Decorative non-collidable map detail =====
    // Trees scattered in safe zones
    const treeSpots = [
      [22, 22], [-22, 22], [22, -22], [-22, -22],
      [40, 40], [-40, 40], [40, -40], [-40, -40],
      [0, 42], [0, -42], [42, 0], [-42, 0],
      [14, 8], [-14, -8],
    ];
    treeSpots.forEach(([x, z]) => {
      const trunk = this._outlined(new THREE.CylinderGeometry(0.18, 0.22, 1.4, 8), 0x5a3722, 1.06);
      trunk.position.set(x, 0.7, z);
      this.scene.add(trunk);
      const foliage = this._outlined(new THREE.SphereGeometry(0.85, 10, 8), 0x3aa84a, 1.06);
      foliage.position.set(x, 1.8, z);
      this.scene.add(foliage);
    });

    // Lampposts at strategic spots
    const lampSpots = [[12, 12], [-12, 12], [12, -12], [-12, -12]];
    lampSpots.forEach(([x, z]) => {
      const pole = this._outlined(new THREE.CylinderGeometry(0.08, 0.08, 3.8, 8), 0x2a2a2a, 1.08);
      pole.position.set(x, 1.9, z);
      this.scene.add(pole);
      const head = this._outlined(new THREE.BoxGeometry(0.4, 0.25, 0.4), 0x0a0a0a, 1.06);
      head.position.set(x, 3.85, z);
      this.scene.add(head);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2a8 }));
      bulb.position.set(x, 3.7, z);
      this.scene.add(bulb);
    });

    // Park benches near trees
    const benchSpots = [[22, 19, 0], [-22, 19, Math.PI / 2], [22, -19, Math.PI], [-22, -19, -Math.PI / 2]];
    benchSpots.forEach(([x, z, rot]) => {
      const benchGroup = new THREE.Group();
      const seat = this._outlined(new THREE.BoxGeometry(1.6, 0.12, 0.4), 0x6b4226, 1.05);
      seat.position.y = 0.4;
      benchGroup.add(seat);
      const back = this._outlined(new THREE.BoxGeometry(1.6, 0.45, 0.08), 0x6b4226, 1.05);
      back.position.set(0, 0.65, -0.18);
      benchGroup.add(back);
      const lL = this._outlined(new THREE.BoxGeometry(0.1, 0.4, 0.4), 0x0a0a0a, 1.05);
      lL.position.set(-0.75, 0.2, 0); benchGroup.add(lL);
      const lR = this._outlined(new THREE.BoxGeometry(0.1, 0.4, 0.4), 0x0a0a0a, 1.05);
      lR.position.set(0.75, 0.2, 0); benchGroup.add(lR);
      benchGroup.position.set(x, 0, z);
      benchGroup.rotation.y = rot;
      this.scene.add(benchGroup);
    });

    // Floor decals: POW / BAM painted patches at spawn points
    const decalSpots = [
      { x: 35, z: 35, t: "POW!", c: "#E62429" },
      { x: -35, z: 35, t: "ZAP!", c: "#FFD700" },
      { x: 35, z: -35, t: "BOOM!", c: "#0055FF" },
      { x: -35, z: -35, t: "BAM!", c: "#9D4EDD" },
    ];
    decalSpots.forEach(({ x, z, t, c }) => {
      const cv = document.createElement("canvas");
      cv.width = 256; cv.height = 128;
      const cx = cv.getContext("2d");
      cx.clearRect(0, 0, 256, 128);
      cx.font = "bold 84px Bangers, Anton, sans-serif";
      cx.fillStyle = c;
      cx.strokeStyle = "#0A0A0A";
      cx.lineWidth = 8;
      cx.textAlign = "center";
      cx.textBaseline = "middle";
      cx.strokeText(t, 128, 64);
      cx.fillText(t, 128, 64);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(x, 0.04, z);
      this.scene.add(plane);
    });

    // Central statue plinth (decorative, fits inside central tower)
    const plinth = this._outlined(new THREE.CylinderGeometry(1.2, 1.4, 0.5, 12), 0xd9aa3c, 1.05);
    plinth.position.set(0, 8.3, 0); // on top of central tower
    this.scene.add(plinth);
    const statue = this._outlined(new THREE.ConeGeometry(0.6, 1.4, 8), 0xc94a4f, 1.06);
    statue.position.set(0, 9.4, 0);
    this.scene.add(statue);

    // ===== Roads (asphalt strips with dashed lines) =====
    const roadMat = this._toonMat(0x303237);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const buildRoad = (x, z, w, l, rotY = 0) => {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(w, l), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = rotY;
      road.position.set(x, 0.03, z);
      this.scene.add(road);
      // Dashed center line
      const dashLen = 1.4;
      const dashes = Math.floor(l / (dashLen * 1.8));
      for (let i = 0; i < dashes; i++) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(0.18, dashLen), dashMat);
        d.rotation.x = -Math.PI / 2;
        const offset = (i - dashes / 2 + 0.5) * (dashLen * 1.8);
        // Rotate offset into world coords
        const c = Math.cos(rotY), s = Math.sin(rotY);
        d.position.set(x + (-s) * offset, 0.04, z + c * offset);
        d.rotation.z = rotY;
        this.scene.add(d);
      }
    };
    // Cross of roads through the map (avoiding center tower)
    buildRoad(0, 25, 4, 50);
    buildRoad(0, -25, 4, 50);
    buildRoad(25, 0, 4, 50, Math.PI / 2);
    buildRoad(-25, 0, 4, 50, Math.PI / 2);

    // ===== Driveways — small road segments connecting major buildings to
    // the main cross-roads, so the streetscape doesn't look stranded. =====
    const driveMat = this._toonMat(0x3a3d44); // lighter asphalt
    const buildDrive = (x1, z1, x2, z2, w = 2.4) => {
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) return;
      const ang = Math.atan2(dx, dz);
      const drive = new THREE.Mesh(new THREE.PlaneGeometry(w, len), driveMat);
      drive.rotation.x = -Math.PI / 2;
      drive.rotation.z = ang;
      drive.position.set((x1 + x2) / 2, 0.035, (z1 + z2) / 2);
      this.scene.add(drive);
      // Curb stripes on both edges
      const stripeMat = this._toonMat(0xFFFFFF);
      for (const side of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.08, len), stripeMat);
        s.rotation.x = -Math.PI / 2;
        s.rotation.z = ang;
        const px = -Math.cos(ang) * (w / 2 - 0.1) * side;
        const pz = Math.sin(ang) * (w / 2 - 0.1) * side;
        s.position.set((x1 + x2) / 2 + px, 0.038, (z1 + z2) / 2 + pz);
        this.scene.add(s);
      }
    };
    // Connect the four cardinal road-spurs (roads run at z = ±25, x = ±25)
    // to nearby buildings + the corner plazas.
    const driveways = [
      // From east road (x=25) to east-side buildings
      [25, 0, 30, 12],
      [25, 0, 30, -12],
      // From west road (x=-25) to west-side
      [-25, 0, -30, 12],
      [-25, 0, -30, -12],
      // From north road (z=25) toward north-east cluster
      [0, 25, 14, 28],
      [0, 25, -10, 28],
      [0, 25, 18, 14],
      [0, 25, -18, 14],
      // From south road (z=-25)
      [0, -25, 14, -28],
      [0, -25, -10, -28],
      [0, -25, 20, -18],
      [0, -25, -18, -14],
      // Corner plaza driveways
      [25, 25, 35, 35],
      [-25, 25, -35, 35],
      [25, -25, 35, -35],
      [-25, -25, -35, -35],
    ];
    driveways.forEach(([x1, z1, x2, z2]) => buildDrive(x1, z1, x2, z2));

    // ===== Extra perimeter / corner buildings — now collidable (server has
    // matching entries in ARENA.obstacles so bots & shot raycasts agree). =====
    const extras = [
      { x: 42, z: 42, w: 5, h: 6, d: 5, color: 0xc94a4f },
      { x: -42, z: 42, w: 5, h: 7, d: 5, color: 0x386bbf },
      { x: 42, z: -42, w: 5, h: 5, d: 5, color: 0xd9aa3c },
      { x: -42, z: -42, w: 5, h: 8, d: 5, color: 0x4a4a4a },
      { x: 12, z: 38, w: 3, h: 4, d: 6, color: 0x386bbf },
      { x: -12, z: 38, w: 3, h: 5, d: 6, color: 0xc94a4f },
      { x: 12, z: -38, w: 3, h: 5, d: 6, color: 0xd9aa3c },
      { x: -12, z: -38, w: 3, h: 4, d: 6, color: 0x386bbf },
      { x: 38, z: 12, w: 6, h: 4, d: 3, color: 0xd9aa3c },
      { x: 38, z: -12, w: 6, h: 5, d: 3, color: 0xc94a4f },
      { x: -38, z: 12, w: 6, h: 4, d: 3, color: 0xc94a4f },
      { x: -38, z: -12, w: 6, h: 6, d: 3, color: 0x386bbf },
    ];
    extras.forEach((ob) => {
      this._buildBuilding(ob);
      this.obstacles.push(ob); // ensure client collision matches server
    });

    // Fire hydrants on roads (just decorative)
    [[8, 24], [-8, 24], [8, -24], [-8, -24], [24, 8], [-24, 8]].forEach(([x, z]) => {
      const cap = this._outlined(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8), 0xe62429, 1.06);
      cap.position.set(x, 0.3, z);
      this.scene.add(cap);
      const top = this._outlined(new THREE.SphereGeometry(0.16, 8, 6), 0xe62429, 1.08);
      top.position.set(x, 0.7, z);
      this.scene.add(top);
    });
  }

  _makeGrassTexture() {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#5fb04a";
    ctx.fillRect(0, 0, 128, 128);
    // sparse darker blades
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = i % 3 === 0 ? "#4a9239" : "#6cc04f";
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      ctx.fillRect(x, y, 2, 4);
    }
    // some yellow flecks
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = "#ffeb6e";
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      ctx.fillRect(x, y, 2, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(20, 20);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildBuilding(ob) {
    const g = new THREE.Group();
    const body = this._outlined(new THREE.BoxGeometry(ob.w, ob.h, ob.d), ob.color);
    g.add(body);
    g.position.set(ob.x, ob.h / 2, ob.z);

    if (!ob.crate && ob.h >= 2.5) {
      // Add windows and roof line as flat painted planes on each face
      const faceTex = this._makeBuildingFaceTexture(ob);
      // 4 side faces
      const planeMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true });
      const addFace = (w, h, x, y, z, rotY) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), planeMat);
        m.position.set(x, y, z);
        m.rotation.y = rotY;
        g.add(m);
      };
      // Front (+z), back (-z), right (+x), left (-x). Slight offset to avoid z-fight.
      const e = 0.011;
      addFace(ob.w * 0.96, ob.h * 0.96, 0, 0, ob.d / 2 + e, 0);
      addFace(ob.w * 0.96, ob.h * 0.96, 0, 0, -ob.d / 2 - e, Math.PI);
      addFace(ob.d * 0.96, ob.h * 0.96, ob.w / 2 + e, 0, 0, Math.PI / 2);
      addFace(ob.d * 0.96, ob.h * 0.96, -ob.w / 2 - e, 0, 0, -Math.PI / 2);

      // Roof cap (darker)
      const roof = this._outlined(new THREE.BoxGeometry(ob.w + 0.4, 0.3, ob.d + 0.4), 0x2a2a2a, 1.03);
      roof.position.y = ob.h / 2 + 0.15;
      g.add(roof);
    }

    this.scene.add(g);
  }

  _makeBuildingFaceTexture(ob) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 256, 256);
    // Border outline
    ctx.strokeStyle = "#0A0A0A";
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, 248, 248);
    // Windows in 2x2 grid
    const cols = ob.h > 5 ? 3 : 2;
    const rows = ob.h > 5 ? 3 : 2;
    const margin = 32;
    const cellW = (256 - margin * 2) / cols;
    const cellH = (256 - margin * 2 - 40) / rows;
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const x = margin + cIdx * cellW + cellW * 0.18;
        const y = margin + r * cellH + cellH * 0.2;
        const w = cellW * 0.64;
        const h = cellH * 0.6;
        // Window frame
        ctx.fillStyle = "#0A0A0A";
        ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
        // Glass — yellow lit
        ctx.fillStyle = (r + cIdx) % 2 === 0 ? "#FFD700" : "#FFE680";
        ctx.fillRect(x, y, w, h);
        // Cross frame
        ctx.fillStyle = "#0A0A0A";
        ctx.fillRect(x + w / 2 - 1.5, y, 3, h);
        ctx.fillRect(x, y + h / 2 - 1.5, w, 3);
      }
    }
    // Door at bottom center (if tall enough)
    if (ob.h >= 3) {
      const dw = 50, dh = 70;
      const dx = 128 - dw / 2;
      const dy = 256 - dh - 12;
      ctx.fillStyle = "#0A0A0A";
      ctx.fillRect(dx - 4, dy - 4, dw + 8, dh + 8);
      ctx.fillStyle = "#5a3722";
      ctx.fillRect(dx, dy, dw, dh);
      // handle
      ctx.fillStyle = "#FFD700";
      ctx.fillRect(dx + dw - 12, dy + dh / 2 - 3, 6, 6);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // -------- Weapon (FPS held) --------
  _buildWeapon() {
    // Container that holds both primary (AK-47) and secondary (katana)
    const root = new THREE.Group();

    // ===== AK-47 =====
    const ak = new THREE.Group();
    // Wood stock (rear, slanted down)
    const stock = this._outlined(new THREE.BoxGeometry(0.13, 0.16, 0.5), 0x6b4226);
    stock.position.set(0, -0.04, 0.18);
    stock.rotation.x = 0.08;
    ak.add(stock);
    // Receiver (dark steel)
    const receiver = this._outlined(new THREE.BoxGeometry(0.16, 0.16, 0.5), 0x2a2a2a);
    receiver.position.set(0, 0.0, -0.24);
    ak.add(receiver);
    // Gas tube on top
    const gasTube = this._outlined(new THREE.BoxGeometry(0.1, 0.06, 0.5), 0x6b4226);
    gasTube.position.set(0, 0.13, -0.24);
    ak.add(gasTube);
    // Front handguard (wood)
    const handGuard = this._outlined(new THREE.BoxGeometry(0.14, 0.13, 0.32), 0x6b4226);
    handGuard.position.set(0, -0.02, -0.55);
    ak.add(handGuard);
    // Long barrel
    const barrel = this._outlined(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 14), 0x111111, 1.08);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.95);
    ak.add(barrel);
    // Muzzle brake (slotted)
    const muzzle = this._outlined(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 10), 0x0a0a0a, 1.1);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.03, -1.25);
    ak.add(muzzle);
    // Banana magazine (curved → approximate w/ two angled boxes).
    // Grouped so it can be animated separately during reload.
    const akMag = new THREE.Group();
    const magTop = this._outlined(new THREE.BoxGeometry(0.1, 0.18, 0.16), 0x3a2510);
    magTop.position.set(0, -0.18, -0.18);
    akMag.add(magTop);
    const magBot = this._outlined(new THREE.BoxGeometry(0.1, 0.18, 0.14), 0x3a2510);
    magBot.position.set(0, -0.34, -0.08);
    magBot.rotation.x = -0.5;
    akMag.add(magBot);
    ak.add(akMag);
    this._akMagGroup = akMag;
    this._akMagBaseY = 0;
    this._akMagBaseZ = 0;
    // Grip (angled)
    const grip = this._outlined(new THREE.BoxGeometry(0.1, 0.22, 0.13), 0x3a2510);
    grip.position.set(0, -0.18, 0.02);
    grip.rotation.x = -0.32;
    ak.add(grip);
    // Front sight
    const fs = this._outlined(new THREE.BoxGeometry(0.025, 0.09, 0.04), 0x0a0a0a, 1.12);
    fs.position.set(0, 0.18, -1.08);
    ak.add(fs);
    // Rear sight
    const rs = this._outlined(new THREE.BoxGeometry(0.12, 0.04, 0.05), 0x0a0a0a, 1.1);
    rs.position.set(0, 0.18, -0.05);
    ak.add(rs);
    // Trigger
    const trigger = this._outlined(new THREE.BoxGeometry(0.03, 0.06, 0.04), 0xc0c0c0, 1.12);
    trigger.position.set(0, -0.1, -0.05);
    ak.add(trigger);
    // Hand
    const hand = this._outlined(new THREE.SphereGeometry(0.13, 12, 8), 0xf2c08a, 1.08);
    hand.position.set(0, -0.07, 0.02);
    ak.add(hand);
    // Forward hand on handguard
    const lh = this._outlined(new THREE.SphereGeometry(0.12, 10, 8), 0xf2c08a, 1.08);
    lh.position.set(0, -0.05, -0.55);
    ak.add(lh);
    // Muzzle flash sprite
    const flashTex = this._makeFlashTexture();
    const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, opacity: 0 });
    const flash = new THREE.Sprite(flashMat);
    flash.scale.set(0.85, 0.85, 1);
    flash.position.set(0, 0.03, -1.32);
    ak.add(flash);
    this._muzzleFlash = flash;

    // ===== Katana =====
    const kat = new THREE.Group();
    // Tsuka (handle) wrap
    const tsuka = this._outlined(new THREE.CylinderGeometry(0.04, 0.04, 0.32, 8), 0x2a1a0a, 1.1);
    tsuka.rotation.z = Math.PI / 2;
    tsuka.position.set(0.05, -0.06, 0.12);
    kat.add(tsuka);
    // Tsuba (guard, golden disk)
    const tsuba = this._outlined(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 16), 0xffd700, 1.1);
    tsuba.rotation.z = Math.PI / 2;
    tsuba.position.set(-0.12, -0.04, 0.0);
    kat.add(tsuba);
    // Blade — long thin box with slight curve via two segments
    const bladeA = this._outlined(new THREE.BoxGeometry(0.7, 0.05, 0.05), 0xe8eef5, 1.04);
    bladeA.position.set(-0.5, 0.02, -0.25);
    bladeA.rotation.y = 0.08;
    kat.add(bladeA);
    const bladeB = this._outlined(new THREE.BoxGeometry(0.6, 0.05, 0.05), 0xe8eef5, 1.04);
    bladeB.position.set(-1.05, 0.06, -0.55);
    bladeB.rotation.y = 0.18;
    kat.add(bladeB);
    // Blade tip
    const tip = this._outlined(new THREE.ConeGeometry(0.045, 0.18, 6), 0xe8eef5, 1.06);
    tip.rotation.z = Math.PI / 2;
    tip.rotation.y = 0.18;
    tip.position.set(-1.42, 0.07, -0.65);
    kat.add(tip);
    // Hand on tsuka
    const khand = this._outlined(new THREE.SphereGeometry(0.13, 10, 8), 0xf2c08a, 1.08);
    khand.position.set(0.05, -0.08, 0.05);
    kat.add(khand);

    // Position weapons
    ak.position.set(0.22, -0.18, -0.05);
    ak.rotation.y = -0.05;
    kat.position.set(0.22, -0.18, -0.05);
    kat.visible = false; // start with AK

    root.add(ak); root.add(kat);

    // ===== Laser Rifle =====
    const laser = new THREE.Group();
    // Main body (sleek dark)
    const lBody = this._outlined(new THREE.BoxGeometry(0.16, 0.18, 0.6), 0x202833);
    lBody.position.set(0, 0.02, -0.36);
    laser.add(lBody);
    // Glowing core stripe (blue)
    const lCore = this._outlined(new THREE.BoxGeometry(0.12, 0.04, 0.5), 0x00cfff, 1.04);
    lCore.position.set(0, 0.08, -0.36);
    laser.add(lCore);
    // Long emitter barrel
    const lBarrel = this._outlined(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 12), 0x111111, 1.08);
    lBarrel.rotation.x = Math.PI / 2;
    lBarrel.position.set(0, 0.02, -0.95);
    laser.add(lBarrel);
    // Emitter ring (glow)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 6, 16), new THREE.MeshBasicMaterial({ color: 0x00d8ff }));
    ring.rotation.y = Math.PI / 2;
    ring.position.set(0, 0.02, -1.22);
    laser.add(ring);
    // Tip
    const lTip = this._outlined(new THREE.ConeGeometry(0.055, 0.12, 10), 0x00cfff, 1.1);
    lTip.rotation.x = -Math.PI / 2;
    lTip.position.set(0, 0.02, -1.3);
    laser.add(lTip);
    // Track tintable parts so we can flash them red when overheated.
    this._laserGlowParts = [lCore, ring, lTip];
    // Heat-vent puff — a small additive sprite that pulses when overheated.
    const heatGeom = new THREE.SphereGeometry(0.12, 10, 8);
    const heatMat = new THREE.MeshBasicMaterial({
      color: 0xff4422,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const heatPuff = new THREE.Mesh(heatGeom, heatMat);
    heatPuff.position.set(0.0, 0.12, -0.55);
    laser.add(heatPuff);
    this._laserHeatPuff = heatPuff;
    // Grip
    const lGrip = this._outlined(new THREE.BoxGeometry(0.1, 0.22, 0.13), 0x1a1a1a);
    lGrip.position.set(0, -0.18, 0.02);
    lGrip.rotation.x = -0.3;
    laser.add(lGrip);
    // Mag (glowing battery)
    const lMag = this._outlined(new THREE.BoxGeometry(0.1, 0.16, 0.16), 0x00d8ff, 1.06);
    lMag.position.set(0, -0.2, -0.2);
    laser.add(lMag);
    // Hand
    const lHand = this._outlined(new THREE.SphereGeometry(0.13, 12, 8), 0xf2c08a, 1.08);
    lHand.position.set(0, -0.07, 0.02);
    laser.add(lHand);

    laser.position.set(0.22, -0.18, -0.05);
    laser.rotation.y = -0.05;
    laser.visible = false;
    root.add(laser);

    this._tertiaryGroup = laser;
    this._weapon = ak;
    this._primaryGroup = ak;
    this._secondaryGroup = kat;
    this.currentWeapon = "primary";
    this.meleeSwing = 0; // 0..1

    this.camera.add(root);
    this.scene.add(this.camera);
  }

  /* Persistent laser-beam mesh — one shared cylinder is positioned/scaled
     every frame from the camera to the first obstacle/player. Cheaper than
     spawning a new tracer each tick + lets us animate a smooth core. */
  _buildLaserBeam() {
    // Use a unit cylinder (height=1, radius=1) and scale per-frame.
    const geom = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    geom.translate(0, 0.5, 0); // base at origin, extends along +Y
    const outer = new THREE.MeshBasicMaterial({
      color: 0x00e8ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const core = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._beamOuter = new THREE.Mesh(geom, outer);
    this._beamCore = new THREE.Mesh(geom, core);
    this._beamOuter.visible = false;
    this._beamCore.visible = false;
    // Beams aren't camera-children — we position them in world space so they
    // start from the muzzle and end at the impact point. Adding to scene
    // means they're rendered after camera-attached weapon view-model too.
    this.scene.add(this._beamOuter);
    this.scene.add(this._beamCore);
  }

  /* Cast a ray against arena obstacles + other players (capsule approx) and
     return [endPoint, distance]. Mirrors the server's hit-scan distance so
     the beam visually terminates where the damage would land. */
  _laserCastEnd(originVec, dirVec) {
    const MAX = 80;
    let bestT = MAX;
    // Obstacles (AABB) — reuse arena data if available.
    const arena = this._arena;
    if (arena && arena.obstacles) {
      for (const ob of arena.obstacles) {
        const minx = ob.x - ob.w / 2, maxx = ob.x + ob.w / 2;
        const miny = 0, maxy = ob.h;
        const minz = ob.z - ob.d / 2, maxz = ob.z + ob.d / 2;
        let tmin = 0, tmax = bestT;
        const slabs = [
          [originVec.x, dirVec.x, minx, maxx],
          [originVec.y, dirVec.y, miny, maxy],
          [originVec.z, dirVec.z, minz, maxz],
        ];
        let hit = true;
        for (const [o, d, lo, hi] of slabs) {
          if (Math.abs(d) < 1e-6) {
            if (o < lo || o > hi) { hit = false; break; }
          } else {
            let t1 = (lo - o) / d, t2 = (hi - o) / d;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) { hit = false; break; }
          }
        }
        if (hit && tmin >= 0 && tmin < bestT) bestT = tmin;
      }
    }
    // Players (sphere approximation around torso)
    for (const entry of this.players.values()) {
      if (!entry || !entry.mesh) continue;
      const m = new THREE.Vector3(
        originVec.x - entry.mesh.position.x,
        originVec.y - (entry.mesh.position.y + 1.05),
        originVec.z - entry.mesh.position.z,
      );
      const b = m.x * dirVec.x + m.y * dirVec.y + m.z * dirVec.z;
      const c = m.x * m.x + m.y * m.y + m.z * m.z - 0.85 * 0.85;
      const disc = b * b - c;
      if (disc < 0) continue;
      let t = -b - Math.sqrt(disc);
      if (t < 0) t = -b + Math.sqrt(disc);
      if (t >= 0 && t < bestT) bestT = t;
    }
    return bestT;
  }

  /* Position the persistent laser-beam cylinders for this frame.
     Returns true if the beam is active and visible. */
  _updateLaserBeamVisual() {
    const active = this.currentWeapon === "tertiary"
      && this._laserFireHeld
      && this.alive
      && !this.localLaserOverheated
      && !this.isSpectator;
    if (!this._beamOuter || !this._beamCore) return false;
    // Emit start/stop edge events so audio + HUD react crisply.
    if (active !== this._beamAudioActive) {
      this._beamAudioActive = active;
      this.onLocalUpdate?.({ type: active ? "laser-beam-start" : "laser-beam-stop" });
    }
    if (!active) {
      this._beamOuter.visible = false;
      this._beamCore.visible = false;
      return false;
    }
    // Origin: a bit forward of the camera so it appears to leave the gun barrel
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, "YXZ")
    );
    const origin = new THREE.Vector3().copy(this.position).add(forward.clone().multiplyScalar(0.6));
    const dist = this._laserCastEnd(origin, forward);
    // Orient cylinder along +Y by default, so rotate to match `forward`.
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, forward);
    const t = performance.now() * 0.012;
    const pulse = 0.85 + 0.15 * Math.sin(t);
    for (const m of [this._beamOuter, this._beamCore]) {
      m.position.copy(origin);
      m.quaternion.copy(quat);
      m.visible = true;
    }
    // Outer glow radius pulses; core stays thin.
    this._beamOuter.scale.set(0.13 * pulse, dist, 0.13 * pulse);
    this._beamCore.scale.set(0.045, dist, 0.045);
    return true;
  }

  setWeapon(name) {
    if (name !== "primary" && name !== "secondary" && name !== "tertiary") return;
    // Stop the laser beam if we switch away from tertiary.
    if (this.currentWeapon === "tertiary" && name !== "tertiary") {
      this._laserFireHeld = false;
    }
    this.currentWeapon = name;
    if (this._primaryGroup) this._primaryGroup.visible = name === "primary";
    if (this._secondaryGroup) this._secondaryGroup.visible = name === "secondary";
    if (this._tertiaryGroup) this._tertiaryGroup.visible = name === "tertiary";
    if (name === "primary") this._weapon = this._primaryGroup;
    else if (name === "secondary") this._weapon = this._secondaryGroup;
    else this._weapon = this._tertiaryGroup;
  }

  setADS(on) {
    this.ads = !!on;
    const targetFov = on ? 50 : 78;
    if (this.camera.fov !== targetFov) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
  }

  triggerMelee() {
    this.meleeSwing = 1;
  }

  _makeFlashTexture() {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    grad.addColorStop(0, "rgba(255,255,220,1)");
    grad.addColorStop(0.3, "rgba(255,210,80,0.9)");
    grad.addColorStop(1, "rgba(255,140,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,240,180,0.8)";
    ctx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  triggerMuzzleFlash() {
    this.recoil = 1;
    if (this._muzzleFlash) {
      this._muzzleFlash.material.opacity = 1;
      this._muzzleFlash.scale.setScalar(0.5 + Math.random() * 0.35);
    }
  }

  // -------- Humanoid (remote player) --------
  _buildHumanoid(bodyColor) {
    const group = new THREE.Group();
    const skin = 0xf2c08a;
    const dark = 0x1a1a1a;
    const bodyMeshes = [];

    const push = (geom, color, scale = 1.05) => {
      const mat = this._toonMat(color);
      const mesh = new THREE.Mesh(geom, mat);
      const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide });
      const outline = new THREE.Mesh(geom, outlineMat);
      outline.scale.multiplyScalar(scale);
      const g = new THREE.Group();
      g.add(mesh); g.add(outline);
      bodyMeshes.push({ mesh, baseColor: color });
      return g;
    };

    // ----- Upper body (static) -----
    const head = push(new THREE.SphereGeometry(0.32, 14, 10), skin, 1.06);
    head.position.y = 1.65;
    group.add(head);
    const mask = push(new THREE.BoxGeometry(0.62, 0.14, 0.02), 0x0a0a0a, 1.02);
    mask.position.set(0, 1.7, 0.3);
    group.add(mask);
    const torso = push(new THREE.BoxGeometry(0.7, 0.9, 0.42), bodyColor, 1.05);
    torso.position.y = 1.05;
    group.add(torso);
    const emblem = push(new THREE.BoxGeometry(0.32, 0.18, 0.02), 0xffd700, 1.04);
    emblem.position.set(0, 1.15, 0.22);
    group.add(emblem);

    // ----- Arms (pivot groups for swing) -----
    const armGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);
    const handGeo = new THREE.SphereGeometry(0.13, 10, 8);

    const buildArm = (side) => {
      // Pivot at shoulder height (1.45)
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.47, 1.45, 0);
      // Arm segment extends downward from pivot (origin at top of arm)
      const sleeveG = push(armGeo, bodyColor, 1.05);
      sleeveG.position.y = -0.35; // half of arm length so top is at pivot
      pivot.add(sleeveG);
      const handG = push(handGeo, skin, 1.08);
      handG.position.set(0, -0.78, 0);
      pivot.add(handG);
      return pivot;
    };
    const leftArm = buildArm(-1);
    const rightArm = buildArm(1);
    group.add(leftArm);
    group.add(rightArm);

    // ----- Held gun on right arm -----
    const heldGun = new THREE.Group();
    const gunBody = push(new THREE.BoxGeometry(0.16, 0.14, 0.42), 0x0a0a0a, 1.06);
    gunBody.position.set(0, -0.82, 0.15);
    heldGun.add(gunBody);
    const gunBarrel = push(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 8), 0x0a0a0a, 1.1);
    gunBarrel.rotation.x = Math.PI / 2;
    gunBarrel.position.set(0, -0.82, 0.45);
    heldGun.add(gunBarrel);
    const gunMag = push(new THREE.BoxGeometry(0.1, 0.12, 0.1), 0xffd700, 1.06);
    gunMag.position.set(0, -0.93, 0.08);
    heldGun.add(gunMag);
    rightArm.add(heldGun);

    // ----- Legs (pivots for swing) -----
    const legGeo = new THREE.BoxGeometry(0.24, 0.85, 0.28);
    const bootGeo = new THREE.BoxGeometry(0.28, 0.16, 0.36);
    const buildLeg = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.18, 0.82, 0);
      const lg = push(legGeo, dark, 1.05);
      lg.position.y = -0.42;
      pivot.add(lg);
      const bt = push(bootGeo, 0x0a0a0a, 1.05);
      bt.position.set(0, -0.85, 0.04);
      pivot.add(bt);
      return pivot;
    };
    const leftLeg = buildLeg(-1);
    const rightLeg = buildLeg(1);
    group.add(leftLeg); group.add(rightLeg);

    return { group, bodyMeshes, leftArm, rightArm, leftLeg, rightLeg };
  }

  _addRemotePlayer(state) {
    const color = state.is_bot ? 0x9b59b6 : this._hashColor(state.id);
    const { group, bodyMeshes, leftArm, rightArm, leftLeg, rightLeg } = this._buildHumanoid(color);
    group.position.set(state.x, 0, state.z);
    this.scene.add(group);
    const label = this._makeLabel(state.username, state.is_bot);
    label.position.set(0, 2.3, 0);
    group.add(label);
    // Spawn-immunity halo — a translucent gold ring + glowing sphere that
    // wraps the player while invuln. Invisible by default; the per-frame
    // update toggles it based on `p.invuln`.
    const invulnRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.06, 8, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    invulnRing.rotation.x = Math.PI / 2;
    invulnRing.position.y = 0.05;
    invulnRing.visible = false;
    group.add(invulnRing);
    const invulnGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    invulnGlow.position.y = 1.0;
    invulnGlow.visible = false;
    group.add(invulnGlow);
    const entry = {
      mesh: group,
      label,
      color,
      bodyMeshes,
      leftArm, rightArm, leftLeg, rightLeg,
      lastHp: state.hp,
      flashUntil: 0,
      prevX: state.x, prevZ: state.z,
      animPhase: Math.random() * 6.28,
      movingSpeed: 0,
      prevAlive: state.alive,
      deathT: 0,
      invulnRing,
      invulnGlow,
    };
    this.players.set(state.id, entry);
    return entry;
  }

  _makeLabel(text, isBot) {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 30px Anton, sans-serif";
    ctx.fillStyle = isBot ? "rgba(155,89,182,0.95)" : "rgba(10,10,10,0.9)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const prefix = isBot ? "BOT · " : "";
    ctx.fillText((prefix + text).slice(0, 18).toUpperCase(), 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    spr.scale.set(2.2, 0.55, 1);
    return spr;
  }

  _hashColor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const palette = [0xe62429, 0x0055ff, 0xffd700, 0x00b894, 0xff7b00, 0x16a085];
    return palette[h % palette.length];
  }

  // -------- Server state --------
  applyServerState(msg) {
    if (msg.type === "welcome") {
      this.youId = msg.you.id;
      this.position.set(msg.you.x, msg.you.y, msg.you.z);
      this.yaw = msg.you.yaw;
      this.pitch = msg.you.pitch;
      this.isSpectator = !!msg.spectator;
      this.spectateTargetId = msg.spectate_target_id || null;
      // Cache the arena so client-side beam raycasts can clip against
      // obstacles (mirrors server occlusion so the beam visually terminates
      // at the wall, not 80m beyond it).
      if (msg.arena) this._arena = msg.arena;
      return;
    }
    if (msg.type === "state" && this.isSpectator && this.spectateTargetId) {
      // Lock camera to follow the spectate target (3rd-person above their head).
      const t = msg.players.find((p) => p.id === this.spectateTargetId);
      if (t) {
        // Offset camera ~4m behind & ~2m above target's head.
        const cp = Math.cos(t.pitch || 0);
        const back = new THREE.Vector3(Math.sin(t.yaw) * cp, 0, Math.cos(t.yaw) * cp);
        back.multiplyScalar(4);
        this.position.set(t.x + back.x, t.y + 2.0, t.z + back.z);
        // Look toward target's eyes.
        this.yaw = t.yaw;
        this.pitch = t.pitch - 0.25;
      }
    }
    if (msg.type === "leave") {
      const e = this.players.get(msg.id);
      if (e) { this.scene.remove(e.mesh); this.players.delete(msg.id); }
      return;
    }
    if (msg.type === "state") {
      const seen = new Set();
      for (const p of msg.players) {
        seen.add(p.id);
        if (p.id === this.youId) {
          // Detect server-side respawn: alive transitioned false → true. The
          // server picks a fresh random spawn point when respawning, so the
          // client *must* snap its position to match — otherwise shots are
          // raycast from the death location and never hit anything.
          if (p.alive && !this.alive) {
            this.position.set(p.x, p.y, p.z);
            // Clear any in-air velocity so we don't fall through the floor
            // immediately after the snap (vy is the engine's only motion
            // state — horizontal movement is recomputed each tick from input).
            this.vy = 0;
            this.onGround = true;
          }
          this.hp = p.hp;
          this.alive = p.alive;
          // Mirror ammo + reloading from server so we can gate local fire prediction.
          if (typeof p.ammo === "number") {
            const w = this.currentWeapon === "tertiary" ? "laser" : "ak47";
            this.localAmmo[w] = p.ammo;
          }
          this.localReloading = !!p.reloading;
          // Edge-detect: when server says we just entered a reload, kick off
          // the viewmodel animation + reload SFX (idempotent — won't restart
          // mid-reload because we only fire the edge once).
          if (this.localReloading && this._reloadT <= 0) {
            this._reloadT = 0.001;
            this._reloadWeapon = this.currentWeapon === "tertiary" ? "laser" : "ak47";
            this.onLocalUpdate?.({ type: "reload-start", weapon: this._reloadWeapon });
          }
          // Laser beam state (heat % + overheat lockout).
          this.localLaserHeat = Number.isFinite(p.laser_heat) ? p.laser_heat : (this.localLaserHeat || 0);
          this.localLaserOverheated = !!p.laser_overheated;
          continue;
        }
        let entry = this.players.get(p.id);
        if (!entry) entry = this._addRemotePlayer(p);
        if (entry.lastHp != null && p.hp < entry.lastHp && p.alive) {
          entry.flashUntil = performance.now() + 180;
        }
        entry.lastHp = p.hp;
        entry.x = p.x; entry.y = p.y; entry.z = p.z;
        entry.alive = p.alive; entry.is_bot = p.is_bot;
        // Spawn-immunity visuals. Pulses the ring + halo while invuln is
        // active so it's unambiguous to other players that they can't damage
        // this target right now.
        const showInvuln = !!p.invuln && p.alive;
        if (entry.invulnRing) entry.invulnRing.visible = showInvuln;
        if (entry.invulnGlow) entry.invulnGlow.visible = showInvuln;
        if (showInvuln) {
          const t = performance.now() * 0.006;
          const pulse = 0.55 + 0.45 * Math.sin(t);
          if (entry.invulnRing) {
            entry.invulnRing.material.opacity = 0.45 + pulse * 0.45;
            entry.invulnRing.rotation.z += 0.06;
            entry.invulnRing.scale.setScalar(1.0 + pulse * 0.15);
          }
          if (entry.invulnGlow) {
            entry.invulnGlow.material.opacity = 0.1 + pulse * 0.18;
            entry.invulnGlow.scale.setScalar(1.0 + pulse * 0.12);
          }
        }

        // Track movement (speed) for limb swing
        const dx = p.x - entry.prevX;
        const dz = p.z - entry.prevZ;
        const speed = Math.hypot(dx, dz) / 0.05; // dt between server states is ~50ms
        entry.movingSpeed = entry.movingSpeed * 0.6 + speed * 0.4;
        entry.prevX = p.x; entry.prevZ = p.z;

        entry.mesh.position.lerp(new THREE.Vector3(p.x, 0, p.z), 0.5);
        entry.mesh.rotation.y = p.yaw;

        // Death animation trigger
        if (entry.prevAlive && !p.alive) {
          entry.deathT = 0.001; // start animation
        }
        if (!entry.prevAlive && p.alive) {
          // Respawned — reset
          entry.deathT = 0;
          entry.mesh.rotation.x = 0;
          entry.mesh.rotation.z = 0;
        }
        entry.prevAlive = p.alive;
        entry.mesh.visible = p.alive || entry.deathT > 0;
      }
      for (const id of Array.from(this.players.keys())) {
        if (!seen.has(id) && id !== this.youId) {
          const e = this.players.get(id);
          this.scene.remove(e.mesh);
          this.players.delete(id);
        }
      }
      for (const ev of msg.events || []) {
        if (ev.type === "beam") {
          // Continuous laser beam — server emits ~4/sec while a player fires
          // so other clients can render the beam from them. The local
          // shooter's beam is rendered every frame from current camera yaw.
          if (ev.shooter_id !== this.youId) {
            this._remoteBeams.set(ev.shooter_id, {
              ts: performance.now(),
              x: ev.x, y: ev.y, z: ev.z,
              yaw: ev.yaw, pitch: ev.pitch,
              hitDist: ev.hit_dist ?? 80,
            });
          }
        } else if (ev.type === "overheat") {
          if (ev.shooter_id === this.youId) {
            this.onLocalUpdate?.({ type: "laser-overheat" });
          }
        } else if (ev.type === "shot") {
          this._spawnTracer(ev);
          if (ev.shooter_id !== this.youId) {
            const dist = Math.hypot(ev.x - this.position.x, ev.z - this.position.z);
            this.onLocalUpdate({ type: "remote-shot", shooterId: ev.shooter_id, distance: dist, weapon: ev.weapon || "ak47" });
          }
        } else if (ev.type === "melee") {
          this._spawnMeleeArc(ev);
        } else if (ev.type === "hit") {
          if (ev.victim_id === this.youId) {
            // Damage-direction indicator — bubble up the shooter's last known
            // world position so the HUD can render an arc pointing toward
            // where the shot came from. Players we haven't seen yet (or who
            // already despawned) fall back to omni-directional flash.
            let from = null;
            const shooterEntry = this.players.get(ev.shooter_id);
            const shooterMesh = shooterEntry?.mesh;
            if (shooterMesh) {
              from = { x: shooterMesh.position.x, z: shooterMesh.position.z };
            }
            this.onLocalUpdate({ type: "damaged", from, yaw: this.yaw });
          } else if (ev.shooter_id === this.youId) {
            this.onLocalUpdate({ type: "you-hit", headshot: !!ev.headshot, damage: ev.damage, bodyPart: ev.body_part });
          }
        } else if (ev.type === "kill") {
          if (ev.shooter_id === this.youId) this.onLocalUpdate({ type: "you-killed", victim: ev.victim_name, headshot: !!ev.headshot });
          else if (ev.victim_id === this.youId) {
            this.onLocalUpdate({
              type: "killed-by",
              killer: {
                username: ev.shooter_name,
                avatar: ev.shooter_avatar || 0,
                rankTier: ev.shooter_rank_tier || 0,
                rankName: ev.shooter_rank_name || "BRONZE",
                rankPoints: ev.shooter_rank_points || 0,
                peakRankTier: ev.shooter_peak_rank_tier ?? ev.shooter_rank_tier ?? 0,
                bannerIcon: ev.shooter_banner_icon ?? null,
                bannerColor: ev.shooter_banner_color ?? null,
                bannerAnimated: !!ev.shooter_banner_animated,
                level: ev.shooter_level ?? 1,
                // Hard-force the BOT tag off on the death "killed by" card.
                // Backend disguises bots, but as a belt-and-suspenders we
                // also strip the flag here so the player never sees the
                // BOT pill in the post-death moment (works for ranked + casual).
                isBot: false,
                weapon: ev.weapon || "ak47",
              },
            });
          }
        }
      }
      this.onState(msg);
    }
  }

  _spawnTracer(ev) {
    const isLaser = ev.weapon === "laser";
    // For the LOCAL shooter we always use the player's *current* camera yaw,
    // pitch and position so the bullet visibly leaves the screen straight
    // forward from the crosshair — even if the server snapshot is a frame or
    // two behind. Remote shooters use the server-reported aim.
    const isLocal = ev.shooter_id === this.youId;
    const yaw   = isLocal ? this.yaw      : ev.yaw;
    const pitch = isLocal ? this.pitch    : ev.pitch;
    const ox    = isLocal ? this.position.x : ev.x;
    const oy    = isLocal ? this.position.y : ev.y;
    const oz    = isLocal ? this.position.z : ev.z;
    const cp = Math.cos(pitch);
    // Match Three.js camera forward (rotation.y=yaw, default look -Z).
    const dir = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    // Local: push origin a bit ahead of the camera so the near-clip doesn't
    // chop the start. Remote: tracer should leave the head/eye visually.
    const eyeY = oy + (isLocal ? 0 : 0.05);
    const startOffset = isLocal ? 0.6 : (isLaser ? 0.45 : 0.35);
    const start = new THREE.Vector3(ox, eyeY, oz)
      .add(dir.clone().multiplyScalar(startOffset));
    const end = start.clone().add(dir.clone().multiplyScalar(60));
    const length = start.distanceTo(end);
    const radius = isLaser ? 0.06 : 0.04;
    const color = isLaser ? 0x00e8ff : 0xffd700;
    const geom = new THREE.CylinderGeometry(radius, radius, length, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isLaser ? 1.0 : 0.95, blending: isLaser ? THREE.AdditiveBlending : THREE.NormalBlending });
    const tube = new THREE.Mesh(geom, mat);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    tube.position.copy(mid);
    tube.lookAt(end);
    tube.rotateX(Math.PI / 2);
    this.scene.add(tube);
    this.bullets.push({ line: tube, life: isLaser ? 0.28 : 0.18 });
  }

  _spawnMeleeArc(ev) {
    // A bright arc swipe sprite at attacker's forward position — short-lived
    const cp = Math.cos(ev.pitch);
    const fwd = new THREE.Vector3(Math.sin(ev.yaw) * cp, Math.sin(ev.pitch), -Math.cos(ev.yaw) * cp);
    const pos = new THREE.Vector3(ev.x, ev.y, ev.z).add(fwd.clone().multiplyScalar(1.4));
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.06, 6, 16, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xe8eef5, transparent: true, opacity: 0.85 })
    );
    arc.position.copy(pos);
    arc.lookAt(new THREE.Vector3(ev.x, ev.y, ev.z));
    this.scene.add(arc);
    this.bullets.push({ line: arc, life: 0.18 });
  }

  _collides(x, z) {
    const r = 0.5;
    const s = 50;
    if (x < -s + r || x > s - r) return true;
    if (z < -s + r || z > s - r) return true;
    for (const ob of this.obstacles) {
      const hx = ob.w / 2 + r;
      const hz = ob.d / 2 + r;
      if (Math.abs(x - ob.x) < hx && Math.abs(z - ob.z) < hz) return true;
    }
    return false;
  }

  _update(dt) {
    // Drive virtual inputs from a connected gamepad (Xbox / PS-style).
    this._pollGamepad(dt);

    // Wind sway on grass blades — gentle, low-cost.
    if (this._grassBlades && this._grassBlades.length) {
      const t = performance.now() * 0.001;
      // Global gust factor (slow oscillation) layered with per-blade phase.
      const gust = 0.6 + 0.4 * Math.sin(t * 0.55);
      for (let i = 0; i < this._grassBlades.length; i++) {
        const b = this._grassBlades[i];
        const sway = Math.sin(t * 1.6 + b.userData.windPhase) * b.userData.windAmount * gust;
        b.rotation.z = sway;
        b.rotation.x = sway * 0.35;
      }
    }

    // Aim assist: only when gamepad connected OR touch mode active (set
    // externally by TouchControls or via setAimAssist()). Mobile gets a much
    // stronger near-autolock; controller gets a gentle nudge.
    if (this.gamepadConnected || this.touchActive) {
      const base = this._aimAssistStrength ?? 0.0;
      if (base > 0) {
        const strength = this.touchActive ? Math.min(2.0, base * 2.5) : base;
        this.applyAimAssist(dt, strength);
      }
    }

    let mx = 0, mz = 0;
    if (this.keys.has(_bind("forward", "KeyW"))) mz -= 1;
    if (this.keys.has(_bind("back", "KeyS"))) mz += 1;
    if (this.keys.has(_bind("left", "KeyA"))) mx -= 1;
    if (this.keys.has(_bind("right", "KeyD"))) mx += 1;
    const sprintKey = _bind("sprint", "ShiftLeft");
    const sprint = this.keys.has(sprintKey) || (sprintKey === "ShiftLeft" && this.keys.has("ShiftRight"));
    const speed = (sprint ? 8 : 5) * (this.alive ? 1 : 0);
    const moving = (mx !== 0 || mz !== 0) && this.alive;

    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const wx = mx * cos + mz * sin;
      const wz = -mx * sin + mz * cos;
      const nx = this.position.x + wx * speed * dt;
      const nz = this.position.z + wz * speed * dt;
      if (!this._collides(nx, this.position.z)) this.position.x = nx;
      if (!this._collides(this.position.x, nz)) this.position.z = nz;
    }

    // Jump + gravity (server is purely 2D, jump is client-visual only — server
    // sees pitch/yaw and clamps Y; we just bob the camera up and back down).
    const GROUND_Y = 1.8;
    if (this.keys.has(_bind("jump", "Space")) && this.onGround && this.alive) {
      this.vy = 6.5;
      this.onGround = false;
      this.onLocalUpdate?.({ type: "jump" });
    }
    if (!this.onGround) {
      this.vy -= 18 * dt; // gravity
      this.position.y += this.vy * dt;
      if (this.position.y <= GROUND_Y) {
        this.position.y = GROUND_Y;
        this.vy = 0;
        this.onGround = true;
      }
    } else {
      this.position.y = GROUND_Y;
    }

    // Footstep cadence
    if (moving && this.onGround) {
      const stride = sprint ? 0.28 : 0.42;
      this._footAcc += dt;
      if (this._footAcc >= stride) {
        this._footAcc = 0;
        this.onLocalUpdate({ type: "footstep", sprint });
      }
    } else {
      this._footAcc = 0;
    }

    // Floating sign
    if (this._sign) {
      this._sign.position.y = 11 + Math.sin(performance.now() / 600) * 0.4;
      this._sign.rotation.y = Math.sin(performance.now() / 1200) * 0.2;
    }

    // Camera
    this.camera.position.copy(this.position);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Weapon sway + recoil + ADS
    if (this._weapon) {
      // Spectators don't have a viewmodel — hide the entire weapon group.
      if (this.isSpectator) {
        this._weapon.visible = false;
      } else {
        this._weapon.visible = true;
      const adsActive = !!this.ads && this.currentWeapon !== "secondary";
      // While ADS: hide the gun model entirely so it doesn't block vision —
      // the HUD scope overlay replaces the iron-sights pose. Katana (secondary)
      // is always visible.
      if (this.currentWeapon === "primary" && this._primaryGroup) {
        this._primaryGroup.visible = !adsActive;
      }
      if (this.currentWeapon === "tertiary" && this._tertiaryGroup) {
        this._tertiaryGroup.visible = !adsActive;
      }
      const baseX = adsActive ? 0.0 : 0.22;
      const baseY = adsActive ? -0.07 : -0.18;
      const baseZ = adsActive ? -0.15 : -0.05;
      const bobOn = this._bobEnabled !== false;
      const bob = (moving && bobOn) ? Math.sin(performance.now() / (sprint ? 70 : 100)) * (adsActive ? 0.006 : 0.018) : 0;
      if (this.currentWeapon !== "secondary") {
        // Reload animation overlay — drop the gun + tilt, animate the mag.
        // 3 phases: 0..0.3 drop-mag, 0.3..0.7 hold, 0.7..1.0 slap-mag.
        let reloadX = 0, reloadY = 0, reloadZ = 0, reloadRotX = 0, reloadRotZ = 0;
        let magDy = 0, magDz = 0, magRotX = 0;
        if (this._reloadT > 0 && this._reloadT < 1) {
          // Advance timer.
          this._reloadT = Math.min(1, this._reloadT + dt * 1000 / this._reloadDurMs);
          const t = this._reloadT;
          // Smooth ease-in-out envelope for gun dip (peaks mid-reload).
          const dip = Math.sin(t * Math.PI); // 0→1→0
          reloadY = -0.16 * dip;
          reloadZ = 0.05 * dip;
          reloadRotX = 0.55 * dip; // tilt muzzle down
          reloadRotZ = -0.18 * dip;
          // Magazine: 0..0.3 drop out, 0.3..0.7 invisible-ish (held off-screen),
          // 0.7..1.0 slap back in.
          if (t < 0.3) {
            const k = t / 0.3; // 0..1
            magDy = -0.55 * k;
            magDz = 0.05 * k;
            magRotX = 0.35 * k;
          } else if (t < 0.7) {
            magDy = -0.55;
            magDz = 0.05;
            magRotX = 0.35;
          } else {
            const k = (1 - t) / 0.3; // 1..0
            magDy = -0.55 * k;
            magDz = 0.05 * k;
            magRotX = 0.35 * k;
          }
          if (t >= 1) {
            this._reloadT = 0;
            this._reloadWeapon = null;
          }
        }
        this._weapon.position.set(baseX + reloadX, baseY + bob + this.recoil * 0.04 + reloadY, baseZ + this.recoil * 0.12 + reloadZ);
        this._weapon.rotation.x = -this.recoil * 0.22 + reloadRotX;
        this._weapon.rotation.y = adsActive ? 0 : -0.05;
        this._weapon.rotation.z = reloadRotZ;
        // Apply magazine offset (only on AK — laser viewmodel has no mag group).
        if (this._akMagGroup && this.currentWeapon === "primary") {
          this._akMagGroup.position.set(0, magDy, magDz);
          this._akMagGroup.rotation.x = magRotX;
        } else if (this._akMagGroup) {
          this._akMagGroup.position.set(0, 0, 0);
          this._akMagGroup.rotation.x = 0;
        }
        this.recoil = Math.max(0, this.recoil - dt * 5);
        if (this._muzzleFlash) {
          this._muzzleFlash.material.opacity = Math.max(0, this._muzzleFlash.material.opacity - dt * 14);
        }
      } else {
        // Katana: swing animation
        this.meleeSwing = Math.max(0, this.meleeSwing - dt * 4.5);
        const sw = this.meleeSwing;
        this._weapon.position.set(baseX - sw * 0.15, baseY + bob + sw * 0.05, baseZ - sw * 0.15);
        this._weapon.rotation.set(-sw * 0.6, 0.6 + sw * 0.9, sw * 0.5);
      }
      } // end !isSpectator
    }

    // Bullets fade
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.line.material.opacity = Math.max(0, b.life / 0.18);
      if (b.life <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        b.line.material.dispose();
        this.bullets.splice(i, 1);
      }
    }

    // Continuous laser beam — render as a glowing cylinder from the camera
    // each frame while the player is holding fire on the laser. Server-side
    // damage + heat ramp are independent (driven by `laser_firing` in the
    // 20Hz input message); this is purely cosmetic.
    this._updateLaserBeamVisual();

    // Animate clouds + birds. Clouds drift in +X with a tiny vertical bob;
    // they wrap around the arena so they appear infinite. Birds circle on a
    // wide arc and flap their wings continuously.
    if (this._clouds) {
      for (const c of this._clouds) {
        c.position.x += c.userData.driftX * dt;
        c.userData.bob += dt;
        c.position.y += Math.sin(c.userData.bob * 0.4) * 0.005;
        if (c.position.x > 90) c.position.x = -90;
      }
    }
    if (this._birds) {
      for (const b of this._birds) {
        b.userData.angle += b.userData.speed * dt;
        const r = b.userData.radius;
        b.position.x = Math.cos(b.userData.angle) * r;
        b.position.z = Math.sin(b.userData.angle) * r;
        b.position.y = b.userData.height + Math.sin(b.userData.angle * 2) * 0.6;
        // Yaw the bird so it faces its direction of travel.
        b.rotation.y = -b.userData.angle - Math.PI / 2;
        // Wing flap: oscillate z-rotation between +0.65 and +0.25 (left
        // wing) / -0.65 and -0.25 (right wing).
        b.userData.flapPhase += dt * b.userData.flapHz;
        const f = (Math.sin(b.userData.flapPhase) + 1) * 0.5; // 0..1
        b.userData.lw.rotation.z = 0.25 + f * 0.4;
        b.userData.rw.rotation.z = -0.25 - f * 0.4;
      }
    }

    // Laser viewmodel heat overlay — tint glow parts from cyan → orange/red
    // as heat climbs to 1.0, pulse + puff angrily once overheated.
    if (this._laserGlowParts && this.currentWeapon === "tertiary") {
      const heat = Math.max(0, Math.min(1, this.localLaserHeat || 0));
      const overheat = !!this.localLaserOverheated;
      // Color lerp: 0x00cfff (cyan) → 0xff4422 (red-orange)
      const r = Math.round(0x00 + (0xff - 0x00) * heat);
      const g = Math.round(0xcf + (0x44 - 0xcf) * heat);
      const b = Math.round(0xff + (0x22 - 0xff) * heat);
      const tint = (r << 16) | (g << 8) | b;
      for (const part of this._laserGlowParts) {
        if (part?.material?.color) part.material.color.setHex(tint);
      }
      if (this._laserHeatPuff) {
        const t = performance.now() * 0.012;
        // Heat puff opacity: ramps in over heat > 0.6, throbs while overheated.
        let opacity = 0;
        if (overheat) opacity = 0.55 + 0.35 * Math.sin(t * 1.6);
        else if (heat > 0.55) opacity = (heat - 0.55) / 0.45 * 0.6;
        this._laserHeatPuff.material.opacity = opacity;
        // Slight scale pulse on overheat.
        const s = overheat ? (1.0 + 0.18 * Math.sin(t * 2.2)) : 1.0;
        this._laserHeatPuff.scale.set(s, s, s);
        this._laserHeatPuff.visible = opacity > 0.02;
      }
    } else if (this._laserHeatPuff) {
      this._laserHeatPuff.visible = false;
    }

    // Remote players: hit flash + running animation + death anim
    const nowMs = performance.now();
    const flashRed = new THREE.Color(0xff2a2a);
    for (const entry of this.players.values()) {
      // Death animation: 0 → 1 over 0.7s, then keep until respawn
      if (entry.deathT > 0 && entry.deathT < 1) {
        entry.deathT = Math.min(1, entry.deathT + dt / 0.7);
        const t = entry.deathT;
        // Topple backwards: rotation.x from 0 → -pi/2
        entry.mesh.rotation.x = -Math.PI / 2 * t;
        // Slight roll
        entry.mesh.rotation.z = 0.18 * t;
        // Sink slightly
        entry.mesh.position.y = -0.4 * t;
      }
      // Hit flash
      const flashing = nowMs < entry.flashUntil;
      for (const bm of entry.bodyMeshes) {
        if (flashing) bm.mesh.material.color.copy(flashRed);
        else bm.mesh.material.color.setHex(bm.baseColor);
      }
      // Limb swing while moving (skip if dying)
      const moveAmount = entry.deathT > 0 ? 0 : Math.min(1, entry.movingSpeed / 6);
      if (moveAmount > 0.05) {
        const cadence = 9 + moveAmount * 3;
        entry.animPhase += dt * cadence;
        const swing = Math.sin(entry.animPhase) * 0.6 * moveAmount;
        const swing2 = Math.cos(entry.animPhase) * 0.12 * moveAmount;
        entry.leftArm.rotation.x = swing;
        entry.rightArm.rotation.x = -swing * 0.4;
        entry.leftLeg.rotation.x = -swing;
        entry.rightLeg.rotation.x = swing;
        if (entry.deathT === 0) entry.mesh.position.y = Math.abs(swing2) * 0.08;
      } else if (entry.deathT === 0) {
        entry.leftArm.rotation.x *= 0.85;
        entry.rightArm.rotation.x *= 0.85;
        entry.leftLeg.rotation.x *= 0.85;
        entry.rightLeg.rotation.x *= 0.85;
        entry.mesh.position.y *= 0.85;
      }
    }
  }

  /* Xbox/PS-style gamepad input. Polled per-frame via the Gamepad API.
     Standard mapping:
       LS x/y → move (WASD synth), RS x/y → look (yaw/pitch)
       RT (7) → fire, LT (6) → ADS hold
       A (0) → jump, X (2) → melee, B (1) → reload, Y (3) → weapon swap
       LB (4) → prev weapon, RB (5) → next weapon */
  _pollGamepad(dt) {
    if (!this._gamepadEnabled || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let gp = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
    }
    if (!gp) {
      this.gamepadConnected = false;
      // Clear synthesized move keys if pad just disconnected
      return;
    }
    this.gamepadConnected = true;

    const axes = gp.axes || [];
    const btn = (i) => gp.buttons && gp.buttons[i] ? gp.buttons[i].pressed : false;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);

    // ---- Movement (LS) ----
    const lx = dz(axes[0] || 0);
    const ly = dz(axes[1] || 0);
    const KEYS = ["KeyW", "KeyS", "KeyA", "KeyD"];
    const want = [ly < -0.18, ly > 0.18, lx < -0.18, lx > 0.18];
    KEYS.forEach((k, i) => {
      // Mark/unmark via a dedicated tag so we don't fight keyboard input.
      if (want[i]) this.keys.add(k);
      else if (this._gpPrev["_k" + i]) this.keys.delete(k);
      this._gpPrev["_k" + i] = want[i];
    });

    // ---- Look (RS) ----
    const rx = dz(axes[2] || 0);
    const ry = dz(axes[3] || 0);
    const sens = 2.6; // rad/sec at full stick
    if (rx) this.yaw -= rx * sens * dt;
    if (ry) this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - ry * sens * dt));

    // ---- Triggers (configurable: shoot + ADS) ----
    const shootIdx = _ctrlBind("shoot", 7);
    const adsIdx = _ctrlBind("ads", 6);
    const rt = gp.buttons && gp.buttons[shootIdx] ? gp.buttons[shootIdx].value : 0;
    const lt = gp.buttons && gp.buttons[adsIdx] ? gp.buttons[adsIdx].value : 0;
    const fireDown = rt > 0.4;
    const adsDown = lt > 0.4;
    // Fire on rising edge or held (server cooldown gates auto-fire).
    if (fireDown) {
      if (!this._gpPrev.fire || this._canFireRanged()) {
        this._tryShoot(this.yaw, this.pitch);
      }
    }
    this._gpPrev.fire = fireDown;
    this.ads = adsDown;

    // ---- Face buttons (configurable) ----
    const jumpBtn = btn(_ctrlBind("jump", 0));
    const reloadBtn = btn(_ctrlBind("reload", 1));
    const meleeBtn = btn(_ctrlBind("melee", 2));
    const cycleBtn = btn(_ctrlBind("weaponCycle", 3));
    if (jumpBtn && !this._gpPrev.jump) {
      this.keys.add("Space");
      setTimeout(() => this.keys.delete("Space"), 60);
    }
    this._gpPrev.jump = jumpBtn;
    if (meleeBtn && !this._gpPrev.melee) {
      this.pendingMelee = true;
      this.pendingMeleeAim = { yaw: this.yaw, pitch: this.pitch };
    }
    this._gpPrev.melee = meleeBtn;
    if (reloadBtn && !this._gpPrev.reload) {
      this.onLocalUpdate?.({ type: "reload-pressed" });
    }
    this._gpPrev.reload = reloadBtn;
    if (cycleBtn && !this._gpPrev.weapon) {
      const order = ["primary", "secondary", "tertiary"];
      const i = order.indexOf(this.currentWeapon || "primary");
      this.setWeapon(order[(i + 1) % order.length]);
    }
    this._gpPrev.weapon = cycleBtn;

    // Shoulder buttons cycle weapons (configurable)
    const lb = btn(_ctrlBind("weaponPrev", 4)), rb = btn(_ctrlBind("weaponNext", 5));
    if (rb && !this._gpPrev.rb) {
      const order = ["primary", "secondary", "tertiary"];
      const i = order.indexOf(this.currentWeapon || "primary");
      this.setWeapon(order[(i + 1) % order.length]);
    }
    this._gpPrev.rb = rb;
    if (lb && !this._gpPrev.lb) {
      const order = ["primary", "secondary", "tertiary"];
      const i = order.indexOf(this.currentWeapon || "primary");
      this.setWeapon(order[(i + order.length - 1) % order.length]);
    }
    this._gpPrev.lb = lb;
  }

  /* Aim assist (soft snap) — called every frame for gamepad/touch users.
     Finds the closest visible enemy within an aim cone and nudges yaw/pitch
     toward their head/torso. `intensity` 0..1 controls strength. */
  applyAimAssist(dt, intensity = 0.5) {
    if (!intensity || intensity <= 0) return;
    const me = this.players?.get(this.youId);
    if (!me || !me.alive) return;
    let best = null;
    // Wider cone on touch (autolock feel) — ~32°. Controller stays at ~20°.
    let bestAngle = this.touchActive ? 0.56 : 0.35;
    const cp = Math.cos(this.pitch);
    // Match Three.js camera forward exactly (rotation.y=yaw on a camera that
    // looks at -Z by default → effective forward is (-sin(yaw)*cp, sin(pitch), -cos(yaw)*cp)).
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const eye = new THREE.Vector3(this.position.x, this.position.y, this.position.z);
    if (!this.players) return;
    this.players.forEach((p, id) => {
      if (!p || id === this.youId || !p.alive) return;
      // Target the torso (~1.2m off the ground) for stability
      const tgt = new THREE.Vector3(p.x, (p.y || 1.8) - 0.6, p.z);
      const to = new THREE.Vector3().subVectors(tgt, eye);
      const dist = to.length();
      if (dist < 0.5 || dist > (this.touchActive ? 50 : 35)) return;
      to.normalize();
      const dot = Math.max(-1, Math.min(1, fwd.dot(to)));
      const ang = Math.acos(dot);
      if (ang < bestAngle) {
        bestAngle = ang;
        best = { tgt, dist, ang };
      }
    });
    if (!best) return;
    const dx = best.tgt.x - this.position.x;
    const dy = best.tgt.y - this.position.y;
    const dz = best.tgt.z - this.position.z;
    const horiz = Math.hypot(dx, dz);
    // Three.js camera convention: yaw=0 → look -Z, yaw=-π/2 → look +X.
    // Flip dx sign so the desired yaw matches what the camera will actually face.
    const desiredYaw = Math.atan2(-dx, -dz);
    const desiredPitch = Math.atan2(dy, horiz);
    // Touch users get a near-autolock (rate 14); controller a soft snap (6).
    const lerpRate = (this.touchActive ? 14 : 6) * intensity;
    let yd = desiredYaw - this.yaw;
    while (yd >  Math.PI) yd -= Math.PI * 2;
    while (yd < -Math.PI) yd += Math.PI * 2;
    const pd = desiredPitch - this.pitch;
    const k = 1 - Math.exp(-lerpRate * dt);
    this.yaw += yd * k;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + pd * k));
  }

  _loop = () => {
    if (!this.running) return;
    const now = performance.now();
    // FPS cap (0 = uncapped). Re-schedules without re-rendering when over budget.
    if (this._frameMinMs > 0 && (now - this.lastTime) + 0.5 < this._frameMinMs) {
      this._scheduleFrame();
      return;
    }
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
    this._fpsFrames++;
    // Frame Generation — re-render with a sub-tick interpolation step so each
    // RAF produces multiple presents. The engine's _update() already advances
    // remote-entity interpolation by dt, so calling it again with a half-dt
    // genuinely smooths motion at the cost of GPU work. Multiplier is 1 (off),
    // 2, or 3 per the user's setting.
    const fgMul = Math.max(1, Math.min(3, this._frameGenMul | 0));
    if (fgMul > 1) {
      const sub = dt / fgMul;
      for (let i = 1; i < fgMul; i++) {
        this._update(sub);
        this.renderer.render(this.scene, this.camera);
        this._fpsFrames++;
      }
    }
    if (now - this._fpsLastT >= 500) {
      this.fps = Math.round((this._fpsFrames * 1000) / (now - this._fpsLastT));
      this._fpsFrames = 0;
      this._fpsLastT = now;
    }
    this._scheduleFrame();
  };

  /* Schedule the next render. RAF is locked to the display's vsync (60-240Hz).
     "Disable V-Sync" swaps to a setTimeout(0) loop which lets the engine tick
     faster than the display refresh — useful for low input-lag scenarios on
     high-refresh monitors where the browser would otherwise cap RAF below the
     panel's native rate. Note: tearing is still controlled by the OS
     compositor, so the actual visual benefit is mostly reduced input latency. */
  _scheduleFrame() {
    if (this._vsyncDisabled) {
      // setTimeout 0 is the closest browsers offer to an uncapped loop.
      // Clamped to ~500Hz so we don't starve the main thread.
      setTimeout(this._loop, 1);
    } else {
      requestAnimationFrame(this._loop);
    }
  }

  /* Live-applies graphics + FPS-cap settings from the settings store.
     Quality "low" → 0.5x pixel ratio, "medium" → 1.0x, "high" → device DPR.
     Shadows currently affect tone (we don't use shadow maps), so this is a
     placeholder — kept stateful so a future shadow-map pass can read it. */
  applySettings(s) {
    if (!s) return;
    this._settings = { ...(this._settings || {}), ...s };
    if (s.graphics !== undefined || s.renderScale !== undefined) {
      const dpr = window.devicePixelRatio || 1;
      const base =
        this._settings.graphics === "low" ? 0.55 :
        this._settings.graphics === "medium" ? Math.min(1.0, dpr) :
        Math.min(dpr, 2);
      const scale = Math.max(0.5, Math.min(1.5, this._settings.renderScale ?? 1.0));
      try { this.renderer.setPixelRatio(base * scale); } catch {}
    }
    if (s.fpsCap !== undefined) {
      this._frameMinMs = s.fpsCap > 0 ? (1000 / s.fpsCap) : 0;
    }
    if (s.fovDegrees !== undefined && this.camera) {
      this.camera.fov = Math.max(50, Math.min(110, s.fovDegrees));
      this.camera.updateProjectionMatrix();
    }
    if (s.viewDistance !== undefined && this.camera) {
      this.camera.far = Math.max(60, Math.min(200, s.viewDistance));
      this.camera.updateProjectionMatrix();
    }
    if (s.aimAssist !== undefined || s.aimAssistStrength !== undefined) {
      const enabled = this._settings.aimAssist !== false;
      const strength = this._settings.aimAssistStrength ?? 0.6;
      this._aimAssistStrength = enabled ? Math.max(0, Math.min(1, strength)) : 0.0;
    }
    if (s.cameraBob !== undefined) {
      this._bobEnabled = !!s.cameraBob;
    }
    if (s.disableVsync !== undefined) {
      this._vsyncDisabled = !!s.disableVsync;
    }
    if (s.frameGen !== undefined) {
      // "off" / "2x" / "3x" → 1 / 2 / 3 render passes per RAF
      const v = String(s.frameGen);
      this._frameGenMul =
        v === "3x" ? 3 : v === "2x" ? 2 : 1;
    }
    if (s.rayTracedLighting !== undefined) {
      // Toggle the "ray-traced lighting" preset. Real-time path/ray tracing
      // isn't available in browser WebGL, so this enables:
      //   • soft-PCF shadow map on the renderer + sun + dynamic point lights
      //   • three colored point lights (warm/cool/magenta) for richer fills
      //   • a small ambient lift so toon materials don't crush to black
      //   • ACES-filmic tone mapping for more cinematic highlights
      const on = !!s.rayTracedLighting;
      try {
        this.renderer.shadowMap.enabled = on;
        if (on) {
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          this.renderer.toneMappingExposure = 1.05;
        } else {
          this.renderer.toneMapping = THREE.NoToneMapping;
          this.renderer.toneMappingExposure = 1.0;
        }
      } catch {}
      if (this._sun) {
        this._sun.castShadow = on;
        if (on) {
          this._sun.shadow.mapSize.set(1024, 1024);
          this._sun.shadow.camera.near = 1;
          this._sun.shadow.camera.far = 200;
          this._sun.shadow.bias = -0.0005;
        }
      }
      for (const pl of this._rtLights || []) {
        pl.intensity = on ? 2.4 : 0;
      }
      if (this._ambientFill) {
        this._ambientFill.intensity = on ? 0.18 : 0.0;
      }
    }
  }

  snapshot() {
    // Final safety gate: if the player started a reload between input pump
    // and the 20Hz network tick, suppress any queued shoot so we don't play
    // a phantom muzzle/SFX or send a doomed shoot message.
    let shoot = this.pendingShoot;
    if (shoot && this.currentWeapon !== "secondary") {
      const w = this.currentWeapon === "tertiary" ? "laser" : "ak47";
      if (this.localReloading || (this.localAmmo[w] ?? 0) < 0) shoot = false;
    }
    const melee = this.pendingMelee;
    // Click-time aim — captured at the exact moment the click/press happened
    // so the server hit-scan ray matches what the crosshair was pointing at,
    // not where the player has rotated to since.
    const shootAim = this.pendingShootAim || { yaw: this.yaw, pitch: this.pitch };
    const meleeAim = this.pendingMeleeAim || { yaw: this.yaw, pitch: this.pitch };
    this.pendingShoot = false;
    this.pendingMelee = false;
    this.pendingShootAim = null;
    this.pendingMeleeAim = null;
    if (shoot) {
      this.triggerMuzzleFlash();
      this.onShoot();
    }
    if (melee) {
      this.triggerMelee();
    }
    return {
      x: this.position.x,
      z: this.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
      shoot,
      shootYaw: shootAim.yaw,
      shootPitch: shootAim.pitch,
      melee,
      meleeYaw: meleeAim.yaw,
      meleePitch: meleeAim.pitch,
      ads: !!this.ads,
      // Laser beam — continuous-fire request flag. Server applies damage
      // per-tick while true (subject to overheat). Only meaningful when the
      // tertiary (laser) weapon is selected.
      laser_firing: this.currentWeapon === "tertiary" && !!this._laserFireHeld,
    };
  }
}
