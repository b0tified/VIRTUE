// Server Health: per-mode load rows + Big FFA on/off ping comparison.
const tickColor = (v) => (v > 30 ? "#E62429" : v > 15 ? "#F39C12" : "#06A35F");
const rowBg = (v) => (v > 30 ? "bg-[#FDE2E2]" : v > 15 ? "bg-[#FFF3C4]" : "");

function PingCompare({ pc }) {
  const cell = (label, v, testid) => (
    <div className="border-2 border-black px-3 py-2 flex-1" data-testid={testid}>
      <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-500">{label}</div>
      <div className="font-display text-2xl leading-none mt-1">{v?.avg_ms != null ? `${v.avg_ms} ms` : "Not enough data"}</div>
      <div className="text-[10px] text-neutral-500 mt-1">{v?.players || 0} players · {v?.minutes || 0} min sampled</div>
    </div>
  );
  return (
    <div>
      <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-500 mb-1">Avg real-player ping, last 60 min</div>
      <div className="flex gap-2">
        {cell("Big FFA on", pc?.bigffa_on, "health-ping-bigffa-on")}
        {cell("Big FFA off", pc?.bigffa_off, "health-ping-bigffa-off")}
      </div>
    </div>
  );
}

export default function AdminModeLoadTable({ d }) {
  const modes = d.modes || [];
  const tot = modes.reduce((a, m) => ({ matches: a.matches + m.matches, real: a.real + m.real, bots: a.bots + m.bots, kb: a.kb + m.kb_per_s }), { matches: 0, real: 0, bots: 0, kb: 0 });
  return (
    <div className="space-y-3" data-testid="health-mode-load">
      <div className="border-2 border-black">
        <div className="grid grid-cols-12 bg-black text-white font-anton uppercase tracking-widest text-[10px] px-3 py-1.5">
          <div className="col-span-3">Mode</div>
          <div className="col-span-2 text-right">Matches</div>
          <div className="col-span-2 text-right">Players / Bots</div>
          <div className="col-span-3 text-right">Server time avg / worst</div>
          <div className="col-span-2 text-right">Data sent</div>
        </div>
        {modes.map((m) => (
          <div key={m.mode} className={`grid grid-cols-12 px-3 py-1 text-xs border-t border-black/10 ${rowBg(m.tick_ms_max)}`} data-testid={`health-mode-${m.mode.replace(/\s+/g, "-").toLowerCase()}`}>
            <div className="col-span-3 font-anton uppercase">{m.mode}</div>
            <div className="col-span-2 text-right font-anton">{m.matches}</div>
            <div className="col-span-2 text-right">{m.real} / {m.bots}</div>
            <div className="col-span-3 text-right tabular-nums" style={{ color: tickColor(m.tick_ms_max) }}>{m.tick_ms} / {m.tick_ms_max} ms</div>
            <div className="col-span-2 text-right tabular-nums">{m.kb_per_s} KB/s</div>
          </div>
        ))}
        <div className="grid grid-cols-12 px-3 py-1 text-xs border-t-2 border-black font-anton uppercase" data-testid="health-mode-totals">
          <div className="col-span-3">This copy total</div>
          <div className="col-span-2 text-right">{tot.matches}</div>
          <div className="col-span-2 text-right">{tot.real} / {tot.bots}</div>
          <div className="col-span-3 text-right">Loop lag {d.loop_lag_ms} ms · ping {d.ping_avg_ms ?? "—"} ms</div>
          <div className="col-span-2 text-right">{Math.round(tot.kb * 10) / 10} KB/s</div>
        </div>
      </div>
      <div className="text-[11px] text-neutral-600">
        Each game update is allowed 50 ms. Rows turn yellow over 15 ms and red over 30 ms. If server time stays low while ping is high, the delay comes from distance or the relay between server copies, not from the mode. Figures are for server copy {d.node} only.
      </div>
      <PingCompare pc={d.ping_compare} />
    </div>
  );
}
