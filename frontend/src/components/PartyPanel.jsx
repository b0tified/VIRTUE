// Persistent party panel — shown in the lobby when the user is in a party.
// Polls /api/party/me every 5s. Leader can Start Quick Match. Members can Leave.
// All members auto-navigate to the party room when match_starting=true.
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Crown, Play, LogOut, X } from "lucide-react";
import api from "@/api";
import { Avatar } from "@/components/PlayerCard";

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

export default function PartyPanel({ party, myId, refresh, className = "" }) {
  const nav = useNavigate();
  const startedRef = useRef(false);

  useEffect(() => {
    if (party?.match_starting && !startedRef.current) {
      startedRef.current = true;
      nav(`/play?mode=party&party_id=${party.party_id}`);
    }
    if (!party?.match_starting) startedRef.current = false;
  }, [party?.match_starting, party?.party_id, nav]);

  const leave = useCallback(async () => {
    try { await api.post("/party/leave"); } catch {}
    refresh?.();
  }, [refresh]);

  const start = useCallback(async () => {
    try {
      const { data } = await api.post("/party/start");
      nav(`/play?mode=party&party_id=${data.party_id}`);
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
    }
  }, [nav]);

  if (!party || !party.party_id) return null;
  const isLeader = party.leader_id === myId;

  return (
    <div className={`card-pow p-0 overflow-hidden bg-white ${className}`} data-testid="party-panel">
      <div className="bg-[#0055FF] text-white px-3 py-2 flex items-center gap-2">
        <Users size={16} strokeWidth={3} />
        <span className="font-anton uppercase tracking-widest text-sm flex-1">PARTY · {party.members.length}/{party.max_size}</span>
        <button onClick={leave} className="font-anton hover:opacity-80" title="Leave party" data-testid="party-leave-button">
          <LogOut size={14} strokeWidth={3} />
        </button>
      </div>
      <div className="divide-y-2 divide-black/10">
        {party.members.map((m, i) => {
          const isLeaderRow = m.id === party.leader_id;
          const rankColor = RANK_COLORS[Math.max(0, Math.min(7, m.rank_tier ?? 0))];
          return (
            <div key={m.id} className="px-3 py-2 flex items-center gap-2" data-testid={`party-member-${i}`}>
              <Avatar idx={m.avatar} size={32} online={m.online} testid={`party-member-avatar-${i}`} />
              <div className="flex-1 min-w-0">
                <div className="font-anton uppercase text-sm truncate flex items-center gap-1">
                  {m.username}
                  {isLeaderRow && <Crown size={12} strokeWidth={3} className="text-[#FFD700]" />}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-anton uppercase text-[9px] px-1 border border-black" style={{ background: rankColor, color: (m.rank_tier ?? 0) === 7 ? "#FFD700" : "#0A0A0A" }}>
                    {m.rank_name}
                  </span>
                  {m.in_match && (
                    <span className="font-anton uppercase text-[9px] text-[#E62429]">IN MATCH</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {isLeader && (
        <div className="border-t-2 border-black p-2">
          <button onClick={start} className="btn-pow bg-[#E62429] text-white w-full [&]:py-1.5 [&]:text-sm" data-testid="party-start-button">
            <span className="flex items-center justify-center gap-2"><Play size={14} strokeWidth={3} /> START QUICK MATCH</span>
          </button>
        </div>
      )}
      {!isLeader && (
        <div className="border-t-2 border-black px-3 py-2 text-center font-anton uppercase text-xs text-neutral-500" data-testid="party-waiting">
          Waiting for leader...
        </div>
      )}
    </div>
  );
}

// Re-export X for the unused-import linter happiness if needed elsewhere.
// eslint-disable-next-line no-unused-vars
const _X = X;
