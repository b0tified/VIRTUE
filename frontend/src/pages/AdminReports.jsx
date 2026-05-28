/* Admin Moderation Dashboard — /admin/reports
   Lists filed player reports and lets the admin take action:
   - Permanent ban
   - Temporary suspension (24h / 7d / 30d / custom hours)
   - Dismiss / close without action
   Non-admin users are bounced back to the lobby on mount. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Flag, Shield, ShieldOff, ShieldAlert, X, CheckCircle, Filter, Clock, Hammer, Sprout } from "lucide-react";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";

const REASON_LABEL = {
  cheating: "Cheating",
  harassment: "Harassment",
  griefing: "Griefing",
  offensive_name: "Offensive Name",
  other: "Other",
};
const REASON_COLOR = {
  cheating:       "#E62429",
  harassment:     "#FFB000",
  griefing:       "#9B59B6",
  offensive_name: "#FF7B00",
  other:          "#6b7280",
};

export default function AdminReports() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [statusFilter, setStatusFilter] = useState("open"); // "open" | "closed" | "all"
  const [busy, setBusy] = useState(false);
  const [actionTarget, setActionTarget] = useState(null); // { report } for ban modal
  const [toast, setToast] = useState(null);
  // Separate spinner for the Seed Leaderboard action so the main report
  // table doesn't dim while seeding.
  const [seedingBusy, setSeedingBusy] = useState(false);

  // Route guard: admins only. Players who somehow land here get a soft
  // redirect to lobby (the API also returns 403 so the data fetch fails
  // anyway, but this keeps the UI from flashing).
  useEffect(() => {
    if (user && user.role !== "admin") nav("/lobby", { replace: true });
  }, [user, nav]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = statusFilter === "all" ? {} : { status: statusFilter };
      const { data: res } = await api.get("/reports/player", { params: { ...params, limit: 100 } });
      setData(res);
    } catch (e) {
      setToast({ kind: "err", text: e?.response?.data?.detail || "Failed to load reports." });
    } finally {
      setBusy(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const closeReport = async (report) => {
    if (!window.confirm(`Dismiss report against ${report.reported_username}?`)) return;
    try {
      await api.post(`/admin/reports/${report.id}/close`);
      setToast({ kind: "ok", text: "Report dismissed." });
      load();
    } catch (e) {
      setToast({ kind: "err", text: e?.response?.data?.detail || "Failed to close report." });
    }
  };

  const onBanned = (msg) => {
    setActionTarget(null);
    setToast({ kind: "ok", text: msg });
    load();
  };

  // Auto-dismiss toast after 3.5s.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  /* One-tap leaderboard seeder. Calls the admin endpoint with the same
     distribution used in preview: 60 veterans + minimum floors per tier
     (4 Goonmasters, healthy spreads everywhere else). `reset: true` so
     re-clicking the button refreshes the seeded pool instead of piling
     up. Surfaces the inserted count in the toast. */
  const seedLeaderboard = async () => {
    if (seedingBusy) return;
    if (!window.confirm("Reset and seed the leaderboard with 60 fake veteran accounts? Existing seeded accounts will be wiped first.")) return;
    setSeedingBusy(true);
    try {
      const { data: res } = await api.post("/admin/seed/veterans", {
        count: 60,
        reset: true,
        min_goonmasters: 4,
        min_per_tier: { "0": 3, "1": 5, "2": 8, "3": 10, "4": 9, "5": 7, "6": 5, "7": 4 },
      });
      setToast({ kind: "ok", text: `Seeded ${res?.inserted ?? "?"} veteran accounts. Leaderboard refreshed.` });
    } catch (e) {
      setToast({ kind: "err", text: e?.response?.data?.detail || "Failed to seed leaderboard." });
    } finally {
      setSeedingBusy(false);
    }
  };


  const reports = data?.reports || [];
  const summary = data?.summary || [];
  const bans = data?.bans || {};
  const openCount = useMemo(() => reports.filter((r) => r.status === "open").length, [reports]);
  const closedCount = useMemo(() => reports.filter((r) => r.status === "closed").length, [reports]);
  const bannedCount = useMemo(
    () => Object.values(bans).filter((b) => b.status === "banned" || b.status === "suspended").length,
    [bans],
  );

  return (
    <div className="min-h-screen bg-pow-cream p-6" data-testid="admin-reports-page">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/lobby" className="btn-pow bg-black text-white [&]:px-3 [&]:py-1.5 flex items-center gap-2" data-testid="back-to-lobby-btn">
            <ArrowLeft size={16} strokeWidth={3} /> LOBBY
          </Link>
          <h1 className="font-display text-4xl text-pow-shadow flex items-center gap-2">
            <Shield className="text-[#E62429]" size={32} strokeWidth={3} />
            <span>MODERATION</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={seedLeaderboard}
            disabled={seedingBusy}
            className="btn-pow bg-[#06A35F] text-white [&]:px-3 [&]:py-1.5 [&]:text-xs disabled:opacity-60 disabled:cursor-wait"
            data-testid="seed-leaderboard-btn"
            title="Reset & seed 60 fake veteran accounts so the leaderboard isn't empty"
          >
            <span className="flex items-center gap-1.5">
              <Sprout size={14} strokeWidth={3} /> {seedingBusy ? "SEEDING…" : "SEED LEADERBOARD"}
            </span>
          </button>
          <Filter size={16} strokeWidth={3} />
          {["open", "closed", "all"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`btn-pow [&]:px-3 [&]:py-1 [&]:text-xs ${statusFilter === s ? "bg-[#FFD700] text-black" : "bg-neutral-200 text-neutral-600"}`}
              data-testid={`filter-${s}-btn`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {toast && (
        <div
          className={`max-w-6xl mx-auto mb-4 px-4 py-2 border-pow-thin font-anton uppercase tracking-widest text-sm ${
            toast.kind === "ok" ? "bg-[#E4F7EC] text-[#0a4f2a]" : "bg-[#FFE4E4] text-[#7a1115]"
          }`}
          data-testid="admin-toast"
        >
          {toast.text}
        </div>
      )}

      {/* Stat cards */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Reports" value={data?.total ?? 0} color="#0055FF" />
        <StatCard label="Open" value={openCount} color="#E62429" Icon={Flag} />
        <StatCard label="Closed" value={closedCount} color="#06A35F" Icon={CheckCircle} />
        <StatCard label="Active Sanctions" value={bannedCount} color="#9B59B6" Icon={ShieldAlert} />
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Reports list */}
        <div className="lg:col-span-2 card-pow p-0 overflow-hidden">
          <div className="bg-black text-white px-4 py-2 font-display text-2xl text-pow-shadow flex items-center justify-between">
            <span>REPORTS</span>
            <span className="font-anton uppercase tracking-widest text-xs">{statusFilter.toUpperCase()} · {reports.length}</span>
          </div>
          {busy && reports.length === 0 ? (
            <div className="bg-white p-8 text-center font-anton uppercase tracking-widest text-neutral-500">Loading…</div>
          ) : reports.length === 0 ? (
            <div className="bg-white p-8 text-center font-anton uppercase tracking-widest text-neutral-500">No {statusFilter !== "all" ? statusFilter : ""} reports</div>
          ) : (
            <div className="bg-white divide-y-2 divide-black/10">
              {reports.map((r) => (
                <ReportRow
                  key={r.id}
                  report={r}
                  banStatus={bans[r.reported_username]}
                  onBan={() => setActionTarget({ report: r })}
                  onClose={() => closeReport(r)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: most-reported */}
        <div className="card-pow p-0 overflow-hidden h-fit">
          <div className="bg-[#E62429] text-white px-4 py-2 font-display text-2xl text-pow-shadow flex items-center gap-2">
            <ShieldAlert size={22} strokeWidth={3} />
            MOST REPORTED
          </div>
          {summary.length === 0 ? (
            <div className="bg-white p-6 text-center font-anton uppercase tracking-widest text-xs text-neutral-500">No data yet</div>
          ) : (
            <div className="bg-white">
              {summary.map((s, i) => {
                const ban = bans[s.reported_username] || { status: "active" };
                return (
                  <div
                    key={s.reported_username}
                    className={`flex items-center justify-between gap-2 px-3 py-2 border-t-2 border-black/10 ${i === 0 ? "" : ""}`}
                    data-testid={`summary-row-${s.reported_username}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-display text-xl w-6 text-center">{i + 1}</span>
                      <span className="font-anton uppercase truncate">{s.reported_username}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <BanBadge status={ban.status} />
                      <span className="font-anton uppercase tracking-widest text-xs bg-black text-[#FFD700] px-2 py-0.5">
                        {s.count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {actionTarget && (
        <BanActionModal
          report={actionTarget.report}
          currentBan={bans[actionTarget.report.reported_username]}
          onCancel={() => setActionTarget(null)}
          onSuccess={onBanned}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color, Icon }) {
  return (
    <div className="card-pow p-0 overflow-hidden" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="px-3 py-1.5 font-anton uppercase tracking-widest text-xs text-white flex items-center gap-2" style={{ background: color }}>
        {Icon ? <Icon size={14} strokeWidth={3} /> : null}
        {label}
      </div>
      <div className="bg-white px-4 py-3">
        <div className="font-display text-4xl text-pow-shadow">{value}</div>
      </div>
    </div>
  );
}

function BanBadge({ status }) {
  if (status === "banned") {
    return (
      <span className="font-anton uppercase tracking-widest text-[10px] bg-[#E62429] text-white px-2 py-0.5">BANNED</span>
    );
  }
  if (status === "suspended") {
    return (
      <span className="font-anton uppercase tracking-widest text-[10px] bg-[#FFB000] text-black px-2 py-0.5">SUSPENDED</span>
    );
  }
  return null;
}

function ReportRow({ report, banStatus, onBan, onClose }) {
  const reason = report.reason || "other";
  const color = REASON_COLOR[reason] || "#6b7280";
  const ts = report.created_at ? new Date(report.created_at).toLocaleString() : "";
  const closed = report.status === "closed";
  return (
    <div className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-3" data-testid={`report-row-${report.id}`}>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className="font-anton uppercase tracking-widest text-[10px] text-white px-2 py-0.5"
          style={{ background: color }}
        >
          {REASON_LABEL[reason] || reason}
        </span>
        <BanBadge status={banStatus?.status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-anton uppercase text-sm truncate">
          <span className="text-[#E62429]">{report.reported_username}</span>
          <span className="text-neutral-500"> · reported by </span>
          <span>{report.reporter_username || "?"}</span>
        </div>
        {report.note && (
          <div className="text-xs text-neutral-700 truncate" title={report.note}>
            “{report.note}”
          </div>
        )}
        <div className="text-[10px] text-neutral-500 font-anton uppercase tracking-widest mt-0.5 flex items-center gap-2">
          <Clock size={10} strokeWidth={3} /> {ts}
          {closed && report.action && (
            <span className="text-[#06A35F]">· {report.action.toUpperCase()} by {report.closed_by}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {!closed && (
          <>
            <button
              onClick={onClose}
              className="btn-pow bg-neutral-200 text-neutral-700 [&]:px-2 [&]:py-1 [&]:text-[10px] flex items-center gap-1"
              data-testid={`dismiss-${report.id}-btn`}
            >
              <X size={11} strokeWidth={3} /> DISMISS
            </button>
            <button
              onClick={onBan}
              className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1 [&]:text-[10px] flex items-center gap-1"
              data-testid={`ban-${report.id}-btn`}
            >
              <Hammer size={11} strokeWidth={3} /> ACTION
            </button>
          </>
        )}
        {closed && (
          <span className="font-anton uppercase tracking-widest text-[10px] bg-neutral-200 text-neutral-600 px-2 py-1">CLOSED</span>
        )}
      </div>
    </div>
  );
}

const DURATIONS = [
  { id: "1h", label: "1 HOUR",     hours: 1 },
  { id: "24h", label: "24 HOURS",  hours: 24 },
  { id: "7d", label: "7 DAYS",     hours: 24 * 7 },
  { id: "30d", label: "30 DAYS",   hours: 24 * 30 },
  { id: "perm", label: "PERMANENT", hours: null },
];

function BanActionModal({ report, currentBan, onCancel, onSuccess }) {
  const [duration, setDuration] = useState("7d");
  const [reason, setReason] = useState(REASON_LABEL[report.reason] || "Violation of community guidelines");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (busy) return;
    const d = DURATIONS.find((x) => x.id === duration) || DURATIONS[2];
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/users/${report.reported_username}/ban`, {
        duration_hours: d.hours,
        reason,
        report_id: report.id,
      });
      onSuccess(d.hours ? `Suspended ${report.reported_username} for ${d.label.toLowerCase()}.` : `Permanently banned ${report.reported_username}.`);
    } catch (e) {
      setError(e?.response?.data?.detail || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const unban = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/users/${report.reported_username}/unban`);
      onSuccess(`Cleared sanction on ${report.reported_username}.`);
    } catch (e) {
      setError(e?.response?.data?.detail || "Unban failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" data-testid="ban-action-modal">
      <div className="card-pow p-0 w-full max-w-md">
        <div className="bg-[#E62429] text-white px-4 py-3 flex items-center justify-between">
          <div className="font-display text-2xl flex items-center gap-2">
            <Hammer size={20} strokeWidth={3} /> TAKE ACTION
          </div>
          <button onClick={onCancel} className="btn-pow bg-black text-white [&]:px-2 [&]:py-1" data-testid="ban-cancel-x">
            <X size={14} strokeWidth={3} />
          </button>
        </div>
        <div className="bg-white p-4 space-y-3">
          <div className="font-anton uppercase tracking-widest text-sm">
            Target: <span className="text-[#E62429]">{report.reported_username}</span>
            {currentBan && currentBan.status !== "active" && (
              <span className="ml-2"><BanBadge status={currentBan.status} /></span>
            )}
          </div>

          <div>
            <div className="font-anton uppercase tracking-widest text-xs mb-1.5">DURATION</div>
            <div className="grid grid-cols-3 gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDuration(d.id)}
                  className={`btn-pow [&]:px-2 [&]:py-2 [&]:text-[10px] ${duration === d.id ? "bg-[#FFD700] text-black" : "bg-neutral-200 text-neutral-700"}`}
                  data-testid={`duration-${d.id}-btn`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-anton uppercase tracking-widest text-xs mb-1.5">REASON (will be shown on login)</div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              className="w-full border-pow-thin bg-neutral-50 p-2 text-sm font-mono"
              rows={3}
              data-testid="ban-reason-input"
            />
          </div>

          {error && (
            <div className="bg-[#FFE4E4] text-[#7a1115] border-pow-thin px-3 py-2 font-anton uppercase tracking-widest text-xs">
              {typeof error === "string" ? error : "Action failed."}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancel}
              className="flex-1 btn-pow bg-neutral-200 text-black"
              data-testid="ban-cancel-btn"
            >
              CANCEL
            </button>
            {currentBan && currentBan.status !== "active" && (
              <button
                onClick={unban}
                disabled={busy}
                className="flex-1 btn-pow bg-[#06A35F] text-white"
                data-testid="ban-unban-btn"
              >
                <ShieldOff size={14} strokeWidth={3} className="inline mr-1" /> UNBAN
              </button>
            )}
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 btn-pow bg-[#E62429] text-white"
              data-testid="ban-confirm-btn"
            >
              {busy ? "APPLYING…" : "APPLY"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
