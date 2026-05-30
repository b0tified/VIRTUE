import { useEffect, useState } from "react";

/* Forces the game to behave as a landscape-only experience on mobile.
   Two layers:
     1) Active lock via the Screen Orientation API — works when the page is
        installed as a PWA OR when it's running in fullscreen (Android Chrome).
        Re-attempted on every fullscreenchange so the lock survives the
        user toggling fullscreen mid-game.
     2) CSS-driven "rotate your device" overlay — shown whenever the
        viewport is taller than it is wide AND it's a phone-sized screen.
        Tablets in portrait (>= 900px short edge) keep the regular UI.

   Desktop browsers ignore the orientation lock silently — that's fine,
   the overlay only triggers under the phone-size media query. */
export default function OrientationLock() {
  const [forcePortrait, setForcePortrait] = useState(false);

  useEffect(() => {
    const tryLock = () => {
      try {
        const sl = window.screen?.orientation;
        if (sl && typeof sl.lock === "function") {
          sl.lock("landscape").catch(() => {
            // Most browsers reject without a current user gesture +
            // fullscreen — fine, we silently fall back to the overlay.
          });
        }
      } catch {}
    };
    tryLock();

    const onFsChange = () => tryLock();
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);

    const evaluate = () => {
      // Phone-sized portrait detection. We use the smaller edge as the
      // "device width" proxy so a tablet in portrait (e.g. iPad: 768 short
      // edge) doesn't trigger the rotate overlay.
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isPortrait = h > w;
      const shortEdge = Math.min(w, h);
      // Only nag phones (<900 short edge). Above that we trust the user
      // to be on a tablet/desktop and they can use portrait if they want.
      setForcePortrait(isPortrait && shortEdge < 900);
    };
    evaluate();
    window.addEventListener("resize", evaluate);
    window.addEventListener("orientationchange", evaluate);

    return () => {
      window.removeEventListener("resize", evaluate);
      window.removeEventListener("orientationchange", evaluate);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  if (!forcePortrait) return null;
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black text-white px-6 text-center select-none"
      data-testid="rotate-device-overlay"
    >
      <div className="space-y-4 max-w-sm">
        <div className="text-5xl animate-pulse" aria-hidden>↻</div>
        <h2 className="font-display text-4xl tracking-wide text-[#E62429]" style={{ textShadow: "3px 3px 0 #000" }}>
          ROTATE YOUR DEVICE
        </h2>
        <p className="font-anton uppercase tracking-widest text-sm text-neutral-300">
          VIRTUE plays best in landscape. Turn your phone sideways to continue.
        </p>
      </div>
    </div>
  );
}
