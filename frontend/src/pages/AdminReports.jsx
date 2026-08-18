/* Admin Moderation Dashboard — /admin/reports
   Lists filed player reports and lets the admin take action:
   - Permanent ban
   - Temporary suspension (24h / 7d / 30d / custom hours)
   - Dismiss / close without action
   Non-admin users are bounced back to the lobby on mount. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Flag, Shield, ShieldOff, ShieldAlert, X, CheckCircle, Filter, Clock, Hammer, Sprout, Ticket, Trash2, Plus, RotateCcw, AlertTriangle, Flame, Activity, Loader2 } from "lucide-react";
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

      {/* Live player activity + mode popularity — polls every 5s. */}
      <div className="max-w-6xl mx-auto mb-6">
        <LivePlayerStats />
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

      {/* Season-pass nuke button — wipes everyone's pass progression
          (season_xp + claimed_season_tiers) without touching RP or
          cosmetics. Used when the live pass needs to be reset early
          without waiting for the season countdown. */}
      <div className="max-w-6xl mx-auto mt-6">
        <ResetPassCard setToast={setToast} />
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

/* LivePlayerStats — real-time snapshot of who's playing what right now.
   Polls `/api/admin/live-stats` every 5s. Shows:
     • The headline "displayed / real online" pair (comic split badge).
     • Mode popularity — FFA Casual vs TDM Casual vs Ranked, with the
       most-popular row highlighted so it pops at a glance.
     • Queue depth (ranked + casual).
     • Per-room breakdown grid: quick match, ranked, practice,
       offline vs AI, ranked-vs-bots, party rooms.
   Renders a "waiting for first snapshot…" placeholder before the first
   fetch completes; the parent handles admin route-guarding. */
