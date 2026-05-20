import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import audioBus from "@/game/audio";
import api from "@/api";
import { Trophy, User, LogOut, Play, Volume2, VolumeX, Mouse, Users, Award, X, Loader2, Star } from "lucide-react";

const SENS_KEY = "virtue.mouseSensitivity";

const LOBBY_BG = "https://static.prod-images.emergentagent.com/jobs/956e5f81-3c5a-4b45-a2da-bf26ea4fc4d1/images/3fd8a6f43a33db82e29a81462fb7d356c6de26372ea5ffabff63ed8db4358583.png";

export default function Lobby() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [muted, setMuted] = useState(false);
  const [sensitivity, setSensitivity] = useState(() => {
    const v = parseFloat(localStorage.getItem(SENS_KEY));
    return Number.isFinite(v) && v > 0 ? v : 1.0;
  });
  const [showTiers, setShowTiers] = useState(false);
  const [counts, setCounts] = useState({ casual: 0, ranked: 0 });
  const [queueState, setQueueState] = useState(null); // null | {tier, tier_name, position, tier_size, matched, match_id}
  const queueTimerRef = useState({ id: null })[0];

  const joinRankedQueue = async () => {
    try {
      const { data } = await api.post("/queue/ranked");
      setQueueState(data);
      const id = setInterval(async () => {
        try {
          const { data: s } = await api.get("/queue/ranked");
          setQueueState(s);
          if (s.matched) {
            clearInterval(queueTimerRef.id);
            queueTimerRef.id = null;
            try { await api.post("/queue/ranked/ack"); } catch {}
            nav("/play?mode=ranked");
          }
        } catch {}
      }, 1000);
      queueTimerRef.id = id;
    } catch (e) {
      alert("Failed to join queue: " + (e.response?.data?.detail || e.message));
    }
  };

  const cancelRankedQueue = async () => {
    if (queueTimerRef.id) {
      clearInterval(queueTimerRef.id);
      queueTimerRef.id = null;
    }
    try { await api.delete("/queue/ranked"); } catch {}
    setQueueState(null);
  };

  useEffect(() => {
    return () => {
      if (queueTimerRef.id) clearInterval(queueTimerRef.id);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = user?.stats || { kills: 0, deaths: 0, matches: 0, wins: 0 };
  const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills);

  useEffect(() => {
    localStorage.setItem(SENS_KEY, String(sensitivity));
  }, [sensitivity]);

  // Poll active player counts every 3s
  useEffect(() => {
    let alive = true;
    const fetchCounts = async () => {
      try {
        const { data } = await api.get("/");
        if (!alive) return;
        setCounts({ casual: data.casual_players || 0, ranked: data.ranked_players || 0 });
      } catch {}
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Start lobby music on first user interaction (browser autoplay rules)
  useEffect(() => {
    const onFirstInteract = () => {
      audioBus.startLobbyMusic();
      document.removeEventListener("click", onFirstInteract);
      document.removeEventListener("keydown", onFirstInteract);
    };
    document.addEventListener("click", onFirstInteract);
    document.addEventListener("keydown", onFirstInteract);
    return () => {
      audioBus.stopLobbyMusic();
      document.removeEventListener("click", onFirstInteract);
      document.removeEventListener("keydown", onFirstInteract);
    };
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audioBus.setMuted(next);
  };

  const doLogout = async () => {
    audioBus.stopLobbyMusic();
    await logout();
    nav("/login");
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black" data-testid="lobby-page">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-80"
        style={{ backgroundImage: `url(${LOBBY_BG})` }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-black/40" />

      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5">
        <div className="font-display text-3xl md:text-4xl text-[#FFD700] text-pow-shadow">
          VIR<span className="text-[#E62429]">TUE</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hud-panel" data-testid="lobby-user-badge">
            <div><span className="text-[#FFD700]">{user?.username}</span> <span className="opacity-70 text-sm">· K/D {kd}</span></div>
          </div>
          <button
            onClick={toggleMute}
            className="btn-pow bg-[#FFD700] text-black"
            data-testid="lobby-mute-toggle"
            title={muted ? "Unmute" : "Mute"}
          >
            <span className="flex items-center gap-2">{muted ? <VolumeX size={18} strokeWidth={3} /> : <Volume2 size={18} strokeWidth={3} />}</span>
          </button>
          <button onClick={doLogout} className="btn-pow bg-white text-black" data-testid="lobby-logout-button">
            <span className="flex items-center gap-2"><LogOut size={18} strokeWidth={3} /> LOGOUT</span>
          </button>
        </div>
      </header>

      <main className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 px-6 md:px-12 lg:px-20 mt-4">
        <div className="lg:col-span-7">
          <div className="inline-block bg-[#FFD700] border-pow shadow-pow-sm px-3 py-1 -rotate-2 mb-3">
            <span className="font-anton uppercase tracking-widest">Free-For-All · Online</span>
          </div>
          <h1 className="font-display text-6xl md:text-7xl uppercase text-white text-pow-shadow-lg">
            READY UP, <span className="text-[#E62429]">{user?.username}</span>!
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="rank-badge-row">
            <RankBadge tier={user?.rank_tier ?? 0} name={user?.rank_name || "BRONZE"} points={user?.rank_points || 0} />
            {user?.in_placements && (
              <div
                className="border-pow shadow-pow-sm flex items-center bg-[#9B59B6] text-white"
                data-testid="placement-streak-badge"
                title="Placement streak: 2x RP gains, no losses for your first 5 ranked matches."
              >
                <div className="px-3 py-2 flex items-center gap-2">
                  <Star size={14} strokeWidth={3} className="text-[#FFD700]" />
                  <span className="font-anton uppercase text-xs tracking-widest">PLACEMENTS</span>
                  <span className="font-display text-xl leading-none">
                    {user?.placement_matches_played ?? 0}/{user?.placement_matches_total ?? 5}
                  </span>
                </div>
                <div className="bg-[#FFD700] text-black font-anton uppercase tracking-widest text-xs px-2 py-2">
                  2x RP
                </div>
              </div>
            )}
            <button
              onClick={() => setShowTiers(true)}
              className="btn-pow bg-white text-black"
              data-testid="show-tiers-button"
            >
              <span className="flex items-center gap-2"><Award size={16} strokeWidth={3} /> SHOW TIERS</span>
            </button>
          </div>

          <div className="mt-8 space-y-4 max-w-md">
            <Link to="/play?mode=casual" className="btn-pow bg-[#E62429] text-white w-full text-3xl" data-testid="lobby-play-button">
              <span className="flex items-center gap-3"><Play size={28} strokeWidth={3} /> PLAY MATCH</span>
            </Link>
            <button
              onClick={queueState ? undefined : joinRankedQueue}
              disabled={!!queueState}
              className="btn-pow bg-[#0055FF] text-white w-full text-3xl disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="lobby-ranked-button"
            >
              <span className="flex items-center gap-3">
                {queueState && !queueState.matched ? <Loader2 size={26} strokeWidth={3} className="animate-spin" /> : <Trophy size={26} strokeWidth={3} />}
                {queueState ? (queueState.matched ? "MATCH FOUND" : "IN QUEUE...") : "RANKED MATCH"}
              </span>
            </button>
            <Link to="/leaderboard" className="btn-pow bg-[#FFD700] text-black w-full" data-testid="lobby-leaderboard-button">
              <span className="flex items-center gap-3"><Trophy size={22} strokeWidth={3} /> LEADERBOARD</span>
            </Link>
            <Link to="/profile" className="btn-pow bg-white text-black w-full" data-testid="lobby-profile-button">
              <span className="flex items-center gap-3"><User size={22} strokeWidth={3} /> PROFILE</span>
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap gap-3" data-testid="active-players-row">
            <div className="border-pow shadow-pow-sm px-4 py-2 -rotate-1" style={{ background: "#E62429", color: "#fff" }} data-testid="active-casual">
              <div className="font-anton text-xs uppercase tracking-widest opacity-90 flex items-center gap-1">
                <Users size={12} strokeWidth={3} /> Casual online
              </div>
              <div className="font-display text-3xl">{counts.casual}</div>
            </div>
            <div className="border-pow shadow-pow-sm px-4 py-2 rotate-1" style={{ background: "#0055FF", color: "#fff" }} data-testid="active-ranked">
              <div className="font-anton text-xs uppercase tracking-widest opacity-90 flex items-center gap-1">
                <Users size={12} strokeWidth={3} /> Ranked online
              </div>
              <div className="font-display text-3xl">{counts.ranked}</div>
            </div>
          </div>

          {/* Stat strip */}
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
            <StatChip label="KILLS" value={stats.kills} color="#E62429" testid="stat-kills" />
            <StatChip label="DEATHS" value={stats.deaths} color="#0055FF" testid="stat-deaths" />
            <StatChip label="MATCHES" value={stats.matches} color="#FFD700" textColor="#0A0A0A" testid="stat-matches" />
            <StatChip label="K/D" value={kd} color="#0A0A0A" testid="stat-kd" />
          </div>
        </div>

        <div className="lg:col-span-5 relative hidden lg:flex items-center justify-center">
          {/* Match info panel removed per request */}
        </div>
      </main>

      <div className="relative z-10 px-6 md:px-12 lg:px-20 mt-12 pb-12 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl">
        <div className="card-pow p-5">
          <div className="font-anton uppercase tracking-widest text-sm text-neutral-500">Controls</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2">
            <ControlKey k="WASD" d="Move" />
            <ControlKey k="MOUSE" d="Aim" />
            <ControlKey k="CLICK" d="Shoot" />
            <ControlKey k="SHIFT" d="Sprint" />
            <ControlKey k="TAB" d="Score" />
          </div>
        </div>
        <div className="card-pow p-5" data-testid="settings-card">
          <div className="font-anton uppercase tracking-widest text-sm text-neutral-500 flex items-center gap-2">
            <Mouse size={16} strokeWidth={3} /> Mouse Sensitivity
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="font-anton text-xs">0.3</span>
            <input
              type="range"
              min="0.3"
              max="3.0"
              step="0.05"
              value={sensitivity}
              onChange={(e) => setSensitivity(parseFloat(e.target.value))}
              className="flex-1 accent-[#E62429]"
              data-testid="sensitivity-slider"
            />
            <span className="font-anton text-xs">3.0</span>
            <div className="border-pow-thin bg-[#FFD700] px-3 py-1 font-anton text-lg min-w-[60px] text-center" data-testid="sensitivity-value">
              {sensitivity.toFixed(2)}x
            </div>
          </div>
          <p className="font-body text-xs text-neutral-500 mt-2">Saved automatically. Applies on next match.</p>
        </div>
      </div>

      {/* Tiers modal */}
      {showTiers && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-6" data-testid="tiers-modal" onClick={() => setShowTiers(false)}>
          <div className="card-pow p-0 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="bg-black text-white px-6 py-3 flex items-center justify-between">
              <div className="font-display text-3xl text-[#FFD700]">RANK TIERS</div>
              <button onClick={() => setShowTiers(false)} className="font-anton" data-testid="tiers-close">
                <X size={20} strokeWidth={3} />
              </button>
            </div>
            {RANK_TIERS.map((t, i) => (
              <div key={t.name} className="grid grid-cols-12 border-t-2 border-black items-center" data-testid={`tier-row-${i}`}>
                <div className="col-span-1 font-display text-2xl text-center bg-white py-3">{i + 1}</div>
                <div className="col-span-6 font-display text-2xl py-3 px-4" style={{ background: t.color, color: t.name === "APEX" ? "#FFD700" : "#0A0A0A" }}>
                  {t.name}
                </div>
                <div className="col-span-5 font-anton uppercase text-sm py-3 px-4 bg-white">
                  {t.min} RP {RANK_TIERS[i + 1] ? `→ ${RANK_TIERS[i + 1].min - 1} RP` : "+"}
                </div>
              </div>
            ))}
            <div className="border-t-4 border-black bg-[#FFD700] px-4 py-3 font-anton uppercase text-sm">
              +30 RP (1st) · +15 (2nd) · +5 (3rd) · -10 (lower)
            </div>
          </div>
        </div>
      )}

      {/* Ranked queue toast (bottom-right, non-blocking — players can roam the lobby) */}
      {queueState && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm" data-testid="queue-toast">
          <div className="card-pow p-0 overflow-hidden">
            <div
              className="px-4 py-2 flex items-center gap-2 text-white"
              style={{ background: queueState.matched ? "#06A35F" : "#0055FF" }}
            >
              {queueState.matched ? (
                <Trophy size={18} strokeWidth={3} />
              ) : (
                <Loader2 size={18} strokeWidth={3} className="animate-spin" />
              )}
              <span className="font-anton uppercase tracking-widest text-sm flex-1" data-testid="queue-toast-title">
                {queueState.matched ? "Match Found!" : "Queued — Searching"}
              </span>
              {!queueState.matched && (
                <button onClick={cancelRankedQueue} className="font-anton hover:opacity-80" data-testid="queue-cancel" title="Leave queue">
                  <X size={16} strokeWidth={3} />
                </button>
              )}
            </div>
            <div className="px-4 py-3 bg-white">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="border-pow-thin font-anton uppercase tracking-widest text-xs px-2 py-0.5"
                  style={{ background: RANK_COLORS[queueState.tier ?? 0], color: queueState.tier === 7 ? "#FFD700" : "#0A0A0A" }}
                >
                  {queueState.tier_name || "BRONZE"}
                </div>
                {!queueState.matched && (
                  <div className="font-anton uppercase text-xs opacity-70" data-testid="queue-count">
                    {queueState.tier_size || 1} / 2 same-tier
                  </div>
                )}
              </div>
              <p className="font-body text-xs text-neutral-600">
                {queueState.matched
                  ? "Entering arena..."
                  : "Roam the lobby — we'll auto-join when an opponent is ready."}
              </p>
              {queueState.matched && (
                <div className="mt-2 font-anton text-xs text-[#E62429]">Match ID: {queueState.match_id}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, color, textColor = "#fff", testid }) {
  return (
    <div className="border-pow shadow-pow-sm p-3" style={{ background: color, color: textColor }} data-testid={testid}>
      <div className="font-anton uppercase tracking-widest text-xs opacity-80">{label}</div>
      <div className="font-display text-3xl mt-1">{value}</div>
    </div>
  );
}

const RANK_TIERS = [
  { name: "BRONZE", min: 0, color: "#CD7F32" },
  { name: "SILVER", min: 100, color: "#C0C0C0" },
  { name: "GOLD", min: 250, color: "#FFD700" },
  { name: "PLATINUM", min: 500, color: "#5BC0EB" },
  { name: "DIAMOND", min: 800, color: "#9D4EDD" },
  { name: "MASTER", min: 1200, color: "#E63946" },
  { name: "GRANDMASTER", min: 1700, color: "#06D6A0" },
  { name: "APEX", min: 2300, color: "#000000" },
];

const RANK_COLORS = RANK_TIERS.map(t => t.color);

function RankBadge({ tier, name, points }) {
  const color = RANK_COLORS[Math.max(0, Math.min(7, tier))];
  const textColor = tier === 7 ? "#FFD700" : "#0A0A0A";
  return (
    <div className="border-pow shadow-pow-sm flex items-center" data-testid="rank-badge">
      <div className="font-display px-4 py-2 text-2xl uppercase" style={{ background: color, color: textColor }}>
        {name}
      </div>
      <div className="bg-white px-3 py-2 font-anton uppercase tracking-widest text-sm">
        {points} <span className="opacity-60">RP</span>
      </div>
    </div>
  );
}

function ControlKey({ k, d }) {
  return (
    <div className="border-pow-thin p-2">
      <div className="font-anton uppercase tracking-widest text-base">{k}</div>
      <div className="font-body text-xs text-neutral-500 uppercase">{d}</div>
    </div>
  );
}
