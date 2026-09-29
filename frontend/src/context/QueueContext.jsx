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
import { useLocation, useNavigate } from "react-router-dom";
import api from "@/api";
import audioBus from "@/game/audio";
import settingsStore from "@/game/settings";
import { detectIsMobile } from "@/game/useIsMobile";

/** Build the platform-flags payload every queue-join POST needs.
 *  `is_mobile` is the caller's device (touch/coarse-pointer). `mobile_only`
 *  is the user's Mobile-Only Matchmaking preference AND actually being on
 *  mobile — desktop users can't accidentally trigger it via a stale saved
 *  setting. The matchmaker enforces the cross-play rule server-side. */
function _platformFlags() {
  const mobile = detectIsMobile();
  const pref = !!settingsStore.get().mobileOnlyMatchmaking;
  return { is_mobile: mobile, mobile_only: mobile && pref };
}

/** Read the Quick-Match mode preference from localStorage. Returns
 *  "ffa" | "tdm" | "both" — the casual queue POST forwards it so the
 *  matchmaker pairs / bot-fills into the caller's picked mode. Any
 *  garbage value defaults to "both" (server also revalidates). */
function _quickMatchModePref() {
  const p = (settingsStore.get().quickMatchModePref || "both").toLowerCase();
  return p === "ffa" || p === "tdm" ? p : "both";
}

const QueueContext = createContext(null);

