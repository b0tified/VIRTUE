import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import audioBus from "@/game/audio";
import settingsStore from "@/game/settings";
import api from "@/api";
import { Trophy, User, Play, Mouse, Users, Award, X, Loader2, Star, WifiOff, Settings as SettingsIcon, UserPlus, Lock, Coins, ShoppingBag, Sparkles, Shield, LogOut, Megaphone } from "lucide-react";
import SettingsModal from "@/components/SettingsModal";
import PlayerCard from "@/components/PlayerCard";
import FriendsModal from "@/components/FriendsModal";
import WhisperToaster from "@/components/WhisperToaster";
import PartyPanel from "@/components/PartyPanel";
import LobbyBackground from "@/components/LobbyBackground";
import LobbyBackgroundMeteor from "@/components/LobbyBackgroundMeteor";
import LobbyBackgroundSnow from "@/components/LobbyBackgroundSnow";
import RankUpOverlay from "@/components/RankUpOverlay";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import RankProgressBar from "@/components/RankProgressBar";
import ShopModal from "@/components/ShopModal";
import ProgressionModal from "@/components/ProgressionModal";
import PracticeMapSelector from "@/components/PracticeMapSelector";
import { formatBannerTitle, bannerTitleAnimClass } from "@/game/bannerTitle";
import LobbyDailyPanel from "@/components/LobbyDailyPanel";
import { navigateToMatch } from "@/lib/navigateToMatch";
import { useQueue } from "@/context/QueueContext";

const LOBBY_BG = "https://static.prod-images.emergentagent.com/jobs/956e5f81-3c5a-4b45-a2da-bf26ea4fc4d1/images/3fd8a6f43a33db82e29a81462fb7d356c6de26372ea5ffabff63ed8db4358583.png";

