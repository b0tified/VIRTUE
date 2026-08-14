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

### Iteration 14 — **THIS SESSION (2026-02-25, later)**
- ✅ **Spectate POV polish** — when spectating, the spectated player's body mesh is now persistently hidden (was being re-shown each state tick by `entry.mesh.visible = p.alive || …`), AND the spectator now renders a viewmodel matching the target's currently-equipped weapon (`t.weapon` → primary/secondary/tertiary via `setWeapon`). Laser-firing flag also mirrored so beam fx match. Files: `/app/frontend/src/game/engine.js` (spectate block + visibility skip + viewmodel-visible gate).
- ✅ **Party ranked queue timer for followers** — `QueueContext` now runs a 3-second background poll on `/api/queue/ranked`. When the party leader queues, the follower's payload returns `in_queue=true` (server already supported `user_ids` array membership) and the context hydrates `queueState` + `waitSec`. PartyPanel reads `waitSec` from the hook (was reading non-existent `queueState.waitSeconds`).
- ✅ **Party ranked match start for ALL members** — same background poll detects `s.matched=true` and runs the standard 3-2-1 countdown → match-loading overlay → nav to `/play?mode=ranked` for every party member. Bot-fill matches now stamp a shared `room_key` (leader id) on every member's `MATCHED_USERS`, and the WS handler routes followers to the leader's `ranked_bot_room` via that key so all members land in the same `GameRoom`. Spectate path updated to consult `loc.ranked_bot_key`.
- 🧪 Verified via testing agent (8/8 pytest passing): party of 2 followers see `in_queue=true` payloads, bot-fill produces identical `match_id` for leader+follower, and both WS connections share the same `ranked_bot_room` instance.

### Iteration 15 — **THIS SESSION (2026-02-25, evening)**
- ✅ **New Victory / Defeat overlay** — full redesign replacing the generic "MATCH OVER" panel. New component `/app/frontend/src/components/MatchResultOverlay.jsx`. Golden burst + animated confetti + radial spoke pattern + "VICTORY!" headline for 1st place; red shatter overlay + "DEFEAT" headline + Skull icon for any other placement. Includes a 4-tile stat strip (Placement / Kills / Deaths / Δ RP or K/D), compact placement table, and PLAY AGAIN + BACK TO LOBBY buttons. Staggered entrance animation (pop-in headline, slide-up stats, slide-up table+buttons). data-testid="match-end-overlay" preserved; new testids: `match-result-headline-victory|defeat`, `match-result-stat-placement|kills|deaths|rp|kd`, `match-result-play-again`, `match-result-lobby`.
- ✅ **Auto-fallback timer** — Game.jsx now stores the 15s post-match auto-nav timer in `matchEndFallbackRef` and clears it inside both button handlers + on unmount, so a successful in-place Play Again (casual / party / practice) no longer yanks the user to lobby 15s later.
- ✅ **Click handler accessibility** — the new overlay's wrapping div now explicitly opts back into pointer events with `pointer-events-auto`. Without this, the buttons inherited `pointer-events:none` from the Hud root and were unclickable. Verified live in-browser.
- ✅ **Quick-Play instant-end bug fixed** — root cause: the casual room is shared, so a player joining seconds before `end_match()` ran would receive the broadcast even though they hadn't actually played the match. Fix: GameRoom now tracks `match_num` (incremented on each reset), and every Player has `joined_match_num` stamped at add-time (`match_num + 1` if currently in_intermission). `end_match`'s broadcast uses `asyncio.gather` and targets only players whose `joined_match_num == ended_match_num` (plus spectators). The `last_match_end_payload` replay on welcome already used a `played_in` placements check — both layers now agree.
- 🧪 Backend: 7/7 pytest passing on match_num targeting (programmatic GameRoom + SpyWS pattern). Frontend: live in-browser verification — Victory + Defeat overlays render perfectly, Play Again dismisses in offline mode (overlay → null, stays on /play), Lobby navigates to /lobby.

### Iteration 16 — **THIS SESSION (2026-02-25, late)**
- ✅ **Recurring instant-defeat bug truly fixed** — root cause was `add()`'s welcome-replay branch unconditionally re-sending `last_match_end_payload` to any user_id in placements + in_intermission. A player who finished a match, dismissed the overlay, clicked BACK TO LOBBY, then re-clicked Quick Play during the same 10s intermission was re-served the same match_end → instant defeat overlay. Fix: GameRoom now tracks `last_match_end_recipients: set[str]` populated in `end_match` BEFORE the targeted asyncio.gather broadcast; the welcome-replay branch skips users already in that set. The set is cleared on reset. `remove()` intentionally does NOT clear it so subsequent re-joins during the same intermission are properly identified as "already seen". Legitimate replay (player who never received the live broadcast due to network blip) still fires.
- ✅ **PLAY AGAIN button removed** from the Victory/Defeat overlay per user request. Single centered BACK TO LOBBY button remains. Unused `onPlayAgain` prop/handler removed from `Hud` + `Game.jsx`. Lobby button still cancels the 15s auto-fallback timer + clears pointer lock.
- 🧪 12/12 pytest passing (5 new intermission-replay tests + 7 regression match_num tests). 2/2 Playwright flows passing (overlay renders, button removed, Lobby button navigates, auto-fallback fires).

### Iteration 17 — **THIS SESSION (2026-02-25, late)**
- ✅ **Second arena added — "CROSSFIRE"** — A contrast to the original DOWNTOWN map. Long bisecting corridor walls form a `#`-style grid with diagonal pillars in the gaps, mid-ring sniper nests, L-shaped corner courtyards, and scattered crates. Different sightlines (long corridors + open midfield) vs DOWNTOWN's tower-and-quadrant layout. Different spawn points (more central) + different healthpack positions (center plaza + ring).
- ✅ **Random map selection** — `GameRoom` picks a random map at init AND on every match-reset, so the same lobby cycles through both arenas. `random_spawn()` + healthpacks now take their data from `self.arena` (per-room) instead of module globals. `MAP_A` (DOWNTOWN) / `MAP_B` (CROSSFIRE) defined in `server.py`. Welcome payload + `match_start` broadcast carry the new arena so clients rebuild geometry on the fly.
- ✅ **Client engine rebuilds world geometry on map change** — All building meshes live inside a `_buildingsGroup`; `_rebuildArenaFromServer(arena)` tears them down (disposing geometries/materials/textures) and rebuilds from the server-supplied obstacle list. Per-map color palette (CROSSFIRE = blue + red, DOWNTOWN = classic mixed) for visual distinction. Crates auto-tagged from size (≤ 2 on every axis). No-op when map_id is unchanged so a state tick doesn't thrash.
- ✅ **LocalSim mirrored** — Offline-vs-AI also cycles both maps; `_pickMap()` runs on each LocalSim construct.
- 🧪 Verified via Playwright: 8 offline attempts saw both `crossfire` and `downtown` with their full obstacle counts (40 / 41) and `_currentMapId` reflecting the rebuilt geometry. Visual confirmation: distinct color palettes + layouts per map.

### Iteration 18 — **THIS SESSION (2026-02-25, late)**
- ✅ **Loading screen now shows the map** — `MatchLoadingScreen` picks a random map from a new shared `mapsMeta.js` registry on every open and renders a top-down SVG minimap preview (with halftone dot texture, comic outlines, spawn markers, "N" compass), the map name (DOWNTOWN / CROSSFIRE), and a one-line tagline ("Mega-tower at center · quadrant cover…" / "Corridor grid · diagonal pillars…"). New components: `/app/frontend/src/components/MapPreview.jsx` + `/app/frontend/src/game/mapsMeta.js`. Server map selection is also uniform random so the preview matches the player's odds.
- 🧪 Verified in browser via dispatch of `virtue-match-loading` — overlay renders with the SVG preview, map name + tagline visible. Lint clean across all three touched files.

### Iteration 19 — **THIS SESSION (2026-02-25, late)**
- ✅ **Loading screen now waits for WS welcome + reveals actual map** — `MatchLoadingScreen` lifted to App.js root (so it survives the Lobby → /play route change). Rewritten event-driven (no `open` prop):
  - `virtue-match-loading` → phase `loading`, picks a random preview map.
  - `virtue-match-loaded` (fired from Game.jsx onMessage when WS welcome arrives) → phase `confirmed`, swaps to the real server-selected map and shows a "CONFIRMED · MAP_NAME" badge (green if preview matched, gold if it differed) for 900ms before auto-dismiss.
  - 6s safety timer dismisses the overlay if welcome never arrives (network failure).
- `navigateToMatch.MATCH_LOAD_MS` reduced from 1400 → 800ms (overlay no longer needs to fully animate before nav; it now bridges the route change).
- Lobby's MatchLoadingScreen render + `loadingMode` state removed (now lives at App root).
- 🧪 Verified live: events fire in correct order (loading → loaded), preview maps surface during the gap, server's actual map is revealed once welcome lands, overlay dismisses cleanly. Lint clean across 4 touched files.

### Iteration 20 — **THIS SESSION (2026-02-25, late)**
- ✅ **Third map added — "SHORELINE" (beach theme)** — Open sandy plaza with two wooden piers (N/S) leading to seaside shacks, four tall lifeguard towers at the inner corners, wide beach huts on the E/W axis, scattered midfield rocks, 8 palm-trunk pillars, and a central shipwreck. Engine now applies a per-map ground swap: shoreline uses a sandy tan floor with grass blades hidden; other maps keep the original grass texture. Per-map obstacle palette adds a wood/sand variant. Files: `server.py` MAP_C, `localSim.js` MAP_C, `mapsMeta.js` MAP_SHORELINE, `engine.js` `_rebuildArenaFromServer` ground swap.
- ✅ **Practice map selector** — New `PracticeMapSelector.jsx` modal opens when the player clicks PRACTICE RANGE or OFFLINE VS AI. Renders 4 cards: RANDOM (shuffle icon) + 3 map previews (DOWNTOWN / CROSSFIRE / SHORELINE) using the existing MapPreview SVG component. Selecting a map appends `?map=<id>` to the route; Game.jsx now parses `map` from search params and forwards to LocalSim. LocalSim's `_pickMap` honours the forced id or rolls random.
- Random-pick path remains the default for all other modes (casual / ranked / party) — selector is practice-only.
- 🧪 Verified live: SELECT MAP modal renders 4 cards correctly, picking SHORELINE → confirm starts the game with sandy ground + beach obstacles + URL `?mode=practice&map=shoreline`. Engine arena state shows `map_id: 'shoreline', current: 'shoreline'`. Lint clean on all 7 touched/new files.

### Iteration 21 — **THIS SESSION (2026-02-25, late)**
- 🐛 **Instant-defeat on Quick Play (truly truly fixed)** — Root cause was different from prior iterations: `GameRoom.match_start` is set at room init time, but the tick loop only fires `end_match()` when there's at least one real player. So a casual room sitting idle for > match_duration (5 min) had a "stale clock" — the FIRST player to join after a long idle would trigger an immediate match_end on the very next tick because `now - match_start >= duration` was already True.
- Fix: `GameRoom.add` now resets `match_start = now()` when the first real (non-spectator, non-bot) player joins while the room is not in intermission. Subsequent joiners do NOT reset the clock. Spectator joins also don't reset.
- 🧪 4 new regression tests + 12 prior tests passing (no regressions): clock resets on first real-player join, clock does NOT reset for spectators, clock does NOT reset for subsequent joiners, end_match would NOT trigger immediately after add+tick.

### Iteration 22 — **THIS SESSION (2026-02-25, late)**
- ✅ **DOWNTOWN is now a night map with glowing windows** — Added `_applyDayNight(night)` to the engine. On the DOWNTOWN map: navy night sky gradient + 220 random stars on the upper hemisphere + a moon with a soft halo (replacing the daytime sun + corona); dimmed `DirectionalLight` (1.4 → 0.35, cool blue tint) + `HemisphereLight` (1.0 → 0.45); dark asphalt floor; trees + benches hidden; lampposts kept (their yellow bulbs now read as actual city light); clouds hidden.
- **Window glow** — `_makeBuildingFaceTexture` accepts a `night` flag. Night variant draws each window with a soft warm radial gradient halo + bright yellow core + dark cross frame, with ~30% windows randomly "off" (dark) for variety. Building face plane swaps to `AdditiveBlending` at night so the windows visibly bloom against the dark sky. Night building body palette is night-tinted concrete (blues/grays). Day variant unchanged.
- Day/night flag tracked in `this._isNight`; `_rebuildArenaFromServer` calls `_applyDayNight(arena.map_id === "downtown")` BEFORE rebuilding buildings so face textures pick up the correct variant.
- SHORELINE + CROSSFIRE remain daytime.
- 🧪 Verified live: DOWNTOWN renders with deep night sky, stars, glowing yellow windows, dark asphalt streets, and atmospheric bird silhouettes. Lint clean.

### Iteration 23 — **THIS SESSION (2026-02-25, late)**
- ✅ **Downtown brightness boost** — Bumped night-mode lighting so players can spot opponents across the full arena: sun 0.35→0.7, hemi 0.45→0.75, ambient fill 0.18→0.32, fog start 80→110m, fog end 145→200m, cool blue light tints slightly warmer. Still reads clearly as nighttime.
- ✅ **Rain on DOWNTOWN** — 1800-particle `THREE.Points` system with a procedurally-generated vertical streak texture (canvas gradient) + additive blending so drops glow softly against the dark scene. Drops fall 28-46u/s with a slight wind sway; the column follows the player horizontally (wraps when drops drift off-camera) so the player is always inside the rain.
- ✅ **Lightning on DOWNTOWN** — Random strikes every 6-18s. Each strike runs an envelope that spikes sun + hemi + ambient + sky-dome brightness for ~120ms (with a 45% chance of a double-flash at 220-340ms), then a softer 250ms fade back to baseline night intensities. Sky dome color briefly tints toward white during the peak.
- Hooked `_updateWeather(dt)` into the main update loop next to cloud/bird animations. Lazy-builds the rain particle system the first time night activates; rain visibility toggles on day/night swap.
- 🧪 Verified live: rain streaks visible across the sky, lightning flash dramatically illuminates buildings + sky during burst, brighter base lighting reveals opponents at full draw distance. Lint clean.

### Iteration 24 — **THIS SESSION (2026-02-25, late)**
- ✅ **Brighter night map** — Sun 0.7→1.0, Hemi 0.75→1.0, ambient fill 0.32→0.48 (still cool blue tinted). DOWNTOWN now reads much brighter while still feeling like night (stars + moon + glowing windows still dominate).
- ✅ **Lighter rain** — Particle count 1800→700, size 1.8→0.55, opacity 0.7→0.55. Rain now feels atmospheric rather than screen-fill. Streak texture also shortened (32px gradient vs 64px) for a tighter drop look.
- ✅ **Quiet thunder before lightning** — New `audioBus.thunder()` method: brown-noise low-pass filtered to <180Hz with a gentle attack/sustain/decay envelope (1.4s total) + a tiny bandpass crackle at the 0.78s mark. Volume capped at ~0.16 of sfx gain so it's atmospheric not interruptive.
- Lightning re-scheduled: now driven by `_thunderCueAt` instead of `_lightningNextAt`. When the cue fires, `audioBus.thunder()` plays AND the visual flash is armed to peak 0.8s later (matching the crackle in the audio). Next cue scheduled 6-18s out.
- 🧪 Verified live: night is clearly brighter (player can see the full road + buildings + opponents); rain is now subtle dots/streaks scattered rather than dense; thunder code path active (audioBus.thunder() called when cue fires). Lint clean.

### Iteration 25 — **THIS SESSION (2026-02-25, late)**
- ✅ **Puddle reflections on DOWNTOWN** — 12 lazy-built decorative ellipse planes scattered across the asphalt. Each renders a soft radial gradient (warm yellow center + cool blue-gray mid + transparent edge) mimicking window-glow reflection without actual mirror raycasts. Animated per frame: subtle scale pulse (1.4Hz, ±4%) + opacity flicker (2.7Hz, ±8%) so they read as gently rippling water. Lightning strikes briefly boost puddle opacity by +0.25 so reflections "catch" the flash.
- Toned down after first pass: normal blending instead of additive, opacity 0.55 (was 0.85), narrower size, softer gradient — so puddles read as wet asphalt patches rather than glow spots.
- ✅ **Looping rain-on-wet-streets hiss** — New `audioBus.rainAmbient(true|false)`. White-noise buffer (2s, looped) → high-pass at 1800Hz → peaking bandpass at 4500Hz → gentle 1.2s gain fade-in to 0.05. Idempotent (start while running is a no-op); stop fades out cleanly over 800ms before stopping the source. Engine calls `rainAmbient(true)` when night activates and `rainAmbient(false)` when leaving night.
- 🧪 Verified live: puddles visible as faint reflections at distance; building window halos still dominant; rain ambient code path active. Lint clean.

### Iteration 26 — **THIS SESSION (2026-02-25, late)**
- ✅ **Daily Challenges moved to lobby right column** — New `LobbyDailyPanel.jsx` mounts in the previously-empty `lg:col-span-5` area of `Lobby.jsx`. Pulls from `/api/progression`, renders the 3 daily challenge rows inline (progress bar, XP/coin reward chips, inline CLAIM button). Auto-refreshes every 30s and on `refreshMe` after a claim.
- ✅ **Quick Match shortened to 1 minute** — `game_room` `match_duration` 300.0 → 60.0 in `server.py`. Casual FFA now ends after 60s; HUD timer counts down accordingly.
- ✅ **Offline-vs-AI capped at 2 minutes** — `LocalSim` now tracks `matchDuration=120` for `offline` mode (practice mode untouched). State payload includes computed `time_left`; when the timer hits 0 the sim emits a `match_end` payload with placements sorted by kills/deaths so the Victory/Defeat overlay fires identically to online play.
- 🧪 Verified live: lobby renders Daily Challenges panel cleanly on the right; lint clean across backend + frontend.


### Iteration 33 — **THIS SESSION (2026-02-26)**
- ✅ **Gun viewmodel pullback fix (real this time)** — Previous iteration capped pullback at 0.32m, but the AK muzzle (z=-1.25 local) and laser emitter (z=-1.30 local) extend ~1.3m forward of the weapon group origin. With a 0.5m wall in front, even max pullback left the barrel poking 0.95m through the wall. **Fix**: pullback is now distance-aware — computes the exact retraction needed to keep the muzzle on the shooter's side of the wall (`needed = BARREL_OFFSET - wallD + |baseZ| + safety`). Clamped to `[0, BARREL_OFFSET]` so the gun never goes further behind the camera than necessary. Probe range extended to 1.6m. Katana branch updated with its own `BLADE_OFFSET = 0.7` since the sword tip is shorter.
- Files changed: `/app/frontend/src/game/engine.js` (gun + katana pullback math).
- 🧪 Frontend lint clean. With this fix, the muzzle reliably stops ~0.08m short of any wall regardless of distance.

### Iteration 32 — **THIS SESSION (2026-02-26)**
- ✅ **Gun viewmodel no longer clips through walls** — `engine.js` `_forwardObstacleDistance(maxDist)` slab-tests camera-forward against all arena obstacles (inflated +0.06m). When an obstacle sits within 0.85m of the camera, the weapon group is pulled back along local Z by up to 0.32m (linear ramp). Applied to both gun and katana branches so all weapon poses retract uniformly.
- ✅ **Lock-on reticle for the laser auto-aim** — Built a Three.js `_lockReticle` group composed of 4 corner brackets + an inner ring, additive-blended cyan to match the beam. Always-on-top (`depthTest: false`, `renderOrder: 999`). Billboard-locks to the camera each frame, follows the target's chest, distance-scaled (0.45..1.8) so it reads at any range, and pulses opacity at ~3Hz for an "active lock" feel. Shown whenever the laser is **equipped + a lock exists**, not just while firing — so the player sees lock confirmation before pulling the trigger.
- `_laserAutoAimLock` now returns `{ yaw, pitch, target }` (added `target` for the reticle).
- Files changed: `/app/frontend/src/game/engine.js` (forward-distance helper, weapon pose pullback, reticle setup + update).
- 🧪 Frontend lint clean. Hot reload picked up the change.

### Iteration 31 — **THIS SESSION (2026-02-26)**
- ✅ **Shots no longer pass through walls when player is next to cover** — `raycast_hit` in `server.py` was occluding against the SURFACE-touch t of player hitboxes (sphere first-contact). If a target stood close behind a wall their hitbox rim could poke through, registering as a hit. Now `sphere_t` returns both `t_surface` (visual hit point) and `t_center` (projection of sphere centre), and the occlusion gate uses `t_center < occlusion_t` — i.e., the target body must be on the shooter's side of any wall.
- ✅ **Laser aim-assist widened to actually catch close enemies** — Cone half-angle 25° → **60°**; range 15m → **22m**; cone widens by another ~25° (to ~85° half-angle) at point-blank (<8m) so brawls basically always snap. Server `_laser_autoaim_lock` + client `_laserAutoAimLock` updated in lock-step so the local beam visual still follows the lock.
- Files changed: `/app/backend/server.py` (raycast_hit sphere center occlusion, _laser_autoaim_lock params), `/app/frontend/src/game/engine.js` (mirror cone params).
- 🧪 Backend + frontend lint clean. Backend restarted clean.

