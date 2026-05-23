// Friends modal — manage requests, browse friends, search, block.
//
// Tabs: Friends · Incoming (badge) · Outgoing · Blocked · Search.
// Each row uses the Avatar component + per-action buttons.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, UserPlus, UserMinus, UserCheck, UserX, Ban, Search, Loader2, Send, Eye, User } from "lucide-react";
import api from "@/api";
import { Avatar } from "@/components/PlayerCard";
import PublicProfileModal from "@/components/PublicProfileModal";

const TABS = [
  { id: "friends",  label: "FRIENDS" },
  { id: "incoming", label: "INCOMING" },
  { id: "outgoing", label: "SENT" },
  { id: "blocked",  label: "BLOCKED" },
  { id: "search",   label: "ADD" },
];

const RANK_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#5BC0EB", "#9D4EDD", "#E63946", "#06D6A0", "#000000"];

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

export default function FriendsModal({ open, onClose }) {
  const [tab, setTab] = useState("friends");
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [], blocked: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profileUsername, setProfileUsername] = useState(null);
  const nav = useNavigate();

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

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

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

          {!loading && tab === "friends" && <FriendList list={data.friends} mode="friend" onChange={refresh} nav={nav} onInspect={setProfileUsername} />}
          {!loading && tab === "incoming" && <FriendList list={data.incoming} mode="incoming" onChange={refresh} nav={nav} onInspect={setProfileUsername} />}
          {!loading && tab === "outgoing" && <FriendList list={data.outgoing} mode="outgoing" onChange={refresh} nav={nav} onInspect={setProfileUsername} />}
          {!loading && tab === "blocked" && <FriendList list={data.blocked} mode="blocked" onChange={refresh} nav={nav} onInspect={setProfileUsername} />}
          {!loading && tab === "search" && <SearchPanel onChange={refresh} onInspect={setProfileUsername} />}
        </div>
      </div>
      <PublicProfileModal
        username={profileUsername}
        onClose={() => setProfileUsername(null)}
      />
    </div>
  );
}

function FriendList({ list, mode, onChange, nav, onInspect }) {
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
        <FriendRow key={u.id} idx={i} u={u} mode={mode} onChange={onChange} nav={nav} onInspect={onInspect} />
      ))}
    </div>
  );
}

function FriendRow({ idx, u, mode, onChange, nav, onInspect }) {
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

  const rankColor = RANK_COLORS[Math.max(0, Math.min(7, u.rank_tier ?? 0))];
  const rankText = (u.rank_tier ?? 0) === 7 ? "#FFD700" : "#0A0A0A";

  return (
    <div className="px-3 sm:px-5 py-3 flex items-center gap-3" data-testid={`friend-row-${mode}-${idx}`}>
      <Avatar idx={u.avatar} size={42} online={u.online} testid={`friend-avatar-${idx}`} />
      <div className="flex-1 min-w-0">
        <div className="font-anton uppercase text-base truncate" data-testid={`friend-username-${idx}`}>
          {u.username}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border border-black"
            style={{ background: rankColor, color: rankText }}
          >
            {u.rank_name}
          </span>
          <span className="text-[10px] font-anton uppercase tracking-widest text-neutral-500">{u.rank_points} RP</span>
          <span className={`text-[10px] font-anton uppercase tracking-widest ${u.online ? "text-[#06A35F]" : "text-neutral-400"}`}>
            {u.online ? "● ONLINE" : (u.last_seen_at ? `LAST SEEN ${formatRelativeTime(u.last_seen_at)}` : "OFFLINE")}
          </span>
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
            {u.online && !u.in_match && (
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
          const rankColor = RANK_COLORS[Math.max(0, Math.min(7, u.rank_tier ?? 0))];
          return (
            <div key={u.id} className="px-2 py-2 flex items-center gap-3" data-testid={`friends-search-row-${i}`}>
              <Avatar idx={u.avatar} size={36} online={u.online} testid={`search-avatar-${i}`} />
              <div className="flex-1 min-w-0">
                <div className="font-anton uppercase text-sm truncate">{u.username}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-anton uppercase tracking-widest text-[10px] px-1.5 py-0.5 border border-black" style={{ background: rankColor, color: (u.rank_tier ?? 0) === 7 ? "#FFD700" : "#0A0A0A" }}>
                    {u.rank_name}
                  </span>
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
