import { useEffect, useRef, useState } from "react";

/* In-match chat. Desktop: bottom-left, press Enter to type, Enter to send,
   Esc to dismiss. Mobile: top-left under the Menu/Leave buttons, tap the bar to type. */
export default function Chat({ messages, onSend, mobile = false }) {
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
    if (mobile) return undefined;
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((e.code === "Enter" || e.code === "NumpadEnter" || e.code === "KeyT") && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mobile]);

  const close = () => { setOpen(false); setDraft(""); inputRef.current?.blur(); };
  const submit = (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (text) onSend?.(text);
    close();
  };

  const wrap = mobile
    ? "absolute left-3 top-[168px] z-40 w-[min(210px,28vw)] pointer-events-none"
    : "absolute left-4 bottom-[124px] z-30 w-[min(420px,42vw)] pointer-events-none";
  return (
    <div className={wrap} data-testid="chat-panel">
      <div className={`space-y-1 mb-1`}>
        {messages.slice(mobile ? -3 : -6).map((m) => (
          <div
            key={m.id}
            className={`bg-black/60 backdrop-blur-sm border-l-2 border-[#E62429] px-2 py-1 font-body text-white ${mobile ? "text-[10px] py-0.5 leading-tight break-words line-clamp-2" : "text-sm"}`}
            data-testid="chat-message"
          >
            <span className={`font-anton uppercase tracking-widest text-xs mr-2 ${m.is_bot ? "text-[#9B59B6]" : "text-[#FFD700]"}`}>
              {m.username}
            </span>
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      <form
        onSubmit={submit}
        onPointerDown={() => { if (mobile && !open) setOpen(true); }}
        className={`flex items-center gap-2 backdrop-blur-sm border-2 px-2 py-1 transition-colors ${open ? "bg-black/80 border-[#E62429] pointer-events-auto" : "bg-black/40 border-white/20"} ${mobile ? "pointer-events-auto" : ""}`}
        data-testid="chat-input-form"
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => { if (mobile && !draft) setOpen(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          readOnly={!open && !mobile}
          tabIndex={open || mobile ? 0 : -1}
          maxLength={140}
          placeholder="Enter"
          enterKeyHint="send"
          className={`flex-1 min-w-0 bg-transparent outline-none text-white placeholder:text-white/50 ${mobile ? "text-xs" : "text-sm"}`}
          data-testid="chat-input"
        />
        {open && (
          <button type="submit" className="text-xs font-anton uppercase tracking-widest text-[#FFD700]" data-testid="chat-send">
            SEND
          </button>
        )}
      </form>
    </div>
  );
}
