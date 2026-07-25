/* Shared client-side map metadata. Mirrors server.py MAP_A / MAP_B and
   localSim.js MAP_A / MAP_B. Used by the MatchLoadingScreen to render
   a top-down minimap preview so players see WHAT they're loading into.

   Note: the actual map the server picks is also uniform random, so the
   preview here is illustrative for the loading screen — it may match or
   may not match the server's selection (50/50 odds with two maps). On
   welcome, the Game route swaps to the real arena geometry from the
   server payload. */

const _PERIMETER = [
  { x: 42, z: 42, w: 5, h: 6, d: 5 },
  { x: -42, z: 42, w: 5, h: 7, d: 5 },
  { x: 42, z: -42, w: 5, h: 5, d: 5 },
  { x: -42, z: -42, w: 5, h: 8, d: 5 },
  { x: 12, z: 38, w: 3, h: 4, d: 6 },
  { x: -12, z: 38, w: 3, h: 5, d: 6 },
  { x: 12, z: -38, w: 3, h: 5, d: 6 },
  { x: -12, z: -38, w: 3, h: 4, d: 6 },
  { x: 38, z: 12, w: 6, h: 4, d: 3 },
  { x: 38, z: -12, w: 6, h: 5, d: 3 },
  { x: -38, z: 12, w: 6, h: 4, d: 3 },
  { x: -38, z: -12, w: 6, h: 6, d: 3 },
];

export const MAP_DOWNTOWN = {
  map_id: "downtown",
  name: "DOWNTOWN",
  size: 50,
  // Single-sentence tagline for the loading screen.
  tagline: "Night city · neon-lit windows · mega-tower at center.",
  // Colours used by the SVG preview — match the engine's palette for this
  // map so the minimap looks visually consistent with the in-game view.
  palette: {
    bg: "#1a1f2e",       // dark asphalt (night street)
    border: "#0A0A0A",
    obstacle: "#3a4a7a", // night-tinted concrete
    crate: "#ff7b00",
    accent: "#FFE08A",   // glowing window yellow for the landmark
  },
  obstacles: [
    { x: 0, z: 0, w: 6, h: 8, d: 6 },           // central mega-tower
    { x: 9, z: 0, w: 3, h: 1.2, d: 3 },
    { x: -9, z: 0, w: 3, h: 1.2, d: 3 },
    { x: 0, z: 9, w: 3, h: 1.2, d: 3 },
    { x: 0, z: -9, w: 3, h: 1.2, d: 3 },
    { x: 18, z: 14, w: 4, h: 3, d: 8 },
    { x: 26, z: 24, w: 6, h: 4, d: 3 },
    { x: 14, z: 28, w: 3, h: 5, d: 3 },
    { x: 30, z: 12, w: 3, h: 3, d: 5 },
    { x: -18, z: -14, w: 8, h: 3, d: 4 },
    { x: -26, z: -24, w: 3, h: 4, d: 8 },
    { x: -10, z: -28, w: 6, h: 3, d: 3 },
    { x: -30, z: -12, w: 3, h: 3, d: 5 },
    { x: -18, z: 14, w: 4, h: 5, d: 4 },
    { x: -28, z: 20, w: 3, h: 4, d: 6 },
    { x: -5, z: 22, w: 10, h: 3, d: 3 },
    { x: -32, z: 5, w: 3, h: 4, d: 4 },
    { x: 20, z: -18, w: 6, h: 4, d: 4 },
    { x: 28, z: -22, w: 3, h: 5, d: 8 },
    { x: 8, z: -22, w: 3, h: 6, d: 3 },
    { x: 32, z: -5, w: 3, h: 4, d: 4 },
    { x: -35, z: 30, w: 8, h: 4, d: 2 },
    { x: 35, z: -30, w: 8, h: 4, d: 2 },
    { x: -38, z: -35, w: 2, h: 4, d: 8 },
    { x: 38, z: 35, w: 2, h: 4, d: 8 },
    { x: 4, z: 14, w: 1.6, h: 1.6, d: 1.6 },
    { x: -4, z: -14, w: 1.6, h: 1.6, d: 1.6 },
    { x: 14, z: -4, w: 1.6, h: 1.6, d: 1.6 },
    { x: -14, z: 4, w: 1.6, h: 1.6, d: 1.6 },
    ..._PERIMETER,
  ],
};

