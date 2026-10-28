// Moderation: per-mode on/off switches + "turn all modes off" maintenance control.
import { useEffect, useState } from "react";
import api from "@/api";
import { Loader2, Power, ToggleLeft } from "lucide-react";

const ORDER = ["casual_ffa", "casual_tdm", "ranked", "bigffa", "party", "practice"];

function SwitchRow({ k, m, busy, onFlip }) {
  const on = m.enabled !== false;
  return (
    <div className="border-2 border-black px-3 py-2 flex items-center gap-3" data-testid={`mode-switch-${k}`}>
      <div className="flex-1 min-w-0">
        <div className="font-anton uppercase tracking-widest text-xs">{m.label}</div>
        <div className="text-[11px] text-neutral-600 truncate" data-testid={`mode-switch-${k}-meta`}>
          {m.changed_at ? `Changed ${new Date(m.changed_at).toLocaleString()} by ${m.changed_by}` : "Never changed"}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={() => onFlip(k, !on)}
        className={`btn-pow text-xs px-4 py-1.5 flex items-center gap-2 ${on ? "bg-[#06A35F] text-white" : "bg-[#E62429] text-white"}`}
        data-testid={`mode-switch-${k}-toggle`} data-state={on ? "on" : "off"}>
        <Power size={12} strokeWidth={3} /> {on ? "ON" : "OFF"}
      </button>
    </div>
  );
}

function MaintenanceControls({ allOff, active, busy, onAll }) {
  const [msg, setMsg] = useState("");
  return (
    <div className="border-4 border-[#E62429] p-3 mt-3 space-y-2" data-testid="mode-switches-maintenance">
      <div className="font-anton uppercase tracking-widest text-xs text-[#E62429]">Maintenance mode</div>
      {active?.active && (
        <div className="text-xs" data-testid="mode-switches-active-message">
          Showing players: <span className="font-anton">{active.message || "(default message)"}</span>
        </div>
      )}
      {!allOff && (
        <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder='Message for players, e.g. "Back in 20 minutes – server maintenance"'
          className="border-2 border-black px-2 py-1 text-xs w-full" data-testid="mode-switches-maintenance-message" />
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || allOff} onClick={() => onAll(true, msg)} className="btn-pow bg-[#E62429] text-white text-sm px-5 py-2 disabled:opacity-50" data-testid="mode-switches-all-off">
          Turn all modes off
        </button>
        <button type="button" disabled={busy} onClick={() => onAll(false, "")} className="btn-pow bg-[#06A35F] text-white text-sm px-5 py-2" data-testid="mode-switches-all-on">
          Turn all back on
        </button>
      </div>
    </div>
  );
}

export function ModesOffBanner({ data }) {
  const off = ORDER.filter((k) => data?.modes?.[k]?.enabled === false);
  if (!off.length) return null;
  return (
    <div className="max-w-6xl mx-auto mb-4 bg-[#E62429] text-white border-4 border-black px-4 py-2 font-anton uppercase tracking-widest text-sm" data-testid="mode-switches-off-banner">
      {data.maintenance?.active ? "Maintenance mode on · " : ""}Paused: {off.map((k) => data.modes[k].label).join(", ")}
    </div>
  );
}

export default function AdminModeSwitchesPanel({ data, setData, onToast }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) api.get("/admin/mode_switches").then(({ data: d }) => setData(d)).catch(() => {});
  }, [data, setData]);

  const run = async (req, okText) => {
    setBusy(true);
    try {
      const { data: d } = await req();
      setData(d);
      onToast?.({ kind: "ok", text: okText });
    } catch (e) {
      onToast?.({ kind: "err", text: e?.response?.data?.detail || "Couldn't change mode." });
    } finally {
      setBusy(false);
    }
  };
  const flip = (k, enabled) => {
    if (!enabled && !window.confirm(`Turn ${data.modes[k].label} off? Running matches finish, then players go back to the lobby. Nobody new can join.`)) return;
    run(() => api.post("/admin/mode_switches", { mode: k, enabled }), `${data.modes[k].label} ${enabled ? "on" : "off"}.`);
  };
  const all = (active, message) => {
    if (active && window.prompt('Type OFF to pause every game mode for all players.') !== "OFF") return;
    run(() => api.post("/admin/mode_switches/all", { active, message }), active ? "All modes off." : "All modes back on.");
  };
  const allOff = data && ORDER.every((k) => data.modes[k]?.enabled === false);

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-mode-switches-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <ToggleLeft size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Mode Switches</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">Turning a mode off blocks new joins and queues. Running matches finish first. Admins can still join paused modes.</div>
      {!data ? <Loader2 size={16} className="animate-spin" /> : (
        <>
          <div className="grid sm:grid-cols-2 gap-2">
            {ORDER.map((k) => <SwitchRow key={k} k={k} m={data.modes[k]} busy={busy} onFlip={flip} />)}
          </div>
          <MaintenanceControls allOff={allOff} active={data.maintenance} busy={busy} onAll={all} />
        </>
      )}
    </div>
  );
}
