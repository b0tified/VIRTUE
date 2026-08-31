import { useState } from "react";
import { Crosshair, Target } from "lucide-react";
import api from "@/api";

/* Lobby weapon-select pill. Two-button toggle between the two primary
   loadouts:
     • AK-47 — full-auto, 25 rounds, standard damage curve.
     • SNIPER — ADS-only, 1 round, 2s reload, 1-shot-kill anywhere.
   Persists the choice via POST /profile/me/weapon; the server reads
   `user.primary_weapon` at WS connect and initialises `player.weapon`.

   Kept small and pill-styled so it doesn't compete for attention with
   the QUEUE UP buttons directly below. Disabled while the user is
   already queueing (queue state changes should be intentional).      */
const WEAPONS = [
  {
    id: "ak47",
    name: "AK-47",
    Icon: Crosshair,
    sub: "AUTO · 25 RND",
    accent: "#E62429",
  },
  {
    id: "sniper",
    name: "SNIPER",
    Icon: Target,
    sub: "ADS · 1 SHOT",
    accent: "#F1C40F",
  },
];

export default function WeaponLoadoutPicker({ user, onChange, disabled }) {
  const [busy, setBusy] = useState(false);
  const current = user?.primary_weapon || "ak47";

  const pick = async (weaponId) => {
    if (busy || disabled || weaponId === current) return;
    setBusy(true);
    try {
      await api.post("/profile/me/weapon", { weapon: weaponId });
      onChange?.(weaponId);
    } catch {
      // Silent — server rejection just means the choice didn't stick.
      // User can retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-pow p-0 overflow-hidden" data-testid="weapon-loadout-picker">
      <div className="bg-black text-white px-3 py-2 flex items-center gap-2">
        <span className="font-anton uppercase tracking-widest text-sm">Loadout</span>
        <span className="opacity-60 text-[10px] ml-auto">Primary weapon</span>
      </div>
      <div className="grid grid-cols-2 bg-neutral-900">
        {WEAPONS.map((w) => {
          const selected = w.id === current;
          const Icon = w.Icon;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => pick(w.id)}
              disabled={busy || disabled}
              className="relative flex items-center gap-2 px-3 py-2 border-r-2 border-black last:border-r-0 transition-transform hover:translate-y-[-1px] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: selected ? w.accent : "#1c1c1c",
                color: selected ? "#0A0A0A" : "#FFFFFF",
                boxShadow: selected ? "inset 0 0 0 3px #0A0A0A" : "none",
              }}
              data-testid={`weapon-choice-${w.id}`}
              data-selected={selected ? "true" : "false"}
            >
              <Icon size={18} strokeWidth={3} />
              <div className="flex flex-col items-start leading-tight">
                <span className="font-anton uppercase tracking-widest text-sm">{w.name}</span>
                <span className="text-[10px] opacity-70">{w.sub}</span>
              </div>
              {selected && (
                <span
                  className="absolute top-0.5 right-0.5 font-anton uppercase tracking-widest text-[9px] px-1 py-0.5 border-2 border-black"
                  style={{ background: "#0A0A0A", color: "#FFFFFF" }}
                >
                  EQ
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
