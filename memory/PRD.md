# VIRTUE — 3D Browser FPS PVP

## Original Problem Statement
Build a fully functional basic shooter PVP game with online servers.
- Perspective: Simple 3D first-person shooter.
- Players: Account-based with login.
- Multiplayer: Free-for-all deathmatch.
- Map: Single arena with obstacles.
- Visual: Comic art style (Marvel Rivals).
- Added requirements: Ranked mode, custom weapons (AK-47, Katana, Laser Gun), procedural audio, AI opponents, ranked matchmaking queue.

## Architecture
- **Frontend**: React + Three.js (`/app/frontend`), Tailwind, Shadcn UI. Engine in `/app/frontend/src/game/engine.js`, WebSocket client in `network.js`, procedural Web Audio in `audio.js`. HUD overlay in `components/Hud.jsx`.
- **Backend**: FastAPI + WebSockets + MongoDB (`/app/backend/server.py`, monolithic). 20Hz server-authoritative tick. Two rooms: `casual` and `ranked`. Server-side raycast hit detection, AI bots, leaderboards, MMR-based queue.
- **Auth**: JWT (HS256), refresh cookies, admin seed.

## Completed (chronological)
### Initial MVP
- 3D Three.js arena, FastAPI WebSocket multiplayer, MongoDB user model.
- Auth (register/login), profile, leaderboards (casual + ranked).
- Procedural Web Audio (gunshots, hits, footsteps, lobby rock music).
- Comic-style HUD, click-to-play overlay, scoreboard, death overlay, match-end overlay.

### Iteration 2 (prev session)
- Ranked queue (>= 2 same-tier real players), tracers, katana melee, tiers modal, weaker bots, AK-47 model.

### Iteration 3 (prev session)
- One-shot katana, forced ranked queue (same-rank matching), ADS (right-click), map roads/buildings, easier bots, death animation, Laser Gun (key 3), removed "browser fps" text.

### Iteration 4 — **THIS SESSION (2026-02-20)**
- ✅ **Kill-marker icons in kill feed** — weapon icons (AK-47/Katana/Laser) replace generic skull. Backend kill events now carry a `weapon` field; HUD renders color-coded icons. (server.py + Hud.jsx + Game.jsx)
- ✅ **Non-blocking queue toast** — converted the full-screen ranked queue modal into a small bottom-right toast. Players can navigate the lobby (Play, Profile, Leaderboard) while queue polls; ranked button disabled + "IN QUEUE..." indicator. (Lobby.jsx)
- ✅ **Placement match streak** — first 5 ranked matches give 2× RP gains, with losses softened to 0. New `placement_matches_played` counter, surfaced via `in_placements`, `placement_matches_played`, `placement_matches_total` on the user object, and a "PLACEMENTS X/5 · 2x RP" badge in the lobby. Match-end overlay shows a P#/5 star badge and "2x" suffix on positive deltas. (server.py constants + end_match + public_user + Lobby + Hud)

### Iteration 11 — **THIS SESSION (2026-02-23, late)**
- ✅ **Banner on PlayerCard everywhere** — Lobby header card, death-overlay killer card, and (when extended) friend rows render a comic-style banner strip (icon + colored diagonal-stripe band) above the avatar+name when the user has banner_icon/banner_color set. Kill events now carry shooter_banner_icon/shooter_banner_color/shooter_peak_rank_tier.
- ✅ **Rank icons** — New `/app/frontend/src/game/rankIcons.js` util. 8 distinct lucide icons (Shield/Award/Star/Gem/Trophy/Sword/Skull/Flame) mapped to the 8 tiers. RankCards (profile current + peak) and scoreboard rank pills now display the crest icon.
- ✅ **Peak rank as 6th avatar option** — Avatar idx 5 = dynamic "Peak Crest" that resolves at render-time to the user's current `peak_rank_tier` icon + color. Backend AvatarIn upgraded to ge=0,le=5; Profile page now has an AvatarPicker card with the 6 options.
- ✅ **Map improvements**:
   - Outer walls reskinned: dark navy panels + gold top trim + red mid-stripe + black corner pillars every ~10m (was plain colored boxes).
   - Sky: vertical gradient (zenith navy → mid blue → warm horizon → sunset glow) baked as a canvas texture on a 140-unit sphere, plus a sun disc + halo, 22 multi-puff clouds, and 6 silhouette birds for scale.
   - Driveways: 16 short asphalt spurs with curb stripes connect the four main cross-roads to nearby buildings and corner plazas.