export function QueueProvider({ children }) {
  const nav = useNavigate();
  // Used to gate the background queue-poll: once the player is on
  // /play (mid-match) we MUST stop polling /queue/ranked. Otherwise a
  // stale `matched: true` from MATCHED_USERS — which lingers until
  // the ws_game endpoint consumes it on connect — would re-trigger the
  // match-found audio + loading screen mid-game. Bug repro:
  //   1. Queue ranked → matched → 3-2-1 → nav("/play")
  //   2. WS opens; backend hasn't yet popped MATCHED_USERS[uid]
  //   3. Bg poll fires 3s later → sees matched:true → beginActivePoll
  //      → audioBus.matchFound() + virtue-match-loading event
  //   4. Loading screen pops up over the live game.
  const location = useLocation();
  const inMatchRoute = location?.pathname?.startsWith("/play");
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
  // Estimated-wait lock: captured on the FIRST poll where the user is
  // in-queue and NEVER re-read from subsequent polls. Users complained
  // that the ETA was ticking down / jumping around every second — with
  // the server re-rolling the bot-fill randomly per poll, the shown
  // value would swing wildly (e.g. 32s → 41s → 25s). Locking it to the
  // initial estimate gives a stable "here's roughly how long you'll
  // wait" number that plays nicely alongside the live count-up timer.
  const lockedEtaRef = useRef(null);
  // Consecutive `in_queue: false` poll counter. A single rogue response
  // (e.g. server momentarily 500/empty body, or a queue lock race) used
  // to flip queueState → null and the toast would disappear → reappear
  // on the next 1s poll. We now require 3 consecutive misses before
  // tearing the toast down.
  const missesRef = useRef(0);
  // Cancel guard — set to `Date.now() + N` on cancelRanked so both the
  // active poll AND the background poll IGNORE the server response for
  // the next N ms. Fixes: "click cancel → toast reappears" bug. Root
  // cause was the async DELETE hadn't hit the server yet when the next
  // bg poll (3s interval, unrelated to stopAll) fired GET /queue/ranked,
  // saw stale in_queue:true from the server, and re-invoked
  // beginActivePoll. The guard gives the DELETE a full 10s to clear
  // any lingering entry (including party-follower cascades).
  const cancelGuardUntilRef = useRef(0);
  // Same guard for the casual queue — separate timestamp so casual and
  // ranked cancellations don't cross-block each other.
  const casualCancelGuardUntilRef = useRef(0);

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
    // Lock the ETA to whatever the server reported on the FIRST poll —
    // subsequent polls will re-roll the random bot-fill window and
    // return a different value, which we intentionally ignore here.
    lockedEtaRef.current = Number.isFinite(data.estimated_wait_seconds)
      ? data.estimated_wait_seconds
      : null;
    setQueueState({ ...data, estimated_wait_seconds: lockedEtaRef.current });
    setWaitSec(data.wait_seconds || 0);
    missesRef.current = 0;
    startLocalTimer();
    pollIdRef.current = setInterval(async () => {
      try {
        const { data: s } = await api.get("/queue/ranked");
        // Cancel-guard check — the user hit LEAVE while the request
        // was in flight. Drop the response entirely so it can't
        // re-populate queueState after the toast tore down.
        if (Date.now() < cancelGuardUntilRef.current) return;
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
          // Slam the cancel-guard so the 3s background poll CANNOT
          // re-invoke beginActivePoll while we're in the 3-2-1
          // countdown → 1.2s nav-delay window. Without this, if the
          // ack POST races the bg tick (or the ack fails silently
          // due to a transient 5xx), the bg poll re-reads a still
          // matched:true, spins up a NEW beginActivePoll, and the
          // toast "reappears" moments after fading — exactly the
          // symptom the user kept reporting.
          cancelGuardUntilRef.current = Date.now() + 15000;
          try { await api.post("/queue/ranked/ack"); } catch {}
          // Clear the ETA lock — next queue starts fresh.
          lockedEtaRef.current = null;
          audioBus.matchFound();
          setMatchFoundSec(3);
          let sec = 3;
          matchTimerRef.current = setInterval(() => {
            sec -= 1;
            if (sec <= 0) {
              clearInterval(matchTimerRef.current);
              matchTimerRef.current = null;
              if (localTimerRef.current) { clearInterval(localTimerRef.current); localTimerRef.current = null; }
              try {
                window.dispatchEvent(
                  new CustomEvent("virtue-match-loading", { detail: { mode: "ranked" } }),
                );
              } catch {}
              // Keep queueState/matchFoundSec set until AFTER we
              // navigate — this way the "Match Found!" overlay stays
              // visible during the 1.2s pre-nav delay instead of the
              // toast blinking off, then the browser jumping to
              // /play. The nav itself is what tears down the toast
              // (QueueOverlay hides when location starts with /play).
              setTimeout(() => {
                // Stamp `state.fromLobby: true` so the MatchEntryGuard
                // wrapper around /play doesn't bounce us back to the
                // lobby. The ranked path doesn't go through
                // `navigateToMatch` (we drive our own loading toast +
                // timer here) so we set the flag inline.
                nav("/play?mode=ranked", { replace: true, state: { fromLobby: true } });
                // Clear ephemeral state on the next tick — by now
                // the location has flipped to /play so the overlay
                // is hidden by its own location guard anyway.
                setMatchFoundSec(null);
                setQueueState(null);
                joinedAtRef.current = 0;
                setWaitSec(0);
              }, 1200);
            } else {
              setMatchFoundSec(sec);
            }
          }, 1000);
        } else if (!s.in_queue) {
          // Tolerate transient `in_queue: false` blips — only tear down
          // after 10 consecutive misses (~10s). Bumped from 5 because
          // some slow-network / mobile-backgrounded scenarios still
          // tripped the teardown mid-queue. A legitimate force-remove
          // (admin action, ws timeout) survives 10s of misses too.
          missesRef.current += 1;
          if (missesRef.current >= 10) {
            // Set the cancel guard so the bg poll doesn't instantly
            // re-invoke beginActivePoll on its next 3s tick. Without
            // this, the toast disappears and reappears in a tight
            // loop until the server actually clears the queue.
            cancelGuardUntilRef.current = Date.now() + 6000;
            stopAll();
            joinedAtRef.current = 0;
            setWaitSec(0);
            setQueueState(null);
            missesRef.current = 0;
            lockedEtaRef.current = null;
          }
        } else {
          // Healthy in_queue: true response — reset miss counter.
          // Preserve the locked ETA so the "Est. wait" number the user
          // saw when they joined doesn't jump around every second as
          // the server re-rolls the bot-fill randomly.
          missesRef.current = 0;
          setQueueState({
            ...s,
            estimated_wait_seconds: lockedEtaRef.current ?? s.estimated_wait_seconds,
          });
        }
      } catch {
        // Network blip: treat as a soft miss too so a flaky connection
        // doesn't yank the toast around.
        missesRef.current += 1;
      }
    }, 1000);
  }, [nav, startLocalTimer, stopAll]);

  const rankedJoiningRef = useRef(false);
  const joinRanked = useCallback(async () => {
    // Same in-flight lock as casual — prevents rapid double-clicks
    // from starting two overlapping poll intervals (the second one
    // would overwrite pollIdRef inside beginActivePoll and orphan the
    // first, which then keeps firing match-found events forever).
    if (rankedJoiningRef.current || pollIdRef.current) {
      return { ok: false, error: "Already queued" };
    }
    rankedJoiningRef.current = true;
    try {
      const { data } = await api.post("/queue/ranked", _platformFlags());
      beginActivePoll(data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.response?.data?.detail || e.message };
    } finally {
      rankedJoiningRef.current = false;
    }
  }, [beginActivePoll]);

  const cancelRanked = useCallback(async () => {
    // Block ALL polls (active + background) from re-invoking
    // beginActivePoll for the next 10 seconds. This closes the race
    // where the async DELETE hasn't reached the server yet when the
    // next bg poll tick fires and sees stale in_queue:true.
    cancelGuardUntilRef.current = Date.now() + 10000;
    stopAll();
    joinedAtRef.current = 0;
    setWaitSec(0);
    setMatchFoundSec(null);
    setQueueState(null);
    lockedEtaRef.current = null;
    missesRef.current = 0;
    rankedJoiningRef.current = false;
    try { await api.delete("/queue/ranked"); } catch {}
  }, [stopAll]);

  // Cleanup on unmount
  useEffect(() => () => stopAll(), [stopAll]);

  // Background poll — every 3s, ask the server whether *we* are queued.
  // This catches the case where a party leader queued the whole party so
  // every follower also detects the queue + match-found event and navigates
  // to the ranked room. We skip while the active poll is already running
  // (joinRanked path) to avoid double polling, and pause once the user is
  // already matched / mid-countdown OR currently mid-match (see
  // `inMatchRoute` rationale at the top of the file).
  useEffect(() => {
    // Don't background-poll while in a match — would re-fire the
    // match-found flow on top of live gameplay.
    if (inMatchRoute) return;
    const tick = async () => {
      if (pollIdRef.current || matchTimerRef.current) return;
      // Respect the cancel guard — cancelRanked bumped this to
      // Date.now() + 10s so any lingering server-side entry (or
      // pending DELETE) can't sneak back and re-invoke beginActivePoll.
      if (Date.now() < cancelGuardUntilRef.current) return;
      try {
        const { data: s } = await api.get("/queue/ranked");
        // Double-check the guard AFTER the async fetch — if the user
        // cancelled while we were awaiting, the response is stale.
        if (Date.now() < cancelGuardUntilRef.current) return;
        if (s && (s.in_queue || s.matched)) {
          // Follower detection: the bg poll only enters this branch
          // when THIS client didn't press the ranked button but the
          // server nonetheless says we're queued/matched — i.e. our
          // party leader queued us. Fire the mini-toast event before
          // the full 3-2-1 overlay so the follower knows what's
          // happening in the ~1s gap. Fire once — the pollIdRef
          // check at the top of `tick` guarantees this branch only
          // runs on the first successful discovery.
          try {
            window.dispatchEvent(new CustomEvent("virtue-follower-joined-ranked"));
          } catch {}
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
  }, [beginActivePoll, inMatchRoute]);

  // ─────────────────────────────────────────────────────────────────────
  // Casual queue — mirrors the hardening of the ranked path after users
  // reported the same failure mode: (1) toast disappears mid-search on
  // a transient poll blip and (2) after clicking Quick Match again, the
  // match-loading overlay ends up spamming over live gameplay because
  // multiple overlapping poll intervals get orphaned and each one fires
  // its own `virtue-match-loading` event on the next `matched:true`
  // tick. Fixes below:
  //   • `casualJoiningRef` — in-flight lock around POST /queue/casual to
  //     stop rapid double-clicks from starting two parallel poll
  //     intervals (the second setInterval would overwrite casualPollRef
  //     and orphan the first — that ghost interval kept polling forever,
  //     eventually seeing matched:true and dispatching stray loading
  //     events during gameplay).
  //   • `casualMatchedRef` — one-shot flag so once matched fires, any
  //     late orphan tick or duplicate response is a no-op.
  //   • `casualMissesRef` — 10-tick miss tolerance mirroring the ranked
  //     path; single transient `in_queue:false` no longer nukes the
  //     toast.
  //   • Cancel-guard slam on matched (15s) — blocks stray polls from
  //     re-firing virtue-match-loading during the 3-2-1 → nav window.
  // ─────────────────────────────────────────────────────────────────────
  const [casualQueueState, setCasualQueueState] = useState(null);
  const [casualWaitSec, setCasualWaitSec] = useState(0);
  const casualJoinedAtRef = useRef(0);
  const casualPollRef = useRef(null);
  const casualLocalRef = useRef(null);
  const casualLockedEtaRef = useRef(null);
  const casualJoiningRef = useRef(false);
  const casualMatchedRef = useRef(false);
  const casualMissesRef = useRef(0);

  const stopCasual = useCallback(() => {
    if (casualPollRef.current) { clearInterval(casualPollRef.current); casualPollRef.current = null; }
    if (casualLocalRef.current) { clearInterval(casualLocalRef.current); casualLocalRef.current = null; }
  }, []);

  // Extract the "active poll + local timer + match-found handler" setup
  // so both `joinCasual` (leader path) AND the new background poll
  // (follower path — detects when a party leader kicked off the queue)
  // share identical behaviour. Idempotent: bails if the active poll is
  // already running so we can't stack two intervals.
  const beginCasualActivePoll = useCallback((initial, joinTimestampMs) => {
    if (casualPollRef.current) return;
    stopCasual();
    casualMatchedRef.current = !!(initial && initial.matched);
    casualMissesRef.current = 0;
    casualJoinedAtRef.current = joinTimestampMs || Date.now();
    // Prefer the server's stable ETA on first observation; fall back to
    // bot-fill if the server didn't provide one (older follower path).
    casualLockedEtaRef.current = Number.isFinite(initial?.estimated_wait_seconds)
      ? initial.estimated_wait_seconds
      : (initial?.bot_fill_seconds || 10);
    setCasualQueueState({
      in_queue: !!initial?.in_queue,
      matched: !!initial?.matched,
      bot_fill_seconds: initial?.bot_fill_seconds || 10,
      estimated_wait_seconds: casualLockedEtaRef.current,
    });
    setCasualWaitSec(Math.max(0, Math.floor((Date.now() - casualJoinedAtRef.current) / 1000)));
    casualLocalRef.current = setInterval(() => {
      setCasualWaitSec(Math.max(0, Math.floor((Date.now() - casualJoinedAtRef.current) / 1000)));
    }, 250);
    casualPollRef.current = setInterval(async () => {
      try {
        const { data: s } = await api.get("/queue/casual");
        if (Date.now() < casualCancelGuardUntilRef.current) return;
        if (casualMatchedRef.current) return;
        if (s.matched) {
          casualMatchedRef.current = true;
          stopCasual();
          casualCancelGuardUntilRef.current = Date.now() + 15000;
          audioBus.matchFound();
          setCasualQueueState({ in_queue: false, matched: true });
          casualLockedEtaRef.current = null;
          try {
            window.dispatchEvent(
              new CustomEvent("virtue-match-loading", { detail: { mode: "casual" } }),
            );
          } catch {}
          setTimeout(() => {
            nav("/play?mode=casual", { replace: true, state: { fromLobby: true } });
            setCasualQueueState(null);
            casualJoinedAtRef.current = 0;
            setCasualWaitSec(0);
          }, 1200);
        } else if (!s.in_queue) {
          casualMissesRef.current += 1;
          if (casualMissesRef.current >= 10) {
            casualCancelGuardUntilRef.current = Date.now() + 6000;
            stopCasual();
            casualJoinedAtRef.current = 0;
            setCasualWaitSec(0);
            setCasualQueueState(null);
            casualMissesRef.current = 0;
            casualLockedEtaRef.current = null;
          }
        } else {
          casualMissesRef.current = 0;
        }
      } catch {
        casualMissesRef.current += 1;
      }
    }, 1000);
  }, [nav, stopCasual]);

  const joinCasual = useCallback(async () => {
    // In-flight lock: rejects double-clicks that would otherwise start
    // a second setInterval and orphan the first one. Without this the
    // ghost interval kept firing `matched:true` events INTO gameplay,
    // spamming the match-loading overlay over the live game.
    if (casualJoiningRef.current || casualPollRef.current) {
      return { ok: false, error: "Already queued" };
    }
    casualJoiningRef.current = true;
    try {
      const { data } = await api.post("/queue/casual", {
        ..._platformFlags(),
        mode_pref: _quickMatchModePref(),
      });
      // Leader path — kick the shared active-poll setup.
      beginCasualActivePoll({
        in_queue: true,
        matched: false,
        bot_fill_seconds: data.bot_fill_seconds || 10,
        estimated_wait_seconds: data.estimated_wait_seconds,
      }, Date.now());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.response?.data?.detail || e.message };
    } finally {
      casualJoiningRef.current = false;
    }
  }, [beginCasualActivePoll]);

  const cancelCasual = useCallback(async () => {
    // Block any in-flight or bg poll from re-populating the toast.
    casualCancelGuardUntilRef.current = Date.now() + 10000;
    stopCasual();
    casualJoinedAtRef.current = 0;
    setCasualWaitSec(0);
    setCasualQueueState(null);
    casualLockedEtaRef.current = null;
    casualMatchedRef.current = false;
    casualMissesRef.current = 0;
    casualJoiningRef.current = false;
    try { await api.delete("/queue/casual"); } catch {}
  }, [stopCasual]);

  useEffect(() => () => stopCasual(), [stopCasual]);

  // Casual background poll — mirrors the ranked bg poll. Fires every
  // 3s so a party FOLLOWER (who never clicks Quick Match themselves —
  // the leader does it for the group) detects the shared queue entry
  // and joins the active-poll flow, ensuring both party members
  // navigate into the SAME casual match. Without this the follower
  // simply sat on the lobby forever with a live server-side queue
  // entry — exactly the "sometimes doesn't put both into same match"
  // symptom reported.
  const casualBgPollRef = useRef(null);
  useEffect(() => {
    if (inMatchRoute) return;
    const tick = async () => {
      // Skip while the active poll is already running (leader path,
      // or follower who already discovered the queue) so we don't
      // stack two intervals.
      if (casualPollRef.current) return;
      if (Date.now() < casualCancelGuardUntilRef.current) return;
      try {
        const { data: s } = await api.get("/queue/casual");
        if (Date.now() < casualCancelGuardUntilRef.current) return;
        // If matched, `wait_seconds` from the server is "time since
        // match" not "time since join" — so we bind joinTimestamp to
        // now for the local timer (short-lived, only used for the
        // ~4.2s match-found overlay). If in_queue, we back-date it
        // so the follower's timer roughly matches the leader's.
        if (s && s.matched) {
          // Followers who land here missed the "leader started" moment
          // (either the leader queued while this client was offline
          // or the initial in_queue tick already got consumed). Still
          // fire the follower-detected event so the mini-toast plays,
          // then the match-found overlay takes over immediately.
          try {
            window.dispatchEvent(new CustomEvent("virtue-follower-joined-casual"));
          } catch {}
          beginCasualActivePoll(s, Date.now());
        } else if (s && s.in_queue) {
          // Fresh discovery — this client didn't queue itself, but
          // the server says we're in the casual queue. That means
          // our party leader hit Quick Match. Announce it via the
          // custom event so the Lobby can render its
          // "LEADER STARTED QUICK MATCH" mini-toast before the full
          // match-found overlay lands.
          try {
            window.dispatchEvent(new CustomEvent("virtue-follower-joined-casual"));
          } catch {}
          const joinTs = Date.now() - (Number(s.wait_seconds || 0) * 1000);
          beginCasualActivePoll(s, joinTs);
        }
      } catch { /* soft-fail */ }
    };
    // Fire once on mount so a follower who lands on /lobby with the
    // party already queued doesn't wait a full 3s for the first tick.
    tick();
    casualBgPollRef.current = setInterval(tick, 3000);
    return () => {
      if (casualBgPollRef.current) {
        clearInterval(casualBgPollRef.current);
        casualBgPollRef.current = null;
      }
    };
  }, [beginCasualActivePoll, inMatchRoute]);

  // ─────────────────────────────────────────────────────────────────────
  // BigFFA (12-player FFA) queue — mirrors the casual queue's plumbing
  // so the client's poll/cancel/matched flow is identical. The backend
  // pools queued players and dispatches everyone at once into the
  // shared `bigffa_room` when either 12 humans have queued or the
  // 12-second hold timer expires. See `/queue/bigffa` in server.py.
  // ─────────────────────────────────────────────────────────────────────
  const [bigffaQueueState, setBigffaQueueState] = useState(null);
  const [bigffaWaitSec, setBigffaWaitSec] = useState(0);
  // 3-2-1 countdown counterpart to ranked's `matchFoundSec` — populated
  // the instant the queue matches and ticked down each second. The
  // queue toast reads this to swap its timer for the giant countdown
  // digit before the client nav-flips to /play.
  const [bigffaMatchFoundSec, setBigffaMatchFoundSec] = useState(null);
  const bigffaJoinedAtRef = useRef(0);
  const bigffaPollRef = useRef(null);
  const bigffaLocalRef = useRef(null);
  const bigffaMatchTimerRef = useRef(null);
  const bigffaLockedEtaRef = useRef(null);
  const bigffaJoiningRef = useRef(false);
  const bigffaMatchedRef = useRef(false);
  const bigffaMissesRef = useRef(0);
  const bigffaCancelGuardUntilRef = useRef(0);

  const stopBigffa = useCallback(() => {
    if (bigffaPollRef.current) { clearInterval(bigffaPollRef.current); bigffaPollRef.current = null; }
    if (bigffaLocalRef.current) { clearInterval(bigffaLocalRef.current); bigffaLocalRef.current = null; }
    if (bigffaMatchTimerRef.current) { clearInterval(bigffaMatchTimerRef.current); bigffaMatchTimerRef.current = null; }
  }, []);

  const joinBigffa = useCallback(async () => {
    if (bigffaJoiningRef.current || bigffaPollRef.current) {
      return { ok: false, error: "Already queued" };
    }
    bigffaJoiningRef.current = true;
    try {
      const { data } = await api.post("/queue/bigffa", _platformFlags());
      stopBigffa();
      bigffaMatchedRef.current = false;
      bigffaMissesRef.current = 0;
      bigffaJoinedAtRef.current = Date.now();
      bigffaLockedEtaRef.current = Number.isFinite(data.estimated_wait_seconds)
        ? data.estimated_wait_seconds
        : (data.bot_fill_seconds || 60);
      setBigffaQueueState({
        in_queue: true,
        matched: false,
        bot_fill_seconds: data.bot_fill_seconds || 60,
        estimated_wait_seconds: bigffaLockedEtaRef.current,
      });
      setBigffaWaitSec(0);
      bigffaLocalRef.current = setInterval(() => {
        setBigffaWaitSec(Math.max(0, Math.floor((Date.now() - bigffaJoinedAtRef.current) / 1000)));
      }, 250);
      bigffaPollRef.current = setInterval(async () => {
        try {
          const { data: s } = await api.get("/queue/bigffa");
          if (Date.now() < bigffaCancelGuardUntilRef.current) return;
          if (bigffaMatchedRef.current) return;
          if (s.matched) {
            bigffaMatchedRef.current = true;
            stopBigffa();
            bigffaCancelGuardUntilRef.current = Date.now() + 15000;
            audioBus.matchFound();
            setBigffaQueueState({ in_queue: false, matched: true });
            bigffaLockedEtaRef.current = null;
            // 3-2-1 ceremonial countdown — mirrors the ranked "Match
            // Found!" overlay. Fires the loading event + nav on 0.
            setBigffaMatchFoundSec(3);
            let sec = 3;
            bigffaMatchTimerRef.current = setInterval(() => {
              sec -= 1;
              if (sec <= 0) {
                clearInterval(bigffaMatchTimerRef.current);
                bigffaMatchTimerRef.current = null;
                try {
                  window.dispatchEvent(
                    new CustomEvent("virtue-match-loading", { detail: { mode: "bigffa" } }),
                  );
                } catch {}
                setTimeout(() => {
                  nav("/play?mode=bigffa", { replace: true, state: { fromLobby: true } });
                  setBigffaMatchFoundSec(null);
                  setBigffaQueueState(null);
                  bigffaJoinedAtRef.current = 0;
                  setBigffaWaitSec(0);
                }, 1200);
              } else {
                setBigffaMatchFoundSec(sec);
              }
            }, 1000);
          } else if (!s.in_queue) {
            // Server reports we're no longer in queue AND not matched.
            // This can happen during a matchmaker cycle (server briefly
            // between "still in queue" and "matched: true"), during
            // deployment restarts, or on transient DB reads. We used
            // to give up after 10 misses (~10s) but that was too
            // eager — the queue box would vanish while the player was
            // still legitimately queueing. Bumped to 30 (~30s) so
            // real hiccups clear only if the server truly forgot us.
            bigffaMissesRef.current += 1;
            if (bigffaMissesRef.current >= 30) {
              bigffaCancelGuardUntilRef.current = Date.now() + 6000;
              stopBigffa();
              bigffaJoinedAtRef.current = 0;
              setBigffaWaitSec(0);
              setBigffaQueueState(null);
              bigffaMissesRef.current = 0;
              bigffaLockedEtaRef.current = null;
            }
          } else {
            // Server confirms we're still in queue — reset the miss
            // counter AND refresh the client-side queue state so the
            // ETA / queue_size chips reflect the live number even if
            // 12 other players joined behind us since we opened the
            // box. Without this the box shows the join-time ETA
            // forever until match.
            bigffaMissesRef.current = 0;
            setBigffaQueueState({
              in_queue: true,
              matched: false,
              queue_size: Number.isFinite(s.queue_size) ? s.queue_size : undefined,
              // Preserve the locked ETA — the visual countdown is
              // driven by `bigffaWaitSec`, and this pill just shows
              // the initial estimate. Overwriting with server's fresh
              // estimated_wait_seconds would confuse players
              // (backend recomputes it every poll based on remaining
              // dispatch_after which shrinks toward 0).
              estimated_wait_seconds: bigffaLockedEtaRef.current
                ?? (Number.isFinite(s.estimated_wait_seconds) ? s.estimated_wait_seconds : undefined),
            });
          }
        } catch {
          bigffaMissesRef.current += 1;
        }
      }, 1000);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.response?.data?.detail || e.message };
    } finally {
      bigffaJoiningRef.current = false;
    }
  }, [nav, stopBigffa]);

  const cancelBigffa = useCallback(async () => {
    bigffaCancelGuardUntilRef.current = Date.now() + 10000;
    stopBigffa();
    bigffaJoinedAtRef.current = 0;
    setBigffaWaitSec(0);
    setBigffaQueueState(null);
    setBigffaMatchFoundSec(null);
    bigffaLockedEtaRef.current = null;
    bigffaMatchedRef.current = false;
    bigffaMissesRef.current = 0;
    bigffaJoiningRef.current = false;
    try { await api.delete("/queue/bigffa"); } catch {}
  }, [stopBigffa]);

  useEffect(() => () => stopBigffa(), [stopBigffa]);

  return (
    <QueueContext.Provider value={{
      queueState, waitSec, matchFoundSec, joinRanked, cancelRanked,
      casualQueueState, casualWaitSec, joinCasual, cancelCasual,
      bigffaQueueState, bigffaWaitSec, bigffaMatchFoundSec,
      joinBigffa, cancelBigffa,
    }}>
      {children}
    </QueueContext.Provider>
  );
}

export const useQueue = () => useContext(QueueContext);
