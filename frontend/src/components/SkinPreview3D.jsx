/* SkinPreview3D — full-3D rotating turntable preview for a single skin.
   Opens from the shop card's "PREVIEW IN 3D" button. Mounts a small
   Three.js scene with the actual humanoid mesh GameEngine builds during
   gameplay (including astronaut-specific extras: thrusters, antenna,
   LED, visor shine) so the player sees exactly what they'd be paying
   for, animations and all.

   Idle = slow turntable rotation. While the user click-drags inside the
   canvas the rotation pauses and follows the cursor (Phantom-Forces-
   style inspection). Releasing the mouse resumes the auto-spin.

   The hosting modal is full-screen overlaid above the shop modal
   (z-[80]) and dismisses on outside-click / Escape / explicit Close. */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { X, RotateCcw } from "lucide-react";
import { GameEngine } from "@/game/engine";

export default function SkinPreview3D({ open, skin, onClose }) {
  const hostRef = useRef(null);
  // Auto-spin starts on every open; manual drag pauses it. State is
  // tracked in refs so it doesn't tear through the animation loop.
  const autoSpinRef = useRef(true);
  const yawRef = useRef(0);
  const speedRef = useRef(0); // movingSpeed analog so thrusters can flare
  const [boostActive, setBoostActive] = useState(false);

  useEffect(() => {
    if (!open || !skin || !hostRef.current) return;
    const host = hostRef.current;
    const width  = host.clientWidth;
    const height = host.clientHeight;

    // -- Scene + renderer --
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a14);
    // Soft warm key + cool fill so the suit reads dimensional rather than
    // flat-cartoon (which is the in-game intent, but the shop preview
    // benefits from richer lighting to sell the detail).
    const key = new THREE.DirectionalLight(0xfff2c8, 1.0);
    key.position.set(2.5, 3.5, 2.0);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6aa0ff, 0.45);
    fill.position.set(-2.0, 1.5, -1.5);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    // Soft floor disc so the figure isn't floating in void.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 48),
      new THREE.MeshBasicMaterial({ color: 0x1a1a26, transparent: true, opacity: 0.7 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.05;
    scene.add(floor);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    camera.position.set(0, 1.55, 3.6);
    camera.lookAt(0, 1.0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);

    // -- Build the actual in-game humanoid mesh --
    const built = GameEngine.buildHumanoidForPreview(skin);
    const figure = built.group;
    figure.position.y = 0;
    scene.add(figure);

    // -- Pointer drag for manual inspection --
    let dragging = false;
    let lastX = 0;
    const onDown = (e) => {
      dragging = true;
      autoSpinRef.current = false;
      lastX = (e.touches ? e.touches[0].clientX : e.clientX);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      yawRef.current -= (x - lastX) * 0.012;
      lastX = x;
    };
    const onUp = () => {
      dragging = false;
      // Resume auto-spin after a beat so the figure doesn't immediately
      // fight the user's last gesture.
      setTimeout(() => { autoSpinRef.current = true; }, 1500);
    };
    renderer.domElement.addEventListener("mousedown", onDown);
    renderer.domElement.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);

    // -- Animation loop --
    let raf;
    let prev = performance.now();
    let auraPhase = 0;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      auraPhase += dt;
      if (autoSpinRef.current) yawRef.current += dt * 0.6;
      figure.rotation.y = yawRef.current;
      // Apply the same per-frame animation logic as the main engine —
      // copied minimal subset so the preview shows live LED/visor/
      // thruster animations. `speedRef` simulates `movingSpeed` (0..5.5)
      // so the BOOST button can flare the jetpack.
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
        const intensity = Math.min(1.0, speedRef.current * 0.18);
        const flicker = 0.85 + 0.15 * Math.sin(auraPhase * 18);
        const baseScale = 0.55 + intensity * 1.1;
        if (astro.flameL) {
          astro.flameL.scale.set(1.0, baseScale * flicker, 1.0);
          astro.flameL.material.opacity = (0.55 + intensity * 0.35) * flicker;
        }
        if (astro.flameR) {
          astro.flameR.scale.set(1.0, baseScale * (1.95 - flicker), 1.0);
          astro.flameR.material.opacity = (0.55 + intensity * 0.35) * (1.95 - flicker);
        }
      }
      // Aura ring animation — copy the spin/pulse modes only (the shop
      // preview doesn't need flame/frost/comet edge-cases).
      const aura = built.aura;
      if (aura) {
        const mode = aura.userData.mode;
        const inner = aura.userData.ringInner;
        const outer = aura.userData.ringOuter;
        const halo  = aura.userData.halo;
        if (mode === "pulse") {
          const p = 0.5 + 0.5 * Math.sin(auraPhase * 3.2);
          if (inner) inner.material.opacity = 0.35 + p * 0.5;
          if (outer) outer.material.opacity = 0.15 + p * 0.35;
          if (halo)  halo.material.opacity  = 0.08 + p * 0.14;
        } else if (mode === "spin") {
          if (inner) inner.rotation.z += dt * 1.8;
          if (outer) outer.rotation.z -= dt * 1.2;
        }
      }
      // Decay simulated speed back to idle.
      speedRef.current = Math.max(0, speedRef.current - dt * 4);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // -- Resize handler --
    const onResize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("mousedown", onDown);
      renderer.domElement.removeEventListener("touchstart", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [open, skin]);

  // ESC + outside-click dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !skin) return null;
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3"
      data-testid="skin-preview-3d-modal"
      onClick={onClose}
    >
      <div
        className="card-pow w-[min(720px,96vw)] max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between">
          <div className="font-display text-2xl">
            <span className="text-[#FFD700]">PREVIEW</span>
            <span className="opacity-60 mx-2">·</span>
            <span>{skin.name}</span>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white"
            data-testid="skin-preview-3d-close"
            aria-label="Close preview"
          >
            <X size={22} strokeWidth={3} />
          </button>
        </div>
        <div
          ref={hostRef}
          className="bg-[#0a0a14] w-full"
          style={{ height: "min(60vh, 480px)" }}
          data-testid="skin-preview-3d-canvas-host"
        />
        <div className="bg-white px-4 py-3 flex items-center justify-between gap-3 border-t-2 border-black">
          <div className="font-anton uppercase tracking-widest text-xs text-neutral-600">
            Drag to inspect · auto-rotates when released
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                // Boost = simulate forward sprint so astronaut thrusters
                // flare like in-game. Held effect lasts ~0.8s thanks to
                // the speed decay in the animation loop.
                speedRef.current = 6.0;
                setBoostActive(true);
                setTimeout(() => setBoostActive(false), 800);
              }}
              className={`btn-pow [&]:px-3 [&]:py-1.5 [&]:text-xs flex items-center gap-1 ${
                boostActive ? "bg-[#FF7A2A] text-white" : "bg-[#FFD700] text-black"
              }`}
              data-testid="skin-preview-3d-boost"
            >
              <RotateCcw size={12} strokeWidth={3} /> THRUST
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
