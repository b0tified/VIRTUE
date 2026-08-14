/* useIsMobile — cheap, one-shot mobile / low-power device detector.
 *
 * "Mobile" here is a *performance* signal, not a form-factor one — we
 * use it to disable expensive CSS-filter animations and pause heavy
 * cosmetic effects in the lobby. Anything that reports a touch primary
 * (no fine hover / no pointer) is treated as mobile, plus a hard
 * viewport-width fallback so desktop devtools' "responsive mode" also
 * triggers the light path.
 *
 * The value is captured once at mount and cached — we don't listen for
 * resize because the point is to keep the lobby simple; a user rotating
 * from portrait to landscape doesn't need the heavy backdrop to
 * suddenly kick in. Callers who need reactive behaviour can wire their
 * own matchMedia listener on top of this.
 */
import { useState } from "react";

export function detectIsMobile() {
  if (typeof window === "undefined") return false;
  const touch = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
  // Primary input coarse (touchscreen) or no hover ability → treat as mobile.
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const noHover = window.matchMedia?.("(hover: none)")?.matches ?? false;
  // Hard viewport fallback so DevTools' phone preview + narrow windows
  // also drop into the light path (< 900px wide).
  const narrow = (window.innerWidth || 0) < 900;
  return touch || coarse || noHover || narrow;
}

export default function useIsMobile() {
  const [isMobile] = useState(detectIsMobile);
  return isMobile;
}
