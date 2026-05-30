/* Admin Moderation Dashboard — /admin/reports
   Lists filed player reports and lets the admin take action:
   - Permanent ban
   - Temporary suspension (24h / 7d / 30d / custom hours)
   - Dismiss / close without action
   Non-admin users are bounced back to the lobby on mount. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Flag, Shield, ShieldOff, ShieldAlert, X, CheckCircle, Filter, Clock, Hammer, Sprout, Ticket, Trash2, Plus } from "lucide-react";
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

      {/* Redeem code creator — admin-only one-time-per-user promo codes */}
      <div className="max-w-6xl mx-auto mt-6">
        <RedeemCodesCard setToast={setToast} />
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

/* RedeemCodesCard — admin form + list for dynamic redeem codes.
   - Form: code text, reward type select, amount input, optional label.
   - List: existing dynamic codes with reward summary, redemption count,
     and a delete button. Hardcoded built-in codes are not shown here
     (they live in source and can't be edited via UI). */
const REWARD_TYPE_OPTIONS = [
  { value: "xp",              label: "XP",                    needsAmount: true,  unit: "XP" },
  { value: "rp",              label: "Rank Points",           needsAmount: true,  unit: "RP" },
  { value: "coins",           label: "Coins",                 needsAmount: true,  unit: "Coins" },
  { value: "min_level",       label: "Min Level (skip to)",   needsAmount: true,  unit: "Lv" },
  { value: "rank_up_tiers",   label: "Rank-Up Tiers",         needsAmount: true,  unit: "Tier(s)" },
  { value: "banner_animated", label: "Animated Banner",       needsAmount: false, unit: "" },
];

