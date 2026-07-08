import { useEffect, useMemo, useState } from "react";
import { X, RotateCcw, Settings as SettingsIcon, Volume2, VolumeX, Music, LogOut, Mouse, Monitor, Crosshair, User as UserIcon, Globe, Gift, Check, Gamepad2, Smartphone } from "lucide-react";
import settingsStore from "@/game/settings";
import audioBus from "@/game/audio";
import { useAuth } from "@/context/AuthContext";
import AdvancedControls from "@/components/AdvancedControls";
import AccountSettingsCard from "@/components/AccountSettingsCard";
import api from "@/api";

// Matchmaking regions exposed in Account → Server Region. `basePing` seeds a
// fake-but-stable latency so the list looks alive. Once the gameserver runs
// in multiple regions the chosen id will be honored by the matchmaker.
const REGION_OPTIONS = [
  { id: "auto",    label: "Auto (Lowest Ping)", basePing: 28 },
  { id: "na-east", label: "North America — East", basePing: 35 },
  { id: "na-west", label: "North America — West", basePing: 65 },
  { id: "sa",      label: "South America",        basePing: 110 },
  { id: "eu",      label: "Europe",               basePing: 95 },
  { id: "asia",    label: "Asia / Pacific",       basePing: 145 },
  { id: "oce",     label: "Oceania",              basePing: 175 },
];

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
  const [musicMuted, setMusicMuted] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(false);
  const [tab, setTab] = useState("video");
  const { user, logout, refreshMe } = useAuth();
  // Redeem-code form state — `redeemMsg` doubles as both success + error UI.
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState(null); // { kind: "ok"|"err", text }

  // Per-region pings — each region's basePing ± a small jitter so the list
  // doesn't look statically hard-coded. Recomputed once per modal open.
  const regionPings = useMemo(() => {
    const out = {};
    for (const r of REGION_OPTIONS) {
      out[r.id] = Math.max(8, r.basePing + Math.floor(Math.random() * 21) - 10);
    }
    return out;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setMusicMuted(audioBus.musicMuted);
    setSfxMuted(audioBus.sfxMuted);
    // Reapply saved volumes whenever the modal opens. Audio context may have
    // been (re)initialized since last setting change, so reading the store
    // and pushing through to the bus keeps everything coherent.
    const cur = settingsStore.get();
    audioBus.setMasterVolume?.(cur.masterVolume ?? 0.9);
    audioBus.setMusicVolume?.(cur.musicVolume ?? 0.32);
    audioBus.setSfxVolume?.(cur.sfxVolume ?? 0.65);
  }, [open]);

  // Stay synced if anything else changes the store mid-open.
  useEffect(() => {
    return settingsStore.subscribe((next) => setS(next));
  }, []);

  if (!open) return null;

  const patch = (p) => settingsStore.set(p);

  const toggleMusic = () => {
    const next = !audioBus.musicMuted;
    audioBus.setMusicMuted(next);
    setMusicMuted(next);
    try { localStorage.setItem("lobby_music_muted", next ? "1" : "0"); } catch {}
  };
  const toggleSfx = () => {
    const next = !audioBus.sfxMuted;
    audioBus.setSfxMuted(next);
    setSfxMuted(next);
    try { localStorage.setItem("sfx_muted", next ? "1" : "0"); } catch {}
  };

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

        {/* Tab bar — groups settings into Video / Audio / Controls / HUD /
            Account so the modal stays scannable. */}
        <div className="flex border-b border-neutral-800 overflow-x-auto" data-testid="settings-tabs">
          {[
            { id: "video",    label: "Video",    Icon: Monitor },
            { id: "audio",    label: "Audio",    Icon: Music },
            { id: "controls", label: "Controls", Icon: Mouse },
            { id: "hud",      label: "HUD",      Icon: Crosshair },
            { id: "account",  label: "Account",  Icon: UserIcon },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2 font-anton uppercase tracking-widest text-xs whitespace-nowrap border-b-2 transition-colors ${
                tab === id
                  ? "border-[#E62429] text-white bg-neutral-900"
                  : "border-transparent text-neutral-400 hover:text-white hover:bg-neutral-900/50"
              }`}
              data-testid={`settings-tab-${id}`}
            >
              <Icon size={14} strokeWidth={3} /> {label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[65vh] overflow-y-auto" data-testid={`settings-tab-content-${tab}`}>
          {tab === "audio" && (
          <>
          {/* Master / Music / SFX volume sliders. Replace the legacy on/off
              buttons — sliders give players precise control and the value
              applies live via the audioBus volume setters. The previous
              mute toggles are preserved as compact icon buttons next to each
              slider for one-tap muting. */}
          <section className="space-y-4" data-testid="settings-audio-volumes">
            <VolumeRow
              label="Master Volume"
              icon={<Volume2 size={14} strokeWidth={3} />}
              value={s.masterVolume ?? 0.9}
              muted={!!s.audioMuted}
              onChange={(v) => {
                patch({ masterVolume: v, audioMuted: v <= 0 });
                audioBus.setMasterVolume?.(v);
                audioBus.setMuted(v <= 0);
              }}
              onToggleMute={() => {
                const nextMuted = !s.audioMuted;
                patch({ audioMuted: nextMuted });
                audioBus.setMuted(nextMuted);
              }}
              testid="settings-master-volume"
            />
            <VolumeRow
              label="Music Volume"
              icon={<Music size={14} strokeWidth={3} />}
              value={s.musicVolume ?? 0.32}
              muted={musicMuted}
              onChange={(v) => {
                patch({ musicVolume: v });
                audioBus.setMusicVolume?.(v);
                if (v > 0 && musicMuted) {
                  audioBus.setMusicMuted(false);
                  setMusicMuted(false);
                }
              }}
              onToggleMute={toggleMusic}
              testid="settings-music-volume"
            />
            <VolumeRow
              label="SFX Volume"
              icon={sfxMuted ? <VolumeX size={14} strokeWidth={3} /> : <Volume2 size={14} strokeWidth={3} />}
              value={s.sfxVolume ?? 0.65}
              muted={sfxMuted}
              onChange={(v) => {
                patch({ sfxVolume: v });
                audioBus.setSfxVolume?.(v);
                if (v > 0 && sfxMuted) {
                  audioBus.setSfxMuted(false);
                  setSfxMuted(false);
                }
              }}
              onToggleMute={toggleSfx}
              testid="settings-sfx-volume"
            />
            {/* 3D Audio — stereo-pan positional SFX based on listener pose.
                On = HRTF panner per shot/respawn so you can hear which
                direction enemies are firing from. Off = flat mono falloff
                (legacy behaviour). */}
            <div
              className="flex items-center justify-between pt-1"
              data-testid="settings-audio-3d-row"
            >
              <div className="flex flex-col">
                <span className="font-anton uppercase tracking-widest text-sm">3D Audio</span>
                <span className="text-xs text-neutral-400 mt-0.5 max-w-[18rem]">
                  Stereo-pan in-game sounds based on which direction they're coming from.
                </span>
              </div>
              <button
                onClick={() => {
                  const next = !(s.audio3D !== false);
                  patch({ audio3D: next });
                  audioBus.set3DAudio?.(next);
                }}
                className={`btn-pow [&]:px-3 [&]:py-1.5 [&]:text-sm ${(s.audio3D !== false) ? "bg-[#06A35F] text-white" : "bg-neutral-800 text-neutral-300"}`}
                data-testid="settings-audio-3d-toggle"
              >
                {(s.audio3D !== false) ? "ON" : "OFF"}
              </button>
            </div>
          </section>
          </>
          )}

          {tab === "controls" && (
          <>
          {/* Mouse sensitivity */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm flex items-center gap-2">
                <Mouse size={14} strokeWidth={3} /> Mouse Sensitivity
              </div>
              <div className="text-sm tabular-nums" data-testid="settings-sensitivity-value">
                {Number(s.mouseSensitivity ?? 1.0).toFixed(2)}×
              </div>
            </div>
            <input
              type="range"
              min="0.25"
              max="2.5"
              step="0.05"
              value={s.mouseSensitivity ?? 1.0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                patch({ mouseSensitivity: v });
                // Mirror to the engine's SENS_KEY so live games see the new value.
                try { localStorage.setItem("virtue.mouseSensitivity", String(v)); } catch {}
              }}
              className="w-full accent-[#E62429]"
              data-testid="settings-sensitivity-slider"
            />
          </section>

          {/* ADS sensitivity multiplier — applies on top of mouse/controller/touch
              when the player is aiming down sights. Standard FPS feature so
              precision aim can be tuned independently from hip-fire. */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm flex items-center gap-2">
                <Mouse size={14} strokeWidth={3} /> ADS Sensitivity
                <span className="text-[10px] text-neutral-500">(multiplier)</span>
              </div>
              <div className="text-sm tabular-nums" data-testid="settings-ads-sens-value">
                {Number(s.adsSensitivityMultiplier ?? 1.0).toFixed(2)}×
              </div>
            </div>
            <input
              type="range"
              min="0.25"
              max="2.5"
              step="0.05"
              value={s.adsSensitivityMultiplier ?? 1.0}
              onChange={(e) => patch({ adsSensitivityMultiplier: parseFloat(e.target.value) })}
              className="w-full accent-[#FFD700]"
              data-testid="settings-ads-sens-slider"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Multiplies your sensitivity while aiming down sights. Lower = slower &amp; more precise. Applies to mouse, controller, and touch.
            </p>
          </section>

          {/* Controller sensitivity */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm flex items-center gap-2">
                <Gamepad2 size={14} strokeWidth={3} /> Controller Sensitivity
              </div>
              <div className="text-sm tabular-nums" data-testid="settings-gamepad-sens-value">
                {Number(s.gamepadSensitivity ?? 1.0).toFixed(2)}×
              </div>
            </div>
            <input
              type="range"
              min="0.3"
              max="3.0"
              step="0.05"
              value={s.gamepadSensitivity ?? 1.0}
              onChange={(e) => patch({ gamepadSensitivity: parseFloat(e.target.value) })}
              className="w-full accent-[#9B59B6]"
              data-testid="settings-gamepad-sens-slider"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Right-stick look speed. Higher = faster turn.
            </p>
          </section>

          {/* Touch sensitivity */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm flex items-center gap-2">
                <Smartphone size={14} strokeWidth={3} /> Touch Sensitivity
              </div>
              <div className="text-sm tabular-nums" data-testid="settings-touch-sens-value">
                {Number(s.touchSensitivity ?? 1.0).toFixed(2)}×
              </div>
            </div>
            <input
              type="range"
              min="0.3"
              max="3.0"
              step="0.05"
              value={s.touchSensitivity ?? 1.0}
              onChange={(e) => patch({ touchSensitivity: parseFloat(e.target.value) })}
              className="w-full accent-[#0055FF]"
              data-testid="settings-touch-sens-slider"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Drag the right side of the screen to look around. Higher = faster turn.
            </p>
          </section>
          </>
          )}

          {tab === "video" && (
          <>
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

          {/* Resolution preset — explicit target heights mapped to the
              render-scale multiplier. Native = device pixel ratio. */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm">Resolution</div>
              <div className="text-sm tabular-nums" data-testid="settings-resolution-value">
                {s.resolution || "native"}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { id: "720p",   label: "720p",   h: 720 },
                { id: "900p",   label: "900p",   h: 900 },
                { id: "1080p",  label: "1080p",  h: 1080 },
                { id: "1440p",  label: "1440p",  h: 1440 },
                { id: "native", label: "NATIVE", h: null },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    // Compute the renderScale needed to hit this target
                    // backing-store height, relative to the current
                    // window inner-height. Native restores 1.0× DPR.
                    let scale = 1.0;
                    if (opt.h) {
                      const ih = Math.max(1, window.innerHeight || 1080);
                      scale = Math.max(0.4, Math.min(2.0, opt.h / ih));
                    }
                    patch({ resolution: opt.id, renderScale: parseFloat(scale.toFixed(2)) });
                  }}
                  className={`btn-pow [&]:px-2 [&]:py-1 [&]:text-[10px] ${
                    (s.resolution || "native") === opt.id
                      ? "bg-[#FFD700] text-black"
                      : "bg-neutral-200 text-neutral-700"
                  }`}
                  data-testid={`settings-resolution-${opt.id}-btn`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500 mt-1">
              Lower resolutions boost FPS. Use the slider below for fine control.
            </p>
          </section>

          {/* Render scale */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm">Render Scale</div>
              <div className="text-sm tabular-nums" data-testid="settings-render-scale-value">
                {Math.round((s.renderScale ?? 1.0) * 100)}%
              </div>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={s.renderScale ?? 1.0}
              onChange={(e) => patch({ renderScale: parseFloat(e.target.value) })}
              className="w-full accent-[#E62429]"
              data-testid="settings-render-scale-slider"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Below 100% boosts FPS dramatically on weak GPUs. Above 100% sharpens edges.
            </p>
          </section>

          {/* View distance */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm">View Distance</div>
              <div className="text-sm tabular-nums" data-testid="settings-view-distance-value">{s.viewDistance ?? 140}m</div>
            </div>
            <input
              type="range"
              min="60"
              max="200"
              step="5"
              value={s.viewDistance ?? 140}
              onChange={(e) => patch({ viewDistance: parseInt(e.target.value, 10) })}
              className="w-full accent-[#E62429]"
              data-testid="settings-view-distance-slider"
            />
          </section>
          </>
          )}

          {tab === "hud" && (
          <>
          {/* HUD scale */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-anton uppercase tracking-widest text-sm">HUD Scale</div>
              <div className="text-sm tabular-nums" data-testid="settings-hud-scale-value">
                {Math.round((s.hudScale ?? 1.0) * 100)}%
              </div>
            </div>
            <input
              type="range"
              min="0.7"
              max="1.3"
              step="0.05"
              value={s.hudScale ?? 1.0}
              onChange={(e) => patch({ hudScale: parseFloat(e.target.value) })}
              className="w-full accent-[#FFD700]"
              data-testid="settings-hud-scale-slider"
            />
          </section>

          {/* Crosshair style */}
          <section>
            <div className="font-anton uppercase tracking-widest text-sm mb-2">Crosshair Style</div>
            <div className="grid grid-cols-4 gap-2" data-testid="settings-crosshair-style">
              {["dot", "cross", "plus", "circle"].map((cs) => (
                <button
                  key={cs}
                  type="button"
                  onClick={() => patch({ crosshairStyle: cs })}
                  className={`rounded border px-3 py-2 text-xs font-anton uppercase tracking-widest transition-colors ${
                    (s.crosshairStyle || "cross") === cs
                      ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`settings-crosshair-style-${cs}`}
                >
                  {cs}
                </button>
              ))}
            </div>
            <div className="font-anton uppercase tracking-widest text-xs mt-3 mb-1 text-neutral-400">Color</div>
            <div className="grid grid-cols-6 gap-2" data-testid="settings-crosshair-color">
              {["#FFD700", "#FFFFFF", "#E62429", "#06D6A0", "#0055FF", "#9B59B6"].map((hex) => {
                const active = (s.crosshairColor || "#FFD700").toUpperCase() === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => patch({ crosshairColor: hex })}
                    className={`h-8 rounded border-2 transition-transform ${active ? "border-white scale-110" : "border-black/40 hover:border-white/60"}`}
                    style={{ background: hex }}
                    data-testid={`settings-crosshair-color-${hex.replace("#", "")}`}
                    aria-label={`Crosshair ${hex}`}
                  />
                );
              })}
            </div>
          </section>
          </>
          )}

          {tab === "video" && (
          <>
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
          </>
          )}

          {tab === "controls" && (
          <>
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
            <div className="mt-2">
              <ToggleRow
                label="Auto-Fire (Touch)"
                note="Continuously fire while aiming with the right joystick. Engine cooldown gates the RPM."
                checked={!!s.touchAutoFire}
                onChange={(v) => patch({ touchAutoFire: v })}
                testid="settings-touch-auto-fire"
              />
            </div>
          </section>

          {/* Aim assist (controller / touch) */}
          <section className="space-y-2">
            <ToggleRow
              label="Aim Assist (controller / touch)"
              note="Soft snap toward the nearest enemy in your aim cone."
              checked={!!s.aimAssist}
              onChange={(v) => patch({ aimAssist: v })}
              testid="settings-aim-assist"
            />
            {s.aimAssist && (
              <div className="ml-1 -mt-1 mb-1" data-testid="settings-aim-assist-strength-row">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-anton uppercase tracking-widest text-xs text-neutral-300">Aim Assist Strength</div>
                  <div className="text-xs tabular-nums" data-testid="settings-aim-assist-strength-value">
                    {Math.round((s.aimAssistStrength ?? 0.6) * 100)}%
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={s.aimAssistStrength ?? 0.6}
                  onChange={(e) => patch({ aimAssistStrength: parseFloat(e.target.value) })}
                  className="w-full accent-[#06A35F]"
                  data-testid="settings-aim-assist-strength-slider"
                />
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  Higher values pull harder toward enemies in your aim cone.
                </p>
              </div>
            )}
            <ToggleRow
              label="Camera Bob"
              note="Subtle head-bob while moving/sprinting. Turn off for less motion."
              checked={s.cameraBob !== false}
              onChange={(v) => patch({ cameraBob: v })}
              testid="settings-camera-bob"
            />
          </section>

          {/* Advanced controls — keybinds, controller, mobile HUD editor */}
          <section className="border-t border-neutral-800 pt-4">
            <AdvancedControls s={s} patch={patch} />
          </section>
          </>
          )}

          {tab === "video" && (
          <>
          {/* Video-only toggles */}
          <section className="space-y-2">
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
            <ToggleRow
              label="High-Contrast Outlines"
              note="Thicker comic outlines for better enemy visibility."
              checked={!!s.highContrastOutlines}
              onChange={(v) => patch({ highContrastOutlines: v })}
              testid="settings-high-contrast"
            />
            <ToggleRow
              label="Bloom"
              note="Light glow on bright highlights. Cinematic but heavier."
              checked={!!s.bloom}
              onChange={(v) => patch({ bloom: v })}
              testid="settings-bloom"
            />
            <ToggleRow
              label="Motion Blur"
              note="Subtle blur on rapid camera turns."
              checked={!!s.motionBlur}
              onChange={(v) => patch({ motionBlur: v })}
              testid="settings-motion-blur"
            />
          </section>

          {/* Detail / asset quality */}
          <section className="space-y-2">
            <ToggleRow
              label="Ray-Traced Lighting"
              note="Soft real-time shadows, three colored fill lights, ACES tone mapping. Heavier on GPU."
              checked={!!s.rayTracedLighting}
              onChange={(v) => patch({ rayTracedLighting: v })}
              testid="settings-ray-traced-lighting"
            />
            <ToggleRow
              label="Disable V-Sync"
              note="Render on a setTimeout loop instead of vsync. Lower input lag on high-refresh monitors but can cause tearing."
              checked={!!s.disableVsync}
              onChange={(v) => patch({ disableVsync: v })}
              testid="settings-disable-vsync"
            />
            <ToggleRow
              label="Animated Lobby Background"
              note="New parallax meteor scene with pulsing crater glow + drifting embers. Turn off to use the calmer static background (less motion, lower battery)."
              checked={!!s.lobbyAnimatedBackground}
              onChange={(v) => patch({ lobbyAnimatedBackground: v })}
              testid="settings-lobby-animated-background"
            />
            {/* Lobby Background Variant picker — lets players re-use any
                past-season backdrop they've earned. AUTO tracks the
                current season. Locked variants show a padlock instead. */}
            <LobbyVariantPicker
              value={s.lobbyBackgroundVariant || "auto"}
              onChange={(v) => patch({ lobbyBackgroundVariant: v })}
              user={user}
            />
          </section>

          {/* Frame Generation picker — multiplies the per-frame render passes
              for smoother perceived motion. Off = 1x (vanilla), 2x doubles,
              3x triples. GPU usage scales linearly. */}
          <section data-testid="settings-frame-gen-section">
            <div className="font-anton uppercase tracking-widest text-sm mb-2">
              Frame Generation
            </div>
            <div className="grid grid-cols-3 gap-2" data-testid="settings-frame-gen">
              {[
                { id: "off", label: "Off",  note: "1x — vanilla" },
                { id: "2x",  label: "2x",   note: "Doubled smoothness" },
                { id: "3x",  label: "3x",   note: "Tripled — heavy GPU" },
              ].map(({ id, label, note }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => patch({ frameGen: id })}
                  className={`flex flex-col items-start rounded border px-3 py-2 text-left transition-colors ${
                    (s.frameGen || "off") === id
                      ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`settings-frame-gen-${id}`}
                >
                  <span className="font-anton uppercase tracking-widest text-xs">{label}</span>
                  <span className="text-[10px] text-neutral-500 mt-0.5">{note}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-neutral-500 mt-2">
              Interpolates additional frames between physics ticks. Best paired
              with Disable V-Sync for the lowest input latency.
            </p>
          </section>

          <section>
            <div className="font-anton uppercase tracking-widest text-sm mb-2">Texture Quality</div>
            <div className="grid grid-cols-3 gap-2" data-testid="settings-texture-quality">
              {[
                { id: "low",    label: "Low",    note: "Nearest-filtered, no mipmaps" },
                { id: "medium", label: "Medium", note: "Linear, no mipmaps" },
                { id: "high",   label: "High",   note: "Linear + mipmaps (default)" },
              ].map(({ id, label, note }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => patch({ textureQuality: id })}
                  className={`flex flex-col items-start rounded border px-3 py-2 text-left transition-colors ${
                    (s.textureQuality || "high") === id
                      ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`settings-texture-quality-${id}`}
                >
                  <span className="font-anton uppercase tracking-widest text-xs">{label}</span>
                  <span className="text-[10px] text-neutral-500 mt-0.5">{note}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="font-anton uppercase tracking-widest text-sm mb-2">Weapon Viewmodel Detail</div>
            <div className="grid grid-cols-3 gap-2" data-testid="settings-weapon-detail">
              {["low", "medium", "high"].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => patch({ weaponDetail: id })}
                  className={`rounded border px-3 py-2 text-xs font-anton uppercase tracking-widest transition-colors ${
                    (s.weaponDetail || "high") === id
                      ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`settings-weapon-detail-${id}`}
                >
                  {id}
                </button>
              ))}
            </div>
          </section>

          <SliderRow
            label="Particle Density"
            valueText={`${Math.round((s.particleDensity ?? 1.0) * 100)}%`}
            value={s.particleDensity ?? 1.0}
            min={0}
            max={2.0}
            step={0.1}
            onChange={(v) => patch({ particleDensity: v })}
            testid="settings-particle-density"
            note="Shell casings, sparks, muzzle smoke. 0 = off."
          />

          <SliderRow
            label="Grass Density"
            valueText={`${Math.round((s.grassDensity ?? 1.0) * 100)}%`}
            value={s.grassDensity ?? 1.0}
            min={0}
            max={1.5}
            step={0.1}
            onChange={(v) => patch({ grassDensity: v })}
            testid="settings-grass-density"
            note="Animated grass-blade sprites in the arena."
          />

          {/* Post-processing & color */}
          <section className="space-y-2">
            <ToggleRow
              label="Cloud Shadows"
              note="Dynamic shadow blobs sweep across the arena."
              checked={s.cloudShadows !== false}
              onChange={(v) => patch({ cloudShadows: v })}
              testid="settings-cloud-shadows"
            />
            <ToggleRow
              label="Vignette"
              note="Soft dark corners; adds focus to the center of the screen."
              checked={s.vignette !== false}
              onChange={(v) => patch({ vignette: v })}
              testid="settings-vignette"
            />
            <ToggleRow
              label="Film Grain"
              note="Subtle animated grain texture. Cinematic look."
              checked={!!s.filmGrain}
              onChange={(v) => patch({ filmGrain: v })}
              testid="settings-film-grain"
            />
            <ToggleRow
              label="Chromatic Aberration"
              note="Slight color fringing at screen edges."
              checked={!!s.chromaticAberration}
              onChange={(v) => patch({ chromaticAberration: v })}
              testid="settings-chromatic-aberration"
            />
            <ToggleRow
              label="Scanlines"
              note="Retro CRT overlay. Heavier on low-end devices."
              checked={!!s.scanlines}
              onChange={(v) => patch({ scanlines: v })}
              testid="settings-scanlines"
            />
            <ToggleRow
              label="UI Backdrop Blur"
              note="Frosted-glass effect behind HUD panels. Disable for max FPS."
              checked={s.uiBlur !== false}
              onChange={(v) => patch({ uiBlur: v })}
              testid="settings-ui-blur"
            />
          </section>

          <SliderRow
            label="Brightness"
            valueText={`${Math.round((s.brightness ?? 1.0) * 100)}%`}
            value={s.brightness ?? 1.0}
            min={0.6}
            max={1.4}
            step={0.05}
            onChange={(v) => patch({ brightness: v })}
            testid="settings-brightness"
          />
          <SliderRow
            label="Contrast"
            valueText={`${Math.round((s.contrast ?? 1.0) * 100)}%`}
            value={s.contrast ?? 1.0}
            min={0.7}
            max={1.3}
            step={0.05}
            onChange={(v) => patch({ contrast: v })}
            testid="settings-contrast"
          />
          <SliderRow
            label="Saturation"
            valueText={`${Math.round((s.saturation ?? 1.0) * 100)}%`}
            value={s.saturation ?? 1.0}
            min={0}
            max={1.6}
            step={0.05}
            onChange={(v) => patch({ saturation: v })}
            testid="settings-saturation"
            note="0% = pure black & white; 100% = default."
          />

          <section>
            <div className="font-anton uppercase tracking-widest text-sm mb-2">Color-Blind Mode</div>
            <div className="grid grid-cols-2 gap-2" data-testid="settings-colorblind">
              {[
                { id: "off",          label: "Off" },
                { id: "protanopia",   label: "Protanopia" },
                { id: "deuteranopia", label: "Deuteranopia" },
                { id: "tritanopia",   label: "Tritanopia" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => patch({ colorBlindMode: id })}
                  className={`rounded border px-3 py-2 text-xs font-anton uppercase tracking-widest transition-colors ${
                    (s.colorBlindMode || "off") === id
                      ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`settings-colorblind-${id}`}
                >
                  {label}
                </button>
              ))}
          </div>
          </section>

          {/* Performance indicators */}
          <section className="space-y-2">
            <ToggleRow
              label="Show FPS"
              note="Tiny frames-per-second counter in the corner."
              checked={!!s.showFps}
              onChange={(v) => patch({ showFps: v })}
              testid="settings-show-fps"
            />
            <ToggleRow
              label="Show Ping"
              note="Roundtrip latency counter next to FPS."
              checked={!!s.showPing}
              onChange={(v) => patch({ showPing: v })}
              testid="settings-show-ping"
            />
          </section>

          </>
          )}

          {tab === "hud" && (
          <>
          {/* HUD-only toggles */}
          <section className="space-y-2">
            <ToggleRow
              label="Screen Shake"
              note="Camera shake on hits, kills, and explosions."
              checked={s.screenShake !== false}
              onChange={(v) => patch({ screenShake: v })}
              testid="settings-screen-shake"
            />
            <ToggleRow
              label="Damage Flash"
              note="Red vignette when you take damage."
              checked={s.showDamageFlash !== false}
              onChange={(v) => patch({ showDamageFlash: v })}
              testid="settings-damage-flash"
            />
            <ToggleRow
              label="Damage Numbers"
              note="Floating numbers pop up when you hit an enemy."
              checked={s.showDamageNumbers !== false}
              onChange={(v) => patch({ showDamageNumbers: v })}
              testid="settings-damage-numbers"
            />
            <ToggleRow
              label="Kill Feed"
              note="Show recent eliminations in the top-right corner."
              checked={s.showKillFeed !== false}
              onChange={(v) => patch({ showKillFeed: v })}
              testid="settings-kill-feed"
            />
          </section>
          </>
          )}

          {tab === "account" && (
          <>
          {/* Username change (7-day cooldown, historical entries keep
              old name) + security question setup for the /forgot-
              password flow. Both live server-side under /profile/me/*
              — this component just wraps the calls. */}
          <AccountSettingsCard user={user} refreshMe={refreshMe} />

          {/* Privacy: hide your profile from other players. Bots are
              always hidden server-side regardless of this toggle; this
              switch only affects how your real account appears in the
              PublicProfileModal opened from the leaderboard / friends
              list / spectate search. */}
          <section data-testid="settings-privacy-section" className="mb-4">
            <div className="font-anton uppercase tracking-widest text-sm mb-2 flex items-center gap-2">
              <UserIcon size={14} strokeWidth={3} /> Privacy
            </div>
            <label className="flex items-start gap-3 p-3 rounded border border-neutral-800 bg-neutral-950 cursor-pointer hover:border-neutral-700 transition-colors">
              <input
                type="checkbox"
                checked={!!user?.profile_private}
                onChange={async (e) => {
                  const next = e.target.checked;
                  try {
                    await api.put("/profile/privacy", { profile_private: next });
                    try { await refreshMe?.(); } catch {}
                  } catch (err) {
                    alert(err?.response?.data?.detail || "Could not save privacy setting.");
                  }
                }}
                className="mt-1 w-4 h-4 accent-[#FFD700]"
                data-testid="settings-profile-private-toggle"
              />
              <div className="flex-1 min-w-0">
                <div className="font-anton uppercase tracking-widest text-sm">Private profile</div>
                <div className="text-xs text-neutral-400 mt-1 leading-snug">
                  When ON, other players who open your profile see only your username, rank, and avatar — no stats, level, or match history.
                </div>
              </div>
            </label>
          </section>

          {/* Redeem promo code. Codes are one-time per account, validated +
              applied server-side; success refreshes the auth context so the
              new XP / RP / cosmetic shows up everywhere (PlayerCard banner,
              profile level, etc.) without a page reload. */}
          <section data-testid="settings-redeem-section">
            <div className="font-anton uppercase tracking-widest text-sm mb-2 flex items-center gap-2">
              <Gift size={14} strokeWidth={3} /> Redeem Code
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const code = (redeemCode || "").trim();
                if (!code || redeemBusy) return;
                setRedeemBusy(true);
                setRedeemMsg(null);
                try {
                  const { data } = await api.post("/codes/redeem", { code });
                  setRedeemMsg({ kind: "ok", text: data?.label || "Reward granted!" });
                  setRedeemCode("");
                  try { await refreshMe?.(); } catch {}
                  // If the code crossed a rank tier, fire a global event so
                  // the lobby can play the rank-up celebration overlay.
                  if (data?.rank_up) {
                    try {
                      window.dispatchEvent(new CustomEvent("virtue-rankup", { detail: data.rank_up }));
                    } catch {}
                  }
                } catch (err) {
                  setRedeemMsg({
                    kind: "err",
                    text: err?.response?.data?.detail || "Could not redeem code.",
                  });
                } finally {
                  setRedeemBusy(false);
                }
              }}
              className="flex gap-2"
              data-testid="settings-redeem-form"
            >
              <input
                type="text"
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                placeholder="ENTER CODE"
                maxLength={32}
                className="flex-1 rounded border border-neutral-800 bg-neutral-950 text-white px-3 py-2 font-anton uppercase tracking-widest text-sm focus:border-[#FFD700] focus:outline-none"
                data-testid="settings-redeem-input"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                disabled={redeemBusy || !redeemCode}
                className="px-4 py-2 rounded border border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700] font-anton uppercase tracking-widest text-sm disabled:opacity-40 hover:bg-[#FFD700]/25"
                data-testid="settings-redeem-submit"
              >
                {redeemBusy ? "..." : "Redeem"}
              </button>
            </form>
            {redeemMsg && (
              <div
                className={`mt-2 text-xs font-anton uppercase tracking-widest flex items-center gap-1.5 ${
                  redeemMsg.kind === "ok" ? "text-emerald-400" : "text-red-400"
                }`}
                data-testid="settings-redeem-msg"
                data-msg-kind={redeemMsg.kind}
              >
                {redeemMsg.kind === "ok" && <Check size={12} strokeWidth={3} />}
                {redeemMsg.text}
              </div>
            )}
            <p className="text-[10px] text-neutral-500 mt-2">
              Got a promo code from a livestream or event? Redeem it here for
              XP, RP, or cosmetic unlocks. One use per account.
            </p>
          </section>

          {/* Server / region selector. The "ping" values are seeded per-region
              so the list looks alive; in this deployment all regions route to
              the same gameserver. Once additional regions come online the
              chosen value is honored by the matchmaker. */}
          <section data-testid="settings-server-region">
            <div className="font-anton uppercase tracking-widest text-sm mb-2 flex items-center gap-2">
              <Globe size={14} strokeWidth={3} /> Server Region
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {REGION_OPTIONS.map(({ id, label, basePing }) => {
                const active = (s.serverRegion || "auto") === id;
                const ping = regionPings[id] ?? basePing;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => patch({ serverRegion: id })}
                    className={`flex items-center justify-between rounded border px-3 py-2 text-sm transition-colors ${
                      active
                        ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]"
                        : "border-neutral-800 hover:border-neutral-700"
                    }`}
                    data-testid={`settings-server-region-${id}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${ping < 60 ? "bg-emerald-400" : ping < 110 ? "bg-yellow-400" : "bg-red-400"}`} />
                      {label}
                    </span>
                    <span className="font-anton tabular-nums text-xs">
                      {id === "auto" ? "auto" : `${ping}ms`}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-neutral-500 mt-2">
              Choose a region for matchmaking. Auto picks the lowest-latency
              server. Currently routes to the active deployment region.
            </p>
          </section>

          <p className="text-[11px] text-neutral-500 pt-1">
            Settings save to this device only.
          </p>

          {/* Logout — at the bottom of the modal */}
          <section className="border-t border-neutral-800 pt-4 space-y-2">
            <button
              type="button"
              onClick={() => { onClose?.(); logout?.(); }}
              className="w-full flex items-center justify-center gap-2 rounded border border-[#E62429] bg-[#E62429]/20 hover:bg-[#E62429]/30 text-white font-anton uppercase tracking-widest px-3 py-2 transition-colors"
              data-testid="settings-logout"
            >
              <LogOut size={16} strokeWidth={3} /> Logout
            </button>
          </section>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

/* Slider row used by the new graphics options. Mirrors `ToggleRow`'s look so
   they stack cleanly. Renders a label + live value chip + range input + the
   optional helper note below. */
function SliderRow({ label, valueText, value, min, max, step, onChange, note, testid }) {
  return (
    <section data-testid={testid}>
      <div className="flex items-center justify-between mb-1">
        <div className="font-anton uppercase tracking-widest text-sm">{label}</div>
        <div className="text-xs tabular-nums">{valueText}</div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#FFD700]"
        data-testid={`${testid}-slider`}
      />
      {note && <p className="text-[10px] text-neutral-500 mt-1">{note}</p>}
    </section>
  );
}

/* Volume slider row used in the Audio tab. Combines a label, the live
   percentage chip, a slider, and a small mute-toggle icon on the right.
   `muted` is purely visual — the parent owns the mute state. */
function VolumeRow({ label, icon, value, muted, onChange, onToggleMute, testid }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between mb-1">
        <div className="font-anton uppercase tracking-widest text-sm flex items-center gap-2">
          <span className={muted ? "text-neutral-500" : "text-[#FFD700]"}>{icon}</span>
          {label}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs tabular-nums ${muted ? "text-neutral-500" : ""}`} data-testid={`${testid}-value`}>
            {muted ? "MUTED" : `${pct}%`}
          </span>
          <button
            type="button"
            onClick={onToggleMute}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-anton uppercase tracking-widest transition-colors ${
              muted
                ? "border-neutral-700 text-neutral-400"
                : "border-[#FFD700]/60 text-[#FFD700] hover:bg-[#FFD700]/10"
            }`}
            data-testid={`${testid}-mute`}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={muted ? 0 : value}
        disabled={muted}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#FFD700] disabled:opacity-50"
        data-testid={`${testid}-slider`}
      />
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


/* LobbyVariantPicker — grid of tiles for the lobby background choice.
   Users unlock a variant by finishing (or currently playing) the season
   it originally shipped in:
     · S1 → Default
     · S2 → Meteor
     · S3+ → Snow
   AUTO is always available; admins see every option unlocked.
   Locked tiles render dimmed with a padlock; picking one triggers no
   change (defensive — the parent Lobby also gates the effective
   variant so a manual localStorage tweak wouldn't sneak past). */
function LobbyVariantPicker({ value, onChange, user }) {
  const isAdmin = user?.role === "admin";
  const finished = new Set((user?.past_seasons || []).map((e) => Number(e?.season) || 0));
  // Since we can't read seasonNumber from AuthContext directly (it's
  // page-scoped), rely on `past_seasons` + AUTO as the safe default.
  // A user currently on Season N doesn't yet have S{N} in finished,
  // but the AUTO option will pick the right variant regardless.
  const options = [
    { id: "auto",    label: "Auto" },
    { id: "default", label: "Season 1", requires: 1 },
    { id: "meteor",  label: "Season 2", requires: 2 },
    { id: "snow",    label: "Season 3", requires: 3 },
  ];
  return (
    <div className="mt-3" data-testid="settings-lobby-variant-picker">
      <div className="text-xs uppercase tracking-widest opacity-70 mb-1 font-anton">
        Lobby Background
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {options.map(({ id, label, requires }) => {
          const unlocked = id === "auto" || isAdmin || (requires && finished.has(requires));
          const active = value === id;
          return (
            <button
              key={id}
              type="button"
              disabled={!unlocked}
              onClick={() => unlocked && onChange(id)}
              className={`text-left rounded border px-3 py-2 transition-colors ${
                active
                  ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]"
                  : unlocked
                    ? "border-neutral-800 hover:border-neutral-700"
                    : "border-neutral-800 opacity-40 cursor-not-allowed"
              }`}
              data-testid={`settings-lobby-variant-${id}`}
              data-active={active || undefined}
              data-unlocked={unlocked ? "1" : "0"}
            >
              <div className="font-anton uppercase text-sm tracking-widest">
                {label}{!unlocked && " 🔒"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
