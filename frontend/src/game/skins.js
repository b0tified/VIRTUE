/* Client-side mirror of backend SKINS_CATALOG (server.py).
   Keep palette + decals + aura attributes in sync — backend sends only the
   skin id in state ticks, and the engine resolves it through this table to
   color every layer of the humanoid + pick the aura animation mode.

   Each entry shape:
     id, name, price, rarity, obtain, body, leg, head, accent,
     helmet, visor, shoulder, stripe, belt, cape, aura, aura_mode
   Colors are 0xRRGGBB integers (Three.js Color.setHex compatible).
   `helmet/visor/shoulder/stripe/belt/cape` may be null to skip that layer.
   `obtain`:
     - "free":         starts in everyone's owned_skins (Recruit)
     - "first_match":  granted on the player's first completed match
     - "shop":         purchasable in the skin shop
     - "pass_tier_N":  rewarded by season pass at tier N
   `aura_mode`:
     - "none":    no aura (default skin)
     - "pulse":   steady soft glow that breathes in/out
     - "spin":    rotating dual-tone ring at the player's feet
     - "flicker": sharp on/off ghost flicker
*/
export const SKINS = [
  { id: "default",  name: "Recruit",        price: 0,    rarity: "common",    obtain: "free",
    body: 0xe62429, leg: 0x1a1a1a, head: 0xf2c08a, accent: 0xffd700,
    helmet: null,   visor: null,    shoulder: null,  stripe: null,    belt: 0x4a2a0a, cape: null,
    aura: 0x000000, aura_mode: "none" },

  { id: "mech",     name: "Mech Recruit",   price: 0,    rarity: "rare",      obtain: "first_match",
    body: 0x6f7886, leg: 0x383e48, head: 0x6f7886, accent: 0x00e5ff,
    helmet: 0x4a525c, visor: 0x00e5ff, shoulder: 0x383e48, stripe: 0x00e5ff, belt: 0x2a2f37, cape: null,
    aura: 0x00b8d4, aura_mode: "pulse" },

  { id: "azure",    name: "Azure Ranger",   price: 200,  rarity: "common",    obtain: "shop",
    body: 0x0055ff, leg: 0x0a2a6b, head: 0xf2c08a, accent: 0x9adcff,
    helmet: 0x0a2a6b, visor: 0xffffff, shoulder: 0x9adcff, stripe: 0x9adcff, belt: 0x9adcff, cape: null,
    aura: 0x4ab8ff, aura_mode: "pulse" },

  { id: "neon",     name: "Neon Cyan",      price: 500,  rarity: "rare",      obtain: "shop",
    body: 0x00cfff, leg: 0x004b6b, head: 0xf2c08a, accent: 0xffffff,
    helmet: 0x004b6b, visor: 0xff00d4, shoulder: 0x00ffff, stripe: 0xff00d4, belt: 0x002a3a, cape: null,
    aura: 0x00ffff, aura_mode: "pulse" },

  { id: "crimson",  name: "Crimson Rogue",  price: 800,  rarity: "rare",      obtain: "shop",
    body: 0x6b0010, leg: 0x1a0306, head: 0xf2c08a, accent: 0xff3a3a,
    helmet: 0x2a0307, visor: 0xff3a3a, shoulder: 0xff3a3a, stripe: 0xff3a3a, belt: 0x0a0000, cape: 0x3a0008,
    aura: 0xff1a1a, aura_mode: "spin" },

  { id: "ghost",    name: "Ghost White",    price: 1200, rarity: "epic",      obtain: "shop",
    body: 0xeeeeee, leg: 0x9aa0a8, head: 0xeeeeee, accent: 0x6cb0ff,
    helmet: 0xc8cdd2, visor: 0x6cb0ff, shoulder: 0xffffff, stripe: 0x6cb0ff, belt: 0x9aa0a8, cape: 0xffffff,
    aura: 0xffffff, aura_mode: "flicker" },

  { id: "verdant",  name: "Verdant Hunter", price: 1500, rarity: "epic",      obtain: "shop",
    body: 0x1d6b29, leg: 0x0d3a16, head: 0xf2c08a, accent: 0xe8ff7a,
    helmet: 0x0d3a16, visor: 0xe8ff7a, shoulder: 0x6cff5e, stripe: 0xe8ff7a, belt: 0x4a3a1a, cape: 0x2a5a16,
    aura: 0x6cff5e, aura_mode: "pulse" },

  { id: "void",     name: "Void Walker",    price: 2000, rarity: "legendary", obtain: "shop",
    body: 0x14002a, leg: 0x000000, head: 0xb88be0, accent: 0xd400ff,
    helmet: 0x000000, visor: 0xd400ff, shoulder: 0xd400ff, stripe: 0xd400ff, belt: 0x05000a, cape: 0x1a002a,
    aura: 0xb000ff, aura_mode: "spin" },

  { id: "golden",   name: "Golden Apex",    price: 3000, rarity: "legendary", obtain: "shop",
    body: 0xffc700, leg: 0x6b4d00, head: 0xf2c08a, accent: 0xffffff,
    helmet: 0x6b4d00, visor: 0xffffff, shoulder: 0xffd700, stripe: 0xffffff, belt: 0x4a3500, cape: 0xffd700,
    aura: 0xffd700, aura_mode: "spin" },

  // ─── New animated shop skins ──────────────────────────────────────────
  { id: "prism",    name: "Prism Hunter",   price: 2500, rarity: "epic",      obtain: "shop",
    body: 0xffffff, leg: 0x222244, head: 0xf2c08a, accent: 0xff00ff,
    helmet: 0x222244, visor: 0xff00ff, shoulder: 0x00ffff, stripe: 0xffff00, belt: 0x222244, cape: 0xffffff,
    aura: 0xff00ff, aura_mode: "rainbow" },

  { id: "inferno",  name: "Inferno Lord",   price: 4500, rarity: "legendary", obtain: "shop",
    body: 0x6b0010, leg: 0x2a0000, head: 0xff8800, accent: 0xffd700,
    helmet: 0x3a0000, visor: 0xff5500, shoulder: 0xff5500, stripe: 0xffd700, belt: 0x1a0000, cape: 0xff5500,
    aura: 0xff5500, aura_mode: "flame" },

  { id: "glacier",  name: "Glacier Mage",   price: 2200, rarity: "epic",      obtain: "shop",
    body: 0x9adcff, leg: 0x0a2a6b, head: 0xeaf6ff, accent: 0xffffff,
    helmet: 0x0a2a6b, visor: 0x9adcff, shoulder: 0xeaf6ff, stripe: 0xffffff, belt: 0x0a2a6b, cape: 0xeaf6ff,
    aura: 0x9adcff, aura_mode: "frost" },

  { id: "toxic",    name: "Toxic Sniper",   price: 1100, rarity: "rare",      obtain: "shop",
    body: 0x0d3a16, leg: 0x05130a, head: 0xc8ffa8, accent: 0x6cff5e,
    helmet: 0x05130a, visor: 0x6cff5e, shoulder: 0x6cff5e, stripe: 0xc8ffa8, belt: 0x05130a, cape: null,
    aura: 0x6cff5e, aura_mode: "flicker" },

  { id: "cosmic",   name: "Cosmic Drift",   price: 3800, rarity: "legendary", obtain: "shop",
    body: 0x1a0033, leg: 0x000022, head: 0xc8a8ff, accent: 0xff00ff,
    helmet: 0x000022, visor: 0x00ffff, shoulder: 0xff00ff, stripe: 0x00ffff, belt: 0x000022, cape: 0xff00ff,
    aura: 0xff00ff, aura_mode: "comet" },

  // ─── Beach / swimsuit drop ───────────────────────────────────────────
  // Male: bare-chested surfer. Body == head skin tone so the torso reads
  // as skin, "leg" colour is the swim trunks, accent is a bright lanyard /
  // tan stripe. No helmet/visor/cape — beach vibes only. Sandy aura.
  { id: "beach_bro", name: "Beach Bro",      price: 900,  rarity: "rare",      obtain: "shop",
    body: 0xf2c08a, leg: 0xff4a6b, head: 0xf2c08a, accent: 0x00d4ff,
    helmet: null,   visor: null,    shoulder: null,  stripe: 0xffd700,
    belt: 0xffd700, cape: null,
    aura: 0xffd770, aura_mode: "pulse" },

  // Female: bikini + bare legs + cute sunglasses + long hair. Body =
  // skin tone (bare torso), bikini fabric uses `stripe` colour (pink),
  // accent is the gold bow detail. Visor = sunglasses. Floral pink aura.
  { id: "sun_goddess", name: "Sun Goddess",  price: 950,  rarity: "rare",      obtain: "shop",
    body: 0xf2c08a, leg: 0xf2c08a, head: 0xf2c08a, accent: 0xffd700,
    helmet: null,   visor: 0x1a1a1a, shoulder: null,  stripe: 0xff3a6b,
    belt: 0xff3a6b, cape: null,
    hair: 0x6b3a1a, bikini: true,
    aura: 0xff80c0, aura_mode: "spin" },

  // Pass-only — appear in shop only after they're owned (equip-only there).
  { id: "solar",    name: "Solar Inferno",  price: 0,    rarity: "epic",      obtain: "pass_tier_10",
    body: 0xff5500, leg: 0x6b1a00, head: 0xf2c08a, accent: 0xffd700,
    helmet: 0x6b1a00, visor: 0xffd700, shoulder: 0xff8a00, stripe: 0xffd700, belt: 0x3a0a00, cape: 0xff8a00,
    aura: 0xff8a00, aura_mode: "pulse" },

  { id: "cyber",    name: "Cyber Wraith",   price: 0,    rarity: "epic",      obtain: "pass_tier_20",
    body: 0x1a1a3a, leg: 0x05051a, head: 0xbac4d6, accent: 0x00ffaa,
    helmet: 0x05051a, visor: 0x00ffaa, shoulder: 0x00ffaa, stripe: 0x00ffaa, belt: 0x0a0a2a, cape: 0x00ffaa,
    aura: 0x00ffaa, aura_mode: "flicker" },

  { id: "quantum",  name: "Quantum Reaver", price: 0,    rarity: "legendary", obtain: "pass_tier_30",
    body: 0x4b0082, leg: 0x1a0033, head: 0xc8a8ff, accent: 0xffffff,
    helmet: 0x1a0033, visor: 0xffffff, shoulder: 0xff00ff, stripe: 0xffffff, belt: 0x4b0082, cape: 0xff00ff,
    aura: 0xff00ff, aura_mode: "spin" },
];

const BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));

export function skinById(id) {
  return BY_ID[id] || BY_ID.default;
}

export const RARITY_COLOR = {
  common:    "#9aa3ad",
  rare:      "#4ab8ff",
  epic:      "#d400ff",
  legendary: "#ffd700",
};
