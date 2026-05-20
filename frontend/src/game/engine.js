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
    this._onResize = this._onResize.bind(this);

    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    document.addEventListener("mousedown", this._onMouseDown);
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
  _onMouseDown() {
    if (!this.locked || !this.alive) return;
    this.pendingShoot = true;
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
    const group = new THREE.Group();

    // Forearm sleeve (red)
    const sleeve = this._outlined(new THREE.BoxGeometry(0.22, 0.22, 0.4), 0xe62429);
    sleeve.position.set(0, -0.07, 0.18);
    group.add(sleeve);

    // Hand (skin)
    const hand = this._outlined(new THREE.SphereGeometry(0.13, 12, 8), 0xf2c08a, 1.08);
    hand.position.set(0, -0.07, -0.05);
    group.add(hand);

    // Gun receiver (main body, darker steel)
    const receiver = this._outlined(new THREE.BoxGeometry(0.16, 0.18, 0.5), 0x1a1a1a);
    receiver.position.set(0, 0.02, -0.4);
    group.add(receiver);

    // Slide on top (lighter)
    const slide = this._outlined(new THREE.BoxGeometry(0.14, 0.06, 0.42), 0x2a2a2a);
    slide.position.set(0, 0.13, -0.4);
    group.add(slide);

    // Grip (angled)
    const grip = this._outlined(new THREE.BoxGeometry(0.12, 0.24, 0.16), 0x222222);
    grip.position.set(0, -0.16, -0.22);
    grip.rotation.x = -0.28;
    group.add(grip);

    // Trigger guard (thin ring approx with a box arc)
    const trigGuard = this._outlined(new THREE.TorusGeometry(0.08, 0.018, 6, 10, Math.PI), 0x111111, 1.1);
    trigGuard.position.set(0, -0.06, -0.27);
    trigGuard.rotation.set(0, 0, 0);
    group.add(trigGuard);

    // Magazine (sticks down from grip)
    const mag = this._outlined(new THREE.BoxGeometry(0.1, 0.15, 0.12), 0xffd700);
    mag.position.set(0, -0.3, -0.2);
    group.add(mag);

    // Barrel
    const barrel = this._outlined(new THREE.CylinderGeometry(0.045, 0.045, 0.4, 14), 0x0a0a0a, 1.06);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.7);
    group.add(barrel);

    // Front sight blade
    const sight = this._outlined(new THREE.BoxGeometry(0.025, 0.07, 0.04), 0xffd700, 1.12);
    sight.position.set(0, 0.18, -0.83);
    group.add(sight);
    // Rear sight notch
    const rear = this._outlined(new THREE.BoxGeometry(0.12, 0.04, 0.04), 0xffd700, 1.1);
    rear.position.set(0, 0.18, -0.18);
    group.add(rear);

    // Muzzle flash
    const flashTex = this._makeFlashTexture();
    const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, opacity: 0 });
    const flash = new THREE.Sprite(flashMat);
    flash.scale.set(0.7, 0.7, 1);
    flash.position.set(0, 0.03, -0.92);
    group.add(flash);
    this._muzzleFlash = flash;

    group.position.set(0.22, -0.18, -0.05);
    group.rotation.y = -0.05;
    this._weapon = group;
    this.camera.add(group);
    this.scene.add(this.camera);
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

        // Track movement (speed) for limb swing
        const dx = p.x - entry.prevX;
        const dz = p.z - entry.prevZ;
        const speed = Math.hypot(dx, dz) / 0.05; // dt between server states is ~50ms
        entry.movingSpeed = entry.movingSpeed * 0.6 + speed * 0.4;
        entry.prevX = p.x; entry.prevZ = p.z;

        entry.mesh.position.lerp(new THREE.Vector3(p.x, 0, p.z), 0.5);
        entry.mesh.rotation.y = p.yaw;
        entry.mesh.visible = p.alive;
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
            // Distance from listener (player) for remote gunshot
            const dist = Math.hypot(ev.x - this.position.x, ev.z - this.position.z);
            this.onLocalUpdate({ type: "remote-shot", shooterId: ev.shooter_id, distance: dist });
          }
        } else if (ev.type === "hit") {
          if (ev.victim_id === this.youId) this.onLocalUpdate({ type: "damaged" });
          else if (ev.shooter_id === this.youId) this.onLocalUpdate({ type: "you-hit" });
        } else if (ev.type === "kill") {
          if (ev.shooter_id === this.youId) this.onLocalUpdate({ type: "you-killed", victim: ev.victim_name });
        }
      }
      this.onState(msg);
    }
  }

  _spawnTracer(ev) {
    const cp = Math.cos(ev.pitch);
    const dir = new THREE.Vector3(Math.sin(ev.yaw) * cp, Math.sin(ev.pitch), -Math.cos(ev.yaw) * cp);
    const start = new THREE.Vector3(ev.x, ev.y - 0.1, ev.z);
    const end = start.clone().add(dir.clone().multiplyScalar(40));
    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 1 });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    this.bullets.push({ line, life: 0.12 });
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
    this.position.y = 1.8;

    // Footstep cadence
    if (moving) {
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

    // Weapon sway + recoil
    if (this._weapon) {
      const baseX = 0.22, baseY = -0.18, baseZ = -0.05;
      const bob = moving ? Math.sin(performance.now() / (sprint ? 70 : 100)) * 0.018 : 0;
      this._weapon.position.set(baseX, baseY + bob + this.recoil * 0.04, baseZ + this.recoil * 0.12);
      this._weapon.rotation.x = -this.recoil * 0.22;
      this.recoil = Math.max(0, this.recoil - dt * 5);
      if (this._muzzleFlash) {
        this._muzzleFlash.material.opacity = Math.max(0, this._muzzleFlash.material.opacity - dt * 14);
      }
    }

    // Bullets fade
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.line.material.opacity = Math.max(0, b.life / 0.12);
      if (b.life <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        b.line.material.dispose();
        this.bullets.splice(i, 1);
      }
    }

    // Remote players: hit flash + running animation
    const nowMs = performance.now();
    const flashRed = new THREE.Color(0xff2a2a);
    for (const entry of this.players.values()) {
      // Hit flash
      const flashing = nowMs < entry.flashUntil;
      for (const bm of entry.bodyMeshes) {
        if (flashing) bm.mesh.material.color.copy(flashRed);
        else bm.mesh.material.color.setHex(bm.baseColor);
      }
      // Limb swing while moving
      const moveAmount = Math.min(1, entry.movingSpeed / 6);
      if (moveAmount > 0.05) {
        const cadence = 9 + moveAmount * 3;
        entry.animPhase += dt * cadence;
        const swing = Math.sin(entry.animPhase) * 0.6 * moveAmount;
        const swing2 = Math.cos(entry.animPhase) * 0.12 * moveAmount;
        entry.leftArm.rotation.x = swing;
        entry.rightArm.rotation.x = -swing * 0.4; // dampened (holds gun)
        entry.leftLeg.rotation.x = -swing;
        entry.rightLeg.rotation.x = swing;
        entry.mesh.position.y = Math.abs(swing2) * 0.08; // tiny bob
      } else {
        // ease to rest
        entry.leftArm.rotation.x *= 0.85;
        entry.rightArm.rotation.x *= 0.85;
        entry.leftLeg.rotation.x *= 0.85;
        entry.rightLeg.rotation.x *= 0.85;
        entry.mesh.position.y *= 0.85;
      }
    }
  }

  _loop = () => {
    if (!this.running) return;
    const now = performance.now();
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

  snapshot() {
    const shoot = this.pendingShoot;
    this.pendingShoot = false;
    if (shoot) {
      this.triggerMuzzleFlash();
      this.onShoot();
    }
    return {
      x: this.position.x,
      z: this.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
      shoot,
    };
  }
}