### Iteration 30 — **THIS SESSION (2026-02-26)**
- ✅ **Laser aim assist (close-range "aimbot")** — Laser beam now snaps onto the nearest living, non-invuln enemy within 15m and inside a ~25° cone of the shooter's forward, provided line-of-sight is clear. Damage targets the snapped angle so the beam reliably connects at hallway ranges.
- Server: new `GameRoom._laser_autoaim_lock(shooter)` helper called at the top of `_apply_laser_beam`. Returns `(yaw, pitch)` or `None`; falls back to the player's manual aim when no target qualifies.
- Beam broadcast events now report the snapped yaw/pitch so other clients see the laser visibly bending onto its victim.
- Client: mirror `_laserAutoAimLock()` in `engine.js` `_updateLaserBeamVisual()` so the LOCAL beam also visibly snaps to the target (uses the delta-merged `_lastPlayersById` cache to find candidates without extra polling).
- 🧪 Verified: backend lint clean, frontend lint clean, both services restarted without errors. Laser still works at long range (manual aim) and gains the visible-track behaviour at close range.

### Iteration 29 — **THIS SESSION (2026-02-26) — P0 Scale fix**
- ✅ **Delta-based state broadcasting** — Server now emits a `state` keyframe once per second (configurable `_keyframe_interval`) and `state_delta` messages on every other tick. Deltas only carry changed fields per player + a `removed_ids` list. Static fields (`username`, `rank_name`, `level`, `banner_icon`, `banner_color`, `banner_animated`, `skin`, `mag_size`, `platform`, `is_bot`, `rank_tier`, `rank_points`) only ride the wire ~1Hz instead of 20Hz.
- ✅ **Client-side delta merging** — `engine.js applyServerState()` maintains `_lastPlayersById` (Map<id, fullPlayerState>) and `_lastTopFields` caches. State-delta messages are merged into the cache and re-synthesized into a `state`-shaped message internally so the rest of the engine and Game.jsx HUD code paths see a fully-populated state. Cache invalidated on `welcome` + `match_start` (fresh map / room).
- ✅ **Top-level diff** — `time_left`, `is_ranked`, `in_queue`, `real_count`, `min_real_players`, `in_intermission` are diffed against the previous broadcast. `events` always travel in full so kill-feeds fire exactly once. Game.jsx falls back to previous HUD state for any field undefined in a delta.
- 🧪 **Verified live**:
  - 87% bandwidth reduction: avg delta 325B vs full state 2461B (`/tmp/test_delta.py`)
  - Cadence: 6 keyframes / 112 deltas over a 5.7s sample = ~1Hz keyframes, ~19Hz deltas (matches design)
  - Backend pytest suite `/app/backend/tests/test_delta_state.py`: 6/6 pass
  - Playwright in-game test: scoreboard names + bot ranks persist across multiple delta cycles, HUD time_left ticks correctly, no regressions in match lifecycle
- Files changed: `/app/backend/server.py` (GameRoom.__init__, tick state assembly), `/app/frontend/src/game/engine.js` (applyServerState merging), `/app/frontend/src/pages/Game.jsx` (state_delta-aware HUD update)

### Iteration 28 — **THIS SESSION (2026-02-26)**
- ✅ **Quick Match queue now actively searches for real players** — Backend `GET /api/queue/casual/status` returns live count of OTHER real, non-spectator humans currently in the shared `game_room`. Frontend polls every 1s during the Quick Match countdown.
- ✅ **Early-complete on human found** — If at least one real player is detected (after ≥1s of "Searching"), the queue completes early and routes the player into the match instead of waiting out the full timer.
- ✅ **Timer extended 2-9s → 6-12s** — Gives the casual-status poll a real window to surface human opponents before bot-fill takes over. Earlier 2-9s felt cosmetic.
- ✅ **Toast UI shows "X PLAYER(S) FOUND"** — Header bar turns green and shows `1 PLAYER FOUND` (live count) when humans are detected; falls back to "SEARCHING FOR PLAYERS" otherwise. A small green `+N HUMAN` chip appears next to the CASUAL · FFA badge.
- 🧪 Verified: `/api/queue/casual/status` returns `{real_players: 0, total_players: 3}` (3 bots, no humans) for a solo session.

### Iteration 27 — **THIS SESSION (2026-02-26)**
- ✅ **Shared ranked room filled with 4 bots** — `ranked_room` startup spawn count 1 → 4 (was a lone `VORTEX-R`, now 4 disguised bots at diff 1.9 sampled from `BOT_NAMES`). Real-vs-real ranked matches now read as a full 5-player lobby instead of a 2v1.
- ✅ **Ranked bot banners adopt joining player's rank** — `GameRoom.add()` re-rolls the `ranked_room` bots' disguise tier + RP using `_reroll_ranked_bots()` whenever a real player joins an empty room. Banners now show the player's tier (Diamond, Master, etc.) ± 20 RP, not the default Bronze.
- ✅ **Ranked AI: cover-seeking + harder strafe** — Smart bots (`difficulty >= 1.5`) now actively repath to the nearest obstacle that breaks LOS with their target when HP < 45 or after taking damage within 600ms (peek-and-duck behaviour). Strafe freq 2.2→2.6 and amp 0.95→1.15 across the board so they're never sitting still. Cover anchor is computed as obstacle centre offset away from target by `max(w,d)/2 + 1.2m`; strafe amp dampened to 35% while actively closing on cover so they actually arrive.
- ✅ **VIRTUE logo moved down on PC** — `Lobby.jsx` main grid `lg:-mt-24` → `lg:mt-2` and inner column `lg:-mt-8` → `lg:mt-6`. Hero logo no longer overlaps the header utility bar on desktop. Mobile margins (`-mt-12 sm:-mt-20`) untouched.

### Iteration 28 — **THIS SESSION (2026-02-27)**
- ✅ **CRASHSITE map added to rotation** — New `MAP_D` themed as a meteor impact site: central meteor boulder, 6-piece crater rim, scattered meteor shards, 4 burnt-out outposts at corners, jagged rock pillars in the mid-field, 12 spawn points, 8 healthpacks. Now in `MAPS = [downtown, crossfire, shoreline, crashsite]` and equally weighted in `random_map()`.
- ✅ **Crashsite atmospherics (frontend)** — Refactored `_applyDayNight(night, mapId)` to accept a theme. Crashsite gets a smoky red/violet sky gradient, heat-haze fog (70→150), warm ember sun + hemi tint, scorched dirt floor (no grass blades), and hides parkland decorations + clouds.
- ✅ **Crashsite VFX (frontend)** — Pulsing emissive meteor core + additive halo, 8 ground scorch rings, 3 billboarded smoke columns with breathing/sway. Animated every frame via new `_updateCrashsiteFx` path in the main loop.
- ✅ **Crashsite in Practice + Offline vs AI selectors** — Added `MAP_D` to `localSim.js` and `MAP_CRASHSITE` (with palette tagline) to `mapsMeta.js`. The PracticeMapSelector now shows CRASHSITE as a 4th card alongside RANDOM/DOWNTOWN/CROSSFIRE/SHORELINE for both PRACTICE RANGE and OFFLINE VS AI.
- ✅ **Crashsite: meteor rock, flames, and divot/crater rim** — Replaced the flat boulder centerpiece with a jagged 3D meteor (icosahedron + 3 fused side chunks, dark basalt, additive ember-vein shell that breathes hot/cool, plus the glowing emissive core/halo). Added 12 procedural animated flames (radial yellow→red gradient texture, billboarded, multi-harmonic flicker on scale + opacity) clustered around scorch rings and crater wedges. Added a ring of 28 raised earthwork berm chunks at radius ~50 (chunky tilted dodecahedrons with flattened bottoms) so the player visually reads as standing inside a wide impact divot.
- 🐛 **Fixed RP-loss missing from match history** — `end_match()`'s match_history insert was using `zip(placements, real_players)`, but `placements` is sorted by kills and contains both real-player and bot rows interleaved. So a real player who lost RP could be paired with a bot's row (delta=0), silently dropping their RP loss (history showed "—" instead of "-60"). Now indexes placements by `user_id` and looks up each real player's own entry. Regression test in `tests/test_match_history_rp_delta.py`.
- ✅ **Bots show plausible +/- RP on match-end scoreboard** — In ranked, bot rows previously hardcoded `delta=0` so only the human player's row had a "+/-RP" number. Now each bot's delta is computed via `compute_rp_delta(bot_placement, bot_disguised_tier)` so the scoreboard reads like a real ranked lobby (every row shows a green +N or red -N). Frontend MatchResultOverlay already renders deltas — no UI change needed. Regression test in `tests/test_bot_rp_scoreboard.py`.
- ✅ **Admin: Redeem Code Creator** — New panel on `/admin/reports` lets admins mint custom one-time-per-user promo codes without redeploying. Backend endpoints `POST/GET/DELETE /api/admin/codes` (admin-guarded) persist codes in a new `redeem_codes` collection with `redeemed_count` + `last_redeemed_at` tracking. `/codes/redeem` now falls back to the dynamic collection when the hardcoded catalog miss. Supported reward types: `xp`, `rp`, `coins`, `min_level`, `rank_up_tiers`, `banner_animated` (all capped to sane maxes). Verified end-to-end via curl: create / redeem / duplicate-create rejected (409) / non-admin rejected (403) / delete / counter increments. UI: purple "REDEEM CODES" card with code/type/amount/label form, code list with reward summary + redemption count + delete.
- ✅ **Season 2 trailer available to all accounts** — Removed the `user?.role === "admin"` gate around the "PLAY TRAILER" button in the Progression (Pass) modal header. Every account can now play the Season 2 cinematic. Verified by signing in as non-admin `player1` and confirming the button renders.
- ✅ **Admin codes: expiry + max-redemption cap** — `POST /admin/codes` now accepts optional `expires_at` (ISO date/datetime, must be in future; date-only is promoted to end-of-day UTC) and `max_redemptions` (positive int ≤ 1M). `/codes/redeem` enforces both with a deliberately generic `404 "Invalid or expired code."` so the surface UX doesn't leak whether a code is unknown / expired / maxed. `GET /admin/codes` returns the new fields + a derived `status` (`active|expired|maxed`). One-time startup migration backfills `expires_at = created_at + 30 days` on legacy codes. UI: form gets a second row with Expires date-picker + Max Redemptions input; table row shows "N/M redeemed", expiry countdown (e.g. "7d 22h"), and a colored status badge (green ACTIVE / red EXPIRED / purple MAXED). 7 regression tests in `tests/test_admin_code_expiry_cap.py` cover parsing, past-date rejection, and the generic-message contract. Verified end-to-end via curl: create with both limits / redeem until cap / 3rd redeem returns generic 404 / admin list shows MAXED status / unknown code returns same generic 404.
- ✅ **Separate ADS sensitivity multiplier** — Added `adsSensitivityMultiplier` (0.25–2.5×, default 1.0) to settings. New `_adsSensFactor()` helper on the engine returns the multiplier only when ADS is active and the current weapon supports ADS (not katana). Applied in mouse-look (`_onMouseMove`), gamepad right-stick (`_pollGamepad`), and touch look (`TouchControls.jsx`). UI: new yellow-accent slider in the Controls tab between Mouse and Controller sensitivity with a clear "applies to mouse, controller, and touch" hint.
- ✅ **Laser weapon buff** — Brings the underused beam closer to AK relevance without making it strictly better:
  - DPS **60 → 90** (50% damage uplift)
  - Headshot multiplier **1.5× → 1.75×**
  - Effective range **25–70m → 30–85m**, min damage floor **60% → 65%**
  - Heat sustain **3s → 4s**, cooldown **4s → 3s** (much more aggressive sustain potential)
  - Aim-assist max range **22m → 26m**
  - New `heat_ramp_seconds` / `heat_cool_seconds` config keys so future tweaks live in `WEAPON_CONFIGS["laser"]` rather than scattered constants.
  - 3 regression tests in `tests/test_laser_buff.py` lock the numbers + assert AK body-DPS still exceeds laser DPS so the laser remains a tradeoff, not a strict upgrade.
- ✅ **Leaderboard seed names share the in-game tier pool** — Replaced the standalone `_SEED_VETERAN_HANDLES` list with `TIERED_BOT_NAMES[rank_idx]` lookups inside `_build_and_insert`. Seeded accounts now draw their base handle from the same per-tier pool that ranked-room bots use, so a player who sees `ApexLumen_T1` climb the Master leaderboard also believably encounters `ApexLumen_T1-R` in a Master match. Verified end-to-end via curl (40-account reseed): every seeded row's username is from the tier pool matching its computed `rank_tier`. 3 regression tests in `tests/test_seed_uses_tiered_bot_names.py`.
- ✅ **Ranked bots re-buffed: AK 2-shot headshot** — Previously ranked bots fired flat `BOT_SHOT_DAMAGE * difficulty_curve` (~23 dmg) with NO headshot multiplier, so even a perfectly-aimed head shot landed for 23 — far below a 2-shot kill. Now ranked smart bots set `_apply_weapon_mults=True`, fire with the full AK body damage (`cfg["damage"]=25`), and `_apply_shoot` applies the weapon's `headshot_mult` (2.0×) on landing on head. Combined with the existing ~30% head-aim bias, a ranked bot's aimed AK headshot lands for **50 dmg → 2-shot kill**. Body shots stay at 25 (4-shot kill) so the bot is a credible threat without being aimbot. Hit/kill events now also flag `headshot: true` for these so the HUD's headshot indicator + screen flash trigger correctly. Casual/offline bots keep their gentler curve. 3 tests in `tests/test_ranked_bot_two_shot_headshot.py`.
- ✅ **Ranked bots: jumping + human-like movement + faster reaction** — Three coordinated humanization tweaks per user feedback ("have ranked bots jump around and move humanlike and lower their reaction time a small amount"):
  - **Jumps**: New `_jump_start_ms` / `_jump_next_ms` state on every bot. Ranked smart bots roll a jump on a 1-2.4s cadence when within ~18m of their target (longer cadence at range), and an immediate reactive jump fires within 300ms of taking damage. Arc is a smooth 650ms sine wave peaking at +1.2m above the player's normal Y. Client mesh lift now derives from `p.y - PLAYER_HEIGHT_BASE` so bots visibly leave the floor.
  - **Human movement**: Added `_juke_phase` — every 1.5-3s the bot adds a random π-offset to its strafe-phase argument so side-to-side motion stops reading as a pure sine. Real players fake-and-snap; bots now do too.
  - **Reaction time**: Trimmed the ranked-only +80ms cooldown penalty down to +40ms — bots react half-a-step faster without becoming aimbot.
  - 4 regression tests in `tests/test_ranked_bot_humanize.py`.
- ✅ **Season 2 Pass — Meteor / Space theme (deferred swap)** — Brand-new milestone skins for the next pass, built but **not active** until the current season clock rolls over:
  - **Tier 10 (Epic) — Stardust Drifter** — deep-space twilight body, nebula-violet → indigo gradient, soft cyan visor + flicker aura
  - **Tier 20 (Epic) — Crater Forged** — scorched basalt armor with molten orange seams, smouldering pulse aura
  - **Tier 30 (Legendary) — Meteor Ascendant** — supernova gold against deep indigo, halo-flare cape, gold spin aura
  - `_season_tiers()` now takes a `season_number` arg with a per-season skin lineup map. `_progression` calls `maybe_reset_season()` first so the moment the timer hits zero, the next request flips the user onto S2 and the meteor pass goes live. No deploy needed at rollover.
  - Catalog (backend + frontend `skins.js`) has all 3 new skins from day one so the renderer can paint them immediately.
  - 5 regression tests in `tests/test_season_2_meteor_pass.py` lock both the S1 and S2 layouts.
- ✅ **Team Deathmatch 3v3 — in rotation + selectable in practice** — Brand new game mode:
  - **Backend**: `GameRoom.game_mode` ("ffa" | "tdm"), `team_scores`, `Player.team` ("red" | "blue"), `_assign_team` balances on join, `_rebalance_teams` reshuffles each new match. Friendly fire blocked across all three damage paths (shoot / laser / melee). First team to **30 kills** triggers an early match-end via existing `end_match` plumbing (no new code path).
  - **Quick match**: 50% of joins randomly roll into a dedicated `tdm_room` instead of the FFA `game_room`. Pre-filled with 5 smart bots so the very first joiner has a balanced 3v3.
  - **Practice + Offline-vs-AI**: PracticeMapSelector now shows a GAME MODE toggle row above the map cards (FREE FOR ALL ↔ TEAM DEATHMATCH). `?tdm=1` flows through the WS URL into the team-mode room. Offline TDM gets per-user rooms with auto-cleanup.
  - **Ranked**: untouched (still FFA only).
  - **HUD**: TDM badge in the top-bar reads "TDM 3V3"; new team-score panel shows `RED N — N BLUE → 30`. `Player.team` surfaced in state delta so future nameplate tinting can hook into it.
  - 12 backend regression tests in `tests/test_tdm_mode.py` (game-mode field, team balance, friendly-fire blocked on all 3 damage paths, early-end arming, dedicated rooms exist, WS handler accepts `?tdm=` param).
- ✅ **TDM team-aware nameplates + friendly-fire crosshair tint** — Hooked the team data from the state delta into the renderer:
  - **Nameplates**: `_makeLabel` now takes a `relation` ("team" / "enemy" / "bot") and paints the plate deep blue + a `▲` chevron prefix for teammates, deep red for enemies, legacy purple for FFA bots. Engine's per-tick remote loop rebuilds the sprite whenever the relation changes (e.g. after a TDM rebalance between matches).
  - **Crosshair**: New `Engine.isCrosshairOnTeammate()` does a 7° forward cone scan against same-team players. HUD overrides the user's preferred crosshair colour with friendly blue when true, and shows a small "▲ TEAMMATE" tag just below the reticle so the cue is unambiguous (helps controller/touch users + colour-blind players).
- ✅ **TDM in-game HUD: polished team scoreboard + minimap** — Two new TDM-only HUD panels:
  - **Team scoreboard**: replaces the basic text line with two team-coloured columns (RED / BLUE) sandwiching a central "FIRST TO 30" tag. The local player's team gets a gold underline; whichever team is ahead fills its column (instead of showing the team colour as text). Big tabular-nums score so it reads at a glance.
  - **TDM Radar minimap** (top-left, TDM-only): 160×160 SVG showing the arena outline, faded obstacle footprints, teammate blips (blue circles + chevron), enemy blips (red circles), and the local player as a gold facing-direction arrow that rotates with yaw. Driven by a new `Engine.getMinimapData()` helper that snapshots the live world each frame.
  - **State-delta bug fix**: top fields like `game_mode` / `team_scores` / `tdm_kill_target` only ship in the FIRST delta after each change, so Game.jsx was collapsing them to "ffa" on every subsequent tick. Engine now caches them across deltas and the HUD reads from `engineRef.current` instead of `msg` directly.
  - **Routing fix**: Practice/Offline normally use LocalSim (zero-latency) — but LocalSim has no team logic. When `?tdm=1` is present we now force the server path so dedicated TDM rooms drive the match. FFA practice still runs offline.
- 🧪 Verified: backend regression suite `tests/test_crashsite_map.py` (4 tests passing) — rotation order, map shape (≥25 obstacles / ≥8 spawns / ≥6 healthpacks), `get_map_by_id`, and `random_map()` distribution.
- 🧪 Verified: frontend lint clean, lobby smoke screenshot loads without console errors, practice map selector screenshot shows all 4 maps + RANDOM.

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

## Recent TDM polish (2026-06-03)
- BOT badge hidden in TDM scoreboard (team colour already conveys allegiance).
- Tab-scoreboard split into RED / BLUE sections with per-team kill totals, ally team rises to the top.
- Remote-player body meshes recoloured by team in TDM (ally = deep blue 0x2858B4, enemy = red 0xC1322B). Local cosmetic skin preserved. Mesh hot-rebuilds on team rebalance.
- Idle-room bot kill reset: when a TDM/casual room has no real players, `run()` now freezes the match clock and zero-outs all bot kills/deaths every tick so the next human joiner sees a clean 0-0 lobby (was: bots accumulated 50+ kills indefinitely). Regression test in `tests/test_idle_bot_kills_reset.py`.
- TDM bots no longer target / shoot teammates (`_tick_bots` target loop + locked-target shortcut both skip same-team allies).
- TDM bots are now disguised with `DISGUISED_BOT_NAMES` + `disguised=True` so the 3v3 lobby reads as "real humans" (no BOT badge, real-looking handles, platform/avatar/rank disguise).
- TDM rooms maintain exactly 6 combat players via `_maintain_population()`: every real-player join despawns one bot (preferring oversized teams); every real-player leave spawns one replacement bot. Spectators and FFA rooms untouched. Boot pre-fill upped from 5 → 6 bots so a 0-real lobby is already 3v3. Regression suite in `tests/test_tdm_auto_balance.py`.
- **FFA lobby cap (4 players)**: new `FFA_LOBBY_SIZE = 4`. Every non-offline FFA room (casual quick-match, ranked, practice) now caps total combat players at 4 via the same `_maintain_population` plumbing; surplus bots are despawned on real-player join (dummies kept last in practice) and replacements spawned on leave. Welcome payload exposes `game_mode` + `is_practice` so the loading screen can show "FREE-FOR-ALL · LOBBY OF 4" / "TEAM DEATHMATCH · 3V3" subtitle below the mode title. Regression suite in `tests/test_ffa_lobby_cap.py`.
- **Lag compensation (favor-the-shooter)**: every player now holds a `pos_history` deque (maxlen=16, ~800ms at 20Hz) appended once per tick. `raycast_hit` accepts an optional `at_time` arg and rewinds every target's position to its snapshot at that timestamp. `_apply_shoot` and `_apply_laser_beam` pass `at_time = now - (RTT/2 + 50ms)` for real-player shots (bot shots skip rewind). Client `shoot` messages now include `ping_ms`; server clamps 0..300ms. Targets dead-at-shot-time are skipped even if they're alive now. Regression suite in `tests/test_lag_compensation.py` (7 cases).
- **Season 2 meteor lobby background**: new `LobbyBackgroundMeteor` component (ember-orange sky gradient, falling meteor streaks, crater horizon glow, ember-tinted halftone, "BOOM!/CRASH!/FLARE!" comic-word bursts, orange/magenta drift blobs). `Lobby` fetches `/api/season` once and swaps to the meteor backdrop when `season_number >= 2`. Admin accounts (`role === "admin"`) get the meteor preview immediately — verified via admin login (renders meteor) vs. fresh user (renders default). Scoped CSS keyframes live in `index.css` under `lobby-meteor-*`.
- **Season 2 meteor lobby music remix**: `audioBus.startLobbyMusic(variant)` now accepts `"default" | "meteor"`. Meteor variant runs at 78 BPM, switches the chord loop from Am-F-C-G to a darker Phrygian-flavoured Am-Em-F-E, widens the pad saws to ±12 cent detune through a soft overdrive ("scorched sky" tone), adds a continuous sub-octave drone, an impact gong + ember-noise tail at the start of every 4-bar phrase, plus a sparse minor-pentatonic vibrato lead riff (only fires on bar 0 of each phrase). Track id encoded as `lobby:default` / `lobby:meteor` so the start-guard hot-swaps cleanly on season rollover. Lobby useEffect re-runs on `showMeteorBg` change so admin-preview = remix; non-admin pre-Season-2 = original.

