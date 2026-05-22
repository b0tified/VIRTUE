import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import api from "@/api";
import { ArrowLeft, Crown, Trophy, Bot, Swords, History, WifiOff } from "lucide-react";

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

const MODE_META = {
  ranked:  { label: "RANKED",   color: "#0055FF", Icon: Trophy },
  casual:  { label: "QUICK",    color: "#E62429", Icon: Swords },
  offline: { label: "OFFLINE",  color: "#06A35F", Icon: WifiOff },
};

export default function Profile() {
  const { user } = useAuth();
  const s = user?.stats || { kills: 0, deaths: 0, matches: 0, wins: 0 };
  const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : String(s.kills);

  const currentRP = user?.rank_points ?? 0;
  const currentTier = Math.max(0, Math.min(7, user?.rank_tier ?? 0));
  const currentName = user?.rank_name || "BRONZE";
  const peakRP = user?.peak_rank_points ?? currentRP;
  const peakTier = Math.max(0, Math.min(7, user?.peak_rank_tier ?? currentTier));
  const peakName = user?.peak_rank_name || currentName;

  const [history, setHistory] = useState(null); // null = loading, [] = empty
  const [historyError, setHistoryError] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/profile/me/history?limit=10");
        if (alive) setHistory(data);
      } catch (e) {
        if (alive) setHistoryError(e?.response?.data?.detail || e.message || "Failed to load history");
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F4F5] halftone-light p-6 md:p-12" data-testid="profile-page">
      <Link to="/lobby" className="btn-pow bg-white text-black" data-testid="profile-back-button">
        <span className="flex items-center gap-2"><ArrowLeft size={18} strokeWidth={3} /> BACK</span>
      </Link>

      <div className="max-w-4xl mx-auto mt-8">
        <div className="card-pow p-8 -rotate-1">
          <div className="inline-block bg-[#0055FF] text-white border-pow shadow-pow-sm px-3 py-1 -rotate-2 mb-3">
            <span className="font-anton uppercase tracking-widest">Profile</span>
          </div>
          <h1 className="font-display text-6xl uppercase text-pow-shadow" data-testid="profile-username">
            {user?.username}
          </h1>
          <p className="font-body text-neutral-600 mt-1" data-testid="profile-email">{user?.email}</p>
        </div>

        {/* Rank cards: current + peak */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-8">
          <RankCard
            label="Current Rank"
            tier={currentTier}
            name={currentName}
            points={currentRP}
            testid="profile-current-rank"
          />
          <RankCard
            label="Peak Rank"
            tier={peakTier}
            name={peakName}
            points={peakRP}
            crown
            testid="profile-peak-rank"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mt-6">
          <Stat label="KILLS" value={s.kills} color="#E62429" testid="profile-kills" />
          <Stat label="DEATHS" value={s.deaths} color="#0055FF" testid="profile-deaths" />
          <Stat label="MATCHES" value={s.matches} color="#FFD700" textColor="#0A0A0A" testid="profile-matches" />
          <Stat label="K/D" value={kd} color="#0A0A0A" testid="profile-kd" />
        </div>

        {/* Match History (last 10 matches) */}
        <div className="card-pow p-0 mt-8 overflow-hidden" data-testid="profile-history-card">
          <div className="bg-black text-white px-5 py-3 flex items-center gap-2">
            <History size={18} strokeWidth={3} className="text-[#FFD700]" />
            <span className="font-anton uppercase tracking-widest">Match History</span>
            <span className="opacity-60 text-xs ml-auto">Last 10</span>
          </div>

          {history === null && historyError === null && (
            <div className="px-5 py-6 font-anton uppercase text-center text-neutral-500" data-testid="profile-history-loading">
              Loading...
            </div>
          )}

          {historyError && (
            <div className="px-5 py-6 font-anton uppercase text-center text-[#E62429]" data-testid="profile-history-error">
              {historyError}
            </div>
          )}

          {history !== null && history.length === 0 && (
            <div className="px-5 py-8 text-center" data-testid="profile-history-empty">
              <Bot size={32} strokeWidth={3} className="inline text-neutral-400" />
              <div className="font-anton uppercase mt-2 text-neutral-500">No matches yet — go drop into a Quick Match!</div>
            </div>
          )}

          {history !== null && history.length > 0 && (
            <>
              <div className="hidden md:grid grid-cols-12 bg-[#FFD700] px-4 py-2 font-anton uppercase tracking-widest text-sm border-t-4 border-black">
                <div className="col-span-2">Mode</div>
                <div className="col-span-2">Placement</div>
                <div className="col-span-2 text-right">Kills</div>
                <div className="col-span-2 text-right">Deaths</div>
                <div className="col-span-2 text-right">Δ RP</div>
                <div className="col-span-2 text-right">Rank</div>
              </div>
              {history.map((m, i) => (
                <HistoryRow key={i} idx={i} m={m} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ idx, m }) {
  const meta = MODE_META[m.mode] || MODE_META.casual;
  const M = meta.Icon;
  const rankColor = RANK_COLORS[Math.max(0, Math.min(7, ((rankIdxFromName(m.rank_name_after)) || 0)))];
  const deltaColor = m.rp_delta > 0 ? "#06A35F" : m.rp_delta < 0 ? "#E62429" : "#0A0A0A";
  const sign = m.rp_delta > 0 ? "+" : "";
  return (
    <div
      className={`grid grid-cols-12 px-4 py-2 border-t-2 border-black items-center text-sm md:text-base ${idx % 2 === 0 ? "bg-white" : "bg-[#F4F4F5]"}`}
      data-testid={`profile-history-row-${idx}`}
    >
      <div className="col-span-6 md:col-span-2 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 border-pow-thin px-2 py-1 font-anton uppercase text-xs"
          style={{ background: meta.color, color: "#fff" }}
          data-testid={`history-mode-${m.mode}`}
        >
          <M size={12} strokeWidth={3} /> {meta.label}
        </span>
      </div>
      <div className="col-span-6 md:col-span-2 text-right md:text-left font-anton text-lg">
        {m.placement || "-"} <span className="text-neutral-400 text-xs">/ {m.total_players || "-"}</span>
      </div>
      <div className="col-span-4 md:col-span-2 md:text-right font-anton text-lg" data-testid={`history-kills-${idx}`}>
        <span className="md:hidden text-xs opacity-60 uppercase mr-1">K</span>{m.kills}
      </div>
      <div className="col-span-4 md:col-span-2 md:text-right font-anton text-lg" data-testid={`history-deaths-${idx}`}>
        <span className="md:hidden text-xs opacity-60 uppercase mr-1">D</span>{m.deaths}
      </div>
      <div className="col-span-4 md:col-span-2 md:text-right font-display text-2xl" style={{ color: deltaColor }} data-testid={`history-delta-${idx}`}>
        {m.rp_delta !== 0 ? `${sign}${m.rp_delta}` : "—"}
        {m.is_placement && m.rp_delta > 0 && (
          <span className="ml-1 text-xs font-anton text-[#9B59B6]">2x</span>
        )}
      </div>
      <div className="col-span-12 md:col-span-2 mt-1 md:mt-0 md:text-right">
        <span
          className="inline-block font-anton uppercase text-xs px-2 py-1"
          style={{ background: rankColor, color: m.rank_name_after === "GOONMASTER" ? "#FFD700" : "#0A0A0A" }}
        >
          {m.rank_name_after || "BRONZE"}
        </span>
      </div>
    </div>
  );
}

function rankIdxFromName(name) {
  const arr = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "MASTER", "GRANDMASTER", "GOONMASTER"];
  return arr.indexOf((name || "BRONZE").toUpperCase());
}

function RankCard({ label, tier, name, points, crown = false, testid }) {
  const color = RANK_COLORS[Math.max(0, Math.min(7, tier))];
  const textColor = tier === 7 ? "#FFD700" : "#0A0A0A";
  return (
    <div className="card-pow p-0 overflow-hidden" data-testid={testid}>
      <div className="bg-black text-white px-5 py-2 flex items-center gap-2">
        {crown && <Crown size={16} strokeWidth={3} className="text-[#FFD700]" />}
        <span className="font-anton uppercase tracking-widest text-sm">{label}</span>
      </div>
      <div className="flex items-stretch">
        <div className="font-display px-6 py-5 text-4xl uppercase flex-1" style={{ background: color, color: textColor }}>
          {name}
        </div>
        <div className="bg-white px-5 py-5 font-display text-4xl border-l-2 border-black tabular-nums">
          {points}
          <span className="font-anton uppercase tracking-widest text-xs ml-1 opacity-60">RP</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, textColor = "#fff", testid }) {
  return (
    <div className="card-pow p-6" style={{ background: color, color: textColor }} data-testid={testid}>
      <div className="font-anton uppercase tracking-widest text-sm opacity-80">{label}</div>
      <div className="font-display text-5xl mt-2">{value}</div>
    </div>
  );
}
