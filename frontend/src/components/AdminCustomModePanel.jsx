// Moderation: one custom lobby button that opens an admin-set link in a new tab.
import { useEffect, useState } from "react";
import api from "@/api";
import { ExternalLink, Loader2, Power } from "lucide-react";

export default function AdminCustomModePanel({ onToast }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/admin/custom_mode").then(({ data }) => setD(data)).catch(() => {});
  }, []);

  const save = async (patch = {}) => {
    const next = { ...d, ...patch };
    setBusy(true);
    try {
      const { data } = await api.post("/admin/custom_mode", { enabled: next.enabled, name: next.name, url: next.url, color: next.color });
      setD(data);
      onToast?.({ kind: "ok", text: data.enabled ? "Custom button saved and showing." : "Custom button saved (hidden)." });
    } catch (e) {
      const m = e?.response?.data?.detail;
      onToast?.({ kind: "err", text: typeof m === "string" ? m : "Couldn't save the custom button." });
    } finally {
      setBusy(false);
    }
  };

  if (!d) return <div className="bg-white border-4 border-black p-4"><Loader2 size={16} className="animate-spin" /></div>;
  const hex = d.colors[d.color];
  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-custom-mode-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <ExternalLink size={16} strokeWidth={3} className="text-[#0055FF]" />
        <span>Custom Mode Button</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">An extra lobby button that opens your link in a new tab.</div>
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={d.name} maxLength={20} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Button name"
          className="border-2 border-black px-2 py-1 text-sm font-anton uppercase tracking-wider" data-testid="custom-mode-name-input" />
        <input value={d.url} maxLength={500} onChange={(e) => setD({ ...d, url: e.target.value })} placeholder="https://..."
          className="border-2 border-black px-2 py-1 text-sm" data-testid="custom-mode-url-input" />
      </div>
      <div className="flex flex-wrap gap-2 mt-2" data-testid="custom-mode-colors">
        {Object.entries(d.colors).map(([k, c]) => (
          <button key={k} type="button" onClick={() => setD({ ...d, color: k })} aria-label={k}
            className={`w-8 h-8 border-2 ${d.color === k ? "border-black ring-2 ring-black ring-offset-2" : "border-black/40"}`}
            style={{ background: c }} data-testid={`custom-mode-color-${k}`} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`btn-pow text-sm px-4 py-2 pointer-events-none uppercase ${d.color === "gold" ? "text-black" : "text-white"}`} style={{ background: hex }} data-testid="custom-mode-preview">
          <span className="flex items-center gap-2"><ExternalLink size={14} strokeWidth={3} /> {d.name || "Button name"}</span>
        </span>
        <button type="button" disabled={busy} onClick={() => save()} className="btn-pow bg-black text-white text-sm px-5 py-2" data-testid="custom-mode-save">
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={() => save({ enabled: !d.enabled })}
          className={`btn-pow text-xs px-4 py-2 flex items-center gap-2 text-white ${d.enabled ? "bg-[#06A35F]" : "bg-[#E62429]"}`}
          data-testid="custom-mode-toggle" data-state={d.enabled ? "on" : "off"}>
          <Power size={12} strokeWidth={3} /> {d.enabled ? "SHOWING" : "HIDDEN"}
        </button>
      </div>
    </div>
  );
}
