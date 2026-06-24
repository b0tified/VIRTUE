/* useButtonSounds — global mouseenter listener that plays a tiny
   per-button audio blip whenever the cursor hovers a comic-book
   button. Each button gets its own pitch + timbre derived from its
   data-testid (or text content fallback) so sweeping across a row
   plays a small melody instead of a single repeating chirp.

   Implementation notes:
     - Event delegation on `document` means we don't have to wire a
       handler onto every individual button.
     - Throttled to 80ms so dragging across stacked buttons fires
       only the first chirp, not five overlapping ones.
     - Skipped while pointer is locked (in-match) and on disabled
       buttons.
     - Auto-disable from settings: same `audioBus.sfxMuted` flag the
       gameplay sounds respect. */
import { useEffect } from "react";
import audioBus from "@/game/audio";

const HOVER_THROTTLE_MS = 80;

/** djb2-style 32-bit hash of an arbitrary string. Deterministic so
 *  the same button always gets the same pitch. */
function _hashSeed(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function useButtonSounds() {
  useEffect(() => {
    let lastFiredAt = 0;
    let lastBtn = null;  // skip repeat-fires for the same button
    const onEnter = (e) => {
      if (document.pointerLockElement) return;
      const target = e.target;
      if (!target || !(target instanceof Element)) return;
      const btn = target.closest?.(".btn-pow");
      if (!btn) return;
      if (btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true") return;
      const now = performance.now();
      if (now - lastFiredAt < HOVER_THROTTLE_MS) return;
      // Suppress chirps on the same hovered element (cursor moving
      // inside the button shouldn't re-fire).
      if (lastBtn === btn && now - lastFiredAt < 600) return;
      lastBtn = btn;
      lastFiredAt = now;
      // Derive a stable seed from the button's identity. Preference
      // order: data-testid (most stable) > text content > href.
      const id = btn.getAttribute("data-testid") || (btn.textContent || "").trim() || btn.getAttribute("href") || "btn";
      audioBus.playUIBlip(_hashSeed(id));
    };
    document.addEventListener("mouseover", onEnter, true);
    return () => document.removeEventListener("mouseover", onEnter, true);
  }, []);
}
