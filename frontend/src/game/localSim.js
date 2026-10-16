/* LocalSim — client-side game simulation that replaces the WebSocket for
   offline-vs-AI and practice modes. Mirrors the wire format produced by
   server.py so the engine + HUD can consume it identically.

   Public API mirrors GameSocket: connect(token, mode), send(msg), close(),
   onOpen/onMessage/onClose callbacks. */

/* Local maps mirror server.py's MAP_A / MAP_B. Both share the same
   50-unit footprint + outer perimeter buildings so the skyline reads as
   the same city; only the inner cover layout differs. A random map is
   picked each time LocalSim is constructed so offline-vs-AI also cycles
   through both arenas. */

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

const MAP_A = {
  map_id: "downtown",
  name: "DOWNTOWN",
  size: 50,
  obstacles: [
    { x: 0, z: 0, w: 6, h: 8, d: 6 },
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
  spawn_points: [
    [35, 35], [-35, 35], [35, -35], [-35, -35],
    [0, 40], [0, -40], [40, 0], [-40, 0],
    [22, -2], [-22, 2],
  ],
};

const MAP_B = {
  map_id: "crossfire",
  name: "CROSSFIRE",
  size: 50,
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
    // Mid-ring sniper nests
    { x: 22,  z: 0,  w: 3, h: 6, d: 4 },
    { x: -22, z: 0,  w: 3, h: 6, d: 4 },
    { x: 0,   z: 22, w: 4, h: 6, d: 3 },
    { x: 0,   z: -22, w: 4, h: 6, d: 3 },
    // Corner courtyards (L-shapes)
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
  spawn_points: [
    [0, 30], [0, -30], [30, 0], [-30, 0],
    [32, 32], [-32, 32], [32, -32], [-32, -32],
    [16, 0], [-16, 0],
  ],
};

const MAP_C = {
  map_id: "shoreline",
  name: "SHORELINE",
  size: 50,
  obstacles: [
    // Wooden piers
    { x: 0, z: 22, w: 4, h: 2, d: 16 },
    { x: 0, z: -22, w: 4, h: 2, d: 16 },
    // Pier-end shacks
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
    // Midfield rocks
    { x: 8, z: 6, w: 1.8, h: 1.8, d: 1.8 },
    { x: -8, z: 6, w: 1.8, h: 1.8, d: 1.8 },
    { x: 8, z: -6, w: 1.8, h: 1.8, d: 1.8 },
    { x: -8, z: -6, w: 1.8, h: 1.8, d: 1.8 },
    { x: 12, z: 0, w: 1.6, h: 1.6, d: 1.6 },
    { x: -12, z: 0, w: 1.6, h: 1.6, d: 1.6 },
    // Palm trunks
    { x: 14, z: 12, w: 1.2, h: 6, d: 1.2 },
    { x: -14, z: 12, w: 1.2, h: 6, d: 1.2 },
    { x: 14, z: -12, w: 1.2, h: 6, d: 1.2 },
    { x: -14, z: -12, w: 1.2, h: 6, d: 1.2 },
    { x: 6, z: 16, w: 1.2, h: 6, d: 1.2 },
    { x: -6, z: 16, w: 1.2, h: 6, d: 1.2 },
    { x: 6, z: -16, w: 1.2, h: 6, d: 1.2 },
    { x: -6, z: -16, w: 1.2, h: 6, d: 1.2 },
    // Central wreckage
    { x: 0, z: 0, w: 7, h: 1.6, d: 4 },
    ..._PERIMETER,
  ],
  spawn_points: [
    [32, 0], [-32, 0], [0, 38], [0, -38],
    [28, 28], [-28, 28], [28, -28], [-28, -28],
    [18, 0], [-18, 0],
  ],
};

// CRASHSITE — meteor impact site, mirrors server.py MAP_D.
const MAP_D = {
  map_id: "crashsite",
  name: "CRASHSITE",
  size: 50,
  obstacles: [
    // Central meteor boulder
    { x: 0,    z: 0,    w: 7,   h: 2.4, d: 7 },
    // Crater rim wedges (rough hexagon around the meteor)
    { x: 9,    z: 0,    w: 1.8, h: 1.6, d: 5 },
    { x: -9,   z: 0,    w: 1.8, h: 1.6, d: 5 },
    { x: 4.5,  z: 7.8,  w: 5,   h: 1.6, d: 1.8 },
    { x: -4.5, z: 7.8,  w: 5,   h: 1.6, d: 1.8 },
    { x: 4.5,  z: -7.8, w: 5,   h: 1.6, d: 1.8 },
    { x: -4.5, z: -7.8, w: 5,   h: 1.6, d: 1.8 },
    // Shattered meteor shards
    { x: 14,   z: 14,   w: 2.4, h: 2.2, d: 2.4 },
    { x: -14,  z: 14,   w: 2.4, h: 2.2, d: 2.4 },
    { x: 14,   z: -14,  w: 2.4, h: 2.2, d: 2.4 },
    { x: -14,  z: -14,  w: 2.4, h: 2.2, d: 2.4 },
    { x: 18,   z: 6,    w: 2.0, h: 1.8, d: 2.0 },
    { x: -18,  z: 6,    w: 2.0, h: 1.8, d: 2.0 },
    { x: 18,   z: -6,   w: 2.0, h: 1.8, d: 2.0 },
    { x: -18,  z: -6,   w: 2.0, h: 1.8, d: 2.0 },
    // Burnt-out outposts at the corners
    { x: 25,   z: 25,   w: 6,   h: 4,   d: 2 },
    { x: -25,  z: 25,   w: 6,   h: 4,   d: 2 },
    { x: 25,   z: -25,  w: 6,   h: 4,   d: 2 },
    { x: -25,  z: -25,  w: 6,   h: 4,   d: 2 },
    { x: 22,   z: 22,   w: 2,   h: 4,   d: 3 },
    { x: -22,  z: 22,   w: 2,   h: 4,   d: 3 },
    { x: 22,   z: -22,  w: 2,   h: 4,   d: 3 },
    { x: -22,  z: -22,  w: 2,   h: 4,   d: 3 },
    // Tall jagged rock pillars
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
  spawn_points: [
    [28, 28], [-28, 28], [28, -28], [-28, -28],
    [32, 0], [-32, 0], [0, 32], [0, -32],
    [20, 12], [-20, 12], [20, -12], [-20, -12],
  ],
};

const MAP_E = {
  map_id: "tundra",
  name: "TUNDRA",
  size: 50,
  obstacles: [
    // Frozen central pond + ice-shard ring
    { x: 0,    z: 0,    w: 8,   h: 0.3, d: 8 },
    { x: 7.5,  z: 4.5,  w: 1.4, h: 3.2, d: 3.4 },
    { x: -7.5, z: 4.5,  w: 1.4, h: 3.2, d: 3.4 },
    { x: 7.5,  z: -4.5, w: 1.4, h: 3.2, d: 3.4 },
    { x: -7.5, z: -4.5, w: 1.4, h: 3.2, d: 3.4 },
    { x: 0,    z: 8.5,  w: 3.4, h: 3.2, d: 1.4 },
    { x: 0,    z: -8.5, w: 3.4, h: 3.2, d: 1.4 },
    // Snowdrifts
    { x: 15,   z: 0,    w: 2.2, h: 1.2, d: 6 },
    { x: -15,  z: 0,    w: 2.2, h: 1.2, d: 6 },
    { x: 0,    z: 15,   w: 6,   h: 1.2, d: 2.2 },
    { x: 0,    z: -15,  w: 6,   h: 1.2, d: 2.2 },
    { x: 11,   z: 11,   w: 3.0, h: 1.4, d: 3.0 },
    { x: -11,  z: 11,   w: 3.0, h: 1.4, d: 3.0 },
    { x: 11,   z: -11,  w: 3.0, h: 1.4, d: 3.0 },
    { x: -11,  z: -11,  w: 3.0, h: 1.4, d: 3.0 },
    // Pine stumps
    { x: 6,    z: 20,   w: 1.2, h: 2.0, d: 1.2 },
    { x: -6,   z: 20,   w: 1.2, h: 2.0, d: 1.2 },
    { x: 6,    z: -20,  w: 1.2, h: 2.0, d: 1.2 },
    { x: -6,   z: -20,  w: 1.2, h: 2.0, d: 1.2 },
    { x: 20,   z: 6,    w: 1.2, h: 2.0, d: 1.2 },
    { x: 20,   z: -6,   w: 1.2, h: 2.0, d: 1.2 },
    { x: -20,  z: 6,    w: 1.2, h: 2.0, d: 1.2 },
    { x: -20,  z: -6,   w: 1.2, h: 2.0, d: 1.2 },
    // Wrecked outposts
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
  spawn_points: [
    [28, 28], [-28, 28], [28, -28], [-28, -28],
    [32, 0], [-32, 0], [0, 32], [0, -32],
    [18, 14], [-18, 14], [18, -14], [-18, -14],
  ],
};

const MAP_F = {
  map_id: "hotel",
  name: "ROYAL GUARD",
  size: 50,
  obstacles: [
    // ---- INDOOR PERIMETER WALLS ----
    // Fully seal the arena so it reads as a closed hotel interior,
    // not an outdoor city block. Solid + tall so no gaps to shoot out.
    { x: 0,   z: -48, w: 96, h: 8, d: 2 },
    { x: 0,   z:  48, w: 96, h: 8, d: 2 },
    { x: 48,  z:  0,  w: 2,  h: 8, d: 96 },
    { x: -48, z:  0,  w: 2,  h: 8, d: 96 },
    // ---- STRUCTURAL SUPPORT COLUMNS ----
    // Load-bearing columns replacing the outdoor perimeter buildings.
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
    // ---- GROUND FLOOR (center of lobby is now OPEN — no fountain) ----
    { x: 0,   z: -18, w: 22, h: 1.2, d: 2.0 },       // Reception desk
    { x: 11,  z: -14, w: 2.0, h: 1.2, d: 6.0 },
    { x: -18, z:  18, w: 6.0, h: 1.1, d: 2.0 },      // Bell-desk
    // Central marble columns (support the mezzanine visually).
    { x:  12, z:  12, w: 2.5, h: 8, d: 2.5 },
    { x: -12, z:  12, w: 2.5, h: 8, d: 2.5 },
    { x:  12, z: -12, w: 2.5, h: 8, d: 2.5 },
    { x: -12, z: -12, w: 2.5, h: 8, d: 2.5 },
    // Elevator bank
    { x: 30, z: -6, w: 2.0, h: 6, d: 4.0 },
    { x: 30, z:  6, w: 2.0, h: 6, d: 4.0 },
    // Staircase
    { x: -30, z:  8, w: 2.0, h: 3, d: 6.0 },
    { x: -30, z: -8, w: 2.0, h: 4, d: 6.0 },
    // Lounge seating
    { x:  6, z:  22, w: 3.0, h: 1.0, d: 2.0 },
    { x: -6, z:  22, w: 3.0, h: 1.0, d: 2.0 },
    { x:  6, z: -24, w: 3.0, h: 1.0, d: 2.0 },
    { x: -6, z: -24, w: 3.0, h: 1.0, d: 2.0 },
    // Corridor walls
    { x: -22, z:  0,  w: 2.0, h: 4, d: 10.0 },
    { x: -22, z: -22, w: 2.0, h: 4, d: 6.0 },
    { x: -34, z:  0,  w: 2.0, h: 4, d: 10.0 },
    // Grand piano
    { x:  0, z:  30, w: 3.5, h: 1.4, d: 2.0 },
    // Luggage carts
    { x:   8, z:   4, w: 1.6, h: 1.4, d: 1.6 },
    { x:  -8, z:  -4, w: 1.6, h: 1.4, d: 1.6 },
    { x:  16, z:  -3, w: 1.6, h: 1.4, d: 1.6 },
    { x: -16, z:   3, w: 1.6, h: 1.4, d: 1.6 },
    // ---- LOBBY TABLES (waist-high crouch cover) ----
    { x:  20, z:  25, w: 1.4, h: 0.9, d: 1.4 },
    { x: -20, z:  25, w: 1.4, h: 0.9, d: 1.4 },
    { x:  20, z: -25, w: 1.4, h: 0.9, d: 1.4 },
    { x: -20, z: -25, w: 1.4, h: 0.9, d: 1.4 },
    { x:  32, z:  32, w: 1.4, h: 0.9, d: 1.4 },
    { x: -32, z:  32, w: 1.4, h: 0.9, d: 1.4 },
    { x:  32, z: -32, w: 1.4, h: 0.9, d: 1.4 },
    { x: -32, z: -32, w: 1.4, h: 0.9, d: 1.4 },
    // ---- SECOND STORY (visual only — y_base > 0, engine skips ground
    // collision) so bot AI won't get stuck on floating cover.
    { x:  20, z: 0,   w: 3, h: 0.8, d: 26, y_base: 8 },
    { x: -20, z: 0,   w: 3, h: 0.8, d: 26, y_base: 8 },
    { x:   0, z:  20, w: 26, h: 0.8, d: 3, y_base: 8 },
    { x:   0, z: -20, w: 26, h: 0.8, d: 3, y_base: 8 },
    { x:  18.5, z:  0,  w: 0.4, h: 1.6, d: 26, y_base: 8.8 },
    { x: -18.5, z:  0,  w: 0.4, h: 1.6, d: 26, y_base: 8.8 },
    { x:  0, z:  18.5, w: 26, h: 1.6, d: 0.4, y_base: 8.8 },
    { x:  0, z: -18.5, w: 26, h: 1.6, d: 0.4, y_base: 8.8 },
    // Ceiling covers the full 100x100 arena so no sky is visible from inside.
    { x: 0, z: 0, w: 100, h: 0.6, d: 100, y_base: 14 },
    { x: -17, z:  10, w: 2, h: 3, d: 0.4, y_base: 8.8 },
    { x: -17, z:   0, w: 2, h: 3, d: 0.4, y_base: 8.8 },
    { x: -17, z: -10, w: 2, h: 3, d: 0.4, y_base: 8.8 },
    { x:  17, z:  10, w: 2, h: 3, d: 0.4, y_base: 8.8 },
    { x:  17, z:   0, w: 2, h: 3, d: 0.4, y_base: 8.8 },
    { x:  17, z: -10, w: 2, h: 3, d: 0.4, y_base: 8.8 },
  ],
  spawn_points: [
    [35, 35], [-35, 35], [35, -35], [-35, -35],
    [0, 38], [0, -38], [38, 0], [-38, 0],
    [26, 20], [-26, 20], [26, -20], [-26, -20],
  ],
};

const MAP_G = {
  // SILENT TOWN — foggy stormy swamp + woods. Same obstacle layout as
  // server.py's MAP_G so gameplay feels identical between the offline
  // client sim and the real server rooms.
  map_id: "swamp",
  name: "SILENT TOWN",
  size: 50,
  obstacles: [
    // Central ruined altar
    { x: 0,   z: 0,   w: 8,   h: 0.8, d: 8 },
    { x:  3.2, z:  3.2, w: 1.4, h: 2.6, d: 1.4 },
    { x: -3.2, z:  3.2, w: 1.4, h: 2.6, d: 1.4 },
    { x:  3.2, z: -3.2, w: 1.4, h: 2.6, d: 1.4 },
    { x: -3.2, z: -3.2, w: 1.4, h: 2.6, d: 1.4 },
    // Flanking bog islands
    { x:  20, z:  0,   w: 5,   h: 3.2, d: 1.2 },
    { x:  20, z:  3.5, w: 1.2, h: 2.2, d: 2.4 },
    { x: -20, z:  0,   w: 5,   h: 3.2, d: 1.2 },
    { x: -20, z: -3.5, w: 1.2, h: 2.2, d: 2.4 },
    // Fallen logs
    { x:  10, z:  14,  w: 6,   h: 1.0, d: 1.1 },
    { x: -12, z:  14,  w: 5.5, h: 1.0, d: 1.1 },
    { x:  12, z: -16,  w: 5,   h: 1.0, d: 1.1 },
    { x: -10, z: -14,  w: 6,   h: 1.0, d: 1.1 },
    { x:  0,  z:  16,  w: 1.1, h: 1.0, d: 6.5 },
    { x:  0,  z: -16,  w: 1.1, h: 1.0, d: 6.5 },
    // Standing dead trees
    { x:  8,  z:  8,   w: 1.0, h: 5.5, d: 1.0 },
    { x: -8,  z:  8,   w: 1.0, h: 5.5, d: 1.0 },
    { x:  8,  z: -8,   w: 1.0, h: 5.5, d: 1.0 },
    { x: -8,  z: -8,   w: 1.0, h: 5.5, d: 1.0 },
    { x:  14, z:  6,   w: 1.0, h: 5.0, d: 1.0 },
    { x: -14, z:  6,   w: 1.0, h: 5.0, d: 1.0 },
    { x:  14, z: -6,   w: 1.0, h: 5.0, d: 1.0 },
    { x: -14, z: -6,   w: 1.0, h: 5.0, d: 1.0 },
    { x:  6,  z:  20,  w: 1.0, h: 5.5, d: 1.0 },
    { x: -6,  z:  20,  w: 1.0, h: 5.5, d: 1.0 },
    { x:  6,  z: -20,  w: 1.0, h: 5.5, d: 1.0 },
    { x: -6,  z: -20,  w: 1.0, h: 5.5, d: 1.0 },
    // Mossy boulders
    { x:  18, z:  18,  w: 2.2, h: 1.4, d: 2.2 },
    { x: -18, z:  18,  w: 2.2, h: 1.4, d: 2.2 },
    { x:  18, z: -18,  w: 2.2, h: 1.4, d: 2.2 },
    { x: -18, z: -18,  w: 2.2, h: 1.4, d: 2.2 },
    { x:  26, z:  10,  w: 1.8, h: 1.2, d: 1.8 },
    { x: -26, z:  10,  w: 1.8, h: 1.2, d: 1.8 },
    { x:  26, z: -10,  w: 1.8, h: 1.2, d: 1.8 },
    { x: -26, z: -10,  w: 1.8, h: 1.2, d: 1.8 },
    // Corner watchtower ruins
    { x:  30, z:  30,  w: 6,   h: 3.6, d: 1.4 },
    { x:  33, z:  27,  w: 1.4, h: 3.6, d: 4.0 },
    { x: -30, z:  30,  w: 6,   h: 3.6, d: 1.4 },
    { x: -33, z:  27,  w: 1.4, h: 3.6, d: 4.0 },
    { x:  30, z: -30,  w: 6,   h: 3.6, d: 1.4 },
    { x:  33, z: -27,  w: 1.4, h: 3.6, d: 4.0 },
    { x: -30, z: -30,  w: 6,   h: 3.6, d: 1.4 },
    { x: -33, z: -27,  w: 1.4, h: 3.6, d: 4.0 },
  ],
  spawn_points: [
    [28, 28], [-28, 28], [28, -28], [-28, -28],
    [32, 0], [-32, 0], [0, 32], [0, -32],
    [18, 12], [-18, 12], [18, -12], [-18, -12],
  ],
};

const MAPS = [MAP_A, MAP_B, MAP_C, MAP_D, MAP_E, MAP_F, MAP_G];

// Active arena for this LocalSim run — re-rolled on each instance below.
let ARENA = MAP_A;
let SPAWN_POINTS = MAP_A.spawn_points;
function _pickMap(forcedId) {
  // If the caller (practice map selector) requested a specific map, honour
  // that instead of rolling randomly.
  let m = forcedId ? MAPS.find((mp) => mp.map_id === forcedId) : null;
  if (!m) m = MAPS[Math.floor(Math.random() * MAPS.length)];
  ARENA = m;
  SPAWN_POINTS = m.spawn_points;
  return m;
}
const PLAYER_RADIUS = 0.5;
const PLAYER_HEIGHT = 1.8;
const BOT_MAX_HP = 80;
const MAX_HP = 100;

const WEAPONS = {
  ak47:   { damage: 22,  cooldown_ms: 110,  mag_size: 25, reload_ms: 1500, range: 60 },
  sniper: { damage: 50,  cooldown_ms: 250,  mag_size: 2,  reload_ms: 1500, range: 120, headshot_mult: 2.0 },
  laser:  { damage: 5,   cooldown_ms: 90,   mag_size: 60, reload_ms: 1800, range: 40 },
};
const MELEE_DAMAGE = 100;
const MELEE_RANGE = 2.6;
const MELEE_CONE = 0.55;
const MELEE_COOLDOWN_MS = 450;

// Mirrors server pick_bot_weapon; odds cached from public /api/bot_loadout.
function pickOfflineBotWeapon(rankTier) {
  let lo = { sniper_low: 6, sniper_high: 45, laser: 15 };
  try { lo = { ...lo, ...JSON.parse(localStorage.getItem("virtue_bot_loadout") || "{}") }; } catch { /* default */ }
  const tier = Math.max(0, Math.min(7, rankTier | 0));
  const sniperP = (lo.sniper_low + (lo.sniper_high - lo.sniper_low) * tier / 7) / 100;
  const laserP = Math.min(lo.laser / 100, Math.max(0, 1 - sniperP));
  const r = Math.random();
  return r < sniperP ? "sniper" : r < sniperP + laserP ? "laser" : "ak47";
}

const BOT_NAMES = [
  "Wraith-X", "Vortex-7", "Blaze-Δ", "Cipher-9", "Raven-K",
  "Nyx-Ω", "Hex-3", "Zap-Σ", "Rune-1", "Shade-8",
];

const COMIC_INSULTS = [
  "Get rekt!", "Booyah!", "Skill issue.", "Easy.", "GG ez.",
  "Try harder!", "Catch these hands.", "Press F.",
];

function spawn() {
  const [x, z] = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  return { x: x + (Math.random() - 0.5) * 4, z: z + (Math.random() - 0.5) * 4 };
}

function collidesAABB(x, z, r = PLAYER_RADIUS) {
  if (x < -ARENA.size + r || x > ARENA.size - r) return true;
  if (z < -ARENA.size + r || z > ARENA.size - r) return true;
  for (const ob of ARENA.obstacles) {
    // Skip floating (mezzanine/ceiling) obstacles — they're visual only
    // and shouldn't block ground movement. Mirrors server behavior.
    if ((ob.y_base || 0) > 0) continue;
    const hx = ob.w / 2 + r, hz = ob.d / 2 + r;
    if (Math.abs(x - ob.x) < hx && Math.abs(z - ob.z) < hz) return true;
  }
  return false;
}

// 2D segment vs AABB intersection (used for line-of-sight). Returns true if blocked.
function segBlockedByObstacles(x0, z0, x1, z1) {
  for (const ob of ARENA.obstacles) {
    // Skip floating obstacles for LOS (bullets/sight travel under the mezzanine).
    if ((ob.y_base || 0) > 0) continue;
    const minX = ob.x - ob.w / 2, maxX = ob.x + ob.w / 2;
    const minZ = ob.z - ob.d / 2, maxZ = ob.z + ob.d / 2;
    const dx = x1 - x0, dz = z1 - z0;
    let tmin = 0, tmax = 1;
    for (const [p, q, lo, hi] of [
      [-dx, x0 - minX, minX, maxX],
      [ dx, maxX - x0, minX, maxX],
      [-dz, z0 - minZ, minZ, maxZ],
      [ dz, maxZ - z0, minZ, maxZ],
    ]) {
      void lo; void hi;
      if (Math.abs(p) < 1e-9) {
        if (q < 0) { tmin = 1; tmax = 0; break; }
      } else {
        const t = q / p;
        if (p < 0) { if (t > tmin) tmin = t; }
        else        { if (t < tmax) tmax = t; }
      }
    }
    if (tmax >= tmin && tmin < 1 && tmax > 0) return true;
  }
  return false;
}

// 3D segment vs AABB intersection for hitscan. Respects each obstacle's
// height (and `y_base` for floating geometry) so bullets aimed above
// short cover (tables, lounge seats, reception desk) pass over cleanly
// instead of getting blocked by a full-height 2D shadow. Returns true
// if the segment intersects any obstacle's full 3D box.
function segBlockedByObstacles3D(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  for (const ob of ARENA.obstacles) {
    const yb = Number(ob.y_base || 0);
    const mnX = ob.x - ob.w / 2, mxX = ob.x + ob.w / 2;
    const mnY = yb,              mxY = yb + ob.h;
    const mnZ = ob.z - ob.d / 2, mxZ = ob.z + ob.d / 2;
    let tmin = 0, tmax = 1;
    let hit = true;
    for (const [o, d, lo, hi] of [
      [x0, dx, mnX, mxX],
      [y0, dy, mnY, mxY],
      [z0, dz, mnZ, mxZ],
    ]) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { hit = false; break; }
      } else {
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { hit = false; break; }
      }
    }
    if (hit && tmin < 1 && tmax > 0) return true;
  }
  return false;
}

// Ray-vs-vertical-capsule for hitscan. Returns distance or null.
function rayHitCapsule(ox, oy, oz, dx, dy, dz, cx, cz, capR = 0.45, ground = 0, top = PLAYER_HEIGHT) {
  // Cylinder intersection in xz.
  const ax = ox - cx, az = oz - cz;
  const a = dx * dx + dz * dz;
  const b = 2 * (ax * dx + az * dz);
  const c = ax * ax + az * az - capR * capR;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  const t2 = (-b + s) / (2 * a);
  for (const t of [t1, t2]) {
    if (t < 0) continue;
    const hy = oy + dy * t;
    if (hy >= ground && hy <= top) return { t, y: hy };
  }
  return null;
}

let _idCounter = 0;
function genId(prefix) { _idCounter += 1; return `${prefix}_${_idCounter.toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`; }

class LocalPlayer {
  constructor(opts) {
    this.id = opts.id;
    this.username = opts.username;
    this.is_bot = !!opts.is_bot;
    this.avatar = opts.avatar ?? 0;
    this.rank_tier = opts.rank_tier ?? 0;
    this.rank_name = opts.rank_name ?? (opts.is_bot ? "BOT" : "BRONZE");
    this.rank_points = opts.rank_points ?? 0;
    this.banner_icon = opts.banner_icon ?? 0;
    this.banner_color = opts.banner_color ?? 0;
    this.banner_animated = !!opts.banner_animated;
    this.peak_rank_tier = opts.peak_rank_tier ?? 0;
    this.level = opts.level ?? 1;
    // Skin shown on the humanoid. Bots get a random non-default skin so
    // the local arena visually matches the online lobby's variety.
    this.skin = opts.skin ?? (opts.is_bot
      ? ["default", "azure", "neon", "crimson", "verdant", "ghost"][Math.floor(Math.random() * 6)]
      : "default");
    this.max_hp = opts.is_bot ? BOT_MAX_HP : MAX_HP;
    this.hp = this.max_hp;
    const sp = spawn();
    this.x = sp.x; this.y = PLAYER_HEIGHT; this.z = sp.z;
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.alive = true;
    this.kills = 0;
    this.deaths = 0;
    this.respawn_at = 0;
    this.invuln_until = performance.now() + 3000;
    this.last_shot_ms = 0;
    this.last_melee_ms = 0;
    this.weapon = (opts.weapon === "sniper" || opts.weapon === "laser") ? opts.weapon : "ak47";
    this.is_ads = false;
    this.ammo = { ak47: WEAPONS.ak47.mag_size, sniper: WEAPONS.sniper.mag_size, laser: WEAPONS.laser.mag_size };
    this.reload_until_ms = { ak47: 0, sniper: 0, laser: 0 };
    // Laser beam state (continuous-fire weapon)
    this.laser_heat = 0;
    this.laser_overheated = false;
    this.laser_firing = false;
    this._lastBeamTickMs = 0;
    this.platform = opts.is_bot ? "pc" : "pc";
    // Bot AI state
    this.botDir = Math.random() * Math.PI * 2;
    this.botRepathAt = 0;
    // Initial 2-3s delay so bots don't shoot during the player's spawn invuln.
    this.botFireAt = performance.now() + 2200 + Math.random() * 1600;
  }
  cur_ammo() { return this.ammo[this.weapon] || 0; }
  mag_size() { return WEAPONS[this.weapon]?.mag_size || 0; }
  is_reloading(now) { return now < (this.reload_until_ms[this.weapon] || 0); }
  reload_progress(now) {
    const end = this.reload_until_ms[this.weapon] || 0;
    const cfg = WEAPONS[this.weapon];
    if (!cfg || now >= end) return 1.0;
    return Math.max(0, 1 - (end - now) / cfg.reload_ms);
  }
  start_reload(now) {
    const cfg = WEAPONS[this.weapon];
    if (!cfg) return;
    if (this.ammo[this.weapon] >= cfg.mag_size) return;
    if (this.is_reloading(now)) return;
    this.reload_until_ms[this.weapon] = now + cfg.reload_ms;
  }
  finish_reload_if_due(now) {
    for (const w of Object.keys(this.reload_until_ms)) {
      const end = this.reload_until_ms[w];
      if (end > 0 && now >= end) {
        this.ammo[w] = WEAPONS[w].mag_size;
        this.reload_until_ms[w] = 0;
      }
    }
  }
  to_state(now) {
    return {
      id: this.id,
      username: this.username,
      is_bot: this.is_bot,
      avatar: this.avatar,
      rank_tier: this.rank_tier,
      rank_name: this.rank_name,
      rank_points: this.rank_points,
      banner_icon: this.banner_icon,
      banner_color: this.banner_color,
      banner_animated: this.banner_animated,
      peak_rank_tier: this.peak_rank_tier,
      level: this.level,
      skin: this.skin,
      platform: this.platform,
      x: this.x, y: this.y, z: this.z,
      yaw: this.yaw, pitch: this.pitch,
      hp: this.hp, alive: this.alive,
      kills: this.kills, deaths: this.deaths,
      invuln: now < this.invuln_until,
      ammo: this.cur_ammo(),
      mag_size: this.mag_size(),
      reloading: this.is_reloading(now),
      reload_progress: Number(this.reload_progress(now).toFixed(3)),
      spread: 0,
      weapon: this.weapon,
      aim_at: this.is_bot && this.weapon === "sniper" ? (this.aim_at || null) : null,
      laser_heat: Number((this.laser_heat || 0).toFixed(3)),
      laser_overheated: !!this.laser_overheated,
      laser_firing: !!this.laser_firing,
    };
  }
}

export class LocalSim {
  constructor({ onMessage, onClose, onOpen, user, mode, mapId } = {}) {
    this.onMessage = onMessage || (() => {});
    this.onClose = onClose || (() => {});
    this.onOpen = onOpen || (() => {});
    this.user = user || { username: "You" };
    this.mode = mode || "offline"; // "offline" | "practice"
    // Optional forced map id ("downtown" | "crossfire" | "shoreline").
    // Set by the practice map selector. If null, _pickMap() rolls random.
    this.mapId = mapId || null;
    this.players = new Map();
    this.me = null;
    this.pendingEvents = [];
    this.tickHandle = null;
    this._intentional = false;
    // Offline FFA matches end after 2 minutes (practice mode has no timer).
    // We track in ms (performance.now()) so the tick loop can decrement
    // and emit match_end identically to the server.
    this.matchDuration = this.mode === "offline" ? 120 : null;
    this.matchStartMs = null;
    this.matchEnded = false;
  }

  connect() {
    // Pick a map for this local match — honours the constructor's mapId
    // override (practice mode map selector), otherwise rolls random.
    _pickMap(this.mapId);
    // Create local player
    const me = new LocalPlayer({
      id: genId("p"),
      username: this.user?.username || "You",
      is_bot: false,
      avatar: this.user?.avatar ?? 0,
      rank_tier: this.user?.rank_tier ?? 0,
      rank_name: this.user?.rank_name || "BRONZE",
      rank_points: this.user?.rank_points ?? 0,
      banner_icon: this.user?.banner_icon ?? 0,
      banner_color: this.user?.banner_color ?? 0,
      banner_animated: !!this.user?.banner_animated,
      peak_rank_tier: this.user?.peak_rank_tier ?? 0,
      level: this.user?.level ?? 1,
      skin: this.user?.selected_skin || "default",
      weapon: this.user?.primary_weapon === "sniper" ? "sniper" : "ak47",
    });
    this.me = me;
    this.players.set(me.id, me);

    // Spawn bots
    const botCount = this.mode === "practice" ? 4 : 3;
    for (let i = 0; i < botCount; i++) {
      const bot = new LocalPlayer({
        id: genId("bot"),
        username: BOT_NAMES[(i + Math.floor(Math.random() * BOT_NAMES.length)) % BOT_NAMES.length] + "-" + Math.floor(Math.random() * 100),
        is_bot: true,
        weapon: this.mode === "practice" ? "ak47" : pickOfflineBotWeapon(this.user?.rank_tier ?? 0),
      });
      // Practice bots stand still
      bot.passive = this.mode === "practice";
      this.players.set(bot.id, bot);
    }

    // Send welcome async
    Promise.resolve().then(() => {
      this.onOpen();
      this.matchStartMs = performance.now();
      // Pre-match freeze: offline practice gets the same 3-2-1 the
      // online server does so the player has a beat to orient
      // before bots open fire. `match_started` starts false; client
      // sends `{type:"loaded"}` after welcome, which kicks off the
      // countdown timer below.
      this._matchStarted = false;
      this._countdownUntilMs = null;
      this._countdownSeconds = 3.0;
      this.onMessage({
        type: "welcome",
        you: this.me.to_state(performance.now()),
        arena: ARENA,
        is_ranked: false,
        match_duration: this.matchDuration,
        match_start: this.matchStartMs ? this.matchStartMs / 1000 : null,
        spectator: false,
        spectate_target_id: null,
        match_started: false,
        countdown_until: null,
        countdown_seconds: this._countdownSeconds,
      });
      // Start tick loop
      this.tickHandle = setInterval(() => this._tick(), 50); // 20Hz
    });
  }

  send(msg) {
    if (!this.me) return;
    const now = performance.now();
    const type = msg.type;
    if (type === "loaded") {
      // Client finished loading. Start the 3-2-1 if it hasn't already
      // fired. Mirrors the server's `_maybe_start_countdown`.
      if (this._matchStarted || this._countdownUntilMs != null) return;
      this._countdownUntilMs = now + this._countdownSeconds * 1000;
      // Push match_start out to the countdown end so the duration
      // timer doesn't include frozen seconds (matches server logic).
      this.matchStartMs = this._countdownUntilMs;
      this.onMessage({
        type: "match_countdown",
        countdown_until: this._countdownUntilMs / 1000,
        seconds: this._countdownSeconds,
      });
      return;
    }
    // Pre-match freeze: drop gameplay-affecting messages until the
    // countdown ends. Yaw/pitch are still applied inside the `input`
    // branch so the camera can pan freely.
    if (!this._matchStarted && (type === "shoot" || type === "melee" || type === "reload")) {
      return;
    }
    if (type === "input") {
      if (typeof msg.yaw === "number") this.me.yaw = msg.yaw;
      if (typeof msg.pitch === "number") this.me.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
      // Pre-match freeze: drop x/z updates so the player stays planted
      // at spawn while the 3-2-1 plays. Yaw/pitch still applied above.
      if (this._matchStarted && typeof msg.x === "number" && typeof msg.z === "number") {
        // Trust client position (server doesn't reconcile here for offline anyway).
        this.me.x = msg.x;
        this.me.z = msg.z;
      }
      if ("ads" in msg) this.me.is_ads = !!msg.ads;
      // Track currently-equipped weapon + continuous laser fire request so
      // the offline tick loop can apply per-tick laser damage and heat ramp
      // (mirrors the server's behaviour for online play).
      if (msg.weapon && WEAPONS[msg.weapon]) this.me.weapon = msg.weapon;
      if ("laser_firing" in msg) {
        this.me.laser_firing =
          !!msg.laser_firing && this.me.weapon === "laser" && !this.me.laser_overheated;
      }
    } else if (type === "shoot") {
      this._handleShoot(this.me, msg.weapon || "ak47", msg.yaw ?? this.me.yaw, msg.pitch ?? this.me.pitch, now);
    } else if (type === "melee") {
      this._handleMelee(this.me, msg.yaw ?? this.me.yaw, msg.pitch ?? this.me.pitch, now);
    } else if (type === "reload") {
      this.me.weapon = (msg.weapon && WEAPONS[msg.weapon]) ? msg.weapon : this.me.weapon;
      this.me.start_reload(now);
    } else if (type === "set_platform") {
      this.me.platform = String(msg.platform || "pc");
    } else if (type === "ping") {
      this.onMessage({ type: "pong", ts: msg.ts });
    } else if (type === "chat") {
      // Echo back as if other players saw it
      this.onMessage({
        type: "chat",
        id: this.me.id,
        username: this.me.username,
        is_bot: false,
        text: String(msg.text || "").slice(0, 200),
        ts: Date.now(),
      });
    }
  }

  close() {
    this._intentional = true;
    if (this.tickHandle) { clearInterval(this.tickHandle); this.tickHandle = null; }
    this.players.clear();
    this.onClose(this._intentional);
  }

  _handleShoot(p, weapon, yaw, pitch, now) {
    if (!p.alive) return;
    const cfg = WEAPONS[weapon] || WEAPONS.ak47;
    if (now - p.last_shot_ms < cfg.cooldown_ms) return;
    p.weapon = weapon;
    if (p.is_reloading(now)) return;
    if ((p.ammo[weapon] || 0) <= 0) {
      p.start_reload(now);
      return;
    }
    p.last_shot_ms = now;
    p.ammo[weapon] = Math.max(0, p.ammo[weapon] - 1);
    p.yaw = yaw; p.pitch = pitch;

    // Hitscan ray — must match the engine's camera-forward convention:
    //   forward = (-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch))
    // (Three.js camera looks down -Z by default; rotation.x=+pitch tilts up.)
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const ox = p.x, oy = p.y, oz = p.z;
    const range = cfg.range;

    // Tracer event (clients render local muzzle, but server emits "shoot" for remotes)
    this.pendingEvents.push({
      type: "shoot",
      shooter_id: p.id,
      x0: ox, y0: oy, z0: oz,
      yaw, pitch,
      range,
      weapon,
    });

    // Test against each other player capsule. Use a slightly TALLER bounding
    // cylinder (top > eye height) so a horizontal shot from the eye doesn't
    // graze the edge — and respect spawn invuln so we never deal damage to a
    // freshly-spawned target.
    let bestT = range, bestHit = null;
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      if (now < (other.invuln_until || 0)) continue; // skip invulnerable targets
      const r = rayHitCapsule(ox, oy, oz, dx, dy, dz, other.x, other.z, 0.55, 0, PLAYER_HEIGHT + 0.25);
      if (r && r.t < bestT) {
        // Line of sight (3D) — block only when the ray physically
        // intersects an obstacle's full 3D box. Short cover (tables,
        // lounge seats) no longer blocks shots aimed above the top.
        const hx3 = ox + dx * r.t, hy3 = oy + dy * r.t, hz3 = oz + dz * r.t;
        if (segBlockedByObstacles3D(ox, oy, oz, hx3, hy3, hz3)) continue;
        bestT = r.t;
        bestHit = { other, hy: r.y, t: r.t };
      }
    }
    if (bestHit) {
      // Head region: bullet hits above 1.45 (capsule now spans 0..2.05, so the
      // head crown is ~1.6-2.0). Matches the slightly-enlarged server head.
      const headshot = bestHit.hy > 1.45;
      // Per-weapon headshot multiplier — sniper is 2.0x (so 50 body →
      // 100 head = exactly 1-shot on 100HP), AK/laser fall back to
      // the previous 1.6x default.
      const hsMult = cfg.headshot_mult ?? 1.6;
      let damage = cfg.damage;
      if (headshot) damage = Math.floor(damage * hsMult);
      bestHit.other.hp -= damage;
      this.pendingEvents.push({
        type: "hit",
        shooter_id: p.id,
        victim_id: bestHit.other.id,
        hp: Math.max(0, bestHit.other.hp),
        damage,
        body_part: headshot ? "head" : "body",
        headshot,
        weapon,
      });
      if (bestHit.other.hp <= 0) {
        this._handleKill(p, bestHit.other, weapon, headshot, false);
      }
    }
    // Auto-reload when magazine hits zero
    if (p.ammo[weapon] === 0) p.start_reload(now);
  }

  /* Per-tick continuous laser damage. ~12 dmg per 200ms = 60 dps. */
  _applyLaserBeam(p, now) {
    const yaw = p.yaw, pitch = p.pitch;
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const ox = p.x, oy = p.y, oz = p.z;
    const range = WEAPONS.laser?.range || 80;
    let bestT = range, bestHit = null;
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      if (now < (other.invuln_until || 0)) continue;
      const r = rayHitCapsule(ox, oy, oz, dx, dy, dz, other.x, other.z, 0.55, 0, PLAYER_HEIGHT + 0.25);
      if (r && r.t < bestT) {
        const hx = ox + dx * r.t, hz = oz + dz * r.t;
        if (segBlockedByObstacles(ox, oz, hx, hz)) continue;
        bestT = r.t;
        bestHit = { other, hy: r.y, t: r.t };
      }
    }
    // Periodic beam event so the offline render can interpolate remote beams
    // (none in offline, but engine.js's `beam` handler is safe to call).
    this.pendingEvents.push({
      type: "beam",
      shooter_id: p.id,
      x: ox, y: oy, z: oz,
      yaw, pitch,
      weapon: "laser",
      hit_dist: bestT,
    });
    if (!bestHit) return;
    const headshot = bestHit.hy > 1.45;
    let damage = 12; // ~60 dps at 5 Hz cadence
    if (headshot) damage = Math.floor(damage * 1.5);
    bestHit.other.hp -= damage;
    this.pendingEvents.push({
      type: "hit",
      shooter_id: p.id,
      victim_id: bestHit.other.id,
      hp: Math.max(0, bestHit.other.hp),
      damage,
      body_part: headshot ? "head" : "body",
      headshot,
      weapon: "laser",
    });
    if (bestHit.other.hp <= 0) {
      this._handleKill(p, bestHit.other, "laser", headshot, false);
    }
  }

  _handleMelee(p, yaw, pitch, now) {
    if (!p.alive) return;
    if (now - p.last_melee_ms < MELEE_COOLDOWN_MS) return;
    p.last_melee_ms = now;
    p.yaw = yaw; p.pitch = pitch;
    this.pendingEvents.push({ type: "melee", shooter_id: p.id, yaw, pitch });
    // Melee cone direction — same convention as the engine (camera-forward).
    const vx = -Math.sin(yaw), vz = -Math.cos(yaw);
    let best = null, bestD = MELEE_RANGE + 0.1;
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      const dx = other.x - p.x, dz = other.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > MELEE_RANGE) continue;
      const dot = (vx * dx + vz * dz) / Math.max(d, 0.001);
      if (dot < Math.cos(MELEE_CONE)) continue;
      if (d < bestD) { bestD = d; best = other; }
    }
    if (best) {
      best.hp -= MELEE_DAMAGE;
      this.pendingEvents.push({
        type: "hit",
        shooter_id: p.id,
        victim_id: best.id,
        hp: Math.max(0, best.hp),
        melee: true,
      });
      if (best.hp <= 0) this._handleKill(p, best, "katana", false, true);
    }
  }

  _handleKill(killer, victim, weapon, headshot, melee) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths += 1;
    killer.kills += 1;
    // On-kill heal — restore 30 HP (capped) and emit a kill_heal event
    // so the local HUD plays the green "+HP" toast in offline mode too.
    const prevHp = killer.hp || 0;
    killer.hp = Math.min(killer.max_hp || 100, prevHp + 30);
    const healAmount = killer.hp - prevHp;
    if (killer.alive && healAmount > 0) {
      this.pendingEvents.push({
        type: "kill_heal",
        player_id: killer.id,
        hp: killer.hp,
        amount: healAmount,
      });
    }
    victim.respawn_at = performance.now() + 3000;
    this.pendingEvents.push({
      type: "kill",
      shooter_id: killer.id,
      shooter_name: killer.username,
      shooter_avatar: killer.avatar,
      shooter_rank_tier: killer.rank_tier,
      shooter_rank_name: killer.rank_name,
      shooter_rank_points: killer.rank_points,
      shooter_peak_rank_tier: killer.peak_rank_tier,
      shooter_banner_icon: killer.banner_icon,
      shooter_banner_color: killer.banner_color,
      shooter_banner_animated: killer.banner_animated,
      shooter_level: killer.level,
      shooter_is_bot: killer.is_bot,
      victim_id: victim.id,
      victim_name: victim.username,
      melee,
      headshot,
      weapon,
    });
  }

  _tick() {
    const now = performance.now();
    // Pre-match freeze gate. While the 3-2-1 plays we skip respawns,
    // bot AI, laser ticks, and match-end checks — same shape as the
    // server's tick guard. When the countdown timer elapses we flip
    // `_matchStarted` and emit `match_go`, then reset `matchStartMs`
    // so the duration counter starts fresh.
    if (!this._matchStarted) {
      if (this._countdownUntilMs != null && now >= this._countdownUntilMs) {
        this._matchStarted = true;
        this._countdownUntilMs = null;
        this.matchStartMs = now;
        this.onMessage({ type: "match_go" });
      }
      return;
    }
    // Respawns
    for (const p of this.players.values()) {
      if (!p.alive && now >= p.respawn_at) {
        const sp = spawn();
        p.x = sp.x; p.z = sp.z; p.y = PLAYER_HEIGHT;
        p.hp = p.max_hp;
        p.alive = true;
        p.invuln_until = now + 3000;
        p.ammo = { ak47: WEAPONS.ak47.mag_size, sniper: WEAPONS.sniper.mag_size, laser: WEAPONS.laser.mag_size };
        p.reload_until_ms = { ak47: 0, sniper: 0, laser: 0 };
        // Reset laser state so a death-while-overheated doesn't lock the
        // weapon after respawn.
        p.laser_heat = 0;
        p.laser_overheated = false;
        p.laser_firing = false;
      }
      p.finish_reload_if_due(now);
    }
    // Local laser beam — apply per-tick damage + heat ramp while held.
    if (this.me && this.me.alive && this.me.weapon === "laser") {
      const dt = 0.05; // 20Hz tick
      if (this.me.laser_firing && !this.me.laser_overheated) {
        this.me.laser_heat = Math.min(1.0, this.me.laser_heat + dt / 3.0);
        // ~4 damage events per second feels close to 60 dps with quantized hits
        if (now - this.me._lastBeamTickMs >= 200) {
          this.me._lastBeamTickMs = now;
          this._applyLaserBeam(this.me, now);
        }
        if (this.me.laser_heat >= 1.0) {
          this.me.laser_firing = false;
          this.me.laser_overheated = true;
          this.pendingEvents.push({ type: "overheat", shooter_id: this.me.id });
        }
      } else {
        this.me.laser_heat = Math.max(0, this.me.laser_heat - dt / 4.0);
        if (this.me.laser_overheated && this.me.laser_heat <= 0) {
          this.me.laser_overheated = false;
        }
      }
    }
    // Bot AI
    if (this.me) {
      for (const bot of this.players.values()) {
        if (!bot.is_bot || !bot.alive) continue;
        if (bot.passive) {
          // Practice dummies: face the player, never move/shoot.
          const dx = this.me.x - bot.x, dz = this.me.z - bot.z;
          bot.yaw = Math.atan2(-dx, -dz);
          continue;
        }
        // Move toward player (1 step every tick if possible)
        const dx = this.me.x - bot.x, dz = this.me.z - bot.z;
        const dist = Math.hypot(dx, dz);
        const speed = 3.0; // m/s
        const dt = 0.05;
        if (dist > 4 && dist < 60) {
          const ux = dx / dist, uz = dz / dist;
          const nx = bot.x + ux * speed * dt;
          const nz = bot.z + uz * speed * dt;
          if (!collidesAABB(nx, bot.z)) bot.x = nx;
          if (!collidesAABB(bot.x, nz)) bot.z = nz;
        } else if (now > bot.botRepathAt) {
          // Strafe randomly
          bot.botDir = Math.random() * Math.PI * 2;
          bot.botRepathAt = now + 800 + Math.random() * 1200;
        }
        // Bot facing — engine convention: yaw such that forward = -sin(yaw), -cos(yaw).
        // So to face (dirX, dirZ), yaw = atan2(-dirX, -dirZ).
        bot.yaw = Math.atan2(-dx, -dz);
        bot.pitch = Math.max(-0.3, Math.min(0.3, Math.atan2(this.me.y - bot.y, dist)));

        // Shoot occasionally if LOS — but never while the player is still in
        // their spawn-invuln window (otherwise the bullet would be wasted +
        // feel like spawn-killing the moment invuln ends).
        const playerInvuln = now < (this.me.invuln_until || 0);
        const canFire = this.me.alive && !playerInvuln && now > bot.botFireAt &&
          !segBlockedByObstacles(bot.x, bot.z, this.me.x, this.me.z);
        if (!canFire) {
          if (bot.weapon === "sniper") bot.aim_at = null;
        } else if (bot.weapon === "sniper" && (bot.aim_at !== this.me.id || now - bot.snipeSince < 750)) {
          // Sniper holds aim (client shows a scope glint) for 750ms before firing.
          if (bot.aim_at !== this.me.id) { bot.aim_at = this.me.id; bot.snipeSince = now; }
        } else {
          // Spread out subsequent shots (1.4 - 3.0s) so the player has room to react.
          bot.botFireAt = now + 1400 + Math.random() * 1600 + (bot.weapon === "sniper" ? 600 : 0);
          const dist = Math.hypot(this.me.x - bot.x, this.me.z - bot.z);
          const spread = (0.04 + Math.min(0.14, dist * 0.004)) * (bot.weapon === "sniper" ? 0.75 : 1);
          const yawErr = (Math.random() - 0.5) * 2 * spread;
          const pitchErr = (Math.random() - 0.5) * spread;
          if (bot.weapon === "laser") {
            // Short beam burst: 8 pulses ~90ms apart.
            for (let k = 0; k < 8; k++) {
              setTimeout(() => {
                if (!bot.alive || !this.me.alive) return;
                const e = (Math.random() - 0.5) * 2 * spread;
                bot.last_shot_ms = 0;
                this._handleShoot(bot, "laser", bot.yaw + e, bot.pitch + pitchErr, performance.now());
              }, k * 90);
            }
          } else {
            this._handleShoot(bot, bot.weapon, bot.yaw + yawErr, bot.pitch + pitchErr, now);
          }
        }
      }
    }
    // Build state payload
    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    let timeLeft = null;
    if (this.matchDuration != null && this.matchStartMs != null && !this.matchEnded) {
      const elapsed = (now - this.matchStartMs) / 1000;
      timeLeft = Math.max(0, this.matchDuration - elapsed);
    }
    const state = {
      type: "state",
      players: Array.from(this.players.values()).map((p) => p.to_state(now)),
      events,
      time_left: timeLeft,
      in_queue: false,
      real_count: 1,
      min_real_players: 1,
      is_ranked: false,
    };
    this.onMessage(state);

    // Emit match_end exactly once when offline timer hits 0.
    if (timeLeft !== null && timeLeft <= 0 && !this.matchEnded) {
      this.matchEnded = true;
      const sorted = Array.from(this.players.values()).sort((a, b) => {
        if (b.kills !== a.kills) return b.kills - a.kills;
        return (a.deaths || 0) - (b.deaths || 0);
      });
      const placements = sorted.map((p) => ({
        id: p.id,
        user_id: p.id,
        username: p.username,
        is_bot: !!p.is_bot,
        avatar: p.avatar ?? 0,
        kills: p.kills || 0,
        deaths: p.deaths || 0,
        rank_tier: p.rank_tier ?? 0,
        rank_name: p.rank_name || "BRONZE",
        rank_points: p.rank_points ?? 0,
        peak_rank_tier: p.peak_rank_tier ?? 0,
        delta: 0,
        new_points: p.rank_points ?? 0,
        rank_change: 0,
        is_placement: false,
        placement_match_number: null,
        placement_matches_total: 5,
      }));
      this.onMessage({
        type: "match_end",
        placements,
        duration: this.matchDuration,
        is_ranked: false,
        // Offline practice is FFA-only; TDM offline is TODO. Setting
        // this explicitly so the client's MatchResultOverlay renders
        // the FFA layout deterministically.
        game_mode: "ffa",
      });
    }
  }
}

export default LocalSim;
