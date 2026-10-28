// Settings → Server: the one real game server with a live measured ping.
import { useCallback, useEffect, useState } from "react";
import { Globe, RefreshCw } from "lucide-react";
import api from "@/api";
import settingsStore from "@/game/settings";

const API = process.env.REACT_APP_BACKEND_URL;

// Match connection node: "auto" = straight to the node hosting matches.
function NodePicker({ open }) {
  const [nodes, setNodes] = useState([]);
  const [sel, setSel] = useState(() => settingsStore.get().matchNode || "auto");
  useEffect(() => {
    if (open) api.get("/cluster/nodes").then(({ data }) => setNodes(data.nodes || [])).catch(() => {});
  }, [open]);
  const pick = (v) => { setSel(v); settingsStore.set({ matchNode: v }); };
  const opts = [{ code: "auto", label: "Auto (fastest)" }, ...nodes.map((n) => ({ code: n.code, label: `Node ${n.code}${n.hosts_matches ? " · hosts matches" : ""}` }))];
  if (sel !== "auto" && !nodes.some((n) => n.code === sel)) opts.push({ code: sel, label: `Node ${sel} · offline` });
  return (
    <div className="mt-3" data-testid="settings-node-picker">
      <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-400 mb-1">Match server node</div>
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <button key={o.code} type="button" onClick={() => pick(o.code)}
            className={`px-2.5 py-1 rounded border text-xs font-anton uppercase tracking-wider ${sel === o.code ? "border-[#FFD700] bg-[#FFD700] text-black" : "border-neutral-600 text-neutral-300 hover:border-neutral-400"}`}
            data-testid={`settings-node-option-${o.code}`}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-neutral-500 mt-1">Applies from your next match. Picking a node that doesn't host matches adds a relay hop.</p>
    </div>
  );
}

async function measure() {
  const samples = [];
  let info = null;
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    const res = await fetch(`${API}/api/server_info?t=${Date.now()}`, { cache: "no-store" });
    const ms = performance.now() - t0;
    if (!info) info = await res.json(); else await res.text();
    if (i > 0) samples.push(ms);
  }
  return { info, ping: Math.round(Math.min(...samples)) };
}

export default function ServerRegionStatus({ open }) {
  const [state, setState] = useState({ loading: true });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    measure()
      .then(({ info, ping }) => setState({ loading: false, info, ping }))
      .catch(() => setState({ loading: false, error: true }));
  }, []);
  useEffect(() => { if (open) run(); }, [open, run]);

  const { loading, info, ping, error } = state;
  const dot = ping == null ? "bg-neutral-500" : ping < 80 ? "bg-emerald-400" : ping < 150 ? "bg-yellow-400" : "bg-red-400";
  return (
    <section data-testid="settings-server-region">
      <div className="font-anton uppercase tracking-widest text-sm mb-2 flex items-center gap-2">
        <Globe size={14} strokeWidth={3} /> Server
      </div>
      <div className="flex items-center justify-between rounded border border-[#FFD700] bg-[#FFD700]/10 px-3 py-2 text-sm" data-testid="settings-server-current">
        <span className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
          {info?.region || "Game server"}
          {info?.node && <span className="text-[10px] text-neutral-500 font-anton" data-testid="settings-server-node">NODE {info.node}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-anton tabular-nums text-xs" data-testid="settings-server-ping">
            {loading ? "…" : error ? "offline" : `${ping}ms`}
          </span>
          <button type="button" onClick={run} disabled={loading} className="text-neutral-400 hover:text-white" aria-label="Re-test ping" data-testid="settings-server-retest">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </span>
      </div>
      <NodePicker open={open} />
      <p className="text-[10px] text-neutral-500 mt-2">
        All matches are hosted in one region. Ping is measured live from this device to the game server.
      </p>
    </section>
  );
}