function LivePlayerStats() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/admin/live-stats");
        if (alive) { setStats(data); setErr(null); }
      } catch (e) {
        if (alive) setErr(e?.response?.data?.detail || "Failed to load live stats.");
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (err) {
    return (
      <div className="card-pow p-4 bg-white font-anton uppercase tracking-widest text-xs text-[#7a1115]" data-testid="live-stats-error">
        {err}
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="card-pow p-4 bg-white font-anton uppercase tracking-widest text-xs text-neutral-500" data-testid="live-stats-loading">
        Loading live activity…
      </div>
    );
  }
  const pop = stats.mode_popularity || {};
  const rooms = stats.rooms || {};
  const q = stats.queues || {};
  // Determine which mode has the most active players so it can be
  // highlighted. Ties break in the order below.
  const popTotal = (pop.ffa_casual || 0) + (pop.tdm_casual || 0) + (pop.ranked || 0);
  const topMode = popTotal === 0
    ? null
    : Object.entries({
        ffa_casual: pop.ffa_casual || 0,
        tdm_casual: pop.tdm_casual || 0,
        ranked: pop.ranked || 0,
      }).sort((a, b) => b[1] - a[1])[0][0];
  return (
    <div className="card-pow p-0 overflow-hidden" data-testid="live-player-stats">
      <div className="bg-black text-white px-4 py-2 font-display text-2xl text-pow-shadow flex items-center justify-between">
        <span>LIVE PLAYER STATS</span>
        <span className="font-anton uppercase tracking-widest text-xs opacity-70" data-testid="live-stats-ts">
          Auto-refresh · 5s
        </span>
      </div>

      {/* Top headline row: displayed count / real online / in-match / parties */}
      <div className="bg-white grid grid-cols-2 md:grid-cols-4 divide-x-2 divide-black/10 border-b-2 border-black/10">
        <HeadlineTile label="Displayed Online" value={stats.displayed_online} color="#0055FF" testid="live-headline-displayed" />
        {/* Real Online = union of in-match WS users + lobby-heartbeat
            users. Split shown below so admins can see the mix at a
            glance (e.g. "40 online / 8 in-match / 32 in lobby"). */}
        <HeadlineTile
          label="Real Online"
          value={stats.real_online}
          sub={
            Number.isFinite(stats.real_online_in_match) &&
            Number.isFinite(stats.real_online_in_lobby)
              ? `${stats.real_online_in_match} in-match · ${stats.real_online_in_lobby} in lobby`
              : null
          }
          color="#06A35F"
          testid="live-headline-real"
        />
        <HeadlineTile label="In-Match" value={pop.in_match_total || 0} color="#E62429" testid="live-headline-in-match" />
        <HeadlineTile
          label="Peak Online"
          value={stats.peak_online || 0}
          sub={
            stats.peak_online_at
              ? new Date(stats.peak_online_at).toLocaleString(undefined, {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })
              : null
          }
          color="#FFD700"
          testid="live-headline-peak"
        />
      </div>
      {/* Second-row secondary tile — parties count moved here so the
          headline row has space for Peak Online without shrinking any
          of the primary numbers. */}
      <div className="bg-white px-4 py-2 border-b-2 border-black/10 flex items-center gap-4">
        <div className="font-anton uppercase tracking-widest text-xs opacity-70">
          Parties active <span className="ml-1 font-display text-lg text-[#9B59B6]" data-testid="live-headline-parties">{stats.parties || 0}</span>
        </div>
      </div>

      {/* Mode popularity + queues side-by-side */}
      <div className="bg-white grid grid-cols-1 md:grid-cols-2 gap-0 divide-x-0 md:divide-x-2 divide-black/10 border-b-2 border-black/10">
        <div className="p-4">
          <div className="font-anton uppercase tracking-widest text-xs mb-2 flex items-center gap-2 opacity-80">
            <Flame size={14} strokeWidth={3} className="text-[#E62429]" />
            <span>Mode Popularity</span>
            {topMode && (
              <span className="ml-auto font-anton uppercase tracking-widest text-[10px] bg-[#FFD700] text-black px-2 py-0.5">
                {topMode === "ffa_casual" ? "FFA leads" : topMode === "tdm_casual" ? "TDM leads" : "RANKED leads"}
              </span>
            )}
          </div>
          <ModeRow label="FFA · Casual"  value={pop.ffa_casual || 0} color="#E62429" total={popTotal} isTop={topMode === "ffa_casual"} testid="mode-ffa" />
          <ModeRow label="TDM · Casual"  value={pop.tdm_casual || 0} color="#0055FF" total={popTotal} isTop={topMode === "tdm_casual"} testid="mode-tdm" />
          <ModeRow label="Ranked"        value={pop.ranked || 0}     color="#9B59B6" total={popTotal} isTop={topMode === "ranked"}      testid="mode-ranked" />
        </div>
        <div className="p-4">
          <div className="font-anton uppercase tracking-widest text-xs mb-2 flex items-center gap-2 opacity-80">
            <Clock size={14} strokeWidth={3} className="text-[#0055FF]" />
            <span>Queues</span>
          </div>
          <QueueRow label="Casual Queue" value={q.casual_total || 0} color="#E62429" testid="queue-casual" />
          <QueueRow label="Ranked Queue (all tiers)" value={q.ranked_total || 0} color="#9B59B6" testid="queue-ranked" />
          {(q.ranked_by_tier || []).length > 0 && (
            <div className="mt-2 pt-2 border-t border-black/10">
              <div className="font-anton uppercase tracking-widest text-[10px] opacity-60 mb-1">Per-tier ranked queue</div>
              <div className="flex flex-wrap gap-1.5" data-testid="queue-ranked-tiers">
                {q.ranked_by_tier.map((t) => (
                  <span
                    key={t.tier}
                    className="font-anton uppercase tracking-widest text-[10px] bg-neutral-200 text-neutral-800 px-2 py-0.5"
                    data-testid={`queue-ranked-tier-${t.tier}`}
                  >
                    {t.tier_name} · {t.players}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Per-room breakdown grid */}
      <div className="bg-white p-4">
        <div className="font-anton uppercase tracking-widest text-xs mb-2 opacity-80 flex items-center gap-2">
          <ShieldAlert size={14} strokeWidth={3} className="text-neutral-700" />
          <span>Rooms — Human Players</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <RoomTile name="QM · FFA"        room={rooms.quick_match_ffa} testid="room-qm-ffa" />
          <RoomTile name="QM · TDM"        room={rooms.quick_match_tdm} testid="room-qm-tdm" />
          <RoomTile name="Ranked"          room={rooms.ranked}          testid="room-ranked" />
          <RoomTile name="Practice · FFA"  room={rooms.practice_ffa}    testid="room-practice-ffa" />
          <RoomTile name="Practice · TDM"  room={rooms.practice_tdm}    testid="room-practice-tdm" />
          <RoomTile name="Offline · FFA"   room={rooms.offline_ffa}     testid="room-offline-ffa" />
          <RoomTile name="Offline · TDM"   room={rooms.offline_tdm}     testid="room-offline-tdm" />
          <RoomTile name="Ranked vs Bots"  room={rooms.ranked_vs_bots}  testid="room-ranked-bots" />
          <RoomTile name="Party · FFA"     room={rooms.party_ffa}       testid="room-party-ffa" />
          <RoomTile name="Party · TDM"     room={rooms.party_tdm}       testid="room-party-tdm" />
        </div>
      </div>

      {/* Matches played per mode — last 24 hours. Added per user
          request: gives moderation a longer-window signal than the
          instantaneous "in-match" counters above. Counts are
          DISTINCT-match aggregates (a 4-player match = 1, not 4). */}
      {stats.matches_last_24h && (
        <div className="bg-white p-4 border-t-2 border-black/10" data-testid="matches-24h-panel">
          <div className="font-anton uppercase tracking-widest text-xs mb-2 opacity-80 flex items-center gap-2">
            <Activity size={14} strokeWidth={3} className="text-neutral-700" />
            <span>Matches Played — Last 24h</span>
            <span className="ml-auto font-display text-lg text-pow-shadow tabular-nums" data-testid="matches-24h-total">
              {stats.matches_last_24h.total || 0}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ModeCountTile
              label="FFA Casual"
              value={stats.matches_last_24h.ffa_casual || 0}
              color="#0055FF"
              testid="matches-24h-ffa-casual"
            />
            <ModeCountTile
              label="FFA Ranked"
              value={stats.matches_last_24h.ffa_ranked || 0}
              color="#E62429"
              testid="matches-24h-ffa-ranked"
            />
            <ModeCountTile
              label="TDM Casual"
              value={stats.matches_last_24h.tdm_casual || 0}
              color="#06A35F"
              testid="matches-24h-tdm-casual"
            />
          </div>
        </div>
      )}

      {/* Casual smurf-bot ratio slider — admin can dial the frequency
          of Diamond+ disguised elite bots in casual FFA without a
          redeploy. New value applies on the NEXT bot fill in any
          casual room. Backed by /api/admin/settings/smurf. */}
      <SmurfRatioSlider />
    </div>
  );
}

function SmurfRatioSlider() {
  // Two-slider panel: casual smurf frequency (%) AND smurf sharpness (diff).
  // Both share the same GET / POST endpoint — POST accepts partial
  // updates so each slider saves independently on debounce.
  const [ratio, setRatio] = useState(null);
  const [diff, setDiff] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [err, setErr] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get("/admin/settings/smurf")
      .then(({ data }) => {
        if (!alive) return;
        setRatio(Number(data.ratio) || 0);
        setDiff(Number(data.diff) || 1.7);
      })
      .catch((e) => {
        if (alive) setErr(e?.response?.data?.detail || "Failed to load smurf settings.");
      });
    return () => { alive = false; };
  }, []);

  // Shared debounced save so BOTH sliders coalesce into one request
  // when the admin drags them in quick succession. Passing only the
  // key(s) that changed matches the endpoint's partial-update shape.
  const scheduleSave = useCallback((patch) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true); setErr(null);
      try {
        await api.post("/admin/settings/smurf", patch);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 900);
      } catch (e) {
        setErr(e?.response?.data?.detail || "Failed to save.");
      } finally {
        setSaving(false);
      }
    }, 250);
  }, []);

  if (ratio === null && !err) {
    return (
      <div className="bg-white p-4 border-t-2 border-black/10 opacity-60" data-testid="smurf-slider-loading">
        <div className="font-anton uppercase tracking-widest text-xs">Loading smurf settings…</div>
      </div>
    );
  }

  const pct = Math.round((ratio || 0) * 100);
  // Difficulty slider granularity: step 0.05 across the [1.5, 2.5]
  // window (below 1.5 kills the elite AI behaviour, above 2.5 out-
  // guns full ranked at 1.9). Slider surfaces integer 30-50; display
  // shows the actual 1.50-2.50 value so the admin knows the exact
  // multiplier the spawn loop will use.
  const diffPct = Math.round(((diff || 1.7) - 1.5) * 100);   // 0..100 → 1.5..2.5

  return (
    <div className="bg-white p-4 border-t-2 border-black/10" data-testid="smurf-slider-panel">
      <div className="font-anton uppercase tracking-widest text-xs mb-2 opacity-80 flex items-center gap-2">
        <Sprout size={14} strokeWidth={3} className="text-[#9D4EDD]" />
        <span>Casual Smurf Bots</span>
        {saving && (
          <span className="ml-auto flex items-center gap-1 text-neutral-500">
            <Loader2 size={12} strokeWidth={3} className="animate-spin" /> saving…
          </span>
        )}
        {!saving && savedFlash && (
          <span className="ml-auto text-[#06A35F]" data-testid="smurf-slider-saved">✓ saved</span>
        )}
      </div>

      {/* Frequency slider — how OFTEN casual fill bots become smurfs. */}
      <div className="mb-3">
        <div className="font-anton uppercase tracking-widest text-[10px] mb-1 text-neutral-600">Frequency</div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={pct}
            onChange={(e) => {
              const next = Number(e.target.value) / 100;
              setRatio(next);
              scheduleSave({ ratio: next });
            }}
            className="flex-1 accent-[#9D4EDD]"
            data-testid="smurf-slider-input"
            aria-label="Casual smurf-bot frequency"
          />
          <div
            className="font-display text-2xl text-pow-shadow leading-none tabular-nums w-16 text-right"
            data-testid="smurf-slider-value"
          >
            {pct}%
          </div>
        </div>
        <div className="mt-1 font-anton uppercase tracking-widest text-[9px] text-neutral-500">
          Share of casual fill bots that spawn as Diamond II with elite AI.
        </div>
      </div>

      {/* Sharpness slider — how HARD the smurf plays. */}
      <div>
        <div className="font-anton uppercase tracking-widest text-[10px] mb-1 text-neutral-600">Sharpness</div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={diffPct}
            onChange={(e) => {
              const next = 1.5 + Number(e.target.value) / 100;   // 1.5..2.5
              setDiff(next);
              scheduleSave({ diff: next });
            }}
            className="flex-1 accent-[#E62429]"
            data-testid="smurf-diff-slider-input"
            aria-label="Casual smurf-bot difficulty"
          />
          <div
            className="font-display text-2xl text-pow-shadow leading-none tabular-nums w-16 text-right"
            data-testid="smurf-diff-slider-value"
          >
            {(diff || 1.7).toFixed(2)}
          </div>
        </div>
        <div className="mt-1 font-anton uppercase tracking-widest text-[9px] text-neutral-500">
          AI difficulty multiplier — 1.50 baseline smart, 1.70 default, 1.90 matches ranked, 2.50 max.
        </div>
      </div>

      <div className="mt-2 font-anton uppercase tracking-widest text-[9px] text-neutral-400">
        Both settings apply on the next bot fill in any casual room.
      </div>

      {err && (
        <div className="mt-2 px-2 py-1 text-[10px] font-anton uppercase tracking-widest bg-[#FFE4E4] text-[#7a1115] border border-[#E62429]" data-testid="smurf-slider-error">
          {err}
        </div>
      )}
    </div>
  );
}