## Tech Notes
- Hit detection: server-side raycast vs 3-sphere capsule hitboxes.
- 20Hz tick, client predicts movement, server reconciles.
- Bots: simulated WS connections inside the backend, casual room only by default.
- Ranked: `RANKED_MIN_REAL_PLAYERS=1` currently (solo-queue routed to bots after `QUEUE_BOT_FILL_SEC=30s`).
- Placement constants: `PLACEMENT_MATCHES=5`, `PLACEMENT_MULTIPLIER=2` in server.py.

## 2026-06-07 — Leaderboard seed progressive climb
- **Seeded leaderboard bots now climb dynamically across the season** instead of spawning at their final RP. `/admin/seed/veterans` stores `seed_target_rp`/`seed_target_matches/kills/deaths/wins` on each doc plus a per-bot `seed_climb_offset` (0..0.20 of season) and `seed_climb_speed` (0.75..1.35×). Live `rank_points` + `stats.*` start at 0 and `placement_matches_played` at 0.
- New background task `seeded_climb_loop` (ticks every 45s) computes the season's elapsed fraction, lerps each seed's RP and stat totals toward their targets, and clamps `placement_matches_played` to `PLACEMENT_MATCHES` once the lerped match count reaches it (so a seed pops into the leaderboard organically once it has "played" placements). Different offsets/speeds reshuffle the board over time rather than scaling uniformly.
- One-time auto-migration: any pre-existing `is_seeded=True` doc lacking `seed_target_rp` gets its current static RP converted to a target on first tick, then participates in the climb like fresh seeds.
- On `maybe_reset_season` rollover, the existing `rank_points`/`placement_matches_played` reset already zeros seeded bots; the next climb tick rebuilds the curve from 0 automatically — no separate re-seed needed.
- Regression suite: `tests/test_seeded_climb.py` (4 cases — mid-season lerp, end-of-season convergence, pre-offset clamp-to-zero, legacy auto-migration).


## 2026-06-07 — Seeded RP values now match the ranked match curve
- **Every seeded leaderboard bot's RP is now a value reachable via gameplay.** The ranked match deltas (+30 / +15 / 0 / -30 / -60) all share GCD 15, so any RP a real player can accumulate from 0 is a multiple of 15. New helper `_snap_rp_to_match_grid(rp)` snaps any value to the nearest grid step; the seed builder, the legacy migration, the v2 re-snap pass, and the live climb-loop lerp all route through it. Result: no more "423 RP" / "2578 RP" type leaderboard rows that no real player could earn.
- **Match/win counts now justify the displayed RP.** New helper `_synthesize_career(rp, rank_idx)` returns `(matches, kills, deaths, wins)` with `wins >= ceil(rp/30)` (the best-case +30 per win — arithmetic floor) and `matches >= wins` (with a small randomised surplus for plausibility). Win-rate bands scale by tier (40-55% at Bronze..Diamond up to 55-85% at Masters+ where the −60 loss curve demands a higher rate). Replaces the old `random.uniform`-based stats that could produce e.g. 12 wins on a 2578 RP doc (mathematically impossible).
- **v2 re-snap migration**: on first tick the climb loop now finds any existing seeded doc lacking `seed_career_v2: True`, snaps its target RP to the grid, and rebuilds its stat targets via `_synthesize_career`. Skips docs that already happen to be consistent (only stamps the flag). Confirmed live in preview: 69/69 seeded docs migrated to v2, 0 inconsistent docs remaining, every `seed_target_rp` and live `rank_points` is a multiple of 15.
- **Climb-loop floor**: in-progress lerped values also obey `wins >= ceil(new_rp/30)` so mid-climb snapshots remain valid (no "270 RP, 0 wins" anomalies during the early-season ramp).
- Regression suite: `tests/test_seeded_climb.py` grew to 8 cases — added `test_snap_rp_floors_to_multiple_of_15`, `test_synthesize_career_enforces_wins_floor`, `test_v2_resnap_fixes_legacy_off_grid_targets`, `test_v2_pass_skips_already_consistent_seeds`.


## 2026-06-07 — Fixed stale avatar/banner/ranked-botfill tests
- **Avatar pool grew from 6 → 12** (idx 0..11): added animated avatars (Flaming Skull, Pulsing Diamond, Swirling Lightning, Frost Sigil, Quantum Core, All-Seeing Eye) gated by level/peak-rank. Tests still asserted the old 0..5 range and that idx 6 returned 422. Updated `test_iteration7_banner_avatar_kill.py` to assert 0..5 are always-free (200), 6..11 are validator-accepted but unlock-gated (200 or 403), and 12+ → 422. `test_friends_avatar_botrooms.py::test_set_avatar_invalid_rejected` now uses idx 12 (out of range) instead of idx 5.
- **Banner pool grew from 8 → 12** (icons + colors). Updated max-accept test to 11 and out-of-range tests to 12.
- **`ranked_bot_count_for_tier` now returns 4 for every tier** (was 3 for low / 1 for Master / 0 for Goonmaster — felt empty so the design was simplified to a uniform 4-bot FFA). With `FFA_LOBBY_SIZE=4`, `_maintain_population` despawns 1 bot the moment the real player joins so the room caps at 4 total players. Updated `test_ranked_bot_count_function_imports_correctly` and `test_ranked_botfill_low_tier_3_bots` to assert the new contract.
- **Goonmaster now bot-fills in 120..300s** (was infinite — kept top tier from ever getting games). Renamed `test_ranked_goonmaster_no_botfill` → `test_ranked_goonmaster_bot_fill_in_range` and asserts the queue API reports an int in that window.
- **`_set_rank_points` helper now also stamps `stats.bonus_xp=3000`** so the manipulated test user clears the `RANKED_MIN_LEVEL=5` gate. Without this, every "set RP then queue ranked" test was 403'ing before the actual queue logic ran.
- Result: `tests/test_iteration7_banner_avatar_kill.py` + `tests/test_friends_avatar_botrooms.py` now run **44 passed, 1 skipped, 0 failed**.



## 2026-06-07 — Season length: 14d → 30d
- `SEASON_LENGTH_DAYS = 14` → `30` in `server.py`. The current Season 2 now ends 2026-07-05 instead of 2026-06-19 (verified via `GET /api/season` → `length_days: 30`).
- Side effects: the seeded-bot climb curve automatically re-scales to the new 30-day window (the loop derives progress from `elapsed / SEASON_LENGTH_DAYS`), so bots climb proportionally slower per real-time day. No other code changes needed — every consumer reads the constant.
- Updated stale "14-day" comments + test docstring to be season-length agnostic; midseason test now uses `SEASON_LENGTH_DAYS * 0.5` instead of hard-coded 7 days. 11/11 season + climb tests pass.

## 2026-06-07 — TDM matches now read clearly in Profile match history
- **Problem**: TDM (3v3 team) rows in Profile › Match History rendered with the same "QUICK" red badge as FFA quick-matches and showed "Nth of M" placement — which is meaningless in a team mode. A player couldn't glance at their history and tell which matches were team games or whether their team won.
- **Backend** (`server.py`):
  - On `match_history` insert, every doc now carries `game_mode: "ffa" | "tdm"` (was implicit). TDM docs additionally store `team`, `team_score`, `enemy_team_score`, and a precomputed `team_outcome: "win" | "loss" | "draw"` so the UI doesn't have to re-apply tie-break rules.
  - `GET /profile/me/history` passes those fields through for TDM rows; FFA rows stay clean (no leaked TDM keys). Pre-feature legacy docs without `game_mode` default to `"ffa"`.
