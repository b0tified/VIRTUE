// AdvancedControls — keybinds, controller binds, and mobile HUD layout editor.
// Mounted as a section inside SettingsModal. All values persist to
// settingsStore (localStorage).
import { useEffect, useState, useRef } from "react";
import settingsStore from "@/game/settings";
import { Keyboard, Gamepad2, Smartphone, RotateCcw, Move, Check, X } from "lucide-react";

const KEYBIND_ACTIONS = [
  { id: "forward",    label: "Forward" },
  { id: "back",       label: "Back" },
  { id: "left",       label: "Strafe Left" },
  { id: "right",      label: "Strafe Right" },
  { id: "jump",       label: "Jump" },
  { id: "sprint",     label: "Sprint" },
  { id: "crouch",     label: "Crouch" },
  { id: "reload",     label: "Reload" },
  { id: "melee",      label: "Melee" },
  { id: "adsToggle",  label: "ADS Toggle" },
  { id: "weapon1",    label: "Weapon 1 (AK)" },
  { id: "weapon2",    label: "Weapon 2 (Melee)" },
  { id: "weapon3",    label: "Weapon 3 (Laser)" },
  { id: "scoreboard", label: "Scoreboard" },
];

const CONTROLLER_ACTIONS = [
  { id: "jump",        label: "Jump",          defaultIdx: 0,  defaultName: "A" },
  { id: "reload",      label: "Reload",        defaultIdx: 1,  defaultName: "B" },
  { id: "melee",       label: "Melee",         defaultIdx: 2,  defaultName: "X" },
  { id: "weaponCycle", label: "Weapon Cycle",  defaultIdx: 3,  defaultName: "Y" },
  { id: "ads",         label: "Aim",           defaultIdx: 6,  defaultName: "LT" },
  { id: "shoot",       label: "Shoot",         defaultIdx: 7,  defaultName: "RT" },
  { id: "weaponPrev",  label: "Weapon Prev",   defaultIdx: 4,  defaultName: "LB" },
  { id: "weaponNext",  label: "Weapon Next",   defaultIdx: 5,  defaultName: "RB" },
];

// Standard Xbox/PS button index → friendly label (for the read-back display).
const XBOX_BUTTON_NAMES = [
  "A", "B", "X", "Y",            // 0-3
  "LB", "RB", "LT", "RT",         // 4-7
  "Back", "Start",                // 8-9
  "LS", "RS",                     // 10-11
  "DPad ↑", "DPad ↓", "DPad ←", "DPad →", // 12-15
];

function friendlyKey(code) {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "SPACE";
  if (code === "ShiftLeft") return "L-SHIFT";
  if (code === "ShiftRight") return "R-SHIFT";
  if (code === "ControlLeft") return "L-CTRL";
  if (code === "ControlRight") return "R-CTRL";
  if (code === "AltLeft") return "L-ALT";
  if (code === "AltRight") return "R-ALT";
  if (code === "Tab") return "TAB";
  if (code === "Enter") return "ENTER";
  if (code === "Backquote") return "`";
  if (code.startsWith("Arrow")) return code.replace("Arrow", "").toUpperCase();
  return code.toUpperCase();
}

function friendlyButton(idx) {
  if (idx == null || !Number.isFinite(idx)) return "—";
  return XBOX_BUTTON_NAMES[idx] || `BTN ${idx}`;
}

export default function AdvancedControls({ s, patch }) {
  return (
    <div className="space-y-6" data-testid="advanced-controls">
      <KeybindsSection s={s} patch={patch} />
      <ControllerSection s={s} patch={patch} />
      <MobileHudSection s={s} patch={patch} />
    </div>
  );
}

