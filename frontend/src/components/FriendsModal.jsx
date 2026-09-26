// Friends modal — manage requests, browse friends, search, block.
//
// Tabs: Friends · Incoming (badge) · Outgoing · Blocked · Search.
// Each row uses the Avatar component + per-action buttons.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, UserPlus, UserMinus, UserCheck, UserX, Ban, Search, Loader2, Send, Eye, User, MessageCircle } from "lucide-react";
import api from "@/api";
import { Avatar } from "@/components/PlayerCard";
import AnimatedRankIcon from "@/components/AnimatedRankIcon";
import { divisionRoman } from "@/game/rankIcons";
import PublicProfileModal from "@/components/PublicProfileModal";
import WhisperChat from "@/components/WhisperChat";

const TABS = [
  { id: "friends",  label: "FRIENDS" },
  { id: "incoming", label: "INCOMING" },
  { id: "outgoing", label: "SENT" },
  { id: "blocked",  label: "BLOCKED" },
  { id: "search",   label: "ADD" },
];

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#2ECC71", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

// Format a unix timestamp (seconds) as a short relative-time string.
// Used to show "LAST SEEN 5m AGO" / "2H AGO" / "3D AGO" / "JUST NOW" on offline friends.
function formatRelativeTime(unixSeconds) {
  if (!unixSeconds) return "OFFLINE";
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diff < 45) return "JUST NOW";
  if (diff < 90) return "1M AGO";
  if (diff < 3600) return `${Math.round(diff / 60)}M AGO`;
  if (diff < 5400) return "1H AGO";
  if (diff < 86400) return `${Math.round(diff / 3600)}H AGO`;
  if (diff < 86400 * 2) return "1D AGO";
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}D AGO`;
  if (diff < 86400 * 30) return `${Math.round(diff / (86400 * 7))}W AGO`;
  return "LONG AGO";
}

export default function FriendsModal({ open, onClose, initialWhisperWith = null }) {
  const [tab, setTab] = useState("friends");
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [], blocked: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profileUsername, setProfileUsername] = useState(null);
  // Whisper state: when set, the modal body swaps from the friend
  // list to a 1:1 chat panel for this friend. `unread` maps
  // friend.id → integer unread-count so each row can show a red pill.
  const [whisperFriend, setWhisperFriend] = useState(null);
  const [unread, setUnread] = useState({});
  const nav = useNavigate();

  // When the parent opens us with a pre-selected friend (e.g. the
  // lobby's WhisperToaster wants to dive straight into a chat) we
  // honor the request only on the *transition into* open — otherwise
  // closing the chat panel inside the modal would immediately re-open
  // it.
  useEffect(() => {
    if (open && initialWhisperWith) {
      setWhisperFriend(initialWhisperWith);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialWhisperWith?.username]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/friends");
      setData(data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // Silent refresh — same fetch as `refresh` but doesn't toggle the
  // loading spinner or wipe existing state on transient errors. Used
  // by the live-status poller so the friends list updates its
  // "ONLINE / LAST SEEN 5M AGO / IN MATCH" chips every few seconds
  // without any UI blink or "Loading..." flash. On a failed fetch we
  // silently keep the last-known data — a WiFi hiccup shouldn't nuke
  // the currently-visible list.
  const silentRefresh = useCallback(async () => {
    try {
      const { data } = await api.get("/friends");
      setData(data);
    } catch {
      /* keep previous data on transient failure */
    }
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const { data } = await api.get("/whispers/unread");
      setUnread(data?.by_sender || {});
    } catch {
      // Soft-fail — keep previous map so the badges don't flicker.
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    refreshUnread();
    // Re-poll unread counts every 6s while the modal is open so a
    // friend's message lands on the list with a red pill within a
    // few seconds even if you're sitting on the Friends tab.
    const unreadId = setInterval(refreshUnread, 6000);
    // ALSO poll the friend list itself every 6s so the ONLINE /
    // OFFLINE / IN MATCH / LAST SEEN chips stay fresh without needing
    // the user to close+reopen the modal. Uses `silentRefresh` so no
    // spinner flash and no error banner on a transient WiFi hiccup.
    // The `last_seen_at` bumps happen on every 20Hz WS tick (see
    // server.py `_tick`) so a friend that logs in / off is reflected
    // in the next poll cycle (< 6s worst case).
    const statusId = setInterval(silentRefresh, 6000);
    // Bonus: fire an immediate silent refresh whenever the tab becomes
    // visible again (e.g. the user Alt-Tabs back to the game). Fixes
    // the "I've been AFK for 20 minutes so all my friends now show
    // stale data until the next 6s tick" edge case.
    const onVisibility = () => {
      if (document.visibilityState === "visible") silentRefresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(unreadId);
      clearInterval(statusId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open, refresh, refreshUnread, silentRefresh]);

  // Reset the chat panel when the modal closes so the next open
  // returns to the friend list.
  useEffect(() => {
    if (!open) setWhisperFriend(null);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-6" data-testid="friends-modal" onClick={onClose}>
      <div className="card-pow p-0 w-full max-w-xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between">
          <div className="font-display text-2xl sm:text-3xl text-[#FFD700]">FRIENDS</div>
          <button onClick={onClose} className="font-anton hover:opacity-80" data-testid="friends-close">
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        <div className="flex border-b-4 border-black overflow-x-auto">
          {TABS.map((t) => {
            const badge = t.id === "incoming" ? data.incoming.length : 0;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 min-w-fit px-3 py-2 font-anton uppercase text-xs tracking-widest border-r-2 border-black relative ${tab === t.id ? "bg-[#FFD700] text-black" : "bg-white text-neutral-700 hover:bg-neutral-100"}`}
                data-testid={`friends-tab-${t.id}`}
              >
                {t.label}
                {badge > 0 && (
                  <span className="absolute top-1 right-1 bg-[#E62429] text-white text-[10px] font-anton px-1.5 rounded-full border border-black" data-testid="friends-incoming-badge">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* When a whisper conversation is open we replace the entire
            body (tab nav stays accessible after BACK in the chat
            header). Keeps the modal a single column on mobile. */}
        {whisperFriend ? (
          <WhisperChat
            friend={whisperFriend}
            onBack={() => setWhisperFriend(null)}
            onAfterSend={refreshUnread}
          />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {error && (
              <div className="px-5 py-3 bg-[#E62429]/10 border-b-2 border-[#E62429] text-[#E62429] font-anton uppercase text-xs" data-testid="friends-error">
                {error}
              </div>
            )}
            {loading && (
              <div className="px-5 py-6 font-anton uppercase text-center text-neutral-500" data-testid="friends-loading">
                <Loader2 size={20} strokeWidth={3} className="inline animate-spin mr-2" /> Loading...
              </div>
            )}

            {!loading && tab === "friends" && <FriendList list={data.friends} mode="friend" onChange={refresh} nav={nav} onInspect={setProfileUsername} unread={unread} onWhisper={(u) => { setWhisperFriend(u); refreshUnread(); }} />}
            {!loading && tab === "incoming" && <FriendList list={data.incoming} mode="incoming" onChange={refresh} nav={nav} onInspect={setProfileUsername} unread={unread} onWhisper={(u) => { setWhisperFriend(u); refreshUnread(); }} />}
            {!loading && tab === "outgoing" && <FriendList list={data.outgoing} mode="outgoing" onChange={refresh} nav={nav} onInspect={setProfileUsername} />}
            {!loading && tab === "blocked" && <FriendList list={data.blocked} mode="blocked" onChange={refresh} nav={nav} onInspect={setProfileUsername} />}
            {!loading && tab === "search" && <SearchPanel onChange={refresh} onInspect={setProfileUsername} />}
          </div>
        )}
      </div>
      <PublicProfileModal
        username={profileUsername}
        onClose={() => setProfileUsername(null)}
      />
    </div>
  );
}

