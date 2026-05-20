import * as THREE from "three";

// Comic-book cel-shaded FPS engine
export class GameEngine {
  constructor(canvas, { onState, onLocalUpdate } = {}) {
    this.canvas = canvas;
    this.onState = onState || (() => {});
    this.onLocalUpdate = onLocalUpdate || (() => {});

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xfff8d8); // warm comic sky
    this.scene.fog = new THREE.Fog(0xfff8d8, 60, 110);

    this.camera = new THREE.PerspectiveCamera(78, canvas.clientWidth / canvas.clientHeight, 0.1, 500);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;

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
    this.position = new THREE.Vector3(30, 1.8, 30);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;

    // Input
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.locked = false;
    this.pendingShoot = false;

    // Network state
    this.youId = null;
    this.players = new Map(); // id -> { mesh, label, last }
    this.events = [];

    // World objects
    this._buildArena();

    // Bullets visuals
    this.bullets = []; // {mesh, vel, life}

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

  requestPointerLock() {
    this.canvas.requestPointerLock?.();
  }

  _onPointerLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
  }

  _onMouseMove(e) {
    if (!this.locked) return;
    const sens = 0.0022;
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
  }

  _onKeyDown(e) {
    this.keys.add(e.code);
    if (e.code === "Tab") e.preventDefault();
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
  }

  _onMouseDown() {
    if (!this.locked) return;
    if (!this.alive) return;
    this.pendingShoot = true;
  }

  _onResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _toonMat(color) {
    return new THREE.MeshToonMaterial({ color, gradientMap: this.toonMap });
  }

  _outlinedMesh(geometry, color) {
    const group = new THREE.Group();
    const mat = this._toonMat(color);
    const mesh = new THREE.Mesh(geometry, mat);
    group.add(mesh);
    // Outline pass via inverted hull
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide });
    const outline = new THREE.Mesh(geometry, outlineMat);
    outline.scale.multiplyScalar(1.05);
    group.add(outline);
    return group;
  }

  _buildArena() {
    const SIZE = 50;
    // Floor
    const floorGeo = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2);
    const floorMat = this._toonMat(0xe8e2c8);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Floor grid lines (comic panels)
    const grid = new THREE.GridHelper(SIZE * 2, 20, 0x0a0a0a, 0x0a0a0a);
    grid.position.y = 0.01;
    this.scene.add(grid);

    // Walls (outer bounds)
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

    // Obstacles (match server)
    this.obstacles = [
      { x: 0, z: 0, w: 6, h: 4, d: 6, color: 0xffd700 },
      { x: 15, z: 10, w: 4, h: 3, d: 8, color: 0xe62429 },
      { x: -15, z: -10, w: 8, h: 3, d: 4, color: 0x0055ff },
      { x: -18, z: 15, w: 4, h: 5, d: 4, color: 0xffd700 },
      { x: 20, z: -18, w: 6, h: 4, d: 4, color: 0xe62429 },
      { x: -5, z: 20, w: 10, h: 3, d: 3, color: 0x0055ff },
      { x: 8, z: -22, w: 3, h: 6, d: 3, color: 0xffd700 },
      { x: -25, z: 0, w: 3, h: 4, d: 10, color: 0xe62429 },
      { x: 25, z: 5, w: 3, h: 4, d: 10, color: 0x0055ff },
    ];
    this.obstacles.forEach((ob) => {
      const g = new THREE.BoxGeometry(ob.w, ob.h, ob.d);
      const mesh = this._outlinedMesh(g, ob.color);
      mesh.position.set(ob.x, ob.h / 2, ob.z);
      this.scene.add(mesh);
    });

    // Sun decoration
    const skyGeo = new THREE.SphereGeometry(80, 16, 16);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8, side: THREE.BackSide });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
  }

  _addRemotePlayer(state) {
    const g = new THREE.CapsuleGeometry(0.45, 1.1, 4, 8);
    const color = this._hashColor(state.id);
    const mesh = this._outlinedMesh(g, color);
    mesh.position.set(state.x, state.y - 0.4, state.z);
    this.scene.add(mesh);
    // Label
    const label = this._makeLabel(state.username);
    label.position.set(0, 1.6, 0);
    mesh.add(label);
    const entry = { mesh, label, color };
    this.players.set(state.id, entry);
    return entry;
  }

  _makeLabel(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 32px Anton, sans-serif";
    ctx.fillStyle = "rgba(10,10,10,0.9)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 14).toUpperCase(), 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    spr.scale.set(2.2, 0.55, 1);
    return spr;
  }

  _hashColor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const palette = [0xe62429, 0x0055ff, 0xffd700, 0x00b894, 0xff7b00, 0xa569bd, 0x16a085];
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
          // sync HP from server
          this.hp = p.hp;
          this.alive = p.alive;
          if (!p.alive) {
            // hide camera below if dead? Just keep position.
          }
          continue;
        }
        let entry = this.players.get(p.id);
        if (!entry) entry = this._addRemotePlayer(p);
        // smooth move
        entry.mesh.position.lerp(new THREE.Vector3(p.x, p.y - 0.4, p.z), 0.5);
        entry.mesh.rotation.y = p.yaw;
        entry.mesh.visible = p.alive;
      }
      // remove stale
      for (const id of Array.from(this.players.keys())) {
        if (!seen.has(id) && id !== this.youId) {
          const e = this.players.get(id);
          this.scene.remove(e.mesh);
          this.players.delete(id);
        }
      }
      // events
      for (const ev of msg.events || []) {
        if (ev.type === "shot") {
          this._spawnTracer(ev);
        } else if (ev.type === "hit" && ev.victim_id === this.youId) {
          this.onLocalUpdate({ type: "damaged" });
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
    const mat = new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 1, linewidth: 3 });
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
    // Movement
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
      // rotate by yaw
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

    // Camera
    this.camera.position.copy(this.position);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

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

  // Snapshot for network send
  snapshot() {
    const shoot = this.pendingShoot;
    this.pendingShoot = false;
    return {
      x: this.position.x,
      z: this.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
      shoot,
    };
  }
}
