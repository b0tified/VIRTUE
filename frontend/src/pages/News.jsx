/* News page — admin-broadcast announcement feed.

   Layout:
     • Comic-styled header with BACK button and (admin-only) "NEW POST" CTA.
     • Vertical stack of news cards (newest first, pinned posts on top).
     • Each card: title bar (yellow accent for pinned), body text,
       footer with author + timestamp + (admin-only) delete button.
     • Admin compose modal: title + body inputs + pinned toggle.

   Data source: GET /api/news (server lists pinned-first, then created_at desc).
   Admin actions: POST /api/admin/news, DELETE /api/admin/news/{id}.
*/
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Megaphone, Pin, Plus, Trash2, X, Loader2, ThumbsUp, Pencil, Check } from "lucide-react";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";

export default function News() {
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [posts, setPosts] = useState(null); // null = loading
  const [showCompose, setShowCompose] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/news");
      setPosts(Array.isArray(data) ? data : []);
    } catch (e) {
      setPosts([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Dispatch an event so the lobby's NEWS button can re-fetch its unread
    // count (it just got zeroed server-side by the GET above).
    try {
      window.dispatchEvent(new CustomEvent("virtue-news-read"));
    } catch {}
  }, [refresh]);

  return (
    <div className="min-h-screen bg-white" data-testid="news-page">
      <header className="bg-black text-white px-4 sm:px-8 py-3 flex items-center justify-between">
        <button
          onClick={() => nav("/lobby")}
          className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5"
          data-testid="news-back-button"
        >
          <span className="flex items-center gap-2"><ArrowLeft size={16} strokeWidth={3} /> BACK</span>
        </button>
        <div className="font-display text-3xl sm:text-4xl text-[#FFD700] flex items-center gap-3" data-testid="news-page-title">
          <Megaphone size={28} strokeWidth={3} />
          NEWS
        </div>
        {isAdmin ? (
          <button
            onClick={() => setShowCompose(true)}
            className="btn-pow bg-[#06A35F] text-white [&]:px-3 [&]:py-1.5"
            data-testid="news-new-post-button"
          >
            <span className="flex items-center gap-2"><Plus size={16} strokeWidth={3} /> NEW POST</span>
          </button>
        ) : (
          <div className="w-[100px]" />
        )}
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {posts === null && (
          <div className="font-display text-3xl text-center py-16" data-testid="news-loading">LOADING...</div>
        )}
        {posts !== null && posts.length === 0 && (
          <div
            className="card-pow bg-white p-8 text-center font-anton uppercase tracking-widest text-neutral-500"
            data-testid="news-empty"
          >
            No news yet. Check back soon.
          </div>
        )}
        {posts && posts.map((p, i) => (
          <NewsCard
            key={p.id}
            post={p}
            isAdmin={isAdmin}
            onLikeToggled={(newState) => {
              // Optimistic update was already applied by NewsCard; this
              // just resyncs the row with the server's authoritative
              // count in case of clamp/race conditions.
              setPosts((arr) => arr.map((x) =>
                x.id === p.id ? { ...x, likes: newState.likes, liked_by_me: newState.liked_by_me } : x
              ));
            }}
            onLikesEdited={(likes) => {
              setPosts((arr) => arr.map((x) =>
                x.id === p.id ? { ...x, likes } : x
              ));
            }}
            onDelete={async () => {
              if (!window.confirm(`Delete "${p.title}"?`)) return;
              try {
                await api.delete(`/admin/news/${p.id}`);
                setPosts((arr) => arr.filter((x) => x.id !== p.id));
              } catch (e) {
                alert(e.response?.data?.detail || "Delete failed.");
              }
            }}
            testid={`news-card-${i}`}
          />
        ))}
      </main>

      <ComposeModal
        open={showCompose}
        onClose={() => setShowCompose(false)}
        onPosted={(newPost) => {
          // Optimistically prepend; refresh re-syncs from server (handles
          // pinned ordering correctly).
          setPosts((arr) => [newPost, ...(arr || [])]);
          setShowCompose(false);
          refresh();
        }}
      />
    </div>
  );
}