- ✅ **Advanced settings — Keybinds (PC), Controller binds, Mobile HUD editor**:
   - `AdvancedControls.jsx` adds 3 sub-sections inside SettingsModal.
   - **Keybinds**: 14 actions (Forward/Back/Left/Right/Jump/Sprint/Crouch/Reload/Melee/ADS-toggle/Weapon1-3/Scoreboard). Click row → "Press key…" → any key (incl. modifier codes like ShiftLeft) saves it. ESC cancels. Reset button restores defaults.
   - **Controller**: 8 actions (Jump/Reload/Melee/WeaponCycle/Shoot/ADS/WeaponPrev/WeaponNext). Click row → "Press button…" → next gamepad button press saves the index. Standard Xbox/PS label readout.
   - **Mobile HUD editor**: 4 elements (move/actions/weapons/scoreboard). Each has X Offset, Y Offset, Size (0.6×-1.6×) and Opacity (0.2-1.0) sliders. TouchControls.jsx reads `hudLayout` live so previews are real-time.
- ✅ **Engine wiring** — `engine.js._onKeyDown` reads from `settingsStore.get().keybinds` for weapon1/2/3, reload, melee, ADS-toggle, scoreboard; movement+jump+sprint do the same. `_pollGamepad` reads from `controllerBinds`. Game.jsx scoreboard/weapon/reload key paths updated.
- ✅ **Full regression** — testing_agent_v3_fork: **backend 16/16 (100%)**, **frontend 100%**, 0 critical / 0 minor / 0 ui-bug. See `/app/test_reports/iteration_7.json`.

### Iteration 10 — 2026-02-23
- ✅ **Spectate-ended UX polish** — When the spectator WS drops (target leaves their match), `Game.jsx` now redirects to `/lobby?spectate_ended=1&target=<username>` instead of the generic disconnect. Lobby renders a dedicated yellow "SPECTATE ENDED — <NAME> is no longer in a match" toast (`spectate-ended-toast` testid), auto-clears in 5s.
- ✅ **Spectator viewmodel hidden** — `engine.js` now sets `this._weapon.visible = false` for spectators so the first-person weapon model never bleeds into the camera-follow view.
- ✅ **Iteration 9 retest** — testing_agent_v3_fork: **19/19 backend (100%)** + **frontend 100%** (party endpoints, spectate WS, friend-modal conditional buttons, /spectate/:username banner). 0 critical / 1 LOW (handshake-reject HTTP-403 wording — informational only). See `/app/test_reports/iteration_6.json`.

### Iteration 9 — 2026-02-22 (late night)
- ✅ **Spectate friend in-match** — new `GET /api/spectate/{username}/info` + WS `mode=spectate&target=<username>`. Server tracks `PLAYER_LOCATION` per user so we know which room to join. Spectators connect read-only (no input, no physics, hidden from scoreboard, hidden from broadcasts). Engine welcomes spectators with `spectate_target_id`; the client camera snaps to a 4m-back / 2m-up follow position on the target each tick. Friend rows show a yellow SPECTATE button when the friend is **online + in_match**.
- ✅ **Persistent party** (max 4) — `PARTIES`, `PARTY_MEMBER_INDEX` in-memory state. New endpoints `/party/{invite,accept,decline,leave,me,start}`. PartyPanel in lobby with member list, leader crown, START QUICK MATCH (leader only), auto-navigates all members when leader presses start. Bot-fill scales to MAX_PARTY_SIZE-members.

