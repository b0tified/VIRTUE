/* WhisperChat — inline 1:1 DM panel that swaps into the FriendsModal
   when a friend's WHISPER button is clicked. Polls the conversation
   endpoint at 3s so the other side's replies surface without manual
   refresh; the act of opening the panel marks inbound messages read
   on the server (see `/whispers/conversation/{username}`).

   Visual: header (avatar + name + back button), scrollable message
   list (mine on the right in red, theirs on the left in white), and
   a sticky input row with a 280-char counter + ENTER-to-send. Errors
   from the server are surfaced inline so a 429 rate-limit doesn't
   confuse the user. */
import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/api";
import { ArrowLeft, Send } from "lucide-react";
import { Avatar } from "@/components/PlayerCard";

const POLL_INTERVAL_MS = 3000;
const MAX_LENGTH = 280;

export default function WhisperChat({ friend, onBack, onAfterSend }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  const reload = useCallback(async (silent = false) => {
    if (!friend?.username) return;
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get(
        `/whispers/conversation/${encodeURIComponent(friend.username)}?limit=80`,
      );
      setMessages(data?.messages || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.detail || "Couldn't load conversation.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [friend?.username]);

  // Initial fetch + polling. Stops polling when the panel unmounts.
  useEffect(() => {
    reload(false);
    const id = setInterval(() => reload(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reload]);

  // Auto-scroll to the bottom every time the message count changes —
  // never on poll-no-change, so the user can still scroll up to read
  // history without being yanked back down each tick.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: msg } = await api.post("/whispers/send", {
        username: friend.username,
        text: trimmed.slice(0, MAX_LENGTH),
      });
      // Optimistic append — the next poll will reconcile any
      // server-side timestamp drift, but the user sees their message
      // appear immediately.
      setMessages((prev) => [...prev, { ...msg, from_me: true }]);
      setText("");
      onAfterSend?.();
    } catch (e) {
      setError(e.response?.data?.detail || "Couldn't send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-[60vh]" data-testid="whisper-chat">
      <div className="flex items-center gap-3 px-3 sm:px-5 py-2 border-b-2 border-black bg-[#FFD700]">
        <button
          onClick={onBack}
          className="font-anton uppercase text-xs flex items-center gap-1"
          data-testid="whisper-back"
        >
          <ArrowLeft size={16} strokeWidth={3} /> BACK
        </button>
        <Avatar idx={friend.avatar ?? 0} size={32} />
        <div className="flex-1 min-w-0">
          <div className="font-anton uppercase text-base truncate" data-testid="whisper-with">
            {friend.username}
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 space-y-2 bg-[#F4F4F5]"
        data-testid="whisper-message-list"
      >
        {loading ? (
          <div className="text-center text-neutral-400 font-anton uppercase text-xs py-6">
            Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-neutral-400 font-anton uppercase text-xs py-6">
            No messages yet. Say hi!
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}
              data-testid={`whisper-row-${m.from_me ? "me" : "them"}`}
            >
              <div
                className={`max-w-[80%] border-pow-thin px-3 py-1.5 text-sm break-words ${
                  m.from_me ? "bg-[#E62429] text-white" : "bg-white text-black"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>
      {error && (
        <div
          className="px-3 sm:px-5 py-1.5 bg-[#FFE4E4] text-[#7a1115] font-anton uppercase tracking-widest text-[10px] border-t-2 border-black"
          data-testid="whisper-error"
        >
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 px-3 sm:px-5 py-2 border-t-2 border-black bg-white">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={MAX_LENGTH}
          placeholder="Message…"
          className="flex-1 border-pow-thin px-2 py-1.5 text-sm bg-white outline-none focus:bg-[#FFF7D6]"
          data-testid="whisper-input"
          disabled={busy}
        />
        <span className="font-anton text-[10px] uppercase tracking-widest text-neutral-400 tabular-nums">
          {text.length}/{MAX_LENGTH}
        </span>
        <button
          onClick={send}
          disabled={busy || !text.trim()}
          className="btn-pow bg-[#0055FF] text-white [&]:px-3 [&]:py-1.5 [&]:text-xs disabled:opacity-50"
          data-testid="whisper-send"
        >
          <span className="flex items-center gap-1"><Send size={14} strokeWidth={3} /> SEND</span>
        </button>
      </div>
    </div>
  );
}