export default function Lobby() {
  // logout still available via Settings modal — it pulls its own useAuth().
  const { user, refreshMe } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [disconnected, setDisconnected] = useState(searchParams.get("disconnected") === "1");
  const [spectateEnded, setSpectateEnded] = useState(searchParams.get("spectate_ended") === "1");
  const spectateEndedTarget = searchParams.get("target") || "";
  const [showSettings, setShowSettings] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  // When the WhisperToaster fires we open the Friends modal pre-
  // navigated to a specific friend's chat. `null` = open at the
  // normal list view.
  const [whisperOpenWith, setWhisperOpenWith] = useState(null);
  const [showShop, setShowShop] = useState(false);
  const [showProgression, setShowProgression] = useState(false);
  // News unread badge — refreshed every 30s and cleared when the user
  // opens /news (the News page dispatches `virtue-news-read`).
  const [newsUnread, setNewsUnread] = useState(0);
  // When non-null, the practice map selector is open. Value is the mode
  // it will launch on confirm: "practice" | "offline".
  const [practiceSelectorMode, setPracticeSelectorMode] = useState(null);
  // Rank-up celebration overlay. Triggered by a global `virtue-rankup` event
  // dispatched after a successful redeem of a tier-skip code (e.g. WARPSPEED).
  const [rankUp, setRankUp] = useState(null); // { prevTier, newTier, rpDelta, newPoints }
  // Live count of OTHER real players currently in the casual room. Polled
  // every 1s while the casual queue is active. Cosmetic — used to flip the
  // toast header from "Searching for players" → "PLAYER FOUND" so the
  // player sees a sign of life before the server confirms the match.
  const [foundRealPlayers, setFoundRealPlayers] = useState(0);
  const [showTiers, setShowTiers] = useState(false);
  // Ranked + casual queue state both live in the global QueueContext so
  // the toasts persist when navigating to Profile/Leaderboard and the
  // backend stays the single source of truth for matchmaking.
  const queueCtx = useQueue();
  const queueState = queueCtx?.queueState ?? null;
  const casualQueueState = queueCtx?.casualQueueState ?? null;
  const casualWaitSec = queueCtx?.casualWaitSec ?? 0;
  const casualInQueue = !!(casualQueueState && (casualQueueState.in_queue || casualQueueState.matched));

  // Ranked unlock gate — server enforces too. Mirrors RANKED_MIN_LEVEL in server.py.
  const RANKED_MIN_LEVEL = 5;
  // Mirrors RANKED_LEAVE_RP_LOSS in server.py — for the tooltip copy.
  const RANKED_LEAVE_RP_LOSS = 30;
  const userLevel = user?.level ?? 1;
  const rankedLocked = userLevel < RANKED_MIN_LEVEL;

  // Ranked early-leave penalty countdown. Server returns
  // `ranked_ban_seconds` on /me; we tick it down locally each second
  // so the player sees the clock fall to 0 in real time. When it hits
  // 0 we re-fetch `/me` so the lobby state reflects the unlocked
  // queue without a manual refresh.
  const [rankedBanLeft, setRankedBanLeft] = useState(0);
  useEffect(() => {
    setRankedBanLeft(Math.max(0, user?.ranked_ban_seconds || 0));
  }, [user?.ranked_ban_seconds]);
  useEffect(() => {
    if (rankedBanLeft <= 0) return;
    const id = setInterval(() => {
      setRankedBanLeft((n) => {
        const next = Math.max(0, n - 1);
        // When the countdown hits 0 trigger a one-shot /me refresh so
        // the server-side ban gate clears.
        if (next === 0) { try { refreshMe?.(); } catch {} }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [rankedBanLeft, refreshMe]);
  const rankedBanned = rankedBanLeft > 0;
  const rankedBanLabel = rankedBanned
    ? `${Math.floor(rankedBanLeft / 60)}:${String(rankedBanLeft % 60).padStart(2, "0")}`
    : "";

  const joinRankedQueue = async () => {
    if (rankedLocked) {
      alert(`Ranked unlocks at Level ${RANKED_MIN_LEVEL}. You are Level ${userLevel}.`);
      return;
    }
    const r = await queueCtx?.joinRanked();
    if (r && !r.ok) { alert("Failed to join queue: " + r.error); return; }
    // Queue-start fanfare — three-note arpeggio so the player gets a
    // clear "you're in the queue" audio confirmation alongside the
    // visual SEARCHING toast.
    try { audioBus.playQueueStart(); } catch {}
  };

  const cancelRankedQueue = async () => {
    await queueCtx?.cancelRanked();
  };

  const stats = user?.stats || { kills: 0, deaths: 0, matches: 0, wins: 0 };

  // Season-aware lobby background. Fetch /api/season once on mount; switch
  // to the meteor-themed backdrop when the live season has rolled over to
  // Season 2 (or later). Admin accounts always see the meteor preview so
  // the Season 2 art can be reviewed before the timer flips for everyone.
  const [seasonNumber, setSeasonNumber] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/season");
        if (alive) setSeasonNumber(Number(r?.data?.season_number ?? 1) || 1);
      } catch {
        if (alive) setSeasonNumber(1);
      }
    })();
    return () => { alive = false; };
  }, []);
  // Compute the effective lobby background variant. Priority:
  //   1. Explicit user setting (`lobbyBackgroundVariant`), if not "auto"
  //      AND the user is allowed to pick it (see filter below).
  //   2. Auto: current season → default / meteor / snow.
  // Season 3+ ships the snowy backdrop to everyone; admins get it
  // early as a preview.
  const isAdmin = user?.role === "admin";
  const autoVariant =
    seasonNumber !== null && seasonNumber >= 3 ? "snow" :
    seasonNumber !== null && seasonNumber >= 2 ? "meteor" :
    "default";
  const [pickedVariant, setPickedVariant] = useState(() => settingsStore.get().lobbyBackgroundVariant || "auto");
  useEffect(() => {
    const onChange = () => setPickedVariant(settingsStore.get().lobbyBackgroundVariant || "auto");
    window.addEventListener("virtue-settings-changed", onChange);
    return () => window.removeEventListener("virtue-settings-changed", onChange);
  }, []);
  // A variant is available if it's the current auto pick OR the user
  // has played the season that shipped it (past_seasons contains it),
  // OR the user is admin. Season→variant map:
  //   S1 → default, S2 → meteor, S3+ → snow.
  const finishedSeasons = new Set((user?.past_seasons || []).map((e) => Number(e?.season) || 0));
  const canUseVariant = (v) => {
    if (v === "auto") return true;
    if (isAdmin) return true;
    if (v === autoVariant) return true;
    if (v === "default") return finishedSeasons.has(1) || (seasonNumber !== null && seasonNumber >= 1);
    if (v === "meteor")  return finishedSeasons.has(2) || (seasonNumber !== null && seasonNumber >= 2);
    if (v === "snow")    return finishedSeasons.has(3) || (seasonNumber !== null && seasonNumber >= 3);
    return false;
  };
  const effectiveVariant = (pickedVariant !== "auto" && canUseVariant(pickedVariant))
    ? pickedVariant
    : autoVariant;
  const showSnowBg   = effectiveVariant === "snow";
  const showMeteorBg = effectiveVariant === "meteor";

  // Initialise audio mute states + volumes from settings/localStorage so the
  // bus reflects user prefs immediately on mount.
  useEffect(() => {
    try {
      audioBus.setMusicMuted(localStorage.getItem("lobby_music_muted") === "1");
      audioBus.setSfxMuted(localStorage.getItem("sfx_muted") === "1");
      const s = settingsStore.get();
      audioBus.setMasterVolume?.(s.masterVolume ?? 0.9);
      audioBus.setMusicVolume?.(s.musicVolume ?? 0.32);
      audioBus.setSfxVolume?.(s.sfxVolume ?? 0.65);
    } catch {}
  }, []);

  // Live-subscribe to the lobby-animated-background toggle so flipping
  // the setting in the modal swaps the backdrop instantly without a
  // page reload.
  const [animatedBg, setAnimatedBg] = useState(() => settingsStore.get().lobbyAnimatedBackground !== false);
  useEffect(() => {
    const onChange = () => setAnimatedBg(settingsStore.get().lobbyAnimatedBackground !== false);
    window.addEventListener("virtue-settings-changed", onChange);
    return () => window.removeEventListener("virtue-settings-changed", onChange);
  }, []);

  // Subscribe to the global `virtue-rankup` event so any rank-up (e.g. after
  // a WARPSPEED redeem from the Account settings) plays the celebration
  // overlay even though the user isn't in a match.
  useEffect(() => {
    const onRankUp = (e) => {
      const d = e?.detail || {};
      if (!d.new_tier) return;
      // If the event explicitly tagged itself as a division-up OR the
      // prev/new tier indexes match (only the sub-division changed),
      // play the lighter "PROMOTED" variant. Otherwise it's a main-tier
      // promotion.
      const prevIdx = d.prev_tier?.idx ?? 0;
      const newIdx = d.new_tier?.idx ?? 0;
      const sameTier = prevIdx === newIdx;
      const explicitDivision = d.kind === "division";
      const kind = (explicitDivision || sameTier) ? "division" : "tier";
      setRankUp({
        prevTier: d.prev_tier || { idx: 0, name: "BRONZE", division: 3 },
        newTier:  d.new_tier,
        rpDelta:  d.rp_delta ?? 0,
        newPoints: d.new_points ?? 0,
        kind,
      });
    };
    window.addEventListener("virtue-rankup", onRankUp);
    return () => window.removeEventListener("virtue-rankup", onRankUp);
  }, []);

  // Replay a pending rank-up celebration if Game.jsx parked one in
  // localStorage. Triggered after the player returns to the lobby
  // (either by clicking "Back to Lobby" on the match-end overlay or
  // by being auto-dropped after AFK). Without this, a player who
  // closes the tab between match-end and pressing Back never sees the
  // celebration. We delay 600ms so the lobby has a beat to settle —
  // dispatching mid-mount would race with the user card data load and
  // look jarring.
  //
  // Important: the localStorage `removeItem` MUST happen inside the
  // setTimeout (after dispatch), not before. React StrictMode dev-mode
  // mounts the effect twice — if we cleared eagerly, the first mount
  // would erase the key + queue a timer, the cleanup would cancel it,
  // and the second mount would find nothing → overlay never plays.
  useEffect(() => {
    let raw = null;
    try { raw = localStorage.getItem("virtue.pendingRankUp"); } catch {}
    if (!raw) return;
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    if (!payload?.newTier) return;
    const t = setTimeout(() => {
      try {
        // Drop the key right before dispatch so a slow user navigating
        // away & back during this 600ms window doesn't double-fire.
        localStorage.removeItem("virtue.pendingRankUp");
      } catch {}
      try {
        // Mimic the `virtue-rankup` event shape — it's identical to the
        // payload we just stored (camelCase tier names), so the existing
        // onRankUp handler ingests it without translation.
        window.dispatchEvent(new CustomEvent("virtue-rankup", { detail: {
          prev_tier: { idx: payload.prevTier?.idx, name: payload.prevTier?.name, division: payload.prevTier?.division },
          new_tier:  { idx: payload.newTier?.idx,  name: payload.newTier?.name,  division: payload.newTier?.division },
          rp_delta: payload.rpDelta,
          new_points: payload.newPoints,
          kind: payload.kind,
        }}));
      } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, []);

  // Auto-clear ?disconnected=1 from URL after 5s, hide the toast.
  useEffect(() => {
    if (!disconnected) return;
    const t = setTimeout(() => {
      setDisconnected(false);
      if (searchParams.get("disconnected")) {
        searchParams.delete("disconnected");
        setSearchParams(searchParams, { replace: true });
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [disconnected, searchParams, setSearchParams]);

  // Auto-clear ?spectate_ended=1 from URL after 5s.
  useEffect(() => {
    if (!spectateEnded) return;
    const t = setTimeout(() => {
      setSpectateEnded(false);
      if (searchParams.get("spectate_ended")) {
        searchParams.delete("spectate_ended");
        searchParams.delete("target");
        setSearchParams(searchParams, { replace: true });
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [spectateEnded, searchParams, setSearchParams]);

  // Poll active player counts every 3s — disabled. The lobby now shows a
  // single fluctuating "Players online" widget driven client-side; real per-
  // room counts are no longer surfaced in the UI.

  // Players Online widget removed — the polling that drove the chip was
  // also removed to avoid a hanging interval the UI no longer uses.

  // Lobby music. Try to start immediately — the user almost always
  // arrived here by clicking the SIGN IN button, which counts as a user
  // gesture in the same document, so the AudioContext is already unlocked.
  // If autoplay is still blocked (e.g. direct-nav / SSR-style first visit),
  // fall back to the first interaction listener.
  useEffect(() => {
    let started = false;
    // The lobby music variant follows the same effective-variant gate
    // as the lobby background so the audio/visual pairing always
    // matches (default → default loop, meteor → dark remix, snow →
    // chime/bell remix of the default). Recomputed on every variant
    // change so a season rollover or a setting toggle hot-swaps the
    // loop in place.
    const variant = effectiveVariant;
    const tryStart = () => {
      if (started) return;
      audioBus.startLobbyMusic(variant);
      // Verify audio actually started. If the context is still suspended
      // after the call, defer to the interaction listener below.
      const ctxState = audioBus.ctx?.state;
      if (ctxState && ctxState !== "suspended") {
        started = true;
        document.removeEventListener("click", tryStart);
        document.removeEventListener("keydown", tryStart);
        document.removeEventListener("touchstart", tryStart);
        document.removeEventListener("pointerdown", tryStart);
      }
    };
    // Immediate attempt — works whenever the AudioContext is already
    // unlocked (which is true after login / any prior interaction).
    tryStart();
    document.addEventListener("click", tryStart);
    document.addEventListener("keydown", tryStart);
    document.addEventListener("touchstart", tryStart);
    document.addEventListener("pointerdown", tryStart);
    return () => {
      audioBus.stopLobbyMusic();
      document.removeEventListener("click", tryStart);
      document.removeEventListener("keydown", tryStart);
      document.removeEventListener("touchstart", tryStart);
      document.removeEventListener("pointerdown", tryStart);
    };
  }, [effectiveVariant]);

  // Refresh the user payload whenever the Lobby mounts. After completing
  // a ranked match (where rank_points / rank_tier / level / coins can all
  // change) the user navigates back here — without an explicit refetch
  // the UI stays stuck on the stale values from the previous /me call
  // until a hard refresh. Also re-fetches when the tab is re-focused so
  // a player who alt-tabbed during a match sees the new values.
  useEffect(() => {
    refreshMe?.();
    const onVis = () => { if (document.visibilityState === "visible") refreshMe?.(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startQuickQueue = async () => {
    if (casualInQueue) return;
    setFoundRealPlayers(0);
    const r = await queueCtx?.joinCasual();
    if (r && !r.ok) {
      alert("Failed to join queue: " + r.error);
      return;
    }
    // Queue-start fanfare — same audio cue ranked uses so both
    // matchmaking entry points feel symmetric.
    try { audioBus.playQueueStart(); } catch {}
  };

  const cancelQuickQueue = async () => {
    await queueCtx?.cancelCasual();
  };

  // Party invite polling — refresh every 5s while the lobby is open.
  const [partyInvites, setPartyInvites] = useState([]);
  const [party, setParty] = useState(null);
  // Miss counter for /party/me — a single "no party" response used to
  // instantly nuke the panel, so any transient blip (worker gc, JWT
  // clock skew, load-balancer hiccup on prod) caused the party UI to
  // flash off, then reappear on the next poll. Match the ranked-queue
  // pattern: require 3 consecutive "no party" responses (~15s at 5s
  // poll cadence) before believing the user actually left.
  const partyMissesRef = useRef(0);
  const refreshParty = useCallback(async () => {
    try {
      const { data } = await api.get("/party/me");
      if (data && data.party_id) {
        // Confirmed in-party. Reset miss counter and slam state.
        partyMissesRef.current = 0;
        setParty(data);
      } else {
        // Server explicitly says "no party" — but be defensive against
        // transient nulls (race between PARTY_MEMBER_INDEX rebuild
        // and the read). Require N consecutive nulls before clearing.
        partyMissesRef.current += 1;
        if (partyMissesRef.current >= 3) {
          setParty(null);
        }
      }
    } catch (e) {
      const status = e?.response?.status;
      if (status === 404) {
        // Explicit 404 also goes through miss-tolerance (same
        // rationale: don't nuke UI on a single flake).
        partyMissesRef.current += 1;
        if (partyMissesRef.current >= 3) {
          setParty(null);
        }
      }
      if (status === 401) {
        // Auth genuinely died — clear immediately, the user needs to
        // re-login and the panel would be stale anyway.
        setParty(null);
        partyMissesRef.current = 0;
      }
      // Other failures (timeout, 5xx, network): leave existing state.
    }
  }, []);
  useEffect(() => {
    let alive = true;
    const fetchAll = async () => {
      try {
        const { data } = await api.get("/party/invites");
        if (alive) {
          setPartyInvites((prev) => {
            const newOnes = data.filter((d) => !prev.some((p) => p.party_id === d.party_id));
            if (newOnes.length > 0) {
              try { audioBus.matchFound(); } catch {}
            }
            return data;
          });
        }
      } catch {}
      refreshParty();
    };
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [refreshParty]);

  // News unread-count poll — every 30s while the lobby is open. Also
  // listens for the `virtue-news-read` event the News page dispatches
  // so the badge clears the instant the user navigates back.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/news/unread");
        if (alive) setNewsUnread(Number(data?.count || 0));
      } catch {
        // Silent — keep last known value on transient errors.
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    const onRead = () => setNewsUnread(0);
    window.addEventListener("virtue-news-read", onRead);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("virtue-news-read", onRead);
    };
  }, []);

  const acceptInvite = async (invite) => {
    try {
      await api.post("/party/accept", { username: invite.from_username });
      setPartyInvites((p) => p.filter((i) => i.party_id !== invite.party_id));
      await refreshParty();
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
    }
  };
  const declineInvite = async (invite) => {
    try { await api.post("/party/decline", { username: invite.from_username }); } catch {}
    setPartyInvites((p) => p.filter((i) => i.party_id !== invite.party_id));
  };

  // Quick-match queue ticker removed — wait time + match-found detection
  // now live in QueueContext (joinCasual). The lobby renders the toast
  // from `casualWaitSec` / `casualQueueState` and lets the context drive
  // the navigation when the server confirms a match.

  // Casual room status poll — every 1s while the casual queue is active.
  // Surfaces the number of OTHER real players currently in the shared
  // casual room so the toast can show "X PLAYER(S) FOUND" while the
  // server-side queue is still searching. Purely cosmetic — the queue's
  // own `matched` flag (driven by QueueContext) is the source of truth
  // for actually starting the match.
  useEffect(() => {
    if (!casualInQueue) {
      setFoundRealPlayers(0);
      return;
    }
    let alive = true;
    const check = async () => {
      try {
        const { data } = await api.get("/queue/casual/status");
        if (alive) setFoundRealPlayers(Number(data?.real_players || 0));
      } catch {
        // Silent — keep last known value on transient errors.
      }
    };
    check();
    const id = setInterval(check, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [casualInQueue]);

  // Ranked match-found countdown is handled inside QueueContext.

  // Audio/sensitivity/logout moved into Settings modal. We still need to
  // initialise the audio bus mute state from localStorage on first load.

  return (
    <div
      className="relative h-[100dvh] lg:h-screen overflow-hidden bg-black flex flex-col"
      data-testid="lobby-page"
    >
      {showSnowBg ? (
        <>
          <span className="hidden" data-testid="lobby-bg-snow" data-active="true" />
          <LobbyBackgroundSnow animated={animatedBg} />
        </>
      ) : showMeteorBg ? (
        <>
          <span className="hidden" data-testid="lobby-bg-meteor" data-active="true" />
          <LobbyBackgroundMeteor animated={animatedBg} />
        </>
      ) : (
        <>
          <span className="hidden" data-testid="lobby-bg-default" data-active="true" />
          <LobbyBackground imageUrl={LOBBY_BG} />
        </>
      )}

      <header className="relative z-20 flex items-center justify-between flex-wrap gap-y-2 px-3 sm:px-6 md:px-12 py-2 md:py-3">
        {/* Left side intentionally empty — the large VIRTUE logo lives in
            the main column below so the header reads as a thin utility bar. */}
        <div />
        <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
          {user && (
            <PlayerCard
              size="sm"
              username={user.username}
              avatar={user.avatar ?? 0}
              rankTier={user.rank_tier ?? 0}
              rankName={user.rank_name || "BRONZE"}
              rankDivision={user.rank_division ?? 0}
              rankPoints={user.rank_points ?? 0}
              peakRankTier={user.peak_rank_tier ?? user.rank_tier ?? 0}
              peakRankDivision={user.peak_rank_division ?? user.rank_division ?? 0}
              bannerIcon={user.banner_icon ?? null}
              bannerColor={user.banner_color ?? null}
              bannerAnimated={!!user.banner_animated}
              bannerTitle={formatBannerTitle(user)}
              bannerTitleClass={bannerTitleAnimClass(user)}
              level={user.level ?? 1}
              leaderboardRank={user.leaderboard_rank ?? null}
              online
              className="hidden sm:inline-flex"
              testid="lobby-user-card"
            />
          )}
          {/* Players Online widget removed per request. */}
          {/* Coin balance — clickable, opens the skin shop. Always visible
              (even on mobile) so the wallet value is glanceable. */}
          <button
            onClick={() => setShowShop(true)}
            className="border-pow shadow-pow-sm px-3 py-2 flex items-center gap-2 hover:translate-y-[-1px] transition-transform"
            style={{ background: "#FFD700", color: "#0A0A0A" }}
            data-testid="lobby-coins-badge"
            title="Open Shop"
          >
            <Coins size={14} strokeWidth={3} />
            <span className="font-anton uppercase text-[10px] tracking-widest opacity-80 hidden sm:inline">Coins</span>
            <span className="font-display text-xl sm:text-2xl leading-none">{user?.coins ?? 0}</span>
          </button>
          {/* Combined PASS + SHOP button — opens ProgressionModal which
              has both the season-pass tab and a new "SHOP" tab. The
              coin pill above is still a quick-open into the standalone
              ShopModal so the wallet stays one click from a purchase. */}
          <button
            onClick={() => setShowProgression(true)}
            className="btn-pow bg-[#0055FF] text-white [&]:px-3 [&]:py-2 sm:[&]:px-6 sm:[&]:py-3"
            data-testid="lobby-progression-button"
            title="Season Pass, Skin Shop, Challenges & Dailies"
          >
            <span className="flex items-center gap-2"><Sparkles size={18} strokeWidth={3} /><span className="hidden sm:inline">PASS</span></span>
          </button>
          <button
            onClick={() => setShowFriends(true)}
            className="btn-pow bg-[#06A35F] text-white [&]:px-3 [&]:py-2 sm:[&]:px-8 sm:[&]:py-3"
            data-testid="lobby-friends-button"
            title="Friends list"
          >
            <span className="flex items-center gap-2"><UserPlus size={18} strokeWidth={3} /><span className="hidden sm:inline">FRIENDS</span></span>
          </button>
          <button
            onClick={() => nav("/news")}
            className="btn-pow bg-[#9B59B6] text-white [&]:px-3 [&]:py-2 sm:[&]:px-6 sm:[&]:py-3 relative"
            data-testid="lobby-news-button"
            title="News & announcements"
          >
            <span className="flex items-center gap-2"><Megaphone size={18} strokeWidth={3} /><span className="hidden sm:inline">NEWS</span></span>
            {newsUnread > 0 && (
              <span
                className="absolute -top-2 -right-2 min-w-[20px] h-[20px] px-1 bg-[#E62429] text-white border-2 border-black font-anton text-[10px] tabular-nums flex items-center justify-center"
                data-testid="lobby-news-unread-badge"
                title={`${newsUnread} unread`}
              >
                {newsUnread > 99 ? "99+" : newsUnread}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="btn-pow bg-white text-black [&]:px-3 [&]:py-2 sm:[&]:px-8 sm:[&]:py-3"
            data-testid="lobby-settings-button"
            title="Audio, sensitivity, install, logout"
          >
            <span className="flex items-center gap-2"><SettingsIcon size={18} strokeWidth={3} /></span>
          </button>
          {/* Exit to desktop. window.close() succeeds only for windows
              that were script-opened (e.g. the installed PWA), so we
              attempt it AND swap the page out for a goodbye screen as a
              guaranteed fallback that works in normal tabs too. The user
              gets a clear "you can close this tab now" cue either way. */}
          <button
            onClick={() => {
              if (!window.confirm("Exit VIRTUE?")) return;
              try { audioBus.stopLobbyMusic(); } catch {}
              try {
                // Best-effort close — works on PWA / popups / window.opener
                window.close();
              } catch {}
              // Fallback: replace the page with a comic-style goodbye so
              // the user knows it's safe to close. Uses location.replace
              // so back-button doesn't bring them back into the lobby.
              setTimeout(() => {
                document.body.innerHTML = `
                  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F4F5;font-family:'Anton',sans-serif">
                    <div style="text-align:center;padding:2rem 3rem;background:white;border:4px solid #000;box-shadow:8px 8px 0 #000;transform:rotate(-1.5deg)">
                      <h1 style="font-family:'Bangers',cursive;color:#E62429;font-size:4rem;margin:0;letter-spacing:0.05em">SEE YOU SOON!</h1>
                    </div>
                  </div>`;
              }, 80);
            }}
            className="btn-pow bg-[#222] text-white [&]:px-3 [&]:py-2 sm:[&]:px-6 sm:[&]:py-3"
            data-testid="lobby-exit-button"
            title="Exit to desktop"
          >
            <span className="flex items-center gap-2"><LogOut size={18} strokeWidth={3} /><span className="hidden sm:inline">EXIT</span></span>
          </button>
        </div>
      </header>

      <main
        className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-6 px-3 sm:px-6 md:px-12 lg:px-20 -mt-12 sm:-mt-20 lg:mt-2 flex-1 min-h-0 overflow-hidden"
      >
        <div className="lg:col-span-4 -mt-4 lg:mt-6 min-h-0 overflow-y-auto pr-1">
          {/* Big VIRTUE logo replaces the old "READY UP, name!" header. */}
          <h1
            className="font-display text-5xl sm:text-7xl md:text-8xl uppercase text-pow-shadow-lg leading-none mt-0"
            data-testid="lobby-hero-logo"
          >
            <span className="text-[#FFD700]">VIR</span><span className="text-[#E62429]">TUE</span>
          </h1>

          <div className="mt-0.5 sm:mt-1 flex flex-wrap items-center gap-2 sm:gap-3" data-testid="rank-badge-row">
            <RankBadge tier={user?.rank_tier ?? 0} name={user?.rank_name || "BRONZE"} division={user?.rank_division ?? 0} points={user?.rank_points || 0} />
            {user?.in_placements && (
              <div
                className="border-pow shadow-pow-sm flex items-center bg-[#9B59B6] text-white"
                data-testid="placement-streak-badge"
                title="Placement streak: 2x RP gains, no losses for your first 5 ranked matches."
              >
                <div className="px-2 sm:px-3 py-1.5 sm:py-2 flex items-center gap-1.5 sm:gap-2">
                  <Star size={14} strokeWidth={3} className="text-[#FFD700]" />
                  <span className="font-anton uppercase text-[10px] sm:text-xs tracking-widest">
                    <span className="sm:hidden">P</span><span className="hidden sm:inline">PLACEMENTS</span>
                  </span>
                  <span className="font-display text-base sm:text-xl leading-none">
                    {user?.placement_matches_played ?? 0}/{user?.placement_matches_total ?? 5}
                  </span>
                </div>
                <div className="bg-[#FFD700] text-black font-anton uppercase tracking-widest text-[10px] sm:text-xs px-2 py-1.5 sm:py-2">
                  2x<span className="hidden sm:inline"> RP</span>
                </div>
              </div>
            )}
            <button
              onClick={() => setShowTiers(true)}
              className="btn-pow bg-white text-black !hidden sm:!inline-block"
              data-testid="show-tiers-button"
            >
              <span className="flex items-center gap-2"><Award size={16} strokeWidth={3} /> SHOW TIERS</span>
            </button>
          </div>

          {/* Rank progress to next sub-division (or next main tier from I). */}
          <div className="mt-2 sm:mt-3 max-w-md" data-testid="lobby-rank-progress-wrap">
            <RankProgressBar
              tier={user?.rank_tier ?? 0}
              division={user?.rank_division ?? 0}
              points={user?.rank_points ?? 0}
              testid="lobby-rank-progress"
            />
          </div>

          <div className="mt-1 sm:mt-2 space-y-1.5 sm:space-y-3 max-w-md">
            {party && (
              <PartyPanel party={party} myId={user?.id} refresh={refreshParty} className="mb-3" />
            )}
            <button
              onClick={casualInQueue ? undefined : startQuickQueue}
              disabled={casualInQueue || (party && party.leader_id !== user?.id)}
              className="btn-pow bg-[#E62429] text-white w-full text-lg sm:text-3xl [&]:py-2 sm:[&]:py-3 disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="lobby-play-button"
            >
              <span className="flex items-center gap-3">
                {casualInQueue ? <Loader2 size={22} strokeWidth={3} className="animate-spin" /> : <Play size={22} strokeWidth={3} />}
                {casualInQueue ? `MATCHING...` : "QUICK MATCH"}
              </span>
            </button>
            <button
              onClick={queueState ? undefined : joinRankedQueue}
              disabled={!!queueState || rankedLocked || rankedBanned}
              className="btn-pow bg-[#0055FF] text-white w-full text-lg sm:text-3xl [&]:py-2 sm:[&]:py-3 disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="lobby-ranked-button"
              title={
                rankedLocked ? `Ranked unlocks at Level ${RANKED_MIN_LEVEL}`
                : rankedBanned ? `Ranked locked for ${rankedBanLabel} — left a previous match (-${RANKED_LEAVE_RP_LOSS} RP)`
                : undefined
              }
            >
              <span className="flex items-center gap-3">
                {rankedLocked || rankedBanned ? (
                  <Lock size={20} strokeWidth={3} />
                ) : queueState && !queueState.matched ? (
                  <Loader2 size={20} strokeWidth={3} className="animate-spin" />
                ) : (
                  <Trophy size={20} strokeWidth={3} />
                )}
                {rankedLocked
                  ? `RANKED · LV ${RANKED_MIN_LEVEL}`
                  : rankedBanned
                  /* Ranked early-leave penalty countdown lives directly
                     on the button so the player sees the lock fall
                     without clicking through to discover a 403. */
                  ? `RANKED LOCKED · ${rankedBanLabel}`
                  : queueState
                  ? (queueState.matched ? "MATCH FOUND" : "IN QUEUE...")
                  : "RANKED MATCH"}
              </span>
            </button>
            {/* Combined PRACTICE button — opens the map/mode selector
                which lets the user pick between RANGE (no enemies) and
                VS AI (full bot match), plus FFA/TDM and the arena.
                Replaces the prior two separate buttons. */}
            <button
              type="button"
              onClick={() => setPracticeSelectorMode("practice")}
              className="btn-pow bg-[#9B59B6] text-white w-full text-base sm:text-lg [&]:py-2 sm:[&]:py-3"
              data-testid="lobby-practice-button"
            >
              <span className="flex items-center gap-3"><Mouse size={18} strokeWidth={3} /> PRACTICE</span>
            </button>
            <Link to="/leaderboard" draggable={false} onDragStart={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }} className="btn-pow bg-[#FFD700] text-black w-full text-base sm:text-lg [&]:py-2 sm:[&]:py-3 select-none" data-testid="lobby-leaderboard-button">
              <span className="flex items-center gap-3"><Trophy size={18} strokeWidth={3} /> LEADERBOARD</span>
            </Link>
            <Link to="/profile" draggable={false} onDragStart={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }} className="btn-pow bg-white text-black w-full text-base sm:text-lg [&]:py-2 sm:[&]:py-3 select-none" data-testid="lobby-profile-button">
              <span className="flex items-center gap-3"><User size={18} strokeWidth={3} /> PROFILE</span>
            </Link>
            {user?.role === "admin" && (
              <Link to="/admin/reports" draggable={false} onDragStart={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }} className="btn-pow bg-[#E62429] text-white w-full text-base sm:text-lg [&]:py-2 sm:[&]:py-3 select-none" data-testid="lobby-admin-button">
                <span className="flex items-center gap-3"><Shield size={18} strokeWidth={3} /> MODERATION</span>
              </Link>
            )}
          </div>

          {/* Players-online widget moved to the header (top-right). The old
              KILLS/DEATHS/MATCHES/K-D stat strip was removed per request — the
              same stats are still surfaced inside the Profile page. */}
        </div>

        {/* Middle column intentionally left empty — the lobby's
            background comic-style typography (BOOM!/BLAZE!/IMPACT!)
            fills the gutter visually without competing for attention
            with the queue buttons or the daily panel. */}
        <div className="lg:col-span-4 hidden lg:block" aria-hidden />

        <div className="lg:col-span-4 relative hidden lg:flex flex-col items-stretch gap-3 pt-6 xl:pt-8 min-h-0 overflow-hidden">
          {/* The daily panel can grow taller than the viewport when 6
              dailies are queued — wrap it in a flex-1/min-h-0 container
              so the panel itself stays inside the lobby's frame and
              scrolls internally instead of pushing the page taller. */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <LobbyDailyPanel />
          </div>
        </div>
      </main>

      {/* Controls + Sensitivity cards removed — moved to Settings modal. */}

      {/* Tiers modal */}
      {showTiers && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" data-testid="tiers-modal" onClick={() => setShowTiers(false)}>
          <div className="card-pow p-0 w-full max-w-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="bg-black text-white px-6 py-3 flex items-center justify-between flex-shrink-0">
              <div className="font-display text-3xl text-[#FFD700]">RANK TIERS</div>
              <button onClick={() => setShowTiers(false)} className="font-anton" data-testid="tiers-close">
                <X size={20} strokeWidth={3} />
              </button>
            </div>
            <div className="overflow-y-auto bg-white">
              {RANK_TIERS.map((t, i) => {
                const next = RANK_TIERS[i + 1];
                const tierTop = next ? next.min - 1 : null;
                const isGoon = t.name === "GOONMASTER";
                // 3 sub-divisions for non-Goonmaster tiers: III (entry),
                // II (middle), I (top). RP bands are equal thirds of the
                // tier's range. Indexes: division 3 → low band, 1 → high band.
                const subDivs = isGoon ? null : [3, 2, 1].map((divIdx, k) => {
                  const span = next.min - t.min;
                  const low = t.min + Math.round((span * (3 - divIdx)) / 3);
                  const high = t.min + Math.round((span * (4 - divIdx)) / 3) - 1;
                  return { divIdx, low, high };
                });
                const youAreHere = (user?.rank_tier ?? 0) === i;
                return (
                  <div
                    key={t.name}
                    className={`border-t-2 border-black ${youAreHere ? "bg-[#FFF7D6]" : ""}`}
                    data-testid={`tier-row-${i}`}
                  >
                    {/* Tier header: # · animated icon · name · full RP range */}
                    <div className="grid grid-cols-12 items-center">
                      <div className="col-span-1 font-display text-2xl text-center py-3">{i + 1}</div>
                      <div
                        className="col-span-7 font-display text-2xl py-3 px-3 flex items-center gap-3"
                        style={{ background: t.color, color: isGoon ? "#FFD700" : "#0A0A0A" }}
                      >
                        <AnimatedRankIcon
                          tier={i}
                          division={isGoon ? 0 : 1}
                          size={42}
                          testid={`tier-icon-${i}`}
                        />
                        <span>{t.name}</span>
                        {isGoon && youAreHere && (
                          <span className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 bg-[#FFD700] text-black border-2 border-black" data-testid="tier-you-are-here">
                            YOU
                          </span>
                        )}
                      </div>
                      <div className="col-span-4 font-anton uppercase text-xs sm:text-sm py-3 px-3 tabular-nums">
                        {t.min} {tierTop !== null ? `→ ${tierTop}` : "+"} RP
                      </div>
                    </div>
                    {/* Sub-division rows (skip for Goonmaster). */}
                    {subDivs && (
                      <div className="bg-neutral-50 border-t border-black/10">
                        {subDivs.map(({ divIdx, low, high }) => {
                          const here = youAreHere && (user?.rank_division ?? 0) === divIdx;
                          const roman = { 1: "I", 2: "II", 3: "III" }[divIdx];
                          return (
                            <div
                              key={divIdx}
                              className={`grid grid-cols-12 items-center border-t border-black/10 first:border-t-0 ${here ? "bg-[#FFD700]" : ""}`}
                              data-testid={`tier-${i}-div-${divIdx}`}
                            >
                              <div className="col-span-1" />
                              <div className="col-span-7 flex items-center gap-3 py-2 px-3">
                                <AnimatedRankIcon
                                  tier={i}
                                  division={divIdx}
                                  size={28}
                                  testid={`tier-${i}-div-${divIdx}-icon`}
                                />
                                <span className="font-anton uppercase tracking-widest text-sm">
                                  {t.name} {roman}
                                </span>
                                {here && (
                                  <span className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 bg-black text-[#FFD700] border-2 border-black" data-testid="tier-you-are-here">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <div className="col-span-4 font-anton text-xs py-2 px-3 tabular-nums text-neutral-600">
                                {low} → {high} RP
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="border-t-4 border-black bg-[#FFD700] px-4 py-3 font-anton uppercase text-xs leading-relaxed">
                <div>BELOW MASTERS: +30 (1st) · +15 (2nd) · 0 (3rd) · -30 (lower)</div>
                <div>MASTERS+: +30 (1st) · 0 (2nd) · -60 (3rd) · -60 (lower)</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <FriendsModal
        open={showFriends}
        onClose={() => { setShowFriends(false); setWhisperOpenWith(null); }}
        initialWhisperWith={whisperOpenWith}
      />
      {/* Lobby-corner toast for inbound whispers — polls every 6s, toasts
          a fresh "Friend: text" card when a new DM lands. Clicking the
          toast opens the Friends modal pre-navigated to that chat. */}
      <WhisperToaster
        onOpenWhisper={(friend) => {
          setWhisperOpenWith(friend);
          setShowFriends(true);
        }}
      />
      <ShopModal open={showShop} onClose={() => setShowShop(false)} />
      <ProgressionModal open={showProgression} onClose={() => setShowProgression(false)} />
      <PracticeMapSelector
        open={!!practiceSelectorMode}
        mode={practiceSelectorMode || "practice"}
        onClose={() => setPracticeSelectorMode(null)}
        onSelect={(mapId, opts = {}) => {
          // The selector now owns the practice vs offline choice (its
          // own toggle, since we combined the two lobby buttons). The
          // returned `opts.mode` overrides the modal's `mode` prop.
          const selectedMode = opts.mode || practiceSelectorMode;
          setPracticeSelectorMode(null);
          const mapQuery = mapId ? `&map=${mapId}` : "";
          // TDM toggle from the selector — pass through to the WS URL so
          // the server routes the join into the team-mode room.
          const tdmQuery = opts.tdm ? "&tdm=1" : "";
          navigateToMatch(
            nav,
            `/play?mode=${selectedMode}${mapQuery}${tdmQuery}`,
            { mode: "offline", username: user?.username, tdm: !!opts.tdm },
          );
        }}
      />
      {/* MatchLoadingScreen now lives at the App root so it persists across
          the Lobby → /play route change (see App.js). */}

      {/* Rank-up celebration — fires after a tier-skip redeem. The overlay
          self-dismisses after ~6.5s and can be clicked through. */}
      <RankUpOverlay
        open={!!rankUp}
        prevTier={rankUp?.prevTier}
        newTier={rankUp?.newTier}
        rpDelta={rankUp?.rpDelta}
        newPoints={rankUp?.newPoints}
        kind={rankUp?.kind || "tier"}
        onClose={() => setRankUp(null)}
      />

      {/* Party invite toasts (top-right) */}
      {partyInvites.length > 0 && (
        <div className="fixed top-6 right-4 z-50 w-full max-w-xs space-y-2" data-testid="party-invite-stack">
          {partyInvites.map((inv) => (
            <div key={inv.party_id} className="card-pow p-0 overflow-hidden" data-testid={`party-invite-${inv.party_id}`}>
              <div className="bg-[#0055FF] text-white px-3 py-1.5 font-anton uppercase tracking-widest text-xs flex items-center gap-2">
                <Users size={14} strokeWidth={3} /> PARTY INVITE
              </div>
              <div className="bg-white px-3 py-3">
                <div className="font-anton uppercase">{inv.from_username}</div>
                <div className="text-xs text-neutral-500 font-anton uppercase tracking-widest mt-0.5">wants to squad up</div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => acceptInvite(inv)} className="btn-pow bg-[#06A35F] text-white flex-1 [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`party-accept-${inv.party_id}`}>
                    <span>JOIN</span>
                  </button>
                  <button onClick={() => declineInvite(inv)} className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`party-decline-${inv.party_id}`}>
                    <span><X size={14} strokeWidth={3} /></span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick-match (casual) queue toast — count UP from 0; "Searching" header. */}
      {casualInQueue && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4" data-testid="quick-queue-toast">
          <div className="card-pow p-0 overflow-hidden">
            <div className="px-4 py-2 flex items-center gap-2 text-white bg-[#E62429]">
              <Loader2 size={18} strokeWidth={3} className="animate-spin" />
              <span className="font-anton uppercase tracking-widest text-sm flex-1" data-testid="quick-queue-header">
                {casualQueueState?.matched
                  ? "Match Found"
                  : foundRealPlayers > 0
                  ? `${foundRealPlayers} Player${foundRealPlayers === 1 ? "" : "s"} Found`
                  : "Searching for players"}
              </span>
              <button onClick={cancelQuickQueue} className="font-anton hover:opacity-80 ml-1" data-testid="quick-queue-cancel" title="Cancel">
                <X size={16} strokeWidth={3} />
              </button>
            </div>
            <div className="px-4 py-3 bg-white text-center">
              <div
                className="font-display text-6xl leading-none tabular-nums text-[#E62429]"
                data-testid="quick-queue-timer"
              >
                {casualWaitSec}
              </div>
              <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
                <div className="border-pow-thin font-anton uppercase tracking-widest text-xs px-2 py-0.5 bg-[#E62429] text-white">
                  CASUAL · FFA
                </div>
              </div>
              {!casualQueueState?.matched && Number.isFinite(casualQueueState?.estimated_wait_seconds) && (
                <div
                  className="mt-2 font-anton uppercase text-[11px] tracking-widest text-neutral-500"
                  data-testid="quick-queue-eta"
                >
                  Est. wait <span className="text-[#E62429] tabular-nums">~{casualQueueState.estimated_wait_seconds}s</span>
                </div>
              )}
              <button
                onClick={cancelQuickQueue}
                className="mt-3 btn-pow bg-[#E62429] text-white w-full [&]:py-2 [&]:text-sm"
                data-testid="quick-queue-leave-button"
              >
                <span className="flex items-center justify-center gap-2">
                  <X size={16} strokeWidth={3} /> LEAVE QUEUE
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spectate ended toast — target no longer in a match */}
      {spectateEnded && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4" data-testid="spectate-ended-toast">
          <div className="card-pow p-0 overflow-hidden">
            <div className="px-4 py-2 flex items-center gap-2 bg-[#FFD700] text-black">
              <WifiOff size={18} strokeWidth={3} />
              <span className="font-anton uppercase tracking-widest text-sm flex-1">Spectate Ended</span>
              <button onClick={() => setSpectateEnded(false)} className="font-anton hover:opacity-80" data-testid="spectate-ended-toast-close" title="Dismiss">
                <X size={16} strokeWidth={3} />
              </button>
            </div>
            <div className="px-4 py-3 bg-white">
              <p className="font-body text-xs text-neutral-700">
                {spectateEndedTarget ? <><span className="font-anton uppercase">{spectateEndedTarget}</span> is no longer in a match.</> : "That player is no longer in a match."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Disconnected toast — auto-kicked back from a match */}
      {disconnected && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4" data-testid="disconnected-toast">
          <div className="card-pow p-0 overflow-hidden">
            <div className="px-4 py-2 flex items-center gap-2 bg-[#E62429] text-white">
              <WifiOff size={18} strokeWidth={3} />
              <span className="font-anton uppercase tracking-widest text-sm flex-1">Connection Lost</span>
              <button onClick={() => setDisconnected(false)} className="font-anton hover:opacity-80" data-testid="disconnected-toast-close" title="Dismiss">
                <X size={16} strokeWidth={3} />
              </button>
            </div>
            <div className="px-4 py-3 bg-white">
              <p className="font-body text-xs text-neutral-700">You were disconnected from the match. You're safely back in the lobby.</p>
            </div>
          </div>
        </div>
      )}

      {/* Ranked queue toast is rendered globally via <QueueOverlay /> in App.js
          so it persists across Lobby / Profile / Leaderboard navigations. */}
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

function fmtMS(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

const RANK_TIERS = [
  { name: "BRONZE", min: 0, color: "#CD7F32" },
  { name: "SILVER", min: 300, color: "#C0C0C0" },
  { name: "GOLD", min: 600, color: "#FFD700" },
  { name: "PLATINUM", min: 900, color: "#5BC0EB" },
  { name: "DIAMOND", min: 1200, color: "#9D4EDD" },
  { name: "MASTER", min: 1500, color: "#E63946" },
  { name: "GRANDMASTER", min: 1800, color: "#06D6A0" },
  { name: "GOONMASTER", min: 2100, color: "#000000" },
];

const RANK_COLORS = RANK_TIERS.map(t => t.color);

function RankBadge({ tier, name, division, points }) {
  const color = RANK_COLORS[Math.max(0, Math.min(7, tier))];
  const textColor = tier === 7 ? "#FFD700" : "#0A0A0A";
  const roman = { 1: "I", 2: "II", 3: "III" }[Number(division || 0)] || "";
  return (
    <div className="border-pow shadow-pow-sm flex items-center gap-0" data-testid="rank-badge">
      <div
        // Generous padding + visible overflow so the rank icon's
        // division-aware ornaments (orbiting sparkles for div 2/1,
        // rotating halo ring for div 1 + Goonmaster, flame flicker for
        // Goonmaster) can extend slightly past the rank-icon box
        // without being clipped by the colored cell.
        className="flex items-center justify-center px-3 py-2 relative"
        style={{ background: color, overflow: "visible" }}
      >
        <AnimatedRankIcon tier={tier} division={division} size={48} testid="rank-badge-icon" />
      </div>
      <div className="font-display px-4 py-2 text-2xl uppercase flex items-baseline gap-1.5" style={{ background: color, color: textColor }}>
        <span>{name}</span>
        {roman && tier !== 7 && (
          <span className="font-anton text-sm tracking-widest opacity-90" data-testid="rank-badge-division">{roman}</span>
        )}
      </div>
      <div className="bg-white px-3 py-2 font-anton uppercase tracking-widest text-sm">
        {points} <span className="opacity-60">RP</span>
      </div>
    </div>
  );
}

function ControlKey() { return null; }
// eslint-disable-next-line no-unused-vars
const _CK = ControlKey;
