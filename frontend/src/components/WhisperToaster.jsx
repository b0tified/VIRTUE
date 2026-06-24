/* WhisperToaster — small lobby-corner toast that announces new
   inbound whispers WITHOUT requiring the Friends modal to be open.

   Polls `/whispers/unread` every 6s. When the total unread count
   *increases* between polls, we know a new whisper just landed; we
   then peek the highest-unread sender's last message via
   `/whispers/conversation/{username}` and toast their handle + the
   text. The first poll after mount establishes the baseline and never
   toasts (so we don't shower the user with a "you have 3 new
   messages" on every page refresh).

   Click the toast → opens the Friends modal directly into the chat
   with that sender. Auto-dismisses after 6s. Stacked toasts are
   handled by keeping only the *latest* one — DM volume is low and a
   single rolling toast feels closer to how Discord/iMessage
   pop-ups behave.

   Mounted from Lobby.jsx so it lives next to the rest of the
   lobby-only chrome (e.g. queue toasts, friend-request toasts). */
import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/api";
import { Avatar } from "@/components/PlayerCard";
import { MessageCircle, X } from "lucide-react";

const POLL_INTERVAL_MS = 6000;

export default function WhisperToaster({ onOpenWhisper }) {
  const [toast, setToast] = useState(null); // {username, avatar, text}
  const baselineRef = useRef(null); // sum of all unread counts from prior poll
  const lastSenderRef = useRef(null); // sender id we last toasted, to skip repeats

  const poll = useCallback(async () => {
    let unreadResp;
    try {
      unreadResp = await api.get("/whispers/unread");
    } catch {
      return;
    }
    const data = unreadResp.data || {};
    const total = Number(data.total || 0);
    const bySender = data.by_sender || {};

    // First poll just records the baseline so we don't toast existing
    // unread messages the user already knew about.
    if (baselineRef.current === null) {
      baselineRef.current = total;
      return;
    }

    if (total <= baselineRef.current) {
      // No new whispers — keep the baseline locked at the highest
      // observed value so reading some on the Friends modal doesn't
      // re-trigger a toast on the next decrement.
      baselineRef.current = total;
      return;
    }

    // Find the sender with the highest unread count — that's our
    // best guess at the most-recent author.
    let topSenderId = null;
    let topCount = 0;
    for (const [sid, c] of Object.entries(bySender)) {
      if (c > topCount) { topSenderId = sid; topCount = c; }
    }
    if (!topSenderId) {
      baselineRef.current = total;
      return;
    }

    // We need a username to fetch the conversation. Look the friend
    // up by id via the friends list (cached by the modal but also
    // available here on demand).
    let username = null;
    let avatar = 0;
    try {
      const { data: friendsData } = await api.get("/friends");
      const match = (friendsData.friends || []).find((f) => f.id === topSenderId);
      if (match) {
        username = match.username;
        avatar = match.avatar ?? 0;
      }
    } catch {
      /* soft-fail */
    }
    if (!username) {
      baselineRef.current = total;
      return;
    }

    // Skip duplicate-toast: if the same sender already produced our
    // last toast and the bump is just from another message in their
    // thread, refresh the text but don't double-stack.
    let text = "";
    try {
      const { data: convo } = await api.get(
        `/whispers/conversation/${encodeURIComponent(username)}?limit=5`,
      );
      const messages = convo.messages || [];
      // The newest inbound message (from_me === false) is what we
      // want to preview.
      for (let i = messages.length - 1; i >= 0; i--) {
        if (!messages[i].from_me) { text = messages[i].text; break; }
      }
    } catch {
      /* soft-fail */
    }

    // CRITICAL: fetching the conversation marks inbound messages as
    // read on the server. That means the very next poll would see
    // total drop and we'd never re-toast for THIS sender. So we keep
    // the baseline at the pre-spike value here and let subsequent
    // increments still trigger. Net behaviour: toast once per
    // landed-message-burst per sender.
    baselineRef.current = 0;
    lastSenderRef.current = topSenderId;

    setToast({ username, avatar, text: text || "New whisper" });
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[320px] max-w-[90vw] border-pow shadow-pow bg-white animate-[match-loading-banner-pop_0.45s_cubic-bezier(0.34,1.56,0.64,1)_both]"
      data-testid="whisper-toast"
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        <Avatar idx={toast.avatar} size={36} />
        <button
          onClick={() => {
            onOpenWhisper?.({ username: toast.username, avatar: toast.avatar });
            setToast(null);
          }}
          className="flex-1 min-w-0 text-left"
          data-testid="whisper-toast-open"
        >
          <div className="flex items-center gap-1 font-anton uppercase text-xs">
            <MessageCircle size={12} strokeWidth={3} className="text-[#0055FF]" />
            <span className="truncate">{toast.username}</span>
          </div>
          <div className="text-sm text-neutral-700 truncate" title={toast.text}>
            {toast.text}
          </div>
        </button>
        <button
          onClick={() => setToast(null)}
          className="text-neutral-400 hover:text-black"
          data-testid="whisper-toast-dismiss"
          aria-label="Dismiss"
        >
          <X size={14} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
