// Moderation: rank spread across every division — ranked players, placement players (predicted rank) and bots.
import { useEffect, useState } from "react";
import api from "@/api";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";

const TIER_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];
const GROUPS = [
  { key: "ranked", label: "Ranked players" },
  { key: "placements", label: "Placements (predicted)" },
  { key: "bots", label: "Bots" },
];

function DistTooltip({ active, payload, total, on }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <div className="bg-white border-2 border-black px-2 py-1 text-xs">
      <div className="font-anton uppercase tracking-wider">{b.label}: {b.count} ({total ? ((b.count / total) * 100).toFixed(1) : 0}%)</div>
      {GROUPS.filter((g) => on[g.key]).map((g) => <div key={g.key}>{g.label}: {b[g.key]}</div>)}
    </div>
  );
}

function GroupToggles({ on, setOn, totals }) {
  return (
    <div className="flex flex-wrap gap-3 mb-3">
      {GROUPS.map((g) => (
        <label key={g.key} className="flex items-center gap-1 text-xs font-anton uppercase tracking-wider cursor-pointer">
          <input type="checkbox" checked={on[g.key]} onChange={(e) => setOn({ ...on, [g.key]: e.target.checked })} data-testid={`rank-distribution-toggle-${g.key}`} />
          {g.label} ({totals?.[g.key] ?? 0})
        </label>
      ))}
    </div>
  );
}

export default function AdminRankDistributionPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [on, setOn] = useState({ ranked: true, placements: true, bots: true });
  const load = () => {
    setLoading(true);
    api.get("/admin/rank_distribution").then(({ data }) => setData(data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const rows = (data?.buckets || []).map((b) => ({ ...b, count: GROUPS.reduce((s, g) => s + (on[g.key] ? b[g.key] : 0), 0) }));
  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-rank-distribution-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="font-anton uppercase tracking-widest text-sm flex items-center gap-2">
          <BarChart3 size={16} strokeWidth={3} className="text-[#E62429]" />
          <span>Rank Distribution</span>
          {data && <span className="text-xs text-neutral-600 normal-case tracking-normal" data-testid="rank-distribution-totals">· {total} shown</span>}
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-pow bg-white text-black text-xs px-3 py-1" data-testid="rank-distribution-refresh-button">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      {!data ? <Loader2 size={16} className="animate-spin" /> : (
        <>
          <GroupToggles on={on} setOn={setOn} totals={data.totals} />
          <div className="h-72" data-testid="rank-distribution-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 60, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" interval={0} angle={-55} textAnchor="end" tick={{ fontSize: 10 }} height={70} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip content={<DistTooltip total={total} on={on} />} cursor={{ fill: "rgba(0,0,0,0.06)" }} />
                <Bar dataKey="count" stroke="#000" strokeWidth={1.5}>
                  {rows.map((b) => <Cell key={b.key} fill={TIER_COLORS[b.tier]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
