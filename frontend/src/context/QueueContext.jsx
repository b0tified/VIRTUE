// QueueContext — global ranked-queue state so the timer + match-found overlay
// persists when the user navigates to /profile, /leaderboard, etc.
//
// Provides: queueState (null when not in queue), waitSec (live elapsed time),
// matchFoundSec (3-2-1 countdown), joinRanked(), cancelRanked(), goToMatch().
//
// Timer fix: previously the wait timer came straight from the server poll
// (1Hz), so it would visibly snap from N → 0 (between polls) → N+1. Now we
// track a client-side `joinedAt` timestamp and compute elapsed locally every
// 250ms; the server poll only refreshes tier_size/position/matched flags.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api";
import audioBus from "@/game/audio";

const QueueContext = createContext(null);

export function QueueProvider({ children }) {
  const nav = useNavigate();
  const [queueState, setQueueState] = useState(null); // {tier, tier_name, tier_size, matched, ...} | null
  const [waitSec, setWaitSec] = useState(0);
  const [matchFoundSec, setMatchFoundSec] = useState(null);
  const joinedAtRef = useRef(0);           // client-side join timestamp (ms)
  const pollIdRef = useRef(null);          // server-poll interval
  const localTimerRef = useRef(null);      // 4Hz local timer
  const matchTimerRef = useRef(null);      // 3-2-1 countdown

  const stopAll = useCallback(() => {
    if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; }
    if (localTimerRef.current) { clearInterval(localTimerRef.current); localTimerRef.current = null; }
    if (matchTimerRef.current) { clearInterval(matchTimerRef.current); matchTimerRef.current = null; }
  }, []);

  // Local elapsed-time ticker — runs 4× per second so the timer is smooth and
  // never resets between server polls.
  const startLocalTimer = useCallback(() => {
    if (localTimerRef.current) return;
    localTimerRef.current = setInterval(() => {
      if (!joinedAtRef.current) return;
      setWaitSec(Math.max(0, Math.floor((Date.now() - joinedAtRef.current) / 1000)));
    }, 250);
  }, []);

  const joinRanked = useCallback(async () => {
    try {
      const { data } = await api.post("/queue/ranked");
      joinedAtRef.current = Date.now() - ((data.wait_seconds || 0) * 1000);
      setQueueState(data);
      setWaitSec(data.wait_seconds || 0);
      startLocalTimer();
      pollIdRef.current = setInterval(async () => {
        try {
          const { data: s } = await api.get("/queue/ranked");
          // Sync local clock to the server's authoritative elapsed value, but
          // ONLY while still queueing (server is in_queue=true & not matched).
          // Once matched, `wait_seconds` means "seconds since match" — applying
          // it here would yank the local timer back to ~0 and create the
          // jumping behaviour the user reported. Same after a cancel: the
          // server returns in_queue=false / wait_seconds=0, which we ignore.
          if (s && s.in_queue && !s.matched && typeof s.wait_seconds === "number") {
            const localSec = Math.floor((Date.now() - joinedAtRef.current) / 1000);
            // Only resync when the drift is meaningful (>2s) so micro-jitter
            // from poll latency doesn't push the displayed second back/forth.
            if (Math.abs(s.wait_seconds - localSec) > 2) {
              joinedAtRef.current = Date.now() - (s.wait_seconds * 1000);
              setWaitSec(s.wait_seconds);
            }
          }
          setQueueState(s);
          if (s.matched) {
            if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; }
            try { await api.post("/queue/ranked/ack"); } catch {}
            audioBus.matchFound();
            // 3-2-1 countdown, then navigate to the match.
            setMatchFoundSec(3);
            let sec = 3;
            matchTimerRef.current = setInterval(() => {
              sec -= 1;
              if (sec <= 0) {
                clearInterval(matchTimerRef.current);
                matchTimerRef.current = null;
                setMatchFoundSec(null);
                setQueueState(null);
                joinedAtRef.current = 0;
                setWaitSec(0);
                if (localTimerRef.current) { clearInterval(localTimerRef.current); localTimerRef.current = null; }
                nav("/play?mode=ranked", { replace: true });
              } else {
                setMatchFoundSec(sec);
              }
            }, 1000);
          }
        } catch {}
      }, 1000);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.response?.data?.detail || e.message };
    }
  }, [startLocalTimer, nav]);

  const cancelRanked = useCallback(async () => {
    stopAll();
    joinedAtRef.current = 0;
    setWaitSec(0);
    setMatchFoundSec(null);
    setQueueState(null);
    try { await api.delete("/queue/ranked"); } catch {}
  }, [stopAll]);

  // Cleanup on unmount
  useEffect(() => () => stopAll(), [stopAll]);

  return (
    <QueueContext.Provider value={{ queueState, waitSec, matchFoundSec, joinRanked, cancelRanked }}>
      {children}
    </QueueContext.Provider>
  );
}

export const useQueue = () => useContext(QueueContext);
