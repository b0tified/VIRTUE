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

### Iteration 13 — **THIS SESSION (2026-02-24)**
- ✅ **Respawn animation** — New `RespawnOverlay.jsx` plays a ~1.1s comic-style flash whenever the local player transitions dead → alive. Effects: white-out revive flash → expanding blue + red rings → rotating sparkle ring → "RESPAWN!" banner pop with lightning bolts → rotating yellow halftone burst. New `audioBus.respawnSfx()` plays a swept-saw "WHOOSH-ZING" + two-note chime under it. Triggered from `engine.js` `onLocalUpdate({type:"respawn"})` on the alive-edge; Game.jsx listens, clears the killer card + damage markers, sets `respawnAt` timestamp. CSS keyframes added to `index.css`. Engine exposed on `window.__virtueEngine` for e2e/debug.

### Iteration 19 — **THIS SESSION (2026-02-24)**
- ✅ **Quick-play instant-end bug fixed** — backend was replaying the last `match_end` payload to *every* new joiner during intermission. Now only sends it to players whose `user_id` actually appears in the placements list. Added `user_id` to placement records to support the check.
- ✅ **Party flicker fixed** — `refreshParty()` was nulling state on *any* error (incl. transient 5xx/timeouts). Now only nulls on confirmed 404/401 — other errors keep prior state, so the panel no longer disappears between polls.
- ✅ **Lobby moved up** — `main` now has `-mt-8 sm:-mt-12` and rank-badge row drops to `mt-0.5`. QUICK MATCH starts ~80px higher; left column hugs the top edge.
- ✅ **Match loading screen** — new `MatchLoadingScreen.jsx` shows a comic-style transition (full-bleed LobbyBackground + rotating burst rays + animated title + LOADING ARENA spinner) for ~1.4s before navigating to `/play`. Triggered globally via `virtue-match-loading` events. Wired into: Quick Match, Practice, Offline, Party Quick, and ranked-matched navigation.
- ✅ **Party panel UI overhaul** — gradient blue header, in-card leader crown, current-user highlight, yellow border on the rank-anchor row, status chip per member ("IN MATCH" / "TOP RANK"), avatars with online dot. Inline error display.
- ✅ **Party ranked queue button** — leader can press a dedicated `RANKED @ TIER` button right inside the party panel; it kicks the QueueContext flow that all party members already share. Members see "IN RANKED QUEUE @ TIER · Xs" with a spinner when queue is active.
- ✅ **Friends list UI polish** — left-border color tint by status (red in-match / blue in-queue / green online / transparent offline), hover background, LV chip on usernames, animated pulse dot on active status chips.
- ✅ **Mobile auto-fire** — Fire button on `TouchControls.jsx` now hold-to-auto-fires via a 50ms `setInterval` on `_tryShoot`. Engine-side cooldown gates the actual shot rate to weapon RPM so the interval is safe. Other touch buttons (Melee, Reload, Jump, weapon switcher) remain tap-only. ActionBtn refactored to accept an `autoRepeatMs` prop and cleans up the interval on touch-end / cancel / unmount.
- ✅ **Spectate from leaderboard** — `/api/leaderboard` now surfaces `id` + `online` + `in_match` + `match_kind` flags per row. `Leaderboard.jsx` shows a clickable red SPECTATE chip next to any player who is currently in a match (clicks navigate to `/spectate/{username}` — same route used by FriendsModal). Online players show a green ● ONLINE chip; offline rows are unchanged. The page auto-polls every 15s to keep the in-match flags fresh.

### Iteration 17 — **THIS SESSION (2026-02-24)**
- ✅ **Mobile landscape lobby fits without scroll** — fixed a long-standing CSS bug where the original `@media (orientation: landscape)` block was unclosed, causing post-FX rules and keyframes to be wrongly scoped to landscape only. Restructured into two clean media blocks. Added rules for the new header chips (COINS / SHOP / PASS / FRIENDS) so they squeeze into ~190px-tall landscape phones without overflow. PC layout untouched.
- ✅ **Removed in-match controls UI** — dropped the "TAB · SCOREBOARD · R · RELOAD" panel and the "[Enter] to chat" hint and the "PRESS R · RELOAD" footer. Empty-ammo state now shows just "LOW AMMO" with a pulse.
- ✅ **Health bar UI revamp** — new comic-style health card: chunky heart icon in a colored badge (red normal / gold shielded / glowing red when critical), large 4xl HP number with hard text shadow, status label ("HEALTHY" / "INJURED" / "CRITICAL" / "SHIELDED"), segmented 5-bar health (20HP each) with vertical gradient + threshold-based color (green > 50, yellow > 25, red ≤ 25), card background tints itself based on HP state, and the whole card pulses (`virtue-lowhp-pulse` keyframe) when HP ≤ 25.

