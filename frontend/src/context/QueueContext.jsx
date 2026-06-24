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
  const bgPollIdRef = useRef(null);        // low-frequency background poll (detects party-leader joins)

  const stopAll = useCallback(() => {
    if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; }
    if (localTimerRef.current) { clearInterval(localTimerRef.current); localTimerRef.current = null; }
    if (matchTimerRef.current) { clearInterval(matchTimerRef.current); matchTimerRef.current = null; }
  }, []);
  // Consecutive `in_queue: false` poll counter. A single rogue response
  // (e.g. server momentarily 500/empty body, or a queue lock race) used
  // to flip queueState → null and the toast would disappear → reappear
  // on the next 1s poll. We now require 3 consecutive misses before
  // tearing the toast down.
  const missesRef = useRef(0);

  // Local elapsed-time ticker — runs 4× per second so the timer is smooth and
  // never resets between server polls.
  const startLocalTimer = useCallback(() => {
    if (localTimerRef.current) return;
    localTimerRef.current = setInterval(() => {
      if (!joinedAtRef.current) return;
      setWaitSec(Math.max(0, Math.floor((Date.now() - joinedAtRef.current) / 1000)));
    }, 250);
  }, []);

  // Drive the high-frequency poll + match-found countdown using a server
  // payload that already reports `in_queue: true`. Used by joinRanked (when
  // the local user presses the button) AND by the background poller (when a
  // party leader queues the whole group — followers detect it here).
  const beginActivePoll = useCallback((data) => {
    if (pollIdRef.current) return; // already running
    joinedAtRef.current = Date.now() - ((data.wait_seconds || 0) * 1000);
    setQueueState(data);
    setWaitSec(data.wait_seconds || 0);
    missesRef.current = 0;
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
          if (Math.abs(s.wait_seconds - localSec) > 2) {
            joinedAtRef.current = Date.now() - (s.wait_seconds * 1000);
            setWaitSec(s.wait_seconds);
          }
        }
        if (s.matched) {
          missesRef.current = 0;
          setQueueState(s);
          if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; }
          try { await api.post("/queue/ranked/ack"); } catch {}
          audioBus.matchFound();
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
              try {
                window.dispatchEvent(
                  new CustomEvent("virtue-match-loading", { detail: { mode: "ranked" } }),
                );
              } catch {}
              setTimeout(
                // Stamp `state.fromLobby: true` so the MatchEntryGuard
                // wrapper around /play doesn't bounce us back to the
                // lobby. The ranked path doesn't go through
                // `navigateToMatch` (we drive our own loading toast +
                // timer here) so we set the flag inline.
                () => nav("/play?mode=ranked", { replace: true, state: { fromLobby: true } }),
                1200,
              );
            } else {
              setMatchFoundSec(sec);
            }
          }, 1000);
        } else if (!s.in_queue) {
          // Tolerate transient `in_queue: false` blips — only tear down
          // after 3 consecutive misses (~3s). Fixes the
          // "toast disappears and reappears" flicker.
          missesRef.current += 1;
          if (missesRef.current >= 3) {
            stopAll();
            joinedAtRef.current = 0;
            setWaitSec(0);
            setQueueState(null);
            missesRef.current = 0;
          }
        } else {
          // Healthy in_queue: true response — reset miss counter.
          missesRef.current = 0;
          setQueueState(s);
        }
      } catch {
        // Network blip: treat as a soft miss too so a flaky connection
        // doesn't yank the toast around.
        missesRef.current += 1;
      }
    }, 1000);
  }, [nav, startLocalTimer, stopAll]);

  const joinRanked = useCallback(async () => {
    try {
      const { data } = await api.post("/queue/ranked");
      beginActivePoll(data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.response?.data?.detail || e.message };
    }
  }, [beginActivePoll]);

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

  // Background poll — every 3s, ask the server whether *we* are queued.
  // This catches the case where a party leader queued the whole party so
  // every follower also detects the queue + match-found event and navigates
  // to the ranked room. We skip while the active poll is already running
  // (joinRanked path) to avoid double polling, and pause once the user is
  // already matched / mid-countdown.
  useEffect(() => {
    const tick = async () => {
      if (pollIdRef.current || matchTimerRef.current) return;
      try {
        const { data: s } = await api.get("/queue/ranked");
        if (s && (s.in_queue || s.matched)) {
          beginActivePoll(s);
        }
      } catch {}
    };
    // Fire once on mount so we don't wait a full interval after refresh.
    tick();
    bgPollIdRef.current = setInterval(tick, 3000);
    return () => {
      if (bgPollIdRef.current) {
        clearInterval(bgPollIdRef.current);
        bgPollIdRef.current = null;
      }
    };
  }, [beginActivePoll]);

  // ─────────────────────────────────────────────────────────────────────
  // Casual queue — simpler counterpart of the ranked queue. Same shape
  // (server-side FIFO + 10s bot-fill) but without tiers, party
  // followers, or the elaborate miss-tolerance the ranked path needs.
  // The lobby's QUICK MATCH button used to be a pure client-side
  // timer — this state replaces it so casual feels symmetric with
  // ranked (proper server queue, cancellable, audio-acknowledged).
  // ─────────────────────────────────────────────────────────────────────
  const [casualQueueState, setCasualQueueState] = useState(null);
  const [casualWaitSec, setCasualWaitSec] = useState(0);
  const casualJoinedAtRef = useRef(0);
  const casualPollRef = useRef(null);
  const casualLocalRef = useRef(null);

  const stopCasual = useCallback(() => {
    if (casualPollRef.current) { clearInterval(casualPollRef.current); casualPollRef.current = null; }
    if (casualLocalRef.current) { clearInterval(casualLocalRef.current); casualLocalRef.current = null; }
  }, []);

  const joinCasual = useCallback(async () => {
    try {
      const { data } = await api.post("/queue/casual");
      casualJoinedAtRef.current = Date.now();
      setCasualQueueState({ in_queue: true, matched: false, bot_fill_seconds: data.bot_fill_seconds || 10 });
      setCasualWaitSec(0);
      casualLocalRef.current = setInterval(() => {
        setCasualWaitSec(Math.max(0, Math.floor((Date.now() - casualJoinedAtRef.current) / 1000)));
      }, 250);
      casualPollRef.current = setInterval(async () => {
        try {
          const { data: s } = await api.get("/queue/casual");
          if (s.matched) {
            stopCasual();
            audioBus.matchFound();
            setCasualQueueState({ in_queue: false, matched: true });
            // Navigate to the casual room. Stamp `fromLobby: true`
            // for MatchEntryGuard, same as ranked.
            try {
              window.dispatchEvent(
                new CustomEvent("virtue-match-loading", { detail: { mode: "casual" } }),
              );
            } catch {}
            setTimeout(() => {
              setCasualQueueState(null);
              casualJoinedAtRef.current = 0;
              setCasualWaitSec(0);
              nav("/play?mode=casual", { replace: true, state: { fromLobby: true } });
            }, 1200);
          } else if (!s.in_queue) {
            // Server lost track — tear down.
            stopCasual();
            casualJoinedAtRef.current = 0;
            setCasualWaitSec(0);
            setCasualQueueState(null);
          }
        } catch { /* network blip — let next tick try again */ }
      }, 1000);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.response?.data?.detail || e.message };
    }
  }, [nav, stopCasual]);

  const cancelCasual = useCallback(async () => {
    stopCasual();
    casualJoinedAtRef.current = 0;
    setCasualWaitSec(0);
    setCasualQueueState(null);
    try { await api.delete("/queue/casual"); } catch {}
  }, [stopCasual]);

  useEffect(() => () => stopCasual(), [stopCasual]);

  return (
    <QueueContext.Provider value={{
      queueState, waitSec, matchFoundSec, joinRanked, cancelRanked,
      casualQueueState, casualWaitSec, joinCasual, cancelCasual,
    }}>
      {children}
    </QueueContext.Provider>
  );
}

export const useQueue = () => useContext(QueueContext);