function NewsCard({ post, isAdmin, onDelete, onLikeToggled, onLikesEdited, testid }) {
  const dt = formatRelative(post.created_at);
  // Optimistic-first like toggle. We flip the button state on click and
  // fire the request in the background; if it fails we roll back.
  const [likeBusy, setLikeBusy] = useState(false);
  // Admin inline edit for the like count. `null` = view mode. Numeric
  // string while typing so we can preserve empty-input UX.
  const [editVal, setEditVal] = useState(null);
  const [editBusy, setEditBusy] = useState(false);

  const toggleLike = async () => {
    if (likeBusy) return;
    setLikeBusy(true);
    // Optimistic flip — the parent's setter uses this to render
    // instantly; we resync from the server response below.
    const nextLiked = !post.liked_by_me;
    const nextCount = Math.max(0, (post.likes || 0) + (nextLiked ? 1 : -1));
    onLikeToggled?.({ likes: nextCount, liked_by_me: nextLiked });
    try {
      const { data } = await api.post(`/news/${post.id}/like`);
      onLikeToggled?.({ likes: data.likes, liked_by_me: data.liked_by_me });
    } catch (e) {
      // Roll back to server-side truth.
      onLikeToggled?.({ likes: post.likes, liked_by_me: post.liked_by_me });
    } finally {
      setLikeBusy(false);
    }
  };

  const saveEdit = async () => {
    if (editBusy) return;
    const n = parseInt(editVal, 10);
    if (Number.isNaN(n) || n < 0) {
      setEditVal(null);
      return;
    }
    setEditBusy(true);
    try {
      await api.patch(`/admin/news/${post.id}`, { likes: n });
      onLikesEdited?.(n);
      setEditVal(null);
    } catch (e) {
      alert(e.response?.data?.detail || "Edit failed.");
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <article
      className={`card-pow p-0 overflow-hidden ${post.pinned ? "ring-4 ring-[#FFD700]" : ""}`}
      data-testid={testid}
      data-pinned={post.pinned ? "true" : "false"}
    >
      <div
        className={`px-4 py-2 flex items-center gap-2 ${post.pinned ? "bg-[#FFD700] text-black" : "bg-black text-white"}`}
      >
        {post.pinned && <Pin size={14} strokeWidth={3} />}
        <h2 className="font-display text-xl sm:text-2xl uppercase flex-1 truncate" data-testid={`${testid}-title`}>
          {post.title}
        </h2>
      </div>
      <div className="px-4 py-4 bg-white">
        <p
          className="font-body text-sm sm:text-base text-neutral-800 whitespace-pre-wrap leading-relaxed"
          data-testid={`${testid}-body`}
        >
          {post.body}
        </p>
        <div className="mt-4 pt-3 border-t border-black/10 flex items-center justify-between flex-wrap gap-2">
          <div className="font-anton uppercase tracking-widest text-[11px] text-neutral-500">
            <span className="text-black">{post.author_username}</span>
            <span className="mx-2 opacity-50">·</span>
            <span data-testid={`${testid}-timestamp`}>{dt}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Thumbs-up. Filled black-on-yellow when the caller has
                liked the post; hollow-outlined otherwise. Admins get
                an adjacent pencil that swaps in an inline input to
                override the count. */}
            {editVal === null ? (
              <button
                onClick={toggleLike}
                disabled={likeBusy}
                className={`btn-pow [&]:px-2 [&]:py-1 [&]:text-xs flex items-center gap-1.5 disabled:opacity-60 ${
                  post.liked_by_me
                    ? "bg-[#FFD700] text-black"
                    : "bg-white text-black"
                }`}
                data-testid={`${testid}-like`}
                data-liked={post.liked_by_me ? "true" : "false"}
                aria-label={post.liked_by_me ? "Remove like" : "Like this post"}
              >
                <ThumbsUp
                  size={12}
                  strokeWidth={3}
                  fill={post.liked_by_me ? "currentColor" : "none"}
                />
                <span className="tabular-nums" data-testid={`${testid}-like-count`}>
                  {post.likes || 0}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") setEditVal(null);
                  }}
                  disabled={editBusy}
                  autoFocus
                  className="w-20 border-2 border-black px-2 py-1 font-anton tabular-nums text-xs"
                  data-testid={`${testid}-likes-input`}
                />
                <button
                  onClick={saveEdit}
                  disabled={editBusy}
                  className="btn-pow bg-[#06A35F] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
                  data-testid={`${testid}-likes-save`}
                  aria-label="Save"
                >
                  {editBusy ? (
                    <Loader2 size={12} strokeWidth={3} className="animate-spin" />
                  ) : (
                    <Check size={12} strokeWidth={3} />
                  )}
                </button>
                <button
                  onClick={() => setEditVal(null)}
                  disabled={editBusy}
                  className="btn-pow bg-white text-black [&]:px-2 [&]:py-1 [&]:text-xs"
                  data-testid={`${testid}-likes-cancel`}
                  aria-label="Cancel"
                >
                  <X size={12} strokeWidth={3} />
                </button>
              </div>
            )}
            {isAdmin && editVal === null && (
              <button
                onClick={() => setEditVal(String(post.likes || 0))}
                className="btn-pow bg-neutral-900 text-white [&]:px-2 [&]:py-1 [&]:text-xs"
                data-testid={`${testid}-likes-edit`}
                aria-label="Edit like count (admin)"
              >
                <Pencil size={12} strokeWidth={3} />
              </button>
            )}
            {isAdmin && (
              <button
                onClick={onDelete}
                className="btn-pow bg-[#E62429] text-white [&]:px-2 [&]:py-1 [&]:text-xs"
                data-testid={`${testid}-delete`}
                aria-label="Delete post"
              >
                <span className="flex items-center gap-1"><Trash2 size={12} strokeWidth={3} /> DELETE</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ComposeModal({ open, onClose, onPosted }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setTitle(""); setBody(""); setPinned(false); setError(""); setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError("");
    if (title.trim().length < 2 || body.trim().length < 2) {
      setError("Title and body must be at least 2 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/admin/news", {
        title: title.trim(),
        body: body.trim(),
        pinned,
      });
      onPosted?.(data);
    } catch (e) {
      setError(e.response?.data?.detail || "Publish failed.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      data-testid="news-compose-modal"
      onClick={onClose}
    >
      <div
        className="card-pow p-0 w-full max-w-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between">
          <div className="font-display text-2xl text-[#FFD700] flex items-center gap-2">
            <Megaphone size={20} strokeWidth={3} /> NEW POST
          </div>
          <button onClick={onClose} className="font-anton" data-testid="news-compose-close" disabled={submitting}>
            <X size={20} strokeWidth={3} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <div className="font-anton uppercase tracking-widest text-xs text-neutral-500 mb-1">Title</div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Patch 1.5 is live"
              className="w-full border-2 border-black px-3 py-2 font-anton uppercase tracking-widest"
              data-testid="news-compose-title"
              disabled={submitting}
            />
          </label>
          <label className="block">
            <div className="font-anton uppercase tracking-widest text-xs text-neutral-500 mb-1">Body</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              rows={8}
              placeholder="What's new? Line breaks preserved."
              className="w-full border-2 border-black px-3 py-2 font-body text-sm resize-y"
              data-testid="news-compose-body"
              disabled={submitting}
            />
            <div className="text-[10px] font-anton uppercase tracking-widest text-neutral-500 mt-1 tabular-nums text-right">
              {body.length} / 4000
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="w-4 h-4 accent-[#FFD700]"
              data-testid="news-compose-pinned"
              disabled={submitting}
            />
            <span className="font-anton uppercase tracking-widest text-sm">Pin to top</span>
          </label>
          {error && (
            <div
              className="border-2 border-black bg-[#E62429] text-white px-3 py-2 font-anton uppercase tracking-widest text-xs"
              data-testid="news-compose-error"
            >
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t-2 border-black flex items-center justify-end gap-2 bg-neutral-50">
          <button
            onClick={onClose}
            disabled={submitting}
            className="btn-pow bg-white text-black [&]:px-3 [&]:py-1.5"
            data-testid="news-compose-cancel"
          >
            CANCEL
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="btn-pow bg-[#06A35F] text-white [&]:px-3 [&]:py-1.5 disabled:opacity-60"
            data-testid="news-compose-publish"
          >
            <span className="flex items-center gap-2">
              {submitting ? <Loader2 size={14} strokeWidth={3} className="animate-spin" /> : <Plus size={14} strokeWidth={3} />}
              PUBLISH
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// "5 minutes ago" / "2 hours ago" / "Mar 14" style relative timestamp.
function formatRelative(iso) {
  if (!iso) return "";
  let d;
  try { d = new Date(iso); } catch { return iso; }
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