function RedeemCodesCard({ setToast }) {
  const [codes, setCodes] = useState(null);   // null = loading
  const [form, setForm] = useState({ code: "", reward_type: "xp", amount: "100", label: "" });
  const [creating, setCreating] = useState(false);
  const [deletingCode, setDeletingCode] = useState(null);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/codes");
      setCodes(Array.isArray(data?.codes) ? data.codes : []);
    } catch (e) {
      setToast?.({ kind: "err", text: e?.response?.data?.detail || "Failed to load codes." });
      setCodes([]);
    }
  }, [setToast]);

  useEffect(() => { reload(); }, [reload]);

  const currentTypeMeta = REWARD_TYPE_OPTIONS.find((o) => o.value === form.reward_type) || REWARD_TYPE_OPTIONS[0];

  const submit = async (e) => {
    e?.preventDefault?.();
    if (creating) return;
    const code = (form.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) {
      setToast?.({ kind: "err", text: "Code must be 3-20 alphanumeric characters." });
      return;
    }
    const body = { code, reward_type: form.reward_type, label: (form.label || "").trim() || null };
    if (currentTypeMeta.needsAmount) {
      const amt = parseInt(form.amount, 10);
      if (!amt || amt <= 0) {
        setToast?.({ kind: "err", text: "Amount must be a positive integer." });
        return;
      }
      body.amount = amt;
    }
    setCreating(true);
    try {
      await api.post("/admin/codes", body);
      setToast?.({ kind: "ok", text: `Code ${code} created.` });
      setForm({ code: "", reward_type: "xp", amount: "100", label: "" });
      reload();
    } catch (err) {
      setToast?.({ kind: "err", text: err?.response?.data?.detail || "Failed to create code." });
    } finally {
      setCreating(false);
    }
  };

  const deleteCode = async (code) => {
    if (deletingCode) return;
    if (!window.confirm(`Delete code "${code}"? Users who already redeemed it keep their reward, but no one else can redeem it.`)) return;
    setDeletingCode(code);
    try {
      await api.delete(`/admin/codes/${encodeURIComponent(code)}`);
      setToast?.({ kind: "ok", text: `Code ${code} deleted.` });
      reload();
    } catch (err) {
      setToast?.({ kind: "err", text: err?.response?.data?.detail || "Failed to delete code." });
    } finally {
      setDeletingCode(null);
    }
  };

  return (
    <div className="card-pow p-0 overflow-hidden" data-testid="admin-redeem-codes-card">
      <div className="bg-[#9B59B6] text-white px-4 py-2 font-display text-2xl text-pow-shadow flex items-center gap-2">
        <Ticket size={22} strokeWidth={3} />
        REDEEM CODES
        <span className="ml-auto font-anton uppercase tracking-widest text-xs opacity-90">
          {codes === null ? "…" : `${codes.length} ACTIVE`}
        </span>
      </div>

      {/* Create form */}
      <form
        onSubmit={submit}
        className="bg-white p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end border-b-2 border-black"
        data-testid="redeem-code-create-form"
      >
        <div className="md:col-span-3">
          <label className="block font-anton uppercase tracking-widest text-xs mb-1">Code</label>
          <input
            type="text"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
            placeholder="VIRTUE2026"
            maxLength={20}
            className="w-full border-2 border-black px-2 py-1.5 font-mono text-sm uppercase"
            data-testid="redeem-code-input"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block font-anton uppercase tracking-widest text-xs mb-1">Reward Type</label>
          <select
            value={form.reward_type}
            onChange={(e) => setForm({ ...form, reward_type: e.target.value })}
            className="w-full border-2 border-black px-2 py-1.5 font-anton uppercase text-sm bg-white"
            data-testid="redeem-reward-type-select"
          >
            {REWARD_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block font-anton uppercase tracking-widest text-xs mb-1">
            Amount {currentTypeMeta.unit && <span className="opacity-60">({currentTypeMeta.unit})</span>}
          </label>
          <input
            type="number"
            min="1"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            disabled={!currentTypeMeta.needsAmount}
            className="w-full border-2 border-black px-2 py-1.5 font-anton text-sm disabled:bg-neutral-100 disabled:text-neutral-400"
            data-testid="redeem-amount-input"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block font-anton uppercase tracking-widest text-xs mb-1">Label (optional)</label>
          <input
            type="text"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="e.g. +250 XP — Holiday Bonus"
            maxLength={80}
            className="w-full border-2 border-black px-2 py-1.5 text-sm"
            data-testid="redeem-label-input"
          />
        </div>
        <div className="md:col-span-1">
          <button
            type="submit"
            disabled={creating}
            className="btn-pow bg-[#06A35F] text-white w-full [&]:px-3 [&]:py-1.5 [&]:text-xs disabled:opacity-60 disabled:cursor-wait"
            data-testid="redeem-create-btn"
          >
            <span className="flex items-center justify-center gap-1">
              <Plus size={14} strokeWidth={3} /> {creating ? "..." : "ADD"}
            </span>
          </button>
        </div>
      </form>

      {/* List */}
      <div className="bg-white" data-testid="redeem-codes-list">
        {codes === null ? (
          <div className="p-6 text-center font-anton uppercase tracking-widest text-neutral-500">Loading...</div>
        ) : codes.length === 0 ? (
          <div className="p-6 text-center font-anton uppercase tracking-widest text-neutral-500" data-testid="redeem-codes-empty">
            No custom codes yet. Built-in codes (VIRTUE2026, COINSHOWER, etc.) still work.
          </div>
        ) : (
          <div className="divide-y-2 divide-black/10">
            <div className="hidden md:grid grid-cols-12 bg-[#FFD700] px-4 py-2 font-anton uppercase tracking-widest text-xs border-b-2 border-black">
              <div className="col-span-3">Code</div>
              <div className="col-span-3">Reward</div>
              <div className="col-span-3">Label</div>
              <div className="col-span-2 text-right">Redemptions</div>
              <div className="col-span-1"></div>
            </div>
            {codes.map((c) => (
              <div
                key={c.code}
                className="grid grid-cols-12 px-4 py-2 items-center text-sm gap-2"
                data-testid={`redeem-code-row-${c.code}`}
              >
                <div className="col-span-12 md:col-span-3 font-mono uppercase tracking-wider">
                  <span className="bg-[#0A0A0A] text-[#FFD700] px-2 py-0.5">{c.code}</span>
                </div>
                <div className="col-span-6 md:col-span-3 font-anton uppercase text-xs">
                  {summarizeReward(c.reward)}
                </div>
                <div className="col-span-6 md:col-span-3 text-xs text-neutral-700 truncate">
                  {c.label || <span className="text-neutral-400">—</span>}
                </div>
                <div className="col-span-6 md:col-span-2 md:text-right font-anton text-base" data-testid={`redeem-code-count-${c.code}`}>
                  {c.redeemed_count}
                </div>
                <div className="col-span-6 md:col-span-1 md:text-right">
                  <button
                    onClick={() => deleteCode(c.code)}
                    disabled={deletingCode === c.code}
                    className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1 [&]:text-xs disabled:opacity-60"
                    data-testid={`redeem-code-delete-${c.code}`}
                    title="Delete this code"
                  >
                    <Trash2 size={12} strokeWidth={3} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function summarizeReward(reward) {
  if (!reward || typeof reward !== "object") return "—";
  const parts = [];
  if (reward.xp) parts.push(`+${reward.xp} XP`);
  if (reward.rp) parts.push(`+${reward.rp} RP`);
  if (reward.coins) parts.push(`+${reward.coins} Coins`);
  if (reward.min_level) parts.push(`Level ${reward.min_level}`);
  if (reward.rank_up_tiers) parts.push(`+${reward.rank_up_tiers} Tier`);
  if (reward.banner_animated) parts.push("Animated Banner");
  return parts.join(" · ") || "—";
}

