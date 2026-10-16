// Public profile modal — overlay shown when inspecting any other player.
// Pulls /api/users/{username}/profile (email omitted server-side).
import { useEffect, useState } from "react";
import { X, History, Bot, Crown, Trophy, Swords, WifiOff, Loader2, Star, Lock, Flag, Ban } from "lucide-react";
import api from "@/api";
import PlayerCard from "@/components/PlayerCard";
import RankProgressBar from "@/components/RankProgressBar";
import { divisionRoman, isUltimateGooner } from "@/game/rankIcons";
import UltimateGoonerBadge from "@/components/UltimateGoonerBadge";
import { formatBannerTitle, bannerTitleAnimClass, bannerTitleStyle } from "@/game/bannerTitle";
import { useAuth } from "@/context/AuthContext";
import { ReportPlayerModal } from "@/components/Hud";

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];

const MODE_META = {
  ranked:  { label: "RANKED",  color: "#0055FF", Icon: Trophy },
  casual:  { label: "QUICK",   color: "#E62429", Icon: Swords },
  offline: { label: "OFFLINE", color: "#06A35F", Icon: WifiOff },
};

/* `isBot` prop: when true the modal renders a "private profile" state
   locally (no API call, no data) — this makes bots visually
   indistinguishable from real players who've set their profile to
   private. Report button is hidden for bots and for the viewer's own
   profile. */
