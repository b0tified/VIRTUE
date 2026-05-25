import { useEffect, useRef, useState } from "react";

/* Bottom-left in-match chat for desktop. Press Enter to type, Enter again to
   send, Esc to dismiss. Mobile already has limited screen real estate so we
   hide the input on touch devices (touch-controls-on setting). */
export default function Chat({ messages, onSend, hidden }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      // Pointer-lock keystrokes still reach window, but we want this input
      // to receive them — release pointer lock when opening chat.
      try { document.exitPointerLock?.(); } catch {}
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e) => {
      if (hidden) return;
      // Ignore if user is in a form input elsewhere
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        if (!open) {
          e.preventDefault();
          setOpen(true);
        }
      } else if (e.code === "KeyT" && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hidden]);

  const submit = (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (text) onSend?.(text);
    setDraft("");
    setOpen(false);
  };

  if (hidden) return null;

  return (
    <div className="absolute left-4 bottom-6 z-30 w-[min(420px,42vw)] pointer-events-none" data-testid="chat-panel">
      <div className="space-y-1 mb-1">
        {messages.slice(-6).map((m) => (
          <div
            key={m.id}
            className="bg-black/60 backdrop-blur-sm border-l-2 border-[#E62429] px-2 py-1 text-sm font-body text-white"
            data-testid="chat-message"
          >
            <span className={`font-anton uppercase tracking-widest text-xs mr-2 ${m.is_bot ? "text-[#9B59B6]" : "text-[#FFD700]"}`}>
              {m.username}
            </span>
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      {open ? (
        <form onSubmit={submit} className="pointer-events-auto flex items-center gap-2 bg-black/80 backdrop-blur-sm border-2 border-[#E62429] px-2 py-1" data-testid="chat-input-form">
          <span className="font-anton uppercase tracking-widest text-xs text-[#E62429]">SAY</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); setDraft(""); }
            }}
            maxLength={140}
            placeholder="Trash talk responsibly…"
            className="flex-1 bg-transparent outline-none text-white text-sm"
            data-testid="chat-input"
          />
          <button type="submit" className="text-xs font-anton uppercase tracking-widest text-[#FFD700]" data-testid="chat-send">
            SEND
          </button>
        </form>
      ) : null}
    </div>
  );
}
