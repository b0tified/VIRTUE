/* PracticeMapSelector.jsx — small modal that lets the player choose a
   specific map before entering practice / offline mode. The selected map
   is appended to the route as `?map=<id>` and consumed by Game.jsx →
   LocalSim, which honours the override instead of rolling random.

   Includes a "RANDOM" option for the default behaviour. */
import { useState } from "react";
import { MAPS_META } from "@/game/mapsMeta";
import MapPreview from "@/components/MapPreview";
import { Shuffle, X, Play } from "lucide-react";

export default function PracticeMapSelector({ open, onClose, onSelect, mode = "practice" }) {
  // Tracks which card the user has highlighted before confirming. `null`
  // means RANDOM (server-style uniform pick).
  const [picked, setPicked] = useState(null);
  // Game mode toggle — "ffa" or "tdm". Persists for the lifetime of the
  // selector modal; we pass it back via onSelect so the caller can put
  // `tdm=1` in the WS URL.
  const [gameMode, setGameMode] = useState("ffa");
  if (!open) return null;
  const modeLabel = mode === "practice" ? "PRACTICE RANGE" : "OFFLINE VS AI";
  return (
    <div
      className="fixed inset-0 z-[8000] bg-black/85 flex items-center justify-center p-4"
      data-testid="practice-map-selector"
      onClick={onClose}
    >
      <div
        className="card-pow bg-white max-w-3xl w-full p-0 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — pinned. */}
        <div className="bg-[#9B59B6] text-white px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="font-display text-2xl sm:text-3xl text-[#FFD700] leading-none">SELECT MAP</div>
            <div className="font-anton uppercase tracking-widest text-xs opacity-90 mt-1">{modeLabel}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white text-black p-1.5 hover:bg-[#FFD700]"
            data-testid="practice-map-selector-close"
            aria-label="Close map selector"
          >
            <X size={16} strokeWidth={3} />
          </button>
        </div>

        {/* Scrollable body — holds the mode toggle + map grid. Capped
            by the modal's max-h so the footer with START button stays
            visible on short viewports (notably mobile landscape, where
            the orientation lock keeps the screen height ~360-414px). */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {/* Game-mode toggle (FFA vs TDM) — placed above the map cards so
              the user picks their format first, then their arena. */}
          <div className="px-4 pt-4 pb-2 border-b-2 border-black/10">
            <div className="font-anton uppercase tracking-widest text-[11px] opacity-60 mb-2">Game Mode</div>
            <div className="grid grid-cols-2 gap-3">
              <ModeCard
                testid="practice-mode-card-ffa"
                active={gameMode === "ffa"}
                onClick={() => setGameMode("ffa")}
                title="FREE FOR ALL"
                subtitle="Solo deathmatch · last one standing wins"
                accent="#E62429"
              />
              <ModeCard
                testid="practice-mode-card-tdm"
                active={gameMode === "tdm"}
                onClick={() => setGameMode("tdm")}
                title="TEAM DEATHMATCH"
                subtitle="3v3 · first team to 30 kills wins"
                accent="#9B59B6"
              />
            </div>
          </div>

          {/* Map grid */}
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Random option */}
          <MapCard
            isRandom
            selected={picked === null}
            onClick={() => setPicked(null)}
            testid="practice-map-card-random"
          />
          {MAPS_META.map((m) => (
            <MapCard
              key={m.map_id}
              map={m}
              selected={picked === m.map_id}
              onClick={() => setPicked(m.map_id)}
              testid={`practice-map-card-${m.map_id}`}
            />
          ))}
          </div>
        </div>

        {/* Footer / confirm — pinned at the bottom so the START button is
            never clipped on short viewports (mobile landscape esp.). */}
        <div className="bg-[#FFD700] px-5 py-3 flex items-center justify-between border-t-4 border-black flex-shrink-0 gap-2">
          <div className="font-anton uppercase tracking-widest text-xs">
            {picked
              ? <>SELECTED: <span className="text-[#E62429]">{MAPS_META.find((mp) => mp.map_id === picked)?.name}</span></>
              : <>SELECTED: <span className="text-[#E62429]">RANDOM</span></>}
            <span className="ml-2 opacity-60">·</span>
            <span className="ml-2">{gameMode === "tdm" ? <span className="text-[#9B59B6]">TDM 3V3</span> : <span className="text-[#E62429]">FFA</span>}</span>
          </div>
          <button
            type="button"
            onClick={() => onSelect(picked, { tdm: gameMode === "tdm" })}
            className="btn-pow bg-[#E62429] text-white [&]:py-2 [&]:px-4"
            data-testid="practice-map-selector-confirm"
          >
            <span className="flex items-center gap-2 font-anton uppercase tracking-widest text-sm">
              <Play size={14} strokeWidth={3} /> START
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* Compact mode-toggle card used in the header. Two states: idle (white
   bordered) and active (filled with the mode's accent colour). Keeps
   the comic-book border + shadow language consistent with the rest of
   the lobby's selector UI. */
function ModeCard({ active, onClick, title, subtitle, accent, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`border-2 border-black p-3 text-left transition-transform active:translate-y-px ${active ? "text-white" : "bg-white hover:bg-neutral-100"}`}
      style={active ? { background: accent, boxShadow: `4px 4px 0 0 #000` } : { boxShadow: `2px 2px 0 0 #00000022` }}
    >
      <div className={`font-display text-lg leading-none ${active ? "" : ""}`}>{title}</div>
      <div className={`font-anton uppercase tracking-widest text-[10px] mt-1 ${active ? "opacity-90" : "opacity-60"}`}>{subtitle}</div>
    </button>
  );
}

function MapCard({ map, isRandom, selected, onClick, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`relative border-pow-thick p-2 bg-white text-left transition-all ${
        selected ? "ring-4 ring-[#E62429] translate-y-[-2px]" : "hover:translate-y-[-1px]"
      }`}
    >
      {isRandom ? (
        <div className="aspect-square w-full bg-[#0A0A0A] border-2 border-black flex items-center justify-center">
          <Shuffle size={48} strokeWidth={3} className="text-[#FFD700]" />
        </div>
      ) : (
        <div className="aspect-square w-full overflow-hidden">
          <MapPreview map={map} fill />
        </div>
      )}
      <div className="font-anton uppercase tracking-widest text-xs mt-2 text-center text-black">
        {isRandom ? "RANDOM" : map.name}
      </div>
      {selected && (
        <span className="absolute top-1 right-1 bg-[#E62429] text-white font-anton uppercase text-[9px] px-1.5 py-0.5 border border-black">
          ✓
        </span>
      )}
    </button>
  );
}