### Iteration 16 — **THIS SESSION (2026-02-24)**
- ✅ **Detailed skin layers** — every skin now has 6 optional layers in addition to body/leg/head/accent: `helmet` (skull cap), `visor` (lit eye band), `shoulder` (pads), `stripe` (chest + sleeve cuff + knee bands), `belt`, `cape`. Engine renders each layer conditionally. Shop preview rebuilt to mirror the new layout. All 8 shop skins upgraded with new decals.
- ✅ **Mech Recruit (free first-match skin)** — new `mech` skin granted on first completed match via end-match flow + idempotent `$addToSet`.
- ✅ **3 pass-only skins** — `solar` (T10), `cyber` (T20), `quantum` (T30). Hidden from shop until owned.
- ✅ **6 Lifetime Challenges** — First Blood, Bloodlust, Massacre, Veteran, Champion, Apex. Progress vs `stats`; claims grant coins + season XP.
- ✅ **Daily Challenges (3/day, +50 SXP + 25 coins each)** — random picks from 6-challenge pool, snapshot at UTC roll-over so progress = today's delta.
- ✅ **30-tier Season Pass** — 100 SXP/tier (3000 total). Rewards alternate coins / +500/5 / skins at T10/T20/T30. Endpoints `GET /api/progression`, `POST /api/progression/claim`. New `ProgressionModal.jsx` (Season/Daily/Challenges tabs).

### Iteration 15 — **THIS SESSION (2026-02-24)**
- ✅ **In-game currency (COINS)** — new `coins` + `coins_credited_for_level` fields on user. Auto-credited 100/level on `/api/auth/me` and `/api/profile/me` (idempotent). Only earnable through level-ups + new redeem codes (`COINTOSS` +250, `COINSHOWER` +1000, `JACKPOT` +5000). No earn from matches by design.
- ✅ **Skin shop** — new `SKINS_CATALOG` (8 skins: Recruit free, Azure/Neon/Crimson/Ghost/Verdant/Void/Golden 200→3000). Endpoints `GET /api/shop/skins`, `POST /api/shop/buy`, `POST /api/profile/me/skin`. Frontend `ShopModal.jsx` + lobby SHOP button + coin badge. Cards have CSS-only humanoid preview + animated aura behind.
- ✅ **More player models** — skin recolors head/torso/legs/accent of every humanoid + adds a per-skin aura at the player's feet (pulse/spin/flicker modes driven by `aura_mode`). Bots randomize their skin so lobbies look varied. Skin hot-swap on equip without re-loading the match.
- ✅ **Bots count in match history** — `placement` is now computed across *all participants* (real + bots) so a real player ranking behind bots is recorded honestly; `total_players` includes bots too.
- ✅ **Ranked points overhaul** — new `compute_rp_delta(placement, tier_idx)`:
  - Bronze/Silver: classic +30/+15/+5/-10.
  - Gold: +30/+15/+5/**-20**.
  - **Platinum+**: only 1st gains (+30), 2nd/3rd are safe (0), 4th+ lose **-40** (Plat) or **-60** (Diamond, Master, Grandmaster, Goonmaster). Unit-tested across all tiers.
- ✅ **Friends in-queue + in-match badges** — `_friend_card` now exposes `in_queue` (resolved against `RANKED_QUEUE`) + `queue_tier`. FriendsModal shows IN MATCH (red) > IN QUEUE (blue) > ONLINE (green) > OFFLINE chips. Invite button disabled when friend is busy.
- ✅ **Realistic sky** — replaced sky dome with 8-stop gradient (deep navy zenith → bright daylight → warm horizon → ground-line glow), bigger sun with multi-layer corona (inner halo + outer halo + additive bloom), and three altitude bands of clouds (14 low + 10 mid + 7 high) with parallax drift speed scaled by altitude.

## Roadmap / Backlog
### Iteration 12 — **THIS SESSION (2026-02-24)**
- ✅ **WARPSPEED redeem code triggers RankUpOverlay** — `/api/codes/redeem` now returns a `rank_up` payload (`prev_tier`, `new_tier`, `rp_delta`, `new_points`) when a tier-skip code is redeemed. `SettingsModal` dispatches a `virtue-rankup` window event on success; `Lobby` listens and mounts `RankUpOverlay` so the celebration plays even when the redeem happens outside a match. One-time per account (existing `redeemed_codes` guard). Verified via curl + Playwright.

### Iteration 13 — **THIS SESSION (2026-02-25)**
- ✅ **Settings → Auto-Fire (Touch) toggle** — New `touchAutoFire` setting (default off). Lives in Settings → Controls under Touch Controls. When on, the right-side look pad triggers continuous auto-fire while held; engine cooldown gates RPM. Cleans up the interval on touch-end, unmount, and when touch controls become disabled. (`/app/frontend/src/game/settings.js`, `SettingsModal.jsx`, `TouchControls.jsx`)

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