export const MAP_CROSSFIRE = {
  map_id: "crossfire",
  name: "CROSSFIRE",
  size: 50,
  tagline: "Corridor grid · diagonal pillars · long sightlines.",
  palette: {
    bg: "#4d7c8f",       // cooler ground (concrete plaza)
    border: "#0A0A0A",
    obstacle: "#2e5fa3", // blue concrete walls
    crate: "#ff7b00",
    accent: "#9b3a3f",   // red sniper nests
  },
  obstacles: [
    // Corridor walls
    { x: 6,  z: 0,  w: 2, h: 4, d: 20 },
    { x: -6, z: 0,  w: 2, h: 4, d: 20 },
    { x: 0,  z: 6,  w: 20, h: 4, d: 2 },
    { x: 0,  z: -6, w: 20, h: 4, d: 2 },
    // Diagonal pillars
    { x: 12,  z: 12,  w: 3, h: 5, d: 3 },
    { x: -12, z: 12,  w: 3, h: 5, d: 3 },
    { x: 12,  z: -12, w: 3, h: 5, d: 3 },
    { x: -12, z: -12, w: 3, h: 5, d: 3 },
    // Sniper nests
    { x: 22,  z: 0,  w: 3, h: 6, d: 4 },
    { x: -22, z: 0,  w: 3, h: 6, d: 4 },
    { x: 0,   z: 22, w: 4, h: 6, d: 3 },
    { x: 0,   z: -22, w: 4, h: 6, d: 3 },
    // Corner courtyards
    { x: 28,  z: 22,  w: 6, h: 3, d: 2 },
    { x: 22,  z: 28,  w: 2, h: 3, d: 6 },
    { x: -28, z: 22,  w: 6, h: 3, d: 2 },
    { x: -22, z: 28,  w: 2, h: 3, d: 6 },
    { x: 28,  z: -22, w: 6, h: 3, d: 2 },
    { x: 22,  z: -28, w: 2, h: 3, d: 6 },
    { x: -28, z: -22, w: 6, h: 3, d: 2 },
    { x: -22, z: -28, w: 2, h: 3, d: 6 },
    // Crates
    { x: 10, z: 18, w: 1.8, h: 1.8, d: 1.8 },
    { x: -10, z: 18, w: 1.8, h: 1.8, d: 1.8 },
    { x: 10, z: -18, w: 1.8, h: 1.8, d: 1.8 },
    { x: -10, z: -18, w: 1.8, h: 1.8, d: 1.8 },
    { x: 18, z: 10, w: 1.8, h: 1.8, d: 1.8 },
    { x: 18, z: -10, w: 1.8, h: 1.8, d: 1.8 },
    { x: -18, z: 10, w: 1.8, h: 1.8, d: 1.8 },
    { x: -18, z: -10, w: 1.8, h: 1.8, d: 1.8 },
    ..._PERIMETER,
  ],
};

export const MAP_SHORELINE = {
  map_id: "shoreline",
  name: "SHORELINE",
  size: 50,
  tagline: "Sandy plaza · piers + lifeguard towers · palms.",
  palette: {
    bg: "#e8c98a",       // warm sand
    border: "#0A0A0A",
    obstacle: "#8b5a2b", // weathered wood
    crate: "#5a3a1e",    // dark driftwood
    accent: "#2f8fbf",   // ocean blue for landmark / piers
  },
  obstacles: [
    // Piers
    { x: 0, z: 22, w: 4, h: 2, d: 16 },
    { x: 0, z: -22, w: 4, h: 2, d: 16 },
    { x: 0, z: 30, w: 6, h: 4, d: 4 },
    { x: 0, z: -30, w: 6, h: 4, d: 4 },
    // Lifeguard towers
    { x: 20, z: 20, w: 2.5, h: 7, d: 2.5 },
    { x: -20, z: 20, w: 2.5, h: 7, d: 2.5 },
    { x: 20, z: -20, w: 2.5, h: 7, d: 2.5 },
    { x: -20, z: -20, w: 2.5, h: 7, d: 2.5 },
    // Beach huts
    { x: 26, z: 0, w: 4, h: 3, d: 8 },
    { x: -26, z: 0, w: 4, h: 3, d: 8 },
    // Rocks
    { x: 8, z: 6, w: 1.8, h: 1.8, d: 1.8 },
    { x: -8, z: 6, w: 1.8, h: 1.8, d: 1.8 },
    { x: 8, z: -6, w: 1.8, h: 1.8, d: 1.8 },
    { x: -8, z: -6, w: 1.8, h: 1.8, d: 1.8 },
    { x: 12, z: 0, w: 1.6, h: 1.6, d: 1.6 },
    { x: -12, z: 0, w: 1.6, h: 1.6, d: 1.6 },
    // Palms
    { x: 14, z: 12, w: 1.2, h: 6, d: 1.2 },
    { x: -14, z: 12, w: 1.2, h: 6, d: 1.2 },
    { x: 14, z: -12, w: 1.2, h: 6, d: 1.2 },
    { x: -14, z: -12, w: 1.2, h: 6, d: 1.2 },
    { x: 6, z: 16, w: 1.2, h: 6, d: 1.2 },
    { x: -6, z: 16, w: 1.2, h: 6, d: 1.2 },
    { x: 6, z: -16, w: 1.2, h: 6, d: 1.2 },
    { x: -6, z: -16, w: 1.2, h: 6, d: 1.2 },
    // Shipwreck center
    { x: 0, z: 0, w: 7, h: 1.6, d: 4 },
    ..._PERIMETER,
  ],
};

