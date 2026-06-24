/* useButtonSounds — global mouseenter listener that plays a tiny
   audio blip whenever the cursor hovers a comic-book button.

   Implementation notes:
     - Event delegation on `document` means we don't have to wire a
       handler onto every individual button — any element with a
       `.btn-pow` class (the project-wide button mixin defined in
       index.css) inherits the sound for free.
     - Throttled to 80ms so dragging the cursor across a stacked row
       of buttons fires only the first chirp, not five overlapping
       ones.
     - Skipped while pointer is locked (in-match) because the user
       isn't navigating UI then and a stray chirp would be jarring.
     - Auto-disable from settings: same `audioBus.sfxMuted` flag the
       gameplay sounds respect, so the SFX toggle in the settings
       modal silences these too. */
import { useEffect } from "react";
import audioBus from "@/game/audio";

const HOVER_THROTTLE_MS = 80;

export default function useButtonSounds() {
  useEffect(() => {
    let lastFiredAt = 0;
    const onEnter = (e) => {
      // Skip while the user is locked into the FPS canvas.
      if (document.pointerLockElement) return;
      const target = e.target;
      if (!target || !(target instanceof Element)) return;
      // Only trigger on the actual button (or its closest ancestor)
      // so child <span>/<svg> mouseenters don't double-fire.
      const btn = target.closest?.(".btn-pow");
      if (!btn) return;
      // Disabled buttons get no sound.
      if (btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true") return;
      const now = performance.now();
      if (now - lastFiredAt < HOVER_THROTTLE_MS) return;
      lastFiredAt = now;
      audioBus.playUIBlip();
    };
    // `mouseover` bubbles (mouseenter does not) so the delegated
    // listener catches every button regardless of where in the
    // subtree the cursor crossed.
    document.addEventListener("mouseover", onEnter, true);
    return () => document.removeEventListener("mouseover", onEnter, true);
  }, []);
}
