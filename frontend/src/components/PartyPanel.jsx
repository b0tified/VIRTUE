/* Persistent party panel — shown in the lobby when the user is in a party.
   Polls /api/party/me every 5s via the parent. Leader can:
     - Queue Casual (whole party enters the shared casual queue)
     - Queue Ranked together (whole party enters the ranked queue at the
       max tier across all members)
   Members can:
     - Leave
     - See the queue state + the ranked-anchor tier
   All members auto-navigate to the shared match room when either queue
   resolves (handled by QueueContext's casual/ranked pollers).
*/
import { useCallback, useEffect, useState } from "react";
import { Users, Crown, Play, LogOut, Shield, Loader2, X, Bot, Users2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "@/api";
import { Avatar } from "@/components/PlayerCard";
import { divisionRoman } from "@/game/rankIcons";
import { useQueue } from "@/context/QueueContext";

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];

export default function PartyPanel({ party, myId, refresh, className = "" }) {
  const navigate = useNavigate();
  const {
    queueState, waitSec, joinRanked, cancelRanked,
    casualQueueState, casualWaitSec, joinCasual, cancelCasual,
  } = useQueue();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Custom Lobby settings — persisted only on the leader's client
  // until they hit Start. Members receive the leader's final choice
  // via the /party/me poll and use it purely to display the pending
  // state (they don't have their own toggle). Default: bots on so
  // solo party-leaders still get a filled lobby.
  const [customBots, setCustomBots] = useState(true);

  // Members: when the leader flips `match_starting`, auto-navigate
  // into the private party room. The leader triggers the same nav
  // manually in `startCustomLobby` so all seats land on the same
  // Game.jsx URL within a single 5s poll window.
  //
  // Route is `/play` (not `/game`) — MUST also stamp
  // `state.fromLobby: true` so the MatchEntryGuard doesn't bounce us
  // back to /lobby with a white flash. This was the "click custom
  // game and screen flashes white" bug the user reported.
  useEffect(() => {
    if (!party?.party_id) return;
    if (!party.match_starting) return;
    if (party.leader_id === myId) return;   // leader nav'd themselves
    navigate(
      `/play?mode=party&party_id=${party.party_id}${party.tdm ? "&tdm=1" : ""}`,
      { replace: true, state: { fromLobby: true } },
    );
  }, [party?.match_starting, party?.party_id, party?.leader_id, party?.tdm, myId, navigate]);

  const leave = useCallback(async () => {
    try { await api.post("/party/leave"); } catch {}
    refresh?.();
  }, [refresh]);

  const startQuick = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await joinCasual();
      if (r && !r.ok) {
        setErr(r.error || "Couldn't join Casual queue.");
      }
    } catch (e) {
      setErr(e.response?.data?.detail || "Couldn't join Casual queue.");
    } finally {
      setBusy(false);
    }
  }, [joinCasual]);

  const cancelQuick = useCallback(async () => {
    setBusy(true);
    try { await cancelCasual(); } finally { setBusy(false); }
  }, [cancelCasual]);

  const queueRanked = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await joinRanked();
    setBusy(false);
    if (r?.error) setErr(r.error);
  }, [joinRanked]);

  // "Custom Lobby" flow — leader-only. Kicks the party into a private
  // party room (no matchmaking with strangers). The `customBots`
  // toggle lets the leader pick whether the room is filled with bots
  // or is human-only, per user request. All party members auto-
  // navigate via the useEffect above; the leader navigates here
  // immediately so no one gets left behind if their poll is slow.
  const startCustomLobby = useCallback(async () => {
    if (!party?.party_id) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/party/start", { bots_enabled: customBots, tdm: false });
      // MUST be `/play` (not `/game`) + state.fromLobby so the
      // MatchEntryGuard around the route lets us in. Without either
      // piece the router either has no match (white flash) or the
      // guard redirects back to /lobby (also visible as a flash).
      navigate(
        `/play?mode=party&party_id=${party.party_id}`,
        { replace: true, state: { fromLobby: true } },
      );
    } catch (e) {
      setErr(e.response?.data?.detail || "Couldn't start custom lobby.");
    } finally {
      setBusy(false);
    }
  }, [party?.party_id, customBots, navigate]);

  if (!party || !party.party_id) return null;
  const isLeader = party.leader_id === myId;
  const inRankedQueue = !!queueState && !queueState.matched;
  const inCasualQueue = !!(casualQueueState && (casualQueueState.in_queue || casualQueueState.matched));
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
          aria-label="Leave party"
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
          const tierIdx = Math.max(0, Math.min(8, m.rank_tier ?? 0));
          const rankColor = (m.rank_tier ?? 0) < 0 ? "#9CA3AF" : RANK_COLORS[tierIdx];
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
                    style={{ background: rankColor, color: tierIdx === 8 ? "#FFD700" : "#0A0A0A" }}
                  >
                    {m.rank_name}{divisionRoman(m.rank_division) ? ` ${divisionRoman(m.rank_division)}` : ""}
                  </span>
                  {(m.rank_tier ?? 0) >= 0 && <span className="font-anton uppercase text-[9px] text-neutral-500">{m.rank_points} RP</span>}
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
            {!inCasualQueue ? (
              <button
                onClick={startQuick}
                disabled={busy || inRankedQueue}
                className="btn-pow bg-[#E62429] text-white w-full [&]:py-1.5 [&]:text-sm"
                data-testid="party-start-button"
              >
                <span className="flex items-center justify-center gap-2">
                  <Play size={14} strokeWidth={3} /> CASUAL
                </span>
              </button>
            ) : (
              <button
                onClick={cancelQuick}
                disabled={busy}
                className="btn-pow bg-neutral-700 text-white w-full [&]:py-1.5 [&]:text-sm"
                data-testid="party-quick-cancel"
              >
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} strokeWidth={3} className="animate-spin" />
                  QUICK QUEUE · {casualWaitSec}s · CANCEL
                </span>
              </button>
            )}
            {/* RANKED queue — the headline feature: parties queue together
                at the highest member's tier. Backend handles eligibility
                + tier resolution; this button just kicks the queue. */}
            {!inRankedQueue ? (
              <button
                onClick={queueRanked}
                disabled={busy || inCasualQueue}
                className="btn-pow bg-[#0055FF] text-white w-full [&]:py-1.5 [&]:text-sm"
                data-testid="party-ranked-button"
                aria-label={`Queues whole party at ${tier}`}
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
            {/* CUSTOM LOBBY — the leader spins up a private party room
                (no matchmaking with strangers). The bot toggle sits
                RIGHT next to the button per user request so it reads
                as one control. Disabled while any queue is active
                so we don't fight the matchmaker. */}
            <div className="flex items-stretch gap-1.5">
              <button
                onClick={startCustomLobby}
                disabled={busy || inRankedQueue || inCasualQueue}
                className="btn-pow bg-[#9D4EDD] text-white flex-1 [&]:py-1.5 [&]:text-sm"
                data-testid="party-custom-lobby-button"
                aria-label="Start a private lobby with just your party (and optionally bots)"
              >
                <span className="flex items-center justify-center gap-2">
                  <Users2 size={14} strokeWidth={3} /> CUSTOM LOBBY
                </span>
              </button>
              <button
                onClick={() => setCustomBots((v) => !v)}
                disabled={busy}
                aria-pressed={customBots}
                className={
                  "btn-pow [&]:px-2 [&]:py-1.5 [&]:text-sm border-2 border-black flex items-center gap-1 " +
                  (customBots ? "bg-[#06A35F] text-white" : "bg-white text-black")
                }
                data-testid="party-custom-lobby-bots-toggle"
                aria-label={customBots ? "Bots ON — private lobby will fill with AI opponents" : "Bots OFF — party members only"}
              >
                <Bot size={12} strokeWidth={3} />
                {customBots ? "BOTS ON" : "BOTS OFF"}
              </button>
            </div>
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
          ) : inCasualQueue ? (
            <div
              className="px-2 py-2 text-center font-anton uppercase text-xs text-[#E62429] flex items-center justify-center gap-2"
              data-testid="party-member-quick-info"
            >
              <Loader2 size={12} strokeWidth={3} className="animate-spin" />
              IN QUICK QUEUE · {casualWaitSec}s
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
