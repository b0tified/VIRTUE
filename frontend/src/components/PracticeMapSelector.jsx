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
  if (!open) return null;
  const modeLabel = mode === "practice" ? "PRACTICE RANGE" : "OFFLINE VS AI";
  return (
    <div
      className="fixed inset-0 z-[8000] bg-black/85 flex items-center justify-center p-4"
      data-testid="practice-map-selector"
      onClick={onClose}
    >
      <div
        className="card-pow bg-white max-w-3xl w-full p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#9B59B6] text-white px-5 py-3 flex items-center justify-between">
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

        {/* Footer / confirm */}
        <div className="bg-[#FFD700] px-5 py-3 flex items-center justify-between border-t-4 border-black">
          <div className="font-anton uppercase tracking-widest text-xs">
            {picked
              ? <>SELECTED: <span className="text-[#E62429]">{MAPS_META.find((mp) => mp.map_id === picked)?.name}</span></>
              : <>SELECTED: <span className="text-[#E62429]">RANDOM</span></>}
          </div>
          <button
            type="button"
            onClick={() => onSelect(picked)}
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
