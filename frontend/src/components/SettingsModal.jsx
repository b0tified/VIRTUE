import { useEffect, useState } from "react";
import { X, RotateCcw, Settings as SettingsIcon } from "lucide-react";
import settingsStore from "@/game/settings";

const GRAPHICS_OPTIONS = [
  { value: "low",    label: "Low",    note: "Best FPS. Lower render resolution." },
  { value: "medium", label: "Medium", note: "Balanced. 1.0× resolution." },
  { value: "high",   label: "High",   note: "Sharpest. Up to 2× device pixel ratio." },
];

const FPS_OPTIONS = [
  { value: 0,   label: "Unlimited" },
  { value: 30,  label: "30" },
  { value: 60,  label: "60" },
  { value: 120, label: "120" },
  { value: 144, label: "144" },
];

const TOUCH_OPTIONS = [
  { value: "auto", label: "Auto (touch devices only)" },
  { value: "on",   label: "Always on" },
  { value: "off",  label: "Off" },
];

export default function SettingsModal({ open, onClose }) {
  const [s, setS] = useState(settingsStore.get());

  // Stay synced if anything else changes the store mid-open.
  useEffect(() => {
    return settingsStore.subscribe((next) => setS(next));
  }, []);

  if (!open) return null;

  const patch = (p) => settingsStore.set(p);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      data-testid="settings-modal"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-lg max-w-lg w-full text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-800">
          <SettingsIcon size={18} strokeWidth={2.5} className="text-[#E62429]" />
          <div className="font-anton uppercase tracking-widest flex-1">Settings</div>
          <button
            onClick={() => settingsStore.reset()}
            className="text-xs text-neutral-400 hover:text-white flex items-center gap-1"
            data-testid="settings-reset"
            title="Restore defaults"
          >
            <RotateCcw size={12} strokeWidth={3} /> Reset
          </button>
          <button onClick={onClose} className="text-neutral-400 hover:text-white" data-testid="settings-close">
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Graphics quality */}
          <section>
            <div className="font-anton uppercase tracking-widest text-sm mb-2">Graphics Quality</div>
            <div className="grid grid-cols-3 gap-2" data-testid="settings-graphics">
              {GRAPHICS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => patch({ graphics: o.value })}
                  className={`text-left rounded border px-3 py-2 transition-colors ${
                    s.graphics === o.value
                      ? "border-[#E62429] bg-[#E62429]/15"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`settings-graphics-${o.value}`}
                >
                  <div className="font-anton uppercase tracking-widest text-sm">{o.label}</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">{o.note}</div>
                </button>
              ))}
            </div>
          </section>

          {/* FPS Cap */}
          <section>
            <div className="font-anton uppercase tracking-widest text-sm mb-2">FPS Cap</div>
            <div className="flex flex-wrap gap-2" data-testid="settings-fps">
              {FPS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => patch({ fpsCap: o.value })}
                  className={`rounded border px-3 py-1.5 text-sm font-anton uppercase tracking-widest transition-colors ${
                    s.fpsCap === o.value
                      ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`settings-fps-${o.value || "unlimited"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500 mt-1">
              Locks frame rate. Useful on laptops to save battery / heat.
            </p>
          </section>

          {/* FOV */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm">Field of View</div>
              <div className="text-sm tabular-nums" data-testid="settings-fov-value">{s.fovDegrees}°</div>
            </div>
            <input
              type="range"
              min="60"
              max="100"
              step="1"
              value={s.fovDegrees}
              onChange={(e) => patch({ fovDegrees: parseInt(e.target.value, 10) })}
              className="w-full accent-[#E62429]"
              data-testid="settings-fov-slider"
            />
          </section>

          {/* Touch controls */}
          <section>
            <div className="font-anton uppercase tracking-widest text-sm mb-2">Touch Controls</div>
            <div className="grid grid-cols-1 gap-2" data-testid="settings-touch">
              {TOUCH_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={`flex items-center gap-2 rounded border px-3 py-2 cursor-pointer transition-colors ${
                    s.touchControls === o.value
                      ? "border-[#0055FF] bg-[#0055FF]/15"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`settings-touch-${o.value}`}
                >
                  <input
                    type="radio"
                    name="touchControls"
                    checked={s.touchControls === o.value}
                    onChange={() => patch({ touchControls: o.value })}
                    className="accent-[#0055FF]"
                  />
                  <span className="text-sm">{o.label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Visual toggles */}
          <section className="space-y-2">
            <ToggleRow
              label="Aim Assist (controller / touch)"
              note="Soft snap toward the nearest enemy in your aim cone."
              checked={!!s.aimAssist}
              onChange={(v) => patch({ aimAssist: v })}
              testid="settings-aim-assist"
            />
            <ToggleRow
              label="Shadows"
              note="Soft shadows under players and props."
              checked={!!s.shadows}
              onChange={(v) => patch({ shadows: v })}
              testid="settings-shadows"
            />
            <ToggleRow
              label="Anti-aliasing"
              note="Smooth jagged edges. Slightly higher GPU cost."
              checked={!!s.antialias}
              onChange={(v) => patch({ antialias: v })}
              testid="settings-antialias"
            />
          </section>

          <p className="text-[11px] text-neutral-500 pt-1">
            Settings save to this device only.
          </p>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, note, checked, onChange, testid }) {
  return (
    <label
      className="flex items-center justify-between gap-3 rounded border border-neutral-800 hover:border-neutral-700 px-3 py-2 cursor-pointer"
      data-testid={testid}
    >
      <div>
        <div className="font-anton uppercase tracking-widest text-sm">{label}</div>
        <div className="text-[11px] text-neutral-400">{note}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-[#06A35F]" : "bg-neutral-700"}`}
        data-testid={`${testid}-toggle`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}