function FriendList({ list, mode, onChange, nav, onInspect, unread, onWhisper }) {
  if (!list || list.length === 0) {
    return (
      <div className="px-5 py-8 text-center" data-testid={`friends-empty-${mode}`}>
        <div className="font-anton uppercase text-neutral-400">
          {mode === "friend" && "No friends yet. Try the ADD tab."}
          {mode === "incoming" && "No incoming requests."}
          {mode === "outgoing" && "No pending sent requests."}
          {mode === "blocked" && "No blocked users."}
        </div>
      </div>
    );
  }
  return (
    <div className="divide-y-2 divide-black/10">
      {list.map((u, i) => (
        <FriendRow
          key={u.id}
          idx={i}
          u={u}
          mode={mode}
          onChange={onChange}
          nav={nav}
          onInspect={onInspect}
          unreadCount={unread?.[u.id] || 0}
          onWhisper={onWhisper}
        />
      ))}
    </div>
  );
}

function FriendRow({ idx, u, mode, onChange, nav, onInspect, unreadCount = 0, onWhisper }) {
  const [busy, setBusy] = useState(false);

  const act = async (path, body) => {
    setBusy(true);
    try {
      if (path.startsWith("DELETE ")) {
        await api.delete(path.replace("DELETE ", ""));
      } else {
        await api.post(path, body);
      }
      await onChange();
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const rankColor = RANK_COLORS[Math.max(0, Math.min(8, u.rank_tier ?? 0))];
  const rankText = (u.rank_tier ?? 0) === 8 ? "#FFD700" : "#0A0A0A";

  return (
    <div
      className={`px-3 sm:px-5 py-3 flex items-center gap-3 transition-colors hover:bg-[#FFF7D6] ${
        u.in_match ? "border-l-4 border-l-[#E62429]" :
        u.in_queue ? "border-l-4 border-l-[#0055FF]" :
        u.online   ? "border-l-4 border-l-[#06A35F]" :
                     "border-l-4 border-l-transparent"
      }`}
      data-testid={`friend-row-${mode}-${idx}`}
    >
      <Avatar idx={u.avatar} size={42} online={u.online} testid={`friend-avatar-${idx}`} />
      <div className="flex-1 min-w-0">
        <div className="font-anton uppercase text-base truncate flex items-center gap-2" data-testid={`friend-username-${idx}`}>
          <span>{u.username}</span>
          {/* Level chip — gives a quick "newbie vs veteran" read at a glance. */}
          {typeof u.level === "number" && (
            <span className="font-anton uppercase text-[9px] px-1 bg-neutral-900 text-white">
              LV {u.level}
            </span>
          )}
          {/* Unread whisper count — friend-mode only. Red pill stays
              tight so it doesn't push the rank/status row to wrap. */}
          {mode === "friend" && unreadCount > 0 && (
            <span
              className="font-anton uppercase text-[9px] px-1.5 py-0.5 bg-[#E62429] text-white border border-black tabular-nums"
              data-testid={`friend-unread-${idx}`}
              title={`${unreadCount} new whisper${unreadCount === 1 ? "" : "s"}`}
            >
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {/* Rank icon + text pill — same "tier icon + rank name + division"
              pattern the leaderboard uses so a friend's status reads at a
              glance without opening their profile. */}
          <AnimatedRankIcon
            tier={u.rank_tier ?? 0}
            division={u.rank_division ?? 0}
            size={22}
            testid={`friend-rank-icon-${idx}`}
          />
          <span
            className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border border-black"
            style={{ background: rankColor, color: rankText }}
          >
            {u.rank_name}{divisionRoman(u.rank_division) ? ` ${divisionRoman(u.rank_division)}` : ""}
          </span>
          {/* Ranked leaderboard position — only shown when the server
              attached `leaderboard_rank` (top-50 GOONMASTER = Ultimate
              Gooner). Gives friends a quick "#7 on the ladder" read
              without opening the leaderboard tab. */}
          {Number.isFinite(u.leaderboard_rank) && u.leaderboard_rank >= 1 && u.leaderboard_rank <= 50 && (
            <span
              className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border border-black bg-[#FFD700] text-[#0A0A0A] tabular-nums"
              data-testid={`friend-leaderboard-rank-${idx}`}
              title={`#${u.leaderboard_rank} on the current-season leaderboard`}
            >
              #{u.leaderboard_rank}
            </span>
          )}
          <span className="text-[10px] font-anton uppercase tracking-widest text-neutral-500">{u.rank_points} RP</span>
          {/* Status chip — priority: in-match > in-queue > online > offline.
              Lets you see at a glance what a friend is doing right now. */}
          {u.in_match ? (
            <span
              className="text-[10px] font-anton uppercase tracking-widest px-1.5 py-0.5 bg-[#E62429] text-white border border-black flex items-center gap-1"
              data-testid={`friend-status-${idx}`}
              data-status="in-match"
            >
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              IN MATCH{u.match_kind ? ` · ${String(u.match_kind).toUpperCase()}` : ""}
            </span>
          ) : u.in_queue ? (
            <span
              className="text-[10px] font-anton uppercase tracking-widest px-1.5 py-0.5 bg-[#0055FF] text-white border border-black flex items-center gap-1"
              data-testid={`friend-status-${idx}`}
              data-status="in-queue"
              data-queue-kind={u.queue_kind || "ranked"}
            >
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              {/* Suffix the queue label with the specific kind so a
                  friend hunting for a duo partner can tell at a glance
                  whether the target is queueing Ranked, Quick Match,
                  or 12P FFA. Fallback keeps the old "IN QUEUE" copy
                  for any deploys mid-rollout where the server hasn't
                  yet exposed `queue_kind`. */}
              IN QUEUE{
                u.queue_kind === "casual" ? " · QUICK" :
                u.queue_kind === "bigffa" ? " · 12P FFA" :
                u.queue_kind === "ranked" ? " · RANKED" : ""
              }
            </span>
          ) : (
            <span
              className={`text-[10px] font-anton uppercase tracking-widest ${u.online ? "text-[#06A35F]" : "text-neutral-400"}`}
              data-testid={`friend-status-${idx}`}
              data-status={u.online ? "online" : "offline"}
            >
              {u.online ? "● ONLINE" : (u.last_seen_at ? `LAST SEEN ${formatRelativeTime(u.last_seen_at)}` : "OFFLINE")}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {mode === "incoming" && (
          <>
            <button disabled={busy} onClick={() => act("/friends/accept", { username: u.username })} className="btn-pow bg-[#06A35F] text-white [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`friend-accept-${idx}`}>
              <span className="flex items-center gap-1"><UserCheck size={14} strokeWidth={3} /> ACCEPT</span>
            </button>
            <button disabled={busy} onClick={() => act("/friends/decline", { username: u.username })} className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`friend-decline-${idx}`}>
              <span className="flex items-center gap-1"><UserX size={14} strokeWidth={3} /></span>
            </button>
          </>
        )}
        {mode === "outgoing" && (
          <button disabled={busy} onClick={() => act(`DELETE /friends/${u.username}`)} className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`friend-cancel-${idx}`}>
            <span className="flex items-center gap-1"><X size={14} strokeWidth={3} /> CANCEL</span>
          </button>
        )}
        {mode === "friend" && (
          <>
            {/* Whisper button — always available on a friend row
                (online or offline; offline users will see the
                whisper when they next log in). */}
            <button
              onClick={() => onWhisper?.({ id: u.id, username: u.username, avatar: u.avatar })}
              className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5 [&]:text-xs relative"
              data-testid={`friend-whisper-${idx}`}
              title="Send a whisper"
            >
              <span className="flex items-center gap-1">
                <MessageCircle size={14} strokeWidth={3} />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-2 h-2 bg-[#E62429] rounded-full border border-black"
                    aria-hidden
                  />
                )}
              </span>
            </button>
            {u.online && !u.in_match && !u.in_queue && (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.post("/party/invite", { username: u.username });
                    alert(`Party invite sent to ${u.username}`);
                    await onChange();
                  } catch (e) {
                    alert(e.response?.data?.detail || e.message);
                  } finally { setBusy(false); }
                }}
                className="btn-pow bg-[#0055FF] text-white [&]:px-3 [&]:py-1.5 [&]:text-xs"
                data-testid={`friend-invite-${idx}`}
                title="Invite to party"
              >
                <span className="flex items-center gap-1"><Send size={14} strokeWidth={3} /> INVITE</span>
              </button>
            )}
            {u.online && u.in_match && (
              <button
                onClick={() => nav(`/spectate/${encodeURIComponent(u.username)}`)}
                className="btn-pow bg-[#FFD700] text-black [&]:px-3 [&]:py-1.5 [&]:text-xs"
                data-testid={`friend-spectate-${idx}`}
                title="Spectate match"
              >
                <span className="flex items-center gap-1"><Eye size={14} strokeWidth={3} /> SPECTATE</span>
              </button>
            )}
            <button
              onClick={() => onInspect?.(u.username)}
              className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5 [&]:text-xs"
              data-testid={`friend-inspect-${idx}`}
              title="View profile"
            >
              <span className="flex items-center gap-1"><User size={14} strokeWidth={3} /></span>
            </button>
            <button disabled={busy} onClick={() => act(`DELETE /friends/${u.username}`)} className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`friend-remove-${idx}`}>
              <span className="flex items-center gap-1"><UserMinus size={14} strokeWidth={3} /></span>
            </button>
            <button disabled={busy} onClick={() => act("/friends/block", { username: u.username })} className="btn-pow bg-[#E62429] text-white [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`friend-block-${idx}`}>
              <span className="flex items-center gap-1"><Ban size={14} strokeWidth={3} /></span>
            </button>
          </>
        )}
        {mode === "blocked" && (
          <button disabled={busy} onClick={() => act("/friends/unblock", { username: u.username })} className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`friend-unblock-${idx}`}>
            <span className="flex items-center gap-1">UNBLOCK</span>
          </button>
        )}
      </div>
    </div>
  );
}

