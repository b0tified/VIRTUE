// QueueOverlay — global ranked-queue toast. Mounted once at the App level so
// the timer + "Match Found!" pop persists across Lobby / Profile / Leaderboard.
import { Trophy, Loader2, X, Users } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useQueue } from "@/context/QueueContext";

const RANK_COLORS = ["#E67E22", "#B8C4CC", "#F1C40F", "#8FD3F4", "#2ECC71", "#4A90E2", "#7BE04C", "#8E44FF", "#D959D9"];

function fmtMS(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

export default function QueueOverlay() {
  const q = useQueue();
  const location = useLocation();
  if (!q) return null;
  const { queueState, waitSec, matchFoundSec, cancelRanked, rankedPlayersInQueue = 1 } = q;
  if (!queueState) return null;
  // Suppress the toast (and the disorienting match-found flash) when the
  // user is in the middle of a match. The queue itself keeps polling in
  // the background; cancelling on /play entry is handled in Game.jsx.
  if (location.pathname.startsWith("/play")) return null;

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] w-full max-w-sm px-4" data-testid="queue-toast">
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
            {queueState.matched ? "Match Found!" : "Searching"}
          </span>
          {!queueState.matched && (
            <button
              onClick={cancelRanked}
              className="font-anton hover:opacity-80 ml-1"
              data-testid="queue-cancel"
              aria-label="Leave queue"
            >
              <X size={16} strokeWidth={3} />
            </button>
          )}
        </div>
        <div className="px-4 py-3 bg-white text-center">
          {queueState.matched ? (
            <div data-testid="queue-match-found">
              <div
                className="font-display text-8xl text-[#06A35F] leading-none tabular-nums animate-pulse"
                data-testid="match-found-countdown"
              >
                {matchFoundSec ?? 3}
              </div>
            </div>
          ) : (
            <div
              className="font-display text-6xl text-[#0055FF] leading-none tabular-nums"
              data-testid="queue-wait-timer"
            >
              {fmtMS(waitSec)}
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-2">
            <div
              className="border-pow-thin font-anton uppercase tracking-widest text-xs px-2 py-0.5"
              style={{
                background: RANK_COLORS[queueState.tier ?? 0],
                color: queueState.tier === 8 ? "#FFD700" : "#0A0A0A",
              }}
            >
              {queueState.tier_name || "BRONZE"}
            </div>
            <div className="border-pow-thin font-anton uppercase tracking-widest text-xs px-2 py-0.5 bg-black text-white flex items-center gap-1" data-testid="queue-players">
              <Users size={12} strokeWidth={3} />
              <span className="tabular-nums" data-testid="queue-players-count">{rankedPlayersInQueue}/4</span>
            </div>
          </div>
          <div className="mt-2 h-2 border-2 border-black bg-neutral-200 overflow-hidden">
            <div className="h-full bg-[#0055FF] transition-[width] duration-500" style={{ width: `${(rankedPlayersInQueue / 4) * 100}%` }} />
          </div>
          {!queueState.matched && Number.isFinite(queueState.estimated_wait_seconds) && (
            <div
              className="mt-2 font-anton uppercase text-[11px] tracking-widest text-neutral-500"
              data-testid="queue-eta"
            >
              Est. wait <span className="text-[#0055FF] tabular-nums">~{fmtMS(queueState.estimated_wait_seconds)}</span>
            </div>
          )}
          {!queueState.matched && (
            <button
              onClick={cancelRanked}
              className="mt-3 btn-pow bg-[#E62429] text-white w-full [&]:py-2 [&]:text-sm"
              data-testid="queue-leave-button"
            >
              <span className="flex items-center justify-center gap-2">
                <X size={16} strokeWidth={3} /> LEAVE QUEUE
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
