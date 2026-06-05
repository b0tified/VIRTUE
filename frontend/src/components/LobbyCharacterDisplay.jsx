/* LobbyCharacterDisplay — full-3D portrait of the player's currently
   equipped skin in the lobby's right column. Inspired by Fortnite's
   character display: always-on, gentle turntable + idle bob, with
   subtle stage lighting and a floor halo. Clicking it opens the shop
   so swapping cosmetics feels like an obvious next step.

   Mounts a dedicated Three.js scene (separate from gameplay) using
   `GameEngine.buildHumanoidForPreview` so the astronaut's animated
   thrusters / LED / visor sweep render exactly like in-game without
   spinning up a full gameplay engine.

   Re-mounts whenever `skinId` changes (user equips a new cosmetic) so
   the lobby instantly reflects loadout changes without a refresh. */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GameEngine } from "@/game/engine";
import { skinById } from "@/game/skins";

export default function LobbyCharacterDisplay({ skinId = "default", username = "", onClick }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const width  = host.clientWidth;
    const height = host.clientHeight;

    const scene = new THREE.Scene();
    // Transparent BG so the lobby's comic backdrop bleeds through; only
    // the floor halo and the figure read on top.
    scene.background = null;

    // Stage lighting — warm key from above-front, cool fill from rear-
    // left, plus a strong rim from above so the silhouette pops against
    // the busy lobby art.
    const key  = new THREE.DirectionalLight(0xfff2c8, 1.05);
    key.position.set(2.2, 3.2, 2.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6aa0ff, 0.45);
    fill.position.set(-2.2, 1.8, -1.8);
    scene.add(fill);
    const rim  = new THREE.DirectionalLight(0xffffff, 0.4);
    rim.position.set(0, 4.5, -2.0);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.32));

    // Floor halo — a soft white ring on a dark disc so the figure looks
    // like it's standing on a small stage instead of floating.
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.30, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.32,
        side: THREE.DoubleSide,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.02;
    scene.add(halo);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.55, 48),
      new THREE.MeshBasicMaterial({ color: 0x0A0A14, transparent: true, opacity: 0.55 }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.05;
    scene.add(disc);

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 50);
    camera.position.set(0, 1.55, 3.9);
    camera.lookAt(0, 1.05, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0); // transparent
    host.appendChild(renderer.domElement);

    // Build the live humanoid mesh from the catalog. Falls back to the
    // default skin if `skinId` doesn't resolve (legacy/corrupt accounts).
    const skin = skinById(skinId) || skinById("default");
    const built = GameEngine.buildHumanoidForPreview(skin);
    const figure = built.group;
    scene.add(figure);

    let raf;
    let prev = performance.now();
    let auraPhase = Math.random() * 6.28;
    let yaw = 0;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      auraPhase += dt;
      // Slow turntable + subtle idle bob — figure breathes once every
      // ~3 seconds. Enough motion to feel alive without distracting from
      // the lobby's primary actions.
      yaw += dt * 0.35;
      figure.rotation.y = yaw;
      figure.position.y = Math.sin(auraPhase * 2.1) * 0.04;

      // Replay astronaut-specific animations so the LED / visor / pilot
      // thrusters all stay alive on the lobby display.
      const astro = built.astro;
      if (astro) {
        if (astro.led) {
          const beat = Math.max(0, Math.sin(auraPhase * Math.PI));
          astro.led.color.setRGB(0.05 + 0.95 * beat, 0.95, 0.25 + 0.15 * beat);
        }
        if (astro.shine) {
          astro.shine.position.x = -0.10 + 0.15 * Math.sin(auraPhase * 1.2);
          astro.shine.material.opacity = 0.30 + 0.25 * (0.5 + 0.5 * Math.sin(auraPhase * 2.4));
        }
        // Gentle idle thrust on the lobby display — flames flicker
        // without ever ramping up (no movement to drive intensity).
        const flicker = 0.85 + 0.15 * Math.sin(auraPhase * 18);
        if (astro.flameL) {
          astro.flameL.scale.set(1.0, 0.45 * flicker, 1.0);
          astro.flameL.material.opacity = 0.42 * flicker;
        }
        if (astro.flameR) {
          astro.flameR.scale.set(1.0, 0.45 * (1.95 - flicker), 1.0);
          astro.flameR.material.opacity = 0.42 * (1.95 - flicker);
        }
      }

      // Aura ring animation (pulse / spin only — same simplified subset
      // the shop preview uses).
      const aura = built.aura;
      if (aura) {
        const mode = aura.userData.mode;
        const inner = aura.userData.ringInner;
        const outer = aura.userData.ringOuter;
        const haloMesh  = aura.userData.halo;
        if (mode === "pulse") {
          const p = 0.5 + 0.5 * Math.sin(auraPhase * 3.2);
          if (inner) inner.material.opacity = 0.35 + p * 0.5;
          if (outer) outer.material.opacity = 0.15 + p * 0.35;
          if (haloMesh)  haloMesh.material.opacity  = 0.08 + p * 0.14;
        } else if (mode === "spin") {
          if (inner) inner.rotation.z += dt * 1.8;
          if (outer) outer.rotation.z -= dt * 1.2;
        }
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Resize: re-fit canvas to host whenever the column reflows.
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // Re-mount whenever the equipped skin changes so the lobby reflects
    // the new cosmetic instantly without a full page reload.
  }, [skinId]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full block group focus:outline-none"
      data-testid="lobby-character-display"
      title="Open the shop to change your skin"
      aria-label={`Your equipped skin${username ? ` for ${username}` : ""}`}
    >
      <div
        ref={hostRef}
        className="w-full"
        style={{ height: "min(56vh, 460px)", minHeight: 320 }}
        data-testid="lobby-character-display-canvas"
      />
      {/* Caption with username + a "Customize" hint that pops on hover.
          Stays under the canvas so it never overlaps the figure. */}
      <div className="mt-2 flex items-baseline justify-between px-1">
        <div className="font-anton uppercase tracking-widest text-sm text-[#FFD700] text-pow-shadow-sm">
          {username || "Player"}
        </div>
        <div className="font-anton uppercase tracking-widest text-[10px] text-white/60 group-hover:text-[#FFD700] transition-colors">
          Tap to customize →
        </div>
      </div>
    </button>
  );
}
