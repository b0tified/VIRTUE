// Settings → Server: the one real game server with a live measured ping.
import { useCallback, useEffect, useState } from "react";
import { Globe, RefreshCw } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

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
      <p className="text-[10px] text-neutral-500 mt-2">
        All matches are hosted in one region. Ping is measured live from this device to the game server.
      </p>
    </section>
  );
}
