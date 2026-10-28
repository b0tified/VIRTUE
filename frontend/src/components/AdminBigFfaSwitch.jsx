// Moderation: Big FFA on/off switch (running matches finish; new joins blocked).
import { useState } from "react";
import api from "@/api";
import { Loader2, Power } from "lucide-react";

export default function AdminBigFfaSwitch({ state, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const on = state?.enabled !== false;
  const flip = async () => {
    if (on && !window.confirm("Turn Big FFA off? Running matches finish, then players go back to the lobby. Nobody new can join.")) return;
    setBusy(true);
    setErr(null);
    try {
      const { data } = await api.post("/admin/bigffa_switch", { enabled: !on });
      onChanged?.(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't change Big FFA.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-2 border-black px-3 py-2 flex flex-wrap items-center gap-3" data-testid="admin-bigffa-switch">
      <div className="flex-1 min-w-[200px]">
        <div className="font-anton uppercase tracking-widest text-xs">Big FFA (12P)</div>
        <div className="text-[11px] text-neutral-600" data-testid="admin-bigffa-switch-meta">
          {state?.changed_at ? `Last changed ${new Date(state.changed_at).toLocaleString()} by ${state.changed_by}` : "Never changed"}
        </div>
        {err && <div className="text-[11px] text-[#E62429]">{err}</div>}
      </div>
      <button type="button" onClick={flip} disabled={busy}
        className={`btn-pow text-xs px-4 py-2 flex items-center gap-2 ${on ? "bg-[#06A35F] text-white" : "bg-[#E62429] text-white"}`}
        data-testid="admin-bigffa-switch-toggle" data-state={on ? "on" : "off"}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} strokeWidth={3} />}
        {on ? "ON" : "OFF"}
      </button>
    </div>
  );
}
