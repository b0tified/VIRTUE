import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import audioBus from "@/game/audio";
import { Trophy, User, LogOut, Play, Volume2, VolumeX, Mouse } from "lucide-react";

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

  const stats = user?.stats || { kills: 0, deaths: 0, matches: 0, wins: 0 };
  const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills);

  useEffect(() => {
    localStorage.setItem(SENS_KEY, String(sensitivity));
  }, [sensitivity]);

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
          </div>

          <div className="mt-8 space-y-4 max-w-md">
            <Link to="/play?mode=casual" className="btn-pow bg-[#E62429] text-white w-full text-3xl" data-testid="lobby-play-button">
              <span className="flex items-center gap-3"><Play size={28} strokeWidth={3} /> PLAY MATCH</span>
            </Link>
            <Link to="/play?mode=ranked" className="btn-pow bg-[#0055FF] text-white w-full text-3xl" data-testid="lobby-ranked-button">
              <span className="flex items-center gap-3"><Trophy size={26} strokeWidth={3} /> RANKED MATCH</span>
            </Link>
            <Link to="/leaderboard" className="btn-pow bg-[#FFD700] text-black w-full" data-testid="lobby-leaderboard-button">
              <span className="flex items-center gap-3"><Trophy size={22} strokeWidth={3} /> LEADERBOARD</span>
            </Link>
            <Link to="/profile" className="btn-pow bg-white text-black w-full" data-testid="lobby-profile-button">
              <span className="flex items-center gap-3"><User size={22} strokeWidth={3} /> PROFILE</span>
            </Link>
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
          <div className="card-pow p-8 w-full rotate-2" style={{ background: "#0055FF", color: "#fff" }}>
            <div className="font-anton uppercase tracking-widest text-sm opacity-80">Match Info</div>
            <div className="font-display text-5xl uppercase text-pow-shadow mt-2">FREE-FOR-ALL</div>
            <div className="mt-4 grid grid-cols-2 gap-3 font-anton uppercase">
              <div className="border-pow-thin bg-white text-black p-3">
                <div className="text-xs opacity-70">Mode</div>
                <div className="text-xl">Deathmatch</div>
              </div>
              <div className="border-pow-thin bg-white text-black p-3">
                <div className="text-xs opacity-70">Arena</div>
                <div className="text-xl">Comic Block</div>
              </div>
              <div className="border-pow-thin bg-[#FFD700] text-black p-3">
                <div className="text-xs opacity-70">Tickrate</div>
                <div className="text-xl">20 Hz</div>
              </div>
              <div className="border-pow-thin bg-[#E62429] text-white p-3">
                <div className="text-xs opacity-80">Respawn</div>
                <div className="text-xl">3 sec</div>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-4 -right-4 bg-[#FFD700] border-pow shadow-pow px-6 py-2 rotate-3">
            <span className="font-display text-3xl uppercase">POW!</span>
          </div>
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

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

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
