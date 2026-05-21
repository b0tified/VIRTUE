import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ArrowLeft, Crown } from "lucide-react";

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

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
      </div>
    </div>
  );
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
