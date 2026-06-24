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

