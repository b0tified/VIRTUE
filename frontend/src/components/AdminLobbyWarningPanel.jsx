// Moderation: permanent red warning banner at the top of the lobby (shows while text is set).
import { useEffect, useState } from "react";
import api from "@/api";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function AdminLobbyWarningPanel({ onToast }) {
  const [saved, setSaved] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/admin/lobby_warning").then(({ data }) => { setSaved(data.text); setText(data.text); }).catch(() => {});
  }, []);

  const save = async (value) => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/lobby_warning", { text: value });
      setSaved(data.text); setText(data.text);
      onToast?.({ kind: "ok", text: data.text ? "Lobby warning is showing." : "Lobby warning removed." });
    } catch {
      onToast?.({ kind: "err", text: "Couldn't save the lobby warning." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-lobby-warning-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <AlertTriangle size={16} strokeWidth={3} className="text-[#E62429]" />
        <span>Lobby Warning</span>
        <span className={`ml-2 text-[10px] px-2 py-0.5 border-2 border-black ${saved ? "bg-[#E62429] text-white" : "bg-neutral-200"}`} data-testid="lobby-warning-status">
          {saved ? "SHOWING" : "OFF"}
        </span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">A red banner across the top of every player's lobby. Players can't close it. Clear the text to remove it.</div>
      {saved === null ? <Loader2 size={16} className="animate-spin" /> : (
        <>
          <textarea value={text} maxLength={300} rows={2} onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Servers are closing January 1, 2027."
            className="border-2 border-black px-2 py-1 text-sm w-full" data-testid="lobby-warning-input" />
          <div className="text-[10px] text-neutral-500 text-right">{text.length}/300</div>
          {text.trim() && (
            <div className="mt-1 bg-[#E62429] text-white border-2 border-black px-3 py-1.5 flex items-center justify-center gap-2 text-center" data-testid="lobby-warning-preview">
              <AlertTriangle size={14} strokeWidth={3} className="shrink-0" />
              <span className="font-anton uppercase tracking-wider text-xs whitespace-pre-line break-words">{text.trim()}</span>
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button type="button" disabled={busy || text.trim() === saved} onClick={() => save(text)}
              className="btn-pow bg-[#E62429] text-white text-sm px-5 py-2 disabled:opacity-50" data-testid="lobby-warning-save">
              {busy ? "Saving..." : "Save"}
            </button>
            {saved && (
              <button type="button" disabled={busy} onClick={() => save("")}
                className="btn-pow bg-black text-white text-sm px-5 py-2" data-testid="lobby-warning-clear">
                Remove warning
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
