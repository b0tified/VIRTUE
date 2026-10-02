import { useEffect, useState } from "react";
import { Download, CheckCircle2 } from "lucide-react";

/* InstallButton — shows up only when the browser fires `beforeinstallprompt`
   (Chromium-based browsers + Edge). Falls back to a small "How to install"
   hint on Safari/iOS where the prompt isn't available. */
export default function InstallButton({ className = "", variant = "primary" }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showSafariHint, setShowSafariHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Detect: already running as installed PWA?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) {
      // No native prompt available (Safari, Firefox desktop in some cases) —
      // show a tiny how-to hint.
      setShowSafariHint(true);
      return;
    }
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {}
    setDeferredPrompt(null);
  };

  if (installed) {
    return (
      <button
        type="button"
        disabled
        className={`btn-pow bg-[#06A35F] text-white opacity-90 cursor-default ${className}`}
        data-testid="install-installed-badge"
      >
        <span className="flex items-center gap-2">
          <CheckCircle2 size={18} strokeWidth={3} /> INSTALLED
        </span>
      </button>
    );
  }

  const bg = variant === "primary" ? "bg-[#0055FF] text-white" : "bg-white text-black";
  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={install}
        className={`btn-pow ${bg}`}
        data-testid="install-app-button"
        aria-label="Install VIRTUE as a desktop app"
      >
        <span className="flex items-center gap-2">
          <Download size={18} strokeWidth={3} /> INSTALL APP
        </span>
      </button>
      {showSafariHint && (
        <div
          className="absolute top-full left-0 mt-2 z-50 w-72 card-pow p-3 text-xs font-body bg-white"
          data-testid="install-safari-hint"
          role="dialog"
        >
          <div className="font-anton uppercase tracking-widest text-sm mb-1">Install on this browser</div>
          <p className="text-neutral-700">
            Open the browser <strong>Share</strong> menu and tap{" "}
            <strong>"Add to Home Screen"</strong> (iOS) or{" "}
            <strong>"Install app"</strong> (desktop ⋮ menu).
          </p>
          <button
            onClick={() => setShowSafariHint(false)}
            className="btn-pow bg-black text-white mt-2 !py-1 !px-2 text-xs"
            data-testid="install-hint-dismiss"
          >
            GOT IT
          </button>
        </div>
      )}
    </div>
  );
}
