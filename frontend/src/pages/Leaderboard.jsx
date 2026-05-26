import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/api";
import { ArrowLeft, Trophy, Calendar, RotateCcw, Eye } from "lucide-react";
import audioBus from "@/game/audio";

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(null); // { season_number, seconds_left, season_ends_at, length_days }
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: rowsData }, { data: seasonData }] = await Promise.all([
          api.get("/leaderboard"),
          api.get("/season"),
        ]);
        setRows(rowsData);
        setSeason(seasonData);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Per-tab music — triumphant uptempo synth-pop. Swaps in over whatever
  // the lobby was playing; restored to lobby music when the user
  // navigates back (Lobby mounts and re-starts its own loop).
  useEffect(() => {
    audioBus.startLeaderboardMusic?.();
    return () => { audioBus.stopMusic?.(); };
  }, []);

  // Re-fetch season every 30s for accurate baseline; local tick every 1s for the timer.
  // Also re-poll the leaderboard itself every 15s so in_match flags stay fresh
  // — players queue, finish matches, and disconnect constantly, and a stale
  // Spectate button would 404.
  useEffect(() => {
    const refresh = setInterval(async () => {
      try {
        const { data } = await api.get("/season");
        setSeason(data);
      } catch {}
      try {
        const { data } = await api.get("/leaderboard");
        setRows(data);
      } catch {}
    }, 15000);
    const live = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearInterval(refresh); clearInterval(live); };
  }, []);

  const secondsLeft = season ? Math.max(0, (season.seconds_left || 0) - tick) : 0;
  const { d, h, m, s } = fmtDHMS(secondsLeft);

  return (
    <div className="min-h-screen bg-[#F4F4F5] halftone-light p-6 md:p-12" data-testid="leaderboard-page">
      <div className="flex items-center justify-between mb-8">
        <Link to="/lobby" className="btn-pow bg-white text-black" data-testid="leaderboard-back-button">
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

        {/* Season banner */}
        {season && (
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
            <div className="bg-white px-5 py-4 flex flex-wrap items-end gap-3">
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
          {loading ? (
            <div className="p-8 font-display text-3xl text-center">LOADING...</div>
          ) : rows.length === 0 ? (
            <div className="p-8 font-anton text-center uppercase text-neutral-500">No frags yet. Be the first.</div>
          ) : (
            rows.map((r, i) => {
              const tier = Math.max(0, Math.min(7, r.rank_tier ?? 0));
              const color = RANK_COLORS[tier];
              return (
                <div
                  key={r.username + i}
                  className={`grid grid-cols-12 px-4 py-3 border-t-2 border-black font-body items-center ${
                    i === 0 ? "bg-[#FFD700]" : i === 1 ? "bg-[#FFE680]" : i === 2 ? "bg-[#FFF0AC]" : "bg-white"
                  }`}
                  data-testid={`leaderboard-row-${i}`}
                >
                  <div className="col-span-1 font-display text-2xl">{i + 1}</div>
                  <div className="col-span-7 font-anton uppercase text-lg flex items-center gap-2">
                    <span>{r.username}</span>
                    {/* Live status chip — IN MATCH (red, clickable to spectate)
                        > ONLINE (green dot) > nothing for offline rows.
                        Mirrors the FriendsModal status chip pattern. */}
                    {r.in_match ? (
                      <button
                        type="button"
                        onClick={() => nav(`/spectate/${encodeURIComponent(r.username)}`)}
                        className="text-[10px] font-anton uppercase tracking-widest px-1.5 py-0.5 bg-[#E62429] text-white border-2 border-black flex items-center gap-1 hover:translate-y-[-1px] transition-transform"
                        data-testid={`leaderboard-spectate-${i}`}
                        title={`Spectate ${r.username}`}
                      >
                        <Eye size={11} strokeWidth={3} />
                        SPECTATE
                      </button>
                    ) : r.online ? (
                      <span
                        className="text-[10px] font-anton uppercase tracking-widest text-[#06A35F]"
                        data-testid={`leaderboard-status-${i}`}
                        data-status="online"
                      >
                        ● ONLINE
                      </span>
                    ) : null}
                  </div>
                  <div className="col-span-2 text-right">
                    <span
                      className="font-anton uppercase text-sm px-2 py-1"
                      style={{ background: color, color: tier === 7 ? "#FFD700" : "#0A0A0A" }}
                      data-testid={`leaderboard-rank-${i}`}
                    >
                      {r.rank_name || "BRONZE"}
                    </span>
                  </div>
                  <div className="col-span-2 text-right font-display text-2xl">{r.rank_points ?? 0}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
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
