import * as THREE from "three";

// Comic-book cel-shaded FPS engine
export class GameEngine {
  constructor(canvas, { onState, onLocalUpdate, onShoot } = {}) {
    this.canvas = canvas;
    this.onState = onState || (() => {});
    this.onLocalUpdate = onLocalUpdate || (() => {});
    this.onShoot = onShoot || (() => {});

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xfff8d8);
    this.scene.fog = new THREE.Fog(0xfff8d8, 60, 120);

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
    const hemi = new THREE.HemisphereLight(0xfff2a8, 0x556677, 1.0);
    this.scene.add(hemi);
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
    this.recoil = 0; // 0..1

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
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
    this.renderer.dispose();
  }

  requestPointerLock() { this.canvas.requestPointerLock?.(); }
  _onPointerLockChange() { this.locked = document.pointerLockElement === this.canvas; }
  _onMouseMove(e) {
    if (!this.locked) return;
    const sens = 0.0022;
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

  _outlinedMesh(geometry, color, outlineScale = 1.05) {
    const group = new THREE.Group();
    const mat = this._toonMat(color);
    const mesh = new THREE.Mesh(geometry, mat);
    group.add(mesh);
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide });
    const outline = new THREE.Mesh(geometry, outlineMat);
    outline.scale.multiplyScalar(outlineScale);
    group.add(outline);
    return group;
  }

  _buildArena() {
    const SIZE = 50;
    // Floor with checker grid
    const floorGeo = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2);
    const floor = new THREE.Mesh(floorGeo, this._toonMat(0xece4c6));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(SIZE * 2, 20, 0x0a0a0a, 0x0a0a0a);
    grid.position.y = 0.01;
    this.scene.add(grid);

    // Floor accent rings (comic POW circles)
    const ring1 = new THREE.Mesh(new THREE.RingGeometry(7, 9, 24), new THREE.MeshBasicMaterial({ color: 0xe62429, side: THREE.DoubleSide }));
    ring1.rotation.x = -Math.PI / 2;
    ring1.position.y = 0.02;
    this.scene.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(11, 13, 24), new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide }));
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.02;
    this.scene.add(ring2);

    // Walls
    const wallMatColors = [0xe62429, 0x0055ff, 0xffd700, 0x0a0a0a];
    const wallH = 6;
    const wallT = 1;
    const makeWall = (x, z, w, d, color) => {
      const g = new THREE.BoxGeometry(w, wallH, d);
      const m = this._outlinedMesh(g, color);
      m.position.set(x, wallH / 2, z);
      this.scene.add(m);
    };
    makeWall(0, -SIZE - wallT / 2, SIZE * 2 + wallT * 2, wallT, wallMatColors[0]);
    makeWall(0, SIZE + wallT / 2, SIZE * 2 + wallT * 2, wallT, wallMatColors[1]);
    makeWall(-SIZE - wallT / 2, 0, wallT, SIZE * 2, wallMatColors[2]);
    makeWall(SIZE + wallT / 2, 0, wallT, SIZE * 2, wallMatColors[3]);

    // Obstacles (must match server)
    this.obstacles = [
      { x: 0, z: 0, w: 6, h: 8, d: 6, color: 0x0a0a0a },
      { x: 9, z: 0, w: 3, h: 1.2, d: 3, color: 0xffd700 },
      { x: -9, z: 0, w: 3, h: 1.2, d: 3, color: 0xffd700 },
      { x: 0, z: 9, w: 3, h: 1.2, d: 3, color: 0xffd700 },
      { x: 0, z: -9, w: 3, h: 1.2, d: 3, color: 0xffd700 },

      { x: 18, z: 14, w: 4, h: 3, d: 8, color: 0xe62429 },
      { x: 26, z: 24, w: 6, h: 4, d: 3, color: 0x0055ff },
      { x: 14, z: 28, w: 3, h: 5, d: 3, color: 0xffd700 },
      { x: 30, z: 12, w: 3, h: 3, d: 5, color: 0xe62429 },

      { x: -18, z: -14, w: 8, h: 3, d: 4, color: 0xe62429 },
      { x: -26, z: -24, w: 3, h: 4, d: 8, color: 0x0055ff },
      { x: -10, z: -28, w: 6, h: 3, d: 3, color: 0xffd700 },
      { x: -30, z: -12, w: 3, h: 3, d: 5, color: 0x0055ff },

      { x: -18, z: 14, w: 4, h: 5, d: 4, color: 0x0055ff },
      { x: -28, z: 20, w: 3, h: 4, d: 6, color: 0xe62429 },
      { x: -5, z: 22, w: 10, h: 3, d: 3, color: 0xffd700 },
      { x: -32, z: 5, w: 3, h: 4, d: 4, color: 0xe62429 },

      { x: 20, z: -18, w: 6, h: 4, d: 4, color: 0xffd700 },
      { x: 28, z: -22, w: 3, h: 5, d: 8, color: 0x0055ff },
      { x: 8, z: -22, w: 3, h: 6, d: 3, color: 0xe62429 },
      { x: 32, z: -5, w: 3, h: 4, d: 4, color: 0x0055ff },

      { x: -35, z: 30, w: 8, h: 4, d: 2, color: 0x0a0a0a },
      { x: 35, z: -30, w: 8, h: 4, d: 2, color: 0x0a0a0a },
      { x: -38, z: -35, w: 2, h: 4, d: 8, color: 0x0a0a0a },
      { x: 38, z: 35, w: 2, h: 4, d: 8, color: 0x0a0a0a },

      // crates
      { x: 4, z: 14, w: 1.6, h: 1.6, d: 1.6, color: 0xff7b00 },
      { x: -4, z: -14, w: 1.6, h: 1.6, d: 1.6, color: 0xff7b00 },
      { x: 14, z: -4, w: 1.6, h: 1.6, d: 1.6, color: 0xff7b00 },
      { x: -14, z: 4, w: 1.6, h: 1.6, d: 1.6, color: 0xff7b00 },
    ];

    this.obstacles.forEach((ob) => {
      const g = new THREE.BoxGeometry(ob.w, ob.h, ob.d);
      const mesh = this._outlinedMesh(g, ob.color);
      mesh.position.set(ob.x, ob.h / 2, ob.z);
      this.scene.add(mesh);
    });

    // Comic floating "POW!" signs above central tower
    const signGeo = new THREE.PlaneGeometry(8, 3);
    const signCanvas = document.createElement("canvas");
    signCanvas.width = 256; signCanvas.height = 96;
    const sctx = signCanvas.getContext("2d");
    sctx.fillStyle = "#FFD700";
    sctx.fillRect(0, 0, 256, 96);
    sctx.strokeStyle = "#0A0A0A";
    sctx.lineWidth = 8;
    sctx.strokeRect(4, 4, 248, 88);
    sctx.font = "bold 64px Bangers, Anton, sans-serif";
    sctx.fillStyle = "#E62429";
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    sctx.strokeStyle = "#0A0A0A";
    sctx.lineWidth = 4;
    sctx.strokeText("VIRTUE", 128, 50);
    sctx.fillText("VIRTUE", 128, 50);
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(signGeo, new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide }));
    sign.position.set(0, 11, 0);
    this.scene.add(sign);
    this._sign = sign;

    // Decorative pillars (4 corners of inner ring)
    const pillarGeo = new THREE.CylinderGeometry(0.6, 0.6, 6, 10);
    [
      [12, 12, 0xe62429], [-12, 12, 0x0055ff], [12, -12, 0xffd700], [-12, -12, 0x0a0a0a],
    ].forEach(([x, z, c]) => {
      const p = this._outlinedMesh(pillarGeo, c, 1.08);
      p.position.set(x, 3, z);
      this.scene.add(p);
    });

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(120, 16, 16);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8, side: THREE.BackSide });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Floating comic clouds
    const cloudMat = this._toonMat(0xffffff);
    for (let i = 0; i < 6; i++) {
      const cg = new THREE.SphereGeometry(2.5 + Math.random() * 1.5, 8, 6);
      const c = new THREE.Mesh(cg, cloudMat);
      c.position.set((Math.random() - 0.5) * 80, 18 + Math.random() * 6, (Math.random() - 0.5) * 80);
      this.scene.add(c);
    }
  }

  _buildWeapon() {
    // Weapon group attached to camera so it follows view
    const group = new THREE.Group();
    // Hand (skin-colored block)
    const handG = new THREE.BoxGeometry(0.18, 0.18, 0.28);
    const hand = this._outlinedMesh(handG, 0xf2c08a, 1.05);
    hand.position.set(0.0, -0.05, -0.05);
    group.add(hand);
    // Forearm sleeve (red)
    const sleeveG = new THREE.BoxGeometry(0.2, 0.2, 0.35);
    const sleeve = this._outlinedMesh(sleeveG, 0xe62429, 1.05);
    sleeve.position.set(0, -0.06, 0.2);
    group.add(sleeve);
    // Gun body
    const bodyG = new THREE.BoxGeometry(0.16, 0.18, 0.42);
    const body = this._outlinedMesh(bodyG, 0x111111, 1.05);
    body.position.set(0, 0.0, -0.34);
    group.add(body);
    // Grip
    const gripG = new THREE.BoxGeometry(0.12, 0.22, 0.14);
    const grip = this._outlinedMesh(gripG, 0x1a1a1a, 1.05);
    grip.position.set(0, -0.14, -0.18);
    grip.rotation.x = -0.25;
    group.add(grip);
    // Barrel
    const barrelG = new THREE.CylinderGeometry(0.04, 0.04, 0.32, 12);
    const barrel = this._outlinedMesh(barrelG, 0x0a0a0a, 1.06);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.6);
    group.add(barrel);
    // Front sight
    const sightG = new THREE.BoxGeometry(0.03, 0.05, 0.03);
    const sight = this._outlinedMesh(sightG, 0xffd700, 1.1);
    sight.position.set(0, 0.10, -0.75);
    group.add(sight);
    // Muzzle flash sprite
    const flashTex = this._makeFlashTexture();
    const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, opacity: 0 });
    const flash = new THREE.Sprite(flashMat);
    flash.scale.set(0.6, 0.6, 1);
    flash.position.set(0, 0.03, -0.8);
    group.add(flash);
    this._muzzleFlash = flash;

    // Position weapon at lower-right of camera view
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
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    // burst lines
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
      this._muzzleFlash.scale.setScalar(0.4 + Math.random() * 0.3);
    }
  }

  _addRemotePlayer(state) {
    const g = new THREE.CapsuleGeometry(0.45, 1.1, 4, 8);
    const color = state.is_bot ? 0x9b59b6 : this._hashColor(state.id);
    const mesh = this._outlinedMesh(g, color);
    mesh.position.set(state.x, state.y - 0.4, state.z);
    this.scene.add(mesh);
    const label = this._makeLabel(state.username, state.is_bot);
    label.position.set(0, 1.6, 0);
    mesh.add(label);
    const entry = { mesh, label, color };
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
      if (e) {
        this.scene.remove(e.mesh);
        this.players.delete(msg.id);
      }
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
        entry.mesh.position.lerp(new THREE.Vector3(p.x, p.y - 0.4, p.z), 0.5);
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
          // Audio: only for OTHER shooters (own is played immediately)
          if (ev.shooter_id !== this.youId) {
            this.onLocalUpdate({ type: "remote-shot", from: ev });
          }
        } else if (ev.type === "hit") {
          if (ev.victim_id === this.youId) {
            this.onLocalUpdate({ type: "damaged" });
          } else if (ev.shooter_id === this.youId) {
            this.onLocalUpdate({ type: "you-hit" });
          }
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

  _collidesObstacle(x, z) {
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
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const wx = mx * cos + mz * sin;
      const wz = -mx * sin + mz * cos;
      const nx = this.position.x + wx * speed * dt;
      const nz = this.position.z + wz * speed * dt;
      if (!this._collidesObstacle(nx, this.position.z)) this.position.x = nx;
      if (!this._collidesObstacle(this.position.x, nz)) this.position.z = nz;
    }
    this.position.y = 1.8;

    // Sign bobbing
    if (this._sign) {
      this._sign.position.y = 11 + Math.sin(performance.now() / 600) * 0.4;
      this._sign.rotation.y = Math.sin(performance.now() / 1200) * 0.2;
    }

    // Camera
    this.camera.position.copy(this.position);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Weapon recoil + sway
    if (this._weapon) {
      const baseX = 0.22, baseY = -0.18, baseZ = -0.05;
      const bob = (this.keys.has("KeyW") || this.keys.has("KeyA") || this.keys.has("KeyS") || this.keys.has("KeyD"))
        ? Math.sin(performance.now() / 90) * 0.012
        : 0;
      this._weapon.position.set(
        baseX,
        baseY + bob + this.recoil * 0.04,
        baseZ + this.recoil * 0.12
      );
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
  }

  _loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
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
