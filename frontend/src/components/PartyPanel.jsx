/* Persistent party panel — shown in the lobby when the user is in a party.
   Polls /api/party/me every 5s via the parent. Leader can:
     - Start a Quick Match (sends every party-mate into the party room)
     - Queue Ranked together (whole party enters the ranked queue at the
       max tier across all members)
   Members can:
     - Leave
     - See the queue state + the ranked-anchor tier
   All members auto-navigate to the party room when `match_starting=true`,
   and to the ranked room when the queue resolves (via QueueContext).
*/
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Crown, Play, LogOut, Shield, Loader2, X } from "lucide-react";
import api from "@/api";
import { Avatar } from "@/components/PlayerCard";
import { divisionRoman } from "@/game/rankIcons";
import { useQueue } from "@/context/QueueContext";
import { navigateToMatch } from "@/lib/navigateToMatch";

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

export default function PartyPanel({ party, myId, refresh, className = "" }) {
  const nav = useNavigate();
  const startedRef = useRef(false);
  const { queueState, waitSec, joinRanked, cancelRanked } = useQueue();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (party?.match_starting && !startedRef.current) {
      startedRef.current = true;
      navigateToMatch(nav, `/play?mode=party&party_id=${party.party_id}`, { mode: "party" });
    }
    if (!party?.match_starting) startedRef.current = false;
  }, [party?.match_starting, party?.party_id, nav]);

  const leave = useCallback(async () => {
    try { await api.post("/party/leave"); } catch {}
    refresh?.();
  }, [refresh]);

  const startQuick = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const { data } = await api.post("/party/start");
      navigateToMatch(nav, `/play?mode=party&party_id=${data.party_id}`, { mode: "party" });
    } catch (e) {
      setErr(e.response?.data?.detail || "Couldn't start party match.");
    } finally {
      setBusy(false);
    }
  }, [nav]);

  const queueRanked = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await joinRanked();
    setBusy(false);
    if (r?.error) setErr(r.error);
  }, [joinRanked]);

  if (!party || !party.party_id) return null;
  const isLeader = party.leader_id === myId;
  const inRankedQueue = !!queueState && !queueState.matched;
  const tier = party.ranked_tier_name || "BRONZE";

  return (
    <div className={`card-pow p-0 overflow-hidden bg-white ${className}`} data-testid="party-panel">
      {/* Header bar — gradient + bold party identifier */}
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{
          background: "linear-gradient(135deg, #0055FF 0%, #003ab5 100%)",
          color: "#fff",
        }}
      >
        <div className="w-7 h-7 flex items-center justify-center bg-[#FFD700] text-black border-2 border-white">
          <Users size={14} strokeWidth={3} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-anton uppercase tracking-widest text-xs leading-tight opacity-80">PARTY</div>
          <div className="font-display text-lg leading-none">
            {party.members.length} <span className="text-white/60">/ {party.max_size}</span>
          </div>
        </div>
        <button
          onClick={leave}
          className="font-anton text-[10px] uppercase tracking-widest px-2 py-1 border-2 border-white hover:bg-white hover:text-[#0055FF] transition-colors flex items-center gap-1"
          title="Leave party"
          data-testid="party-leave-button"
        >
          <LogOut size={11} strokeWidth={3} />
          LEAVE
        </button>
      </div>
      {/* Member rows */}
      <div className="bg-neutral-50">
        {party.members.map((m, i) => {
          const isLeaderRow = m.id === party.leader_id;
          const tierIdx = Math.max(0, Math.min(7, m.rank_tier ?? 0));
          const rankColor = RANK_COLORS[tierIdx];
          const isMe = m.id === myId;
          // Highlight the row whose rank is anchoring the ranked queue
          // so it's obvious which member is dragging the tier up.
          const isAnchor = party.ranked_anchored_by === m.username;
          return (
            <div
              key={m.id}
              className={`px-3 py-2 flex items-center gap-2 border-t border-black/10 first:border-t-0 ${
                isMe ? "bg-[#FFD70022]" : ""
              } ${isAnchor ? "border-l-4 border-l-[#FFD700]" : ""}`}
              data-testid={`party-member-${i}`}
              data-anchor={isAnchor ? "true" : "false"}
            >
              <Avatar idx={m.avatar} size={32} online={m.online} testid={`party-member-avatar-${i}`} />
              <div className="flex-1 min-w-0">
                <div className="font-anton uppercase text-sm truncate flex items-center gap-1">
                  {m.username}
                  {isLeaderRow && <Crown size={12} strokeWidth={3} className="text-[#FFD700]" />}
                  {isMe && <span className="text-[9px] text-neutral-500">(YOU)</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="font-anton uppercase text-[9px] px-1 border border-black"
                    style={{ background: rankColor, color: tierIdx === 7 ? "#FFD700" : "#0A0A0A" }}
                  >
                    {m.rank_name}{divisionRoman(m.rank_division) ? ` ${divisionRoman(m.rank_division)}` : ""}
                  </span>
                  <span className="font-anton uppercase text-[9px] text-neutral-500">{m.rank_points} RP</span>
                  {m.in_match ? (
                    <span className="font-anton uppercase text-[9px] text-[#E62429]">IN MATCH</span>
                  ) : isAnchor ? (
                    <span className="font-anton uppercase text-[9px] text-[#a36a00]">TOP RANK</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Footer — actions */}
      <div className="border-t-2 border-black p-2 flex flex-col gap-1.5 bg-white">
        {err && (
          <div className="px-2 py-1 text-[10px] font-anton uppercase tracking-widest bg-[#FFE4E4] text-[#7a1115] border border-[#E62429]" data-testid="party-error">
            {err}
          </div>
        )}
        {isLeader ? (
          <>
            <button
              onClick={startQuick}
              disabled={busy || inRankedQueue}
              className="btn-pow bg-[#E62429] text-white w-full [&]:py-1.5 [&]:text-sm"
              data-testid="party-start-button"
            >
              <span className="flex items-center justify-center gap-2">
                <Play size={14} strokeWidth={3} /> START QUICK MATCH
              </span>
            </button>
            {/* RANKED queue — the headline feature: parties queue together
                at the highest member's tier. Backend handles eligibility
                + tier resolution; this button just kicks the queue. */}
            {!inRankedQueue ? (
              <button
                onClick={queueRanked}
                disabled={busy}
                className="btn-pow bg-[#0055FF] text-white w-full [&]:py-1.5 [&]:text-sm"
                data-testid="party-ranked-button"
                title={`Queues whole party at ${tier}`}
              >
                <span className="flex items-center justify-center gap-2">
                  <Shield size={14} strokeWidth={3} /> RANKED @ {tier}
                </span>
              </button>
            ) : (
              <button
                onClick={cancelRanked}
                className="btn-pow bg-neutral-700 text-white w-full [&]:py-1.5 [&]:text-sm"
                data-testid="party-ranked-cancel"
              >
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} strokeWidth={3} className="animate-spin" />
                  IN QUEUE · {waitSec}s · CANCEL
                </span>
              </button>
            )}
          </>
        ) : (
          // Non-leader view — show queue state if active, else "Waiting…"
          inRankedQueue ? (
            <div
              className="px-2 py-2 text-center font-anton uppercase text-xs text-[#0055FF] flex items-center justify-center gap-2"
              data-testid="party-member-queue-info"
            >
              <Loader2 size={12} strokeWidth={3} className="animate-spin" />
              IN RANKED QUEUE @ {tier} · {waitSec}s
            </div>
          ) : (
            <div
              className="px-3 py-2 text-center font-anton uppercase text-xs text-neutral-500"
              data-testid="party-waiting"
            >
              Waiting for leader...
            </div>
          )
        )}
      </div>
    </div>
  );
}

// Keep the unused X import quiet for the linter without breaking imports.
// eslint-disable-next-line no-unused-vars
const _X = X;
