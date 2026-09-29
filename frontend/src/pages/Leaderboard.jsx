import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/api";
import {
  ArrowLeft, Trophy, Calendar, RotateCcw, Eye, Archive, Medal, Crown,
  Users, TrendingUp, TrendingDown,
} from "lucide-react";
import audioBus from "@/game/audio";
import { divisionRoman, isUltimateGooner, rankLabelFor } from "@/game/rankIcons";
import { useAuth } from "@/context/AuthContext";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import PublicProfileModal from "@/components/PublicProfileModal";
import UltimateGoonerBadge from "@/components/UltimateGoonerBadge";

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#A3E4B8", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];

function fmtDHMS(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return { d, h, m, s: r };
}

export default function Leaderboard() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // Clicking any row opens the player's PublicProfileModal — same
  // component the friends list / spectate-search use. `null` = closed.
  const [openProfile, setOpenProfile] = useState(null); // username
  const [season, setSeason] = useState(null); // { season_number, seconds_left, season_ends_at, length_days }
  const [tick, setTick] = useState(0);
  // Outer tab: CURRENT vs ARCHIVE.
  const [tab, setTab] = useState("current"); // 'current' | 'archive'
  // Inner tab (CURRENT only): which slice of the live board to show.
  //   global  — all players (default)
  //   friends — caller + accepted friends
  const [view, setView] = useState("global"); // 'global' | 'friends'
  const [friendsRows, setFriendsRows] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // Live RP-delta indicator. On every /leaderboard poll we compare the
  // new snapshot to `prevRpRef` (keyed by username) and record any
  // delta with a timestamp. The row then flashes a ▲/▼ chip that
  // fades out after DELTA_TTL_MS. Purely cosmetic — no server round-trip.
  const DELTA_TTL_MS = 12000;
  const prevRpRef = useRef({}); // { [username]: rank_points }
  const [rpDeltas, setRpDeltas] = useState({}); // { [username]: { delta, at } }

  const [archiveIndex, setArchiveIndex] = useState([]);
  const [archiveSeason, setArchiveSeason] = useState(null);
  const [archiveRows, setArchiveRows] = useState([]);
  const [archiveLoading, setArchiveLoading] = useState(false);

  // --- Global board bootstrap ---------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const [{ data: rowsData }, { data: seasonData }] = await Promise.all([
          api.get("/leaderboard"),
          api.get("/season"),
        ]);
        // Seed baseline RP map so the first refresh diff isn't spammy.
        const baseline = {};
        (rowsData || []).forEach((r) => { baseline[r.username] = r.rank_points ?? 0; });
        prevRpRef.current = baseline;
        setRows(rowsData);
        setSeason(seasonData);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Per-tab music — triumphant uptempo synth-pop.
  useEffect(() => {
    audioBus.startLeaderboardMusic?.();
    return () => { audioBus.stopMusic?.(); };
  }, []);

  // Poll /leaderboard + /season every 15s and compute RP deltas per row.
  useEffect(() => {
    const refresh = setInterval(async () => {
      try {
        const { data } = await api.get("/season");
        setSeason(data);
      } catch {}
      try {
        const { data } = await api.get("/leaderboard");
        const nextDeltas = { ...rpDeltas };
        const now = Date.now();
        (data || []).forEach((r) => {
          const prev = prevRpRef.current[r.username];
          const curr = r.rank_points ?? 0;
          if (prev != null && prev !== curr) {
            nextDeltas[r.username] = { delta: curr - prev, at: now };
          }
          prevRpRef.current[r.username] = curr;
        });
        setRpDeltas(nextDeltas);
        setRows(data);
      } catch {}
    }, 15000);
    const live = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearInterval(refresh); clearInterval(live); };
    // rpDeltas intentionally NOT in deps — we always read/merge the latest via a fresh ref of setRpDeltas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sweep expired RP-delta chips off the UI every second so they fade out cleanly.
  useEffect(() => {
    const t = setInterval(() => {
      setRpDeltas((prev) => {
        const now = Date.now();
        let changed = false;
        const next = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v && now - v.at < DELTA_TTL_MS) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = season ? Math.max(0, (season.seconds_left || 0) - tick) : 0;
  const { d, h, m, s } = fmtDHMS(secondsLeft);

  // --- Friends board (lazy) -----------------------------------------
  useEffect(() => {
    if (tab !== "current" || view !== "friends") return;
    setFriendsLoading(true);
    (async () => {
      try {
        const { data } = await api.get("/leaderboard/friends");
        setFriendsRows(Array.isArray(data) ? data : []);
      } catch {
        setFriendsRows([]);
      } finally {
        setFriendsLoading(false);
      }
    })();
  }, [tab, view]);

  // Archive tab: fetch the index of past seasons once, on first open.
  useEffect(() => {
    if (tab !== "archive" || archiveIndex.length) return;
    (async () => {
      try {
        const { data } = await api.get("/leaderboard/archive");
        setArchiveIndex(Array.isArray(data) ? data : []);
        if (data?.length && archiveSeason === null) {
          setArchiveSeason(data[0].season_number);
        }
      } catch {
        setArchiveIndex([]);
      }
    })();
  }, [tab, archiveIndex.length, archiveSeason]);

  // Fetch the selected past season's top-100 whenever the picker changes.
  useEffect(() => {
    if (tab !== "archive" || archiveSeason === null) return;
    setArchiveLoading(true);
    (async () => {
      try {
        const { data } = await api.get(`/leaderboard/archive/${archiveSeason}`);
        setArchiveRows(Array.isArray(data?.top_100) ? data.top_100 : []);
      } catch {
        setArchiveRows([]);
      } finally {
        setArchiveLoading(false);
      }
    })();
  }, [tab, archiveSeason]);

  return (
    <div className="min-h-screen bg-black halftone-dark text-white p-6 md:p-12" data-testid="leaderboard-page">
      <div className="flex items-center justify-between mb-8">
        <Link to="/lobby" draggable={false} onDragStart={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }} className="btn-pow bg-neutral-900 text-white select-none" data-testid="leaderboard-back-button">
          <span className="flex items-center gap-2"><ArrowLeft size={18} strokeWidth={3} /> BACK</span>
        </Link>
        <div className="inline-block bg-[#FFD700] border-pow shadow-pow-sm px-3 py-1 rotate-2">
          <span className="font-anton uppercase tracking-widest flex items-center gap-2">
            <Trophy size={18} strokeWidth={3} /> HALL OF FAME
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto">
        <h1 className="font-display text-6xl uppercase text-[#E62429] text-pow-shadow-lg mb-3">LEADERBOARD</h1>

        {/* "Your placement" jump-strip — global view only */}
        {tab === "current" && view === "global" && !loading && user && (() => {
          const myIdx = rows.findIndex((r) => r.id === user.id || r.username === user.username);
          if (myIdx < 0) return null;
          const me = rows[myIdx];
          return (
            <button
              type="button"
              onClick={() => {
                const el = document.querySelector(`[data-testid="leaderboard-row-${myIdx}"]`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="card-pow p-0 overflow-hidden mb-4 w-full text-left rotate-[0.4deg] hover:translate-y-[-1px] transition-transform"
              data-testid="leaderboard-you-strip"
            >
              <div className="flex items-stretch">
                <div className="bg-[#E62429] text-white font-display text-xl px-4 py-2 flex items-center gap-2">
                  <Crown size={18} strokeWidth={3} className="text-[#FFD700]" /> YOU
                </div>
                <div className="bg-neutral-900 text-white px-4 py-2 flex-1 flex items-center justify-between gap-3 font-anton uppercase tracking-widest text-sm border-2 border-black">
                  <span>
                    <span className="font-display text-2xl text-[#E62429] mr-1">#{myIdx + 1}</span>
                    of {rows.length}
                  </span>
                  <span className="tabular-nums">{me.rank_points ?? 0} RP</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 border-2 border-black"
                    style={{ background: isUltimateGooner(me.rank_tier, myIdx + 1) ? "#FFD700" : RANK_COLORS[Math.max(0, Math.min(8, me.rank_tier ?? 0))], color: isUltimateGooner(me.rank_tier, myIdx + 1) ? "#0A0A0A" : ((me.rank_tier ?? 0) === 8 ? "#FFD700" : "#0A0A0A") }}
                  >
                    {isUltimateGooner(me.rank_tier, myIdx + 1)
                      ? "ULTIMATE GOONER"
                      : ((me.rank_name || "BRONZE") + (divisionRoman(me.rank_division) ? ` ${divisionRoman(me.rank_division)}` : ""))}
                  </span>
                </div>
              </div>
            </button>
          );
        })()}

        {/* CURRENT ↔ ARCHIVE outer tab switcher. */}
        <div className="flex gap-2 mb-4" data-testid="leaderboard-tab-switcher">
          <button
            type="button"
            onClick={() => setTab("current")}
            data-testid="leaderboard-tab-current"
            className={`btn-pow flex items-center gap-2 [&]:py-2 [&]:px-4 [&]:text-sm ${
              tab === "current" ? "bg-[#E62429] text-white" : "bg-neutral-900 text-white"
            }`}
          >
            <Trophy size={14} strokeWidth={3} /> CURRENT SEASON
          </button>
          <button
            type="button"
            onClick={() => setTab("archive")}
            data-testid="leaderboard-tab-archive"
            className={`btn-pow flex items-center gap-2 [&]:py-2 [&]:px-4 [&]:text-sm ${
              tab === "archive" ? "bg-[#E62429] text-white" : "bg-neutral-900 text-white"
            }`}
          >
            <Archive size={14} strokeWidth={3} /> PAST SEASONS
          </button>
        </div>

        {/* GLOBAL / FRIENDS / WEAPONS inner tabs — only visible on CURRENT tab. */}
        {tab === "current" && (
          <div className="flex flex-wrap gap-2 mb-4" data-testid="leaderboard-view-switcher">
            <button
              type="button"
              onClick={() => setView("global")}
              data-testid="leaderboard-view-global"
              className={`btn-pow flex items-center gap-2 [&]:py-1.5 [&]:px-3 [&]:text-xs ${
                view === "global" ? "bg-[#FFD700] text-black" : "bg-neutral-900 text-white"
              }`}
            >
              <Trophy size={12} strokeWidth={3} /> GLOBAL
            </button>
            <button
              type="button"
              onClick={() => setView("friends")}
              data-testid="leaderboard-view-friends"
              className={`btn-pow flex items-center gap-2 [&]:py-1.5 [&]:px-3 [&]:text-xs ${
                view === "friends" ? "bg-[#FFD700] text-black" : "bg-neutral-900 text-white"
              }`}
            >
              <Users size={12} strokeWidth={3} /> FRIENDS
            </button>
          </div>
        )}

        {/* Season banner (current + global only — the friends slice
            isn't tied to season resets in a meaningful way). */}
        {tab === "current" && view === "global" && season && (
          <div className="card-pow p-0 mb-6 overflow-hidden -rotate-1" data-testid="season-banner">
            <div className="bg-black text-white px-5 py-3 flex items-center gap-3">
              <div className="inline-block bg-[#E62429] text-white border-pow-thin px-2 py-0.5 font-anton uppercase tracking-widest text-xs rotate-2">
                <Calendar size={12} strokeWidth={3} className="inline -mt-0.5 mr-1" /> SEASON {season.season_number}
              </div>
              <div className="font-anton uppercase tracking-widest text-xs opacity-70 flex-1">
                Ranks reset every {season.length_days} days
              </div>
              <RotateCcw size={16} strokeWidth={3} className="text-[#FFD700]" />
            </div>
            <div className="bg-neutral-900 text-white px-5 py-4 flex flex-wrap items-end gap-3">
              <div className="font-anton uppercase tracking-widest text-xs text-neutral-500">Resets in</div>
              <div className="flex items-end gap-2" data-testid="season-countdown">
                <TimeBlock value={d} unit="days" />
                <TimeBlock value={h} unit="hrs" />
                <TimeBlock value={m} unit="min" />
                <TimeBlock value={s} unit="sec" pulse />
              </div>
            </div>
          </div>
        )}

        <div className="card-pow p-0 overflow-hidden">
          <div className="grid grid-cols-12 bg-black text-white font-anton uppercase tracking-widest px-4 py-3 text-sm">
            <div className="col-span-1">#</div>
            <div className="col-span-7">Player</div>
            <div className="col-span-2 text-right">Rank</div>
            <div className="col-span-2 text-right">RP</div>
          </div>

          {tab === "current" && view === "global" && (
            loading ? (
              <div className="p-8 font-display text-3xl text-center">LOADING...</div>
            ) : rows.length === 0 ? (
              <div className="p-8 font-anton text-center uppercase text-neutral-500">No frags yet. Be the first.</div>
            ) : (
              rows.map((r, i) => (
                <PlayerRow
                  key={r.username + i}
                  r={r}
                  i={i}
                  user={user}
                  delta={rpDeltas[r.username]}
                  onProfile={() => setOpenProfile(r.username)}
                  onSpectate={() => nav(`/spectate/${encodeURIComponent(r.username)}`)}
                  testidPrefix="leaderboard"
                />
              ))
            )
          )}

          {tab === "current" && view === "friends" && (
            friendsLoading ? (
              <div className="p-8 font-display text-3xl text-center">LOADING...</div>
            ) : friendsRows.length === 0 ? (
              <div className="p-8 font-anton text-center uppercase text-neutral-500" data-testid="leaderboard-friends-empty">
                Add friends to see them ranked here.
              </div>
            ) : (
              friendsRows.map((r, i) => (
                <PlayerRow
                  key={(r.id || r.username) + i}
                  r={r}
                  i={i}
                  user={user}
                  delta={rpDeltas[r.username]}
                  onProfile={() => setOpenProfile(r.username)}
                  onSpectate={() => nav(`/spectate/${encodeURIComponent(r.username)}`)}
                  testidPrefix="leaderboard-friend"
                />
              ))
            )
          )}

          {tab === "archive" && (
            <ArchiveBody
              index={archiveIndex}
              selected={archiveSeason}
              onSelect={setArchiveSeason}
              rows={archiveRows}
              loading={archiveLoading}
            />
          )}
        </div>
      </div>

      <PublicProfileModal
        username={openProfile}
        onClose={() => setOpenProfile(null)}
      />
    </div>
  );
}

/* ---------- Player row ---------- */
// Shared row renderer for the GLOBAL and FRIENDS boards. Renders rank
// tier chip + RP as the trailing column.
function PlayerRow({ r, i, user, delta, onProfile, onSpectate, testidPrefix }) {
  const tier = Math.max(0, Math.min(8, r.rank_tier ?? 0));
  const color = RANK_COLORS[tier];
  const isYou = !!(user && (r.id === user.id || r.username === user.username || r.is_me));
  const MedalEl = i === 0 ? Crown : i <= 2 ? Medal : null;
  const medalColor = i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : null;
  const leaderPos = i + 1;
  const ultimate = isUltimateGooner(tier, leaderPos);

  return (
    <button
      type="button"
      onClick={onProfile}
      className={`grid grid-cols-12 px-4 py-3 border-t-2 border-black font-body items-center text-left w-full transition-transform hover:translate-y-[-1px] ${
        isYou ? "bg-[#FFFCE6] text-black ring-4 ring-inset ring-[#E62429]" :
        i === 0 ? "bg-[#FFD700] text-black" : i === 1 ? "bg-[#FFE680] text-black" : i === 2 ? "bg-[#FFF0AC] text-black" : "bg-neutral-900 text-white hover:bg-neutral-800"
      }`}
      data-testid={`${testidPrefix}-row-${i}`}
      data-you={isYou ? "true" : "false"}
      title={`View ${r.username}'s profile`}
    >
      <div className="col-span-1 font-display text-2xl flex items-center gap-1">
        {MedalEl ? (
          <MedalEl size={22} strokeWidth={3} style={{ color: medalColor }} />
        ) : (
          <span className="text-neutral-700">{i + 1}</span>
        )}
      </div>
      <div className="col-span-7 font-anton uppercase text-lg flex items-center gap-2 min-w-0">
        <AnimatedRankIcon
          tier={tier}
          division={r.rank_division ?? 0}
          size={32}
          testid={`${testidPrefix}-row-${i}-icon`}
        />
        <span className="truncate">{r.username}</span>
        {isYou && (
          <span
            className="text-[10px] font-anton uppercase tracking-widest px-1.5 py-0.5 bg-[#E62429] text-white border-2 border-black flex-shrink-0"
            data-testid={`${testidPrefix}-row-${i}-you`}
          >
            YOU
          </span>
        )}
        {/* Live RP-delta chip — appears for ~12s after any RP change. */}
        {delta && delta.delta !== 0 && (
          <span
            className={`text-[10px] font-anton uppercase tracking-widest px-1.5 py-0.5 border-2 border-black flex items-center gap-1 flex-shrink-0 leaderboard-delta-pulse ${
              delta.delta > 0 ? "bg-[#06A35F] text-white" : "bg-[#E62429] text-white"
            }`}
            data-testid={`${testidPrefix}-row-${i}-delta`}
            data-delta-sign={delta.delta > 0 ? "up" : "down"}
          >
            {delta.delta > 0 ? <TrendingUp size={10} strokeWidth={3} /> : <TrendingDown size={10} strokeWidth={3} />}
            {delta.delta > 0 ? "+" : ""}{delta.delta}
          </span>
        )}
        {r.in_match ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onSpectate && onSpectate(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onSpectate && onSpectate(); } }}
            className="text-[10px] font-anton uppercase tracking-widest px-1.5 py-0.5 bg-[#E62429] text-white border-2 border-black flex items-center gap-1 hover:translate-y-[-1px] transition-transform flex-shrink-0 cursor-pointer"
            data-testid={`${testidPrefix}-spectate-${i}`}
            title={`Spectate ${r.username}`}
          >
            <Eye size={11} strokeWidth={3} />
            SPECTATE
          </span>
        ) : r.online ? (
          <span
            className="text-[10px] font-anton uppercase tracking-widest text-[#06A35F] flex-shrink-0"
            data-testid={`${testidPrefix}-status-${i}`}
            data-status="online"
          >
            ● ONLINE
          </span>
        ) : null}
      </div>
      <div className="col-span-2 text-right flex items-center justify-end gap-1.5">
        <span
          className="font-anton uppercase text-sm px-2 py-1"
          style={{ background: ultimate ? "#FFD700" : color, color: ultimate ? "#0A0A0A" : (tier === 8 ? "#FFD700" : "#0A0A0A") }}
          data-testid={`${testidPrefix}-rank-${i}`}
        >
          {ultimate ? "ULTIMATE GOONER" : rankLabelFor(tier, r.rank_division ?? 0, r.rank_name)}
        </span>
        {ultimate && (
          <UltimateGoonerBadge
            rank={leaderPos}
            size={22}
            data-testid={`${testidPrefix}-ultimate-gooner-${i}`}
          />
        )}
      </div>
      <div className="col-span-2 text-right font-display text-2xl tabular-nums">{r.rank_points ?? 0}</div>
    </button>
  );
}

function TimeBlock({ value, unit, pulse = false }) {
  return (
    <div className="flex flex-col items-center" data-testid={`countdown-${unit}`}>
      <div className={`border-pow-thin px-3 py-1 bg-black text-white font-display text-2xl tabular-nums min-w-[3rem] text-center ${pulse ? "animate-pulse" : ""}`}>
        {String(value).padStart(2, "0")}
      </div>
      <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-500 mt-1">{unit}</div>
    </div>
  );
}

/* Archive tab body — unchanged from the previous implementation. */
function ArchiveBody({ index, selected, onSelect, rows, loading }) {
  if (!index?.length) {
    return (
      <div className="p-8 font-anton text-center uppercase text-neutral-500" data-testid="leaderboard-archive-empty">
        No past seasons have ended yet — Season 1 is still live.
      </div>
    );
  }
  return (
    <div data-testid="leaderboard-archive-body">
      <div className="flex flex-wrap gap-2 px-4 py-3 bg-[#FFF8DC] border-t-2 border-black">
        {index.map((meta) => {
          const isSel = meta.season_number === selected;
          return (
            <button
              key={meta.season_number}
              type="button"
              onClick={() => onSelect(meta.season_number)}
              data-testid={`archive-pick-${meta.season_number}`}
              className={`px-3 py-1 font-anton uppercase tracking-widest text-xs border-pow-thin transition-transform ${
                isSel ? "bg-[#E62429] text-white" : "bg-neutral-900 text-white hover:translate-y-[-1px]"
              }`}
            >
              SEASON {meta.season_number}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="p-8 font-display text-3xl text-center">LOADING...</div>
      ) : rows.length === 0 ? (
        <div className="p-8 font-anton text-center uppercase text-neutral-500">No archived rows for this season.</div>
      ) : (
        rows.map((r, i) => {
          const tier = Math.max(0, Math.min(8, r.rank_tier ?? 0));
          const color = RANK_COLORS[tier];
          const MedalEl = i === 0 ? Crown : i <= 2 ? Medal : null;
          const medalColor = i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : null;
          return (
            <div
              key={(r.user_id || r.username) + i}
              className={`grid grid-cols-12 px-4 py-3 border-t-2 border-black font-body items-center ${
                i === 0 ? "bg-[#FFD700] text-black" : i === 1 ? "bg-[#FFE680] text-black" : i === 2 ? "bg-[#FFF0AC] text-black" : "bg-neutral-900 text-white"
              }`}
              data-testid={`archive-row-${i}`}
            >
              <div className="col-span-1 font-display text-2xl flex items-center gap-1">
                {MedalEl ? (
                  <MedalEl size={22} strokeWidth={3} style={{ color: medalColor }} />
                ) : (
                  <span className="text-neutral-700">{r.rank ?? i + 1}</span>
                )}
              </div>
              <div className="col-span-7 font-anton uppercase text-lg flex items-center gap-2 min-w-0">
                <AnimatedRankIcon
                  tier={tier}
                  division={r.rank_division ?? 0}
                  size={32}
                  testid={`archive-row-${i}-icon`}
                />
                <span className="truncate">{r.username}</span>
              </div>
              <div className="col-span-2 text-right flex items-center justify-end gap-1.5">
                {(() => {
                  const leaderPos = i + 1;
                  const ultimate = isUltimateGooner(tier, leaderPos);
                  return (
                    <>
                      <span
                        className="font-anton uppercase text-sm px-2 py-1"
                        style={{ background: ultimate ? "#FFD700" : color, color: ultimate ? "#0A0A0A" : (tier === 8 ? "#FFD700" : "#0A0A0A") }}
                        data-testid={`archive-rank-${i}`}
                      >
                        {ultimate ? "ULTIMATE GOONER" : rankLabelFor(tier, r.rank_division ?? 0, r.rank_name)}
                      </span>
                      {ultimate && (
                        <UltimateGoonerBadge
                          rank={leaderPos}
                          size={20}
                          data-testid={`archive-ultimate-gooner-${i}`}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="col-span-2 text-right font-display text-2xl tabular-nums">{r.rank_points ?? 0}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
