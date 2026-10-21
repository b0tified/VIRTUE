/* Admin Moderation Dashboard — /admin/reports
   Lists filed player reports and lets the admin take action:
   - Permanent ban
   - Temporary suspension (24h / 7d / 30d / custom hours)
   - Dismiss / close without action
   Non-admin users are bounced back to the lobby on mount. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Flag, Shield, ShieldOff, ShieldAlert, X, CheckCircle, Filter, Clock, Hammer, Sprout, Ticket, Trash2, Plus, RotateCcw, AlertTriangle, Flame, Activity, Loader2, Users, Search, Pencil, KeyRound, Check, Bot, Trophy, Palette, Crosshair, Type, Coins } from "lucide-react";
import api from "@/api";
import AdminCoinPanel from "@/components/AdminCoinPanel";
import AdminQueueFillPanel from "@/components/AdminQueueFillPanel";
import AdminRankDistributionPanel from "@/components/AdminRankDistributionPanel";
import AdminRankResetPreview from "@/components/AdminRankResetPreview";
import AdminServerHealthPanel from "@/components/AdminServerHealthPanel";
import { LOBBY_SCREENS } from "@/game/lobbyScreens";
import { TitleChip } from "@/components/ShopTitlesTab";
import BundleMakerPanel from "@/components/admin/BundleMakerPanel";
import { useAuth } from "@/context/AuthContext";
import { Avatar, AVATAR_COUNT } from "@/components/PlayerCard";

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


  // Total-accounts stat card. Fetched from /admin/users/count on mount
  // (and again after any admin action that could shift the number).
  // `real` excludes seeded leaderboard bots.
  const [accountsCount, setAccountsCount] = useState(null);
  const refreshAccountsCount = useCallback(async () => {
    try {
      const { data: c } = await api.get("/admin/users/count");
      setAccountsCount(c);
    } catch {
      setAccountsCount(null);
    }
  }, []);
  useEffect(() => { refreshAccountsCount(); }, [refreshAccountsCount]);

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
            aria-label="Reset & seed 60 fake veteran accounts so the leaderboard isn't empty"
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
      <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
        <StatCard
          label="Accounts"
          value={accountsCount?.real ?? "…"}
          color="#FFB000"
          Icon={Users}
          hint={accountsCount ? `${accountsCount.seeded} seeded · ${accountsCount.admins} admin` : ""}
          testid="stat-accounts"
        />
        <StatCard label="Total Reports" value={data?.total ?? 0} color="#0055FF" />
        <StatCard label="Open" value={openCount} color="#E62429" Icon={Flag} />
        <StatCard label="Closed" value={closedCount} color="#06A35F" Icon={CheckCircle} />
        <StatCard label="Active Sanctions" value={bannedCount} color="#9B59B6" Icon={ShieldAlert} />
      </div>

      {/* Account management — search, rename, reset password. */}
      <div className="max-w-6xl mx-auto mb-6">
        <AccountsPanel
          onChanged={() => { refreshAccountsCount(); load(); }}
          onToast={setToast}
        />
      </div>

      {/* Leaderboard bots — rename the seeded filler accounts that
          populate the public leaderboard. Same rename endpoint as
          AccountsPanel, but scoped to `is_seeded:true` and sorted by
          RP so it mirrors the leaderboard order the players see. */}
      <div className="max-w-6xl mx-auto mb-6">
        <LeaderboardBotsPanel onToast={setToast} />
      </div>

      {/* Recent activity: two parallel feeds (newest signups + latest
          online). Lets the admin eyeball signup spikes and see who's
          currently playing without digging through the account search. */}
      <div className="max-w-6xl mx-auto mb-6">
        <RecentActivityPanel />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <DefaultLobbyScreenPanel onToast={setToast} />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <AdminServerHealthPanel />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <BotLoadoutPanel onToast={setToast} />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <AdminQueueFillPanel onToast={setToast} />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <AdminRankDistributionPanel />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <AdminRankResetPreview />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <AdminCoinPanel onToast={setToast} />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <TitleMakerPanel onToast={setToast} />
      </div>

      <div className="max-w-6xl mx-auto mb-6">
        <BundleMakerPanel onToast={setToast} />
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

      {/* Custom bot names — admin-registered handles that seed into
          disguised bot pools with per-mode and per-rank filters. */}
      <div className="max-w-6xl mx-auto mt-6">
        <CustomBotNamesCard setToast={setToast} />
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