export const MAP_CRASHSITE = {
  map_id: "crashsite",
  name: "CRASHSITE",
  size: 50,
  tagline: "Meteor impact · scorched earth · glowing crater core.",
  palette: {
    bg: "#3a2218",       // scorched dirt
    border: "#0A0A0A",
    obstacle: "#4a3a3a", // dark charcoal rock
    crate: "#ff7b00",
    accent: "#ff4a1a",   // ember orange for the meteor
  },
  obstacles: [
    // Central meteor + crater rim
    { x: 0,    z: 0,    w: 7,   h: 2.4, d: 7 },
    { x: 9,    z: 0,    w: 1.8, h: 1.6, d: 5 },
    { x: -9,   z: 0,    w: 1.8, h: 1.6, d: 5 },
    { x: 4.5,  z: 7.8,  w: 5,   h: 1.6, d: 1.8 },
    { x: -4.5, z: 7.8,  w: 5,   h: 1.6, d: 1.8 },
    { x: 4.5,  z: -7.8, w: 5,   h: 1.6, d: 1.8 },
    { x: -4.5, z: -7.8, w: 5,   h: 1.6, d: 1.8 },
    // Meteor shards
    { x: 14,   z: 14,   w: 2.4, h: 2.2, d: 2.4 },
    { x: -14,  z: 14,   w: 2.4, h: 2.2, d: 2.4 },
    { x: 14,   z: -14,  w: 2.4, h: 2.2, d: 2.4 },
    { x: -14,  z: -14,  w: 2.4, h: 2.2, d: 2.4 },
    { x: 18,   z: 6,    w: 2.0, h: 1.8, d: 2.0 },
    { x: -18,  z: 6,    w: 2.0, h: 1.8, d: 2.0 },
    { x: 18,   z: -6,   w: 2.0, h: 1.8, d: 2.0 },
    { x: -18,  z: -6,   w: 2.0, h: 1.8, d: 2.0 },
    // Burnt-out outposts at corners
    { x: 25,   z: 25,   w: 6,   h: 4,   d: 2 },
    { x: -25,  z: 25,   w: 6,   h: 4,   d: 2 },
    { x: 25,   z: -25,  w: 6,   h: 4,   d: 2 },
    { x: -25,  z: -25,  w: 6,   h: 4,   d: 2 },
    { x: 22,   z: 22,   w: 2,   h: 4,   d: 3 },
    { x: -22,  z: 22,   w: 2,   h: 4,   d: 3 },
    { x: 22,   z: -22,  w: 2,   h: 4,   d: 3 },
    { x: -22,  z: -22,  w: 2,   h: 4,   d: 3 },
    // Tall jagged pillars
    { x: 0,    z: 18,   w: 1.4, h: 5,   d: 1.4 },
    { x: 0,    z: -18,  w: 1.4, h: 5,   d: 1.4 },
    { x: 18,   z: 0,    w: 1.4, h: 5,   d: 1.4 },
    { x: -18,  z: 0,    w: 1.4, h: 5,   d: 1.4 },
    // Small rock clusters
    { x: 10,   z: 16,   w: 1.5, h: 1.5, d: 1.5 },
    { x: -10,  z: 16,   w: 1.5, h: 1.5, d: 1.5 },
    { x: 10,   z: -16,  w: 1.5, h: 1.5, d: 1.5 },
    { x: -10,  z: -16,  w: 1.5, h: 1.5, d: 1.5 },
    ..._PERIMETER,
  ],
};