### Iteration 8 — 2026-02-22 (night)
- ✅ **Match-found audio cue** — Added `audioBus.matchFound()` (3-note rising chord + sub thump). Fires when ranked queue matches and when a party invite arrives.
- ✅ **ADS hides gun model** — `engine.js` now hides primary/tertiary weapon groups while aiming-down-sights so the HUD scope overlay isn't blocked. Katana (secondary) always visible.
- ✅ **"Searching" header on Quick Match toast** — re-added the header label above the UP-counter timer.
- ✅ **Invite friend to party (full e2e)** — New `POST /api/party/invite`, `GET /api/party/invites`, `POST /api/party/{accept,decline}` + `mode=party&party_id` WebSocket route. Each party gets a private room with 3 disguised bots. Frontend: green "INVITE" button on online-only friend rows; invitees see a top-right toast (5s polling); accept navigates both into the same party room.
- ✅ **Casual bots disguised** — `DISGUISED_BOT_NAMES` (15 human-style handles like "n3onGhost42", "BlitzReaper", "PixelPunk"). Bots in casual rooms now return `is_bot:false`, random `platform`, and a low-tier rank so they blend in. Practice/offline/ranked bots keep the BOT badge.
- ✅ **Controls card removed** from lobby (replaced by Settings).
- ✅ **Audio toggles, Mouse Sensitivity slider, Logout button moved into Settings modal**. Lobby header now minimal: PlayerCard + FRIENDS + INSTALL + Settings cog.
- ✅ **Public profile inspect** — New `GET /api/users/{username}/profile` (no email field exposed). New `PublicProfileModal` opened from Friends modal "INSPECT" button. Shows avatar, current/peak rank, K/D/matches stats, last-10 history with mode/placement/RP delta.
- ✅ **Full regression** — testing_agent_v3_fork: **17/17 backend (100%)**, **frontend 100%**, **0 critical / 0 minor / 0 ui-bug** (only a LOW-priority testid rename was fixed). See `/app/test_reports/iteration_5.json`.

