// Moderation: how real (non-bot) players are spread across every rank division.
import { useEffect, useState } from "react";
import api from "@/api";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";

const TIER_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];
const colorFor = (t) => (t < 0 ? "#737373" : TIER_COLORS[t]);

function DistTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <div className="bg-white border-2 border-black px-2 py-1 text-xs font-anton uppercase tracking-wider">
      {b.label}: {b.count} ({total ? ((b.count / total) * 100).toFixed(1) : 0}%)
    </div>
  );
}

export default function AdminRankDistributionPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hideUnranked, setHideUnranked] = useState(false);
  const load = () => {
    setLoading(true);
    api.get("/admin/rank_distribution").then(({ data }) => setData(data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-rank-distribution-panel">
      <div className="flex items-center justify-between mb-1">
        <div className="font-anton uppercase tracking-widest text-sm flex items-center gap-2">
          <BarChart3 size={16} strokeWidth={3} className="text-[#E62429]" />
          <span>Rank Distribution · Real Players</span>
        </div>
        <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-xs font-anton uppercase tracking-wider cursor-pointer">
          <input type="checkbox" checked={hideUnranked} onChange={(e) => setHideUnranked(e.target.checked)} data-testid="rank-distribution-hide-unranked" />
          Hide unranked
        </label>
        <button type="button" onClick={load} disabled={loading} className="btn-pow bg-white text-black text-xs px-3 py-1" data-testid="rank-distribution-refresh-button">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
        </div>
      </div>
      {data && (
        <div className="text-xs text-neutral-600 mb-3" data-testid="rank-distribution-totals">
          {data.total} players · {data.ranked} ranked · {data.total - data.ranked} unranked (in placements)
        </div>
      )}
      {!data ? <Loader2 size={16} className="animate-spin" /> : (
        <div className="h-72" data-testid="rank-distribution-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hideUnranked ? data.buckets.filter((b) => b.tier >= 0) : data.buckets} margin={{ top: 8, right: 8, bottom: 60, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" interval={0} angle={-55} textAnchor="end" tick={{ fontSize: 10 }} height={70} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip content={<DistTooltip total={hideUnranked ? data.ranked : data.total} />} cursor={{ fill: "rgba(0,0,0,0.06)" }} />
              <Bar dataKey="count" stroke="#000" strokeWidth={1.5}>
                {(hideUnranked ? data.buckets.filter((b) => b.tier >= 0) : data.buckets).map((b) => <Cell key={b.key} fill={colorFor(b.tier)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