function ModeCountTile({ label, value, color, testid }) {
  return (
    <div className="border-2 border-black/10 rounded-sm px-3 py-2" data-testid={testid}>
      <div
        className="font-anton uppercase tracking-widest text-[10px] flex items-center gap-1.5"
        style={{ color }}
      >
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="font-display text-2xl text-pow-shadow leading-none tabular-nums">
        {value}
      </div>
    </div>
  );
}

function HeadlineTile({ label, value, color, testid, sub = null }) {
  return (
    <div className="px-4 py-3" data-testid={testid}>
      <div className="font-anton uppercase tracking-widest text-[10px] flex items-center gap-1.5" style={{ color }}>
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="font-display text-3xl text-pow-shadow leading-none tabular-nums">
        {value}
      </div>
      {sub && (
        <div
          className="font-anton uppercase tracking-widest text-[9px] mt-1 text-neutral-500 leading-tight"
          data-testid={`${testid}-sub`}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function ModeRow({ label, value, color, total, isTop, testid }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`flex items-center gap-3 py-1.5 ${isTop ? "opacity-100" : "opacity-90"}`} data-testid={testid}>
      <div className="font-anton uppercase tracking-widest text-xs w-32 flex-shrink-0" style={{ color: isTop ? color : "#0A0A0A" }}>
        {label}
      </div>
      <div className="flex-1 h-3 bg-neutral-200 border-2 border-black relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 transition-all"
          style={{ width: `${pct}%`, background: color }}
          data-testid={`${testid}-bar`}
        />
      </div>
      <div className="font-display text-lg text-pow-shadow tabular-nums w-12 text-right" data-testid={`${testid}-value`}>
        {value}
      </div>
      <div className="font-anton uppercase tracking-widest text-[10px] opacity-60 w-10 text-right tabular-nums">
        {pct}%
      </div>
    </div>
  );
}

function QueueRow({ label, value, color, testid }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1" data-testid={testid}>
      <div className="font-anton uppercase tracking-widest text-xs">{label}</div>
      <div className="font-display text-2xl leading-none tabular-nums px-2 py-0.5 border-2 border-black" style={{ background: color, color: "#fff" }}>
        {value}
      </div>
    </div>
  );
}

function RoomTile({ name, room, testid }) {
  const humans = (room && room.humans) || 0;
  const roomsCount = room && Number.isFinite(room.rooms) ? room.rooms : null;
  const modeColor = room?.mode === "tdm" ? "#0055FF" : "#E62429";
  const empty = humans === 0;
  return (
    <div
      className={`border-2 border-black p-2 flex flex-col ${empty ? "bg-neutral-100 opacity-70" : "bg-white"}`}
      data-testid={testid}
    >
      <div className="font-anton uppercase tracking-widest text-[10px] flex items-center gap-1 mb-1">
        <span className="inline-block w-1.5 h-1.5" style={{ background: modeColor }} />
        <span className="truncate">{name}</span>
      </div>
      <div className="font-display text-2xl leading-none tabular-nums">{humans}</div>
      {roomsCount !== null && (
        <div className="font-anton uppercase tracking-widest text-[9px] opacity-60 mt-0.5">
          {roomsCount} {roomsCount === 1 ? "room" : "rooms"}
        </div>
      )}
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
  const [form, setForm] = useState({
    code: "", reward_type: "xp", amount: "100", label: "",
    expires_at: "", max_redemptions: "",
  });
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
    // Optional expiry: HTML date input gives "YYYY-MM-DD" — backend
    // accepts that and treats as end-of-day.
    const exp = (form.expires_at || "").trim();
    if (exp) body.expires_at = exp;
    // Optional max redemptions
    if (form.max_redemptions !== "" && form.max_redemptions !== null) {
      const cap = parseInt(form.max_redemptions, 10);
      if (!cap || cap <= 0) {
        setToast?.({ kind: "err", text: "Max redemptions must be a positive integer." });
        return;
      }
      body.max_redemptions = cap;
    }
    setCreating(true);
    try {
      await api.post("/admin/codes", body);
      setToast?.({ kind: "ok", text: `Code ${code} created.` });
      setForm({ code: "", reward_type: "xp", amount: "100", label: "", expires_at: "", max_redemptions: "" });
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
        <div className="md:col-span-1 hidden md:block"></div>
        {/* Row 2: Optional limits + ADD button */}
        <div className="md:col-span-4">
          <label className="block font-anton uppercase tracking-widest text-xs mb-1">Expires (optional)</label>
          <input
            type="date"
            value={form.expires_at}
            onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
            className="w-full border-2 border-black px-2 py-1.5 font-anton text-sm"
            data-testid="redeem-expires-input"
          />
        </div>
        <div className="md:col-span-4">
          <label className="block font-anton uppercase tracking-widest text-xs mb-1">Max Redemptions (optional)</label>
          <input
            type="number"
            min="1"
            value={form.max_redemptions}
            onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })}
            placeholder="Unlimited"
            className="w-full border-2 border-black px-2 py-1.5 font-anton text-sm"
            data-testid="redeem-max-redemptions-input"
          />
        </div>
        <div className="md:col-span-4">
          <button
            type="submit"
            disabled={creating}
            className="btn-pow bg-[#06A35F] text-white w-full [&]:px-3 [&]:py-1.5 [&]:text-xs disabled:opacity-60 disabled:cursor-wait"
            data-testid="redeem-create-btn"
          >
            <span className="flex items-center justify-center gap-1">
              <Plus size={14} strokeWidth={3} /> {creating ? "..." : "ADD CODE"}
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
              <div className="col-span-2">Code</div>
              <div className="col-span-2">Reward</div>
              <div className="col-span-2">Label</div>
              <div className="col-span-2 text-right">Redemptions</div>
              <div className="col-span-2 text-right">Expires</div>
              <div className="col-span-1 text-right">Status</div>
              <div className="col-span-1"></div>
            </div>
            {codes.map((c) => (
              <div
                key={c.code}
                className="grid grid-cols-12 px-4 py-2 items-center text-sm gap-2"
                data-testid={`redeem-code-row-${c.code}`}
              >
                <div className="col-span-12 md:col-span-2 font-mono uppercase tracking-wider">
                  <span className={`bg-[#0A0A0A] text-[#FFD700] px-2 py-0.5 ${c.status !== "active" ? "line-through opacity-60" : ""}`}>
                    {c.code}
                  </span>
                </div>
                <div className="col-span-6 md:col-span-2 font-anton uppercase text-xs">
                  {summarizeReward(c.reward)}
                </div>
                <div className="col-span-6 md:col-span-2 text-xs text-neutral-700 truncate">
                  {c.label || <span className="text-neutral-400">—</span>}
                </div>
                <div className="col-span-6 md:col-span-2 md:text-right font-anton text-base" data-testid={`redeem-code-count-${c.code}`}>
                  {c.redeemed_count}
                  {c.max_redemptions != null && (
                    <span className="text-neutral-500 text-xs"> / {c.max_redemptions}</span>
                  )}
                </div>
                <div className="col-span-6 md:col-span-2 md:text-right font-anton text-xs" data-testid={`redeem-code-expires-${c.code}`}>
                  {formatExpiry(c.expires_at)}
                </div>
                <div className="col-span-6 md:col-span-1 md:text-right">
                  <StatusBadge status={c.status} testid={`redeem-code-status-${c.code}`} />
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

/* Format an ISO expiry timestamp into a short relative string ("5d 4h",
   "2h 15m", "47s", or "—" if unset). Past dates collapse to "expired"
   — the status badge handles styling so just the label is enough. */
function formatExpiry(iso) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  if (s < 60)        return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)        return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48)        return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const STATUS_STYLE = {
  active:  { bg: "#06A35F", text: "#fff",     label: "ACTIVE" },
  expired: { bg: "#E62429", text: "#fff",     label: "EXPIRED" },
  maxed:   { bg: "#9B59B6", text: "#fff",     label: "MAXED" },
};

function StatusBadge({ status, testid }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.active;
  return (
    <span
      className="inline-block font-anton uppercase tracking-widest text-[10px] px-2 py-0.5 border-2 border-black"
      style={{ background: s.bg, color: s.text }}
      data-testid={testid}
    >
      {s.label}
    </span>
  );
}

/* ResetPassCard — danger-zone button on the admin dashboard that fires
   POST /api/admin/season/reset_pass. Wipes every player's pass
   progression (season_xp + claimed_season_tiers) to 0 / [] without
   touching ranked points or owned cosmetics. Two-step confirmation
   (click button → typed "RESET" gate) so it can't fire on a stray
   click — the alternative is 310+ players walking into a fresh pass
   they weren't expecting. */
function ResetPassCard({ setToast }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { modified, matched }

  const onFire = async () => {
    if (confirmText.trim().toUpperCase() !== "RESET") {
      setToast?.({ kind: "error", msg: 'Type RESET to confirm.' });
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/admin/season/reset_pass");
      setLastResult({
        modified: Number(data?.modified || 0),
        matched:  Number(data?.matched || 0),
      });
      setToast?.({ kind: "ok", msg: `Reset pass for ${data?.modified ?? 0} players.` });
      setOpen(false);
      setConfirmText("");
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || "Reset failed.";
      setToast?.({ kind: "error", msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-pow p-0 overflow-hidden" data-testid="admin-reset-pass-card">
      <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
        <RotateCcw size={18} strokeWidth={3} className="text-[#E62429]" />
        <span className="font-anton uppercase tracking-widest">Reset Season Pass</span>
        <span className="opacity-60 text-xs ml-auto">Danger zone — wipes all progression</span>
      </div>
      <div className="p-5 space-y-4 bg-white">
        <p className="text-sm leading-relaxed">
          Wipes every player's pass <strong>level + XP + claimed tiers</strong> back to
          zero. Ranked Points and owned cosmetics are <strong>not</strong> affected.
          Fires immediately — there's no undo. Normally the pass resets
          automatically when the season countdown ends; use this only if
          the live pass needs to be reset early.
        </p>
        {lastResult && (
          <div
            className="border-pow-thin bg-[#06A35F] text-white px-3 py-2 text-sm font-anton uppercase flex items-center gap-2"
            data-testid="reset-pass-last-result"
          >
            <CheckCircle size={14} strokeWidth={3} />
            Last reset: {lastResult.modified} player{lastResult.modified === 1 ? "" : "s"} updated
            ({lastResult.matched} matched)
          </div>
        )}
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-pow bg-[#E62429] text-white flex items-center gap-2"
            data-testid="reset-pass-open"
          >
            <RotateCcw size={14} strokeWidth={3} />
            Reset Pass for Everyone
          </button>
        ) : (
          <div className="border-pow-thin bg-[#FFF4D6] p-3 space-y-3" data-testid="reset-pass-confirm-pane">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle size={18} strokeWidth={3} className="text-[#E62429] mt-0.5 shrink-0" />
              <div>
                Type <strong>RESET</strong> below to confirm. This wipes every
                live player's pass progression and cannot be undone.
              </div>
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESET to confirm"
              className="border-pow-thin px-3 py-2 w-full font-mono uppercase text-sm bg-white"
              data-testid="reset-pass-confirm-input"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onFire}
                disabled={busy || confirmText.trim().toUpperCase() !== "RESET"}
                className="btn-pow bg-[#E62429] text-white flex items-center gap-2 disabled:opacity-40"
                data-testid="reset-pass-confirm"
              >
                <RotateCcw size={14} strokeWidth={3} />
                {busy ? "Resetting..." : "Reset Now"}
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); setConfirmText(""); }}
                className="btn-pow bg-white text-black"
                data-testid="reset-pass-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