function KeybindsSection({ s, patch }) {
  const binds = s.keybinds || {};
  const [listening, setListening] = useState(null); // action id

  useEffect(() => {
    if (!listening) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setListening(null);
        return;
      }
      const next = { ...binds, [listening]: e.code };
      patch({ keybinds: next });
      setListening(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [listening, binds, patch]);

  const resetBinds = () => patch({ keybinds: { ...settingsStore.DEFAULTS.keybinds } });

  return (
    <section data-testid="settings-keybinds">
      <div className="flex items-center gap-2 mb-2">
        <Keyboard size={16} strokeWidth={3} className="text-[#FFD700]" />
        <div className="font-anton uppercase tracking-widest text-sm flex-1">Keyboard Binds</div>
        <button
          type="button"
          onClick={resetBinds}
          className="text-xs text-neutral-400 hover:text-white flex items-center gap-1"
          data-testid="settings-keybinds-reset"
        >
          <RotateCcw size={12} strokeWidth={3} /> Reset
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {KEYBIND_ACTIONS.map((a) => {
          const isListening = listening === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setListening(a.id)}
              className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-left transition-colors ${
                isListening
                  ? "border-[#FFD700] bg-[#FFD700]/20 animate-pulse"
                  : "border-neutral-800 hover:border-neutral-700"
              }`}
              data-testid={`settings-keybind-${a.id}`}
            >
              <span className="text-sm truncate">{a.label}</span>
              <span className="font-anton uppercase tracking-widest text-xs px-2 py-0.5 border border-neutral-700 rounded text-[#FFD700]">
                {isListening ? "Press key…" : friendlyKey(binds[a.id])}
              </span>
            </button>
          );
        })}
      </div>
      {listening && (
        <p className="text-[11px] text-neutral-400 mt-2">
          Press a key to bind <span className="text-[#FFD700] font-anton uppercase">{KEYBIND_ACTIONS.find((a) => a.id === listening)?.label}</span>. ESC to cancel.
        </p>
      )}
    </section>
  );
}

function ControllerSection({ s, patch }) {
  const binds = s.controllerBinds || {};
  const [listening, setListening] = useState(null);
  const prevButtonsRef = useRef([]);

  useEffect(() => {
    if (!listening) return;
    let raf = 0;
    const poll = () => {
      const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
      const gp = Array.from(pads).find((p) => p && p.connected);
      if (gp) {
        const cur = gp.buttons || [];
        const prev = prevButtonsRef.current;
        for (let i = 0; i < cur.length; i++) {
          const wasDown = prev[i];
          const isDown = !!cur[i]?.pressed;
          if (isDown && !wasDown) {
            const next = { ...binds, [listening]: i };
            patch({ controllerBinds: next });
            setListening(null);
            prevButtonsRef.current = cur.map((b) => !!b.pressed);
            return;
          }
        }
        prevButtonsRef.current = cur.map((b) => !!b.pressed);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [listening, binds, patch]);

  const resetBinds = () => patch({ controllerBinds: { ...settingsStore.DEFAULTS.controllerBinds } });

  return (
    <section data-testid="settings-controller">
      <div className="flex items-center gap-2 mb-2">
        <Gamepad2 size={16} strokeWidth={3} className="text-[#06A35F]" />
        <div className="font-anton uppercase tracking-widest text-sm flex-1">Controller Binds</div>
        <button
          type="button"
          onClick={resetBinds}
          className="text-xs text-neutral-400 hover:text-white flex items-center gap-1"
          data-testid="settings-controller-reset"
        >
          <RotateCcw size={12} strokeWidth={3} /> Reset
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {CONTROLLER_ACTIONS.map((a) => {
          const isListening = listening === a.id;
          const idx = Number.isFinite(binds[a.id]) ? binds[a.id] : a.defaultIdx;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setListening(a.id)}
              className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-left transition-colors ${
                isListening
                  ? "border-[#06A35F] bg-[#06A35F]/20 animate-pulse"
                  : "border-neutral-800 hover:border-neutral-700"
              }`}
              data-testid={`settings-controller-${a.id}`}
            >
              <span className="text-sm truncate">{a.label}</span>
              <span className="font-anton uppercase tracking-widest text-xs px-2 py-0.5 border border-neutral-700 rounded text-[#06A35F]">
                {isListening ? "Press button…" : friendlyButton(idx)}
              </span>
            </button>
          );
        })}
      </div>
      {listening && (
        <p className="text-[11px] text-neutral-400 mt-2">
          Press a controller button to bind <span className="text-[#06A35F] font-anton uppercase">{CONTROLLER_ACTIONS.find((a) => a.id === listening)?.label}</span>. Click anywhere else to cancel.
        </p>
      )}
    </section>
  );
}

