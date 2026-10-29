// Moderation: rename the player-facing mode names (shown everywhere in the game).
import { useEffect, useState } from "react";
import api from "@/api";
import { Loader2, Type } from "lucide-react";
import { setModeNames } from "@/lib/modeNames";

const ORDER = ["casual", "ranked", "bigffa", "party", "practice"];

export default function AdminModeNamesPanel({ onToast }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/admin/mode_names").then(({ data: d }) => { setData(d); setDraft(d.names); }).catch(() => {});
  }, []);

  const changed = data && ORDER.some((k) => (draft[k] || "").trim() !== data.names[k]);
  const save = async () => {
    setBusy(true);
    try {
      const { data: d } = await api.post("/admin/mode_names", { names: draft });
      setData(d); setDraft(d.names); setModeNames(d.names);
      onToast?.({ kind: "ok", text: "Mode names saved." });
    } catch (e) {
      const m = e?.response?.data?.detail;
      onToast?.({ kind: "err", text: typeof m === "string" ? m : "Couldn't save mode names." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border-4 border-black p-4" data-testid="admin-mode-names-panel">
      <div className="font-anton uppercase tracking-widest text-sm mb-1 flex items-center gap-2">
        <Type size={16} strokeWidth={3} className="text-[#0055FF]" />
        <span>Mode Names</span>
      </div>
      <div className="text-xs text-neutral-600 mb-3">Rename modes for players. Shown on lobby buttons, queue, match and history screens. Max 20 characters.</div>
      {!data ? <Loader2 size={16} className="animate-spin" /> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ORDER.map((k) => (
              <label key={k} className="border-2 border-black px-3 py-2 block">
                <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-500">Original: {data.defaults[k]}</div>
                <input value={draft[k] || ""} maxLength={20} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  className="border-2 border-black px-2 py-1 text-sm w-full mt-1 font-anton uppercase tracking-wider" data-testid={`mode-name-input-${k}`} />
              </label>
            ))}
          </div>
          <button type="button" disabled={busy || !changed || ORDER.some((k) => !(draft[k] || "").trim())} onClick={save}
            className="btn-pow bg-[#0055FF] text-white text-sm px-5 py-2 mt-3 disabled:opacity-50" data-testid="mode-names-save">
            {busy ? "Saving..." : "Save names"}
          </button>
        </>
      )}
    </div>
  );
}