function StatCard({ label, value, color, Icon, hint, testid }) {
  return (
    <div className="card-pow p-0 overflow-hidden" data-testid={testid || `stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="px-3 py-1.5 font-anton uppercase tracking-widest text-xs text-white flex items-center gap-2" style={{ background: color }}>
        {Icon ? <Icon size={14} strokeWidth={3} /> : null}
        {label}
      </div>
      <div className="bg-white px-4 py-3">
        <div className="font-display text-4xl text-pow-shadow tabular-nums">{value}</div>
        {hint ? (
          <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-500 mt-1">
            {hint}
          </div>
        ) : null}
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
              ? `${stats.real_online_in_match} in-match · ${stats.real_online_in_lobby} in lobby · ${stats.real_online_guests || 0} on login`
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
        <div className="font-anton uppercase tracking-widest text-xs opacity-70">
          On Login Screens <span className="ml-1 font-display text-lg text-[#0055FF]" data-testid="live-headline-guests">{stats.real_online_guests || 0}</span>
        </div>
        <div className="font-anton uppercase tracking-widest text-xs opacity-70">
          Peak 24h <span className="ml-1 font-display text-lg text-[#FF8A00]" data-testid="live-headline-peak-24h">{stats.peak_online_24h || 0}</span>
          {stats.peak_online_24h_at && (
            <span className="ml-1 normal-case tracking-normal" data-testid="live-headline-peak-24h-at">
              {new Date(stats.peak_online_24h_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
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
          <div className="text-xs text-neutral-700 truncate" aria-label={report.note}>
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
                    aria-label="Delete this code"
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



/* AccountsPanel — search real accounts by username prefix or exact email;
   for each result, inline-rename the username and reset the password.
   Both actions hit admin-only endpoints (/admin/users/{u}/rename and
   /admin/users/{u}/password) so the audit trail runs server-side. */
function AccountsPanel({ onChanged, onToast }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const search = useCallback(async () => {
    const trimmed = q.trim();
    if (!trimmed) {
      setRows([]);
      setTouched(false);
      return;
    }
    setBusy(true);
    setTouched(true);
    try {
      const { data } = await api.get("/admin/users/search", { params: { q: trimmed, limit: 25 } });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      onToast?.({ kind: "err", text: e?.response?.data?.detail || "Search failed." });
    } finally {
      setBusy(false);
    }
  }, [q, onToast]);

  // Debounced auto-search — kick off 400ms after the last keystroke so
  // fast typing doesn't fan out 8 requests.
  useEffect(() => {
    const t = setTimeout(() => { search(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const patchRow = (id, patch) =>
    setRows((arr) => arr.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="card-pow p-0 overflow-hidden" data-testid="accounts-panel">
      <div className="bg-black text-white px-4 py-2 font-display text-2xl text-pow-shadow flex items-center justify-between">
        <span className="flex items-center gap-2"><Users size={20} strokeWidth={3} /> ACCOUNTS</span>
        <span className="font-anton uppercase tracking-widest text-xs opacity-70" data-testid="accounts-result-count">
          {rows.length} result{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="bg-white px-4 py-3 border-b-2 border-black">
        <label className="flex items-center gap-2">
          <Search size={16} strokeWidth={3} className="text-neutral-500 flex-shrink-0" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by username or exact email..."
            className="flex-1 border-2 border-black px-3 py-2 font-anton uppercase tracking-widest text-sm"
            data-testid="accounts-search-input"
            autoComplete="off"
          />
          {busy && <Loader2 size={16} strokeWidth={3} className="animate-spin text-neutral-500" />}
        </label>
      </div>
      {!touched ? (
        <div className="bg-white px-4 py-6 font-anton uppercase tracking-widest text-xs text-neutral-500 text-center" data-testid="accounts-idle">
          Type a username or email to look up an account.
        </div>
      ) : rows.length === 0 && !busy ? (
        <div className="bg-white px-4 py-6 font-anton uppercase tracking-widest text-xs text-neutral-500 text-center" data-testid="accounts-empty">
          No accounts match "{q}"
        </div>
      ) : (
        <div className="bg-white divide-y-2 divide-black/10">
          {rows.map((r, i) => (
            <AccountRow
              key={r.id}
              row={r}
              testid={`account-row-${i}`}
              onRenamed={(newName) => {
                patchRow(r.id, { username: newName });
                onToast?.({ kind: "ok", text: `Renamed ${r.username} → ${newName}` });
                onChanged?.();
              }}
              onPassReset={() => {
                onToast?.({ kind: "ok", text: `Password reset for ${r.username}` });
              }}
              onRankChanged={(data) => {
                patchRow(r.id, {
                  rank_points: data.rank_points,
                  rank_tier: data.rank_tier,
                  rank_name: data.rank_name,
                });
                onToast?.({ kind: "ok", text: `${r.username} rank → ${data.rank_name}` });
                onChanged?.();
              }}
              onError={(msg) => onToast?.({ kind: "err", text: msg })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* Inline row for a single account. Renders username/email chips + two
   inline actions: rename (pencil → text input → save/cancel) and
   password reset (key → password input → save/cancel). Actions collapse
   back to their icons on save/cancel so the row stays compact. */
function AccountRow({ row, testid, onRenamed, onPassReset, onError, onRankChanged }) {
  // `null` = idle (icon showing). String = active edit input value.
  const [renameVal, setRenameVal] = useState(null);
  const [passVal, setPassVal] = useState(null);
  // Rank edit state — a tier index (0..8). null = form closed.
  const [rankTier, setRankTier] = useState(null);
  const [rankUpdatePeak, setRankUpdatePeak] = useState(false);
  const [busy, setBusy] = useState(false);

  const doRename = async () => {
    const next = (renameVal || "").trim();
    if (!next || next === row.username || next.length < 2 || next.length > 20) {
      setRenameVal(null);
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/users/${encodeURIComponent(row.username)}/rename`, { new_username: next });
      onRenamed?.(next);
      setRenameVal(null);
    } catch (e) {
      onError?.(e?.response?.data?.detail || "Rename failed.");
    } finally {
      setBusy(false);
    }
  };

  const doPass = async () => {
    const next = passVal || "";
    if (next.length < 6 || next.length > 128) {
      onError?.("Password must be 6–128 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/users/${encodeURIComponent(row.username)}/password`, { new_password: next });
      onPassReset?.();
      setPassVal(null);
    } catch (e) {
      onError?.(e?.response?.data?.detail || "Password reset failed.");
    } finally {
      setBusy(false);
    }
  };

  // Rank change: takes a tier index (0..8), snaps to the tier's floor
  // RP + a small offset (60 into the band so the account lands cleanly
  // in the middle of the tier's first division). Optionally raises
  // peak so the trophy pill updates too.
  const doRank = async () => {
    if (rankTier == null) return;
    // Tier floor RP mirrors the backend's RANK_TIERS floors: Bronze 0,
    // Silver 300, Gold 600, Platinum 900, Emerald 1200, Diamond 1500,
    // Master 1800, Grandmaster 2100, Goonmaster 2400.
    const FLOORS = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400];
    const rp = FLOORS[rankTier] + 60;
    setBusy(true);
    try {
      const { data } = await api.post(
        `/admin/users/${encodeURIComponent(row.username)}/rank`,
        { rank_points: rp, update_peak: rankUpdatePeak },
      );
      onRankChanged?.(data);
      setRankTier(null);
      setRankUpdatePeak(false);
    } catch (e) {
      onError?.(e?.response?.data?.detail || "Rank change failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-3 flex flex-wrap items-center gap-3" data-testid={testid}>
      <div className="flex-1 min-w-[220px]">
        <div className="font-anton uppercase tracking-widest text-sm" data-testid={`${testid}-username`}>
          {row.username}
          {row.role === "admin" && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 border-2 border-black bg-[#E62429] text-white">
              ADMIN
            </span>
          )}
          {row.ban_status && row.ban_status !== "active" && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 border-2 border-black bg-[#9B59B6] text-white uppercase">
              {row.ban_status}
            </span>
          )}
        </div>
        <div className="font-body text-xs text-neutral-500 truncate">
          {row.email} · Lv {row.level} · {row.rank_points} RP
        </div>
      </div>

      {/* Rename controls */}
      {renameVal === null ? (
        <button
          onClick={() => setRenameVal(row.username)}
          disabled={busy}
          className="btn-pow bg-[#0055FF] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
          data-testid={`${testid}-rename-open`}
          aria-label="Change username"
        >
          <span className="flex items-center gap-1"><Pencil size={12} strokeWidth={3} /> RENAME</span>
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenameVal(null); }}
            maxLength={20}
            className="w-36 border-2 border-black px-2 py-1 font-anton uppercase tracking-widest text-xs"
            data-testid={`${testid}-rename-input`}
            autoFocus
            disabled={busy}
          />
          <button
            onClick={doRename}
            disabled={busy}
            className="btn-pow bg-[#06A35F] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
            data-testid={`${testid}-rename-save`}
          >
            {busy ? <Loader2 size={12} strokeWidth={3} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
          </button>
          <button
            onClick={() => setRenameVal(null)}
            disabled={busy}
            className="btn-pow bg-white text-black [&]:px-2 [&]:py-1 [&]:text-xs"
            data-testid={`${testid}-rename-cancel`}
          >
            <X size={12} strokeWidth={3} />
          </button>
        </div>
      )}

      {/* Password reset controls */}
      {passVal === null ? (
        <button
          onClick={() => setPassVal("")}
          disabled={busy}
          className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
          data-testid={`${testid}-pass-open`}
          aria-label="Reset password"
        >
          <span className="flex items-center gap-1"><KeyRound size={12} strokeWidth={3} /> RESET PW</span>
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={passVal}
            onChange={(e) => setPassVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doPass(); if (e.key === "Escape") setPassVal(null); }}
            placeholder="new password"
            maxLength={128}
            className="w-40 border-2 border-black px-2 py-1 font-body text-xs"
            data-testid={`${testid}-pass-input`}
            autoFocus
            disabled={busy}
          />
          <button
            onClick={doPass}
            disabled={busy}
            className="btn-pow bg-[#06A35F] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
            data-testid={`${testid}-pass-save`}
          >
            {busy ? <Loader2 size={12} strokeWidth={3} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
          </button>
          <button
            onClick={() => setPassVal(null)}
            disabled={busy}
            className="btn-pow bg-white text-black [&]:px-2 [&]:py-1 [&]:text-xs"
            data-testid={`${testid}-pass-cancel`}
          >
            <X size={12} strokeWidth={3} />
          </button>
        </div>
      )}

      {/* Rank change controls — pick a tier + optional peak-update
          toggle. Backend snaps RP to the match-grid so the resulting
          rank is always at the middle of the tier's first division. */}
      {rankTier === null ? (
        <button
          onClick={() => setRankTier(row.rank_tier ?? 0)}
          disabled={busy}
          className="btn-pow bg-[#00A9FF] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
          data-testid={`${testid}-rank-open`}
          aria-label="Change rank"
        >
          <span className="flex items-center gap-1"><Trophy size={12} strokeWidth={3} /> RANK</span>
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <select
            value={rankTier}
            onChange={(e) => setRankTier(parseInt(e.target.value, 10))}
            className="border-2 border-black px-2 py-1 font-anton uppercase tracking-widest text-xs bg-white"
            data-testid={`${testid}-rank-select`}
            autoFocus
            disabled={busy}
          >
            <option value={0}>BRONZE</option>
            <option value={1}>SILVER</option>
            <option value={2}>GOLD</option>
            <option value={3}>PLATINUM</option>
            <option value={4}>EMERALD</option>
            <option value={5}>DIAMOND</option>
            <option value={6}>MASTER</option>
            <option value={7}>GRANDMASTER</option>
            <option value={8}>GOONMASTER</option>
          </select>
          <label className="flex items-center gap-1 text-[10px] font-anton uppercase tracking-widest text-neutral-600">
            <input
              type="checkbox"
              checked={rankUpdatePeak}
              onChange={(e) => setRankUpdatePeak(e.target.checked)}
              data-testid={`${testid}-rank-peak-toggle`}
              disabled={busy}
            />
            Peak
          </label>
          <button
            onClick={doRank}
            disabled={busy}
            className="btn-pow bg-[#06A35F] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
            data-testid={`${testid}-rank-save`}
          >
            {busy ? <Loader2 size={12} strokeWidth={3} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
          </button>
          <button
            onClick={() => { setRankTier(null); setRankUpdatePeak(false); }}
            disabled={busy}
            className="btn-pow bg-white text-black [&]:px-2 [&]:py-1 [&]:text-xs"
            data-testid={`${testid}-rank-cancel`}
          >
            <X size={12} strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}


/* RecentActivityPanel — two parallel feeds for the Moderation tab:
   • Recent Signups: newest real accounts (created_at desc).
   • Recently Online: real accounts with the latest last_seen_at.

   Both poll /api/admin/users/recent on mount + every 30s so an admin
   can leave the page open and watch signups roll in during a spike.
   Rows stay compact (one line each) so 10 items fit without scrolling
   on a laptop viewport. */
const EMPTY_TITLE = { text: "", color: "#FFD700", style: "plain", price: 500, active: true, ends_at: "" };

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function TitleMakerPanel({ onToast }) {
  const [titles, setTitles] = useState(null);
  const [form, setForm] = useState(EMPTY_TITLE);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = () => api.get("/admin/titles").then(({ data }) => setTitles(data.titles)).catch(() => setTitles([]));
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const payload = () => ({ ...form, price: Number(form.price) || 0, ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null });
  const err = (e, m) => onToast?.({ kind: "err", text: e?.response?.data?.detail?.[0]?.msg || e?.response?.data?.detail || m });

  const save = async () => {
    setSaving(true);
    try {
      if (editId) await api.put(`/admin/titles/${editId}`, payload());
      else await api.post("/admin/titles", payload());
      onToast?.({ kind: "ok", text: editId ? "Title updated." : "Title added to the shop." });
      setForm(EMPTY_TITLE);
      setEditId(null);
      load();
      window.dispatchEvent(new Event("virtue-titles-changed"));
    } catch (e) { err(e, "Failed to save title."); } finally { setSaving(false); }
  };
  const toggle = async (t) => {
    try {
      await api.put(`/admin/titles/${t.id}`, { ...t, active: !t.active });
      load();
      window.dispatchEvent(new Event("virtue-titles-changed"));
    } catch (e) { err(e, "Failed to update title."); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.text}"? Players who own it will lose it.`)) return;
    try {
      await api.delete(`/admin/titles/${t.id}`);
      onToast?.({ kind: "ok", text: "Title deleted." });
      load();
      window.dispatchEvent(new Event("virtue-titles-changed"));
    } catch (e) { err(e, "Failed to delete title."); }
  };
  const edit = (t) => {
    setEditId(t.id);
    setForm({ text: t.text, color: t.color, style: t.style, price: t.price, active: t.active, ends_at: toLocalInput(t.ends_at) });
  };

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="title-maker-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Type size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Title Maker</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">Create banner titles players can buy in the Shop → Titles tab.</div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Text (max 24)</span>
            <input value={form.text} maxLength={24} onChange={(e) => set("text", e.target.value)} className="border-2 border-black px-2 py-1.5 font-anton uppercase" placeholder="LEGEND" data-testid="title-maker-text-input" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Color</span>
            <div className={`flex items-center gap-2 ${form.style === "rainbow" ? "opacity-40 pointer-events-none" : ""}`}>
              <input type="color" value={form.color} onChange={(e) => set("color", e.target.value.toUpperCase())} className="w-10 h-9 border-2 border-black p-0" data-testid="title-maker-color-input" />
              <span className="font-mono text-xs">{form.color}</span>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Price (coins)</span>
            <input type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} className="border-2 border-black px-2 py-1.5" data-testid="title-maker-price-input" />
          </label>
          <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Style</span>
            <div className="flex gap-1">
              {["plain", "shimmer", "rainbow"].map((st) => (
                <button key={st} type="button" onClick={() => set("style", st)} className={`flex-1 border-2 border-black px-2 py-1.5 font-anton uppercase text-[10px] tracking-widest ${form.style === st ? "bg-[#FFD700]" : "bg-white hover:bg-neutral-100"}`} data-testid={`title-maker-style-${st}`}>{st}</button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">Ends (optional)</span>
            <input type="datetime-local" value={form.ends_at} onChange={(e) => set("ends_at", e.target.value)} className="border-2 border-black px-2 py-1.5 text-xs" data-testid="title-maker-ends-input" />
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} data-testid="title-maker-active-checkbox" />
            <span className="font-anton uppercase tracking-widest text-[10px]">In shop</span>
          </label>
        </div>
        <div className="flex flex-col items-center justify-between gap-3 min-w-[220px]">
          <div className="bg-neutral-800 border-2 border-black w-full h-20 flex items-center justify-center" data-testid="title-maker-preview">
            <TitleChip title={{ ...form, text: (form.text || "TITLE").toUpperCase() }} size="lg" />
          </div>
          <div className="flex gap-2 w-full">
            {editId && (
              <button type="button" onClick={() => { setEditId(null); setForm(EMPTY_TITLE); }} className="btn-pow bg-white text-black flex-1 [&]:py-2 [&]:text-xs" data-testid="title-maker-cancel-edit">Cancel</button>
            )}
            <button type="button" onClick={save} disabled={saving || !form.text.trim()} className="btn-pow bg-[#06A35F] text-white flex-1 [&]:py-2 [&]:text-xs disabled:opacity-50" data-testid="title-maker-save-button">
              {saving ? <Loader2 size={12} className="animate-spin mx-auto" /> : editId ? "Save Changes" : "Add to Shop"}
            </button>
          </div>
        </div>
      </div>
      <div className="mt-4 border-t-2 border-black/10 pt-3" data-testid="title-maker-list">
        {titles === null ? <Loader2 size={16} className="animate-spin" /> : titles.length === 0 ? (
          <div className="text-xs text-neutral-500">No custom titles yet.</div>
        ) : titles.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2 border-b border-black/5 flex-wrap" data-testid={`title-maker-row-${t.id}`}>
            <TitleChip title={t} />
            <span className="font-anton text-xs flex items-center gap-1"><Coins size={12} /> {t.price}</span>
            <span className="text-[10px] uppercase tracking-widest text-neutral-500">{t.owners} owned</span>
            {t.ends_at && (new Date(t.ends_at) <= new Date()
              ? <span className="text-[10px] uppercase tracking-widest bg-[#E62429] text-white px-1.5 py-0.5 border border-black" data-testid={`title-maker-expired-${t.id}`}>Expired</span>
              : <span className="text-[10px] uppercase tracking-widest text-[#E62429]">ends {new Date(t.ends_at).toLocaleString()}</span>)}
            <div className="ml-auto flex gap-1">
              <button type="button" onClick={() => toggle(t)} className={`border-2 border-black px-2 py-1 font-anton uppercase text-[10px] tracking-widest ${t.active ? "bg-[#06A35F] text-white" : "bg-neutral-200"}`} data-testid={`title-maker-toggle-${t.id}`}>{t.active ? "In Shop" : "Hidden"}</button>
              <button type="button" onClick={() => edit(t)} className="border-2 border-black px-2 py-1 font-anton uppercase text-[10px] tracking-widest bg-white" data-testid={`title-maker-edit-${t.id}`}>Edit</button>
              <button type="button" onClick={() => remove(t)} className="border-2 border-black px-2 py-1 font-anton uppercase text-[10px] tracking-widest bg-[#E62429] text-white" data-testid={`title-maker-delete-${t.id}`}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DefaultLobbyScreenPanel({ onToast }) {
  const [current, setCurrent] = useState(null);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    api.get("/lobby/default_bg").then(({ data }) => setCurrent(data?.variant || "default")).catch(() => setCurrent("default"));
  }, []);

  const pick = async (id) => {
    if (id === current || saving) return;
    setSaving(id);
    try {
      const { data } = await api.post("/admin/lobby/default_bg", { variant: id });
      setCurrent(data.variant);
      localStorage.setItem("virtue_lobby_default_bg", data.variant);
      window.dispatchEvent(new Event("virtue-lobby-default-changed"));
      onToast?.({ kind: "ok", text: "Default lobby screen updated." });
    } catch (e) {
      onToast?.({ kind: "err", text: e?.response?.data?.detail || "Failed to update lobby screen." });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="default-lobby-screen-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Palette size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Default Lobby Screen</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">Shown to every player whose Lobby Background is set to Auto.</div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {LOBBY_SCREENS.map(({ id, label }) => {
          const active = current === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => pick(id)}
              disabled={current === null || !!saving}
              className={`border-2 border-black px-3 py-2 font-anton uppercase tracking-widest text-xs flex items-center justify-center gap-1 transition-colors ${
                active ? "bg-[#FFD700]" : "bg-white hover:bg-neutral-100"
              }`}
              data-testid={`default-lobby-screen-${id}`}
              data-active={active ? "1" : "0"}
            >
              {saving === id ? <Loader2 size={12} className="animate-spin" /> : active ? <Check size={12} strokeWidth={3} /> : null}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BotLoadoutPanel({ onToast }) {
  const [vals, setVals] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/admin/bot_loadout").then(({ data }) => setVals(data)).catch(() => {});
  }, []);
  const fields = [
    { k: "sniper_low", label: "Sniper % (Bronze bots)" },
    { k: "sniper_high", label: "Sniper % (Top-rank bots)" },
    { k: "laser", label: "Laser % (all bots)" },
  ];
  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/admin/bot_loadout", vals);
      setVals(data);
      onToast?.({ kind: "ok", text: "Bot loadout saved. Applies to newly spawned bots." });
    } catch (e) {
      onToast?.({ kind: "err", text: e?.response?.data?.detail || "Failed to save bot loadout." });
    } finally {
      setSaving(false);
    }
  };
  const ak = vals ? Math.max(0, 100 - Math.max(vals.sniper_low, vals.sniper_high) - vals.laser) : 0;
  return (
    <div className="bg-white border-4 border-black p-4" data-testid="bot-loadout-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Crosshair size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Bot Loadout</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">
        Chance a newly spawned bot carries each weapon. Sniper odds scale from Bronze to top rank; the rest use the AK-47.
      </div>
      {!vals ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          {fields.map(({ k, label }) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="font-anton uppercase tracking-widest text-[10px] opacity-70">{label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0} max={100} step={1}
                  value={vals[k]}
                  onChange={(e) => setVals({ ...vals, [k]: Number(e.target.value) })}
                  className="flex-1 accent-[#E62429]"
                  data-testid={`bot-loadout-${k}-slider`}
                />
                <span className="font-display text-lg w-12 text-right" data-testid={`bot-loadout-${k}-value`}>{Math.round(vals[k])}%</span>
              </div>
            </label>
          ))}
          <div className="flex items-center justify-between gap-2">
            <span className="font-anton uppercase tracking-widest text-[10px] opacity-70" data-testid="bot-loadout-ak-value">AK-47 ≥ {Math.round(ak)}%</span>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-pow bg-[#FFD700] text-black text-xs px-4 py-2"
              data-testid="bot-loadout-save-button"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecentActivityPanel() {
  const [data, setData] = useState({ recent_signups: [], recently_online: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get("/admin/users/recent", { params: { limit: 10 } });
      setData(res || { recent_signups: [], recently_online: [] });
      setErr(null);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load recent activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="recent-activity-panel">
      <RecentFeed
        title="Recent Signups"
        subtitle="Newest accounts (last 10)"
        icon={<Sprout size={18} strokeWidth={3} />}
        rows={data.recent_signups}
        loading={loading}
        err={err}
        timeField="created_at"
        testid="recent-signups"
      />
      <RecentFeed
        title="Recently Online"
        subtitle="Latest active accounts"
        icon={<Activity size={18} strokeWidth={3} />}
        rows={data.recently_online}
        loading={loading}
        err={err}
        timeField="last_seen_at"
        testid="recently-online"
      />
    </div>
  );
}

/* Single-column list shared by both Signups + Online. `timeField` picks
   which timestamp to render as "Nm ago": "created_at" (ISO string) or
   "last_seen_at" (unix seconds). An online green dot overrides the
   relative-time chip when `online:true` so the Online column clearly
   separates currently-connected rows from "closed tab 2 minutes ago". */
function RecentFeed({ title, subtitle, icon, rows, loading, err, timeField, testid }) {
  return (
    <div className="card-pow p-0 overflow-hidden" data-testid={testid}>
      <div className="bg-black text-white px-4 py-3 flex items-center gap-2">
        <span className="text-white">{icon}</span>
        <div className="min-w-0">
          <div className="font-anton uppercase tracking-widest text-sm leading-none" data-testid={`${testid}-title`}>
            {title}
          </div>
          <div className="font-body text-[11px] text-neutral-400 mt-0.5">{subtitle}</div>
        </div>
      </div>
      <div className="divide-y-2 divide-black bg-white" data-testid={`${testid}-list`}>
        {loading && (
          <div className="px-4 py-6 text-center font-body text-sm text-neutral-500" data-testid={`${testid}-loading`}>
            <Loader2 size={18} className="inline animate-spin mr-2" /> Loading…
          </div>
        )}
        {!loading && err && (
          <div className="px-4 py-6 text-center font-body text-sm text-[#E62429]" data-testid={`${testid}-error`}>
            {err}
          </div>
        )}
        {!loading && !err && rows.length === 0 && (
          <div className="px-4 py-6 text-center font-body text-sm text-neutral-500" data-testid={`${testid}-empty`}>
            No activity yet.
          </div>
        )}
        {!loading && !err && rows.map((r) => (
          <RecentFeedRow key={r.id} row={r} timeField={timeField} testid={`${testid}-row-${r.username}`} />
        ))}
      </div>
    </div>
  );
}

function RecentFeedRow({ row, timeField, testid }) {
  const stamp = timeField === "created_at"
    ? (row.created_at ? new Date(row.created_at).getTime() : null)
    : (row.last_seen_at ? row.last_seen_at * 1000 : null);
  const ago = stamp ? formatRelativeTime(stamp) : "—";
  const banned = row.ban_status && row.ban_status !== "active";
  return (
    <div
      className="w-full flex items-center gap-3 px-3 py-2.5"
      data-testid={testid}
    >
      <Avatar idx={row.avatar || 0} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-anton uppercase tracking-widest text-sm truncate" data-testid={`${testid}-username`}>
            {row.username}
          </span>
          {row.role === "admin" && (
            <span className="font-anton uppercase tracking-widest text-[9px] px-1.5 py-0.5 bg-[#FFD700] text-black border-2 border-black">
              ADMIN
            </span>
          )}
          {banned && (
            <span className="font-anton uppercase tracking-widest text-[9px] px-1.5 py-0.5 bg-[#E62429] text-white border-2 border-black">
              {row.ban_status}
            </span>
          )}
        </div>
        <div className="font-body text-[11px] text-neutral-500 flex items-center gap-2 mt-0.5 truncate">
          <span>LV {row.level}</span>
          <span>·</span>
          <span className="tabular-nums">{row.rank_points} RP</span>
          {row.email && <><span>·</span><span className="truncate">{row.email}</span></>}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        {row.online ? (
          <span className="font-anton uppercase tracking-widest text-[10px] text-[#06A35F] flex items-center gap-1 justify-end" data-testid={`${testid}-online`}>
            <span className="w-2 h-2 rounded-full bg-[#06A35F] animate-pulse" />
            Online
          </span>
        ) : (
          <span className="font-body text-[11px] text-neutral-500 tabular-nums" data-testid={`${testid}-ago`}>
            {ago}
          </span>
        )}
      </div>
    </div>
  );
}

/* epoch-ms → "2m ago" / "3h ago" / "4d ago" / "Jan 12" for recent feeds. */
function formatRelativeTime(ms) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}


/* LeaderboardBotsPanel — lists the seeded users that populate the
   public leaderboard, sorted by RP desc so the order mirrors what
   players see. Admin can search/paginate + rename each bot inline;
   rename calls the existing `/admin/users/{u}/rename` endpoint
   (works on seeded users too — no special-case backend path). */
function LeaderboardBotsPanel({ onToast }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(25);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = { limit };
      if (q.trim()) params.q = q.trim();
      const { data } = await api.get("/admin/leaderboard_bots", { params });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      onToast?.({ kind: "err", text: e?.response?.data?.detail || "Failed to load leaderboard bots." });
    } finally {
      setBusy(false);
    }
  }, [q, limit, onToast]);

  // Debounced auto-search — mirror AccountsPanel's UX.
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, limit]);

  const patchRow = (id, patch) =>
    setRows((arr) => arr.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="card-pow p-0 overflow-hidden" data-testid="leaderboard-bots-panel">
      <div className="bg-black text-white px-4 py-2 font-display text-2xl text-pow-shadow flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Bot size={20} strokeWidth={3} /> LEADERBOARD BOTS
        </span>
        <span className="font-anton uppercase tracking-widest text-xs opacity-70" data-testid="lb-bots-count">
          {rows.length} shown
        </span>
      </div>
      <div className="bg-white px-4 py-3 border-b-2 border-black flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={16} strokeWidth={3} className="text-neutral-500 flex-shrink-0" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bot name..."
            className="flex-1 border-2 border-black px-3 py-2 font-anton uppercase tracking-widest text-sm"
            data-testid="lb-bots-search-input"
            autoComplete="off"
          />
          {busy && <Loader2 size={16} strokeWidth={3} className="animate-spin text-neutral-500" />}
        </label>
        <label className="flex items-center gap-2 font-anton uppercase tracking-widest text-xs">
          <Trophy size={14} strokeWidth={3} className="text-[#FFB000]" /> TOP
          <select
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
            className="border-2 border-black px-2 py-1 text-sm font-anton uppercase"
            data-testid="lb-bots-limit-select"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
      </div>
      {rows.length === 0 && !busy ? (
        <div className="bg-white px-4 py-6 font-anton uppercase tracking-widest text-xs text-neutral-500 text-center" data-testid="lb-bots-empty">
          {q.trim() ? `No leaderboard bots match "${q}"` : "No seeded leaderboard bots found."}
        </div>
      ) : (
        <div className="bg-white divide-y-2 divide-black/10 max-h-[520px] overflow-y-auto">
          {rows.map((r, i) => (
            <LeaderboardBotRow
              key={r.id}
              row={r}
              rank={i + 1}
              testid={`lb-bot-row-${i}`}
              onRenamed={(newName) => {
                patchRow(r.id, { username: newName });
                onToast?.({ kind: "ok", text: `Renamed ${r.username} → ${newName}` });
              }}
              onEdited={(patch) => {
                patchRow(r.id, patch);
                const bits = [];
                if (patch.avatar !== undefined) bits.push(`avatar → #${patch.avatar}`);
                if (patch.rank_points !== undefined) bits.push(`${patch.rank_points} RP`);
                onToast?.({ kind: "ok", text: `Updated ${r.username}: ${bits.join(", ")}` });
              }}
              onError={(msg) => onToast?.({ kind: "err", text: msg })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* Inline row for a leaderboard bot — RP + rank chip + avatar preview on
   the left, inline rename control on the right (pencil → input →
   save/cancel), plus a Palette button that opens an "Edit" panel below
   the row for tweaking `avatar` (0-21) + `seed_target_rp`. Rename hits
   `/admin/users/{u}/rename`; avatar+RP edits hit
   `PATCH /admin/leaderboard_bots/{u}`. */
function LeaderboardBotRow({ row, rank, testid, onRenamed, onEdited, onError }) {
  const [renameVal, setRenameVal] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  // Draft state for the avatar + RP edit panel. Mirrors `row` on open
  // and resets on cancel/save so re-opening reflects the persisted
  // values, not stale edits.
  const [draftAvatar, setDraftAvatar] = useState(row.avatar ?? 0);
  const [draftRp, setDraftRp] = useState(row.seed_target_rp ?? row.rank_points ?? 0);
  const [busy, setBusy] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const doRename = async () => {
    const next = (renameVal || "").trim();
    if (!next || next === row.username || next.length < 2 || next.length > 20) {
      setRenameVal(null);
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/users/${encodeURIComponent(row.username)}/rename`, { new_username: next });
      onRenamed?.(next);
      setRenameVal(null);
    } catch (e) {
      onError?.(e?.response?.data?.detail || "Rename failed.");
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    // Snapshot current values so cancel restores cleanly.
    setDraftAvatar(row.avatar ?? 0);
    setDraftRp(row.seed_target_rp ?? row.rank_points ?? 0);
    setEditOpen(true);
  };

  const doSaveEdit = async () => {
    const payload = {};
    if (draftAvatar !== (row.avatar ?? 0)) payload.avatar = draftAvatar;
    const rpInt = Math.max(0, Math.min(10000, parseInt(draftRp, 10) || 0));
    if (rpInt !== (row.seed_target_rp ?? row.rank_points ?? 0)) payload.seed_target_rp = rpInt;
    if (Object.keys(payload).length === 0) {
      setEditOpen(false);
      return;
    }
    setSavingEdit(true);
    try {
      const { data } = await api.patch(
        `/admin/leaderboard_bots/${encodeURIComponent(row.username)}`,
        payload,
      );
      onEdited?.({
        avatar: data.avatar,
        seed_target_rp: data.seed_target_rp,
        rank_points: data.rank_points,
      });
      setEditOpen(false);
    } catch (e) {
      onError?.(e?.response?.data?.detail || "Edit failed.");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="px-4 py-3" data-testid={testid}>
      <div className="flex items-center gap-3">
        <span className="font-display text-xl text-[#FFB000] w-10 text-center" data-testid={`${testid}-rank`}>
          #{rank}
        </span>
        <div className="flex-shrink-0" data-testid={`${testid}-avatar-preview`}>
          <Avatar idx={row.avatar ?? 0} size={40} />
        </div>
        <div className="flex-1 min-w-0">
          {renameVal === null ? (
            <div className="font-anton uppercase tracking-widest text-sm truncate" data-testid={`${testid}-name`}>
              {row.username}
            </div>
          ) : (
            <input
              type="text"
              value={renameVal}
              autoFocus
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenameVal(null); }}
              className="w-full border-2 border-black px-2 py-1 font-anton uppercase tracking-widest text-sm"
              minLength={2}
              maxLength={20}
              data-testid={`${testid}-rename-input`}
            />
          )}
          <div className="mt-0.5 flex flex-wrap gap-2 font-anton uppercase tracking-widest text-[10px] text-neutral-600">
            <span data-testid={`${testid}-rp`}>{row.rank_points} RP</span>
            <span>·</span>
            <span>{row.matches}M</span>
            <span>·</span>
            <span>{row.kills}K</span>
          </div>
        </div>
        {renameVal === null ? (
          <div className="flex items-center gap-1">
            <button
              onClick={openEdit}
              className={`btn-pow ${editOpen ? "bg-[#FFB000] text-black" : "bg-white text-black"} [&]:px-2 [&]:py-1 [&]:text-xs`}
              aria-label="Edit avatar & RP"
              data-testid={`${testid}-edit-btn`}
            >
              <Palette size={12} strokeWidth={3} />
            </button>
            <button
              onClick={() => setRenameVal(row.username)}
              className="btn-pow bg-white text-black [&]:px-2 [&]:py-1 [&]:text-xs"
              aria-label="Rename bot"
              data-testid={`${testid}-rename-btn`}
            >
              <Pencil size={12} strokeWidth={3} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={doRename}
              disabled={busy}
              className="btn-pow bg-[#06A35F] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
              data-testid={`${testid}-rename-save`}
            >
              {busy ? <Loader2 size={12} strokeWidth={3} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
            </button>
            <button
              onClick={() => setRenameVal(null)}
              disabled={busy}
              className="btn-pow bg-white text-black [&]:px-2 [&]:py-1 [&]:text-xs"
              data-testid={`${testid}-rename-cancel`}
            >
              <X size={12} strokeWidth={3} />
            </button>
          </div>
        )}
      </div>

      {/* Expanded edit panel — appears below the row when the Palette
          button is toggled. Avatar picker (compact grid of all 22 slots)
          + numeric RP input. Save/Cancel commit the diff. */}
      {editOpen && (
        <div className="mt-3 bg-neutral-100 border-2 border-black p-3" data-testid={`${testid}-edit-panel`}>
          <div className="font-anton uppercase tracking-widest text-xs mb-2 text-neutral-700">
            Avatar
          </div>
          <div className="flex flex-wrap gap-2 mb-3" data-testid={`${testid}-edit-avatar-grid`}>
            {Array.from({ length: AVATAR_COUNT }).map((_, i) => {
              const active = i === draftAvatar;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setDraftAvatar(i)}
                  className={`p-1 transition-transform ${active ? "ring-2 ring-[#FFB000] translate-y-[-1px]" : "hover:translate-y-[-1px]"}`}
                  aria-label={`Avatar #${i}`}
                  data-testid={`${testid}-edit-avatar-${i}`}
                  aria-pressed={active}
                >
                  <Avatar idx={i} size={36} />
                </button>
              );
            })}
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex-1 min-w-[160px]">
              <div className="font-anton uppercase tracking-widest text-xs mb-1 text-neutral-700">
                Rank Tier
              </div>
              <select
                value={(() => {
                  // Derive the tier for the current draft RP so the
                  // picker reflects what the RP would render as on the
                  // bot's banner. Uses the same floor grid as the backend.
                  const n = parseInt(draftRp, 10) || 0;
                  let idx = 0;
                  for (let i = 0; i < RANK_TIER_FLOORS.length; i++) {
                    if (n >= RANK_TIER_FLOORS[i]) idx = i;
                  }
                  return idx;
                })()}
                onChange={(e) => {
                  // Snap the RP field to the middle of the first
                  // division of the picked tier (+60 offset matches
                  // the AccountRow rank editor for consistency).
                  const t = parseInt(e.target.value, 10);
                  setDraftRp(RANK_TIER_FLOORS[t] + 60);
                }}
                className="w-full border-2 border-black px-2 py-1 font-anton uppercase tracking-widest text-sm bg-white"
                data-testid={`${testid}-edit-tier-select`}
              >
                {RANK_TIER_LABELS.map((label, i) => (
                  <option key={label} value={i}>{label}</option>
                ))}
              </select>
            </label>
            <label className="flex-1 min-w-[160px]">
              <div className="font-anton uppercase tracking-widest text-xs mb-1 text-neutral-700">
                Target RP (0-10000)
              </div>
              <input
                type="number"
                min={0}
                max={10000}
                step={15}
                value={draftRp}
                onChange={(e) => setDraftRp(e.target.value)}
                className="w-full border-2 border-black px-2 py-1 font-anton tracking-widest text-sm tabular-nums"
                data-testid={`${testid}-edit-rp-input`}
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={doSaveEdit}
                disabled={savingEdit}
                className="btn-pow bg-[#06A35F] text-white [&]:px-3 [&]:py-1 [&]:text-xs"
                data-testid={`${testid}-edit-save`}
              >
                {savingEdit ? <Loader2 size={12} strokeWidth={3} className="animate-spin" /> : "SAVE"}
              </button>
              <button
                onClick={() => setEditOpen(false)}
                disabled={savingEdit}
                className="btn-pow bg-white text-black [&]:px-3 [&]:py-1 [&]:text-xs"
                data-testid={`${testid}-edit-cancel`}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* CustomBotNamesCard — admin form + list for registering additional bot
   handles that show up in disguised-bot pools. Each entry can optionally
   restrict which game modes and rank tiers it spawns in (empty = all).
   Names are also surfaced by the /users/search endpoint so players can
   discover them via the Friends → SEARCH tab (bot rows are read-only —
   no ADD button; the FriendsModal hides it via is_bot). */
// Rank tier labels — MUST match the backend `RANK_TIERS` order in
// `/app/backend/_lib/ranks.py`. Indices 0-8:
//   0 Bronze · 1 Silver · 2 Gold · 3 Platinum · 4 Emerald
//   5 Diamond · 6 Master · 7 Grandmaster · 8 Goonmaster
const RANK_TIER_LABELS = [
  "Bronze", "Silver", "Gold", "Platinum", "Emerald",
  "Diamond", "Master", "Grandmaster", "Goonmaster",
];
// RP floors for each tier (300 RP band each; Goonmaster is open-top).
// Used by the rank-tier picker to snap the RP input to a plausible
// middle-of-tier value the moment an admin selects a tier.
const RANK_TIER_FLOORS = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400];
const GAME_MODE_OPTIONS = [
  { value: "ffa",    label: "Casual FFA" },
  { value: "tdm",    label: "Team DM" },
  { value: "ranked", label: "Ranked" },
  { value: "bigffa", label: "12P FFA" },
];

function CustomBotNamesCard({ setToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  // Form state — name, selected modes (Set of strings), selected rank
  // indices (Set of ints). Empty sets mean "all modes"/"all ranks".
  const [name, setName] = useState("");
  const [modes, setModes] = useState(() => new Set());
  const [ranks, setRanks] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data } = await api.get("/admin/bot_names");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleMode = (m) => {
    setModes((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };
  const toggleRank = (r) => {
    setRanks((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  const create = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setToast?.({ kind: "err", msg: "Bot name must be at least 2 characters." });
      return;
    }
    setBusy(true);
    try {
      await api.post("/admin/bot_names", {
        name: trimmed,
        modes: Array.from(modes),
        ranks: Array.from(ranks),
      });
      setToast?.({ kind: "ok", msg: `Registered bot name "${trimmed}"` });
      setName("");
      setModes(new Set());
      setRanks(new Set());
      await load();
    } catch (e2) {
      setToast?.({ kind: "err", msg: e2.response?.data?.detail || e2.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, nm) => {
    if (!window.confirm(`Remove custom bot name "${nm}"?`)) return;
    try {
      await api.delete(`/admin/bot_names/${id}`);
      setToast?.({ kind: "ok", msg: `Removed "${nm}"` });
      await load();
    } catch (e2) {
      setToast?.({ kind: "err", msg: e2.response?.data?.detail || e2.message });
    }
  };

  return (
    <div className="border-4 border-black bg-white p-4" data-testid="admin-custom-bot-names-card">
      <div className="flex items-center gap-2 mb-3">
        <Bot size={18} strokeWidth={3} className="text-[#9B59B6]" />
        <h2 className="font-anton uppercase tracking-widest text-lg">Custom Bot Names</h2>
        <span className="text-[10px] font-anton uppercase text-neutral-500">
          Seeded into disguised bot pools + searchable in friends
        </span>
      </div>

      <form onSubmit={create} className="space-y-2 border-b-2 border-black/10 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bot handle (e.g. shadowspecter)"
            className="flex-1 px-3 py-2 border-2 border-black outline-none font-anton uppercase tracking-widest text-sm"
            maxLength={24}
            minLength={2}
            data-testid="admin-custom-bot-names-input"
          />
          <button
            type="submit"
            disabled={busy || name.trim().length < 2}
            className="btn-pow bg-[#9B59B6] text-white [&]:px-3 [&]:py-2 [&]:text-xs disabled:opacity-50"
            data-testid="admin-custom-bot-names-add"
          >
            <span className="flex items-center gap-1"><Plus size={14} strokeWidth={3} /> ADD</span>
          </button>
        </div>
        <div>
          <div className="text-[10px] font-anton uppercase tracking-widest text-neutral-500 mb-1">
            Modes (empty = all)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {GAME_MODE_OPTIONS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => toggleMode(m.value)}
                className={`font-anton uppercase tracking-widest text-[10px] px-2 py-1 border-2 ${modes.has(m.value) ? "border-black bg-[#9B59B6] text-white" : "border-black bg-white text-black"}`}
                data-testid={`admin-custom-bot-names-mode-${m.value}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-anton uppercase tracking-widest text-neutral-500 mb-1">
            Rank tiers (empty = all)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RANK_TIER_LABELS.map((label, idx) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleRank(idx)}
                className={`font-anton uppercase tracking-widest text-[10px] px-2 py-1 border-2 ${ranks.has(idx) ? "border-black bg-[#00A9FF] text-white" : "border-black bg-white text-black"}`}
                data-testid={`admin-custom-bot-names-rank-${idx}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </form>

      {loading && (
        <div className="text-center py-3 text-neutral-500 font-anton uppercase text-xs">Loading…</div>
      )}
      {err && (
        <div className="text-center py-3 text-[#E62429] font-anton uppercase text-xs">{err}</div>
      )}
      {!loading && !err && rows.length === 0 && (
        <div className="text-center py-3 text-neutral-400 font-anton uppercase text-xs" data-testid="admin-custom-bot-names-empty">
          No custom bot names yet.
        </div>
      )}
      {!loading && !err && rows.length > 0 && (
        <div className="divide-y-2 divide-black/10" data-testid="admin-custom-bot-names-list">
          {rows.map((r, i) => (
            <CustomBotNameRow
              key={r.id}
              row={r}
              idx={i}
              onSaved={load}
              onError={(msg) => setToast?.({ kind: "err", msg })}
              onDeleted={() => remove(r.id, r.name)}
              onEdited={(nm) => setToast?.({ kind: "ok", msg: `Updated "${nm}"` })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* Row within the CustomBotNamesCard list. Two modes:
   - Idle (default): shows name + mode/rank chips + Edit + Delete buttons.
   - Editing: shows the name input, mode chips, and rank chips (identical
     controls to the create-form above) plus Save / Cancel. Each save
     hits PATCH /admin/bot_names/{id} which returns the fresh row so we
     can refresh the parent list. */
function CustomBotNameRow({ row, idx, onSaved, onError, onDeleted, onEdited }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const [modes, setModes] = useState(() => new Set(row.modes || []));
  const [ranks, setRanks] = useState(() => new Set(row.ranks || []));
  // Banner rank override — null = use seeded RNG (bot gets a random
  // plausible tier when players inspect it). Any 0..10000 pins the
  // banner + profile to that RP value. The UI represents "no override"
  // by an "AUTO" option in the tier picker.
  const [bannerRp, setBannerRp] = useState(
    Number.isFinite(row.rank_points) ? row.rank_points : null,
  );
  const [busy, setBusy] = useState(false);

  const openEdit = () => {
    setName(row.name);
    setModes(new Set(row.modes || []));
    setRanks(new Set(row.ranks || []));
    setBannerRp(Number.isFinite(row.rank_points) ? row.rank_points : null);
    setEditing(true);
  };
  const cancel = () => setEditing(false);

  const toggleMode = (m) => {
    setModes((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };
  const toggleRank = (t) => {
    setRanks((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      onError?.("Bot name must be at least 2 characters.");
      return;
    }
    setBusy(true);
    try {
      const patch = {
        name: trimmed,
        modes: Array.from(modes),
        ranks: Array.from(ranks),
        // -1 sentinel = clear override (backend converts to null in
        // Mongo). Numeric value = pin banner to that RP.
        rank_points: bannerRp == null ? -1 : bannerRp,
      };
      await api.patch(`/admin/bot_names/${row.id}`, patch);
      setEditing(false);
      onEdited?.(trimmed);
      await onSaved?.();
    } catch (e) {
      onError?.(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="py-3 space-y-2 bg-neutral-50 px-2" data-testid={`admin-custom-bot-names-row-${idx}`}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-2 py-1 border-2 border-black outline-none font-anton uppercase tracking-widest text-sm"
            maxLength={24}
            minLength={2}
            data-testid={`admin-custom-bot-names-edit-input-${idx}`}
            autoFocus
            disabled={busy}
          />
          <button
            onClick={save}
            disabled={busy || name.trim().length < 2}
            className="btn-pow bg-[#06A35F] text-white [&]:px-2 [&]:py-1 [&]:text-xs disabled:opacity-50"
            data-testid={`admin-custom-bot-names-edit-save-${idx}`}
          >
            {busy ? <Loader2 size={12} strokeWidth={3} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
          </button>
          <button
            onClick={cancel}
            disabled={busy}
            className="btn-pow bg-white text-black [&]:px-2 [&]:py-1 [&]:text-xs"
            data-testid={`admin-custom-bot-names-edit-cancel-${idx}`}
          >
            <X size={12} strokeWidth={3} />
          </button>
        </div>
        <div>
          <div className="text-[10px] font-anton uppercase tracking-widest text-neutral-500 mb-1">
            Modes (empty = all)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {GAME_MODE_OPTIONS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => toggleMode(m.value)}
                className={`font-anton uppercase tracking-widest text-[10px] px-2 py-1 border-2 ${modes.has(m.value) ? "border-black bg-[#9B59B6] text-white" : "border-black bg-white text-black"}`}
                data-testid={`admin-custom-bot-names-edit-mode-${idx}-${m.value}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-anton uppercase tracking-widest text-neutral-500 mb-1">
            Rank tiers (empty = all)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RANK_TIER_LABELS.map((label, tIdx) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleRank(tIdx)}
                className={`font-anton uppercase tracking-widest text-[10px] px-2 py-1 border-2 ${ranks.has(tIdx) ? "border-black bg-[#00A9FF] text-white" : "border-black bg-white text-black"}`}
                data-testid={`admin-custom-bot-names-edit-rank-${idx}-${tIdx}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* Banner rank override — pins what other players see on this
            bot's profile card + friend-search row + inspect modal.
            "AUTO" leaves it up to the seeded RNG (default). */}
        <div>
          <div className="text-[10px] font-anton uppercase tracking-widest text-neutral-500 mb-1">
            Banner rank (profile + friends search)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bannerRp == null ? "auto" : (() => {
                // Snap current RP to closest tier for display in the picker.
                let ti = 0;
                for (let i = 0; i < RANK_TIER_FLOORS.length; i++) {
                  if (bannerRp >= RANK_TIER_FLOORS[i]) ti = i;
                }
                return String(ti);
              })()}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "auto") {
                  setBannerRp(null);
                } else {
                  // Snap to floor+60 (mid-first-division) for the
                  // picked tier — matches AccountRow / LeaderboardBot
                  // rank-editor conventions.
                  setBannerRp(RANK_TIER_FLOORS[parseInt(v, 10)] + 60);
                }
              }}
              className="border-2 border-black px-2 py-1 font-anton uppercase tracking-widest text-xs bg-white"
              data-testid={`admin-custom-bot-names-edit-banner-tier-${idx}`}
            >
              <option value="auto">Auto (random)</option>
              {RANK_TIER_LABELS.map((label, tIdx) => (
                <option key={label} value={tIdx}>{label}</option>
              ))}
            </select>
            {bannerRp != null && (
              <label className="flex items-center gap-1 text-[10px] font-anton uppercase tracking-widest text-neutral-600">
                RP:
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={15}
                  value={bannerRp}
                  onChange={(e) => setBannerRp(parseInt(e.target.value, 10) || 0)}
                  className="w-24 border-2 border-black px-2 py-1 font-anton tracking-widest text-xs tabular-nums"
                  data-testid={`admin-custom-bot-names-edit-banner-rp-${idx}`}
                />
              </label>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="py-2 flex items-center gap-3" data-testid={`admin-custom-bot-names-row-${idx}`}>
      <div className="flex-1 min-w-0">
        <div className="font-anton uppercase text-sm truncate flex items-center gap-1.5">
          {row.name}
          {row.shadows_builtin && (
            <span className="text-[9px] font-anton uppercase px-1 py-0 border border-black bg-[#FFB000] text-black" aria-label="A built-in bot pool already has this name; yours will oversample it.">
              DUPLICATE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {(row.modes && row.modes.length > 0) ? (
            row.modes.map((m) => (
              <span key={m} className="text-[9px] font-anton uppercase tracking-widest px-1.5 py-0.5 border border-black bg-[#9B59B6] text-white">
                {(GAME_MODE_OPTIONS.find((x) => x.value === m) || {}).label || m}
              </span>
            ))
          ) : (
            <span className="text-[9px] font-anton uppercase tracking-widest px-1.5 py-0.5 border border-black bg-white text-black">
              ALL MODES
            </span>
          )}
          {(row.ranks && row.ranks.length > 0) ? (
            row.ranks.map((t) => (
              <span key={t} className="text-[9px] font-anton uppercase tracking-widest px-1.5 py-0.5 border border-black bg-[#00A9FF] text-white">
                {RANK_TIER_LABELS[t] || `T${t}`}
              </span>
            ))
          ) : (
            <span className="text-[9px] font-anton uppercase tracking-widest px-1.5 py-0.5 border border-black bg-white text-black">
              ALL RANKS
            </span>
          )}
          {row.created_by && (
            <span className="text-[9px] font-anton text-neutral-500">by {row.created_by}</span>
          )}
          {Number.isFinite(row.rank_points) && (() => {
            // Show a pinned-rank chip so admins can spot which entries
            // have a banner override without clicking edit. Derive the
            // tier label from the RP using the same floor grid the
            // picker uses.
            let ti = 0;
            for (let i = 0; i < RANK_TIER_FLOORS.length; i++) {
              if (row.rank_points >= RANK_TIER_FLOORS[i]) ti = i;
            }
            return (
              <span
                className="text-[9px] font-anton uppercase tracking-widest px-1.5 py-0.5 border border-black bg-[#FFB000] text-black"
                aria-label={`Banner pinned to ${row.rank_points} RP`}
                data-testid={`admin-custom-bot-names-banner-chip-${idx}`}
              >
                📌 {RANK_TIER_LABELS[ti] || `T${ti}`} · {row.rank_points}
              </span>
            );
          })()}
        </div>
      </div>
      <button
        onClick={openEdit}
        className="btn-pow bg-[#0055FF] text-white [&]:px-3 [&]:py-1 [&]:text-xs"
        data-testid={`admin-custom-bot-names-edit-${idx}`}
        aria-label="Edit"
      >
        <Pencil size={14} strokeWidth={3} />
      </button>
      <button
        onClick={onDeleted}
        className="btn-pow bg-[#E62429] text-white [&]:px-3 [&]:py-1 [&]:text-xs"
        data-testid={`admin-custom-bot-names-delete-${idx}`}
        aria-label="Remove"
      >
        <Trash2 size={14} strokeWidth={3} />
      </button>
    </div>
  );
}