const HUD_ELEMENTS = [
  { id: "move",       label: "Move Stick",      color: "#0055FF" },
  { id: "actions",    label: "Action Buttons",  color: "#E62429" },
  { id: "weapons",    label: "Weapon Switch",   color: "#FFD700" },
  { id: "scoreboard", label: "Scoreboard Btn",  color: "#9B59B6" },
];

function MobileHudSection({ s, patch }) {
  const layout = s.hudLayout || {};
  const [active, setActive] = useState(HUD_ELEMENTS[0].id);

  const update = (id, patchObj) => {
    const next = { ...layout, [id]: { ...layout[id], ...patchObj } };
    patch({ hudLayout: next });
  };

  const resetLayout = () => patch({ hudLayout: { ...settingsStore.DEFAULTS.hudLayout } });

  const cur = layout[active] || settingsStore.DEFAULTS.hudLayout[active] || { x: 0, y: 0, scale: 1, opacity: 1 };

  return (
    <section data-testid="settings-mobile-hud">
      <div className="flex items-center gap-2 mb-2">
        <Smartphone size={16} strokeWidth={3} className="text-[#9B59B6]" />
        <div className="font-anton uppercase tracking-widest text-sm flex-1">Mobile HUD Layout</div>
        <button
          type="button"
          onClick={resetLayout}
          className="text-xs text-neutral-400 hover:text-white flex items-center gap-1"
          data-testid="settings-hud-reset"
        >
          <RotateCcw size={12} strokeWidth={3} /> Reset
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {HUD_ELEMENTS.map((el) => (
          <button
            key={el.id}
            type="button"
            onClick={() => setActive(el.id)}
            className={`rounded border px-3 py-2 text-left transition-colors ${
              active === el.id
                ? "border-white bg-white/10"
                : "border-neutral-800 hover:border-neutral-700"
            }`}
            data-testid={`settings-hud-element-${el.id}`}
          >
            <div className="flex items-center gap-2">
              <Move size={12} strokeWidth={3} style={{ color: el.color }} />
              <span className="font-anton uppercase tracking-widest text-xs">{el.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Sliders for active element */}
      <div className="space-y-2.5">
        <Slider
          label="Offset X"
          min={0}
          max={200}
          step={2}
          value={cur.x ?? 0}
          onChange={(v) => update(active, { x: v })}
          unit="px"
          testid={`settings-hud-x-${active}`}
        />
        <Slider
          label="Offset Y"
          min={0}
          max={200}
          step={2}
          value={cur.y ?? 0}
          onChange={(v) => update(active, { y: v })}
          unit="px"
          testid={`settings-hud-y-${active}`}
        />
        <Slider
          label="Size"
          min={0.6}
          max={1.6}
          step={0.05}
          value={cur.scale ?? 1.0}
          onChange={(v) => update(active, { scale: parseFloat(v.toFixed(2)) })}
          unit="×"
          testid={`settings-hud-scale-${active}`}
        />
        <Slider
          label="Opacity"
          min={0.2}
          max={1.0}
          step={0.05}
          value={cur.opacity ?? 1.0}
          onChange={(v) => update(active, { opacity: parseFloat(v.toFixed(2)) })}
          unit=""
          testid={`settings-hud-opacity-${active}`}
        />
      </div>
      <p className="text-[11px] text-neutral-500 mt-2">
        Tweaks apply only on touch devices. Changes preview live in-game.
      </p>
    </section>
  );
}

function Slider({ label, min, max, step, value, onChange, unit, testid }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="font-anton uppercase tracking-widest text-xs">{label}</div>
        <div className="text-xs tabular-nums" data-testid={`${testid}-value`}>
          {typeof value === "number" ? (Number.isInteger(value) ? value : value.toFixed(2)) : value}{unit}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#FFD700]"
        data-testid={testid}
      />
    </div>
  );
}

export { Check, X };