function SearchPanel({ onChange, onInspect }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(q.trim())}`);
        if (alive) setResults(data);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setBusy(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const sendRequest = async (username) => {
    try {
      await api.post("/friends/request", { username });
      await onChange();
      alert(`Friend request sent to ${username}`);
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 border-2 border-black px-3 py-2 bg-white">
        <Search size={16} strokeWidth={3} className="text-neutral-500 flex-shrink-0" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by username..."
          className="flex-1 outline-none font-anton uppercase tracking-widest text-sm bg-transparent"
          data-testid="friends-search-input"
          autoFocus
        />
        {busy && <Loader2 size={14} strokeWidth={3} className="animate-spin text-neutral-500" />}
      </div>
      <div className="mt-3 divide-y-2 divide-black/10" data-testid="friends-search-results">
        {q.trim().length < 2 && (
          <div className="px-1 py-6 text-center font-anton uppercase text-neutral-400 text-xs">Type at least 2 characters</div>
        )}
        {q.trim().length >= 2 && !busy && results.length === 0 && (
          <div className="px-1 py-6 text-center font-anton uppercase text-neutral-400 text-xs" data-testid="friends-search-no-results">No players found</div>
        )}
        {results.map((u, i) => {
          const rankColor = RANK_COLORS[Math.max(0, Math.min(8, u.rank_tier ?? 0))];
          return (
            <div key={u.id} className="px-2 py-2 flex items-center gap-3" data-testid={`friends-search-row-${i}`}>
              <Avatar idx={u.avatar} size={36} online={u.online} testid={`search-avatar-${i}`} />
              <div className="flex-1 min-w-0">
                <div className="font-anton uppercase text-sm truncate">{u.username}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <AnimatedRankIcon
                    tier={u.rank_tier ?? 0}
                    division={u.rank_division ?? 0}
                    size={20}
                    testid={`search-rank-icon-${i}`}
                  />
                  <span className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border border-black" style={{ background: rankColor, color: (u.rank_tier ?? 0) === 8 ? "#FFD700" : "#0A0A0A" }}>
                    {u.rank_name}{divisionRoman(u.rank_division) ? ` ${divisionRoman(u.rank_division)}` : ""}
                  </span>
                  {Number.isFinite(u.leaderboard_rank) && u.leaderboard_rank >= 1 && u.leaderboard_rank <= 50 && (
                    <span
                      className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border border-black bg-[#FFD700] text-[#0A0A0A] tabular-nums"
                      data-testid={`search-leaderboard-rank-${i}`}
                      title={`#${u.leaderboard_rank} on the current-season leaderboard`}
                    >
                      #{u.leaderboard_rank}
                    </span>
                  )}
                  <span className="text-[10px] font-anton text-neutral-500">{u.rank_points} RP</span>
                </div>
              </div>
              <button
                onClick={() => onInspect?.(u.username)}
                className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5 [&]:text-xs"
                data-testid={`friends-search-inspect-${i}`}
                title="View profile"
              >
                <span className="flex items-center gap-1"><Eye size={14} strokeWidth={3} /></span>
              </button>
              <button onClick={() => sendRequest(u.username)} className="btn-pow bg-[#06A35F] text-white [&]:px-3 [&]:py-1.5 [&]:text-xs" data-testid={`friends-search-add-${i}`}>
                <span className="flex items-center gap-1"><UserPlus size={14} strokeWidth={3} /> ADD</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