export const MAP_TUNDRA = {
  map_id: "tundra",
  name: "TUNDRA",
  size: 50,
  tagline: "Frozen wasteland · snowdrifts + ice shards · overcast blizzard.",
  palette: {
    bg: "#f1f6fb",       // fresh powder snow
    border: "#0A0A0A",
    obstacle: "#9ec8e0", // glacial cyan cover
    crate: "#ff7b00",
    accent: "#4a6a88",   // deep steel-blue for ice shards
  },
  obstacles: [
    // Frozen central pond + ice-shard ring
    { x: 0,    z: 0,    w: 8,   h: 0.3, d: 8 },
    { x: 7.5,  z: 4.5,  w: 1.4, h: 3.2, d: 3.4 },
    { x: -7.5, z: 4.5,  w: 1.4, h: 3.2, d: 3.4 },
    { x: 7.5,  z: -4.5, w: 1.4, h: 3.2, d: 3.4 },
    { x: -7.5, z: -4.5, w: 1.4, h: 3.2, d: 3.4 },
    { x: 0,    z: 8.5,  w: 3.4, h: 3.2, d: 1.4 },
    { x: 0,    z: -8.5, w: 3.4, h: 3.2, d: 1.4 },
    // Snowdrift mid-cover
    { x: 15,   z: 0,    w: 2.2, h: 1.2, d: 6 },
    { x: -15,  z: 0,    w: 2.2, h: 1.2, d: 6 },
    { x: 0,    z: 15,   w: 6,   h: 1.2, d: 2.2 },
    { x: 0,    z: -15,  w: 6,   h: 1.2, d: 2.2 },
    { x: 11,   z: 11,   w: 3.0, h: 1.4, d: 3.0 },
    { x: -11,  z: 11,   w: 3.0, h: 1.4, d: 3.0 },
    { x: 11,   z: -11,  w: 3.0, h: 1.4, d: 3.0 },
    { x: -11,  z: -11,  w: 3.0, h: 1.4, d: 3.0 },
    // Frozen pine stumps
    { x: 6,    z: 20,   w: 1.2, h: 2.0, d: 1.2 },
    { x: -6,   z: 20,   w: 1.2, h: 2.0, d: 1.2 },
    { x: 6,    z: -20,  w: 1.2, h: 2.0, d: 1.2 },
    { x: -6,   z: -20,  w: 1.2, h: 2.0, d: 1.2 },
    { x: 20,   z: 6,    w: 1.2, h: 2.0, d: 1.2 },
    { x: 20,   z: -6,   w: 1.2, h: 2.0, d: 1.2 },
    { x: -20,  z: 6,    w: 1.2, h: 2.0, d: 1.2 },
    { x: -20,  z: -6,   w: 1.2, h: 2.0, d: 1.2 },
    // Wrecked research outposts at corners
    { x: 26,   z: 26,   w: 7,   h: 4,   d: 1.8 },
    { x: -26,  z: 26,   w: 7,   h: 4,   d: 1.8 },
    { x: 26,   z: -26,  w: 7,   h: 4,   d: 1.8 },
    { x: -26,  z: -26,  w: 7,   h: 4,   d: 1.8 },
    { x: 22,   z: 22,   w: 1.8, h: 4,   d: 3.2 },
    { x: -22,  z: 22,   w: 1.8, h: 4,   d: 3.2 },
    { x: 22,   z: -22,  w: 1.8, h: 4,   d: 3.2 },
    { x: -22,  z: -22,  w: 1.8, h: 4,   d: 3.2 },
    ..._PERIMETER,
  ],
};