- **Frontend** (`Profile.jsx`):
  - New `TDM_MODE_META` badge: purple **TDM 3V3** with `Shield` icon — visually distinct from FFA red **QUICK** and ranked blue **RANKED**.
  - Ranked TDM rows show a secondary mini "RANKED" badge alongside TDM so the two dimensions read independently.
  - The "Placement" column became "Result" and switches its content based on `game_mode`: FFA rows still show "Nth of M", TDM rows show a `WIN/LOSS/DRAW` badge + the literal scoreline "12 — 10" (yours — enemy's).
- **Tests**: `tests/test_match_history_tdm.py` (2 cases) — confirms `/profile/me/history` surfaces TDM fields when present, defaults legacy rows to FFA, and never leaks TDM keys into FFA rows. All passing.


## 2026-06-07 — Lobby layout restored + dailies auto-claim
- **Lobby layout**: moved Daily Challenges back to the right `col-span-4` column (was temporarily expanded to `col-span-8` after the skin removal). The middle column is now an empty 4-col gutter that the comic-style "BOOM!/FLARE!/IMPACT!" background art fills naturally.
- **Auto-claim**: added `_auto_claim_completed_dailies(user, daily_state)` server-side. Every `GET /api/progression` now sweeps for completed-but-unclaimed dailies, credits `coins` + `season_xp` in a single batched `update_one` ($set on `daily_state.claimed` + $inc on coins/xp), and returns the freshly-claimed list in `daily.auto_claimed`. Zero writes when nothing's claimable (hot endpoint stays cheap).
- **Frontend** (`LobbyDailyPanel.jsx`): removed the manual CLAIM button. Each row now shows a status pill (`IN PROGRESS` / `CLAIMING…` / `CLAIMED`). When the panel polls `/progression` (every 30s + on mount) and the response includes any `auto_claimed` entries, a green toast surfaces `"Massacre, Hat Trick — +90 coins · +50 XP"` and the auth context refreshes so the header coin pill updates instantly.
- **Tests**: `tests/test_daily_auto_claim.py` (3 cases) — batched `$inc` on multiple completes, no-op when nothing completed, skip already-claimed entries. All passing.


## 2026-06-19 — Pre-match 3-2-1 freeze + countdown
- **Server** (`server.py`): added pre-match freeze to `GameRoom`. New state: `match_started: bool`, `countdown_until: Optional[float]`, `countdown_seconds: float = 3.0`, `_countdown_grace_start`. New WS message `{type: "loaded"}` flips `player.is_loaded = True`; once every real player in the room is loaded, `_maybe_start_countdown` fires `match_countdown` and pushes `match_start` to the moment the countdown ends so the duration timer doesn't burn frozen seconds. `tick()` skips bot AI / damage / match-end while frozen and auto-flips `match_started=True` (broadcast `match_go`) when `countdown_until` elapses. 30s safety fallback if any client never sends `loaded` (force-starts via the normal countdown path so the overlay still plays). On inter-round resets every real player is auto-marked loaded so the new round freezes for the same 3s without requiring a fresh `loaded` handshake.
- **Handler guards**: `shoot` + `melee` are silently dropped while frozen; `input` lets `yaw`/`pitch` through (camera pan stays smooth) but ignores x/z deltas. Welcome packet now ships `match_started`, `countdown_until`, `countdown_seconds` so late joiners + reconnects pick up the right phase.
- **Engine** (`engine.js`): captures the freeze state from welcome / `match_countdown` / `match_go` / `match_start` events. New `getCountdownState()` returns `{secondsLeft, totalSeconds}` for HUD polling. `_tryShoot` early-returns while frozen so no local muzzle flash / recoil plays; `_update` WASD reads are skipped (server is authoritative anyway, this just avoids the snap-back ping-pong).
- **Game.jsx**: sends `{type:"loaded"}` ~200ms after welcome (lets the HUD mount + loading screen reveal finish). New `PreMatchCountdownOverlay` component renders a big animated digit (3 → 2 → 1 → GO!) with a "MATCH STARTING — HOLD POSITION" sub-label; before the server has fired the countdown the placeholder reads "GET READY". 250ms HUD interval samples the engine for the current digit so the overlay ticks without a dedicated timer.
- **LocalSim** (`localSim.js`): same freeze plumbing for offline practice. New `_matchStarted`/`_countdownUntilMs` state, `loaded` handler kicks off the 3s countdown, `_tick` skips respawns/bot AI while frozen and emits `match_go` when it elapses.
- **Tests**: `tests/test_prematch_countdown.py` (8 cases) — fresh room is frozen, countdown fires only after all real players loaded, shoot/melee blocked, x/z blocked but yaw/pitch pass, `_begin_match_now` resets `match_start`, idempotent countdown start, late join skips countdown, bots count as pre-loaded. All passing.
- Smoke-tested offline practice live: countdown overlay rendered with "GO!" final state, player remained at full HP (100/100) confirming no damage during freeze.


## 2026-06-21 — Block direct URL entry to /play
- **Problem**: Any authenticated user could paste `/play?mode=casual` (or refresh while in-match) and immediately spin up a WebSocket + engine, bypassing the lobby's queue/matchmaking flow entirely.
- **Fix**: `navigateToMatch` now stamps `location.state.fromLobby = true` on every navigation it issues. A new `MatchEntryGuard` wrapper (`/app/frontend/src/components/MatchEntryGuard.jsx`) sits between `ProtectedRoute` and `Game` in App.js; if the incoming nav state lacks `fromLobby`, the guard synchronously returns `<Navigate to="/lobby" replace />` so NO Game hook/effect ever runs (no in-flight WS to clean up).
- **Spectate exempt**: `/spectate/:username` is still URL-shareable — that's a legitimate "watch another player" link and explicitly skips the guard.
- **Smoke-tested live**: direct `/play?mode=casual` → bounces to `/lobby`. Clicking the lobby's "Offline" button → loads the match correctly (pre-match countdown overlay + 100/100 HP confirming no damage during freeze).


## 2026-06-22 — Ranked match bug fix + whisper feature
### Bug fix — ranked match couldn't enter
- The `MatchEntryGuard` (added 2026-06-21 to block direct `/play` URLs) was also bouncing ranked-match auto-navigations: `QueueContext` navigates with plain `nav("/play?mode=ranked", { replace: true })` after the matchmaker says "matched", without going through `navigateToMatch` — so `state.fromLobby` was missing and the guard kicked the user back to lobby.
- Fix: `QueueContext` now stamps `state: { fromLobby: true }` on the nav. Smoke-tested live — ranked queue stays active, "SEARCHING" toast persists, and the navigation when matchmaker resolves will pass the guard.

### Whisper (1:1 friend DMs)
- **Backend** (`server.py`): new `whispers` collection with composite indexes on `(from_id, to_id, ts)` and `(to_id, read_by_recipient)`. Three endpoints:
  - `POST /whispers/send` — validates target exists, not self, neither side blocked, 1..280 chars, 20/min rate cap.
  - `GET /whispers/conversation/{username}?limit=50` — returns last N messages oldest-first AND marks the friend's inbound messages as read in one batched update.
  - `GET /whispers/unread` — per-sender unread counts for the friends-list badge.
- **Frontend** (`WhisperChat.jsx`, `FriendsModal.jsx`): new `WhisperChat` panel swaps into the Friends modal when a friend's WHISPER button is clicked. Auto-polls the conversation every 3s. Sends are optimistic (appear instantly, reconciled on next poll). Each friend row shows a red unread-count pill (only on the FRIENDS tab); a red dot also lives on the whisper button. The Friends modal polls `/whispers/unread` every 6s while open. Messages: red bubble for mine, white for theirs, Enter-to-send.
- **Tests**: `tests/test_whispers.py` (6 cases) — happy path send+read, self-whisper rejected, unknown user 404, length bounds, unread counter, block-rejects-both-sides. All passing.
- Smoke-tested live: Friends modal shows the new chat-bubble button next to INVITE / inspect / remove / block.


## 2026-06-24 — Whisper toaster + ranked early-leave penalty
### Lobby-corner whisper toast
- `WhisperToaster.jsx` polls `/whispers/unread` every 6s. When the total increases between polls, it fetches the friend list to resolve sender → username/avatar + the conversation to preview the latest inbound text, then surfaces a small comic-book-styled toast bottom-right ("Friend → text"). Click → opens Friends modal pre-navigated to that chat via the new `initialWhisperWith` prop. Auto-dismisses after 6s; single rolling toast (no stacking).
- Baseline starts at the current unread total so refreshing the lobby doesn't shower the user with re-toasts for messages they already knew about.

### Ranked early-leave penalty
- **Constant**: `RANKED_LEAVE_BAN_MINUTES = 10`.
- **`GameRoom.remove`**: when a non-spectator real player disconnects from a ranked match WHERE `match_started=True` AND `not in_intermission`, calls new `_apply_ranked_leave_penalty` which stamps `ranked_ban_until = now + 10min` + `ranked_ban_reason: "left_match"` on the user doc. Pre-match countdown leaves and post-match intermission leaves are exempt.
- **`/queue/ranked` POST**: now reads `ranked_ban_until`. If positive, returns 403 with `"Ranked locked for {N}s (left a previous ranked match)."` and an `X-Ranked-Ban-Seconds` header. Party path checks every member — one banned alt locks the whole party out.
- **`public_user`**: ships `ranked_ban_seconds` (0 when clean) so the lobby can render a "RANKED LOCKED" countdown without a separate endpoint.
- **Frontend**: removed the LEAVE MATCH button in pause-menu when `hud.isRanked`. Replaced with a red banner: "Ranked matches can't be left mid-game. Quitting will lock you out of ranked queue for 10 minutes." The corner EXIT button (Hud.jsx) is also hidden in ranked.
- **Tests**: `tests/test_ranked_leave_penalty.py` (6 cases — live ranked stamps the ban with ~10-min window, intermission exempt, pre-match exempt, casual exempt, bots never bannable, `public_user.ranked_ban_seconds` math). All passing alongside the 8 prematch + 6 whisper tests.


## 2026-06-24 (later) — Ranked penalty UX + hover SFX + practice consolidation
### Ranked button countdown + -30 RP loss
- **`server.py`**: `_apply_ranked_leave_penalty` now also issues a `$inc: {rank_points: -30}` (new `RANKED_LEAVE_RP_LOSS` constant) in the same write that stamps the 10-min ban, then floors negatives at 0 in a follow-up scoped update. Treated as a first-place loss for the deserter.
- **`Lobby.jsx`**: reads `user.ranked_ban_seconds` from the auth context, ticks it down locally (1s interval), and renders **`RANKED LOCKED · M:SS`** with a Lock icon directly on the RANKED MATCH button. When the countdown hits 0 the lobby auto-fires `refreshMe()` so the server-side gate clears without a manual refresh. Title tooltip mentions the -30 RP penalty.
- **Tests** (`test_ranked_leave_penalty.py`): updated `test_leaving_live_ranked_match_stamps_ban` to assert both the ban timestamp AND the `$inc: {rank_points: -30}` plus the floor-at-0 follow-up. 6/6 leave + 8/8 prematch + 6/6 whisper + 3/3 daily = 23 related tests pass.

### Global hover SFX
- New **`audio.js#playUIBlip()`** — triangle-wave 880→1320Hz chirp with a 60ms pluck envelope, routed through `sfxGain` so it respects the SFX mute toggle.
- New **`useButtonSounds()`** hook (App-level): delegated `mouseover` listener on `.btn-pow` elements, throttled to 80ms, suppressed while pointer-locked (in-match), no chirp on disabled buttons. Zero per-component wiring — any existing/new `.btn-pow` inherits the feedback automatically.

### Combined Practice + Offline button
- Lobby header now has ONE **PRACTICE** button (was PRACTICE RANGE + OFFLINE VS AI). The unified `PracticeMapSelector` got a new **"TRAINING TYPE"** toggle at the top (PRACTICE RANGE vs OFFLINE VS AI) above the existing FFA/TDM toggle and map grid. Returned `opts.mode` from the selector overrides the modal's initial mode prop so the lobby uses the chosen value for the `/play?mode=` navigation. Footer now reads e.g., "SELECTED: RANDOM · RANGE · FFA".


## 2026-06-24 (even later) — Per-button SFX + queue fanfare + lobby motion
### Per-button hover SFX
- `audioBus.playUIBlip(seed)` now varies pitch + waveform by `seed`. Frequencies pulled from a 12-note D-major-pentatonic-ish scale (660Hz..1490Hz). Waveform cycles triangle/sine/square per seed % 3 for an additional timbre layer.
- `useButtonSounds` hashes each button's identity (data-testid → text → href → "btn") via djb2 into the seed so the same button always plays the same note (stable musical identity), and sweeping a row of buttons reads as a small arpeggio rather than a single repeating chirp.

### Queue-start fanfare
- New `audioBus.playQueueStart()` — three-note arpeggio (660 → 880 → 1240Hz) at 0.18 gain, designed to punctuate "you're in matchmaking". Fired from BOTH `joinRankedQueue` (Lobby.jsx) and `startQuickQueue` so the queue entry feels symmetric across modes.

### More animated lobby background + opt-out
- `LobbyBackgroundMeteor` got a major polish pass:
  - **3 depth layers** of streaks (back/mid/front) with distinct sizes, opacities, and blur — reads as parallax.
  - **Pulsing crater glow** (compound animation `lobby-meteor-glow-pulse` + `lobby-meteor-pulse-amp`).
  - **Wobbling comic words** (gentle ±3° rotation + 8px lift on a 6.5s cycle).
  - **Breathing ember blobs** (`lobby-bg-blob-breathe` stacked with the drift transform).
  - **Horizon scan band** — sweeps right→left across the bottom third every 12s, reads as "scanning the impact site".
- `prefers-reduced-motion` honored — all new animations clamp to none when the OS pref is set.
- Component accepts `animated` prop. When false, a calm fallback (sky + halftone + 1 blob) is rendered — what the user remembers as "the old background".
- **Settings toggle** "Animated Lobby Background" added under Graphics. Defaulted ON. Lobby live-subscribes to `virtue-settings-changed` so the swap is instant.


## 2026-06-24 (final) — Casual Quick Match → server-side queue
### Server-side FIFO casual queue (mirrors ranked)
- `CASUAL_QUEUE: List[dict]` + `CASUAL_BOT_FILL_SEC = 10.0` constants in `server.py`. Same entry shape as ranked (`user_id` + `user_ids` + `username` + `joined_at`) so the matchmaker logic stays parallel.
- **Matchmaker loop**: appended a casual block — pairs two waiting entries head-to-head in one tick (single `tdm` roll shared between both users so they land in the same room), otherwise bot-fills after 10s with `vs_bot: True` + a private `room_key`. Pre-existing ranked matchmaking untouched.
- **Endpoints**:
  - `POST /api/queue/casual` — clears any stale matched flag, appends entry. Returns `{ok, bot_fill_seconds, queue_size}`.
  - `GET /api/queue/casual` — returns either `{in_queue, wait_seconds, queue_position}` or `{matched, match_id, vs_bot, tdm}` once paired.
  - `DELETE /api/queue/casual` — yanks the caller's entry and clears `MATCHED_USERS[uid]`.
  - `GET /api/queue/casual/status` — unchanged real_players counter for the toast.
- **`ws_game(mode=casual)`** now honours `MATCHED_USERS[uid].tdm` so paired players resolve to the same shared `game_room` or `tdm_room`. The flag is consumed on connect so the next queue cycle starts fresh.

### Frontend wiring
- `QueueContext.jsx` — new `casualQueueState` + `casualWaitSec` state, with `joinCasual()` and `cancelCasual()` actions. `joinCasual` POSTs, starts a 4Hz local wait timer + 1Hz server poll, fires `audioBus.matchFound()` + `virtue-match-loading` event on `matched:true`, and nav-replaces to `/play?mode=casual` after 1.2s with `state.fromLobby: true` for the MatchEntryGuard.
- `Lobby.jsx` — removed the client-side `startQuickQueue` timer + `quickQueueSec` state + `quickNavStartedRef` + `quickQueueTarget`. The QUICK MATCH button now delegates to `joinCasual()`/`cancelCasual()`. The toast renders `casualWaitSec` / `casualQueueState` + the cosmetic "X PLAYER(S) FOUND" header from the existing `/queue/casual/status` poll.
- Both ranked and casual matchmaking now share the same architectural shape: server-authoritative FIFO + bot-fill timeout, with the only differences being the absence of tier gating and the shorter 10s timer for casual.

### Tests
- `tests/test_casual_queue.py` (5 cases) — head-to-head pairs both users with identical `tdm` flag, solo entry bot-fills after timeout with private `room_key`, `_remove_user_from_casual_queue` yanks the right entry, `CASUAL_BOT_FILL_SEC` regression guard at 10s, GET payload carries `tdm`. All passing.
- Live e2e curl: POST → in_queue:true → 12s wait → matched:true vs_bot:true → DELETE → in_queue:false. Verified against admin account.
- Live UI smoke: QUICK MATCH → toast "SEARCHING FOR PLAYERS · 0..N" → LEAVE QUEUE clears. Screenshot in `/tmp/lobby_casual_queue.png`.




## 2026-06-24 (later) — Rank sub-divisions + animated rank icons + rank-up shatter/reform
### Backend — sub-divisions on every tier (except Goonmaster)
- New helpers `rank_division_for_points(points, tier_idx)` and `rank_division_roman(div)` in `server.py`. Each main tier (Bronze..Grandmaster) is split into three equal-width RP bands: III (3 = entry), II (2 = middle), I (1 = top, one band from promotion). Goonmaster (tier 7) is undivided and returns 0.
- **`public_user`** now ships `rank_division` AND `peak_rank_division` so the lobby/profile render labels like "SILVER II" without a second fetch.
- **`/leaderboard`** rows carry `rank_division` for the same reason. Past-season archive rows are intentionally left as plain tier names (historical, no migration).
- **`Player.to_state()`** scoreboard payloads embed `rank_division` so the in-match scoreboard reads the same labels.
- **End-match placements** include `rank_division` AND `prev_rank_division` so the rank-up overlay can show e.g. "BRONZE I → SILVER III" with both divisions.
- Redeem-code `rank_up_payload` (e.g. WARPSPEED) carries divisions inside `prev_tier`/`new_tier`.

### Frontend — division-aware icons + labels everywhere
- **`/app/frontend/src/game/rankIcons.js`** — added `rankDivisionForPoints`, `divisionRoman`, `rankLabelFor` helpers. Thresholds mirror the backend `RANK_TIERS` so a client-side fallback works for any payload that predates the new fields.
- **New `<AnimatedRankIcon />`** (`/app/frontend/src/components/AnimatedRankIcon.jsx`). Wraps the existing lucide rank icons with division-aware ornament layers:
  - Division 3 (entry): soft pulse glow.
  - Division 2 (middle): pulse + 1 slow-orbiting Sparkles accent + brighter glow.
  - Division 1 (top): pulse + 2 counter-orbiting accents (Sparkle + Star) + rotating dashed halo ring + strongest glow.
  - **Goonmaster**: orange flame flicker behind + rotating gold halo + diagonal gold shimmer overlay + counter-orbiting accents (always max-detail since it's undivided).
  - `prefers-reduced-motion` honored — all decorations pause.
- **CSS keyframes** added to `/app/frontend/src/index.css` (`rank-pulse-*`, `rank-halo-spin`, `rank-orbit-spin`, `rank-flame-flicker`, `rank-goon-shimmer`).
- **Label propagation**: `PlayerCard`, `RankBadge` (lobby header), `RankCard` (Profile current+peak), `RankPill` (PublicProfileModal), `FriendsModal` (friend rows + search), `PartyPanel` member rows, `MatchResultOverlay` end-match rows, and the Leaderboard rank cells now render `{name} {romanize(division)}` (e.g. "SILVER II"). Goonmaster intentionally shows just "GOONMASTER".

### Rank-up overlay — shatter & reform transition
- `RankUpOverlay.jsx` rewritten with a 4-phase timeline:
  - Phase 0 (0–0.7s): "RANK UP!" banner pops in over the radial backdrop; previous-tier crest visible.
  - Phase 1 (0.7–1.35s): previous crest brightens then SHATTERS outward (10 Sparkles fly in a starburst via `rankup-prev-shatter` + `rankup-shard-fly` keyframes), white flash, expanding ring shockwave.
  - Phase 2 (1.35–2.0s): new-tier crest assembles from blur+scale (`rankup-new-assemble`) using `AnimatedRankIcon` so its division ornaments animate from the moment it appears.
  - Phase 3 (2.0–6.5s): 24-Sparkles star shower + the new crest holds.
- Crest labels show `NAME + division roman` (e.g. "BRONZE I → SILVER III").
- **Bug fix**: previous overlay restarted to phase 0 whenever the parent (Lobby/Game) re-rendered because `onClose` was in the timing effect's deps. Now uses a `useRef` to hold the latest `onClose` so the timeline runs uninterrupted from open → auto-dismiss.

### Tests
- `tests/test_rank_divisions.py` (10 cases) — band boundaries for each of the 7 divided tiers (entry/middle/top), Goonmaster always returns 0, roman helper, and `public_user` exposes both `rank_division` + `peak_rank_division`. All passing.
- Live UI smoke: lobby header shows "GRANDMASTER III", Profile rank cards show both current + peak with animated icons + division labels, Leaderboard top 5 read "GOONMASTER / GRANDMASTER III / MASTER II / MASTER III / MASTER III", rank-up overlay phases verified (phase 2 ring shockwave + phase 3 star shower screenshots saved to `/tmp/`).


## 2026-06-24 (final) — Admin News broadcast system
### Backend
- New collection `news_posts` (mongo, ad-hoc — no schema migration needed). Fields: `title`, `body`, `author_username`, `author_id`, `created_at` (datetime UTC), `pinned` (bool).
- **Endpoints** (in `server.py`):
  - `POST /api/admin/news` (admin-only) — `{title, body, pinned}`. Validates 2..120/2..4000 char bounds via `NewsPostIn`. Returns the persisted post.
  - `DELETE /api/admin/news/{post_id}` (admin-only) — yanks one post; 400 on malformed id, 404 if missing.
  - `GET /api/news` (any auth) — list (sorted: pinned first, then `created_at` desc). Side-effect: stamps `users.news_last_read_at = now` so the unread badge clears as soon as the feed is opened.
  - `GET /api/news/unread` — returns `{count}` of posts with `created_at > news_last_read_at`. Brand-new accounts see every existing post as unread. Cap displayed at 99.
- Non-admin POST/DELETE return 403.

### Frontend
- New page `/news` (`/app/frontend/src/pages/News.jsx`) with comic-styled header (BACK · NEWS · admin NEW POST CTA) and a stack of news cards.
- **News card** — pinned posts wear a yellow ring + pin icon + yellow title bar; others use black title bar. Body preserves line breaks (`whitespace-pre-wrap`). Footer shows author + relative timestamp (Just now → Nm → Nh → Nd → Mon DD), plus an admin-only red DELETE button.
- **Compose modal** — title input, body textarea (with 4000-char counter), Pin-to-top checkbox, Cancel/Publish buttons. Optimistic prepend on submit + refresh from server (so pinned-first ordering stays correct).
- **Lobby NEWS button** — purple `Megaphone` button next to FRIENDS with a red `▣N` unread badge top-right. Polls `/news/unread` every 30s; clears instantly when `virtue-news-read` event fires from the News page.
- **Route registration** — `/news` added to `App.js` under `ProtectedRoute`.

### Tests
- `tests/test_news.py` (6 cases) — admin can create, non-admin gets 403, list sorts pinned-then-newest, unread counts posts after `news_last_read_at` (including the "never opened" baseline), admin can delete + re-delete 404s, malformed id returns 400. All passing.
- Live e2e: admin creates pinned + regular post → list endpoint returns them in correct order with pinned first → unread is 0 after read; non-admin gets 403 on POST/DELETE. UI screenshots verify the page renders, compose modal works, and posts publish optimistically.


## 2026-07-01 — Ranked Queue stale-flag flicker fix (verified)
### Bug
Ranked queue timer flickered/disappeared and instantly popped "match found" upon opening the game. Root cause: `MATCHED_USERS[uid]` lingered across sessions when the client `ack` never fired (tab close, network hiccup, ws error). Every subsequent `/queue/ranked` GET saw the stale flag and returned `matched: true`, triggering the client's 3-2-1 loading screen and blocking fresh queues.

### Fix (backend, in `server.py`)
- **`POST /api/queue/ranked`** — sweeps any `MATCHED_USERS` entry older than 60s before checking the join. Prevents stale flags from short-circuiting fresh joins with a ghost "match found".
- **`GET /api/queue/ranked`** — same 60s sweep on the status path (the frontend background poller hits this every 3s). A rogue matched flag now self-clears on the next poll instead of spamming the client.
- **`WS /api/ws/game?mode=ranked`** — connect-time `MATCHED_USERS.pop(uid)` mirrors the casual mode's cleanup. The ack path is now belt-and-suspenders (both ws-connect and explicit ack consume the flag).

### Tests (all passing)
- `tests/test_stale_matched_flag.py` (3 cases):
  1. `test_stale_matched_flag_swept_on_get` — 61s-old flag → GET returns `matched:false`, flag popped.
  2. `test_fresh_matched_flag_still_returns_matched` — brand-new flag → GET returns `matched:true`, flag retained.
  3. `test_post_queue_ranked_sweeps_stale_flag_before_join` — 120s-old flag + POST → fresh queue entry created, flag gone.

### Frontend
No code change needed — the sweep is server-authoritative and the existing `QueueContext.jsx` already ignores `matched:false` responses gracefully.

### Live smoke test
Logged into `player1@shooter.com`, landed on `/lobby`: no ghost "match found" overlay, timer widgets absent (queue not started), buttons interactive. `RANKED LOCKED · 1:46` shows normally (unrelated 10-min leave-penalty from earlier automated tests).

## 2026-07-01 (later) — Animations + New Snow Map (TUNDRA)

### Improved dying animation (`engine.js`)
Replaced the flat 0.7s topple with a **4-phase KO** (~1.0s total):
- **Phase 0 (0-0.14s) Recoil**: torso/head snap back, arms fling up-and-out (drops the weapon).
- **Phase 1 (0.14-0.45s) Buckle**: knees fold under (one leg slightly more than the other), body hangs for a beat.
- **Phase 2 (0.45-0.90s) Topple**: ease-in fall backwards (gravity accel), arms drift outward, side roll gathers speed.
- **Phase 3 (0.90-1.0s) Settle**: small landing bounce, torso lands with a randomised side lean, limbs relax flat.
- Each death captures a mid-stride pose snapshot so the flail interpolates from wherever the limbs happened to be.
- Per-death `seed` gives a slightly different side-roll direction so mass deaths don't look uniform.
- Respawn clears the pose snapshot + zeroes every axis the KO touched.

### Improved walking/running animation (`engine.js`)
Replaced the simple sin-swing with a richer gait:
- **Hip ↔ shoulder counter-rotation**: torso twists opposite to the leading leg for a natural walk cycle.
- **Asymmetric arm swing**: right arm (rifle-carry) swings ~42% of the left — reads as a soldier in motion.
- **Vertical body bob at 2× cadence**: peaks at each foot plant, amplitude scales with sprint.
- **Sprint boost**: cadence ramps 8Hz → 13Hz, stride widens 0.55 → 0.95 rad, arms flare slightly outward.
- **Forward lean on sprint**: whole-body tilt (up to 0.08 rad) — reads as "leaning into a run".
- Sprint-detected from `movingSpeed > 5.2` (matches the server-side sprint threshold).
- Legs get a slight extra amplitude bump so run legs sweep noticeably wider than the arms.
- Torso reference now returned by `_buildHumanoid` and animated per-frame.

### New map — TUNDRA (5th map)
Frozen arctic wasteland, added everywhere the previous 4 maps live:
- **Backend** (`server.py`): `MAP_E` with a frozen central pond, 6-shard ice ring, 4 snowdrifts, 8 pine-stump pillars, 4 wrecked research outposts, 12 spawn points, 9 healthpacks. Added to `MAPS = [...]` list.
- **Client sim** (`localSim.js`): mirrors the backend layout so practice/offline mode can use TUNDRA.
- **Metadata** (`mapsMeta.js`): `MAP_TUNDRA` with a pale-blue palette (snow bg, glacial-cyan obstacles, steel-blue accents). Shown in the loading-screen minimap preview and Practice Map Selector card.
- **Engine rendering** (`engine.js`):
  - Snow-white toon-material ground (`0xf1f6fb`).
  - Tundra sky gradient (deep steel blue → milky white low horizon) rebuilt as a canvas texture.
  - Overcast lighting: sun dimmed (0.75) with cool blue-white tint; hemisphere boosted (1.15) with high-albedo snow ground colour.
  - Tighter fog (60→155) for the blizzard whiteout look.
  - Snow disc hidden (overcast); clouds retinted grey; grass blades hidden.
  - Ice-cyan obstacle palette (`[0xe4eef7, 0x9ec8e0, 0x4a6a88, 0x3a2a20, 0xbfd8ea]`).
  - **Snow particle system**: 900 procedural fluffy flakes with per-flake horizontal sway (sine drift) + slow floaty fall (1.4-2.6 u/s). Lazy-built on first tundra load, camera-relative recycle, ~0.35 particle size. Animates every frame regardless of day/night.

### Tests
- `tests/test_tundra_map.py` (4 cases) — tundra in rotation, correct topology (frozen pond centre, ≥25 obstacles, ≥8 spawns), `get_map_by_id` lookup, and random_map eventually picks tundra.
- Updated `tests/test_crashsite_map.py::test_crashsite_in_rotation` to expect the new 5-map list.
- All map + stale-flag tests passing.

### Live smoke test
Verified the Practice Map Selector shows the TUNDRA card as the 5th option; direct match load `?map=tundra` renders with a pale snow ground, cool blue-grey sky, and no console errors.


## 2026-07-01 (later still) — Queue Timings + Locked ETA

### Backend — new tier-banded queue times (`server.py`)
Per user request, retuned the ranked bot-fill windows:
- **Bronze → Diamond (tiers 0-4)**: random **20-45 seconds** per join (was 5-20s for Bronze-Gold, fixed 45s for Plat-Diamond)
- **Master → Goonmaster (tiers 5-7)**: random **30 seconds to 3 minutes (30-180s)** per join (was fixed 120s for Master/GM, 120-300s for Goonmaster)
- Constants renamed: `QUEUE_BOT_FILL_LOW_MIN/MAX` now cover 20-45s and `QUEUE_LOW_TIER_MAX=4` (Diamond); new `QUEUE_BOT_FILL_HIGH_MIN/MAX` covers 30-180s.
- Simplified `bot_fill_seconds_for_tier()` — every tier now rolls randomly (no more fixed values).

### Frontend — locked ETA on queue join (`context/QueueContext.jsx`)
Fixed the "estimated wait time flips every poll" complaint:
- Added `lockedEtaRef` — captured on the **first** in-queue response and never re-read.
- All subsequent polls (`setQueueState`) merge `estimated_wait_seconds: lockedEtaRef.current` into the state so the displayed "Est. wait ~Xs" pill stays put while the live count-up timer ticks normally.
- Lock resets on: match found, queue cancel (`DELETE`), and 3-consecutive-miss teardown.
- Without this fix, the newly-randomised server bot-fill (which re-rolls every poll) would swing the client ETA wildly (e.g. 32s → 41s → 25s over 3 seconds).

### Tests
- Updated `tests/test_bot_fill_bands.py` — 4 cases guarding the new tier boundaries + ranges.
- New `tests/test_queue_eta_lock.py` — 3 cases: POST + GET both include `estimated_wait_seconds`, Diamond now uses low band, Master now uses high band.
- Updated `tests/test_recent_features.py::test_lower_tier_bot_fill_positive_45` → asserts 20-45 range instead of fixed 45.
- Updated `tests/test_recent_features.py::test_goonmaster_tier7_bot_fill_neg1_and_no_fill` → renamed to `_30_to_180`, asserts 30-180 range instead of -1 sentinel.
- Updated `tests/test_overwatch_shoot.py::test_bronze_admin_returns_45` → renamed to `_returns_20_to_45`, asserts the new range.
- Updated `tests/test_overwatch_shoot.py::test_master_admin_returns_120` → renamed to `_returns_30_to_180`, asserts the new range.
- All 22 queue/timing tests pass.

### Live evidence
Back-to-back `GET /queue/ranked` calls now return different `bot_fill_seconds` values on the server side (e.g. `30` then `26` for a Bronze user) — confirming the randomisation. The client-side lock guarantees the user only ever sees the first value.


## 2026-07-01 (evening) — Leaderboard Bots Climb Faster + Diamond+ Heavy

### Backend (`server.py`)
Two tuning goals per user request:

**1. Faster climb**
- `seed_climb_speed` sampling: `[0.75, 1.35]` → **`[1.35, 2.4]`** (roughly 2× faster on average)
- `seed_climb_offset` sampling: `[0.0, 0.20]` → **`[0.0, 0.08]`** (bots start climbing much sooner into the season)
- Applied in three places: the v1 legacy migration, the new v3 migration, and the seed endpoint's fresh doc insert.

**2. Leaderboard skews Diamond+ (60% → ~70%)**
Retuned the RP bucket weights in `/admin/seed/veterans`:
| Tier | Old weight | New weight |
|------|-----------:|-----------:|
| Bronze | 8 | 3 |
| Silver | 12 | 4 |
| Gold | 18 | 8 |
| Platinum | 22 | 15 |
| **Diamond** | 20 | **28** |
| **Master** | 12 | **22** |
| **Grandmaster** | 6 | **14** |
| **Goonmaster** | 2 | **6** |
Diamond+ = 70% of new seeds (was 40%).

**3. v3 migration — retroactively boost existing bots**
Added a one-shot migration in `seeded_climb_loop`:
- For every existing seeded bot: bump `seed_climb_speed` into the new `[1.35, 2.4]` band + tighten offset to `[0.0, 0.08]`.
- For ~55% of bots currently targeting Bronze/Silver/Gold (`seed_target_rp ≤ 490`): re-target them to a Diamond..Goonmaster RP window (weighted 28/22/14/6). Stat targets are re-synthesized via `_synthesize_career` so wins/matches stay mathematically consistent with the new higher RP.
- Marked with `seed_v3_boost: True` so this runs exactly once per doc.

### Tests
- New `tests/test_seed_climb_tuning.py` (3 cases) — guards the new bucket weights (Diamond+ ≥ 60%) and the tighter climb-speed + offset ranges.
- Updated `tests/test_seeded_climb.py` — every test doc now carries `seed_v3_boost: True` to opt out of the v3 migration and keep the baseline-lerp assertions valid. Legacy-migration test now expects the new offset/speed bands.
- All 11 climb + tuning tests pass.

### Live evidence
Post-restart leaderboard shows a dramatic tier shift toward the top:
- Position #1: `Goonlord_404` @ 3150 RP (Goonmaster)
- Positions 2-6: Five more Goonmaster entries (2205-2685 RP)
- Positions 7-10: Grandmaster entries
- API `GET /api/leaderboard/ranked?limit=100` returns 50 entries with the top-25 all Diamond+.
- Effect will continue to compound as the climb_loop keeps ticking — promoted bots lerp from their current RP toward the new high-tier targets over the remainder of the season.


## 2026-07-01 (late evening) — Goonmaster-Dominated Leaderboard (End of Season)

Per user request, most of the leaderboard should read **Goonmaster** by the last week of the season.

### Backend (`server.py`)

**1. Retuned bucket weights** for the `/admin/seed/veterans` endpoint — Goonmaster now the dominant tier:
| Tier | Was | Now |
|------|-----:|-----:|
| Bronze | 3 | 1 |
| Silver | 4 | 2 |
| Gold | 8 | 3 |
| Platinum | 15 | 5 |
| Diamond | 28 | 10 |
| Master | 22 | 14 |
| Grandmaster | 14 | 15 |
| **Goonmaster** | 6 | **50** |
Half of every new seed run now targets Goonmaster (2300-3200 RP).

**2. Expanded Goonmaster name pool** — was 3 handles (`GOONFATHER`, `TheLastGoon`, `GoonLord_404`), now **20 unique handles** including `GoonEmpress`, `OverlordVii`, `TheGoonEternal`, `GoonKing_Ω`, `GoonMonarch`, `GoonWraithZ9`, `GoonReaperUltra`, `GoonHydra_Prime`, etc. Prevents the Goonmaster-heavy board from collapsing into `GoonLord_404-100`, `GoonLord_404-200`, ... spam.

**3. v4 migration — Goonmaster promotion**
A one-shot migration in `seeded_climb_loop` runs alongside v3:
- Selects every seeded bot NOT already targeting Goonmaster (`seed_target_rp < 2300`).
- Promotes 65% of them into a Goonmaster RP window (2300-3200), re-synthesizing career stats via `_synthesize_career` to stay mathematically consistent.
- Marked with `seed_v4_gm: True` so it runs exactly once per doc.
- Combined with the earlier v3 climb-speed boost (`1.35..2.4` per bot), promoted bots reach their new target within a few climb ticks. Since we're at ~87% of season elapsed and `p = (0.87 - 0.08) * 1.35 ≈ 1.07 → clamped 1.0`, every bot immediately lerps to 100% of its new Goonmaster target.

### Tests
- New `test_seed_endpoint_buckets_are_goonmaster_heavy` — asserts Goonmaster weight ≥45% AND Diamond+ combined ≥85%.
- New `test_goonmaster_name_pool_expanded` — asserts ≥15 unique Goonmaster handles.
- Updated existing `test_seeded_climb.py` docs with `seed_v4_gm: True` opt-outs so baseline-lerp assertions stay deterministic.
- All 15 climb + tuning tests pass.

### Live evidence
Post-restart leaderboard API:
```
GET /api/leaderboard/ranked?limit=100  →  50 entries
  GOONMASTER: 48  ← 96% of the board
  GRANDMASTER: 2
```
UI screenshot confirms every top-10 slot is Goonmaster:
- #1 `Rampage_Arc831 @ 3195 RP` (Goonmaster)
- #2 `Driftwolf-9794 @ 3180 RP` (Goonmaster)
- #3 `RogueByte474 @ 3150 RP` (Goonmaster)
- ... every visible row: Goonmaster


## 2026-07-01 (night) — Past-Season Banner Titles + Bot RP Snapping

### Feature 1 — Past-season peak-rank banner titles
Players can now flex previous seasons' peak ranks on their banner (e.g. "S2 · GRANDMASTER").

**Backend (`server.py`)**
- `maybe_reset_season` now stamps a `past_seasons[]` array on every user with `rank_points > 0` at rollover: `{season, tier, tier_name, rp}`. Idempotent (skips if the same season is already listed). Runs BEFORE the RP wipe so the tier reflects the season's final rank.
- New field on the user doc: `title_season` — the season number currently equipped as the banner title (or `null` to hide).
- `public_user()` DTO exposes both `past_seasons[]` and `title_season` (surfaced via `/auth/me`, friend endpoints, party visitor lookups, etc.).
- New endpoint `POST /profile/me/title` `{season: int|null}`:
  - Validates the season is actually in the caller's `past_seasons[]` (returns 404 otherwise — prevents self-awarding "SEASON 99 · GOONMASTER").
  - `null` clears the title.

**Frontend**
- New helper `/app/frontend/src/game/bannerTitle.js` — `formatBannerTitle(user)` returns the compact `"S2 · GRANDMASTER"` string (or `null`).
- `PlayerCard.jsx` — new `bannerTitle` prop, rendered as centred text inside `BannerStrip` between the level chip and rank icon. `data-testid="player-card-banner-title"`.
- `Lobby.jsx` + `PublicProfileModal.jsx` — pass `bannerTitle={formatBannerTitle(user)}` through so the title shows in every PlayerCard mount.
- `Profile.jsx` — new `TitlePicker` card under the AvatarPicker. Grid of tiles (NONE + one per past season with tier name), red ring on the equipped tile, "EQUIPPED" label. Hidden when the user has no past seasons yet.

### Feature 2 — Bot RP snapped to the leaderboard grid
Every disguised bot's `disguise_rank_points` now snaps to the same **match-grid multiples of 15** the leaderboard seeds and real ranked matches use.

**Backend (`server.py::GameRoom.spawn_bot`)**
- After computing `pts` (casual/tier-aligned/player-aligned), pass through `_snap_rp_to_match_grid(pts)`.
- Tier-aligned disguises re-clamp back into the tier band after snapping in case the snap dipped below the tier floor.
- Same rule as `/admin/seed/veterans` — every visible RP value in the game is now reachable through actual +30/+15/0/-30/-60 match deltas. Bot RP is indistinguishable from real player RP.

### Tests (all passing)
`tests/test_titles_and_bot_rp.py` (6 cases):
1. `test_ranked_bot_disguise_rp_is_snapped_to_grid` — every tier 0-6, 30 rolls each, RP % 15 == 0.
2. `test_ranked_bot_disguise_rp_stays_inside_tier_band` — snap didn't push RP into a neighbouring tier.
3. `test_casual_bot_disguise_rp_is_also_snapped` — casual disguise path (RP 0-850) also snaps.
4. `test_player_aligned_disguise_rp_is_snapped` — player-aligned ±20 jitter path also snaps.
5. `test_set_title_rejects_seasons_the_user_did_not_finish` — 404 on season not in past_seasons; clear (`null`) works.
6. `test_public_user_exposes_past_seasons_and_title_season` — DTO carries both fields.

### Live evidence
- `POST /profile/me/title {season: 99}` → 404 `You didn't finish that season — nothing to display.`
- `POST /profile/me/title {season: null}` → clears the title.
- UI screenshot: Profile page shows the SEASON TITLES card with `NONE / S2 GRANDMASTER (equipped) / S1 DIAMOND` tiles laid out cleanly.


## 2026-07-01 (late night) — Banner Titles Now Actually Visible

Follow-up after user reported "I do not see the titles". Root cause was two-fold:
1. **Existing players had `past_seasons: []`** — the stamp only fires on future rollovers, so no one on the live DB had entries yet.
2. **Big `ProfileBanner` didn't render the title** — only the tiny `BannerStrip` in PlayerCard did, and at 8px font it was practically invisible.

### Fixes
- **Startup backfill** — new `_backfill_past_seasons_once()` runs on FastAPI startup: for every user with `peak_rank_points > 0` and no `past_seasons`, stamp a synthetic entry `{season: prev_season, tier, tier_name, rp}` derived from their peak. Idempotent (empty second pass) and marked into logs. **Backfilled 123 users on first run.**
- **ProfileBanner now shows the title** as a big centred stamp (font-display 2xl → 3xl) with a bordered semi-transparent panel — impossible to miss.
- **PlayerCard BannerStrip title** — sized up (was 8px, now `height-2` = ~12-16px) and given a subtle `border + bg-black/25` panel so it reads even on the small (sm) lobby size.

### Verified
- Profile page screenshot (Player1): the top banner reads **"S2 · GRANDMASTER"** in giant purple pill text.
- Bottom of Profile: SEASON TITLES card shows `NONE / S2 GRANDMASTER (equipped) / S1 DIAMOND` tiles.
- Backfill log: `past_seasons backfill: stamped 123 users with S1 entry`.
- Same 6-test suite still passing.


## 2026-07-01 (very late) — Bots Now Flex Titles Too

### Bots on the leaderboard now show past-season titles
Every seeded (leaderboard) bot's public profile now displays an equipped "S1 · GOONMASTER" (or similar) title on their banner, making them read as veteran players climbing across multiple seasons.

**Backend changes (`server.py`)**

1. **`_backfill_past_seasons_once` extended** — now runs TWO passes:
   - Real-user pass (unchanged): stamp entries for users with `peak_rank_points > 0` and no past-seasons.
   - **Seeded-bot pass (NEW)**: for every bot with `seed_target_rp > 0` and no past-seasons, stamp a title-tier entry keyed to the bot's target RP + `title_season: prev_season`. ~50% also get an OLDER lower-tier entry to sell the "veteran climbing over seasons" narrative.

2. **New helpers**:
   - `_CACHED_PREV_SEASON_NUMBER[0]` — module-level cache updated by both the backfill and `maybe_reset_season` so the synchronous seed endpoint can key new bot titles without a Mongo round-trip.
   - `_prev_season_number()` — reads the cache with a safe fallback.
   - `_seed_past_seasons_for(rp, rank_idx)` — builds a plausible `past_seasons` array + optional older-tier entry for a freshly-created bot doc.

3. **Fresh bot seeds** (endpoint `/admin/seed/veterans`): every new bot doc is created with `past_seasons` + `title_season` already stamped so the flex is instant, not deferred to next boot.

4. **`public_profile` endpoint**: both the private (bot) and full branches now expose `past_seasons` + `title_season` so PublicProfileModal renders the title.

### Live evidence
- Log: `past_seasons backfill (bots): stamped 69 seeded bots with S1 title`.
- API: 69/69 seeded bots have `title_season = 1` and a past-seasons entry at their target tier.
- UI screenshot: clicking Rampage_Arc831 (#1 on leaderboard) opens the PublicProfileModal with the banner reading **"S1 · GOONMASTER"** across the top. Same for every other top-100 bot.
- All 18 title + climb + seed tests still passing.


## 2026-07-01 — Quick Play Queue Now Shows Est. Wait

Casual/Quick Play queue now displays an estimated wait time on the toast, matching the ranked queue's ETA UX.

### Backend (`server.py`)
- **POST `/queue/casual`** — samples `estimated_wait_seconds` from `random.uniform(3.0, 12.0)`, stamps it onto the queue entry, and returns it.
- **GET `/queue/casual`** — reads the same stamped value off the entry so multiple polls return a consistent number (no client-side flicker).

### Frontend
- **`QueueContext.jsx`** — new `casualLockedEtaRef` mirroring the ranked ETA lock. Captured on `joinCasual`, preserved across polls, cleared on match/leave.
- **`Lobby.jsx` quick-queue toast** — new `"Est. wait ~Xs"` pill rendered below the `CASUAL · FFA` badge (only when not yet matched and the ETA is finite). `data-testid="quick-queue-eta"`.

### Tests (all passing)
- New `tests/test_casual_queue_eta.py` (3 cases): POST returns int in [3, 12]; GET reads the same value across polls; DELETE clears the entry.
- All 8 casual queue tests still pass.

### Live evidence
Screenshot of Player1 clicking Quick Match: toast displays
- Header: "SEARCHING FOR PLAYERS"
- Timer: `1` (counting up)
- Pills: `CASUAL · FFA` + `EST. WAIT ~8s`
- LEAVE QUEUE button


## 2026-07-01 — Snowy Lobby Background (Admin Preview)

Winter-themed lobby backdrop gated behind `user.role === "admin"` for now (per user request "only on admin account for now" while we validate the look).

### New component
`/app/frontend/src/components/LobbyBackgroundSnow.jsx` — mirrors the structure of `LobbyBackgroundMeteor.jsx`:
- **Sky**: steel-blue overhead → milky white low horizon.
- **Aurora glow**: soft cyan pulsing halo along the top.
- **Halftone**: cool-blue dots at 55% opacity, slow drift.
- **Snowflakes**: 23 flakes across 3 parallax layers (small/slow/dim back → big/fast/bright front). Pure CSS radial-gradient dots + diagonal-drift `translate3d + rotate` animation. Different sizes and opacity per layer for depth.
- **Frost blobs**: cyan / ice / white palette with breathing animation.
- **Comic words**: `FROST!`, `CHILL!`, `BLIZZARD!`, `ICE!`, `FLURRY!` — cyan/gold/red mix, wobble in place.
- **Horizon shimmer**: subtle horizontal sweep along the ground line, ~14s cycle.
- `animated={false}` fallback: sky + one halftone + one blob (calm subset for prefers-reduced-motion / battery saver).

### CSS
Appended a `lobby-snow-*` block to `/app/frontend/src/index.css` (~120 lines) with all keyframes + palette. `prefers-reduced-motion: reduce` disables every animation.

### Integration in Lobby.jsx
- New gate: `const showSnowBg = user?.role === "admin"`.
- Renders BEFORE the meteor/default gates so admin overrides both.
- Marker: `data-testid="lobby-bg-snow"` for testing.
- Music variant still uses the meteor loop (admin already got that gate); dedicated "snow" music is a follow-up if we ship this to all players.

### Verified
- Admin account lands on the lobby → sky is icy blue, `FROST! · FLURRY! · BLIZZARD!` visible, snowflakes falling diagonally across the arena.
- Data-testid confirms `lobby-bg-snow` is active for admin.
- Non-admin players fall back to meteor (Season 2) or default (Season 1) — unchanged.


## 2026-07-01 — Snow Music Remix + Season 3 Gate + Choosable BG Picker

Three related upgrades to the lobby background system.

### 1. Snow music variant — a chime remix of the DEFAULT loop
`audio.js::startLobbyMusic("snow")` uses the same Am-F-C-G-Am-F-G-E progression as Season 1 (NOT the meteor variant) so it feels like a wintered version of the original theme. New layers added on top:

- **BPM 76** (down from 84) — winter stillness.
- **Bell arpeggios** (`playSnowBells`) — every bar, 4 triangle+sine bell notes arpeggiate the current chord two octaves above the pad root. Beat pattern `1 · 2.5 · 3 · 4.5` (subtle syncopation).
- **Phrase-reset shimmer** — bar 0 of every 4-bar phrase adds a high 12th sparkle note.
- **Sleigh-bell ticks** (`playSnowTick`) — filtered-noise HP@4.5kHz on 16th positions 2/6/10/14. Reads as distant sleigh bells.
- **Wind pad** (`playSnowWind`) — bandpass-filtered noise (600→1400→400 Hz sweep) every 2 bars. Sits at 0.09 gain — felt more than heard.
- Same pad/bass/drums as default so the base track is instantly recognisable.

### 2. Season 3 gates snow for everyone
`Lobby.jsx` computes `autoVariant` from `seasonNumber`:
- Season 1 → `default`
- Season 2 → `meteor`
- **Season 3+ → `snow`**

When the current season doc rolls to 3, every player automatically gets the snowy backdrop + the chime music remix. No client change or setting toggle required.

### 3. Choosable past-season backgrounds
New setting `lobbyBackgroundVariant` (default `"auto"`) with four values:
- `auto` — always available, tracks current season.
- `default` (Season 1)
- `meteor` (Season 2)
- `snow` (Season 3)

**Unlock rules** (`canUseVariant` in Lobby.jsx):
- `auto` — always.
- Explicit variant — unlocked when the user has `season` in their `past_seasons[]` OR the current season is at/past the variant's requirement.
- Admins bypass everything (all four options unlocked in the picker).

**Picker UI** (`SettingsModal.jsx::LobbyVariantPicker`):
- Grid of 4 tiles inside the Video section, right under "Animated Lobby Background".
- Locked variants render dimmed with a padlock (`🔒`) and are non-clickable.
- Active tile has a gold ring, matches the frame-gen picker styling for consistency.
- data-testids: `settings-lobby-variant-picker`, `settings-lobby-variant-{auto|default|meteor|snow}`.

### Verified
- Admin logs in → picker shows all 4 tiles unlocked (screenshot confirms Season 1/2/3 all clickable).
- Setting `lobbyBackgroundVariant = "snow"` → lobby renders the snow BG, `lobby-bg-snow` data-testid present, snowflakes fall diagonally, cyan `FROST!/BLIZZARD!` + gold `FLURRY!` tags visible.
- Music variant now routes through `effectiveVariant` — hot-swaps loops on setting change.



---

### Iteration 12 — **THIS SESSION (2026-02-25, fork)**
- ✅ **Ranked queue-toast flicker FIXED (verified end-to-end)** — Root-cause was a 1200ms window between the 3-2-1 countdown finishing and the `nav("/play")` firing, during which `setQueueState(null)` had already torn the toast off. If the 3s background poll fired inside that window (or the `/queue/ranked/ack` POST raced it), it re-invoked `beginActivePoll` and the toast "reappeared" moments after fading. Two targeted client-side fixes in `/app/frontend/src/context/QueueContext.jsx`:
  1. `cancelGuardUntilRef.current = Date.now() + 15000` set the instant `matched:true` is received — blocks the bg poll from re-invoking `beginActivePoll` for the entire countdown + nav-delay window.
  2. `setQueueState(null)`, `setMatchFoundSec(null)`, and related teardown moved INSIDE the 1200ms `setTimeout` (was firing immediately after countdown). Now the "Match Found!" overlay stays visibly mounted continuously until the browser actually navigates to `/play`; `QueueOverlay`'s own `location.pathname.startsWith("/play")` guard hides it after nav.
- ✅ **Verified by testing agent (iteration_12)**:
  - Backend: 11/11 queue endpoint tests pass.
  - Frontend Playwright w/ 100ms DOM sampling: 42 consecutive events captured across the ~4.2s match-found → /play window — **zero hidden-toast events, zero flicker**.
  - Ranked cancel: toast tears down and does NOT ghost-reappear over a 15s watch.
  - Casual cancel: 120 post-cancel samples over 12s → 0 reappearance.
- New regression test file: `/app/backend/tests/test_queue_endpoints_regression.py`.


---

### Iteration 13 — **THIS SESSION (2026-02-25, fork, continued)**
- ✅ **Casual (Quick Match) queue toast disappearing FIXED** and **Match-loading overlay spamming over live gameplay FIXED** — mirrors the ranked fix plus a new critical piece: an in-flight join lock.

**Root causes** (three layers, all in `/app/frontend/src/context/QueueContext.jsx` + `/app/frontend/src/components/MatchLoadingScreen.jsx`):
1. Casual poll had **no miss tolerance** — a single transient `in_queue:false` blip immediately called `stopCasual()` and cleared state → toast disappeared.
2. **No in-flight lock on `joinCasual`** — rapid double-clicks (or clicks after a transient teardown) started overlapping `setInterval` polls. The second interval overwrote `casualPollRef.current` and **orphaned the first**, which then polled forever. When the orphan later saw `matched:true`, it dispatched a stray `virtue-match-loading` event **INTO live gameplay**, causing the loading overlay to reappear behind the running game.
3. **`MatchLoadingScreen` had no guard** against re-appearing during gameplay.

**Fixes:**
- `casualJoiningRef` — synchronous in-flight lock; second call returns `{ok:false, error:"Already queued"}`. Belt-and-braces: `stopCasual()` also called before creating the new interval, making orphans impossible.
- `casualMatchedRef` — one-shot flag set on `matched:true`. Any late/orphan tick with matched:true after this is a no-op.
- `casualMissesRef` — 10-tick miss tolerance (mirrors ranked). Toast survives ~10s of transient `in_queue:false` before tearing down.
- `casualCancelGuardUntilRef` slam to +15000ms on `matched:true` — blocks any stray poll from re-firing loading events during the 1.2s pre-nav window.
- Symmetric `rankedJoiningRef` added to `joinRanked` — same class of bug was possible on ranked, now closed.
- `MatchLoadingScreen`: new `consumedRef` latch, set once loading→(confirmed OR safety-idle)→idle cycle completes. While `location.pathname.startsWith('/play')` AND `consumedRef.current` is true, further `virtue-match-loading` events are DROPPED. Latch resets when the user leaves `/play` (500ms location poll + popstate).
- Safety-dismiss window extended `6000ms → 8000ms` for more reliable welcome-arrival before fallback.

**Verified by testing agent (iteration_13):**
- Backend 11/11 queue endpoint tests pass (incl. new idempotent-rejoin test).
- Frontend Playwright with CustomEvent spy + 100ms DOM sampler, 7/7 scenarios pass:
  - Casual toast stable during ~11s bot-fill (59/60 samples visible).
  - Casual **rapid 3× click within 299ms → exactly ONE `virtue-match-loading` event**.
  - After nav to /play, `match-loading-screen` phase transitions cleanly through loading → confirmed → idle. **NO resurrection** from idle back to loading (this is the "spam" bug).
  - LEAVE QUEUE tears down toast with 0 ghost re-appearance over 15s (75/75 samples clear).
  - Ranked rapid double-click still fires exactly ONE loading event.
  - Ranked end-to-end still passes (no regression from new `rankedJoiningRef` lock).


---

### Iteration 14 — **THIS SESSION (2026-02-25, fork, continued)**
- ✅ **Custom TDM match-end screen shipped** — MatchResultOverlay now renders team-based **TEAM VICTORY! / TEAM DEFEAT / STALEMATE** for TDM instead of the old "1st place = winner" FFA logic that misclassified TDM outcomes.

**Backend contract (in `/app/backend/server.py` `end_match` around line 4909):**
The `match_end` WS payload now includes for TDM:
- `game_mode: "tdm"` (FFA sets `"ffa"`)
- `team_scores: {red: int, blue: int}`
- `winning_team: "red" | "blue" | null` (null = draw)
- each `placements[i]` gets a `team` field ("red"/"blue"/null)

FFA payloads remain unchanged — they set `game_mode: "ffa"` and omit `team_scores`, `winning_team`, and per-row `team`.

**Frontend (in `/app/frontend/src/components/MatchResultOverlay.jsx`):**
- Outcome is derived from `myTeam === winningTeam` (VICTORY) / `winningTeam === null` (STALEMATE) / else DEFEAT for TDM; FFA still uses `myPlacement === 1`.
- New palettes: gold for **TEAM VICTORY!** (Users icon), red for **TEAM DEFEAT** (Users icon), silver/blue for **STALEMATE** (Handshake icon).
- New scoreboard band `data-testid="match-result-tdm-scoreboard"` shows `RED N — M BLUE` with the winning team side outlined in gold + a "WIN" badge.
- Per-row team-color chip `match-end-team-tag-{i}` beside each player's name in the placement table.
- Mode chip suffixed with `· TDM` when applicable (e.g. `RANKED · TDM`, `QUICK MATCH · TDM`).
- Defensive fallback: if the local player isn't in placements (youId race on match_end), TDM renders STALEMATE instead of misclassifying as DEFEAT.

**Verified by testing agent (iteration_14, 100% pass):**
- Backend: 6/6 in `/app/backend/tests/test_tdm_match_end_payload.py` (RED win, BLUE win, DRAW, FFA regression, bot-without-team, and a code-drift assertion on server.py).
- Frontend Playwright synthetic payload injection via `window.__virtue_sock.onMessage`: 5/5 scenarios pass (TDM VICTORY / DEFEAT / DRAW, FFA VICTORY 1st, FFA DEFEAT 2nd). All expected data attributes, headline text, WIN badge presence, icons, and team chips correctly rendered.
- Existing tests: 30/30 TDM + queue tests still pass (no regression).

---

### 2026-02-08 — TDM upgraded to 4v4
- **Change**: `TDM_TEAM_SIZE` bumped from `3` → `4` in `/app/backend/server.py`. Every TDM room (quick-match, practice, offline-vs-AI) now targets **8 combat players (4v4)** instead of 6 (3v3).
- **Auto-balance**: `_maintain_population()` still uses `TDM_TEAM_SIZE * 2` so pre-fill bots + real-player swap logic all scale automatically. Offline TDM room now spawns `TDM_TEAM_SIZE * 2 - 1 = 7` disguised bots so the user drops in as the 8th player.
- **Labels updated** across `Hud.jsx`, `PracticeMapSelector.jsx`, `MatchLoadingScreen.jsx`, `Profile.jsx` — anywhere the UI displayed "3V3" now reads "4V4".
- **Tests updated**: `test_tdm_mode.py` (constant check), `test_tdm_auto_balance.py` (num_bots=8, expected combat counts=8, comments), `test_match_history_tdm.py` (docstring). All 22 TDM tests pass.

---

### 2026-02-08 — Sniper gets its own viewmodel + booming shot SFX
- **Distinct sniper viewmodel** (`/app/frontend/src/game/engine.js` `_buildWeapon`):
  A separate `_sniperModel` group is built alongside the AK — sleek tactical stock, extended barrel, chunky suppressor-style muzzle, cheek riser, bolt handle sticking out the right side, big cylindrical scope with blue-tinted lens, elevation + windage turrets, bipod legs, and its own muzzle flash sprite `_sniperMuzzleFlash`.
  Only one of the two primary models is visible at a time — `_applyPrimarySelection()` toggles visibility + swaps the `_muzzleFlash` reference whenever `primaryWeaponId` changes (state broadcast, initial seeding, or slot swap via `setWeapon`).
- **Loud dedicated sniper SFX** (`/app/frontend/src/game/audio.js` `_sniperShot`):
  Booming 4-layer bolt-action report — deep 90 → 30 Hz sine thump (1.6x gain), high-freq bandpassed CRACK burst, mid-body lowpass "boom", and two echo tails at 180ms + 420ms. Roughly 1.6x hotter than the AK, distinctly cinematic. `gunshot()` now routes `weapon === "sniper"` to `_sniperShot()`.
- **LocalSim parity**: `WEAPONS` map gained a `sniper` entry (100 dmg, 900ms cooldown, 1-shot mag, 120m range). `LocalPlayer` now inits `weapon` from the user's `primary_weapon`; respawn resets and ammo dicts include sniper. Practice/Offline sniper users now see the sniper viewmodel + hear the sniper report locally.
- **Game.jsx seeding fix**: After `engine.primaryWeaponId = user.primary_weapon`, we now call `engine._applyPrimarySelection()` so the correct viewmodel is on-screen before the first state broadcast lands.


---

### 2026-02-24 — Hotel map now selectable in Practice Mode (P0 bug fix)
- **Bug**: User reported "I can't select the map in practice mode" (specifically the newly added GRAND HOTEL). The `PracticeMapSelector` rendered the hotel card correctly, but clicking it silently fell back to a random map.
- **Root cause**: `/app/frontend/src/game/localSim.js` had its own hardcoded `MAPS` array (`MAP_A`…`MAP_E`) that did **not** include `hotel`. When the selector called `_pickMap("hotel")`, the `find(...)` returned undefined and the code fell through to `MAPS[Math.floor(Math.random() * MAPS.length)]`.
- **Fix**:
  1. Added `MAP_F` (map_id `"hotel"`) to `localSim.js`, mirroring the ground-floor obstacles + second-story mezzanine (`y_base`) obstacles + spawn points from server `MAP_F` in `/app/backend/server.py`.
  2. Included `MAP_F` in the `MAPS` array.
  3. Patched `collidesAABB()` and `segBlockedByObstacles()` to skip obstacles with `y_base > 0` (mezzanine/ceiling geometry) so floating second-story cover doesn't block ground-floor bots/players or LOS — matches server's collision behavior at `server.py` L3106-3108.
- **Verification** (`testing_agent` → `/app/test_reports/iteration_18.json`):
  - Hotel card renders in the selector (`practice-map-card-hotel`).
  - Practice + hotel → `/play?mode=practice&map=hotel` loads the arena, no runtime errors.
  - Offline vs AI + hotel → `/play?mode=offline&map=hotel` loads the arena, no runtime errors.
  - Non-hotel maps (random) still load correctly (no regression).
  - Frontend success rate: **100%**. No UI bugs, no integration issues.

---

### 2026-02-24 — Hotel map converted to fully indoor arena
- **User request**: "make the hotel map completely inside and remove the building and make them building supports and and tables and make it so you can go in the middle"
- **Changes** (mirrored across server MAP_F, `mapsMeta.js MAP_HOTEL`, and `localSim.js MAP_F`):
  - **Removed** `_PERIMETER_BUILDINGS` (outdoor exterior buildings at ±42/±38).
  - **Removed** the center lobby fountain at (0, 0) so the middle of the arena is now a wide open atrium — players can push straight through.
  - **Added** solid indoor perimeter walls at ±48 (thick, h=8) that fully seal the arena as an interior space.
  - **Added** 12 structural support columns around the perimeter (corners + mid-wall + cardinal directions) — these visually replace the exterior buildings as "load-bearing supports" for the hotel structure.
  - **Added** 8 lobby tables (waist-high 1.4×0.9×1.4 blocks) scattered as crouch cover.
  - **Extended** the ceiling coffer from 60×60 to 100×100 so the ceiling covers the entire arena footprint (no sky visible from any interior angle).
- **Engine visuals** (`/app/frontend/src/game/engine.js`):
  - New `_cityDecoGroup` (Three.js Group) initialised in `_buildArena` collects **all** outdoor city dressing: roads, driveways with curb stripes, dashed lane lines, fire hydrants, trees, foliage, lampposts, park benches, POW/BAM spawn decals, VIRTUE sign, central statue + plinth. Every previous `this.scene.add(...)` for these items now routes through `_cityDecoGroup.add(...)`.
  - In `_rebuildArenaFromServer`, `_cityDecoGroup.visible = (arena.map_id !== "hotel")` — hides all outdoor dressing when the map is hotel and restores it for every other (outdoor) map.
- **Tests**: Updated `test_hotel_map.py::test_ground_collision_ignores_floating_obstacles` — center (0,0) must now be walkable (no fountain). All 4 hotel + 3 spawn tests pass (7/7).
- **Verification** (`testing_agent` → `/app/test_reports/iteration_19.json`):
  - Practice + hotel → indoor arena renders (marble floor, walls, columns, no roads/trees/hydrants/decals).
  - Offline vs AI + hotel → indoor arena renders.
  - Practice + downtown (regression) → outdoor city still fully visible (roads, buildings, sign).
  - Frontend success: 100%. No regressions.


---

### 2026-02-24 — Hotel movement bug fixed + interior wallpaper look
- **User reported**: "you cant move on the hotel map and make the outer walls look like the walls inside a building"
- **Bug 1 — Movement frozen (P0)**:
  - **Root cause**: `engine.js._collides()` iterated ALL obstacles including floating ones. The new hotel ceiling (100×100 at `y_base=14`) had an XZ AABB covering the *entire* arena, so any position `(x, z)` on the map was inside the ceiling's XZ bounds → player always "collided" → couldn't move an inch after spawn.
  - **Fix**: Added `if ((ob.y_base || 0) > 0) continue;` to `_collides()`, matching the same skip already present in server `collides_obstacle` and localSim `collidesAABB`.
- **Bug 2 — Walls looked exterior (visual)**:
  - Added `_makeHotelWallTexture(ob)` — procedural canvas texture with warm cream wallpaper base, faint vertical stripes, burgundy damask diamond motif, dark walnut wainscoting along the bottom third, brass chair-rail moulding, brass cornice at the top, and a comic-book black border. Repeats horizontally for long walls.
  - In `_buildBuilding`, when `_currentMapId === "hotel"`, tall obstacles (h≥2.5, y_base=0) now use `_makeHotelWallTexture` instead of `_makeBuildingFaceTexture`, and get a brass "crown" cap instead of a dark asphalt roof cap. Additive blending disabled for hotel walls so wallpaper doesn't wash out.
- **Verification** (`testing_agent` → `/app/test_reports/iteration_20.json`):
  - Movement confirmed: player took AI damage (HP 100→56) after W/A/S/D — impossible if still under spawn protection.
  - Interior wallpaper visuals confirmed present on hotel; no exterior window facades on hotel walls.
  - Downtown regression clean: movement works and buildings still show their lit-window facades.
- **Known minor cosmetic (not reported, non-blocker)**: The 100×100 ceiling sits at y=14 while perimeter walls are h=8, so a strip of sky is visible between wall tops and the ceiling from some angles. Fix would be raising perimeter walls to h=14. Deferred as a polish item.


---

### 2026-02-24 — Castle lobby backdrop + reverted to original lobby music
- **User request**: "change the lobby background to a castle theme and go back to original lobby music"
- **New `LobbyBackgroundCastle` component** (`/app/frontend/src/components/LobbyBackgroundCastle.jsx`) — Royal Guard themed:
  - Deep indigo → violet night-sky gradient with a slow torchlight pulse.
  - 22 hand-placed twinkling stars (mix of small + big) across the top third.
  - Pale gold moon disc + warm halo on the upper right.
  - Two parallax layers of castle silhouette (back = distant towers via layered radial gradients; front = inline SVG with proper crenellated battlements, arrow-slit windows glowing warm gold, and a central gate with a gold-lit arch).
  - Two burgundy pennant banners flanking the gate, swaying on a 4.2s ease loop.
  - Four flickering torch flames (radial gradient halos, 0.6s flicker keyframes).
  - Floating comic words: "HONOR!" / "GUARD!" / "VALOR!" / "REIGN!" / "KNIGHTS!".
  - Low ground fog blobs (purple / gold / burgundy).
  - Respects `prefers-reduced-motion` — calm subset renders sky + moon + silhouette only.
- **All CSS** appended to `/app/frontend/src/index.css` under a `lobby-castle-*` prefix so it doesn't collide with `lobby-meteor-*` / `lobby-snow-*` themes.
- **Lobby.jsx routing** — `autoVariant` now always resolves to `"default"` (no more season-based auto-swap to meteor/snow). The `default` branch in the JSX renders `LobbyBackgroundCastle`. Meteor/snow variants remain selectable via the settings picker for players who explicitly want them.
- **Music revert** — `startLobbyMusic` is now pinned to `"default"` (Season 1's `Am-F-C-G-Am-F-G-E` loop) regardless of variant picker or season. The meteor + snow remixes still exist in `audio.js` for future re-enablement.
- **Verified** via smoke screenshot: `data-testid="lobby-bg-castle"` is present, `lobby-bg-snow` absent; castle silhouette + moon + banners + torches all rendered correctly. Music change is a single-line variant swap (no runtime risk).


---

### 2026-02-24 — Castle lobby polish
- **User request**: "remove the season 3 lobby from setting; on the knight background remove the text and make lights flicker in the castles"
- **Season 3 (snow) removed from settings**:
  - `SettingsModal.jsx` `LobbyVariantPicker` — dropped the `snow` entry. Picker now shows `Auto`, `Season 1`, `Season 2` only.
  - `Lobby.jsx` `canUseVariant` — returns `false` for `"snow"` so any legacy localStorage value falls through to auto (castle). Prevents stale winter backdrops from resurfacing.
- **Removed floating text** from castle backdrop: deleted the "HONOR!/GUARD!/VALOR!/REIGN!/KNIGHTS!" comic-word cluster.
- **Flickering window lights** — new `.lobby-castle-window` CSS class with a warm-gold radial-gradient dot + per-instance `animationDelay` / `animationDuration` staggering. 7 windows placed over the arrow-slit + gate positions in the silhouette SVG. Each pulses on its own timer via a `lobby-castle-window-flicker` keyframe (steps(4) timing gives a proper candle-flicker feel; the gate window uses a smoother ease-in-out for a welcoming "lantern" glow).
- **Verified** via smoke screenshot: `lobby-bg-word count = 0`, `flicker windows = 7`, picker options = `['Auto','Season 1','Season 2']`. Castle silhouette shows warm flicker dots dancing on the towers + gate.


---

### 2026-02-24 — Post-deploy bug batch: sniper mag, shoot-through, knight skin
- **User report** (both preview + production): (1) some short objects on Royal Guard block bullets even though the eye passes over the top, (2) add a detailed classic-knight skin to the shop, (3) sniper "almost always" fires only 1 bullet before reloading instead of 2.

**Fix 1 — Sniper 1-bullet auto-reload bug (P0)**
- Two stale `mag_size = 1` references in `engine.js`:
  - `this.localAmmo = { ak47: 25, sniper: 1, laser: 60 }` → now `sniper: 2`. Before the first server state broadcast arrives (~50-200ms), the client's stale local counter was firing an auto-reload after the very first shot.
  - Reload-complete magSize (`reloadedWeapon === "sniper" ? 1 : ...`) → now `? 2 : ...`.
- Also removed a stale duplicate `this.localAmmo` initializer and cleaned up an outdated comment.
- Updated `tests/test_sniper_weapon.py` to lock in the current spec (mag=2, damage=50, ads_only=False, 2.0x headshot).

**Fix 2 — Shoot-through short cover on Royal Guard (P0)**
- **Server** (`_has_los`): rewritten from a 2D "obstacles are full-height walls" shadow check into a proper 3D check that samples the ray's Y elevation at each step and only blocks when the ray's Y is inside the obstacle's `[y_base, y_base + h]` slab.
- **Server** (`raycast_hit`'s `aabb_t`): now uses `y0 = ob.get("y_base", 0)` for the min-Y and `y0 + ob["h"]` for the max-Y, so floating obstacles (mezzanine walkways, 100×100 ceiling) no longer get placed at ground level and block eye-height shots.
- **Client** (`engine.js` `_laserCastEnd`, `_forwardObstacleDistance`): same y_base fix so the client's viewmodel retraction + laser cast agree with the server.
- **LocalSim**: new `segBlockedByObstacles3D()` helper; `_handleShoot` now uses it instead of the 2D `segBlockedByObstacles`, so practice + offline bots can also shoot over tables/lounge seats/reception desks.

**Fix 3 — New legendary knight skin (feature)**
- **Backend catalog**: `SKINS_CATALOG` gains `id: "knight"`, name `"Silver Sentinel"`, price 5000, rarity legendary, obtain "shop". Palette: silver `#C8CBD1` armor, royal-red `#B80020` accents, brass-gold `#E6C74A` trim, dark visor.
- **Client render hook** (`_buildHumanoid`, `if (skin.id === "knight")`): adds a full detailed set — great-helm dome + pointed cap + horizontal eye slit + tall red plume + brass plume-base collar + two rounded pauldrons + cylindrical gorget collar + chest brass cross emblem + wide brass belt buckle + kite shield on the back (extruded shield shape with silver rim + gold cross bars) + two brass vambraces on the forearms.

**Verification** (`testing_agent` → `/app/test_reports/iteration_21.json`):
- **Backend**: 27/27 tests pass in the scoped suite. New regression tests added: `tests/test_royal_guard_shoot_through.py` (3 tests — over-table LOS, ceiling non-blocking, tall column still blocks) and `tests/test_knight_shop_skin.py` (2 tests — catalog + buy flow).
- **Frontend Playwright**: Admin login → shop → `shop-skin-knight` card at 5000 coins legendary → BUY → auto-equip → practice + hotel → sniper HUD reads 2/2 → 1st shot → 1/2 (no premature reload) → 2nd shot → 0/2 → auto-reload → back to 2/2. All flows pass.

**Design notes surfaced (not part of fix scope, tracked for future)**:
- Sniper ADS scope view is a solid olive-green blur — could be cleaner. Deferred.
- Shop buy endpoint path is `/api/shop/buy` (single-tier), not `/api/shop/skins/buy`. Doc drift only.


---

### 2026-02-24 — Laptop freeze on 2nd player (WebGL context loss)
- **User report** (both Preview + Production): "When 2 players are in the same server the laptop person's screen is frozen but you can still hear and the desktop version is normal."
- **Root cause**: Classic WebGL context loss on integrated-GPU laptops. When a second player's humanoid + skin meshes (especially the new Silver Sentinel with 10+ extras) push VRAM past the integrated GPU's budget, the browser silently kills the WebGL context. The JS thread + Web Audio API + WebSocket keep running (that's why audio + game logic still worked), but the canvas stops rendering forever. The engine had no `webglcontextlost` handler so the failure was permanent.
- **Fix**:
  1. `THREE.WebGLRenderer` constructed with `powerPreference: "high-performance"` and `failIfMajorPerformanceCaveat: false` — asks the browser to bind the *discrete* GPU on hybrid laptops instead of the integrated one, preventing the context loss in most cases.
  2. `webglcontextlost` listener on the canvas — calls `ev.preventDefault()` (asks the browser to attempt restoration), sets `this._contextLost=true`, dispatches an `onLocalUpdate({type:'webgl-context-lost'})` local event.
  3. `webglcontextrestored` listener — clears the flag + emits `webgl-context-restored`.
  4. `_loop` render guard — skips `_update()` + `renderer.render()` when the context is lost, just reschedules the next frame.
  5. **Game.jsx overlay + auto-recover**: on `webgl-context-lost`, sets `hud.glLost=Date.now()` (renders a full-screen black overlay with a spinning ring + "GRAPHICS HICCUP — Reloading to recover…" — testid `webgl-recover-overlay`) and schedules `window.location.reload()` after 2.2s. Full page reload chosen over programmatic recovery because Three.js buffers/textures don't reliably re-upload on restore.
- **Verification** (`testing_agent` → `/app/test_reports/iteration_22.json`):
  - Playwright triggered `WEBGL_lose_context.loseContext()` in a live match → overlay appeared within 2.5s → page reloaded within 2.2s → canvas re-initialised cleanly → overlay gone.
  - Regression: healthy practice → offline vs AI still loads with zero overlay instances.
  - Success rate: 100% (7/7 verifications). No new backend or frontend issues.


---

### 2026-02-24 — Remote player shooting animation + smooth movement interpolation
- **User request**: "make it so you can see other players shooting animations and smoothen the player animations for the other players"
- **Remote shooting animation** (visible on ALL non-local shooters — humans + bots):
  - `_buildHumanoid` now attaches a `remoteMuzzleFlash` mesh to the `heldGun` group — small warm-yellow sphere (color `0xffe488`, additive blending, opacity 0 by default) positioned at the barrel tip. Returns `heldGun` + `remoteMuzzleFlash` alongside the other rig handles.
  - `_addRemotePlayer` stores both on the entry + initialises `shootT: 0`.
  - `shot` event handler (non-local shooter branch): sets `shooter.shootT = 120` ms + `remoteMuzzleFlash.material.opacity = 1` + randomises scale between 0.7 and 1.3 so full-auto flickers naturally instead of showing a static neon dot.
  - Per-frame decay: `shootT -= dt*1000`, `muzzleFlash.opacity -= dt*12` (flash gone in ~85ms so each bullet flashes independently).
  - Additive arm recoil applied **after** the walk/idle cycle (`rightArm.rotation.x += -0.55 * recoilU`, `.z += 0.18 * recoilU`) so it layers on top of the pose. Torso.rotation.z assigned (`= -0.08 * recoilU`) since the walk cycle doesn't touch that axis. Skipped during death animation.
- **Smooth movement**:
  - State-update handler previously called `mesh.position.lerp(target, 0.5)` per server tick (~20Hz) → visible stairstep at 60/120/144fps. Now writes `entry.targetX/Y/Z/targetYaw` to the entry only.
  - Per-frame loop lerps position + yaw toward the targets with `smooth = 1 - exp(-15 * dt)` (dt-based exponential ease). Identical feel at any FPS — closes ~63% of the distance in one server tick (~66ms) which reads as snappy-but-smooth.
  - Yaw uses shortest-arc lerp (unwrap ±π) so a wrap doesn't spin the model the long way round.
- **Verification** (`testing_agent` → `/app/test_reports/iteration_23.json`):
  - 11/11 checkpoints pass. Playwright inspected `window.__virtueEngine.players` live, injected the shot code path, and observed the correct arm rotation + muzzle flash decay in one rAF.
  - Movement smoothing confirmed by sampling bot positions at 100ms cadence: 85/144 distinct positions per bot over 15s indicates per-frame interpolation, not 20Hz stairstep.
  - No console errors; local HUD unaffected.
- **Design/refactor notes surfaced by testing agent (deferred)**:
  - `engine.js` is now 6006 lines — a `RemotePlayerAnimator` extraction (position smoothing, shootT ticking, muzzle-flash decay, death anim) would be a natural first split when we do the P1 refactor.


---

### 2026-02-24 — Leave-loop fix + jump broadcast to remote players
- **User reports**: (1) "game doesnt let you leave keeps putting you back in", (2) "make it so you can see when others jump".

**Bug 1 — Leave-loop RCA + fix**
- Root cause: `/lobby` `QueueContext` runs a 3s background poll of `/queue/{ranked,casual}/status`. When the user pressed EXIT during a match, the WS closed but the server's on-disconnect cleanup didn't touch `MATCHED_USERS`. During the 5-10s window before the on-disconnect handler ran, the bg poll saw `matched: true` from server state and called `beginActivePoll()` → `goToMatch()` → `nav('/play')` — yanking the user back into the just-abandoned match.
- Three-layer fix:
  1. **Client `handleExit`** (`Game.jsx`): now calls `queueCtx?.cancelRanked?.()` + `queueCtx?.cancelCasual?.()` before `nav('/lobby')`. These set the client `cancelGuardUntilRef = Date.now() + 10000` (blocks bg poll match-triggers for 10s) AND hit `DELETE /queue/{ranked,casual}` which clears MATCHED_USERS server-side.
  2. **Server `ws_game` finally block**: pops `MATCHED_USERS[u_id_str]` on any WS disconnect (belt-and-suspenders for crashes / tab-closes / network drops).
- Verified end-to-end: 10-second URL watch after EXIT stays at `/lobby` — no bounce.

**Feature 2 — Jump broadcast**
- Added `self._jump_start_ms: int = 0` to `Player.__init__` (default = grounded).
- New WS message handler for `mtype == "jump"`: rejects when dead or already airborne (elapsed < 650ms), otherwise sets `player._jump_start_ms = now_ms`.
- `Player.to_state()` applies the sin arc for HUMAN players (bots update y directly in `_tick_bots`): `y = PLAYER_HEIGHT + sin((elapsed/650) * π) * 1.2` for elapsed < 650ms, snap back to PLAYER_HEIGHT + reset `_jump_start_ms=0` afterwards. Same 650ms + 1.2m-peak arc as ranked smart bots for visual consistency.
- Client engine already emitted `onLocalUpdate({type: 'jump'})` on Space keybind. `Game.jsx` now forwards it as `sockRef.current?.send({type: 'jump'})`.
- Client-side smoothing added in iteration_23 (`entry.targetY` interpolation with `smooth = 1 - exp(-15 * dt)`) already renders the arc smoothly on remote humanoids at any FPS.

- **Verification** (`testing_agent` → `/app/test_reports/iteration_24.json`):
  - Backend: 7/7 in the new `tests/test_jump_broadcast.py` (fresh player _jump_start_ms=0, arc math, snap-back after 650ms, bots exempt, static asserts on MATCHED_USERS cleanup + jump handler). Regression: 12/12 in sniper+hotel+royal_guard suite, 12/12 in queue endpoints.
  - Frontend Playwright: login → practice → offline vs AI → pause → LEAVE MATCH → URL stays `/lobby` for the full 10s watch. Space keybind → confirmed `sockRef.current.send({type:'jump'})` fires.
  - No console errors. Local HUD unaffected.

**Design notes surfaced by testing agent (deferred)**:
- `server.py` is now 9142 lines — well over the 700-line guideline. Ideal split: rooms / tick loop / websocket routes / auth / queue.
- `Player(user={})` construction requires `user['email']` — use `.get('email','user')` for easier unit testing.
- `queue_endpoints_regression.py` needs the `REACT_APP_BACKEND_URL` env var; a conftest fixture or clearer error would help future contributors.


---

### 2026-02-24 — Performance-scaled ranked RP (non-placement matches)
- **User request**: "add performance based gains and losses to ranked up to 35 points a win and 60 for a bad loss. ex kda 27/3 they should gain the full 35. ex kda 3/9 they should lose 60"
- **Formula** (server.py `_end_match` non-placement `else` branch, line ~5519-5541):
  - `base_delta = compute_rp_delta(placement, tier_idx)` — unchanged podium curve.
  - `perf_delta = p.kills * 3 - p.deaths * 5`
  - `delta = max(-60, min(35, base_delta + perf_delta))`
- **Anchor cases** (locked in `/app/backend/tests/test_ranked_perf_rp.py`):
  - `27 K / 3 D + 1st`: base +30, perf +66, sum +96 → clamped to **+35** ✓
  - `3 K / 9 D + 4th`: base -30, perf -36, sum -66 → clamped to **-60** ✓
  - `15 K / 5 D + 1st`: sum +50 → clamped to +35 (solid carry still capped)
  - `0 K / 20 D + 4th` (Silver): base -30 + -100 → clamped to -60
  - `0 K / 20 D + 4th` (Masters+): base -60 + -100 → clamped to -60 (Masters+ can't lose more than max)
  - `10 K / 10 D + 2nd`: +15 base + (-20 perf) = -5 (a balanced 2nd-place is a slight net loss now)
- **Placement matches UNCHANGED**: they keep their +150 bonus / -200 penalty scaling and hard win/lose ±100 base. Only non-placement ranked matches get the new -60/+35 clamp.
- **Verification** (`testing_agent` → `/app/test_reports/iteration_25.json`):
  - Backend: 8/8 new anchor tests + 31/31 regression = **39/39 pass**.
  - No frontend changes needed — match-end overlay already renders whatever `delta` the server sends.


---

### 2026-02-24 — Ultimate Gooner tier (top-50 Goonmaster)
- **User request**: "make top 50 players in goonmaster rank get a new rank called Ultimate gooner. make that rank icon be a flame with the number they are on the leaderboard"
- **Backend** (`server.py`):
  - `TOP50_GOONER_IDS: Dict[str, int]` cache — user_id → 1..50 position.
  - `refresh_ultimate_gooner_cache()` — `db.users.find({rank_points: >=2100}).sort(-1).limit(50)` populates the cache. Failures preserve the previous cache. Indexed on rank_points at startup.
  - `_ultimate_gooner_refresh_loop()` — background task refreshes every 30s. Initial refresh runs at `on_startup`.
  - `public_user()` — attaches `leaderboard_rank` from the cache when the user_id is present (top-50). Absent otherwise so the client falls back to plain Goonmaster.
- **Frontend**:
  - `rankIcons.js` — new `isUltimateGooner(tier, leaderboardRank)` helper (true when tier===7 && rank in [1,50]). Updated `rankLabelFor(tier, division, name, leaderboardRank)` to return `'ULTIMATE GOONER'` for those users.
  - `UltimateGoonerBadge.jsx` — new component: a golden Flame (lucide-react) with a warm halo behind + the leaderboard number overlaid in the flame's belly (Bangers/Anton stack, gold text-shadow for prestige). Sized to match the rank pill.
  - `PlayerCard.jsx` — renders the badge next to an upgraded 'ULTIMATE GOONER' pill for top-50 Goonmasters. Non-top-50 Goonmasters see the standard 'GOONMASTER' pill (the old `#N` position pill is retired — only top-50 gets the highlight now).
- **Verification** (`testing_agent` → `/app/test_reports/iteration_26.json`):
  - Backend: 5/5 new unit tests + 31/31 regression = **36/36 pass**.
  - Live e2e: admin bumped to 2600 rank_points → `/api/auth/me` returned `rank_tier=7` + `leaderboard_rank=5` → PlayerCard header showed 'ULTIMATE GOONER' pill + golden flame badge with "5" inside. Restored → non-Goonmaster confirmed no badge.
  - Screenshot: `/app/test_reports/ultimate_gooner_lobby.png`.


---

### 2026-02-24 — Ultimate Gooner surfacing: leaderboard + profile + show-tiers
- **User request**: "make the leaderboard show the new rank; show the rank on player profile; update show tiers button"
- **Leaderboard** (`/app/frontend/src/pages/Leaderboard.jsx`):
  - Live top-100 rows (line ~305): tier-7 rows at position ≤ 50 render an `ULTIMATE GOONER` gold pill + `UltimateGoonerBadge` (flame + #N).
  - Archive rows (line ~450): same treatment.
  - "You are #N" banner (line ~170): current user pill upgrades to ULTIMATE GOONER when their `myIdx + 1 ≤ 50` and they're tier 7.
- **Profile** (`/app/frontend/src/pages/Profile.jsx`):
  - `RankCard` accepts `leaderboardRank`. When `isUltimateGooner(tier, leaderboardRank)` is true, the icon slot renders a large 54px `UltimateGoonerBadge` in place of the animated tier icon, the label reads "ULTIMATE GOONER", and a "#N GLOBAL" subtitle appears under the label.
  - Current Rank card gets `leaderboardRank={user?.leaderboard_rank ?? null}`. Peak Rank card intentionally left unchanged (peak is a historical high-water snapshot, not a live global position).
- **Public Profile Modal** (`/app/frontend/src/components/PublicProfileModal.jsx`):
  - `RankPill` upgraded to accept + render `leaderboardRank`, so kill-feed / friends-list / leaderboard-row profile clicks all show the ULTIMATE GOONER pill + flame badge consistently.
- **Show-Tiers modal** (`/app/frontend/src/pages/Lobby.jsx`):
  - New `tier-row-ultimate` row rendered below GOONMASTER — golden gradient background, Flame icon in burgundy fill, "TOP 50 GOONMASTERS" label with an "Icon shows your global rank #" subtitle. Marks the row as visually distinct from the RP-band tiers since it isn't itself an RP band.
  - RP-formula footer updated to reflect iteration_25's new performance-scaled system: base curve + `(kills × 3) − (deaths × 5)`, capped at **+35 max win / −60 max loss**. Old flat +30/-30 line replaced.
- **Verification** (`testing_agent` → `/app/test_reports/iteration_27.json`):
  - Backend: 32/32 pass (5 new + 27 regression).
  - Live e2e (admin bumped to 2600 RP): `/leaderboard` shows 50 ULTIMATE GOONER pills + flame badges, `/profile` Current Rank card shows the flame + "#5 GLOBAL" subtitle, `/lobby` Show Tiers modal contains the tier-row-ultimate row + updated formula footer.
  - Regression: player1@shooter.com (Bronze) shows zero ULTIMATE GOONER text + zero ultimate-badge elements anywhere.
  - Screenshots: `lb_ultimate.png`, `profile_ultimate.png`, `lobby_ultimate.png`.



### 2026-02-24 — Ultimate Gooner ranked TITLE + Lobby RANK pill
- **User request**: "make the ultimate gooner rank have a ranked title and also appear in the lobby as the rank"
- **Backend** (`/app/backend/server.py`):
  - Added `title_ultimate: bool` field to the user document + `public_user` DTO (defaults False).
  - Extended `TitleIn` Pydantic model with `ultimate: Optional[bool]`.
  - `POST /profile/me/title` now handles three mutually-exclusive branches:
    - `ultimate=True` → equip ULTIMATE GOONER title (403 unless `str(uid)` in `TOP50_GOONER_IDS`); clears `title_season`.
    - `ultimate=False` → clears just the flag, preserving any season pick.
    - `season=<n>` (or `season=None`) → sets/clears the season title AND clears `title_ultimate` (two titles are mutually exclusive).
- **Frontend** (`/app/frontend/src/game/bannerTitle.js`):
  - `formatBannerTitle` returns literal `"ULTIMATE GOONER"` when `user.title_ultimate === true` AND `user.leaderboard_rank ∈ [1,50]` (stale flag from a top-50 drop-out silently renders as no-title). Ultimate takes precedence over the season entry.
  - `bannerTitleTierIdx` returns 7 for equipped ultimate → picks up the goonmaster shimmer CSS class (`banner-title-anim-goonmaster`).
- **Lobby RankBadge** (`/app/frontend/src/pages/Lobby.jsx`):
  - `RankBadge` now accepts `leaderboardRank`. When qualifying, the pill switches to `#FFD700` background, flame icon (`lucide-react` `Flame`, dark stroke + burgundy fill), label reads `ULTIMATE GOONER` with a small `#N` tag beside it. Division roman numeral is suppressed.
  - Called with `leaderboardRank={user?.leaderboard_rank ?? null}` from the lobby hero row.
- **Profile TitlePicker** (`/app/frontend/src/pages/Profile.jsx`):
  - New special `ULTIMATE` tile — golden gradient background + flame corner icon — rendered above the season tiles when the user is currently top-50 (`canEquipUltimate`) OR still has it equipped (`ultimateEquipped`). Toggles via `POST /profile/me/title` with `{ultimate: true|false}`.
  - Picking a season tile clears any equipped ultimate via the backend contract.
  - Card no longer auto-hides for brand-new accounts that qualify for ultimate (previous "no past_seasons → return null" check now also checks the ultimate qualification).
- **Tests** (`/app/backend/tests/test_ultimate_gooner_title.py` — 2 new):
  - `test_ultimate_title_endpoint_flow`: end-to-end walk-through covering non-top-50 → 403, top-50 equip clears season, clear-via-ultimate=False, and season pick clears ultimate.
  - `test_public_user_exposes_title_ultimate`: DTO surface + default fallback.
- **Live verification** (curl + Playwright): admin @ leaderboard #1 equipped ULTIMATE via API and the lobby renders the gold+flame ranked pill "ULTIMATE GOONER #1" and the user PlayerCard shows "ULTIMATE GOONER" as the banner title.

### 2026-02-24 — Ultimate Gooner polish: friends peak pill + lobby flame animation
- **User request**: "make peak rank on friends list profile show ultimate gooner ; animate the ultimate gooner icon in lobby"
- **Backend** (`/app/backend/server.py` → `GET /users/{username}/profile`):
  - Attach `leaderboard_rank` (from `TOP50_GOONER_IDS[user_id]`) + `title_ultimate` to BOTH the public and the private branches of the payload. Without this the `PublicProfileModal` peak pill defaulted to plain GOONMASTER even when the target was a top-50 player.
- **Frontend — friends profile peak rank** (`/app/frontend/src/components/PublicProfileModal.jsx`):
  - The `Peak` `<RankPill>` now receives `leaderboardRank={data.leaderboard_rank ?? null}`. The existing `isUltimateGooner(tier, leaderboardRank)` gate inside `RankPill` (tier === 7 required) means non-Goonmaster peaks stay unaffected, while top-50 Goonmasters correctly upgrade to the ULTIMATE GOONER + flame badge on both Current AND Peak.
- **Frontend — Profile.jsx** applied the same fix to the self-profile Peak Rank card (`RankCard label="Peak Rank" leaderboardRank={user?.leaderboard_rank ?? null}`).
- **Lobby flame animation** (`/app/frontend/src/pages/Lobby.jsx` + `/app/frontend/src/index.css`):
  - New CSS classes `.ultimate-flame-halo` (radial gold→red glow, `anim-flame-pulse` 1.15s ease-in-out) and `.ultimate-flame-icon` (lucide flame gets `anim-flame-flicker` 0.9s ease-in-out + drop-shadow). Both respect `prefers-reduced-motion`.
  - Ultimate variant of `RankBadge` now renders a `<span aria-hidden className="ultimate-flame-halo" />` behind the Flame, and the Flame itself gains `className="ultimate-flame-icon"`. Uses `data-testid="rank-badge-ultimate-halo"` for tests.
- **Tests** (`/app/backend/tests/test_public_profile_ultimate.py` — 1 new):
  - `test_public_profile_exposes_leaderboard_rank_and_title_ultimate`: a top-50 target user's public profile returns `leaderboard_rank == 3` + `title_ultimate == True`; a non-top-50 target has no `leaderboard_rank` key and `title_ultimate == False`.
- **Live verification** (curl): `GET /users/TEST_newname_x/profile` as `player1@shooter.com` now returns `leaderboard_rank: 1`, `title_ultimate: True`. Lobby screenshot with admin equipped confirms the flame halo + flicker animation renders on the rank pill.


### 2026-02-24 — TDM bot HP normalized to 100
- **User request**: "make sure all bots have 100hp in TDM"
- **Problem**: `GameRoom.spawn_bot` normalized ranked bots to `MAX_HP` (100) but every other room (including both TDM rooms) fell through to `int(BOT_MAX_HP * difficulty)`. The TDM pre-fill spawns at difficulty=1.45 → 116 HP, and the practice-TDM pre-fill at difficulty=1.2 → 96 HP. Result: TDM bots didn't share the human player's 100 HP pool, so trade fights felt off.
- **Fix** (`/app/backend/server.py` → `GameRoom.spawn_bot`): expanded the HP-normalization condition from `if self.is_ranked` to `if self.is_ranked or self.game_mode == "tdm"`. Every TDM bot (quick-match TDM room, practice-TDM room, per-party TDM room, mid-match bot-fills) now spawns with `max_hp = MAX_HP = 100`. FFA casual/offline bots keep their forgiving scaled HP so practice mode remains beginner-friendly. Practice dummies (which override `max_hp = 50` post-spawn) are unaffected.
- **Tests** (`/app/backend/tests/test_tdm_bot_hp.py` — 3 new):
  - `test_tdm_bots_have_full_100_hp_regardless_of_difficulty`: sweeps difficulty 0.6→2.5 in a TDM room; every bot must be `max_hp == 100`.
  - `test_ffa_casual_bots_keep_scaled_hp`: regression guard that non-TDM FFA casual bots keep `BOT_MAX_HP * difficulty`.
  - `test_ranked_bots_still_have_100_hp`: pre-existing ranked normalization still works.
- **Live verification**: backend hot-reload re-spawned the TDM pre-fill (14 disguised bots across quick-match + practice TDM rooms) under the fixed code path.


### 2026-02-24 — Party Quick Match → shared casual queue
- **User request**: "change party matches to just join the quick match queue"
- **Old flow**: `PartyPanel` START QUICK MATCH called `POST /party/start`, which flipped `match_starting=true`, and every party-mate polled that flag and auto-navigated to a private bot-filled party FFA room (`GameRoom(is_ranked=False, is_party=True)`).
- **New flow**: The button now calls `useQueue().joinCasual()` (same helper the lobby's own QUICK MATCH button uses). The whole party is enqueued as a single multi-user entry in `CASUAL_QUEUE`, and both members' casual-queue pollers see `in_queue: true` → `matched: true` → auto-nav into the SHARED casual room (real head-to-head OR bot-filled after 10s, whichever comes first, just like solo Quick Match).
- **Backend** (`/app/backend/server.py`):
  - `POST /queue/casual` now: (a) looks up caller's party via `_party_for_user`; (b) returns `403 "Only the party leader can queue Quick Match."` for non-leader party members; (c) enqueues one multi-user `CASUAL_QUEUE` entry with `user_ids: [leader, ...all members]` + `is_party: True` when partied, otherwise the classic solo entry; (d) returns `{is_party, party_size}` alongside the existing bot-fill / ETA fields.
  - `DELETE /queue/casual` now scrubs `MATCHED_USERS` for EVERY member of the removed entry — mirrors ranked's clean cancel so a mid-match cancel by the leader doesn't leave a party-mate with a stale `matched` flag.
- **Frontend** (`/app/frontend/src/components/PartyPanel.jsx`):
  - Dropped the `useEffect` that watched `party.match_starting` + the `useNavigate` + `navigateToMatch` imports (dead code now).
  - `startQuick` calls `joinCasual()`; new `cancelQuick` calls `cancelCasual()`. The button toggles between `QUICK MATCH` and `QUICK QUEUE · {casualWaitSec}s · CANCEL` based on `casualInQueue` (mirrors the ranked toggle right underneath).
  - Non-leader now sees `IN QUICK QUEUE · {Ns}` (red) when the party is casual-queued, alongside the existing `IN RANKED QUEUE @ {tier}` (blue) state.
  - Ranked button is disabled while the party is in the Quick Match queue (mutual exclusion).
- **Tests** (`/app/backend/tests/test_party_casual_queue.py` — 2 new):
  - `test_party_casual_queue_end_to_end`: follower 403 → leader enqueues → both `in_queue:true` → cancel scrubs BOTH from `MATCHED_USERS` + `CASUAL_QUEUE`.
  - `test_solo_casual_queue_still_works`: solo user still enqueues 1 user with `is_party:False`.
- **Live verification** (curl with partyleader + partyfollower test accounts): follower POST → 403 with correct copy; leader POST → both members poll `in_queue:true`, `queue_size:1`; leader DELETE → both cleared. `/party/start` endpoint kept intact for backwards compat with existing tests.


### 2026-02-24 — Placement UI cleanup + past-Diamond win cap
- **User request**: "remove 2x from placement border" + "make placement matches past diamond only gain 150 on the best performance game"
- **UI** (`/app/frontend/src/pages/Lobby.jsx`):
  - Removed the gold `2x / 2x RP` segment on the right side of the placement streak badge. The badge now just shows the star + `PLACEMENTS X/5` label. Also updated the hover tooltip copy from "2x RP gains" → "performance-scaled RP anchors your first 5 ranked matches to your true skill" (matches the actual math since the old flat 2x multiplier was replaced by the base ±100 + perf modifier weeks ago).
- **Backend RP math** (`/app/backend/server.py`):
  - Extracted the placement-delta formula into a top-level testable helper `compute_placement_delta(kills, deaths, placement, cur_tier_idx)`.
  - Added `PLACEMENT_HIGH_TIER_WIN_CAP = 150` — when `cur_tier_idx >= 5` (Master / Grandmaster / Goonmaster) AND the computed delta would be positive AND > 150, it's clamped down to 150. Loss-side is untouched (returning veterans still shed RP at the full −300 floor on hard-throws).
  - Range summary post-fix:
    - Tier 0-4 (Bronze..Diamond): unchanged, `[-300, +250]`.
    - Tier 5-7 (Master+): `[-300, +150]` — cap only affects wins with strong perf.
- **Tests** (`/app/backend/tests/test_placement_high_tier_cap.py` — 10 new):
  - Below-Diamond behaviour unchanged: monster-win +250, hard-throw −300, average win scales.
  - Diamond (tier 4) is BELOW the cap and still uncapped.
  - Master/Grandmaster/Goonmaster placement wins with monster perf clamp at +150.
  - Master placement wins with modest perf (<= 150 total) are untouched.
  - Master placement losses stay at the full −300 floor.
- **Live verification**: lobby screenshot shows the redesigned badge with no "2x" segment (`PLACEMENTS 0/5` only).


### 2026-02-24 — Public profile shows BANNED / SUSPENDED indicator
- **User request**: "show a banned text on a profile that has been banned on the leaderboard"
- **Problem**: Leaderboard rows still show banned users (their old rank_points anchor them there until manually scrubbed). Clicking the row opened `PublicProfileModal` with no visible sign the account had been actioned, so viewers couldn't tell why the top-of-the-board user was inactive/silent.
- **Backend** (`/app/backend/server.py` → `GET /users/{username}/profile`):
  - Reuses the existing `check_ban(u)` helper (skips bots, treats expired suspensions as unbanned). When active, adds `{banned: true, ban_status: "banned"|"suspended", ban_until: ISO-datetime|null}` to both the private and public payloads. `ban_reason` is intentionally omitted from the public payload to avoid doxxing.
- **Frontend** (`/app/frontend/src/components/PublicProfileModal.jsx`):
  - Added `Ban` lucide icon.
  - Header pill: red `SUSPENDED` / `BANNED` badge (with Ban icon) next to REPORT. The `ONLINE` indicator is hidden when the account is banned (dead accounts can't be online in a useful sense).
  - Full-width red banner directly below the header: large `Account Suspended` / `Account Banned` heading. Suspensions include a localized "Suspended until …" timestamp; permanent bans read "This account has been removed for violating community guidelines."
- **Tests** (`/app/backend/tests/test_public_profile_banned.py` — 1 new, 4 cases):
  - Permanent ban → `banned: True`, `ban_status: "banned"`.
  - Active suspension → `banned: True`, `ban_status: "suspended"`, `ban_until` set.
  - Expired suspension → `check_ban` returns None → response has no ban fields.
  - Clean account → no ban fields.
- **Live verification**: admin banned `partyfollower` (24h suspension); partyleader opened partyfollower's profile via the friends list and saw both the red `SUSPENDED` pill in the header + the full "Account Suspended · Suspended until 8/9/2026" banner. Cleanup: partyfollower unbanned back to a clean state.


### 2026-02-24 — Leaderboard bots climb faster, go higher, level 10-25
- **User request**: "Make the bots on the leaderboard climb faster and go higher" + "Make the leaderboard bots have a level between 10-25"
- **New helper** (`/app/backend/server.py`): `xp_threshold_for_level(level)` returns the cumulative XP needed to display exactly at `level`. Closed-form: `50 * (L-1) * L * (L+1) / 3`. Verified against `compute_level` in tests for L=1..29.
- **New seeds** (`_build_and_insert`):
  - `seed_climb_speed` now drawn from `random.uniform(2.5, 4.0)` (was 1.35..2.4).
  - Target RP bucket now `(2100, 3800, 100)` (was 2700 ceiling) — spreads the Ultimate Gooner top-50 window across ~1200 RP instead of ~600.
  - `stats.bonus_xp` seeded to `xp_threshold_for_level(random.randint(10, 22))` so the bot's displayed level pins in [10, 22] at 0% climb and drifts up by ~1-3 levels as stats lerp — final display always stays inside [10, 25].
  - Doc stamped `seed_v6_boost: True` so the v6 migration is a no-op on fresh docs.
- **v6 migration** (`seeded_climb_loop`) — one-shot per existing seed doc:
  - Bumps `seed_climb_speed` into 2.5..4.0 when the current value is below 2.5.
  - Pushes `seed_target_rp` under 3000 into the widened 2600..3800 window (re-syntheses stats via `_synthesize_career`).
  - Injects `stats.bonus_xp = xp_threshold_for_level(random.randint(10, 22))` when `bonus_xp` is 0 or absent.
  - Marks doc `seed_v6_boost: True`.
- **Tests** (`/app/backend/tests/test_seeded_bot_climb_and_level.py` — 6 new): threshold ↔ `compute_level` sanity for L=1..29, level pin stays in [10, 25] across 0%→100% climb progression for target_level=10..22 against worst-case Goonmaster stats, source-level regression guards for the new 2.5..4.0 climb-speed and 3800 target-RP-ceiling literals.
- **Live verification**: after backend hot-reload + one climb-loop cycle: 107 / 107 seeded bots migrated. `seed_target_rp >= 2600` for all of them, ranging up to 3765; `seed_climb_speed >= 2.5` for all (samples 2.64, 2.91, 3.50, 3.60); five sampled bots' public profile levels were 11 / 14 / 14 / 16 / 17 — every one inside the target [10, 25] band.


### 2026-02-24 — Mobile lobby cleanup + full-screen touch look + console-style aim assist
- **User request**: "Without affecting the PC version fix the lobby on mobile screens" + "Fix mobile controls (hard to aim from center of screen)" + "Auto fire and aim assist feel weak on mobile — feel closer to console aim assist"
- **Mobile lobby** (`/app/frontend/src/pages/Lobby.jsx`):
  - Outer container swapped from `overflow-hidden` to inline `style={{ overflowY: "auto" }}` (Tailwind class fell through to `hidden` on this specific compile — inline style is authoritative). Desktop still has content-fits-viewport so no scrollbar appears; mobile landscape (~390px height) now scrolls to reach LEADERBOARD / PROFILE / MODERATION buttons that used to be hidden below the fold.
  - `<main>` re-tightened the negative-margin & `min-h-0` to `lg:` scope only so mobile flows naturally (`mt-0 lg:-mt-20 xl:mt-2`, `flex-1 lg:min-h-0 lg:overflow-hidden`, added `pb-6 lg:pb-0` for touch-friendly bottom padding).
  - VIRTUE logo scaled: `text-3xl sm:text-5xl md:text-7xl lg:text-8xl` (was `text-5xl` on mobile — ate too much vertical space on 390px height).
  - Header: `justify-between` (needed the empty spacer div) swapped to `justify-end` and gap tightened to `gap-1 sm:gap-3` at mobile; ratings of the PlayerCard etc. unchanged on desktop.
- **Mobile controls — full-screen look pad** (`/app/frontend/src/components/TouchControls.jsx`):
  - Look pad was previously `right-0 top-0 bottom-0 w-1/2` (right half only) — dragging outside that band silently did nothing which the user described as "have to aim from the center of screen".
  - Now `absolute inset-0 z-10` covering the entire screen. Move joystick and action buttons sit at `z-30` / `z-40` respectively with `pointer-events-auto` so they still capture their own touches. Verified live: look-pad rect = full 844×390 viewport, move-stick + fire button rects unchanged from before.
- **Aim assist boost** (`/app/frontend/src/game/engine.js`):
  - Touch aim-assist cone widened from ~32° → ~50° (0.56 → 0.90 rad).
  - Touch aim-assist range widened from 50m → 60m.
  - Touch aim-assist lerp rate doubled: 14 → 28 per second (console-style aggressive snap).
  - Touch strength cap raised: `Math.min(2.0, base * 2.5)` → `Math.min(2.5, base * 3.0)`. Default slider (0.6) now yields effective intensity 1.8 × lerp 28 = ~50/s snap rate.
  - Controller (gamepad) settings kept UNCHANGED — cone 20°, rate 6, no scaling.
- **Auto-fire crosshair gate** (`/app/frontend/src/game/engine.js` → `hasEnemyInCrosshair`):
  - Desktop stayed at ~2.5° cone (`COS_THRESHOLD = 0.999`) — pixel-precise mouse aim doesn't need any slack.
  - Touch now uses `COS_THRESHOLD = 0.970` (~14° cone). Previously the wobbly touch camera constantly slipped just outside the 2.5° gate so auto-fire silently dropped even when the enemy was clearly on screen. Aim-assist snap keeps the crosshair honest so the widened gate doesn't produce false-positive shots downrange.
- **Live verification** (Playwright at 844×390): mobile lobby scrolls (`scrollHeight 523 > clientHeight 390`, `overflowY: auto` computed); desktop screenshot at 1920×1080 unchanged; touch controls into the practice range render with the full-screen look pad + move stick + fire button correctly layered.


### 2026-02-24 — Rich animated UltimateGoonerCrest + Peak Crest Ultimate treatment
- **User request**: "Make the ultimate gooner animated icon in lobby look better and more animated" + "Add ultimate gooner icon to peak crest"
- **New shared component** (`/app/frontend/src/components/UltimateGoonerCrest.jsx`):
  - Multi-layer animated emblem, scales from ~36px (avatar) to ~64px (lobby pill) via a single `size` prop.
  - Layers (back → front): pulsing radial gold→red halo, 8-spoke rotating conic gradient rays, 3 counter-orbiting spark pips (durations 1.4 / 2 / 2.6s to break repetition), lucide Flame with existing `anim-flame-flicker`, diagonal gold sheen sweep every 3.5s. Optional overlay rank chip when caller passes `rank`.
  - Full `prefers-reduced-motion` support + `paused` prop that halts every animation.
- **CSS** (`/app/frontend/src/index.css`): added ~180 lines of `.ug-crest-*` classes + 5 keyframes (`ug-crest-halo-pulse`, `ug-crest-rays-spin`, `ug-crest-orbit-spin`, `ug-crest-spark-twinkle`, `ug-crest-sheen-sweep`).
- **Lobby RankBadge** (`/app/frontend/src/pages/Lobby.jsx`): swapped the previous single-Flame + halo combo for `<UltimateGoonerCrest size={56} />`. Imports updated; `Flame` kept for other uses.
- **Peak Crest avatar** (`/app/frontend/src/components/PlayerCard.jsx`):
  - `Avatar` accepts new `leaderboardRank` prop. When the peak-crest avatar (idx 5) is at tier 7 (Goonmaster) AND `leaderboardRank ∈ [1, 50]`, it renders `<UltimateGoonerCrest rank={leaderboardRank} />` instead of the base AnimatedRankIcon — includes the overlay rank chip inside the flame belly.
  - Outer PlayerCard threads `leaderboardRank` through to `Avatar` AND swaps the left avatar-bar background to gold (`#FFD700`) instead of the tier-7 black so the crest reads as a single cohesive gold block.
- **Live verification** (Playwright at 1920×900): confirmed all 6 animation layers active — halo pulse (2.2s), rays spin (6s), 3 orbit spins (1.4/2/2.6s), flame flicker (0.9s), sheen sweep every 3.5s. Screenshot shows the new crest rendering in both the lobby rank pill AND the header PlayerCard's peak-crest avatar with gold background + orbiting spark dots visible.


### 2026-02-24 — Moderation dashboard: LIVE PLAYER STATS + mode popularity
- **User request**: "Add live player statistics and player count numbers and what modes are more popular in moderation"
- **Backend** — new `GET /api/admin/live-stats` (admin-only, 403 otherwise) in `/app/backend/server.py` (~150 lines). Aggregates:
  - `real_online` (from `ONLINE_USERS` websocket registry) + `displayed_online` (synthetic value shown in the lobby).
  - `rooms.*` — human player counts (bots filtered via `p.is_bot`) for `quick_match_ffa`, `quick_match_tdm`, `ranked`, `practice_ffa`, `practice_tdm`, `offline_ffa`, `offline_tdm`, `ranked_vs_bots`, `party_ffa`, `party_tdm`. Per-user room categories additionally report the active room count.
  - `queues.casual_total`, `queues.ranked_total`, `queues.ranked_by_tier[]` — multi-user party entries are summed by member count, not entry count.
  - `parties` count.
  - `mode_popularity` — the two headline "how much FFA vs TDM is being played right now" numbers plus `ranked` and `in_match_total`.
- **Frontend** — new `LivePlayerStats` component in `/app/frontend/src/pages/AdminReports.jsx` (~180 lines). Polls the endpoint every 5s and renders:
  - Headline tile row: `Displayed Online`, `Real Online`, `In-Match`, `Parties`.
  - Mode popularity section with proportional progress bars for `FFA · Casual`, `TDM · Casual`, `Ranked` — the leading mode gets a gold "leads" pill.
  - Queues section: casual + ranked totals, plus per-tier ranked queue chips when populated.
  - Rooms grid: 10 tiles with per-mode color dot, human count, and room count (for per-user categories). Empty rooms dim to 70% opacity for at-a-glance filtering.
  - Full `data-testid` coverage for downstream tests.
- **Import**: `Flame` icon added to the lucide-react import list.
- **Tests** (`/app/backend/tests/test_admin_live_stats.py` — 2 new):
  - `test_live_stats_admin_only`: non-admin caller → 403.
  - `test_live_stats_shape_and_bot_filtering`: spawn bots into `game_room`/`tdm_room` + inject a 3-user party casual queue entry; assert `humans == 0` in the affected rooms (bot filter works) and `casual_total >= 3` (multi-user entries counted per-member). Also asserts all 10 room keys + all `mode_popularity` sub-keys are present.
- **Live verification** (Playwright): admin route renders the LIVE PLAYER STATS card immediately below the existing stat cards; headline tiles show `displayed_online=17`, mode bars + queue counters + room tiles all populate correctly; second curl call showed `displayed_online` drifted to 24 confirming the 5s auto-poll updates.


### 2026-02-24 — EMERALD tier + higher-level disguised bots + animated match-result icons
- **User request**: "Add a new rank between platinum and diamond called Emerald · Emerald 1-3 · Have the disguised bots have higher levels use animated icons and show either 1-3 after rank on the post match screen"
- **Backend** (`/app/backend/server.py`):
  - `RANK_TIERS` grew from 8 → 9 entries with `EMERALD` inserted at index 4 (RP threshold 1050). Diamond/Master/Grandmaster/Goonmaster shift up: 5/6/7/8. Emerald spans 1050..1200 (150 RP band → 50 RP per division: I/II/III).
  - Constants shifted: `MASTERS_TIER_IDX 5 → 6`, `QUEUE_LOW_TIER_MAX 4 → 5`. All other tier math uses `len(RANK_TIERS)` and auto-adapts.
  - Avatar unlock gates that referenced the old Diamond/Master/Goonmaster tier indices (avatars 7 / 8 / 10 / 11) all bumped.
  - The special "cap target at Grandmaster" rank-up guard in code-redeem now uses `len(RANK_TIERS) - 2` so a future tier insert doesn't teleport players into Goonmaster.
  - `_disguise_bots_as_players` (per-match freshening loop): bot displayed level upgraded from a flat `random.randint(5, 11)` to a per-tier band — `10 + t_idx*5 .. min(99, 20 + t_idx*10)` — so a Goonmaster disguised bot reads as level 50-99 instead of 5-11.
- **Frontend** (`/app/frontend/src/game/rankIcons.js` + 12 other files):
  - Canonical `RANK_COLORS`, `RANK_NAMES`, `RANK_ICONS`, `RANK_THRESHOLDS` arrays all expanded to 9 entries. Emerald color: `#2ECC71` (bright green); Emerald icon: lucide `Sparkles` (twinkly gems).
  - All 8 hardcoded `RANK_COLORS` arrays across `QueueOverlay`, `Hud`, `MatchResultOverlay`, `FriendsModal`, `PartyPanel`, `PublicProfileModal`, `Leaderboard`, `Profile` bulk-patched via sed.
  - 17 tier-clamp expressions `Math.min(7, ...)` bumped to `Math.min(8, ...)`.
  - 12 Goonmaster tier-equality checks `=== 7` / `!== 7` / `== 7` bumped to `=== 8` / `!== 8` / `== 8`.
  - `rankIdxFromName` name arrays in `PublicProfileModal` and `Profile.jsx` gained the `EMERALD` entry so match-history rows resolve the color/tier correctly.
- **Post-match scoreboard** (`/app/frontend/src/components/MatchResultOverlay.jsx`):
  - Rank chip now renders `<AnimatedRankIcon tier={p.rank_tier} division={p.rank_division ?? 3} size={12} />` — so disguised bots (and every real player) get the tier's ornaments (division sparkles, Master halo, Goonmaster flicker) instead of a flat lucide icon. Falls back to `rankIconFor` when `rank_tier` is undefined.
  - Division roman (I/II/III) was ALREADY rendered in-line (`p.rank_name + " " + divisionRoman(p.rank_division)`) — verified this still lands correctly for Emerald.
- **Tests** (`/app/backend/tests/test_emerald_tier.py` — 6 new + `/app/backend/tests/test_placement_high_tier_cap.py` refactored):
  - Layout: 9 tiers, EMERALD at index 4, thresholds 0/300/600/900/1050/1200/1500/1800/2100.
  - `rank_for_points` maps [1050, 1200) → EMERALD; 1049 stays Platinum, 1200 becomes Diamond.
  - Emerald has 3 divisions (50 RP each): 1050 → III, 1100 → II, 1150 → I.
  - `MASTERS_TIER_IDX == 6` and `QUEUE_LOW_TIER_MAX == 5`.
  - `PLACEMENT_HIGH_TIER_WIN_CAP` now fires at tier 6 (Master), not tier 5 (Diamond). Diamond (5) and Emerald (4) placement wins can still reach +250.
  - Existing placement-cap test file updated: every "Master" case bumped from `cur_tier_idx=5` → `6`, GM from `6` → `7`, Goon from `7` → `8`.
- **Live verification**: 18 pytests pass. curl `/api/auth/me` for admin returns `rank_tier: 8, rank_name: GOONMASTER, rp: 6200`. Playwright: desktop lobby + full 100-row leaderboard render with zero JS errors; top rows correctly display the Ultimate Gooner crest on gold. Emerald boundary verified via internal helper: rp=1050→EMERALD III, 1150→EMERALD I, 1200→DIAMOND III.


### 2026-02-24 — Lobby SHOW TIERS + RankProgressBar updated for EMERALD
- **User request**: "Update the lobby and rank tiers page to show new emerald rank"
- **Lobby SHOW TIERS modal** (`/app/frontend/src/pages/Lobby.jsx`): The local `RANK_TIERS` const still had 8 entries (missing Emerald). Added the EMERALD entry at index 4 with color `#2ECC71` and threshold 1050. The modal now iterates 9 tiers and renders EMERALD III / II / I sub-divisions at 1050 → 1099 / 1100 → 1149 / 1150 → 1199 RP. Existing tier-splitting logic uses per-row `next.min - t.min` divided by 3, so Emerald's 150 RP span cleanly produces 50-RP divisions.
- **RankProgressBar** (`/app/frontend/src/components/RankProgressBar.jsx`) rewritten to be tier-count agnostic:
  - `RANK_THRESHOLDS` updated to 9 entries (`0/300/600/900/1050/1200/1500/1800/2100`).
  - `GOONMASTER_IDX = RANK_THRESHOLDS.length - 1` (8) — no more magic 7.
  - New `divisionWidthForTier(t)` helper — returns 100 RP for the 300-wide tiers (Bronze..Platinum, Diamond..Grandmaster) and 50 RP for Emerald's 150-wide band. The "X / Y RP to next" label + fill percentage now use this per-tier width so Emerald's progress bar reads `X / 50` instead of the wrong `X / 100`.
  - "MAX RANK" pill gate + "next-tier is Goonmaster" transition both now check against `GOONMASTER_IDX`.
- **Live verification**: Playwright opened SHOW TIERS modal — 10 tier rows rendered (9 tiers + header), EMERALD row correctly displays "1050 → 1199 RP" and EMERALD III/II/I sub-divisions at their correct RP bands with the emerald green background + animated Sparkles icon. Zero JS errors.

