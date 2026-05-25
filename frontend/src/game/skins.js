/* Client-side mirror of backend SKINS_CATALOG (server.py).
   Keep palette + aura attributes in sync — backend sends only the skin id
   in state ticks, and the engine resolves it through this table to color
   the humanoid and pick the aura animation mode.

   Each entry shape:
     id, name, price, rarity, body, leg, head, accent, aura, aura_mode
   Colors are 0xRRGGBB integers (matches Three.js Color.setHex).
   `rarity` is purely cosmetic for the shop UI.
   `aura_mode`:
     - "none":    no aura (used by default skin)
     - "pulse":   steady soft glow that breathes in/out
     - "spin":    rotating dual-tone ring at the player's feet
     - "flicker": sharp on/off ghost flicker
*/
export const SKINS = [
  { id: "default",  name: "Recruit",        price: 0,    rarity: "common",    body: 0xe62429, leg: 0x1a1a1a, head: 0xf2c08a, accent: 0xffd700, aura: 0x000000, aura_mode: "none" },
  { id: "azure",    name: "Azure Ranger",   price: 200,  rarity: "common",    body: 0x0055ff, leg: 0x0a2a6b, head: 0xf2c08a, accent: 0x9adcff, aura: 0x4ab8ff, aura_mode: "pulse" },
  { id: "neon",     name: "Neon Cyan",      price: 500,  rarity: "rare",      body: 0x00cfff, leg: 0x004b6b, head: 0xf2c08a, accent: 0xffffff, aura: 0x00ffff, aura_mode: "pulse" },
  { id: "crimson",  name: "Crimson Rogue",  price: 800,  rarity: "rare",      body: 0x6b0010, leg: 0x1a0306, head: 0xf2c08a, accent: 0xff3a3a, aura: 0xff1a1a, aura_mode: "spin" },
  { id: "ghost",    name: "Ghost White",    price: 1200, rarity: "epic",      body: 0xeeeeee, leg: 0x9aa0a8, head: 0xeeeeee, accent: 0x6cb0ff, aura: 0xffffff, aura_mode: "flicker" },
  { id: "verdant",  name: "Verdant Hunter", price: 1500, rarity: "epic",      body: 0x1d6b29, leg: 0x0d3a16, head: 0xf2c08a, accent: 0xe8ff7a, aura: 0x6cff5e, aura_mode: "pulse" },
  { id: "void",     name: "Void Walker",    price: 2000, rarity: "legendary", body: 0x14002a, leg: 0x000000, head: 0xb88be0, accent: 0xd400ff, aura: 0xb000ff, aura_mode: "spin" },
  { id: "golden",   name: "Golden Apex",    price: 3000, rarity: "legendary", body: 0xffc700, leg: 0x6b4d00, head: 0xf2c08a, accent: 0xffffff, aura: 0xffd700, aura_mode: "spin" },
];

const BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));

/* Resolves a skin by id, falling back to the default if unknown. Safe to
   call with null/undefined (e.g., for legacy players who pre-date skins). */
export function skinById(id) {
  return BY_ID[id] || BY_ID.default;
}

/* Rarity → CSS color, used in the shop modal for the rarity chip. */
export const RARITY_COLOR = {
  common:    "#9aa3ad",
  rare:      "#4ab8ff",
  epic:      "#d400ff",
  legendary: "#ffd700",
};
