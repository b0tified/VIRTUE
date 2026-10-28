// Moderation: live server health (loop lag, CPU, rooms, bots, player ping).
import { useEffect, useState } from "react";
import api from "@/api";
import { Activity, Loader2 } from "lucide-react";
import AdminModeLoadTable from "@/components/AdminModeLoadTable";

const level = (v, warn, bad) => (v == null ? "#9CA3AF" : v >= bad ? "#E62429" : v >= warn ? "#F39C12" : "#06A35F");

function Metric({ label, value, unit = "", color, testid, hint }) {
  return (
    <div className="border-2 border-black bg-neutral-50 px-3 py-2" data-testid={testid} title={hint}>
      <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-500">{label}</div>
      <div className="font-display text-2xl leading-none mt-1 flex items-baseline gap-1" style={{ color: color || "#0A0A0A" }}>
        {value ?? "—"}<span className="font-anton text-xs text-neutral-500">{value != null ? unit : ""}</span>
      </div>
    </div>
  );
}

const fmtUptime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

export default function AdminServerHealthPanel() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.get("/admin/server_health")
      .then(({ data }) => { if (alive) { setD(data); setErr(null); } })
      .catch((e) => alive && setErr(e?.response?.data?.detail || "Couldn't load server health."));
    load();
    const id = setInterval(load, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-server-health-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Activity size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Server Health</span>
        <span className="ml-auto text-[10px] text-neutral-500 normal-case tracking-normal">Live · refreshes every 3s</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">
        High event-loop lag or tick load means the server itself is slow, which adds directly to every player's ping.
      </div>
      {err && <div className="text-xs text-[#E62429] mb-2" data-testid="server-health-error">{err}</div>}
      {!d ? <Loader2 size={16} className="animate-spin" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <Metric label="Avg player ping" value={d.ping_avg_ms} unit="ms" color={level(d.ping_avg_ms, 90, 150)} testid="health-ping-avg" hint={d.ping_max_ms != null ? `Worst: ${d.ping_max_ms} ms` : "No players reporting"} />
            <Metric label="Loop lag" value={d.loop_lag_ms} unit="ms" color={level(d.loop_lag_ms, 15, 40)} testid="health-loop-lag" hint={`Peak (last minute): ${d.loop_lag_max_ms} ms`} />
            <Metric label="Tick load" value={d.tick_budget_pct} unit="%" color={level(d.tick_budget_pct, 50, 85)} testid="health-tick-load" hint="Share of each second spent running game ticks" />
            <Metric label="Server CPU" value={d.cpu_pct} unit="%" color={level(d.cpu_pct, 70, 90)} testid="health-cpu" hint={`Load avg ${d.load_avg?.join(" / ")} on ${d.cpu_count} cores`} />
            <Metric label="Memory" value={Math.round(d.rss_mb)} unit="MB" testid="health-memory" />
            <Metric label="DB ping" value={d.db_ping_ms} unit="ms" color={level(d.db_ping_ms, 20, 60)} testid="health-db-ping" />
            <Metric label="Players / Bots" value={`${d.players_real} / ${d.bots}`} testid="health-players-bots" />
            <Metric label="Rooms (active)" value={`${d.rooms_total} (${d.rooms_active})`} testid="health-rooms" hint={`Uptime ${fmtUptime(d.uptime_s)}`} />
          </div>
          <AdminModeLoadTable d={d} />
          <div className="border-2 border-black max-h-64 overflow-y-auto" data-testid="health-rooms-table">
            <div className="grid grid-cols-12 bg-black text-white font-anton uppercase tracking-widest text-[10px] px-3 py-1.5 sticky top-0">
              <div className="col-span-4">Room</div>
              <div className="col-span-2">State</div>
              <div className="col-span-2 text-right">Players</div>
              <div className="col-span-1 text-right">Bots</div>
              <div className="col-span-3 text-right">Tick avg / peak</div>
            </div>
            {d.rooms.map((r, i) => (
              <div key={i} className={`grid grid-cols-12 px-3 py-1 text-xs border-t border-black/10 ${r.real ? "bg-[#FFF7D6]" : ""}`} data-testid={`health-room-${i}`}>
                <div className="col-span-4 font-anton uppercase truncate">{r.label}{r.mode === "tdm" ? " · TDM" : ""}</div>
                <div className="col-span-2 uppercase text-neutral-600">{r.state}</div>
                <div className="col-span-2 text-right font-anton">{r.real}</div>
                <div className="col-span-1 text-right">{r.bots}</div>
                <div className="col-span-3 text-right tabular-nums" style={{ color: level(r.tick_ms, 10, 25) }}>
                  {r.tick_ms} / {r.tick_ms_max} ms
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-neutral-500">Uptime {fmtUptime(d.uptime_s)} · {d.tick_rate} ticks/sec per room</div>
        </div>
      )}
    </div>
  );
}