export default function PublicProfileModal({ username, isBot = false, onClose }) {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    if (!username) return;
    setData(null);
    setError("");
    setLoading(true);
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/users/${encodeURIComponent(username)}/profile`);
        if (alive) setData(data);
      } catch (e) {
        if (alive) setError(e.response?.data?.detail || e.message || "Failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [username, isBot]);

  if (!username) return null;

  // Show REPORT button only when we're inspecting someone else's real
  // profile — never on our own, never on bots' pretend-private profiles.
  const canReport = !isBot && !!username && me?.username && me.username !== username;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-3 sm:p-6" data-testid="public-profile-modal" onClick={onClose}>
      <div className="card-pow p-0 w-full max-w-2xl bg-white text-neutral-900" onClick={(e) => e.stopPropagation()}>
        <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
          <div className="font-display text-2xl sm:text-3xl text-[#FFD700] flex-1" data-testid="public-profile-username">
            {data?.username || username}
          </div>
          {data?.banned && (
            <span
              className="font-anton uppercase text-[10px] tracking-widest px-2 py-1 border-2 border-white bg-[#E62429] text-white flex items-center gap-1"
              data-testid="public-profile-banned-pill"
              aria-label={
                data.ban_status === "suspended" && data.ban_until
                  ? `Suspended until ${new Date(data.ban_until).toLocaleString()}`
                  : "Account banned"
              }
            >
              <Ban size={12} strokeWidth={3} />
              {data.ban_status === "suspended" ? "SUSPENDED" : "BANNED"}
            </span>
          )}
          {data?.online && data?.in_match && !data?.banned && (
            <span className="font-anton uppercase text-xs text-[#E62429]" data-testid="public-profile-in-match">● IN MATCH{data.match_kind ? ` · ${String(data.match_kind).toUpperCase()}` : ""}</span>
          )}
          {data?.online && !data?.in_match && !data?.banned && (
            <span className="font-anton uppercase text-xs text-[#06D6A0]" data-testid="public-profile-online">● ONLINE</span>
          )}
          {canReport && (
            <button
              onClick={() => setShowReport(true)}
              className="btn-pow bg-[#E62429] text-white [&]:px-3 [&]:py-1 [&]:text-xs flex items-center gap-1"
              data-testid="public-profile-report-btn"
              aria-label={`Report ${username}`}
            >
              <Flag size={14} strokeWidth={3} /> REPORT
            </button>
          )}
          <button onClick={onClose} className="font-anton hover:opacity-80" data-testid="public-profile-close">
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        {/* Banned banner — shown right below the header on any profile
            with an active ban/suspension. Keeps the pill in the header
            for quick scan + this larger banner so the state is obvious
            even for players who missed the pill. */}
        {data?.banned && (
          <div
            className="border-b-4 border-black bg-[#E62429] text-white px-5 py-3 flex items-center gap-3"
            data-testid="public-profile-banned-banner"
          >
            <Ban size={22} strokeWidth={3} className="shrink-0" />
            <div className="min-w-0">
              <div className="font-display text-xl leading-none uppercase">
                {data.ban_status === "suspended" ? "Account Suspended" : "Account Banned"}
              </div>
              <div className="font-anton uppercase text-[10px] tracking-widest mt-1 opacity-90">
                {data.ban_status === "suspended" && data.ban_until
                  ? `Suspended until ${new Date(data.ban_until).toLocaleString()}`
                  : "This account has been removed for violating community guidelines."}
              </div>
            </div>
          </div>
        )}

        {/* Bots render an identical "private profile" state to a real user
            who's locked their profile — same padlock, same message, no
            content. Callers pass `isBot={true}` when opening from a bot's
            scoreboard row. */}
        {isBot && !loading && !data && (
          <div className="px-5 py-14 text-center bg-white" data-testid="public-profile-private">
            <Lock size={44} strokeWidth={3} className="inline text-neutral-400" />
            <div className="font-display text-2xl mt-3 text-neutral-700">Private Profile</div>
            <div className="font-anton uppercase text-xs mt-1 tracking-widest text-neutral-500">
              This player&apos;s profile isn&apos;t public.
            </div>
          </div>
        )}

        {loading && (
          <div className="px-5 py-12 text-center" data-testid="public-profile-loading">
            <Loader2 size={28} strokeWidth={3} className="inline animate-spin text-neutral-500" />
          </div>
        )}
        {!isBot && error && (
          <div className="px-5 py-6 font-anton uppercase text-center text-[#E62429]" data-testid="public-profile-error">
            {error}
          </div>
        )}

        {data && (
          <div className="max-h-[70vh] overflow-y-auto">
            <div className="px-5 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <PlayerCard
                size="lg"
                username={data.username}
                avatar={data.avatar}
                rankTier={data.rank_tier}
                rankName={data.rank_name}
                rankDivision={data.rank_division ?? 0}
                rankPoints={data.rank_points}
                peakRankTier={data.peak_rank_tier}
                peakRankDivision={data.peak_rank_division ?? 0}
                bannerIcon={Number.isFinite(data.banner_icon) ? data.banner_icon : 0}
                bannerColor={Number.isFinite(data.banner_color) ? data.banner_color : 0}
                bannerAnimated={!!data.banner_animated}
                bannerTitle={formatBannerTitle(data)}
                bannerTitleClass={bannerTitleAnimClass(data)}
                bannerTitleStyle={bannerTitleStyle(data)}
                level={data.level ?? 1}
                online={data.online}
                testid="public-profile-card"
              />
              <div className="flex flex-col gap-1">
                <RankPill label="Current" tier={data.rank_tier} name={data.rank_name} division={data.rank_division ?? 0} points={data.rank_points} leaderboardRank={data.leaderboard_rank ?? null} testid="public-profile-current-rank" />
                <RankPill label="Peak" tier={data.peak_rank_tier} name={data.peak_rank_name} division={data.peak_rank_division ?? 0} points={data.peak_rank_points} leaderboardRank={data.leaderboard_rank ?? null} crown testid="public-profile-peak-rank" />
                <div className="mt-1" data-testid="public-profile-progress-wrap">
                  <RankProgressBar
                    tier={data.rank_tier}
                    division={data.rank_division ?? 0}
                    points={data.rank_points}
                    testid="public-profile-progress"
                  />
                </div>
                <div className="flex items-center gap-2 mt-1" data-testid="public-profile-level-row">
                  <Star size={14} strokeWidth={3} className="text-[#FFD700]" />
                  <span className="font-anton uppercase text-xs text-neutral-500 w-14">Level</span>
                  <span className="font-anton uppercase tracking-widest text-xs px-2 py-0.5 border-2 border-black bg-[#FFD700] text-[#0A0A0A]" data-testid="public-profile-level">
                    LV {data.level ?? 1}
                  </span>
                </div>
              </div>
            </div>
            {data.private ? (
              // Privacy mode — show a "this profile is private" banner
              // in place of stats + match history. Server still returns
              // the rank/avatar/level fields above so the card still
              // looks complete; we just hide the numbers and game log.
              <div
                className="border-t-4 border-black bg-neutral-100 px-5 py-8 text-center"
                data-testid="public-profile-private-banner"
              >
                <Lock size={32} strokeWidth={3} className="inline text-neutral-500" />
                <div className="mt-3 font-display text-2xl uppercase text-neutral-700">
                  PRIVATE PROFILE
                </div>
                <div className="mt-2 font-anton uppercase tracking-widest text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                  This player has set their profile to private. Stats and match history are hidden.
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 pb-4">
                  <Stat label="KILLS" value={data.stats?.kills ?? 0} color="#E62429" testid="public-kills" />
                  <Stat label="DEATHS" value={data.stats?.deaths ?? 0} color="#0055FF" testid="public-deaths" />
                  <Stat label="MATCHES" value={data.stats?.matches ?? 0} color="#FFD700" textColor="#0A0A0A" testid="public-matches" />
                  <Stat
                    label="K/D"
                    value={data.stats?.deaths > 0 ? (data.stats.kills / data.stats.deaths).toFixed(2) : String(data.stats?.kills ?? 0)}
                    color="#0A0A0A"
                    testid="public-kd"
                  />
                </div>

                {/* Recent matches */}
                <div className="border-t-4 border-black">
                  <div className="bg-[#FFD700] px-4 py-2 flex items-center gap-2 font-anton uppercase tracking-widest text-sm">
                    <History size={16} strokeWidth={3} /> Recent Matches
                  </div>
                  {(data.history || []).length === 0 ? (
                    <div className="px-5 py-8 text-center" data-testid="public-history-empty">
                      <Bot size={28} strokeWidth={3} className="inline text-neutral-400" />
                      <div className="font-anton uppercase mt-2 text-neutral-500">No matches yet</div>
                    </div>
                  ) : (
                    data.history.map((m, i) => <HistoryRow key={i} m={m} idx={i} />)
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {showReport && (
        <ReportPlayerModal
          target={{ username }}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

function HistoryRow({ m, idx }) {
  const meta = MODE_META[m.mode] || MODE_META.casual;
  const M = meta.Icon;
  const tierIdx = rankIdxFromName(m.rank_name_after);
  const rankColor = RANK_COLORS[tierIdx];
  const deltaColor = m.rp_delta > 0 ? "#06A35F" : m.rp_delta < 0 ? "#E62429" : "#0A0A0A";
  const sign = m.rp_delta > 0 ? "+" : "";
  return (
    <div className={`px-4 py-2 grid grid-cols-12 items-center border-t-2 border-black ${idx % 2 === 0 ? "bg-white" : "bg-[#F4F4F5]"} text-sm`} data-testid={`public-history-row-${idx}`}>
      <div className="col-span-3">
        <span className="inline-flex items-center gap-1 border-pow-thin px-2 py-1 font-anton uppercase text-[10px]" style={{ background: meta.color, color: "#fff" }}>
          <M size={12} strokeWidth={3} /> {meta.label}
        </span>
      </div>
      <div className="col-span-2 font-anton">#{m.placement || "?"} <span className="text-neutral-400 text-xs">/{m.total_players || "?"}</span></div>
      <div className="col-span-2 font-anton text-right">{m.kills}K</div>
      <div className="col-span-2 font-anton text-right">{m.deaths}D</div>
      <div className="col-span-1 text-right font-display text-lg" style={{ color: deltaColor }}>
        {m.rp_delta !== 0 ? `${sign}${m.rp_delta}` : "—"}
      </div>
      <div className="col-span-2 text-right">
        <span className="inline-block font-anton uppercase text-[10px] px-1.5 py-0.5" style={{ background: rankColor, color: tierIdx === 8 ? "#FFD700" : "#0A0A0A" }}>
          {m.rank_name_after}
        </span>
      </div>
    </div>
  );
}

function rankIdxFromName(name) {
  const arr = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "GOONMASTER"];
  return Math.max(0, arr.indexOf((name || "BRONZE").toUpperCase()));
}

function RankPill({ label, tier, name, division = 0, points, crown = false, leaderboardRank = null, testid }) {
  const ultimate = isUltimateGooner(tier, leaderboardRank);
  const color = ultimate ? "#FFD700" : RANK_COLORS[Math.max(0, Math.min(8, tier ?? 0))];
  const textColor = ultimate ? "#0A0A0A" : ((tier ?? 0) === 8 ? "#FFD700" : "#0A0A0A");
  const roman = divisionRoman(division);
  return (
    <div className="flex items-center gap-2" data-testid={testid}>
      {crown && <Crown size={14} strokeWidth={3} className="text-[#FFD700]" />}
      <span className="font-anton uppercase text-xs text-neutral-500 w-14">{label}</span>
      <span className="font-anton uppercase tracking-widest text-xs px-2 py-0.5 border-2 border-black" style={{ background: color, color: textColor }}>
        {ultimate ? "ULTIMATE GOONER" : (name + (roman ? ` ${roman}` : ""))}
      </span>
      {ultimate && (
        <UltimateGoonerBadge rank={leaderboardRank} size={18} data-testid={`${testid}-badge`} />
      )}
      <span className="font-anton tabular-nums text-xs">{points} RP</span>
    </div>
  );
}

function Stat({ label, value, color, textColor = "#fff", testid }) {
  return (
    <div className="border-pow-thin p-3" style={{ background: color, color: textColor }} data-testid={testid}>
      <div className="font-anton uppercase tracking-widest text-[10px] opacity-80">{label}</div>
      <div className="font-display text-3xl mt-1">{value}</div>
    </div>
  );
}