export const MAP_HOTEL = {
  map_id: "hotel",
  name: "GRAND HOTEL",
  size: 50,
  tagline: "Fully indoor marble lobby · open atrium · mezzanine overlook.",
  palette: {
    bg: "#d8c99a",       // polished marble floor
    border: "#0A0A0A",
    obstacle: "#7a1e2b", // deep burgundy
    crate: "#c9a24a",    // brass luggage
    accent: "#d8b874",   // gold-leaf trim
  },
  obstacles: [
    // Indoor perimeter walls — fully enclosed hotel exterior walls.
    { x: 0,   z: -48, w: 96, h: 8, d: 2 },
    { x: 0,   z:  48, w: 96, h: 8, d: 2 },
    { x: 48,  z:  0,  w: 2,  h: 8, d: 96 },
    { x: -48, z:  0,  w: 2,  h: 8, d: 96 },
    // Structural support columns (perimeter supports — no exterior buildings).
    { x:  40, z:  40, w: 2, h: 8, d: 2 },
    { x: -40, z:  40, w: 2, h: 8, d: 2 },
    { x:  40, z: -40, w: 2, h: 8, d: 2 },
    { x: -40, z: -40, w: 2, h: 8, d: 2 },
    { x:  40, z:  14, w: 2, h: 8, d: 2 },
    { x:  40, z: -14, w: 2, h: 8, d: 2 },
    { x: -40, z:  14, w: 2, h: 8, d: 2 },
    { x: -40, z: -14, w: 2, h: 8, d: 2 },
    { x:  14, z:  40, w: 2, h: 8, d: 2 },
    { x: -14, z:  40, w: 2, h: 8, d: 2 },
    { x:  14, z: -40, w: 2, h: 8, d: 2 },
    { x: -14, z: -40, w: 2, h: 8, d: 2 },
    // Ground-floor cover (mirrors server MAP_F for the minimap preview).
    { x: 0,   z: -18, w: 22, h: 1.2, d: 2.0 },
    { x: 11,  z: -14, w: 2.0, h: 1.2, d: 6.0 },
    { x: -18, z: 18,  w: 6.0, h: 1.1, d: 2.0 },
    { x:  12, z:  12, w: 2.5, h: 8,   d: 2.5 },
    { x: -12, z:  12, w: 2.5, h: 8,   d: 2.5 },
    { x:  12, z: -12, w: 2.5, h: 8,   d: 2.5 },
    { x: -12, z: -12, w: 2.5, h: 8,   d: 2.5 },
    // NOTE: center of lobby (0, 0) is intentionally open — no fountain.
    { x: 30,  z: -6,  w: 2.0, h: 6,   d: 4.0 },
    { x: 30,  z:  6,  w: 2.0, h: 6,   d: 4.0 },
    { x: -30, z:  8,  w: 2.0, h: 3,   d: 6.0 },
    { x: -30, z: -8,  w: 2.0, h: 4,   d: 6.0 },
    { x:  6,  z:  22, w: 3.0, h: 1.0, d: 2.0 },
    { x: -6,  z:  22, w: 3.0, h: 1.0, d: 2.0 },
    { x:  6,  z: -24, w: 3.0, h: 1.0, d: 2.0 },
    { x: -6,  z: -24, w: 3.0, h: 1.0, d: 2.0 },
    { x: -22, z:  0,  w: 2.0, h: 4,   d: 10.0 },
    { x: -22, z: -22, w: 2.0, h: 4,   d: 6.0 },
    { x: -34, z:  0,  w: 2.0, h: 4,   d: 10.0 },
    { x:  0,  z:  30, w: 3.5, h: 1.4, d: 2.0 },
    { x:  8,  z:  4,  w: 1.6, h: 1.4, d: 1.6 },
    { x: -8,  z: -4,  w: 1.6, h: 1.4, d: 1.6 },
    { x:  16, z: -3,  w: 1.6, h: 1.4, d: 1.6 },
    { x: -16, z:  3,  w: 1.6, h: 1.4, d: 1.6 },
    // Lobby tables — waist-high crouch cover.
    { x:  20, z:  25, w: 1.4, h: 0.9, d: 1.4 },
    { x: -20, z:  25, w: 1.4, h: 0.9, d: 1.4 },
    { x:  20, z: -25, w: 1.4, h: 0.9, d: 1.4 },
    { x: -20, z: -25, w: 1.4, h: 0.9, d: 1.4 },
    { x:  32, z:  32, w: 1.4, h: 0.9, d: 1.4 },
    { x: -32, z:  32, w: 1.4, h: 0.9, d: 1.4 },
    { x:  32, z: -32, w: 1.4, h: 0.9, d: 1.4 },
    { x: -32, z: -32, w: 1.4, h: 0.9, d: 1.4 },
  ],
};

export const MAPS_META = [MAP_DOWNTOWN, MAP_CROSSFIRE, MAP_SHORELINE, MAP_CRASHSITE, MAP_TUNDRA, MAP_HOTEL];

export function pickRandomMapMeta() {
  return MAPS_META[Math.floor(Math.random() * MAPS_META.length)];
}

export function getMapMetaById(id) {
  return MAPS_META.find((m) => m.map_id === id) || null;
}
