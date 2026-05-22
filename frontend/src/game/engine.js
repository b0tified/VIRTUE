import * as THREE from "three";

const SENS_KEY = "virtue.mouseSensitivity";

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

  requestPointerLock() { this.canvas.requestPointerLock?.(); }
  _onPointerLockChange() { this.locked = document.pointerLockElement === this.canvas; }
  _onMouseMove(e) {
    if (!this.locked) return;
    const sens = 0.0022 * this.getSensitivity();
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
  }
  _onKeyDown(e) { this.keys.add(e.code); if (e.code === "Tab") e.preventDefault(); }
  _onKeyUp(e) { this.keys.delete(e.code); }
  _onMouseDown(e) {
    if (!this.locked || !this.alive) return;
    if (e.button === 2) {
      // Right-click → ADS (only meaningful for primary/laser)
      if (this.currentWeapon !== "secondary") this.setADS(true);
      return;
    }
    if (this.currentWeapon === "secondary") {
      this.pendingMelee = true;
    } else {
      this.pendingShoot = true;
    }
  }

  _onMouseUp(e) {
    if (e.button === 2) this.setADS(false);
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

    // A few "grass blade" sprite-decals (just small green spikes)
    const bladeGeo = new THREE.ConeGeometry(0.08, 0.35, 4);
    const bladeMat = this._toonMat(0x4caf50);
    for (let i = 0; i < 220; i++) {
      const b = new THREE.Mesh(bladeGeo, bladeMat);
      b.position.set((Math.random() - 0.5) * SIZE * 2, 0.15, (Math.random() - 0.5) * SIZE * 2);
      b.rotation.y = Math.random() * Math.PI;
      this.scene.add(b);
    }

    // Outer walls
    const wallColors = [0xe62429, 0x0055ff, 0xffd700, 0x0a0a0a];
    const wallH = 6;
    const wallT = 1;
    const wall = (x, z, w, d, c) => {
      const m = this._outlined(new THREE.BoxGeometry(w, wallH, d), c);
      m.position.set(x, wallH / 2, z);
      this.scene.add(m);
    };
    wall(0, -SIZE - wallT / 2, SIZE * 2 + wallT * 2, wallT, wallColors[0]);
    wall(0, SIZE + wallT / 2, SIZE * 2 + wallT * 2, wallT, wallColors[1]);
    wall(-SIZE - wallT / 2, 0, wallT, SIZE * 2, wallColors[2]);
    wall(SIZE + wallT / 2, 0, wallT, SIZE * 2, wallColors[3]);

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

    // Sky dome (slightly cloudy)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 16, 16), new THREE.MeshBasicMaterial({ color: 0x9ddff6, side: THREE.BackSide }));
    this.scene.add(sky);
    const cloudMat = this._toonMat(0xffffff);
    for (let i = 0; i < 8; i++) {
      const cg = new THREE.SphereGeometry(2.5 + Math.random() * 1.5, 8, 6);
      const c = new THREE.Mesh(cg, cloudMat);
      c.position.set((Math.random() - 0.5) * 100, 18 + Math.random() * 8, (Math.random() - 0.5) * 100);
      this.scene.add(c);
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

    // ===== Extra decorative buildings (non-collidable, visual only) =====
    // Place safely away from existing obstacles
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
    // Add these as visual-only buildings (skipped in obstacles list → no server sync needed,
    // and the player can pass through them; positioned outside main play area)
    extras.forEach((ob) => this._buildBuilding(ob));

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
    // Banana magazine (curved → approximate w/ two angled boxes)
    const magTop = this._outlined(new THREE.BoxGeometry(0.1, 0.18, 0.16), 0x3a2510);
    magTop.position.set(0, -0.18, -0.18);
    ak.add(magTop);
    const magBot = this._outlined(new THREE.BoxGeometry(0.1, 0.18, 0.14), 0x3a2510);
    magBot.position.set(0, -0.34, -0.08);
    magBot.rotation.x = -0.5;
    ak.add(magBot);
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

  setWeapon(name) {
    if (name !== "primary" && name !== "secondary" && name !== "tertiary") return;
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
      return;
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
          this.hp = p.hp;
          this.alive = p.alive;
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
        if (ev.type === "shot") {
          this._spawnTracer(ev);
          if (ev.shooter_id !== this.youId) {
            const dist = Math.hypot(ev.x - this.position.x, ev.z - this.position.z);
            this.onLocalUpdate({ type: "remote-shot", shooterId: ev.shooter_id, distance: dist, weapon: ev.weapon || "ak47" });
          }
        } else if (ev.type === "melee") {
          this._spawnMeleeArc(ev);
        } else if (ev.type === "hit") {
          if (ev.victim_id === this.youId) this.onLocalUpdate({ type: "damaged" });
          else if (ev.shooter_id === this.youId) this.onLocalUpdate({ type: "you-hit", headshot: !!ev.headshot, damage: ev.damage, bodyPart: ev.body_part });
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
                isBot: !!ev.shooter_is_bot,
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
    const dir = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
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
    if (this.keys.has("KeyW")) mz -= 1;
    if (this.keys.has("KeyS")) mz += 1;
    if (this.keys.has("KeyA")) mx -= 1;
    if (this.keys.has("KeyD")) mx += 1;
    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
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
    if (this.keys.has("Space") && this.onGround && this.alive) {
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
      const bob = moving ? Math.sin(performance.now() / (sprint ? 70 : 100)) * (adsActive ? 0.006 : 0.018) : 0;
      if (this.currentWeapon !== "secondary") {
        this._weapon.position.set(baseX, baseY + bob + this.recoil * 0.04, baseZ + this.recoil * 0.12);
        this._weapon.rotation.x = -this.recoil * 0.22;
        this._weapon.rotation.y = adsActive ? 0 : -0.05;
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

    // ---- Triggers (RT fires, LT holds ADS) ----
    const rt = gp.buttons && gp.buttons[7] ? gp.buttons[7].value : 0;
    const lt = gp.buttons && gp.buttons[6] ? gp.buttons[6].value : 0;
    const fireDown = rt > 0.4;
    const adsDown = lt > 0.4;
    // Fire on rising edge (single-shot) — auto fire for current weapon is
    // handled by client-side cooldown already.
    if (fireDown && !this._gpPrev.fire) {
      this.pendingShoot = true;
    }
    // Repeat fire while held: pulse every ~120ms via _shootCooldown if we want
    // full-auto. AK-47 server cooldown is 250ms so we just keep flagging.
    if (fireDown) this.pendingShoot = true;
    this._gpPrev.fire = fireDown;
    this.ads = adsDown;

    // ---- Face buttons ----
    const aBtn = btn(0), bBtn = btn(1), xBtn = btn(2), yBtn = btn(3);
    if (aBtn && !this._gpPrev.jump) {
      this.keys.add("Space");
      setTimeout(() => this.keys.delete("Space"), 60);
    }
    this._gpPrev.jump = aBtn;
    if (xBtn && !this._gpPrev.melee) this.pendingMelee = true;
    this._gpPrev.melee = xBtn;
    if (bBtn && !this._gpPrev.reload) {
      this.onLocalUpdate?.({ type: "reload-pressed" });
    }
    this._gpPrev.reload = bBtn;
    if (yBtn && !this._gpPrev.weapon) {
      const order = ["primary", "secondary", "tertiary"];
      const i = order.indexOf(this.currentWeapon || "primary");
      this.setWeapon(order[(i + 1) % order.length]);
    }
    this._gpPrev.weapon = yBtn;

    // Shoulder buttons cycle weapons
    const lb = btn(4), rb = btn(5);
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
    const fwd = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
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
    const desiredYaw = Math.atan2(dx, -dz);
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
      requestAnimationFrame(this._loop);
      return;
    }
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
    this._fpsFrames++;
    if (now - this._fpsLastT >= 500) {
      this.fps = Math.round((this._fpsFrames * 1000) / (now - this._fpsLastT));
      this._fpsFrames = 0;
      this._fpsLastT = now;
    }
    requestAnimationFrame(this._loop);
  };

  /* Live-applies graphics + FPS-cap settings from the settings store.
     Quality "low" → 0.5x pixel ratio, "medium" → 1.0x, "high" → device DPR.
     Shadows currently affect tone (we don't use shadow maps), so this is a
     placeholder — kept stateful so a future shadow-map pass can read it. */
  applySettings(s) {
    if (!s) return;
    this._settings = { ...(this._settings || {}), ...s };
    if (s.graphics !== undefined) {
      const dpr = window.devicePixelRatio || 1;
      const ratio =
        s.graphics === "low" ? 0.55 :
        s.graphics === "medium" ? Math.min(1.0, dpr) :
        Math.min(dpr, 2);
      try { this.renderer.setPixelRatio(ratio); } catch {}
    }
    if (s.fpsCap !== undefined) {
      this._frameMinMs = s.fpsCap > 0 ? (1000 / s.fpsCap) : 0;
    }
    if (s.fovDegrees !== undefined && this.camera) {
      this.camera.fov = Math.max(50, Math.min(110, s.fovDegrees));
      this.camera.updateProjectionMatrix();
    }
    if (s.aimAssist !== undefined) {
      this._aimAssistStrength = s.aimAssist ? 0.6 : 0.0;
    }
  }

  snapshot() {
    const shoot = this.pendingShoot;
    const melee = this.pendingMelee;
    this.pendingShoot = false;
    this.pendingMelee = false;
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
      melee,
      ads: !!this.ads,
    };
  }
}
