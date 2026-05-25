import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import audioBus from "@/game/audio";
import settingsStore from "@/game/settings";
import api from "@/api";
import { Trophy, User, Play, Mouse, Users, Award, X, Loader2, Star, WifiOff, Settings as SettingsIcon, UserPlus, Lock, Coins, ShoppingBag, Sparkles } from "lucide-react";
import SettingsModal from "@/components/SettingsModal";
import PlayerCard from "@/components/PlayerCard";
import FriendsModal from "@/components/FriendsModal";
import PartyPanel from "@/components/PartyPanel";
import LobbyBackground from "@/components/LobbyBackground";
import RankUpOverlay from "@/components/RankUpOverlay";
import ShopModal from "@/components/ShopModal";
import ProgressionModal from "@/components/ProgressionModal";
import { useQueue } from "@/context/QueueContext";

const LOBBY_BG = "https://static.prod-images.emergentagent.com/jobs/956e5f81-3c5a-4b45-a2da-bf26ea4fc4d1/images/3fd8a6f43a33db82e29a81462fb7d356c6de26372ea5ffabff63ed8db4358583.png";

export default function Lobby() {
  // logout still available via Settings modal — it pulls its own useAuth().
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [disconnected, setDisconnected] = useState(searchParams.get("disconnected") === "1");
  const [spectateEnded, setSpectateEnded] = useState(searchParams.get("spectate_ended") === "1");
  const spectateEndedTarget = searchParams.get("target") || "";
  const [showSettings, setShowSettings] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showProgression, setShowProgression] = useState(false);
  // Rank-up celebration overlay. Triggered by a global `virtue-rankup` event
  // dispatched after a successful redeem of a tier-skip code (e.g. WARPSPEED).
  const [rankUp, setRankUp] = useState(null); // { prevTier, newTier, rpDelta, newPoints }
  const [quickQueueSec, setQuickQueueSec] = useState(null); // null | 0..target
  // Random per-attempt target wait for Quick Match (2..9s, capped under 10s).
  // Re-rolled every time the player clicks QUICK MATCH so the queue feels
  // organic instead of always landing on exactly 10.
  const [quickQueueTarget, setQuickQueueTarget] = useState(8);
  const [showTiers, setShowTiers] = useState(false);
  // (Removed `counts` state — replaced by client-side `displayOnline` below.)
  // Ranked queue state now lives in the global QueueContext so the toast
  // persists when navigating to Profile/Leaderboard.
  const queueCtx = useQueue();
  const queueState = queueCtx?.queueState ?? null;

  // Ranked unlock gate — server enforces too. Mirrors RANKED_MIN_LEVEL in server.py.
  const RANKED_MIN_LEVEL = 5;
  const userLevel = user?.level ?? 1;
  const rankedLocked = userLevel < RANKED_MIN_LEVEL;

  const joinRankedQueue = async () => {
    if (rankedLocked) {
      alert(`Ranked unlocks at Level ${RANKED_MIN_LEVEL}. You are Level ${userLevel}.`);
      return;
    }
    const r = await queueCtx?.joinRanked();
    if (r && !r.ok) alert("Failed to join queue: " + r.error);
  };

  const cancelRankedQueue = async () => {
    await queueCtx?.cancelRanked();
  };

  const stats = user?.stats || { kills: 0, deaths: 0, matches: 0, wins: 0 };

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

  // Subscribe to the global `virtue-rankup` event so any rank-up (e.g. after
  // a WARPSPEED redeem from the Account settings) plays the celebration
  // overlay even though the user isn't in a match.
  useEffect(() => {
    const onRankUp = (e) => {
      const d = e?.detail || {};
      if (!d.new_tier) return;
      setRankUp({
        prevTier: d.prev_tier || { idx: 0, name: "BRONZE" },
        newTier:  d.new_tier,
        rpDelta:  d.rp_delta ?? 0,
        newPoints: d.new_points ?? 0,
      });
    };
    window.addEventListener("virtue-rankup", onRankUp);
    return () => window.removeEventListener("virtue-rankup", onRankUp);
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

  // Combined "Players online" counter — server-driven so every client sees
  // the same number. The backend drifts the value slowly (~10s cadence) in
  // [3, 35]; we poll every 6s and update locally.
  const [displayOnline, setDisplayOnline] = useState(12);
  useEffect(() => {
    let alive = true;
    const fetchOnline = async () => {
      try {
        const { data } = await api.get("/");
        if (!alive) return;
        if (typeof data?.players_online === "number") {
          setDisplayOnline(data.players_online);
        }
      } catch {}
    };
    fetchOnline();
    const id = setInterval(fetchOnline, 6000);
    return () => { alive = false; clearInterval(id); };
  }, []);

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

  const startQuickQueue = () => {
    if (quickQueueSec !== null) return;
    // Re-roll the target wait each click: 2..9 seconds inclusive.
    setQuickQueueTarget(2 + Math.floor(Math.random() * 8));
    setQuickQueueSec(0);
  };

  const cancelQuickQueue = () => setQuickQueueSec(null);

  // Party invite polling — refresh every 5s while the lobby is open.
  const [partyInvites, setPartyInvites] = useState([]);
  const [party, setParty] = useState(null);
  const refreshParty = useCallback(async () => {
    try {
      const { data } = await api.get("/party/me");
      setParty(data.party_id ? data : null);
    } catch { setParty(null); }
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

  // Quick-match queue ticker: count UP from 0 → randomized target (2-9s, hard
  // cap below 10s). The "matchmaking" beat feels intentional but no longer
  // lands on exactly 10 every time. The casual room is shared + bot-filled
  // by the backend, so the wait is purely cosmetic on the client.
  useEffect(() => {
    if (quickQueueSec === null) return;
    if (quickQueueSec >= quickQueueTarget) {
      nav("/play?mode=casual");
      return;
    }
    const id = setTimeout(() => setQuickQueueSec((s) => (s === null ? null : s + 1)), 1000);
    return () => clearTimeout(id);
  }, [quickQueueSec, quickQueueTarget, nav]);

  // Ranked match-found countdown is handled inside QueueContext.

  // Audio/sensitivity/logout moved into Settings modal. We still need to
  // initialise the audio bus mute state from localStorage on first load.

  return (
    <div className="relative min-h-[100dvh] lg:min-h-screen overflow-hidden bg-black" data-testid="lobby-page">
      <LobbyBackground imageUrl={LOBBY_BG} />

      <header className="relative z-10 flex items-center justify-between flex-wrap gap-y-2 px-3 sm:px-6 md:px-12 py-2 md:py-3">
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
              rankPoints={user.rank_points ?? 0}
              peakRankTier={user.peak_rank_tier ?? user.rank_tier ?? 0}
              bannerIcon={user.banner_icon ?? null}
              bannerColor={user.banner_color ?? null}
              bannerAnimated={!!user.banner_animated}
              level={user.level ?? 1}
              online
              className="hidden sm:inline-flex"
              testid="lobby-user-card"
            />
          )}
          {/* Server-driven Players Online chip — same value for every signed-
              in client; drifts every ~10s via /api/. */}
          <div
            className="border-pow shadow-pow-sm px-3 py-2 hidden sm:flex items-center gap-2"
            style={{ background: "#E62429", color: "#fff" }}
            data-testid="active-players-online"
          >
            <Users size={14} strokeWidth={3} />
            <span className="font-anton uppercase text-[10px] tracking-widest opacity-90">Online</span>
            <span className="font-display text-2xl leading-none">{displayOnline}</span>
          </div>
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
          <button
            onClick={() => setShowShop(true)}
            className="btn-pow bg-[#9B59B6] text-white [&]:px-3 [&]:py-2 sm:[&]:px-6 sm:[&]:py-3"
            data-testid="lobby-shop-button"
            title="Skin shop"
          >
            <span className="flex items-center gap-2"><ShoppingBag size={18} strokeWidth={3} /><span className="hidden sm:inline">SHOP</span></span>
          </button>
          <button
            onClick={() => setShowProgression(true)}
            className="btn-pow bg-[#0055FF] text-white [&]:px-3 [&]:py-2 sm:[&]:px-6 sm:[&]:py-3"
            data-testid="lobby-progression-button"
            title="Season Pass, Challenges & Dailies"
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
            onClick={() => setShowSettings(true)}
            className="btn-pow bg-white text-black [&]:px-3 [&]:py-2 sm:[&]:px-8 sm:[&]:py-3"
            data-testid="lobby-settings-button"
            title="Audio, sensitivity, install, logout"
          >
            <span className="flex items-center gap-2"><SettingsIcon size={18} strokeWidth={3} /></span>
          </button>
        </div>
      </header>

      <main className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-8 px-3 sm:px-6 md:px-12 lg:px-20 mt-0 sm:mt-1">
        <div className="lg:col-span-7">
          {/* Big VIRTUE logo replaces the old "READY UP, name!" header. */}
          <h1
            className="font-display text-5xl sm:text-7xl md:text-8xl uppercase text-pow-shadow-lg leading-none -mt-1"
            data-testid="lobby-hero-logo"
          >
            <span className="text-[#FFD700]">VIR</span><span className="text-[#E62429]">TUE</span>
          </h1>

          <div className="mt-1 sm:mt-2 flex flex-wrap items-center gap-2 sm:gap-3" data-testid="rank-badge-row">
            <RankBadge tier={user?.rank_tier ?? 0} name={user?.rank_name || "BRONZE"} points={user?.rank_points || 0} />
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

          <div className="mt-2 sm:mt-4 space-y-1.5 sm:space-y-3 max-w-md">
            {party && (
              <PartyPanel party={party} myId={user?.id} refresh={refreshParty} className="mb-3" />
            )}
            <button
              onClick={quickQueueSec !== null ? undefined : startQuickQueue}
              disabled={quickQueueSec !== null || (party && party.leader_id !== user?.id)}
              className="btn-pow bg-[#E62429] text-white w-full text-lg sm:text-3xl [&]:py-2 sm:[&]:py-3 disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="lobby-play-button"
            >
              <span className="flex items-center gap-3">
                {quickQueueSec !== null ? <Loader2 size={22} strokeWidth={3} className="animate-spin" /> : <Play size={22} strokeWidth={3} />}
                {quickQueueSec !== null ? `MATCHING...` : "QUICK MATCH"}
              </span>
            </button>
            <button
              onClick={queueState ? undefined : joinRankedQueue}
              disabled={!!queueState || rankedLocked}
              className="btn-pow bg-[#0055FF] text-white w-full text-lg sm:text-3xl [&]:py-2 sm:[&]:py-3 disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="lobby-ranked-button"
              title={rankedLocked ? `Ranked unlocks at Level ${RANKED_MIN_LEVEL}` : undefined}
            >
              <span className="flex items-center gap-3">
                {rankedLocked ? (
                  <Lock size={20} strokeWidth={3} />
                ) : queueState && !queueState.matched ? (
                  <Loader2 size={20} strokeWidth={3} className="animate-spin" />
                ) : (
                  <Trophy size={20} strokeWidth={3} />
                )}
                {rankedLocked
                  ? `RANKED · LV ${RANKED_MIN_LEVEL}`
                  : queueState
                  ? (queueState.matched ? "MATCH FOUND" : "IN QUEUE...")
                  : "RANKED MATCH"}
              </span>
            </button>
            <Link to="/play?mode=practice" className="btn-pow bg-[#9B59B6] text-white w-full text-base sm:text-lg [&]:py-2 sm:[&]:py-3" data-testid="lobby-practice-button">
              <span className="flex items-center gap-3"><Mouse size={18} strokeWidth={3} /> PRACTICE RANGE</span>
            </Link>
            <Link to="/play?mode=offline" className="btn-pow bg-[#06A35F] text-white w-full text-base sm:text-lg [&]:py-2 sm:[&]:py-3" data-testid="lobby-offline-button">
              <span className="flex items-center gap-3"><WifiOff size={18} strokeWidth={3} /> OFFLINE VS AI</span>
            </Link>
            <Link to="/leaderboard" className="btn-pow bg-[#FFD700] text-black w-full text-base sm:text-lg [&]:py-2 sm:[&]:py-3" data-testid="lobby-leaderboard-button">
              <span className="flex items-center gap-3"><Trophy size={18} strokeWidth={3} /> LEADERBOARD</span>
            </Link>
            <Link to="/profile" className="btn-pow bg-white text-black w-full text-base sm:text-lg [&]:py-2 sm:[&]:py-3" data-testid="lobby-profile-button">
              <span className="flex items-center gap-3"><User size={18} strokeWidth={3} /> PROFILE</span>
            </Link>
          </div>

          {/* Players-online widget moved to the header (top-right). The old
              KILLS/DEATHS/MATCHES/K-D stat strip was removed per request — the
              same stats are still surfaced inside the Profile page. */}
        </div>

        <div className="lg:col-span-5 relative hidden lg:flex items-center justify-center">
          {/* Match info panel removed per request */}
        </div>
      </main>

      {/* Controls + Sensitivity cards removed — moved to Settings modal. */}

      {/* Tiers modal */}
      {showTiers && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-6" data-testid="tiers-modal" onClick={() => setShowTiers(false)}>
          <div className="card-pow p-0 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="bg-black text-white px-6 py-3 flex items-center justify-between">
              <div className="font-display text-3xl text-[#FFD700]">RANK TIERS</div>
              <button onClick={() => setShowTiers(false)} className="font-anton" data-testid="tiers-close">
                <X size={20} strokeWidth={3} />
              </button>
            </div>
            {RANK_TIERS.map((t, i) => (
              <div key={t.name} className="grid grid-cols-12 border-t-2 border-black items-center" data-testid={`tier-row-${i}`}>
                <div className="col-span-1 font-display text-2xl text-center bg-white py-3">{i + 1}</div>
                <div className="col-span-6 font-display text-2xl py-3 px-4" style={{ background: t.color, color: t.name === "GOONMASTER" ? "#FFD700" : "#0A0A0A" }}>
                  {t.name}
                </div>
                <div className="col-span-5 font-anton uppercase text-sm py-3 px-4 bg-white">
                  {t.min} RP {RANK_TIERS[i + 1] ? `→ ${RANK_TIERS[i + 1].min - 1} RP` : "+"}
                </div>
              </div>
            ))}
            <div className="border-t-4 border-black bg-[#FFD700] px-4 py-3 font-anton uppercase text-sm">
              +30 RP (1st) · +15 (2nd) · +5 (3rd) · -10 (lower)
            </div>
          </div>
        </div>
      )}

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <FriendsModal open={showFriends} onClose={() => setShowFriends(false)} />
      <ShopModal open={showShop} onClose={() => setShowShop(false)} />
      <ProgressionModal open={showProgression} onClose={() => setShowProgression(false)} />

      {/* Rank-up celebration — fires after a tier-skip redeem. The overlay
          self-dismisses after ~6.5s and can be clicked through. */}
      <RankUpOverlay
        open={!!rankUp}
        prevTier={rankUp?.prevTier}
        newTier={rankUp?.newTier}
        rpDelta={rankUp?.rpDelta}
        newPoints={rankUp?.newPoints}
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
      {quickQueueSec !== null && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4" data-testid="quick-queue-toast">
          <div className="card-pow p-0 overflow-hidden">
            <div className="px-4 py-2 flex items-center gap-2 text-white bg-[#E62429]">
              <Loader2 size={18} strokeWidth={3} className="animate-spin" />
              <span className="font-anton uppercase tracking-widest text-sm flex-1" data-testid="quick-queue-header">Searching</span>
              <button onClick={cancelQuickQueue} className="font-anton hover:opacity-80 ml-1" data-testid="quick-queue-cancel" title="Cancel">
                <X size={16} strokeWidth={3} />
              </button>
            </div>
            <div className="px-4 py-3 bg-white text-center">
              <div
                className="font-display text-6xl text-[#E62429] leading-none tabular-nums"
                data-testid="quick-queue-timer"
              >
                {quickQueueSec}
              </div>
              <div className="mt-2 flex items-center justify-center gap-2">
                <div className="border-pow-thin font-anton uppercase tracking-widest text-xs px-2 py-0.5 bg-[#E62429] text-white">
                  CASUAL · FFA
                </div>
              </div>
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
  { name: "SILVER", min: 100, color: "#C0C0C0" },
  { name: "GOLD", min: 250, color: "#FFD700" },
  { name: "PLATINUM", min: 500, color: "#5BC0EB" },
  { name: "DIAMOND", min: 800, color: "#9D4EDD" },
  { name: "MASTER", min: 1200, color: "#E63946" },
  { name: "GRANDMASTER", min: 1700, color: "#06D6A0" },
  { name: "GOONMASTER", min: 2300, color: "#000000" },
];

const RANK_COLORS = RANK_TIERS.map(t => t.color);

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

function ControlKey() { return null; }
// eslint-disable-next-line no-unused-vars
const _CK = ControlKey;
