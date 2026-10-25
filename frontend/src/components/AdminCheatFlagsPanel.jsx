// Moderation: auto-flagged suspicious players + adjustable flag limits.
import { useCallback, useEffect, useState } from "react";
import api from "@/api";
import { ShieldAlert, Loader2, Check, MessageSquareWarning, Ban } from "lucide-react";
import AdminAnticheatConfig from "@/components/AdminAnticheatConfig";

const pct = (v) => `${Math.round((v || 0) * 100)}%`;
const TABS = [["active", "Needs review"], ["cleared", "Cleared"], ["banned", "Banned"]];

function StatGrid({ s }) {
  const items = [["Matches", s.matches], ["Accuracy", pct(s.accuracy)], ["Headshot", pct(s.hs_rate)], ["Snap hits", pct(s.snap_rate)], ["K/D", s.kd], ["Shots", s.shots]];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {items.map(([k, v]) => (
        <div key={k} className="border-2 border-black px-2 py-1 text-center">
          <div className="text-[9px] font-anton uppercase tracking-widest opacity-60">{k}</div>
          <div className="font-anton text-sm">{v}</div>
        </div>
      ))}
    </div>
  );
}

function RecentMatches({ rows }) {
  if (!rows?.length) return null;
  return (
    <table className="w-full text-[11px] mt-2">
      <thead><tr className="text-left opacity-60 font-anton uppercase tracking-wider"><th>Mode</th><th>K/D</th><th>Acc</th><th>HS</th><th>Snap</th><th>Place</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-black/10">
            <td>{r.game_mode === "tdm" ? "TDM" : r.mode}</td>
            <td>{r.kills}/{r.deaths}</td>
            <td>{r.shots ? pct(r.hits / r.shots) : "-"}</td>
            <td>{r.hits ? pct(r.head_hits / r.hits) : "-"}</td>
            <td>{r.hits ? pct(r.snap_hits / r.hits) : "-"}</td>
            <td>{r.placement}/{r.total_players}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FlagActions({ f, onDone, onToast }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action, duration_hours = null) => {
    if (action === "ban" && !window.confirm(`Ban ${f.username}${duration_hours ? ` for ${duration_hours / 24} days` : " permanently"}?`)) return;
    setBusy(true);
    try {
      await api.post(`/admin/cheat_flags/${f.user_id}/action`, { action, note, duration_hours });
      onToast?.({ kind: "ok", text: `${f.username}: ${action === "clear" ? "cleared" : action === "warn" ? "warning noted" : "banned"}.` });
      onDone();
    } catch (e) {
      onToast?.({ kind: "err", text: e?.response?.data?.detail || "Action failed." });
    } finally {
      setBusy(false);
    }
  };
  const B = ({ onClick, cls, testid, children }) => (
    <button type="button" disabled={busy} onClick={onClick} className={`btn-pow text-xs px-3 py-1 flex items-center gap-1 ${cls}`} data-testid={testid}>{children}</button>
  );
  return (
    <div className="flex flex-wrap gap-2 items-center mt-3">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note (optional)" className="border-2 border-black px-2 py-1 text-xs flex-1 min-w-[160px]" data-testid={`cheat-flag-note-${f.user_id}`} />
      <B onClick={() => act("clear")} cls="bg-[#06A35F] text-white" testid={`cheat-flag-clear-${f.user_id}`}><Check size={12} /> Clear</B>
      <B onClick={() => act("warn")} cls="bg-[#FFD700] text-black" testid={`cheat-flag-warn-${f.user_id}`}><MessageSquareWarning size={12} /> Warn</B>
      <B onClick={() => act("ban", 168)} cls="bg-white text-black" testid={`cheat-flag-ban7-${f.user_id}`}><Ban size={12} /> 7-day ban</B>
      <B onClick={() => act("ban")} cls="bg-[#E62429] text-white" testid={`cheat-flag-ban-${f.user_id}`}><Ban size={12} /> Perm ban</B>
    </div>
  );
}

function FlagCard({ f, onDone, onToast, showActions }) {
  return (
    <div className="border-4 border-black p-3" data-testid={`cheat-flag-${f.user_id}`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <span className="font-anton uppercase tracking-wider" data-testid={`cheat-flag-username-${f.user_id}`}>{f.username}</span>
        <span className="text-[10px] font-anton uppercase tracking-widest px-2 py-0.5 border-2 border-black" data-testid={`cheat-flag-status-${f.user_id}`}>{f.status}</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {(f.reasons || []).map((r) => <span key={r} className="bg-[#E62429] text-white text-[10px] font-anton uppercase tracking-wider px-2 py-0.5">{r}</span>)}
      </div>
      <StatGrid s={f.stats || {}} />
      <RecentMatches rows={f.recent_matches} />
      {(f.notes || []).slice(-3).map((n, i) => (
        <div key={i} className="text-[11px] mt-1 text-neutral-600">• {n.by} {n.action}{n.text ? `: ${n.text}` : ""}</div>
      ))}
      {showActions && <FlagActions f={f} onDone={onDone} onToast={onToast} />}
    </div>
  );
}

export default function AdminCheatFlagsPanel({ onToast }) {
  const [tab, setTab] = useState("active");
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    api.get(`/admin/cheat_flags?status=${tab}`).then(({ data }) => setData(data)).catch(() => {});
  }, [tab]);
  useEffect(() => { setData(null); load(); }, [load]);
  const c = data?.counts || {};

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-cheat-flags-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <ShieldAlert size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Anti-Cheat Flags</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">Players whose recent matches look inhuman. Nothing happens to them until you act.</div>
      <div className="flex gap-2 mb-3">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`btn-pow text-xs px-3 py-1 ${tab === k ? "bg-black text-white" : "bg-white text-black"}`} data-testid={`cheat-flags-tab-${k}`}>
            {label} ({k === "active" ? (c.open || 0) + (c.warned || 0) : c[k] || 0})
          </button>
        ))}
      </div>
      {!data ? <Loader2 size={16} className="animate-spin" /> : data.flags.length === 0 ? (
        <div className="text-xs text-neutral-500 py-4" data-testid="cheat-flags-empty">No players here.</div>
      ) : (
        <div className="space-y-3">
          {data.flags.map((f) => <FlagCard key={f.user_id} f={f} onDone={load} onToast={onToast} showActions={tab === "active"} />)}
        </div>
      )}
      <AdminAnticheatConfig onToast={onToast} />
    </div>
  );
}