### Iteration 7 — 2026-02-22 (evening)
- ✅ **Player Cards** — New `PlayerCard.jsx` component with 5 themed avatars (VenetianMask / Skull / Shield / Swords / Ghost). Shown in lobby header (own card) and on death overlay (killer's card). Avatar index 0-4 stored on user, default 0, settable via `POST /api/profile/me/avatar {avatar: 0-4}`. Kill events from backend now carry `shooter_avatar`, `shooter_rank_tier`, `shooter_rank_name`, `shooter_rank_points`, `shooter_is_bot`.
- ✅ **Friends list** — Full social system: `POST /api/friends/{request,accept,decline,block,unblock}`, `DELETE /api/friends/{username}`, `GET /api/friends` (returns friends/incoming/outgoing/blocked groups), `GET /api/users/search?q=...`. Auto-accepts when reverse-pending exists. Tracks `ONLINE_USERS` reference-counted by open WebSocket connections so friend rows show real-time online status. New `FriendsModal.jsx` with 5 tabs + search.
- ✅ **Quick Match counts UP** — Timer now ticks 0 → 10 (was 10 → 0), feels like matchmaking rather than countdown.
- ✅ **Per-tier ranked bot count** — `get_or_create_ranked_bot_room` spawns 3 bots for tier <5 (Bronze..Diamond), 1 bot for tier 5-6 (Master/GM), 0 for tier 7 (Goonmaster — never bot-fills, already enforced).
- ✅ **Seamless lobby music** — Removed the bar-7 lead riff that gave the procedural loop an audible "ending"; loop is now continuous.
- ✅ **Full regression** — testing_agent_v3_fork: **24/24 backend (100%)**, **frontend 100%**, **0 critical / 0 minor / 0 ui-bug findings**. (See `/app/test_reports/iteration_4.json`.)

### Iteration 6 — 2026-02-22 (late)
- ✅ **Match History on Profile** — New `match_history` collection (indexed `(user_id, ended_at desc)`). Backend writes a row per real player on `end_match` with `mode`, `kills`, `deaths`, `placement`, `total_players`, `rp_delta`, `rank_points_after`, `is_placement`, `ended_at`. New `GET /api/profile/me/history?limit=10` endpoint returns newest-first. Profile page now renders a "Match History · Last 10" card with mode badge, placement, K/D, ΔRP and rank chip; empty/loading/error states all wired up.
- ✅ **Offline-vs-AI mode** — New `mode=offline` on the WS endpoint creates a per-user private room (`OFFLINE_ROOMS` dict) with 3 combat bots (suffix `-O`). Room is destroyed when the last real player disconnects. New "OFFLINE VS AI" green button in Lobby (`lobby-offline-button` testid). Tested: room spawns + destroys cleanly via logs.
- ✅ **Mobile lobby final-fit** — Tightened spacing so the lobby now scrolls = 700 on 390×700 viewport even with the 6th OFFLINE button added (was 710 → 700). All 6 main action buttons visible without scroll.
- ✅ **Full regression** — testing_agent_v3_fork: 18/18 backend tests (100%), 10/11 frontend (only TAB-on-PC Playwright limitation). 0 critical / 0 minor / 0 ui-bug findings. (See `/app/test_reports/iteration_3.json`.)

### Iteration 5 — 2026-02-22
- ✅ **Mobile-fit login & lobby** — Login and Lobby now use `min-h-[100dvh]` and selectively hide non-essential UI on small screens so the 5 main action buttons (Quick Match, Ranked, Practice, Leaderboard, Profile) all fit a 390×700 viewport without scrolling. Hidden on mobile: music/SFX toggles, install button, "Show Tiers", "Free-For-All · Online" pill, active-players row, stats grid, Controls + Sensitivity bottom cards. PC layout unchanged. Placement badge compacts to "P 0/5 · 2x" on mobile.
- ✅ **Hide Google sign-in on tiny screens** — Added `short` Tailwind breakpoint (`max-height: 700px`) and applied `short:hidden` to the Google OAuth button + "OR" divider on Login so login form fits a tiny viewport without scroll.
- ✅ **Platform icon on scoreboard** — Each player now carries a `platform` field on the `Player` state and `to_state()` payload. Client detects touch/gamepad/pc and sends a `set_platform` WS message after connect. Hud scoreboard renders a Smartphone, Gamepad2 or Monitor icon next to each player's name (BOT badge unchanged for bots). 3 new pytest cases pass.
- ✅ **Mobile scoreboard button** — Added a top-center "SCORE" press-and-hold button on touch devices (`touch-scoreboard` testid). Hold to view scoreboard, release to hide. Wired via new `onToggleScoreboard` prop on TouchControls.
- ✅ **Queue timer restored (no labels)** — Both Quick Match and Ranked queue toasts again show a big numeric timer (Quick: countdown from 10; Ranked: elapsed MM:SS) but without "Filling with bots in" / "Wait time" / "Starting in" labels.
- ✅ **Removed Quick Match queue header text** — The toast no longer shows "Quick Match — Searching"; just the spinner, cancel button, and countdown number.
- ✅ **Goonmaster real-vs-real only** — `bot_fill_seconds_for_tier(7) = ∞`; matchmaker skips bot-fill for tier 7. API returns `bot_fill_seconds: -1` for Goonmaster so the client can recognize "never bot-fills".

Tested: 8/8 new backend pytest cases pass (`/app/backend/tests/test_placement_weapons_queue.py`), frontend verified end-to-end via screenshot tool (placement badge, queue toast, disabled ranked button, kill-feed weapon icons rendering).

## Known Pre-existing Issues (not regressions)
- `test_shooter_backend.py::TestHealth::test_root_health` expects deprecated `players_online` key (current schema returns `casual_players`/`ranked_players`).
- `TestLeaderboardAndProfile::test_leaderboard_sorted_desc` expects kills-desc; current sort is rank_points desc.
- `TestWebSocket::test_two_clients_see_each_other_shoot_kill_persists` and `TestBotsActivelyShoot` flaky (timing-dependent on bot AI).

## Roadmap / Backlog
### P1
- Live spectator camera for queued players (watch ongoing matches while waiting).
- Loadout selection in lobby (pick primary weapon before spawn).

### P2
- Bot difficulty modes (Recruit / Veteran / Apex).
- Match history page (last 10 matches with placements, kills, RP delta).
- Daily challenges / per-weapon mastery XP.

### P3
- Custom rooms / private lobbies with invite codes.
- Cosmetics (skins, kill cards).
- Region selection / multi-server.

## Tech Notes
- Hit detection: server-side raycast vs 3-sphere capsule hitboxes.
- 20Hz tick, client predicts movement, server reconciles.
- Bots: simulated WS connections inside the backend, casual room only by default.
- Ranked: `RANKED_MIN_REAL_PLAYERS=1` currently (solo-queue routed to bots after `QUEUE_BOT_FILL_SEC=30s`).
- Placement constants: `PLACEMENT_MATCHES=5`, `PLACEMENT_MULTIPLIER=2` in server.py.
