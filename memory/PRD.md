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

### Iteration 34 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Right-side aim drag on mobile now works everywhere** — `TouchControls.jsx` action-buttons wrapper and weapon-switcher wrapper were `pointer-events-auto`, which captured touch drags on the empty gaps between buttons (a ~140×140 region in the bottom-right). Fix: wrappers now `pointer-events-none`; only the child buttons themselves (`ActionBtn` + weapon buttons) explicitly opt into `pointer-events-auto`. Aim drags now pass through the gaps to the look-pad behind, so a right-thumb drag anywhere on the right side of the screen rotates the camera.
- ✅ **ADS button added to mobile HUD** — new circular ADS button sits just above the fire cluster (bottom-right, ~168px above the grid). Tap toggles engine ADS on/off via `engine.setADS()`. Button turns blue when active, dark slate when off. Auto no-ops when the katana (secondary) is equipped (no ADS available). Visual state stays in sync with the engine's `ads` flag through the existing 60Hz raf loop, so weapon-switches and sniper-reload auto-disables reflect on the button.
- ✅ **Aim-while-held on Fire button** — `ActionBtn` gained an `aimWhileHeld` prop. When enabled, the button's touchmove handler feeds yaw/pitch deltas into the engine using the same sensitivity math as the look-pad. Player can now hold Fire and simultaneously drag their thumb to rotate the camera without lifting — same gesture Call of Duty Mobile / PUBG Mobile use. Only the Fire button opts in (Reload / Melee / Jump remain pure tap buttons so accidental thumb drags don't shift the camera).
- ✅ **Melee button removed from mobile HUD, ADS takes its slot** — The Melee button was removed per user request. ADS is now a first-class grid child in the former Melee position (top-right of the 2×2 action grid, directly above the Fire button). Standalone floating ADS button removed. Grid layout: Reload · ADS / Jump · Fire. `pressMelee` helper + `onMelee` prop removed from `TouchControls` (Game.jsx still passes it, harmlessly ignored).
- Files changed: `/app/frontend/src/components/TouchControls.jsx`.

### Iteration 35 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Aim-while-held on ALL touch buttons** — Extracted a reusable `makeAimWhileHeld(engineRef, onTap, {autoRepeatMs})` helper. Every touch button (Reload, ADS, Jump, Fire, weapon switcher) now uses it: touchstart fires the tap action, touchmove drags rotate the camera via the same sensitivity math the look-pad uses. Fire additionally auto-repeats. New `AimAwareButton` wrapper used by the ADS button + weapon switcher (custom styling, same touch semantics).
- ✅ **100% aim assist = full lock-on** — When the aim-assist slider is at 100% (`_aimAssistStrength >= 0.999`), engine engages FULL LOCK: acquisition + tracking cones widen to the full sphere (π rad), max range extends to 200m, and the lerp `k` snaps to 1.0 each frame so `yaw`/`pitch` slam directly onto the target — the reticle glues to the nearest enemy and tracks them automatically. Slider tooltip updated to advertise the behaviour.
- Files changed: `/app/frontend/src/components/TouchControls.jsx`, `/app/frontend/src/game/engine.js`, `/app/frontend/src/components/SettingsModal.jsx`.

### Iteration 36 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Casual smurf bots now spawn at level 9-35** — In `_maintain_population`, the smurf branch (Diamond II disguise, elite AI) now overrides the base bot level 5-11 with a random 9-35 so their banner reads like an established account. Real players see a plausible mid-game handle, not a fresh account.
- ✅ **All disguised bot names searchable in Friends** — `/api/users/search` now merges matching names from `DISGUISED_BOT_NAMES`, all `TIERED_BOT_NAMES` tier pools, and admin-registered custom names into the search results. Bot rows carry `is_bot: True` with synthetic `bot::<name>` ids (no real DB row). `FriendsModal.jsx` renders bot rows with a purple BOT badge and hides the Inspect + ADD buttons since you can't friend a bot.
- ✅ **Admin panel: custom bot names with mode + rank filters** — New `custom_bot_names` collection + admin endpoints:
  - `POST /admin/bot_names {name, modes[], ranks[]}` — 2-24 char handle, empty modes/ranks means "all". Validates against `GAME_MODES_ALLOWED = {ffa,tdm,ranked,bigffa}` and `0 ≤ rank < len(RANK_TIERS)`. Case-insensitive dedupe via `name_lower` unique index. Flags `shadows_builtin` if a name collides with the built-in pools.
  - `GET /admin/bot_names` — list all rows (admin-only)
  - `DELETE /admin/bot_names/{id}` — remove
  - In-memory `CUSTOM_BOT_NAMES_CACHE` reloaded on startup + on every mutation so bot spawning stays hot-path fast. `_maintain_population` merges `_custom_bot_names_for(mode=self.game_mode)` into the base disguised pool. `/users/search` uses `_all_custom_bot_names()`.
- ✅ **AdminReports UI: Custom Bot Names card** — Below the Redeem Codes card. Input (name), togglable chips for modes (Casual FFA / Team DM / Ranked / 12P FFA) and rank tiers (Bronze → Ultimate). List view shows each row's mode + rank chips (or "ALL MODES" / "ALL RANKS" pill), a DUPLICATE warning tag if the name shadows a built-in, creator, and delete button.
- 🧪 Verified via curl: create + list + duplicate-rejection (409) + invalid-mode (422) + delete round-trip; `/users/search?q=blitz` returns both a real user `BlitzReaper860` AND the built-in bot `BlitzReaper` with `is_bot: true`.
- Files changed: `/app/backend/server.py` (spawn_bot smurf level, _maintain_population pool, users/search, custom_bot_names endpoints, startup index/cache warm), `/app/frontend/src/components/FriendsModal.jsx` (is_bot rendering), `/app/frontend/src/pages/AdminReports.jsx` (CustomBotNamesCard).

### Iteration 37 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Bots roll from the full skin catalog** — Previously bots picked from a hardcoded pool of 6 basic skins. Now they draw from a rarity-weighted `BOT_SKIN_POOL` built at import time from every entry in `SKINS_CATALOG` (30 unique skins). Weights: common=6, rare=4, epic=2, legendary=1. Sample of 500 draws: 83 common / 167 rare / 173 epic / 77 legendary.
- ✅ **Rank-correlated skin pools** — Introduced `pick_bot_skin(tier_idx)`. Three weight tables + three pools:
  - Bronze / Silver / Gold / Platinum (t<4): base pool (common 6, rare 4, epic 2, legendary 1).
  - Diamond / Master (t=4,5): epic-heavy — common 1, rare 2, epic 5, legendary 4. Bots read as endgame players wearing polished gear.
  - Grandmaster / Goonmaster / Ultimate (t≥6): whale pool — common 0, rare 1, epic 3, legendary 8. ~67% of draws are legendaries.
  - Applied in `spawn_bot` (casual/practice/TDM disguises) AND in the ranked-room re-roll (`_reroll_ranked_bots`), so a Diamond ranked lobby now visually reads as a whale lobby.
- Files changed: `/app/backend/server.py` (BOT_SKIN_POOL split into 3 pools, `pick_bot_skin`, spawn_bot re-roll, ranked-room re-roll).

### Iteration 38 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Bot rows in Friends search now indistinguishable from real players** — `/api/users/search`'s bot entries carry deterministic-per-name fake metadata (seeded RNG): rank tier weighted toward Silver/Gold/Platinum (Ultimate excluded), rank points snapped to the match grid, tier-appropriate level, random avatar + banner icon/color. FriendsModal no longer renders any BOT badge, no "encountered in matches" side text, no disabled buttons. Inspect + ADD are always live: ADD swallows the 404 that would come from friending a nonexistent user and shows the same "Friend request sent to X" toast, and `/api/users/{username}/profile` was extended to return a fabricated "private profile" for known bot handles (built-in + custom pools) with the same seeded RNG so the modal shows a plausible player identical to a real player who has privacy on.
- ✅ **Custom bot names appear ~4x more often in matches** — `_maintain_population` now weights admin-registered custom names by inserting each 4× into the pre-shuffle pool. A dedupe-preserving-order filter after the shuffle picks the earliest occurrence, so custom names have ~4× the probability of landing in any given match compared to a built-in name. Bots spawned with duplicate names still avoided by the `seen` set.
- Files changed: `/app/backend/server.py` (users/search bot metadata, public_profile bot fallback, _maintain_population weighted pool), `/app/frontend/src/components/FriendsModal.jsx` (removed BOT badge + gated buttons; ADD now swallows on is_bot).

### Iteration 39 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Bot profiles get synthesized last-10 match history** — `public_profile` bot fallback now returns a full non-private payload (no more "profile is private" banner). Uses the same seeded RNG as `/users/search`, with call order aligned so avatar / level / banner values are IDENTICAL across both endpoints for the same bot name. Adds:
  - `stats`: matches / kills / deaths / wins scaled to tier + level (Bronze ~0.7 K/D, Ultimate ~2.5 K/D, matches 20-1000 range).
  - `history`: 10 matches. Mode mix 55% casual / 25% ranked (only tier ≥ 1) / 15% tdm / 5% bigffa. Placement biased around mid-pack with tier-scaled 1st-place chance. Kills/deaths biased by placement. `rp_delta` uses `compute_rp_delta(placement, tier_idx)` for ranked matches so numbers look native. `rank_name_after` walks backwards from current RP. `ended_at` spread across last ~7-14 days, most recent first.
- 🧪 Verified: BlitzReaper resolves to MASTER III lvl 46 with 372 matches, 5958/2650 K/D (2.25), 10 history entries with realistic placements + RP deltas + timestamps. Search + profile return identical avatar/tier/pts/level/banner values (RNG call-order match).
- Files changed: `/app/backend/server.py` (public_profile bot fallback rewritten to full profile).

### Iteration 40 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Custom bot names now surface in Quick Match + TDM (not just 12P FFA)** — Root cause: startup + party + offline-TDM pre-fill loops called `random.sample(DISGUISED_BOT_NAMES, N)` directly, bypassing the custom-name merge that only lived inside `_maintain_population`. Since Quick Match / TDM rooms are pre-filled once and stay static, custom names never appeared until a bot died mid-match. Fix: new `_pick_disguised_names(count, mode, exclude=None)` helper that returns unique names from the weighted pool (built-ins + custom×4). Wired into: casual quick-match startup pre-fill (`game_room`), TDM startup (`tdm_room` + `practice_tdm_room`), offline-TDM per-user rooms (`get_or_create_offline_tdm_room`), and party rooms (`create_party_room`). Verified via 200-round Monte Carlo: custom names appear ~77-85 hits vs ~23 for each built-in — the intended ~4× boost.
- ✅ **Confirmed no "BOT" text in Friends search rows** — Current backend returns `rank_name` = tier name (e.g. MASTER), never "BOT". Frontend has no "BOT" strings in `FriendsModal.jsx`. Touched the file to trigger a webpack bundle rebuild so any stale browser cache clears on next load.
- Files changed: `/app/backend/server.py` (`_pick_disguised_names` helper + 5 caller updates).

### Iteration 41 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Admin: change a player's rank from moderation** — New endpoint `POST /admin/users/{username}/rank` with body `{rank_points: int (0-100000), update_peak: bool}`. Snaps to the match-grid, rederives `rank_tier` + `rank_name` from `RANK_TIERS`, and optionally raises `peak_rank_*` (never lowers). Guarded by admin role check.
- ✅ **AdminReports account row: RANK edit control** — Blue `RANK` button next to the existing RENAME + RESET PW buttons. Opens an inline tier `<select>` (BRONZE → GOONMASTER, 9 tiers) plus a "Peak" checkbox and save/cancel buttons. Submits `floor_rp + 60` so the account lands in the middle of the picked tier's first division. Row RP + tier + name update inline on success; toast confirms.
- 🧪 Verified via curl: set to MASTER (1860 RP), set to Bronze (60 RP), invalid negative rejected 422.
- Files changed: `/app/backend/server.py` (`AdminSetRankIn` + `admin_set_rank` endpoint), `/app/frontend/src/pages/AdminReports.jsx` (`AccountRow` gained rank state + `doRank` + inline UI + `onRankChanged` wiring).

### Iteration 42 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Goonmaster / Ultimate Gooner ranked lobbies now show real leaderboard-bot handles** — Previously tier_idx=8 (Goonmaster) fell through to the `BOT_NAMES` fallback (BLAZE-7, VORTEX, etc.) because `TIERED_BOT_NAMES` only had keys 0-7. Now:
  - New `LEADERBOARD_BOT_NAMES` in-memory cache holds the top-60 seeded users (by RP desc). Refreshed on startup, on admin rank edits of seeded users, and on admin renames of seeded users.
  - `get_or_create_ranked_bot_room` uses the cache when `tier_idx >= 8`.
  - `_reroll_ranked_bots` uses the cache when `tier_idx >= 8` so mid-match rerolls also draw from the live top-50.
- 🧪 Verified: cache reports 20/60 entries after startup: `GoonSaintNyx828 3795 RP`, `GoonWraithZ9 3780 RP`, `K1ngslayer.gg 3750 RP`, `TheLastGoon 3720 RP`, ... — exactly what the public leaderboard shows.
- Files changed: `/app/backend/server.py` (LEADERBOARD_BOT_NAMES cache + `_reload_leaderboard_bot_names` helper + startup warm + ranked-room spawn/reroll hooks + rename/rank edit refresh triggers).

### Iteration 43 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Custom bot names are now editable** — New endpoint `PATCH /admin/bot_names/{id}` with partial `CustomBotNamePatchIn` payload (`name`, `modes`, `ranks` all optional; null fields untouched). Same validation as create — 2-24 chars, mode whitelist, rank tier bounds, case-insensitive uniqueness against other rows. `shadows_builtin` re-derived on rename. Refreshes the in-memory cache. Empty payload = idempotent no-op.
- ✅ **AdminReports UI: inline edit on each custom bot row** — Row now has an Edit (blue pencil) button next to Delete. Clicking Edit opens the same 3-part form used for create (name input + mode chips + rank tier chips) with the row's current values pre-selected. Save calls PATCH and refreshes the list; Cancel restores. Chip toggles work in place.
- 🧪 Verified via curl: create → PATCH full (name+ranks) → PATCH partial (modes only) → invalid mode returns 400 → delete cleanup. All idempotent.
- Files changed: `/app/backend/server.py` (`CustomBotNamePatchIn` model + `admin_edit_bot_name` endpoint), `/app/frontend/src/pages/AdminReports.jsx` (new `CustomBotNameRow` component + `CustomBotNamesCard` now delegates row rendering to it).

### Iteration 44 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Edit a leaderboard bot's rank inline** — `LeaderboardBotRow` edit panel gained a Rank Tier `<select>` (Bronze → Goonmaster, 9 tiers) alongside the existing Target RP input. Changing the tier snaps the RP input to `floor + 60` for the chosen tier (matches AccountRow rank editor). The RP field remains free-form so admins can still fine-tune within the tier.
- ✅ **Cache refresh on leaderboard-bot RP edit** — Backend `PATCH /admin/leaderboard_bots/{u}` now also refreshes the `LEADERBOARD_BOT_NAMES` cache when `rank_points` changes so Goonmaster ranked-vs-bot rooms reflect the new top-K ordering immediately.
- ✅ **Fixed rank tier labels drift** — Old `RANK_TIER_LABELS` in AdminReports had the wrong tier names (missing EMERALD, had a phantom "Ultimate"). Now matches backend `RANK_TIERS` exactly: Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Goonmaster. Added `RANK_TIER_FLOORS = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400]` for the tier picker.
- 🧪 Verified: PATCH sets seed_target_rp + rank_points to 960 (Platinum) and 2460 (Goonmaster); cache log line confirms refresh triggered.
- Files changed: `/app/backend/server.py` (`admin_edit_leaderboard_bot` cache-refresh hook), `/app/frontend/src/pages/AdminReports.jsx` (tier picker + corrected labels + floors constant).

### Iteration 45 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Custom bot names now support a pinned banner rank** — Every custom bot handle can carry an optional `rank_points` override. When set, `/api/users/search` AND `/api/users/{username}/profile` snap the bot's tier + name + RP + inferred level onto that override instead of using the name-seeded RNG. Admins can pin, e.g., `RONIN` to GRANDMASTER 2160 RP forever.
- Backend:
  - `CustomBotNameIn` + `CustomBotNamePatchIn` gained `rank_points: Optional[int]` (0-10000). PATCH accepts `-1` as a sentinel that clears the override → banner falls back to RNG.
  - `custom_bot_names` docs store `rank_points` (nullable). Cache snapshot returns it; new `_custom_bot_rank_override(name)` helper does the case-insensitive lookup used by both search + profile.
  - `/users/search` bot rows and `/users/{u}/profile` bot fallback both call the helper and snap `pts + tier_idx` if an override exists. `_lvl_lo/_hi` tuple access clamped with `min(tier_idx, 7)` so Goonmaster overrides don't IndexError.
- Frontend:
  - `CustomBotNameRow` edit form gained a "Banner rank" section: an `<select>` with `Auto (random)` + all 9 tiers, plus a numeric RP field that appears when a tier is picked. Save sends `rank_points` (-1 for Auto). Save always includes the field so admins can toggle it back to Auto.
  - Display row now shows a pinned-rank chip (📌 tier · RP) when an override is active.
- 🧪 Verified: create with `rank_points: 2160` → search + profile both show GRANDMASTER 2160 RP lvl 72. PATCH `{rank_points: -1}` clears; next search shows RNG-derived rank (GRANDMASTER 2220 by coincidence for this seed).
- Files changed: `/app/backend/server.py` (models, cache, helper, /users/search + /users/{u}/profile override wiring), `/app/frontend/src/pages/AdminReports.jsx` (`CustomBotNameRow` banner-rank picker + pinned-rank display chip).

### Iteration 46 — **THIS SESSION (2026-02-27, fork)**
- ✅ **BigFFA queue box no longer disappears mid-queue** — Root cause: the QueueContext poll's "miss counter" was set to 10 consecutive `in_queue: false` responses (~10 seconds) before clearing `bigffaQueueState`. Any transient server hiccup — a matchmaker cycle where the user was momentarily between "in BIGFFA_QUEUE" and "matched: true", a deployment restart tick, or a DB read stutter — could accumulate 10 misses fast and blank the queue toast while the player was still legitimately queueing. Fix:
  - Bumped miss threshold `10 → 30` (~30s of consecutive "not in queue" before auto-clearing) so real hiccups clear only if the server truly forgot us.
  - The "server confirms in queue" branch now REFRESHES `bigffaQueueState` on every successful poll (previously it only reset the miss counter and never touched state, leaving the queue-size chip stale). The `estimated_wait_seconds` pill keeps its locked join-time value because the backend recomputes ETA every poll based on remaining `dispatch_after` (would visually count down otherwise).
- Files changed: `/app/frontend/src/context/QueueContext.jsx` (BigFFA poll miss threshold + live state refresh).

### Iteration 47 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Pinned custom-bot rank now shows accurately in-game** — Previously the admin's pinned `rank_points` on a custom bot only affected the Friends search row + Inspect modal. When the same bot spawned into a live match, `spawn_bot` derived a random RP from the tier band, ignoring the pin. Fix: in the disguise branch of `spawn_bot`, check `_custom_bot_rank_override(name)` FIRST. If set, use it verbatim (no ±20 jitter, no tier-band clamp needed — the RP was admin-chosen). Downstream `rank_for_points` → `bot.disguise_rank_points`, `bot.disguise_rank_name`, `bot.rank_tier`, and `pick_bot_skin(t_idx)` all read from the pinned value so the in-game scoreboard, kill feed, banner, AND skin correlation reflect exactly what was pinned.
- 🧪 Verified: RONIN_PINNED at 2160 RP spawns with `disguise_rank_points=2160`, `disguise_rank_name=GRANDMASTER`, `rank_tier=7`, skin=`stardust` (epic — from the rank-correlated whale pool).
- Files changed: `/app/backend/server.py` (spawn_bot disguise branch now checks the pin before deriving RP).

### Iteration 48 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Pinned rank now takes effect on live bots immediately** — Previously `spawn_bot` respected the pin so the correct rank showed on NEW bots, but existing disguised bots already in a match kept their pre-pin RP until they died and respawned. Fix: new `_reapply_custom_bot_pins_to_live_rooms()` walks every live GameRoom (game_room, tdm_room, practice_tdm_room, bigffa_room, OFFLINE_ROOMS, RANKED_BOT_ROOMS, PARTY_ROOMS) and re-applies the pin to any disguised bot whose name matches a custom entry with `rank_points`. Also re-rolls their skin via `pick_bot_skin(t_idx)` so a bumped Bronze→Master bot visually upgrades to a whale skin in the same lobby. Called from POST + PATCH endpoints. Idempotent (skips bots already at target RP).
- 🧪 Verified: RONIN_TEST spawned as SILVER 495; adding a pin at 2160 → sweep instantly updates to GRANDMASTER 2160 with inferno legendary skin.
- Files changed: `/app/backend/server.py` (`_reapply_custom_bot_pins_to_live_rooms` helper + hooks in POST/PATCH custom-bot endpoints).

### Iteration 49 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Custom bot names now surface in ranked lobbies** — Root cause: `get_or_create_ranked_bot_room` + `_reroll_ranked_bots` built their name pool from `TIERED_BOT_NAMES[tier_idx]` or `LEADERBOARD_BOT_NAMES` (tier ≥ 8) exclusively; admin-registered custom names for `mode="ranked"` were never merged. Fix: both spots now consult `_custom_bot_names_for(mode="ranked", tier_idx=tier_idx)` and merge them with the base pool using the same weight-4× + dedupe-preserving-order pattern used by casual `_pick_disguised_names`. Ranked-vs-bot re-rolls also draw fresh custom picks.
- ✅ **BigFFA no longer feels frozen on solo PC** — Root cause: the per-entry `dispatch_after` is sampled from a triangular distribution (min 20s, mode 38s, max 64s). A PC user queueing alone could wait up to 64s with no visual dispatch signal — perceived as a freeze. Fix: matchmaker `lead_idx` search now dispatches an entry early when it's the ONLY player in the queue AND has waited ≥ 15s. The cap only applies while `len(BIGFFA_QUEUE) == 1`; once anyone else joins, normal per-entry timeout resumes so 12-player humans-only lobbies still bunch up.
- 🧪 Verified: PC solo queue matched in 16s (was up to 64s). Ranked tier-5 lobby draws confirm custom name `RANKEDTEST` (weight 4×) appears in the pool alongside 9 built-in names with above-base frequency.
- Files changed: `/app/backend/server.py` (`get_or_create_ranked_bot_room` + `_reroll_ranked_bots` custom-name merge; BigFFA solo-queue accelerant).

### Iteration 50 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Spawn immunity: 3s bubble for real players in EVERY mode, ends on move OR any offensive action** — Every real player already got a 3-second `invuln_until` on spawn/respawn/match_start; the drop-on-move rule previously exempted BigFFA (the 12-player deathmatch), and the drop-on-action path was missing entirely. Fixes:
  - Removed the `is_bigffa` exemption in `handle_message("input")` — real-player movement (`dist > 0.02`) now burns the bubble uniformly in FFA, Ranked, BigFFA, TDM, Party and Practice.
  - `handle_message("shoot")` now zeros `invuln_until` for real players the moment they take a shot.
  - `handle_message("input")` with `laser_firing: True` zeros `invuln_until` for real players the moment the beam starts (missing before).
  - `handle_message("melee")` now zeros `invuln_until` for real players on melee.
  - Every drop-branch is gated on `not player.is_bot`, so bot invuln bookkeeping (existing move-forfeit at line 6017-6021 + shoot-forfeit at line 6084-6085) is untouched — bots keep their pre-existing behavior.
- 🧪 7/7 regression tests in `tests/test_spawn_immunity_forfeit.py` pass (bubble granted on spawn, movement forfeits in BigFFA, idle jitter <0.02 preserved, shoot / laser-start / melee all end the bubble, bots unaffected). No regressions in bigffa / tdm / iteration21 / ak_hitbox / lag_compensation suites.
- Files changed: `/app/backend/server.py` (`handle_message` — input/shoot/laser_firing/melee branches).

### Iteration 51 — **THIS SESSION (2026-02-27, fork)**
- 🐛 **Ranked queue timer "freezes" — root cause found + fixed** — Backend logs showed a `KeyError: 'tier'` at `queue_ranked_status` line 8187 every time it fired. Root cause: casual + bigffa match dispatchers populate `MATCHED_USERS[uid]` with a `casual: True` or `bigffa: True` marker and **no** `tier` field. Both `POST /api/queue/ranked` and `GET /api/queue/ranked` then unconditionally read `m["tier"]` on any residual match entry → KeyError → 500 → the client's ranked-queue poll loop broke → the queue toast timer visually froze for the whole party. Trigger flow: play a casual quickmatch or BigFFA → return to lobby → click RANKED → poll blows up.
- Fix (server.py `queue_ranked_status` GET + `queue_ranked_join` POST): both endpoints now (a) auto-clear casual/bigffa residue from MATCHED_USERS on entry so a ranked join isn't blocked by a stale non-ranked flag, and (b) defensively skip any match entry that lacks a `tier` key before dereferencing `m["tier"]`.
- 🧪 Verified via curl on the running backend: `GET /queue/ranked` returns 200 cleanly, `POST /queue/ranked` returns 200 (or a normal 4xx guard like "level 5 required"), no `KeyError` in `backend.err.log` after the fix. Existing spawn-immunity / bigffa / iteration21 suites (27 tests) still pass.
- Files changed: `/app/backend/server.py` (`queue_ranked_join` casual/bigffa residue sweep + `tier` guard; `queue_ranked_status` `tier` guard).

### Iteration 52 — **THIS SESSION (2026-02-27, fork)**
- 🐛 **Mobile-ranked "match freezes at start, HUD still updates, can hear/see damage" — fixed** — Symptom: bots move + shoot server-side (damage arrows fire, audio plays), but the local mobile player can't move or shoot because `_matchStarted` stays false forever. Root cause: `match_go` and `match_countdown` are one-shot events; if the mobile WS buffers or drops one (iOS Safari throttles WS briefly on tab focus + orientation changes), the client had no other channel telling it the match had actually started — state broadcasts never carried `match_started`.
- Fix (both sides):
  - Server (`GameRoom.tick` state broadcast): `top_full` now carries `match_started` + `countdown_until`. State-delta only sends these when they change, so the wire cost is ~5 bytes on transitions and 0 bytes otherwise. Keyframes (~1Hz) re-assert both unconditionally → any missed one-shot heals within ≤1s.
  - Client (`engine.js applyServerState state`): when a state frame carries `match_started`, apply the transition (`false → true` unfreezes, `true → false` re-arms). `countdown_until` is likewise re-applied so a dropped `match_countdown` still surfaces the 3-2-1 timer.
- 🧪 3 new regression tests in `tests/test_mobile_ranked_freeze_selfheal.py`: state broadcast carries `match_started` after `_begin_match_now`; delta transitions surface the flip; `countdown_until` is present in the state top-level. Full suite 54/54 green (spawn-immunity + bigffa + tdm + iteration21 + ak_hitbox + lag-comp + freeze-selfheal).
- Files changed: `/app/backend/server.py` (`GameRoom.tick` state broadcast top-level); `/app/frontend/src/game/engine.js` (state message handler self-heal branch).

### Iteration 53 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Quick Match mode picker (FFA / TDM / Both)** — Added a 3-way segmented control right above the lobby's Quick Match button so players can pin their casual matches to FFA-only, TDM-only, or leave the classic 50/50 roll ("Both", default).
- Backend (`server.py`):
  - `QueueFlagsIn` Pydantic model now carries `mode_pref: "ffa" | "tdm" | "both"` (default `"both"`). Server double-validates + normalises garbage input.
  - `/api/queue/casual` POST stamps `mode_pref` on the queue entry.
  - Matchmaker head-to-head pair scan now consults `_casual_mode_prefs_compatible` alongside `_platforms_compatible`. Truth table: `both↔anything`, `ffa↔ffa`, `tdm↔tdm` = compatible; `ffa↔tdm` = incompatible (skipped, so an FFA-only player never lands in a TDM lobby).
  - `_resolve_casual_match_mode` picks TDM vs FFA per match: pinned side wins (both-vs-both → 50/50 roll). Bot-fill honours the caller's exact preference so a solo FFA-only player always bot-fills into FFA.
- Frontend:
  - New `quickMatchModePref` in `settingsStore` (default `"both"`).
  - `QueueContext.joinCasual` reads the setting and forwards it in the POST body.
  - `Lobby.jsx` renders the segmented control (comic-book pow styling matching the existing buttons — red pip = active). Disabled while a queue is live so a mid-queue swap can't corrupt state. `data-testid`s: `lobby-quickmatch-mode-picker`, `lobby-quickmatch-mode-{ffa,tdm,both}`.
- 🧪 8 new regression tests in `tests/test_quickmatch_mode_pref.py` (truth table, pair resolution, bot-fill resolution, Pydantic model default, matchmaker skip on incompatible pair). Full suite 62/62 green.
- Files changed: `/app/backend/server.py` (`QueueFlagsIn`, `_casual_mode_prefs_compatible`, `_resolve_casual_match_mode`, casual queue POST, matchmaker pair-find + bot-fill); `/app/frontend/src/game/settings.js` (new default); `/app/frontend/src/context/QueueContext.jsx` (forward mode_pref in POST); `/app/frontend/src/pages/Lobby.jsx` (segmented control UI + subscribe-driven state).

### Iteration 54 — **THIS SESSION (2026-02-27, fork)**
- 🐛 **"Spawn immunity doesn't work" — root cause found + fixed** — The 3s spawn bubble was being burned instantly on the very first input tick right after respawn. Root cause: the movement-forfeit check used the RAW client→server delta (`dist = hypot(x - player.x, z - player.z)`) with a simple `dist > 0.02` threshold. Right after `_respawn_player` picks a new random spawn location (say `x=45`) and stamps `invuln_until = now+3`, the client is still sending inputs with the OLD (death) position (say `x=10`) until it receives the state broadcast + snaps to the new spawn. That first stale input has `dist ~35 >> 0.02` → the guard zeroed `invuln_until` on tick 1, and the player took full damage from the bots that were already shooting.
- Fix: gate the forfeit on `0.02 < dist <= max_delta` (1.2 units). Anything larger is a client rubber-band / stale sync catch-up (server clamps position but MUST NOT count it as intentional movement). Idle jitter still passes through (dist < 0.02) and real single-tick movement still forfeits (0.02 < dist ≤ 1.2 covers sprint = 0.4/tick).
- 🐛 **"FFA-only put me in TDM" — hardened the routing** — WS handler previously did `wants_tdm = bool(tdm) or bool(matched.get("tdm"))`. That OR meant a residual `?tdm=1` in the URL from an older client bundle could override a matchmaker-decided FFA match. Fix: when `matched` explicitly carries a `tdm` key, that value is authoritative (URL param ignored). Legacy pre-mode-pref matches (no `tdm` key on the entry) still fall back to the URL param.
- 🧪 8/8 spawn-immunity tests pass including the new `test_invuln_survives_respawn_stale_input` covering the stale-input case. Full 51-test regression suite green (spawn-immunity + quickmatch-mode-pref + mobile-ranked + bigffa + tdm + iteration21).
- Files changed: `/app/backend/server.py` (`handle_message` input gate `dist <= max_delta`; WS handler casual `wants_tdm` derivation).

### Iteration 55 — **THIS SESSION (2026-02-27, fork)**
- 🐛 **Quick Match toggles "still random" — hardened with a WS URL fallback** — After Iteration 54 the matchmaker + WS handler were verified end-to-end via curl+websocket (FFA-only → `game_mode: ffa`, TDM-only → `game_mode: tdm`). User still reported randomness, so we removed every remaining hole where the pref could be lost.
- Fix (belt-and-suspenders across the whole stack):
  - Client (`Game.jsx`): forward `mode_pref` (from settingsStore, if set to "ffa" or "tdm") as a WS URL query param on the casual WS connect. Party/ranked/spectate/practice/offline/bigffa ignore it.
  - Server (`ws_game`): accept a `mode_pref: Optional[str]` query param. Precedence for `wants_tdm`:
    1. `MATCHED_USERS[uid].tdm` if the matched entry carries `tdm` (authoritative — set by the matchmaker based on the caller's queue-time preference).
    2. URL `mode_pref` if the matched entry is missing OR lacks the `tdm` key (covers reconnect races, direct dev connects, legacy pre-mode-pref matches).
    3. URL `tdm=1` (legacy flag).
    4. Random 50/50 roll.
- Added structured logging on every casual WS connect showing `matched`, `tdm_url`, `mode_pref`, `wants_tdm` and the chosen room — makes future "wrong mode" reports trivially debuggable.
- 🧪 Verified via direct websocket test (bypassing the matchmaker entirely): `?mode=casual&mode_pref=ffa` → welcome carries `game_mode: ffa`; same URL with `mode_pref=tdm` → `game_mode: tdm`. Full 51-test suite still green.
- Files changed: `/app/backend/server.py` (WS handler `mode_pref` query param + updated casual routing precedence); `/app/frontend/src/pages/Game.jsx` (WS extra params forward `mode_pref` for casual mode).

### Iteration 56 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Rank crest redesign — Marvel Rivals-style chevron ladder** — Replaced the lucide-icon set (Shield, Award, Star, Trophy, Sparkles, Gem, Sword, Skull, Flame) with 9 hand-drawn SVG crests in `/app/frontend/src/components/RankCrestIcons.jsx`. Design ramps from a single V chevron (Bronze) → full crown-with-tail-flourish (Goonmaster, playing the role of the reference art's "Champion"). Each icon is drop-in compatible with the lucide-react API so `<Icon size strokeWidth color />` still works everywhere in the codebase — the `AnimatedRankIcon` wrapper, scoreboard, PlayerCard, HUD, RankUpOverlay, MatchResultOverlay, PartyPanel, Profile, Leaderboard, FriendsModal, and every other consumer swap in transparently.
- 🎨 **Palette updated to match the reference art** — Bronze orange, Silver cool gray, Gold bright yellow, Platinum mint, Emerald bright green, Diamond cornflower blue, Master lime green, Grandmaster purple, Goonmaster magenta. Updated the canonical `RANK_COLORS` in `rankIcons.js` plus 8 hardcoded copies scattered across components (Hud, FriendsModal, PublicProfileModal, MatchResultOverlay, QueueOverlay, PartyPanel, Profile, Leaderboard) in one sweep so nothing drifts. `rankTextColorFor` still returns gold on Goonmaster for readable label text.
- Files changed: new `/app/frontend/src/components/RankCrestIcons.jsx`; `/app/frontend/src/game/rankIcons.js` (icon set + palette); 8 components / pages (sed-replaced hardcoded palette).

### Iteration 57 — **THIS SESSION (2026-02-27, fork)**
- ✅ **SHOW TIERS button restored on mobile** — the button was previously desktop-only (`!hidden sm:!inline-block`). Now shown on every viewport with a compact size scale (`text-xs px-2 py-1` on mobile → full `sm:text-sm px-3 py-1.5` on desktop). Still hidden on mobile-landscape (`[@media(max-height:500px)]:!hidden`) so it doesn't crowd the fold when the lobby is squeezed into a short viewport.
- ✅ **Tiers modal updated to new crests + palette** — Lobby's local `RANK_TIERS` array had a stale hardcoded copy of the OLD palette (Diamond=#9D4EDD purple, Master=#E63946 red, Goonmaster=#000000 black). Updated to match the Iteration 56 reference-art palette (Diamond=cornflower blue, Master=lime green, Goonmaster=magenta, etc.) so the tier-row backgrounds and the local `RankBadge` pill line up with everywhere else. The `AnimatedRankIcon` calls inside the modal already picked up the new chevron crests from Iteration 56 — no change needed there.
- Files changed: `/app/frontend/src/pages/Lobby.jsx` (SHOW TIERS button className + local `RANK_TIERS` palette).

### Iteration 58 — **THIS SESSION (2026-02-27, fork)**
- 🐛 **SHOW TIERS button still hidden on mobile — real fix** — Prior iteration removed the `!hidden sm:!inline-block` gate but kept a `[@media(max-height:500px)]:!hidden` guard. VIRTUE mobile is force-locked to landscape via `OrientationLock` (rotate-device overlay), so every phone loads at ~390px height → the height gate was ALWAYS active → button never rendered. Removed the height gate entirely; the button now shows on every phone/desktop viewport.
- 🧪 Verified via mobile-landscape Playwright screenshot (844×390): button rendered next to the BRONZE rank pill, and clicking it opens the tiers modal with the new chevron crest icons + updated palette (Bronze orange, Silver cool gray, YOU highlight on current division).
- Files changed: `/app/frontend/src/pages/Lobby.jsx` (removed `[@media(max-height:500px)]:!hidden` from the SHOW TIERS button).

### Iteration 59 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Rank crest outlines thickened — designs now legible on tinted backgrounds** — Previous crests painted stroke = fill color, so the shape blended into the tier-row background (Bronze crest on Bronze orange → invisible seams). Fixed in `RankCrestIcons.jsx`:
  - Stroke is now hard-coded `#000` (black comic-book outline) so the crest silhouette pops on any tinted background.
  - Default `strokeWidth` bumped from 2 → 1.5 (viewBox units); `AnimatedRankIcon` already passes `strokeWidth={3}` for the pill so the outline reads chunky and comic-book at any size.
  - Added `vector-effect: non-scaling-stroke` so the outline stays the same apparent thickness whether the crest renders at 16px (scoreboard chip) or 128px (celebration).
- 🧪 Playwright screenshot on 844×500 confirmed the tier modal now shows crisp black-outlined chevrons on the Bronze / Silver / Emerald / Diamond backgrounds — internal seams (double chevron, inner V, wings) all clearly visible.
- Files changed: `/app/frontend/src/components/RankCrestIcons.jsx` (`_svgProps` stroke color + strokeWidth + vector-effect).

### Iteration 60 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Rank crest outlines toned down — tonal blend instead of hard black** — Feedback: previous hard-black outlines were too stark, made the crests look like black skeletons instead of tinted metal. Fix in `RankCrestIcons.jsx`:
  - Stroke changed from `#000` (solid black) → `rgba(0,0,0,0.4)` — semi-transparent black blends with the fill to produce a natural darker-shade outline (Bronze orange → darker orange, Emerald green → deeper green, etc.).
  - Default `strokeWidth` reduced from 1.5 → 1 so the tonal outline stays subtle. `AnimatedRankIcon` still passes `strokeWidth={3}` for the pill.
  - `vector-effect: non-scaling-stroke` preserved so outline thickness stays legible from 16px chips to 128px celebrations.
- 🧪 Playwright screenshot on 844×500 confirmed each crest now clearly shows the design (double chevron, wings, internal V) while feeling tonally cohesive with the tier row background rather than fighting it.
- Files changed: `/app/frontend/src/components/RankCrestIcons.jsx` (`_svgProps` stroke color + default strokeWidth).

### Iteration 61 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Ultimate Gooner (top-50) row now uses the animated flame crest** — The tiers modal was rendering a static red-and-black lucide `Flame` for the Ultimate Gooner row. Swapped it for the existing full-fat `UltimateGoonerCrest` component (halo pulse + rotating rays + orbiting spark trails + flickering flame + gold sheen sweep). Passed `paused={false}` so the animation runs even on mobile (the crest normally auto-pauses on touch devices for perf, but a single row in the tier modal is trivial).
- 🧪 Playwright screenshot confirmed the Ultimate Gooner row now shows the animated flame crest between Grandmaster III and the base rules footer.
- Files changed: `/app/frontend/src/pages/Lobby.jsx` (replaced static `<Flame>` with `<UltimateGoonerCrest paused={false}>`).

### Iteration 62 — **THIS SESSION (2026-02-27, fork)**
- ✅ **Rank crests now animate on mobile** — Both `AnimatedRankIcon` and `UltimateGoonerCrest` previously auto-paused their motion on touch devices via `detectIsMobile()`. That killed the pulse / halo / orbit / flame-flicker across the lobby rank pill, tiers modal, PlayerCard peak crest, and party rows on every phone. Changed both components' default from `paused=null (auto-pause on mobile)` → `paused=false (motion ON everywhere)`. Callers can still opt out explicitly (screenshots / PDFs). `prefers-reduced-motion` still honored via CSS.
- Removed the now-unused `detectIsMobile` imports from both files.
- 🧪 Frontend compiles cleanly. Screenshots at 844×500 (mobile-landscape) confirm the tier modal crests visibly pulse and orbit again.
- Files changed: `/app/frontend/src/components/AnimatedRankIcon.jsx` (paused default + drop useIsMobile import); `/app/frontend/src/components/UltimateGoonerCrest.jsx` (same).

### Iteration 63 — **THIS SESSION (2026-02-27, fork)**
- 🐛 **FFA Quick Match freeze on mobile — belt-and-suspenders self-heal** — Same freeze pattern as the earlier ranked bug reappeared on Quick Match FFA (bots move + shoot, HUD updates, but the local player can't move/shoot because `_matchStarted` stays false). TDM worked because — well, both work for most players; the freeze is a rare-but-real race when the mobile WS drops `match_go`. Investigation showed the SERVER-side self-heal (Iteration 52) works correctly in isolation (verified by 4 new tests in `test_ffa_freeze_selfheal.py`), but relied on the keyframe cadence (~1s) to re-assert `match_started` in unchanged deltas.
- Fix: state broadcast top-level diff now ALWAYS carries `match_started` and `countdown_until` — even when unchanged — so a mobile client that dropped `match_go` self-heals on the very next tick (~50ms) instead of waiting up to 1s. Wire cost is ~10 extra bytes per state message at 20Hz.
- 🧪 4 new FFA-specific regression tests: state broadcast carries `match_started=True` after `_begin_match_now`; state after intermission still carries it; delta ALWAYS carries `match_started` + `countdown_until`; first post-freeze frame is a keyframe. Full 51-test suite green.
- Files changed: `/app/backend/server.py` (`GameRoom.tick` state broadcast — force-include `match_started` + `countdown_until` in every top_diff).





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


### 2026-02-24 — Season reset: Diamond+ lands at Emerald III (seed new tier)
- **User request**: "Emerald Season Reset Bump: On next season roll, land Diamond+ players at Emerald III (instead of Diamond III) so the new tier gets population"
- **Old rule**: RP ≥ 2100 (Goonmaster only) → snap to Diamond III (1200 RP). Everyone else → -900 soft reset.
- **New rule** (`/app/backend/server.py` → `maybe_reset_season`):
  - RP ≥ 1200 (Diamond floor — includes Diamond, Master, Grandmaster, Goonmaster) → snap to EMERALD III (1050 RP).
  - RP < 1200 → -900 soft reset (unchanged, floor 0).
- **Constants renamed**:
  - `GOONMASTER_FLOOR_RP` → `DIAMOND_FLOOR_RP` = `RANK_TIERS[5][0]` = 1200.
  - `DIAMOND_III_RP` → `EMERALD_III_RP` = `RANK_TIERS[4][0]` = 1050.
- **Coverage**: both real-player `update_many` Mongo aggregation branch AND the `_rollback_rp` helper (used for seeded bots) call the same rule so leaderboard bots roll back with players.
- **Preserved**: `peak_rank_points` still `$max`s pre-reset RP → past-season titles and profile "Peak Rank" pill stay intact regardless of the new landing tier.
- **Tests** (`/app/backend/tests/test_season_reset_goonmaster_diamond3.py` — rewritten, 9 cases):
  - Diamond (1200) → Emerald III (1050). Goonmaster (2100, 2700) → 1050. Master (1500) → 1050.
  - Emerald III (1050) → soft reset to 150 (below Diamond floor).
  - Platinum (900) → 0. Bronze (200 / 0) → 0.
  - Source-scan sanity: aggregation uses `DIAMOND_FLOOR_RP` + `EMERALD_III_RP`, `$max` peak-rank branch still present.
  - `EMERALD_III_RP` constant equals `RANK_TIERS[4][0]` = 1050, and Emerald III is confirmed as division 3.
- **Verified**: 15 tests pass in the pytest suite (this file + `test_emerald_tier.py`). Backend hot-reloaded cleanly.


### 2026-02-24 — Uniform 100-RP sub-divisions + Master+ RP cap + Lock-out other queues
- **User request**: "Make every rank tier be 100rp and update the rank tier button to show that" · "Make it harder to gain the full 35 points in masters and higher" · "Make it so you can't click the other queue options when already in queue"
- **Emerald widened to 300 RP** (`/app/backend/server.py` RANK_TIERS + `/app/frontend/src/game/rankIcons.js` + `RankProgressBar.jsx` + `Lobby.jsx`):
  - Emerald now spans 1050→1350 (3 sub-divisions of 100 RP: III 1050-1149, II 1150-1249, I 1250-1349) so every main tier is uniform 300 RP wide.
  - Diamond, Master, Grandmaster, Goonmaster thresholds each shifted +150: 1350 / 1650 / 1950 / 2250.
  - SHOW TIERS lobby modal now displays every tier as `1050 → 1349 RP` etc — 100 RP per sub-division across the entire ladder.
- **Master+ ranked RP cap** (`/app/backend/server.py` ranked branch of `end_match`):
  - Old: `delta = clamp(base + perf, −60, +35)` for every tier.
  - New: cap scales with tier — Bronze..Diamond stays at +35, Master (tier 6) tightens to +20, Grandmaster (7) + Goonmaster (8) tighten further to +15. Loss side still floors at −60 for everyone.
  - Rationale: makes Master+ climbing genuinely slower — a monster carry that would have earned +35 in Diamond now earns +20/+15 in the top tiers.
- **Queue exclusivity** (`/app/frontend/src/pages/Lobby.jsx`):
  - QUICK MATCH button: `disabled` now also fires when `!!queueState` (already in ranked queue).
  - RANKED MATCH button: `disabled` now also fires when `casualInQueue` (already in quick queue).
  - PRACTICE button: `disabled` when in EITHER queue with a helpful title tooltip ("Cancel Quick Match queue to play Practice" / "Cancel Ranked queue to play Practice"). Previously clicking Practice mid-queue would kick the user out of matchmaking.
- **Tests** (all pass, 31 total across affected files):
  - `test_emerald_tier.py` updated: Emerald 300 RP wide, divisions at 1050/1150/1250. Diamond floor now 1350.
  - `test_season_reset_goonmaster_diamond3.py` updated: Diamond floor test uses 1350; Master test uses 1650.
  - `test_master_plus_rp_cap.py` NEW (6 tests): Bronze..Diamond still +35 win cap, Master +20 cap, GM/Goonmaster +15 cap, loss side untouched at −60 for all tiers, modest wins below cap unaffected.
- **Live verification**: SHOW TIERS modal screenshot confirms uniform 100-RP sub-divisions across all 9 tiers. Emerald III: 1050 → 1149, Emerald I: 1250 → 1349, Diamond III: 1350 → 1449. Every row displays correctly.


### 2026-02-24 — AK "bigger bullets" hitbox buff
- **User request**: "Make the ak bullets bigger so they are easier to hit"
- **Implementation** (`/app/backend/server.py`):
  - `WEAPON_CONFIGS["ak47"]` gains `projectile_thickness: 0.45` (metres).
  - `GameRoom.raycast_hit` reads the shooter's weapon thickness and inflates every hitbox sphere radius by that amount (head 0.70→1.15, torso 0.85→1.30, legs 0.80→1.25). Sniper / laser default to thickness 0.0 → stay pinpoint.
  - Net effect: AK near-misses within ~0.45 m of the player capsule now register, while precision weapons keep their existing tight hitboxes.
- **Tests** (`/app/backend/tests/test_ak_hitbox.py` — 5 cases, all pass):
  - Config declares positive thickness; sniper/laser stay at 0.
  - AK hits a target at 1.10 m lateral offset that the sniper misses.
  - AK still misses a target 2.5 m off the aim line (buff is bounded).
  - Dead-on AK shot still lands with correct body_part + distance.
- **Related suites** (23/23 pass): lag compensation, sniper weapon, sniper rework, AK fire rate — no regressions.


### 2026-02-24 — Mobile lobby freeze/lag fix
- **User report**: "Game freezes and lags on mobile in the lobby" (both Preview and Production). Button taps sluggish; constant stutter after login, tab switches, and idle.
- **Root cause**: The active castle/meteor/snow lobby backdrops each stack ~30 CSS keyframe animations that use `filter: blur()` and `filter: drop-shadow()` (twinkling stars, flickering torches, castle-window flames, drifting fog blobs). Every frame triggers a full composite + repaint that saturates mobile GPUs. On top of that, every visible `AnimatedRankIcon` (rank pill, avatars) and `UltimateGoonerCrest` runs their own halo-pulse / rays-spin / orbit-track / sheen-sweep animations forever.
- **Fix**:
  - `/app/frontend/src/game/useIsMobile.js` (NEW): `detectIsMobile()` helper + `useIsMobile()` hook. Reports true for touch primary, coarse pointer, no-hover media, or viewport <900px.
  - `/app/frontend/src/pages/Lobby.jsx`: `animatedBg` state initializer + `virtue-settings-changed` handler now hard-force OFF when `detectIsMobile()` is true. Mobile users get the calm castle subset (sky + moon + silhouette, no filters) regardless of their saved setting. Desktop behaviour unchanged.
  - `/app/frontend/src/components/UltimateGoonerCrest.jsx`: `paused` default changed from `false` to `null` → auto-pauses on mobile (`data-paused="true"` freezes halo, rays, 3 orbit tracks, sheen sweep, and flame flicker).
  - `/app/frontend/src/components/AnimatedRankIcon.jsx`: same auto-pause pattern — mobile gets a static rank crest, desktop keeps full motion.
- **Verified live**: Mobile viewport (844×390) shows zero `.lobby-castle-star`, `.lobby-castle-torch`, `.lobby-castle-window` elements and rank icon carries `data-paused="true"`. Desktop viewport (1920×800) still renders all animated layers. Frontend compiled cleanly, no lint issues on touched files.


### 2026-02-24 — Uniform 300 RP tier bands (100 RP per division, fixes Show Tiers)
- **User request**: "Make sure every tier in every rank is 100rp and make sure it updates on the show tiers button".
- **Bug**: Platinum was only 150 RP wide (900→1049) — the earlier "standardize to 300 RP" pass squeezed Platinum when Emerald was inserted, giving Platinum I/II/III each only 50 RP instead of the promised 100. Every other tier was already 300 RP wide.
- **Fix**: Shifted every tier above Platinum up by +150 RP so Platinum, Emerald, Diamond, Master, Grandmaster and Goonmaster all become exactly 300 RP bands (100 per division):
  - Backend (`/app/backend/server.py`): `RANK_TIERS` now (0, 300, 600, 900, **1200**, **1500**, **1800**, **2100**, **2400**). `GOONMASTER_FLOOR` seed constants + the seed RP bucket (was 2100..3800) also shifted to 2400..3800. `TIER_RP_WINDOWS` (seed "top off" pass) realigned to the new bands so bots pick RP inside their intended tier band. Comments referencing 1050/1200/1350/1650/1950/2250/2100 updated to the new values.
  - Frontend: `RankProgressBar.jsx` + `game/rankIcons.js` `RANK_THRESHOLDS` and `Lobby.jsx` `RANK_TIERS` (drives the Show Tiers modal) all updated to the same grid. Emerald-only 50 RP-per-division comment removed.
- **Show Tiers modal** (verified live at 1400×900): every row shows a 300 RP header band + 3× 100 RP sub-division rows. Bronze 0→299 / 0-99 / 100-199 / 200-299 … all the way through Grandmaster 2100→2399 / 2100-2199 / 2200-2299 / 2300-2399, and Goonmaster at 2400+.
- **Tests**: `/app/backend/tests/test_emerald_tier.py` updated for the new thresholds + added a "every band is exactly 300 RP" assertion. 17/17 tier + placement tests pass.
- **NOTE on live players**: users who were sitting in Emerald III (1050-1149 old) or Diamond III (1350-1449 old) may see a small tier re-classification since their absolute RP is unchanged but the boundary moved by 150. Season resets and RP earned are unaffected; the Diamond+ season-reset landing (Emerald III) still uses `RANK_TIERS[4][0]` so the reset math scales automatically.


### 2026-02-24 — White-screen at match end (ranked + casual, both envs)
- **User report**: "White screen instead of victory and defeat screen in ranked" — happens every match, on both Preview and Production.
- **Root cause**: `MatchResultOverlay.jsx` referenced an **undefined variable** `idx` inside two `data-testid` template literals (lines 428 + 442) — but the scoreboard map iterates with `i`, not `idx`. Every mount threw `ReferenceError: idx is not defined`, unwound the React render, and the overlay came up blank. Introduced by the earlier Emerald + animated post-match icons commit (`ff001ae`) — `AnimatedRankIcon` was slotted in with copy-paste `idx` references that never existed in the surrounding scope.
- **Fix**: swap `${idx}` → `${i}` in both `data-testid` templates. Frontend hot-reload confirms the fix — bundle now serves `match-result-rank-${i}` and lobby + modals raise zero JS errors under Playwright.
- **Regression guard**: `/app/backend/tests/test_match_result_overlay_no_idx.py` (2 cases, both pass) — grep-guards the file for any `${idx}` inside a template literal AND asserts the placement `.map((p, i) => ...)` shape hasn't drifted, so a future refactor can't reintroduce the same typo.
- **Note**: Ranked and casual matches both hit this bug (it lived in the shared scoreboard render), even though the user framed it as ranked-only.


### 2026-02-24 — Bots show full rank + division on end-match scoreboard
- **User request**: "Make the bots on the end match screen show the rank tier they are in not just rank" — bot rows on the post-match scoreboard were displaying just the tier name (e.g. "DIAMOND") instead of tier + division ("DIAMOND II"), while real-player rows showed the full label.
- **Root cause**: `GameRoom.end_match` (`/app/backend/server.py`) built the bot placement dicts WITHOUT a `rank_division` key in both the ranked branch (line ~5781) and the casual branch (line ~5818). The frontend fallback `divisionRoman(p.rank_division)` returned empty, so only the tier name rendered. Real-player rows already included `rank_division`, which is why the visual asymmetry only affected bots.
- **Fix**: Both bot rows now compute `rank_division = rank_division_for_points(disguise_rank_points, rank_tier)` from the bot's disguised RP field (already assigned at spawn / disguise refresh) and include it alongside `rank_name`. Also filled in the previously-missing `prev_rank_division` for parity with real-player rows and added `rank_division` to the casual real-player row for consistency.
- **Tests** (`/app/backend/tests/test_match_end_bot_division.py` — 7/7 pass): parametrized cases across Bronze III, Gold II, Emerald II, Diamond I/II/III verify each disguise RP → correct roman-numeral division. A grep guard also anchors both branches so a future refactor can't silently drop the division key again.


### 2026-02-24 — Bigger tier-up cinematic + fires on ANY code that crosses a boundary
- **User request**: "Post-Match Rank-Up Cinematic: Play a bigger celebration when the tier boundary is crossed, not just a division bump — and make sure it plays even when you use code."
- **Bug 1 — code never celebrates unless the reward is `rank_up_tiers`**: `/api/codes/redeem` only built the `rank_up_payload` for the explicit `rank_up_tiers` reward type. A plain `rp` code that pushed the player across a tier boundary silently updated `rank_points` with no overlay. Fixed by refactoring the endpoint to compute total inbound RP first (`inc_rp = update_ops.$inc.rank_points`), then run a **unified** rank-up detection: any positive RP change that crosses a tier OR division boundary emits `rank_up_payload` with an explicit `kind` ("tier" | "division").
- **Bug 2 — tier & division celebrations felt too similar**: Both variants had the same visual weight. Now the "tier" variant is meaningfully bigger:
  - New **"★ TIER PROMOTION ★"** eyebrow above the RANK UP! banner (tier only).
  - 40-piece **colored confetti rain** kicks in the moment the new crest assembles (tier only).
  - Second **mega shockwave ring** (~1.6× the primary ring, slower, higher opacity) overlays the crest during the shatter → assemble beats (tier only).
  - Star shower bumped **24 → 36 particles** (tier only; division stays at 12).
  - **Fanfare audio**: `audioBus.victory()` plays for tier, lighter `audioBus.matchStart()` chirp plays for division.
- **Files touched**:
  - `/app/backend/server.py` — `redeem_code`: unified rank-up detection block that inspects the net RP grant across all reward types and stamps `kind: "tier" | "division"`.
  - `/app/frontend/src/components/RankUpOverlay.jsx` — audio + eyebrow + confetti + mega shockwave + star count bump; `useMemo` hoisted above the early-return guard to keep hook order stable.
  - `/app/frontend/src/index.css` — two new keyframes: `rankup-confetti-fall` and `rankup-mega-ring`.
- **Tests** (`/app/backend/tests/test_code_redeem_rank_up_kind.py` — 9 cases, all pass): tier crossings return `kind: "tier"` for Bronze I→Silver III, Platinum I→Emerald III, Diamond I→Master III, multi-tier leaps; same-tier bumps return `kind: "division"` for Bronze III→II and Gold II→I; grants that don't cross any boundary return None; a grep guard anchors the explicit `kind` field in the endpoint so future edits can't silently regress. Combined with prior suites: 29/29 relevant pytests pass.
- **Live smoke test**: dispatched synthetic `virtue-rankup` events from Playwright — tier overlay renders eyebrow + confetti + mega-ring; division overlay confirms none of the tier-only elements mount.


### 2026-02-24 — Enforce case-insensitive username uniqueness at register
- **User request**: "Make it so you can't make an account with a name already in use and can't change it to one already used by another player."
- **Bug**: `/api/auth/register` only checked email uniqueness. Two accounts could sign up with the SAME username ("Alice" and "alice") which then rendered identically in kill feeds, friends lists, and the leaderboard. The rename endpoint (`/api/profile/me/username`) already enforced case-insensitive uniqueness — this change brings register into line.
- **Fix** (`/app/backend/server.py::register`):
  - Trim leading/trailing whitespace so "  alice  " collides with "alice".
  - Validate against `USERNAME_PATTERN` (`^[A-Za-z0-9_.-]{2,20}$`) — same regex the rename endpoint uses, so a name that would be rejected on rename is also rejected at signup (no more locking users into un-renameable names).
  - Case-insensitive Mongo lookup (`$regex ... $options: i`) — same query shape as the rename endpoint. Returns HTTP 409 "That username is taken." on collision.
  - `AuthContext.register` already surfaces `detail` via `formatApiErrorDetail`, so the Register UI shows the exact message with no frontend changes needed.
- **Live smoke test** (Preview): duplicate "player1" → 409; fresh "dupe_1786763943" → registered; uppercase of the just-created name → 409. All correct.
- **Tests** (`/app/backend/tests/test_username_uniqueness.py` — 12/12 pass, uses an in-memory Mongo double via `monkeypatch`): first register succeeds, exact duplicate rejected, case-insensitive duplicate rejected (parametrized over "alice"/"ALICE"/"aLiCe"), whitespace-trimmed duplicate rejected, distinct usernames still allowed, invalid formats blocked at HTTP 400 (parametrized), and the rename endpoint's existing case-insensitive check is asserted so a future consolidation refactor can't weaken either side. Combined suites: 41/41 pytests pass.


### 2026-02-24 — Phase 1 refactor of server.py: `_lib/` package for pure helpers
- **User request**: "Refactor engine.js: split the 6,000-line client engine into smaller systems (rendering, input, netcode). Refactor server.py: break the 9,500-line backend into routers and managers for maintainability."
- **Scope shipped this session**: Phase 1 of the server.py refactor only — a safe, behavior-preserving extraction of pure-logic helpers into a new `/app/backend/_lib/` package. server.py went from **9,634 → 9,510 lines** (−124). Engine.js was NOT touched (zero test coverage on the client engine + limited remaining session context = high risk of breaking the whole app with a white-screen; deferring to a dedicated future session).
- **New package** `/app/backend/_lib/`:
  - `__init__.py` — package docstring + import-only rules (no `db`, no FastAPI types, no side effects at import time).
  - `ranks.py` (137 lines) — `RANK_TIERS`, `MASTERS_TIER_IDX`, `PLACEMENT_PERF_BONUS_CAP`, `PLACEMENT_PERF_PENALTY_CAP`, `PLACEMENT_HIGH_TIER_WIN_CAP`, `rank_for_points`, `rank_division_for_points`, `rank_division_roman`, `compute_rp_delta`, `compute_placement_delta`. Any future ladder shuffle now touches ONE file.
  - `security.py` (79 lines) — `JWT_ALGORITHM`, `ACCESS_TTL_MIN`, `REFRESH_TTL_DAYS`, `hash_password`, `verify_password`, `get_jwt_secret`, `create_access_token`, `create_refresh_token`, `set_auth_cookies`. Pure crypto — nothing that touches Mongo. The `db`-dependent auth pieces (`_user_from_token`, `get_current_user`) intentionally STAYED in server.py because they hold the module-level Mongo client.
- **Public API preserved**: server.py re-exports every extracted symbol at the top of the file via explicit `from _lib.ranks import ...` / `from _lib.security import ...` blocks. Existing callers (`server.RANK_TIERS`, `server.hash_password`, ...) and the ENTIRE pytest suite work unchanged — zero test breakage.
- **Verified**: 75/75 targeted regression tests pass (rank, tier, emerald, placement, auth, password, username, forgot, ak-hitbox, code-redeem, match-end-bot, match-result-overlay, master-plus-rp-cap, ffa-lobby-cap). Backend boots clean, frontend renders lobby with zero JS errors. Two pre-existing timing-flaky tests (`test_bot_fill_bands`, `test_bot_rp_scoreboard`, `test_ranked_botfill_*`) were failing BEFORE the refactor too — confirmed by stashing my changes and rerunning.
- **Backlog — Phase 2+ of the refactor** (deliberately not attempted this session):
  - Extract `schemas.py` for the 15+ Pydantic `*In` models (~90 lines savings).
  - Extract `config.py` for `WEAPON_CONFIGS`, `PLAYER_HEIGHT`, `MAX_HP`, `PLACEMENT_MATCHES`, `RANKED_LEAVE_*`, arena constants (~150 lines savings).
  - Extract `routes/auth.py`, `routes/profile.py`, `routes/matchmaking.py`, `routes/social.py`, `routes/admin.py`, `routes/codes.py`, `routes/leaderboard.py` — each endpoint group becomes its own APIRouter mounted onto `api`. Highest maintainability win; needs careful `get_current_user` + `db` re-wiring per file.
  - Extract `game/room.py` (the 4,000-line `GameRoom` class + tick loop + `raycast_hit`) and `game/bots.py` (bot spawn / disguise / AI). Biggest single-file win, but also the highest coupling.
  - **engine.js refactor** — needs a fresh session with a testing agent smoke-test after each extraction, since there's no unit-test safety net on the client engine.
- **How to continue in a future session**: The `_lib/` package pattern established here is the template — add a new file, move a self-contained block, re-export from `server.py`, run the regression suite, done. Recommend one extraction per session (~200-400 lines each) so a broken import always shows up quickly.


### 2026-02-24 — Admin moderation: lobby users counted + peak player tile
- **User request**: (1) "Make real online player stat in moderation show people also just in lobby." (2) "Add peak playercount to moderation." (3) "Make it so new accounts can't use already existing name." — #3 already shipped last session (`/api/auth/register` case-insensitive uniqueness); verified still in place.
- **Bug 1 — lobby users invisible**: `real_online` in `/api/admin/live-stats` was `len(ONLINE_USERS)` (WS-only), so anyone browsing challenges / friends / shop from the lobby didn't count. `is_online()` (used by friend cards) already unioned WS + heartbeat correctly — the admin endpoint just wasn't using the same logic.
- **Fix — `count_real_online()` helper + peak tracking** (`/app/backend/server.py`):
  - New module-level `PEAK_ONLINE = {"value": 0, "at": None}` stores the all-time high-water mark. Kept in memory only; server restart resets it (fine for a live-monitoring signal).
  - New `count_real_online()` unions `ONLINE_USERS` keys (in-match) with fresh `PRESENCE_HEARTBEAT` keys (lobby, <= `HEARTBEAT_TTL` seconds old) — de-duplicates a user who has both (tab reload edge case) — GCs stale heartbeats opportunistically — and bumps `PEAK_ONLINE` when the count climbs.
  - `/api/admin/live-stats` now returns 4 new fields alongside the existing `real_online`: `real_online_in_match`, `real_online_in_lobby`, `peak_online`, `peak_online_at` (ISO timestamp).
- **Fix — Admin Moderation dashboard** (`/app/frontend/src/pages/AdminReports.jsx`):
  - Replaced the "Parties" tile in the headline row with a new **PEAK ONLINE** tile (yellow) showing the peak count + human-readable "Aug 17, 08:27 PM" timestamp.
  - **REAL ONLINE** tile now shows a sub-label `"N in-match · M in lobby"` so admins can see the mix at a glance.
  - Parties moved to a compact secondary row below so nothing important got dropped.
  - Added `sub` prop to the shared `HeadlineTile` component for reuse.
- **Live verification** (Preview): Admin login → heartbeat ping → `/api/admin/live-stats` returns `real_online: 1, real_online_in_match: 0, real_online_in_lobby: 1, peak_online: 1, peak_online_at: "2026-08-17T20:27:40Z"`. Screenshot confirms all three tile changes render clean, zero JS errors.
- **Tests** (`/app/backend/tests/test_admin_real_online_peak.py` — 8/8 pass): WS users count, lobby heartbeat users count, union without double-count, stale heartbeats dropped + GC'd, peak climbs on growth, peak persists across dips, peak timestamp parses as ISO 8601, grep-guards on `count_real_online()` + `peak_online` + `real_online_in_lobby` in the endpoint source. Combined with prior suites: 51/51 relevant pytests pass.


### 2026-02-24 — Bot/weapon tuning pass + Moderation matches-last-24h
Five user-requested changes shipped together (all backend-side + one admin UI panel).

**1. Matches Played — Last 24h (Moderation dashboard)**
- New Mongo aggregation in `/api/admin/live-stats` collapses `db.match_history` by `(match_id, game_mode, mode)` FIRST (so a 4-player match counts as 1, not 4), then groups by mode. Emits `matches_last_24h: {ffa_casual, ffa_ranked, tdm_casual, total}`.
- Admin UI adds a dedicated "Matches Played — Last 24h" panel with a total tally in the header + three color-coded mode tiles (`ModeCountTile`). Reuses `Activity` icon from lucide.

**2. Nerf sub-Platinum bots (casual + party FFA)**
- Casual room seed spawn (`server.py` line ~975) and refill (~3830) both drop 1.15 → **0.9** difficulty. Party room fill bots also drop to 0.9 so a 2-person party doesn't get slammed by fill bots harder than quick-match. Ranked bots stay at **1.9**, TDM at **1.45** — nerf targets sub-Plat only.

**3. AK small buffs**
- `projectile_thickness` 0.45 → **0.55** (near-miss hitbox forgiveness bumped once more per user).
- `cooldown_ms` 320 → **285** (~12% faster fire rate, ~3.5 → ~3.9 shots/s). Local override so sniper/laser cooldowns don't drift.

**4. Smarter Diamond+ bots WITHOUT stat buffs**
- New `elite` behavioural flag in `_tick_bots`: `smart and bot.rank_tier >= 5`. Damage / HP / cooldowns untouched. Only behaviour:
  - Target lock refresh **0.8s** (vs 1.5s smart / 0.5s casual) — elites switch focus to wounded threats faster.
  - Cover-seek activates at **HP < 65** (vs < 45) — elites protect HP earlier.
  - Lead prediction scale **0.27** (vs 0.18) — punishes sustained strafers.
- Regression guard test asserts NO stat scaling anywhere is keyed on `elite` (grep for `bot.max_hp *=`, `damage *=`, etc. within 60 chars of `elite`).

**5. Anti-stuck bot movement**
- Pursuit + wander branches now share the same slide-fallback: when BOTH X and Z axes are blocked, try a perpendicular slide (both `+/-` directions). If both fail, nudge `bot_strafe_t` to rotate the heading for the next frame. Fixes the "bots freeze against boxes / walls" complaint.
- Wander branch (target-less) had the same freeze bug — same fix applied there.

**Tests** (`/app/backend/tests/test_bot_and_weapon_tuning_2026_02.py` — 19/19 pass):
- `TestAKBuffs` — thickness == 0.55, cooldown == 285, cooldown in safe [250, 320] window, sniper/laser stay pinpoint.
- `TestCasualBotsNerfed` — casual startup + refill + party rooms all at 0.9; ranked stays at 1.9.
- `TestElitesSmarterWithoutStatBuffs` — `elite` gated on tier >= 5; grep-guards on lock_dur / cover_hp / lead_scale; forbid-list check that no `elite`-keyed stat scaling was smuggled in.
- `TestBotAntiStuck` — pursuit + wander perpendicular slide code both present, slide tries both directions.
- `TestMatchesLast24hAggregation` — endpoint computes the dict, dedupes by `match_id`, includes the key in the response.
- 74/74 pass across all recent regression suites.

**Live verification** (Preview 1400×900): Admin Moderation dashboard renders new panel with 0-count tiles (fresh data), Peak Online + Real Online in-match/in-lobby split all present, zero JS errors. Backend startup logs confirm casual bots spawn at `diff=0.90`.


### 2026-02-24 — Custom party lobby with bot toggle + casual smurf-bot injection
Two user requests shipped together.

**1. Party Custom Lobby with bot toggle**
- `/api/party/start` now accepts an optional JSON body: `{"bots_enabled": bool, "tdm": bool}`. Legacy callers (no body) still work — defaults are `bots_enabled=True`, `tdm=False`. Flags persist on the in-memory party dict.
- `/api/party/me` payload gains `bots_enabled` + `tdm` fields so member clients can see the leader's chosen settings while polling.
- `get_or_create_party_room` reads `party["bots_enabled"]` and `party["tdm"]`. When bots are disabled, `bot_count = 0` (human-only lobby). Passes `game_mode="tdm"` when the TDM flag is on so the private room spawns as team-based.
- **Frontend `PartyPanel.jsx`**: New "CUSTOM LOBBY" purple button + adjacent "BOTS ON/OFF" toggle (green/white). Toggle sits right next to the button per user request. Leader-only. Both disabled while any queue is active. Clicking Custom Lobby POSTs `/party/start` with the current toggle state, then navigates the leader immediately to `/game?mode=party&party_id=<id>`. Party members auto-navigate via a new `useEffect` that watches `party.match_starting` (5s poll cadence, member skips their own leader nav so no double-nav).

**2. Higher-ranked bots into casual sometimes ("smurf" bots)**
- New module-level constants: `CASUAL_ELITE_BOT_RATIO = 0.15` (~1 in 7 casual fill bots), `CASUAL_ELITE_BOT_DIFF = 1.7` (clears the 1.5 smart-AI threshold, below full ranked 1.9).
- The casual FFA auto-balance path (`_maintain_population`) now rolls a `random.random() < CASUAL_ELITE_BOT_RATIO` check per fill. On hit: spawns the bot with `disguise_tier_idx=5` (DIAMOND) + a Diamond II mid-band RP (1550-1690) + `difficulty=CASUAL_ELITE_BOT_DIFF`. Gate is explicit — ranked and TDM rooms skip smurfs (they already have proper tier-calibrated bots).
- Constants exposed for future admin tuning without touching the spawn logic (per user's "expose it in admin settings later" ask).

**Verification**
- **Tests** (`/app/backend/tests/test_party_lobby_and_smurf_bots.py` — 10/10 pass):
  - `TestPartyCustomLobbySettings` — default bots-enabled, `/party/me` exposes both flags, room-spawn helper skips bot-fill when disabled + honours TDM.
  - `TestCasualSmurfBotsInjection` — constants present + within sane bounds, smurf gated on casual FFA (grep both `game_mode == "ffa"` and `is_smurf = (` context), uses Diamond tier disguise + elite diff constant, ratio default in the "reasonable" 0.05-0.35 band.
  - `TestSmurfProbabilityHoldsAcrossManyRolls` — 2000-trial Monte Carlo confirms the ratio empirically matches the module constant within ±0.05.
- 76/76 pass across all recent regression suites. Live `curl` confirms `/party/start` accepts both new-body and legacy no-body callers.


### 2026-02-24 — Admin Smurf-Ratio Slider (live-tunable, no redeploy)
- **User request**: "Admin Smurf Slider: expose CASUAL_ELITE_BOT_RATIO in the moderation dashboard so you can dial the smurf frequency without a redeploy."
- **Backend** (`/app/backend/server.py`):
  - Converted the previously-frozen constant into a runtime-mutable state: `_CASUAL_ELITE_BOT_STATE = {"ratio": 0.15}` + helper `_get_casual_elite_bot_ratio()`. Module attribute `CASUAL_ELITE_BOT_RATIO` kept in sync via the setter so existing pytests reading `srv.CASUAL_ELITE_BOT_RATIO` still see current value.
  - Spawn loop switched from `< CASUAL_ELITE_BOT_RATIO` (frozen at startup) to `< _get_casual_elite_bot_ratio()` (live read).
  - New endpoints (admin-only):
    - `GET /api/admin/settings/smurf` — returns `{ratio, diff}`.
    - `POST /api/admin/settings/smurf` — accepts `{ratio: 0.0-1.0}` (Pydantic `Field(ge, le)` clamps → 422 on invalid). Logs the change with the admin's username.
  - Persistence is process-memory only (matches `PEAK_ONLINE` and `SYNTHETIC_ONLINE`). Server restart snaps back to 0.15.
- **Frontend** (`/app/frontend/src/pages/AdminReports.jsx`):
  - New `SmurfRatioSlider` component under the "Matches Played — Last 24h" panel: purple accented 0-100 range input + big % display + subtitle explaining what the value does.
  - **Debounced save**: 250ms after the user stops dragging, POST fires. Prevents backend spam during a slider drag. Shows `Loader2` "saving…" pill during the request and a green "✓ saved" pill for 900ms after success.
  - Loads current value on mount via GET so the slider always reflects live state (not a stale UI cache).
- **Tests** (`/app/backend/tests/test_admin_smurf_slider.py` — 9/9 pass):
  - GET requires admin (403 for non-admin), returns default 0.15.
  - POST mutates module state visible to the spawn helper AND keeps `CASUAL_ELITE_BOT_RATIO` module attr in sync.
  - Pydantic rejects `ratio > 1.0`, `ratio < 0.0`; allows edge cases 0.0 and 1.0.
  - Non-admin POST rejected (403), state unchanged.
  - Grep guard: spawn loop uses `_get_casual_elite_bot_ratio()` (not the frozen constant) so runtime edits are actually respected.
  - 46/46 pass across all recent regression suites (smurf slider + party lobby + weapon tuning + admin live-stats).
- **Live smoke** (Preview, 1400×900): slider loaded at 15% → dragged to 40% → display updated → API confirmed `{ratio: 0.4}` → "✓ saved" flash captured → reset to 15% cleanly. Zero JS errors.


### 2026-02-24 — Fix white-flash when clicking Custom Lobby in a party
- **User report**: "When in party and click custom game. Screen flashes white and nothing happens." (Both Preview and Production.)
- **Two-part root cause** in `PartyPanel.jsx` (my own regression from the Custom Lobby feature shipped earlier this session):
  1. **Wrong path** — I navigated to `/game?mode=party&party_id=X` but the React Router route in `App.js` is `/play`. Hitting `/game` matched no route → empty render → white flash.
  2. **Missing `state.fromLobby`** — even the correct `/play` path is wrapped by `MatchEntryGuard`, which redirects back to `/lobby` unless `location.state.fromLobby === true`. So a `/play` nav with no state would also flash white (bounce → /lobby).
- **Fix**: Both navigate call sites (leader `startCustomLobby` and member auto-nav `useEffect`) now use:
  ```js
  navigate(`/play?mode=party&party_id=...`, { replace: true, state: { fromLobby: true } });
  ```
  This mirrors the exact pattern QueueContext already uses when the matchmaker fires (`nav("/play?mode=casual", { replace: true, state: { fromLobby: true } })`).
- **Tests** (`/app/backend/tests/test_custom_lobby_navigation.py` — 4/4 pass):
  - Grep guard: leader `startCustomLobby` uses `/play` (not `/game`).
  - Grep guard: leader nav stamps `state: { fromLobby: true }`.
  - Grep guard: member `useEffect` uses `/play` + stamps state.
  - "Belt and suspenders" — no stray `/game?mode=party` references anywhere in PartyPanel, so a future refactor can't silently reintroduce either half of the bug.
  - Combined with prior suites: 23/23 pass across Custom Lobby + smurf slider + party settings.


### 2026-02-24 — Master+ ranked RP cap unified to +35 (harder to reach)
- **User request**: "In Masters and up games make it so you can still gain 35 points, it's just harder."
- **Previous behavior** (from an earlier session): the cap TIGHTENED at high tiers — Master +20, Grandmaster/Goonmaster +15. Players complained they couldn't ever get the full climb reward.
- **New behavior**: cap is uniformly **+35 across every tier**. Instead of tightening the ceiling, we tighten the *perf formula* so hitting +35 at Master+ requires a dominant carry:
  - `raw_perf = kills * 3 − deaths * 5` (unchanged).
  - **Master** (tier 6): `perf = int(raw_perf * 0.55) − 15` — the "Master tax". A 27/3 game barely nudges past the cap (perf ≈ 21), so mid-pack plays land well short of +35.
  - **GM+** (tier 7-8): `perf = int(raw_perf * 0.4) − 20` — the "GM+ tax". Same 27/3 game only just clears (perf ≈ 6, +35 is a razor's-edge ceiling).
  - Below Master: unchanged.
- **Sanity numbers** (all verified in `test_master_plus_rp_cap.py`):
  - Silver 27/3 → +35 (trivial).
  - Master 27/3 → +35 (tight — dominant only).
  - Master 15/5 → +26 (used to be +35 → visibly *harder*).
  - Master 5/5 win → +10 (used to be ~+20).
  - GM+ 27/3 → +35 (razor-thin).
  - GM+ 15/5 → +18.
  - Loss floor still −60 at every tier.
- **File changed**: `/app/backend/server.py::end_match` ranked delta branch. Comment header rewritten with the new formula + expanded worked examples.
- **Tests**: Rewrote `test_master_plus_rp_cap.py` (11/11 pass). Deleted old cap-tighten assertions; added new cases for the perf-tax formula + a grep guard on the endpoint source. 89/89 across all recent regression suites still green.


### 2026-02-24 — 2nd place at Master+ now gains a small amount of RP
- **User request**: "Make it so you can gain a small amount of points for 2nd place in ranked."
- **Bug**: previously `compute_rp_delta` returned `+0` base for 2nd place at Master+. Combined with the perf tax (Master `-15` flat, GM+ `-20` flat), even a decent 2nd-place finish would land NEGATIVE — a player with 8K/5D finishing 2nd at Master lost 15 RP, which felt awful.
- **Fix** in `/app/backend/_lib/ranks.py::compute_rp_delta`:
  - Master+ 2nd place base delta: **0 → +25**. Combined with the perf tax, a decent 2nd (K/D ≈ 1.0) now nets a small positive delta while a hard-throw 2nd still bleeds.
  - 1st place, 3rd+, and sub-Master curves unchanged.
- **Sanity examples** (all covered by pytests):
  - Master 8K/5D + 2nd → **+10** RP (was −15).
  - Master 3K/9D + 2nd → **−9** RP (still a loss — no free ride).
  - GM+ 5K/5D + 2nd → **+1** RP (razor-thin small positive).
  - GM+ 10K/5D + 2nd → **+7** RP.
- **Tests** (`test_master_plus_rp_cap.py` — 15/15 pass, added 4 new cases):
  - `test_master_2nd_place_middling_kd_now_small_positive` — the specific +10 case above.
  - `test_master_2nd_place_bad_kd_still_loses` — asserts the bonus doesn't shield hard throws.
  - `test_gm_2nd_place_average_kd_still_small_positive` — verifies GM+ still gets a positive floor from a decent game.
  - `test_ranks_compute_rp_delta_2nd_place_master_plus_is_25` — direct assertion on the base value in the source of truth.
- **File touched only in `_lib/ranks.py`** — the pure-math extraction from the earlier refactor paid off: this was a one-line change in the extracted module, no server.py churn. 80/80 pass across all recent regression suites.


### 2026-02-24 — Weapon picker to top of Profile + Mobile crosshair auto-fire
Two quality-of-life changes shipped together.

**1. Weapon Loadout moved to top of Profile page**
- Previously the `WeaponLoadoutPicker` lived inside the "Customize" section (below Rank / Level / Level Rewards). Users had to scroll past ~5 sections to swap primaries.
- Now: new **"Weapon Loadout"** section header sits **immediately below the hero banner**, above "Your Rank". Verified via bounding-box in the live smoke test: weapon-section y=499 vs rank-section y=696 → weapon-above-rank confirmed.
- `onChange` still calls `refreshMe?.()` so the lobby loadout badge doesn't go stale after a swap.

**2. Mobile auto-fire triggers when crosshair passes over enemy**
- Previously mobile auto-fire only ran while the LOOK PAD was being held — you had to be actively aiming (finger down) for shots to fire.
- Now: a new block in `Engine._update()` fires the current weapon automatically the instant `hasEnemyInCrosshair()` returns true — even when the look pad isn't being touched. The player just needs their crosshair to sweep across an enemy.
- Rate-limited to the AK cadence (`_akFireCooldownMs` ≈ 285ms) via new `_lastTouchAutoFireMs` timestamp so a slow drag past a target only fires once per cooldown (not per frame).
- Only runs when `touchActive`, alive, not reloading, and match started — never activates on desktop.
- Applies to ALL weapons (AK, sniper, laser). Server rate-limiting is the final backstop.
- Also tightened the existing AK hold-to-fire tick: now also gates on `hasEnemyInCrosshair()` in touch mode so mag doesn't drain on empty sky drags.

**Files touched**:
- `/app/frontend/src/pages/Profile.jsx` — reordered JSX blocks.
- `/app/frontend/src/game/engine.js` — new touch auto-fire block in `_update()`, `_lastTouchAutoFireMs` init, AK-tick crosshair guard for touch mode.

**Tests** (`/app/backend/tests/test_profile_weapon_top_and_mobile_autofire.py` — 8/8 pass): grep-guards that assert weapon-section renders before rank-section in Profile.jsx, and the engine still has the touch auto-fire block with all four required properties (touch-active gate, cooldown check, `hasEnemyInCrosshair()` call, `_lastTouchAutoFireMs` initialised). Combined suites: no regressions.


### 2026-02-24 — Elite Diff Slider added to Moderation dashboard
- **User request**: "Elite Diff Slider Too: expose CASUAL_ELITE_BOT_DIFF in the Moderation dashboard so you can tune how sharp the smurfs feel, not just how often they show up."
- **Backend**:
  - `_CASUAL_ELITE_BOT_STATE` now holds both `ratio` AND `diff`. Two live-tunable helpers: `_get_casual_elite_bot_ratio()` and new `_get_casual_elite_bot_diff()`.
  - Smurf spawn call switched from the frozen `CASUAL_ELITE_BOT_DIFF` constant to `_get_casual_elite_bot_diff()` so slider changes take effect on the next fill.
  - `SmurfRatioIn` Pydantic model made partial-update friendly: both `ratio` and `diff` are now `Optional`. `diff` clamped to `[1.5, 2.5]` — below 1.5 kills the smart-AI upgrade, above 2.5 out-guns full ranked (1.9).
  - `POST /api/admin/settings/smurf` accepts any subset; only the fields present are applied. GET always returns both.
- **Frontend** (`AdminReports.jsx`): `SmurfRatioSlider` panel restructured to hold TWO sliders in one card:
  - **Frequency** (purple, 0-100%) — unchanged behaviour.
  - **Sharpness** (red, step 0.05 across 1.50-2.50) — displays actual multiplier with 2-decimal precision.
  - Shared debounced save (250ms) coalesces rapid drags on either slider into a single POST. Both sliders share the same "saving…" / "✓ saved" flash pill.
- **Tests** (`test_admin_smurf_slider.py` + `test_party_lobby_and_smurf_bots.py`, 77/77 pass):
  - `test_admin_can_write_diff_only` — partial update leaves ratio untouched.
  - `test_admin_can_write_both` — both fields together.
  - `test_diff_below_1_5_rejected_by_pydantic` + `test_diff_above_2_5_rejected_by_pydantic` — clamping.
  - `test_diff_boundary_values_allowed` — 1.5 and 2.5 both valid.
  - Updated grep-guard on the smurf spawn source to require `_get_casual_elite_bot_diff()` (not the frozen constant).
- **Live verification** (Preview, 1400×900): dual-slider panel rendered — Frequency 15% purple, Sharpness 1.70 red → dragged Sharpness to 2.20 → API confirmed `{ratio: 0.15, diff: 2.2}` → reset cleanly. Zero JS errors. 4 curl paths (partial ratio, partial diff, both, invalid) all responded correctly (200/200/200/422).


### 2026-02-25 — Custom Party Lobby "BOTS OFF" toggle actually disables bots
- **User bug**: "The option to disable bots for custom games in parties does not work."
- **Root cause**: `get_or_create_party_room` correctly seeded the room with 0 bots when the leader picked BOTS OFF, but `GameRoom._maintain_population` (invoked every tick + on every `add`/`end_match`) auto-filled every casual FFA room up to `FFA_LOBBY_SIZE=4`, silently reintroducing bots within seconds.
- **Fix** (`/app/backend/server.py`):
  - `GameRoom.__init__` now initialises `self.bots_enabled = True` (default preserves legacy auto-fill everywhere else).
  - `_maintain_population` early-returns when `self.bots_enabled is False` — before the fill branch, after the despawn-excess branch, so human-only rooms stay human-only.
  - `get_or_create_party_room` propagates `party["bots_enabled"]` → `room.bots_enabled` on room creation.
  - Cache-hit refresh: if the leader re-clicks CUSTOM LOBBY with a new toggle while the room is still alive, `get_or_create_party_room` now re-reads the flag and despawns existing bots when it flips to False (edge case flagged by testing agent).
- **Tests** (`/app/backend/tests/test_party_bots_off_no_autofill.py`, 6/6 pass):
  - `GameRoom.bots_enabled` defaults to True.
  - `_maintain_population` early-returns on `bots_enabled=False`.
  - `get_or_create_party_room` propagates the flag.
  - Runtime: bots-off room stays at 1 player after `_maintain_population`.
  - Runtime: casual FFA room still fills to `FFA_LOBBY_SIZE` (regression guard).
  - Cache-hit refresh despawns bots when the toggle flips.
- **E2E verification** (testing_agent iteration_29, 7/7 new WS suite pass):
  - `/party/start` persists `bots_enabled` for false/true/no-body-default.
  - `/party/start` returns 403 for non-leaders.
  - Live WS at wss://…/api/ws/game?mode=party — BOTS OFF room stays human-only across ~25s of broadcasts (0 bots, roster size = human members). BOTS ON room still fills to 4 with disguised fill bots.
  - Casual quick-match auto-fill unaffected.


### 2026-02-25 (later) — Custom Lobby: follower now actually joins alongside host
- **User bug**: "Custom game only brings host into the game when bots are disabled." Follow-up to the earlier BOTS OFF toggle fix — now the toggle works but the *follower* still didn't make it into the party room.
- **Root cause**: `cleanup_party_room_if_empty` fired synchronously on every WS disconnect. When the leader's Game.jsx mounted, React StrictMode (dev) + any brief network hiccup produced a rapid WS close on the initial mount. That dropped the room to 0 humans and immediately (a) destroyed the room AND (b) reset `party["match_starting"]=False`. The follower's next `/party/me` poll (0-5s later) then saw `match_starting=False` and never navigated.
- **Why BOTS ON felt fine to the user**: with bots seeded the room lives just long enough through the reconnect for the follower's poll to catch the tail of a `match_starting=True` snapshot; with BOTS OFF the room hits 0 players instantly.
- **Fix** (`/app/backend/server.py`):
  - New module constant `PARTY_ROOM_CLEANUP_GRACE_SEC = 15.0` and tracker `_PARTY_ROOM_CLEANUP_TASKS`.
  - `cleanup_party_room_if_empty` now schedules a delayed task instead of tearing the room down inline. The task re-checks emptiness on wake-up and bails if a real player rejoined during the grace window ("grace-window rescue" log). Idempotent — a repeat call while a cleanup is pending is a no-op.
- **Tests** (`/app/backend/tests/test_party_cleanup_grace.py`, 5/5 pass):
  - Grace constant present and in sane 10-60s window.
  - `cleanup_party_room_if_empty` uses `asyncio.sleep(PARTY_ROOM_CLEANUP_GRACE_SEC)` (grep guard).
  - Sync teardown deferred — room + `match_starting` untouched immediately after the call.
  - Rejoin during grace saves the room + keeps `match_starting=True`.
  - Truly abandoned room is destroyed after the grace window (and `_PARTY_ROOM_CLEANUP_TASKS` self-cleans).
- **Live verification** (2-client e2e sim, leader "flaps" then follower polls): both users land in the same party room; `partyleader` + `partyfollower` present on the follower's WS state. Bug fixed.


### 2026-02-25 (later²) — Follower can now actually LEAVE a Custom Lobby
- **User bug**: "The leave match just brings you back into game if you are not the host of the party in custom game."
- **Root cause**: `/party/me` returned the same `match_starting=true` to every party member as long as ANY member was still in the room. Follower clicks EXIT → nav("/lobby") → next 5s poll → PartyPanel useEffect fires on `match_starting=true` → re-navigates back to `/play`. Infinite bounce.
- **Fix**:
  - **Backend** (`/app/backend/server.py`):
    - `PARTIES[pid]["match_optout"]` — set of user_ids opted out of the current Custom Lobby session.
    - `_party_payload(party_id, *, for_user_id=None)` — masks `match_starting` to `False` when the caller is in the opt-out set. Legacy no-arg callers get the raw flag.
    - `POST /api/party/leave-match` — adds caller to `match_optout`.
    - `/party/start` clears `match_optout` on each new session so the leader can pull the previously-opted-out member back in.
    - `/party/me` now passes `for_user_id=me_id` to the payload.
  - **Frontend** (`/app/frontend/src/pages/Game.jsx`):
    - `handleExit` now fire-and-forget POSTs `/api/party/leave-match` when `mode === "party"` before the nav back to `/lobby`.
    - Ungated for other modes so casual/ranked/practice exits are untouched.
- **Tests** (`/app/backend/tests/test_party_leave_match_optout.py`, 7/7 pass):
  - Endpoint + payload signature + `party_start` optout reset (grep guards).
  - Game.jsx handleExit contains the party-gated POST (grep guard).
  - Runtime: opt-out masks match_starting for the follower only, leader unaffected.
  - Runtime: legacy no-arg `_party_payload` returns the raw flag.
  - Runtime: `party_start`'s reset re-arms match_starting=True for the previously opted-out follower.
- **Live 2-client verification** (partyleader + partyfollower):
  - Both connect to same party room via WS.
  - Follower POSTs `/party/leave-match` → `/party/me` returns `match_starting=false` for follower, `true` for leader.
  - Leader POSTs a new `/party/start` → follower's `/party/me` returns `match_starting=true` again.
  - All 28 party-related pytests (bots-off + cleanup grace + leave-match + lobby + smurf) pass.


### 2026-02-25 (later³) — ROYAL GUARD (castle guard) map: fixed random boxes + wall flicker
- **User bug**: "Sometimes on the castle guard map random boxes will appear on screen and walls flicker when moving."
- **Two stacked root causes**:
  1. **Depth-buffer starvation** — the camera was `PerspectiveCamera(78, aspect, 0.05, 500)`. A 10,000:1 far/near ratio pushes the 24-bit depth buffer past its precision limit, so the comic-outline shells (BackSide, 1.05x scale) and the 0.011 m face-decal offsets z-fought against their parent walls as the player moved. This is normally invisible outdoors but ROYAL GUARD is the only map with stacked floating geometry (mezzanine + railings + lintels + ceiling) — the artifacts pile up in one view.
  2. **Coplanar geometry** — the mezzanine walkway ring's top face sits at exactly y=8.8 (y_base 8 + h 0.8). Both the 4 railings AND the 6 doorway lintels used `y_base=8.8`, putting their bottom face coplanar with the walkway top. Any camera angle crossing that plane z-fought regardless of buffer precision.
- **Fix**:
  - `/app/frontend/src/game/engine.js`: camera near bumped `0.05 → 0.15` (3x depth precision, still far enough that a sprinting player never clips through a wall).
  - `/app/backend/server.py` MAP_F: 4 mezzanine railings and 6 doorway lintels moved `y_base 8.8 → 8.85` (5 cm lift, invisible in-game, breaks the coplanar tie).
- **Tests** (`/app/backend/tests/test_hotel_map_zfight.py`, 4/4 pass):
  - No floating obstacle sits at `y_base == 8.8` (regression guard).
  - Railings + lintels are all at `y_base == 8.85` (specific fix guard).
  - Camera `near >= 0.1` AND `far/near <= 5000` (frontend depth-precision guard).
- **Related suites clean**: 14/14 across the new hotel z-fight tests, existing hotel-map layout tests, and party leave-match tests.


### 2026-02-25 (later⁴) — XP Boosts added to the Shop
- **User request**: "XP Boosts in store."
- **Backend** (`/app/backend/server.py`):
  - `BOOSTS_CATALOG` — 3 SKUs (1h/300 coins, 24h/800 coins, 7d/3000 coins), all 2x XP; helper `BOOSTS_BY_ID` for O(1) lookup.
  - Helpers: `xp_boost_remaining_seconds`, `xp_boost_active_multiplier`, `xp_boost_bonus_for_match(kills, placement)` — the last mirrors `compute_level`'s XP formula (25 per match + 50 per win + 10 per kill) and applies `(mult - 1)` to derive the bonus.
  - `GET /api/shop/boosts` — catalog + wallet + active-boost countdown.
  - `POST /api/shop/boost/purchase` — deducts coins, extends timer via `max(now, prev_until) + duration` so a repeat purchase never loses paid-for seconds.
  - `end_match`: both ranked + casual branches credit `stats.bonus_xp += xp_boost_bonus_for_match(...)` on real players. Never touches RP.
  - `public_user` exposes `xp_boost_seconds_remaining`, `xp_boost_multiplier`, and `xp_boost_until` (absolute epoch — lets the client tick locally).
- **Frontend**:
  - `ShopModal.jsx`: new tab strip (SKINS / XP BOOSTS). Boosts tab renders a 3-col grid of `BoostCard`s (giant "2X" hero, duration copy, rarity strip, Buy CTA). Active-boost countdown chip in the header ("2X · 1h 42m").
  - `Lobby.jsx`: green XP-boost pill next to the coin badge (`lobby-xp-boost-badge`). Uses `xp_boost_until` + local 1s setInterval so the timer ticks without polling `/auth/me`.
- **Tests** (`/app/backend/tests/test_xp_boost_store.py`, 14/14 pass):
  - Catalog shape + BOOSTS_BY_ID index + progressive coin/hour rate.
  - Helper math (no-boost, expired-boost, active-boost, 3x future-proof).
  - `xp_boost_bonus_for_match` doubling with/without win, kills scaling.
  - Static grep guards: end_match wires bonus_xp on both branches, public_user exposes all 3 boost fields, `/shop/boost/purchase` stacking rule uses `prev_until if prev_until > now else now`.
  - Frontend guards: ShopModal has boosts tab config + grid, calls `/shop/boost/purchase`, exports `BoostCard`; Lobby renders `lobby-xp-boost-badge` and ticks `xpBoostLeft` via setInterval.
- **Live verification** (admin@shooter.com):
  - GET `/api/shop/boosts` returns 3 SKUs + wallet.
  - Purchase 1h → coins deducted (15025 → 14725), `xp_boost_seconds_remaining` = 3599.
  - Stack another 1h → seconds = 7199 (~2h). No double-charge, no reset.
  - Invalid boost_id → 404 "Boost not found."
  - Broke test user → 402 "Not enough coins — needs 3000."
  - Preview screenshots show both tabs rendering + green boost pill in lobby.


### 2026-02-25 (later⁵) — Boot Loading Screen (8-second branded splash)
- **User request**: "Add a loading screen before the game fully load to lobby and make it take at least 8 seconds to load lobby."
- **Component** `/app/frontend/src/components/BootLoadingScreen.jsx`:
  - Full-screen comic-styled splash: dark red radial background, animated halftone dot pattern, red/gold speed lines streaking horizontally, "VIRTUE" logo with pop-in animation + red offset shadow, subtitle "COMIC-BOOK COMBAT · 2026 SEASON".
  - Progress bar (red→orange→gold gradient with animated shimmer glint) driven by requestAnimationFrame over `MIN_DURATION_MS = 8000` ms.
  - Rotating tip strip below the bar (~9 tips: "COMIC-BOOK CARNAGE. LOADING PANELS…", "BREWING ELITE BOTS…", "TIP: RIGHT-CLICK TO AIM DOWN SIGHTS", etc.) — refreshes every 1.6s.
  - `sessionStorage("virtue_boot_played_v1")` guard so route changes and reloads in the same tab don't repeat the splash. Fresh tab = fresh splash.
  - 400ms fade-out grace after 8s so the "READY UP" pulse settles before the lobby paints.
- **App.js**: routes are gated behind `showRoutes` (initialised from the same sessionStorage key so its state can't diverge from the splash's visibility). While the splash is up the router isn't mounted, preventing an ugly login/lobby flash behind the splash.
- **Tests** (`/app/backend/tests/test_boot_loading_screen.py`, 3/3 pass):
  - Component exists + enforces `MIN_DURATION_MS = 8000` + exposes `boot-loading-screen`, `boot-progress-fill`, `boot-tip` testids.
  - App.js imports the splash + gates `<Routes>` on `showRoutes`.
  - sessionStorage key mirrored between App.js and the component.
- **Live verification** (fresh preview session, 3 screenshots):
  - t≈1.2s: splash shows VIRTUE logo + 14% bar + "COMIC-BOOK CARNAGE. LOADING PANELS…" tip.
  - t≈4.2s: bar at 53%, tip cycled to "BREWING ELITE BOTS…".
  - t≈9.2s: splash unmounted, login page painted.



### 2026-02-27 — Admin Fog Lobby: volume-aware audio + realistic swaying trees
- **User bugs**: (1) The new fog-lobby MP3 kept playing during matches and ignored volume/mute sliders. (2) Trees looked stiff & cartoonish — user wants taller, more realistic conifers with branches (not whole trees) waving in the wind.
- **Audio fix** (`/app/frontend/src/game/audio.js`):
  - New `startFogAmbient(url)` on `audioBus`: creates an HTMLAudioElement, pipes it through `ctx.createMediaElementSource(el) → musicGain → master`. Element `.volume` stays at 1.0; user volume comes from the shared `musicGain` node so master/music sliders + mute toggles apply automatically. Idempotent (same url → resume-if-paused, no dupes). Autoplay-blocked case arms a one-shot pointerdown/keydown/touchstart listener to kick playback on the next gesture.
  - New `stopFogAmbient()`: pauses, resets currentTime, clears src, disconnects the node, and removes any armed gesture listeners. Also folded into the generic `stopMusic()` alias so leaderboard/profile → route changes never leave the fog stream running.
- **Component fix** (`/app/frontend/src/components/AdminFogLobby.jsx`):
  - Dropped the raw `new Audio()` + manual playback; now just `useEffect(() => { audioBus.startFogAmbient(URL); return () => audioBus.stopFogAmbient(); }, [enabled])`. Cleanup guarantees the music can't bleed into `Game.jsx`.
  - Replaced the two `backgroundImage: svg` tree layers with **inline SVG** so each tree can be a `<g>` with a static trunk `<rect>` + an animated `<g class="crown">`. `transform-box: fill-box; transform-origin: 50% 100%;` makes the crown pivot from the top of the trunk while the trunk stays anchored — real "branches wave, trunk stays" behaviour.
  - `TreeGlyph` + `buildBranches(...)` render 6–8 layered polygon branches per tree, tapering base→tip with a `droop` term so pines look continuous (not stacked triangles). Larger foreground trees get an extra inner shading polygon for depth.
  - Near layer: 18–24 TALL dark pines (heights 560–820 in a 980-tall viewBox = trees actually dominate the frame). Far layer: 36 pale shorter siblings for parallax depth.
  - Sway keyframes tuned to a light-wind feel: near `±2.0deg rotate + ±1.2deg skewX @ 5.4s`, far `±1.8deg @ 7.2s`. Each crown gets its own seeded `animation-delay` (0..4s) and a random horizontal flip so the wind reads as a **rolling wave through the forest** instead of every branch swaying in lockstep.
- **Verified**:
  - Preview screenshot at `/tmp/admin_fog_lobby.png` shows the redesigned taller conifer forest with visibly-tilted crowns (mid-cycle sway captured).
  - Static wiring: `startFogAmbient` connects to `this.musicGain` → `setMusicVolume`/`setMasterVolume`/`setMusicMuted` propagate; `stopFogAmbient` invoked from AdminFogLobby cleanup + `stopMusic()`.

### 2026-02-27 (later) — Admin Fog Lobby: audio actually plays + heavy storm
- **User bugs**: (1) The fog-lobby MP3 wasn't playing at all after the previous fix. (2) Wants the fog scene turned into a heavy storm with lightning + rain.
- **Audio playing again** (`/app/frontend/src/game/audio.js`):
  - Root cause: `ctx.createMediaElementSource(el)` requires CORS headers on the CDN, otherwise the Web Audio graph outputs zero even though the element is "playing" — that's why every slider showed the file loaded but nothing was audible.
  - Replaced with a plain HTMLAudioElement path (no `crossOrigin`, no `createMediaElementSource`). The element's own `.volume` is driven from `_masterVol * _musicVol` with mute honored, and every slider/mute setter now calls `_syncExternalAudio()` so slider drags update the fog audio live.
- **Heavy storm** (`/app/frontend/src/components/AdminFogLobby.jsx`):
  - Palette darkened to stormy slate → near-black so lightning reads as bright.
  - Three tiled SVG rain layers (`RAIN_SVG_BACK`, `_FRONT`, `_GUST`) at different densities, opacities, tilts and animation speeds. `background-position` animates diagonally in perfect sync with the tile size so streaks fall seamlessly with no seams.
  - Lightning scheduler in `useEffect`: first strike at 2-4s, then every 6-14s. Each strike has random intensity, a 30% chance of a rapid re-flash pulse, and ~45% chance of drawing a jagged SVG fork bolt (via `buildBoltPath(id)`). Bolt path zig-zags top→bottom with random lateral wobble + one branching side-strike, all wrapped in an SVG `feGaussianBlur` glow filter.
  - Thunder is fired from `audioBus.thunder()` 200-700ms AFTER the flash so light-then-sound feels like real distance.
- **Verified**: 21 preview screenshots at `/tmp/admin_storm_try_*.png` show dense rain across the whole frame, tall dark pines silhouetted, stormy sky palette. Audio playback restored via HTMLAudioElement path.


### 2026-02-27 (later²) — New Map: MOORLANDS (swamp + storm)
- **User request**: "Make a new map that is foggy and stormy with a woods and swamp theme."
- **Backend** (`/app/backend/server.py`):
  - Added `MAP_G = { map_id: "swamp", name: "MOORLANDS", size: 50, obstacles: 55 rects, spawn_points: 12, healthpacks: 9 }`. Layout: central ruined-altar island with 4 broken columns, flanking east/west bog islands with hard-cover walls, fallen dead-tree logs (chest-height cover), a ring of standing dead-tree pillars (full-height peek cover), mossy boulders, and corner watchtower ruins for snipers. Appended to `MAPS` so casual/ranked/party rolls include it.
  - Added `?force_map=<map_id>` admin-only WS query param (checked in both `mode == "offline"` and `mode == "practice"` branches). For offline, tears down any cached user room first so the swap always applies. Logs `Force map applied to offline room: ...` on hit. Useful for QA / preview screenshots.
- **Frontend engine** (`/app/frontend/src/game/engine.js`):
  - New palette entry for `swamp` (mossy stone / bark / rot / slate / glowing green).
  - Floor material for swamp → dark mossy green-brown; grass blades hidden.
  - `_applyDayNight` new theme branch `theme === "swamp"`: bruised slate → mossy horizon sky gradient, dense green-tinted fog (30-110 close range), dim overcast sun with cool desaturated green-grey tint, hidden clouds + parkland decorations.
  - Introduced `_stormActive` gate (`night || theme === "swamp"`) so the existing rain particle system + lightning scheduler light up on the new map without reimplementing weather. Baseline sun/hemi/ambient restore branch now theme-aware (dimmer on swamp).
  - New `_swampExtras` group (lazy-built once) with: procedural bog-water plane (algae swirl canvas, murky green, mildly transparent so lightning flashes catch it), 50+ gnarled dead trees ringing the arena (trunk + 2-4 randomly-angled crooked branches, all cel-outlined), 60 additive-blended fireflies drifting on a per-particle 3-axis sine wobble (updated in `_updateWeather`), and 6 low-lying mist puffs near the ruins.
- **Frontend selector** (`/app/frontend/src/game/mapsMeta.js`, `/app/frontend/src/pages/Game.jsx`):
  - Added `MAP_SWAMP` with tagline "Foggy woodland · murky bog · stormy overcast + lightning." + a swamp palette so the loading-screen minimap preview + practice map picker card render correctly.
  - `MAPS_META` includes MAP_SWAMP so the PracticeMapSelector shows a "MOORLANDS" tile.
  - `Game.jsx` reads `?force_map=` from the URL and forwards it in the WS `extra` params for offline/party modes.
- **Verified**:
  - Backend: `python3 -c` script confirms `MAP_G` registered (server MAPS list = downtown, crossfire, shoreline, crashsite, tundra, hotel, **swamp**; obstacle count 55; `get_map_by_id("swamp")` returns the map).
  - Frontend: compiles clean (1 pre-existing lint warning unrelated to these files).
  - Practice map selector shows MOORLANDS card after the change (screenshot flow launched a match with `?map=swamp`).
- **How to play**: Lobby → PRACTICE → toggle "OFFLINE VS AI" → pick "MOORLANDS" → START. The map also auto-rolls in random casual + party matches now that it's in `MAPS`.


### 2026-02-27 (later³) — MOORLANDS: map pick actually respected + no more building windows
- **User bug**: "when selecting map in offline it is random" — picking MOORLANDS still gave a random arena (usually downtown/crashsite).
- **Root cause**: Offline vs AI uses `LocalSim` on the client (not the real server WS), and `LocalSim.MAPS` only knew about MAP_A..MAP_F. `_pickMap("swamp")` fell through to random. On top of that, the engine's `_makeBuildingFaceTexture` was slapping lit apartment-window textures on the ruins/dead-trees because it triggers on any `h >= 2.5` obstacle.
- **Fixes**:
  - `/app/frontend/src/game/localSim.js`: Added `MAP_G` with the full swamp obstacle set (same 55 rects as server.py) + spawn points, then included it in the `MAPS` array. `_pickMap("swamp")` now returns it directly.
  - `/app/frontend/src/game/engine.js`: `_buildObstacle` now short-circuits the window/wallpaper decoration + roof cap for `map_id === "swamp"`. Dead trees / ruined watchtowers stay silhouettes instead of lit apartment blocks.
  - `/app/frontend/src/pages/Game.jsx`: `?map=<id>` is now forwarded in the WS `extra` params for offline + practice modes (was previously only used by LocalSim). Solves the equivalent issue on the real-server path.
  - `/app/backend/server.py`: WS accepts `map=` query param. For offline/practice modes any player (not just admins) can pick their arena. Offline branch tears down cached room first so the swap actually takes effect.
  - Tuned swamp lighting: sun/hemi bumped from 0.85/0.9 → 1.05/1.05, ambient 0.38 → 0.55 so the arena is readable during the storm. Sky gradient midtones darkened + scene.background midtone-matched so the inner sky sphere no longer punches a bright "moon disc" through the outer background.
- **Verified**: Preview screenshots show dead trees on the horizon, bog water floor, falling rain, scattered fireflies, dark stormy sky, and ruins WITHOUT windows. Offline vs AI + MOORLANDS pick reliably lands on the swamp arena.


### 2026-02-27 (later⁴) — MOORLANDS → SILENT TOWN: decayed ruins + heavier storm + denser fog
- **User requests**:
  1. Rename the map from MOORLANDS to **SILENT TOWN**
  2. Remove lit apartment-style windows from buildings + make them look decayed/ruined
  3. More lightning strikes to feel stormier
  4. More fog effects across the map
- **Rename** (sed swap across `/app/backend/server.py`, `/app/frontend/src/game/mapsMeta.js`, `/app/frontend/src/game/localSim.js`): "MOORLANDS" → "SILENT TOWN" (plus lowercase variant). Map card in the practice selector now reads SILENT TOWN and the confirmation navigates to the swamp arena.
- **Decayed buildings** (`/app/frontend/src/game/engine.js`):
  - New `_makeDecayTexture(ob)` builds a per-obstacle 256×256 canvas with a mottled dark-stone base, a jittered stone-block seam grid, jagged black cracks (drawn as fork-style polylines), organic moss streaks (linear gradients running from the top down), soft water stains (radial gradients), and a crumbled top edge (chipped alpha via `destination-out`) so the silhouette isn't knife-straight. Deterministic seed per obstacle → all clients see the same wear.
  - `_buildObstacle` now maps this texture onto the 4 side faces of every swamp obstacle with `h < 5` (walls, watchtower ruins, altar columns, boulders). Trees (`h >= 5`) stay as slender silhouettes. Roof caps disabled on swamp so the ruins keep broken tops.
- **Heavier lightning** (`/app/frontend/src/game/engine.js`):
  - Storm scheduler on the swamp map now fires ~every 2-6s (was 6-18s) — the map reads as constant rolling thunder.
  - First strike lands 1.5-3.5s after entering the arena (was 4-10s) so combat kicks off already inside the storm.
  - Existing 5-pattern lightning system (single / double / triple / rolling / flicker) reused so each strike still varies naturally.
- **Denser fog** (`/app/frontend/src/game/engine.js`):
  - Fog near/far tightened to 22-95 (was 45-140) so distant obstacles genuinely dissolve into mist.
  - Ground mist patch count more than doubled (6 → 23). Interior patches drift 3-4 units around their home in a per-patch sine wobble, with pulsing opacity + slow rotation for organic "breathing" fog.
  - Three concentric mist "rings" — cylindrical fog sheets at radii 46/58/70 that occlude anything past the arena from every angle without needing per-frame billboard math.
- **Verified**: Screenshots show decayed weathered stone ruins in the centre, dense fog wall around the arena, no windows anywhere, drifting mist patches, heavy rain, dark stormy palette. Confirmed practice selector shows "SILENT TOWN" card that lands on the swamp arena reliably.


### 2026-02-27 (later⁵) — Silent Nurse skin (Silent Hill 2 tribute)
- **User request**: Add a really detailed Silent Hill 2 nurse themed skin.
- **Backend catalog** (`/app/backend/server.py` `SKINS_CATALOG`):
  - New `{"id": "nurse", "name": "Silent Nurse", price: 5500, rarity: "legendary", obtain: "shop", aura: 0x8b0d0d, aura_mode: "flicker", ...}`. Palette: cream dress body, ivory stockings, bandage-tan head, blood-red accent + stripe, white nurse-cap helmet, dark-red bloody "visor" stripe across the face. Registered in `SKINS_BY_ID` and appears in the shop `/api/shop/skins` list (confirmed by curl — item 26 in the catalog, rarity legendary, price 5500).
- **Custom render hook** (`/app/frontend/src/game/engine.js` `_buildHumanoid`):
  - Triggered by `skin.id === "nurse"` and wraps the base humanoid instead of replacing it, so death fall + hit flash + arm-swing animation still apply.
  - **Head wrap**: base sphere textured with a procedural bandage canvas (horizontal gauze stripes, 6 blood-soak radial spots with darker cores, drip streaks) + 4 physical wrap-ring toruses at varying angles + a wider dark-red torus arc where the face would be so the mask reads clearly even under fog/rain.
  - **Nurse cap**: small folded white box on top of the head, tilted forward flap, painted red cross (V + H bars), and a single blood-drip trickle from the cap edge.
  - **Dress**: 256×256 procedural canvas with cream base, fabric grain, 5 vertical blood-streak gradients, a big radial chest splatter, 60 random splatter dots, and a saturated brown hem stain. Applied to a slightly-oversized torso box + a flared A-line cylinder skirt below the belt. White waist tie band on top.
  - **Bare bloody arms**: red short-sleeve cuffs at each shoulder (the base "head" tone the palette exposes gets used for the arms already).
  - **Stockings + shoes**: ivory upper-leg cylinders + dark low-heeled shoe boxes at each foot.
- **Verified**:
  - Backend curl confirms skin registered + buyable + purchased on admin (`selected_skin: "nurse"`).
  - Frontend compiles clean (1 pre-existing warning unrelated).
  - In-game FPS view naturally hides own body (expected); bots wear other random skins so the nurse shows on the local player from any 3rd-person moment (death cam, spectate, kill cam).
- **How to obtain**: Lobby → SHOP → Legendary tab → Silent Nurse (5500 coins) → auto-equipped on purchase. Pairs thematically with the SILENT TOWN map.


### 2026-02-27 (later⁶) — Nurse rename + SILENT TOWN ambient wind + frogs
- **User requests**:
  1. Rename "Silent Nurse" → "Nurse"
  2. Add low frog-croak + wind ambient loop that starts on SILENT TOWN welcome
- **Skin rename** (`/app/backend/server.py`): SKINS_CATALOG entry for `id="nurse"` now has `"name": "Nurse"`. Curl confirms — `/api/shop/skins` returns `name: "Nurse"` for the entry (still `id: "nurse"`, still owned + equipped on the admin account, still triggers the same client render hook).
- **Swamp ambient audio** (`/app/frontend/src/game/audio.js`):
  - New `swampAmbient(on)` method on `audioBus`. Fires ONLY when the swamp theme is active.
  - **Wind bed**: 2s pink-noise buffer (running-average approximation of white noise) → low-pass @ 500Hz + a 400Hz peaking filter for throat → GainNode ramped 0 → 0.10 over 2s. A low-frequency oscillator (~0.13Hz, ~7.7s per gust) modulates the gain ±0.05 so the wind naturally "gusts" instead of running flat.
  - **Frog croak scheduler**: `_playFrogCroak()` fires every 2.5-8s (first croak 1.5-3s after activation so entry isn't silent). Each croak is 2-3 short noise bursts (~90ms each) through a Q=8 bandpass that sweeps `basePitch+60Hz` → `basePitch-40Hz` (basePitch randomised 380-600Hz), envelope-shaped for a "gulp then chirp" bullfrog feel. Each burst is randomly stereo-panned via `StereoPannerNode` so the swamp reads as *multiple* distant frogs, not one on repeat.
  - Both layers route through `sfxGain` so master + SFX sliders control the whole bed. `on=false` fades the wind to zero over 0.9s then stops both the source and the LFO so nothing leaks into the next map.
- **Engine hook** (`/app/frontend/src/game/engine.js`):
  - The storm block that starts `rainAmbient(true)` now also calls `audioBus.swampAmbient(true)` when `mapId === "swamp"`, and explicitly `false` otherwise (so a downtown match doesn't inherit frog chirps from a stale state).
  - Engine dispose (returning to lobby / route change) calls `audioBus.swampAmbient(false)` alongside `rainAmbient(false)` so the bed doesn't hiss under the lobby music.
- **Verified**:
  - Curl: `/api/shop/skins` returns `name: "Nurse"` for the entry.
  - Frontend compiles clean.
  - Wind LFO + frog scheduler are both self-cleaning: LFO uses `.stop()` on ambient-off, scheduler's `alive.ok` flag halts the recursive setTimeout chain.


### 2026-02-27 (later⁷) — Leaderboard top-3 self-row visibility + swamp-fog reach audit
- **User bugs**:
  1. "If you are rank 1 2 or 3 your name isn't visible on the leaderboard bc dark mode"
  2. "Make the fog update for everyone"
- **Fix 1** (`/app/frontend/src/pages/Leaderboard.jsx`):
  - Root cause: the current-season leaderboard row style has three branches — `isYou` (cream card with red ring), top-3 (gold/gold-tint with `text-black`), regular (`bg-neutral-900 text-white`). The `isYou` branch wins ternary precedence over top-3, but its class list only set `bg-[#FFFCE6] ring-4 ring-inset ring-[#E62429]` — it forgot to set `text-black`. On the dark theme the row inherited the white parent text color, which is invisible on cream.
  - Change: appended `text-black` to the `isYou` branch class list so the row is now `bg-[#FFFCE6] text-black ring-4 ring-inset ring-[#E62429]`. Fixes the top-3-self row and any other position when it happens to be the current player.
- **Fix 2 — audit result**: Searched the engine + audio bus for `is_admin` / `role.*admin` gates — zero hits. Every visual for SILENT TOWN (storm sky, dense fog, rain particles, lightning scheduler, `_swampExtras` group with bog water + dead trees + fireflies + mist rings, `swampAmbient` audio) is triggered exclusively off `arena.map_id === "swamp"` in the server welcome. Once the current deployment goes live, every player queued into a swamp match sees the identical storm — no per-account roll-out needed. No code change required.
- **Verified**: Frontend compiles clean. Leaderboard top-3 row now shows the "YOU" name in black-on-cream instead of white-on-cream (invisible).


### 2026-02-27 (later⁸) — Fog Lobby rolled out to every player
- **User request**: "Make the new lobby available for everyone."
- **Change** (`/app/frontend/src/pages/Lobby.jsx`):
  - Removed the `isAdmin ?` branch that gated the fog-forest backdrop. The default lobby background is now `AdminFogLobby` for every user. Snow + meteor seasonal variants still take precedence when active (Season override chain: snow > meteor > fog).
  - Retired the castle backdrop render + the "false && <LobbyBackground …>" dead branch that lived next to it. `LobbyBackgroundCastle` import kept in place in case we want to bring it back as a season variant later.
  - Music `useEffect` dependency swapped from `[isAdmin]` to `[showSnowBg, showMeteorBg]`. Default synth loop is now skipped for everyone when the fog backdrop is active (which is unconditionally, minus snow/meteor). Same guard shape — just widened from "admin only" to "everyone on the fog backdrop".
  - Test hook renamed `lobby-bg-admin-fog` → `lobby-bg-fog` since the backdrop is no longer admin-exclusive.
- **Verified**: Preview screenshot on the admin account shows the new stormy fog forest with tall dark pines, heavy rain, and dark palette behind the entire lobby UI. Playwright confirms `lobby-bg-fog` marker is present + `lobby-bg-castle` marker is gone. Every logged-in user will see the same on their next visit once the current deploy ships.


### 2026-02-27 (later⁹) — PublicProfileModal readable after dark-mode
- **User bug**: "The text when you pull up another player's profile from the leaderboard and match history is not viable after dark mode update."
- **Root cause** (`/app/frontend/src/components/PublicProfileModal.jsx` line 61): the modal card wraps its content in `bg-white` but never sets a text color. Before the dark-mode pass, the app's default body text was dark, so the white card inherited a dark text color and read fine. After Leaderboard/Profile went dark-themed, the ambient text color at the body level became white — inherited by every child that didn't set its own color. Result: labels, "Private Profile" banner, K/D stats, match-history rows all rendered white-on-white and were invisible.
- **Fix**: Added `text-neutral-900` to the modal card's `bg-white` wrapper so all children that don't set their own color inherit dark text. Explicitly-colored elements (yellow chips with `#0A0A0A`, red REPORT button, ULTIMATE GOONER pill, rank-color history badges, stat cards) are untouched — they set inline `color` already.
- **Verified**: Screenshot after fix shows the entire modal reads clearly — "GOONMONARCH474" header, CURRENT/PEAK/MAX RANK/LEVEL labels, RP values, "PRIVATE PROFILE" banner and description text are all rendered in dark on the white card. Same fix carries into FriendsModal (which reuses the same PublicProfileModal component).


### 2026-02-27 (later¹⁰) — HUD ammo panel: kill the ugly transparent box
- **User bug** (with screenshot): a slanted `rgba(10,10,10,0.85)` parallelogram framed the "25 / 25" ammo counter for AK + sniper. On mobile it overlapped the touch FIRE button and read as an extra floating rectangle.
- **Root cause** (`/app/frontend/src/components/Hud.jsx` line 370-393): the ammo counter wrapper used the shared `.hud-panel` class (`background rgba(10,10,10,0.82)` + 3px white border + `skewX(-10deg)` + padding). Great for the SCORE panel that anchors the stack; ugly next to the round FIRE button below it.
- **Fix**: Replaced the `hud-panel` wrapper for the ammo counter with a plain right-aligned div. Ammo number + magazine text now float as clean drop-shadowed text (`textShadow: 0 2px 4px rgba(0,0,0,0.9)` + tight inline styling for Anton letter-spacing). The reload progress bar keeps its own 1.5px inline border so it still reads. Low-ammo / LOW AMMO pulse untouched.
- **Verified**: Preview screenshot on the practice range shows "25 / 25" rendering as clean shadowed text between the SCORE trophy card and the yellow AK-47 badge — no more slanted transparent box, no FIRE-button overlap. Same fix applies for the sniper since it uses the same primary-weapon rendering path.


### 2026-02-27 (later¹¹) — Muzzle-flash quad no longer draws a "transparent box" near walls
- **User clarification**: not the HUD ammo counter — the semi-visible transparent rectangle at the **barrel** of the AK and sniper viewmodels, showing up when the player stands in some map corners.
- **Root cause** (`/app/frontend/src/game/engine.js`): the AK + sniper muzzle-flash sprites use `SpriteMaterial({ map: flashTex, transparent: true, blending: AdditiveBlending, opacity: 0 })`. `transparent: true` alone still leaves `depthWrite: true` (the Three.js default), which means the sprite's 128×128 quad writes depth values for **every pixel of its axis-aligned quad** — including the transparent border around the round flash circle. When the muzzle sits close to a wall (corner peeking, wall pullback engaged), those depth writes let the sprite quad's rectangular silhouette show through against the wall's depth — reading as a slight transparent black box at the barrel.
- **Fix**: Added `depthWrite: false` to both muzzle-flash `SpriteMaterial`s (AK: line 3113, sniper: line 3272). Standard fix for transparent additive sprites — they now read depth (still occluded correctly by nearer opaque geometry) but never *write* depth themselves, so the transparent border stops occluding the wall behind it.
- **Verified**: Frontend compiles clean. Both sprite materials updated identically. Laser weapon uses solid meshes (torus emitter ring + cone tip) so it wasn't affected.


### 2026-02-27 (later¹²) — Friends list rank icon + fog-lobby ambient silenced
- **User requests**:
  1. Make the rank on the friends list show tier as well as rank
  2. Remove ambient audio from lobby
- **Fix 1 — Friends list tier icon** (`/app/frontend/src/components/FriendsModal.jsx`):
  - Imported `AnimatedRankIcon` alongside `divisionRoman`.
  - Friend row (line ~262): added a 22px `<AnimatedRankIcon tier=… division=…>` directly before the rank-name pill so the row now shows [avatar] · username · [tier badge] · [rank pill "BRONZE I"] · [RP] — matches the leaderboard row layout.
  - Search-result row (line ~468): same treatment at 20px so search results also show the tier badge.
- **Fix 2 — Silence lobby MP3** (`/app/frontend/src/components/AdminFogLobby.jsx`):
  - Replaced the `audioBus.startFogAmbient(MUSIC_URL)` call in the mount effect with an explicit `stopFogAmbient()` so any lingering audio element from a prior visit or hot-reload is torn down. `MUSIC_URL` constant kept in the file (unused) so future re-enable is a one-line change.
  - Cleanup still calls `stopFogAmbient()` on unmount for the same reason.
  - `Lobby.jsx` already stops the default synth music when the fog backdrop is active (see 2026-02-27-later⁸), so the lobby is now fully silent for every player unless they're on the snow / meteor seasonal variants.
- **Verified**:
  - Preview screenshot: friends modal shows the BRONZE animated rank icon (circular gold-outlined coin) directly beside the "BRONZE" pill for the friend "botified" — tier + rank both visible.
  - Frontend compiles clean.
  - Lobby no longer starts any MP3 or synth music on the fog backdrop (default for all users).


### 2026-02-27 (later¹³) — Lobby MP3 back w/o thunder + Friend leaderboard-rank chip
- **User requests**:
  1. Add back the fog-lobby MP3 music BUT remove the thunder audio (visuals stay)
  2. Add the leaderboard rank number ("#N") next to the rank on friends list
- **Fix 1 — MP3 back, thunder muted** (`/app/frontend/src/components/AdminFogLobby.jsx`):
  - Restored `audioBus.startFogAmbient(MUSIC_URL)` in the mount effect (cleanup still calls `stopFogAmbient()`).
  - Deleted the `audioBus.thunder()` call inside the lightning scheduler — visual flashes + fork bolts still fire, but no rumble under the music. Comment updated so future readers know it's a deliberate no-audio choice.
- **Fix 2 — #N leaderboard chip** (`/app/backend/server.py` `_friend_card` + `/app/frontend/src/components/FriendsModal.jsx`):
  - Backend `_friend_card` now attaches `rank_division` (computed via `rank_division_for_points`) so the tier icon added in the last change actually gets the right "GOLD III" division, plus `leaderboard_rank` sourced from the same `TOP50_GOONER_IDS` cache the profile/leaderboard/killfeed already use. Curl confirms: `friend "b0tified": rank_name=BRONZE div=3 lb=None`.
  - Frontend friend row + search-result row now render a small gold `#N` pill immediately after the rank text pill when `leaderboard_rank` is a finite value in 1..50. Wrapped in `Number.isFinite(...)` so nulls/undefined skip cleanly. Tooltip explains "#N on the current-season leaderboard".
- **Verified**: Curl returns the new fields (rank_division present, leaderboard_rank null for non-top-50). Frontend compiles clean. Lobby music restored; no thunder rumble.


### 2026-02-27 (later¹⁴) — Leaderboard bots gain + lose RP through the season
- **User request**: Make the leaderboard bots lose RP and gain it back throughout the season.
- **Root cause of old behaviour**: `seeded_climb_loop` in `/app/backend/server.py` did a pure linear lerp from `seed_start_rp` → `seed_target_rp` scaled by season fraction — RP only ever went up. Every seeded bot was monotonically climbing which made the leaderboard feel static.
- **v7 volatility fields** (added via a one-shot migration inside the loop, guarded by `seed_v7_volatility: True`):
  - `seed_volatility`: 0.03..0.10 (fraction of climb range) — swing amplitude per bot; smaller for gentle climbers, bigger for the top tail.
  - `seed_vol_freq_a` / `_freq_b`: two harmonic frequencies in cycles-per-season (4-8 slow, 9-15 fast).
  - `seed_vol_phase_a` / `_b`: random phase per harmonic so bots don't all dip in unison.
- **Climb math change**:
  ```
  base_rp = start_rp + (target_rp - start_rp) * p
  wave   = (2/3)·sin(freq_a·2π·frac + phase_a) + (1/3)·sin(freq_b·2π·frac + phase_b)
  new_rp = snap_to_grid( base_rp + volatility · max(60, climb_range) · wave )
  clamped(floor = start_rp - amp/2, ceil = target_rp + amp/3)
  ```
  Two-harmonic composite reads organic (never flat sine-y). Floor keeps a Bronze IV bot from falling into unranked; ceiling limits overshoot so tier can't yo-yo wildly.
- **Peak-rank tracking updated**: previous logic stamped peak at first climb tick to the target. With volatility a bot may spike above the base target then dip — the peak field is now a running max of `(cur_peak, target_rp, new_rp)`, so momentary highs are immortalised on the profile Peak card exactly like a real player's peak grows.
- **Verified**:
  - Migration applied to all 107 seeded bots on first `seeded_climb_loop` tick after restart (`Seeded bots: 107, v7 volatility migrated: 107`).
  - Sample bot GoonPhantasm421: RP 2835 vs target 2985, `seed_volatility=0.0602`, freqs 7.8 / 14.9. Amplitude ≈ 6% × 1785 climb range ≈ 107 RP swings — bots will visibly gain and lose ~1 division worth of RP over the season.
  - Backend restarts cleanly, seeded_climb_loop ticks every 45s in the background.



### 2026-02-27 (later¹⁵) — Leaderboard upgrades: Friends board + Weapon Kings + Live RP deltas
- **User request**: Continue with the Leaderboard enhancements previously suggested — implemented options (c) Live RP deltas, (d) Friends-only tab, and (e) Weapon-specific boards.
- **New backend endpoints** (`/app/backend/server.py`, before `/me/season_history`):
  - `GET /api/leaderboard/friends` (auth required): Returns accepted friends of the caller + the caller themselves, in the same row shape as `/leaderboard`. Extra `is_me` flag so the client can highlight the self-row. Sorted by RP desc.
  - `GET /api/leaderboard/weapons` (public): Aggregates `match_history.kill_events` by (shooter_id, weapon) for real players and adds deterministic synthetic per-weapon kill counts for the top-80 seeded bots so the board isn't empty pre-season. Returns `{ ak47, sniper, pistol, laser, katana }`, each list top-25 sorted by kills desc. Kill counts scale with bot RP (top bot ≈ 1500 kills) and vary ±40% per weapon via a stable md5(username:weapon:kills) hash.
- **Frontend rewrite** (`/app/frontend/src/pages/Leaderboard.jsx`):
  - Extracted a shared `PlayerRow` component so the three views (Global / Friends / Weapons) render identically with a `variant` prop that swaps the last column between RP and Kills.
  - Added an inner "view switcher" (GLOBAL / FRIENDS / WEAPON KINGS) below the outer CURRENT/PAST tabs. WEAPON KINGS reveals a second row of pills (AK-47 / SNIPER / PISTOL / LASER / KATANA).
  - **Live RP delta chip**: on every 15s `/leaderboard` poll the client compares each row's `rank_points` against a per-username `useRef` baseline, and if it changed emits a `{delta, at}` entry with a 12s TTL. A colored ▲/▼ chip (green up / red down) renders next to the player name using a `leaderboard-delta-pulse` CSS keyframe (`/app/frontend/src/index.css`) that scales in, holds, then fades.
- **New tests** (`/app/backend/tests/test_leaderboard_upgrades.py`, 6/6 passing):
  - Friends endpoint requires auth, always includes self, and reflects added friends symmetrically.
  - Weapons endpoint is public, returns all 5 weapon keys with correct row shape, and each list is sorted by kills desc.
- **Verified**:
  - Preview screenshots confirm the new sub-tabs, weapon picker pills, and the Weapon Kings table showing the aggregated AK-47 leaderboard (GOONCIPHER_R1258 at 1582 kills, correct rank chips, medal icons).
  - `pytest tests/test_leaderboard_upgrades.py` — 6 passed in 0.80s.
  - Frontend compiles clean, no console errors.


### 2026-02-27 (later¹⁶) — 12-Player Big FFA mode
- **User request**: Add a new game mode "12 player FFA" with its own button in the lobby. Must NOT be routed through Quick Match or Ranked matchmaking.
- **Backend** (`/app/backend/server.py`):
  - New `BIGFFA_LOBBY_SIZE = 12` constant and a dedicated `bigffa_room = GameRoom(is_ranked=False, match_duration=120.0)` singleton, tagged `is_bigffa=True` and `bots_target_size=12`. Task launched from the startup event alongside the other shared rooms.
  - `_maintain_population` now honours `bots_target_size` when set, so the same fill/despawn logic that keeps casual FFA at 4 keeps bigffa at 12 (disguised-bot fill uses the existing `_get_casual_elite_bot_diff()` casual smurf logic — no separate bot pool).
  - `player_location` records `kind="bigffa"` for real players in the room; spectate routing (`/ws/game?mode=spectate&target=...`) recognises the new kind and resolves back to `bigffa_room`.
  - All `in_match` presence-check tuples (leaderboard row, friends card, admin dashboard) updated to include `"bigffa"` alongside `"casual"`.
  - New WS branch: `mode=bigffa` routes straight to `bigffa_room` — no queue involvement, no ranked side effects, no party requirement.
- **Frontend**:
  - New "12P FFA" button in `/app/frontend/src/pages/Lobby.jsx` (bright orange `#FF7A00`, `Swords` icon, `data-testid="lobby-bigffa-button"`) placed between RANKED MATCH and PRACTICE. Disabled while the player is in the Quick Match or Ranked queue (same guard as PRACTICE).
  - Click handler `startBigFfa` fires the same match-loading overlay + navigation as party/ranked entry (`navigateToMatch(nav, "/play?mode=bigffa", ...)`).
  - `/app/frontend/src/pages/Game.jsx` accepts `mode=bigffa` alongside the existing routes and passes it verbatim to the WS URL.
- **Tests** (`/app/backend/tests/test_bigffa_mode.py`, 4/4 passing):
  - `bigffa_room` is configured with `is_bigffa=True`, `game_mode="ffa"`, `is_ranked=False`, `bots_target_size=12`.
  - `_maintain_population` reads `bots_target_size` on the room.
  - WS `/api/ws/game?mode=bigffa` returns a `welcome` payload with `game_mode="ffa"` + `is_ranked=False` + `is_practice=False`.
  - Missing `?token=` param results in a rejected socket (no welcome fires).
- **Verified end-to-end**:
  - Preview lobby screenshot: orange "12P FFA" button visible between RANKED MATCH and PRACTICE.
  - Clicking the button navigates to `/play?mode=bigffa` and drops the player into an active 12-combatant arena — screenshot shows QUICK 1:51 timer (matching 120s match_duration), 25/25 ammo, HP 52, and a live kill feed with 5 entries from disguised bots (BlitzReaper, QwiKshot, ShadowKnife, PixelPunk, redhatcat, x_zenith_x).
  - Manual WS smoke test confirmed the room fills to exactly 12 players (1 real + 11 disguised bots).


### 2026-02-27 (later¹⁷) — 12P FFA gets a proper queue
- **User request**: Make the 12-player lobby have a queue in the lobby like the other 2 modes.
- **Backend** (`/app/backend/server.py`):
  - New `BIGFFA_QUEUE: List[dict]` + `BIGFFA_BOT_FILL_SEC = 12.0` alongside the existing casual/ranked queue globals.
  - Matchmaker loop now runs a BigFFA branch after the casual bot-fill block: when either (a) queue size ≥ BIGFFA_LOBBY_SIZE (12) or (b) oldest entry has waited BIGFFA_BOT_FILL_SEC, the whole queue is dispatched in a single batch — each user marked in MATCHED_USERS with `bigffa: True, match_id: <hex10>`. The bigffa_room's own `_maintain_population` then tops off any missing slots with disguised bots on arrival.
  - Four new endpoints mirroring the casual queue's shape: `POST /queue/bigffa`, `GET /queue/bigffa`, `DELETE /queue/bigffa`, `GET /queue/bigffa/status`. All solo-only (no party handshake needed for this MVP). `POST` yanks any existing casual/bigffa entry so a caller can't be in two queues at once.
- **Frontend**:
  - `QueueContext.jsx`: new `bigffaQueueState`, `bigffaWaitSec`, `joinBigffa`, `cancelBigffa` following the exact same poll/cancel/matched pattern as casual — including the ETA-lock ref, the 15s cancel-guard on matched, and the 10-miss tolerance for transient in_queue:false blips. Matched signal dispatches a `virtue-match-loading` event with `detail.mode="bigffa"` and navigates to `/play?mode=bigffa` after the 1.2s pre-nav hold.
  - `Lobby.jsx`: 12P FFA button now toggles between orange "12P FFA" and dark "CANCEL 12P FFA MM:SS" with a live `bigffaWaitSec` timer (mirrors the Quick Match label pattern). Quick Match and Ranked buttons are now disabled while `bigffaInQueue` is true, with tooltips explaining why.
- **Tests** (`/app/backend/tests/test_bigffa_mode.py`, 9/9 passing — 4 original + 5 new):
  - Join returns ok + bot_fill_seconds=12 + eta in [4..12] range
  - Poll reflects in_queue:true with wait_seconds/queue_position immediately after join
  - After 20s the queue dispatches with matched:true + bigffa:true + match_id
  - DELETE clears the entry (subsequent GET reports in_queue:false)
  - /status endpoint returns real_players + total_players
- **Verified end-to-end** in preview:
  - Screenshot 1 (lobby, queued): button reads "CANCEL 12P FFA 00:02", timer counts up live
  - Screenshot 2 (matched): 12s later the client auto-navigated to `/play?mode=bigffa` and dropped into the 12-player arena (VIRTUE outdoor map, QUICK 1:56 timer, AK-47 25/25 ammo, 52 HP, visible enemy player "KryptOnite × RogueByte" indicator top-right)


### 2026-02-27 (later¹⁸) — 12P FFA gets a proper queue toast + 3-2-1 overlay
- **User request**: Mirror the queue box that ranked and quick match have, and mirror the ranked 3-2-1 countdown overlay so the 12P FFA drop-in feels ceremonial.
- **QueueContext.jsx**: Added `bigffaMatchFoundSec` state alongside `bigffaWaitSec`. Matched-poll handler now runs a 3-2-1 `setInterval` identical to ranked — decrementing each second, firing the `virtue-match-loading` event on 0, and navigating to `/play?mode=bigffa` after the 1.2s pre-nav hold. `stopBigffa` and `cancelBigffa` clear the timer + reset the countdown state.
- **Lobby.jsx**: New `bigffa-queue-toast` component (fixed top-center pill) — mirrors the Quick Match toast layout but in the 12P orange (#FF7A00) with a `Swords` chip. When `bigffaQueueState.matched` flips true, the header swaps to green "MATCH FOUND!" (Trophy icon) and the timer number is replaced with the animated `text-8xl` countdown digit reading `bigffaMatchFoundSec` (identical treatment to ranked's QueueOverlay). Same LEAVE QUEUE button + ETA pill as casual.
- **Verified end-to-end** in preview: SEARCHING toast shows orange with live counter, waits ~13s for bot-fill dispatch, flips to green "MATCH FOUND!" with 3-2-1 digit → navigates to /play?mode=bigffa. Screenshot confirms the ceremonial overlay renders correctly.


### 2026-02-27 (later¹⁹) — Spawn immunity, 12P FFA queue timing, weapon-board removal
- **User requests**:
  1. Make spawn immunity go away when moving — for bots and players — in every mode.
  2. Make 12P FFA queue times 20-60 seconds.
  3. Remove the weapon leaderboard.
- **Backend** (`/app/backend/server.py`):
  - **Spawn immunity (players)**: In the `input` message handler, after `player.x/z` are applied, any actual displacement (>0.02 units to ignore joystick jitter) burns `player.invuln_until` to 0. Applies universally — casual, ranked, bigffa, party, practice.
  - **Spawn immunity (bots)**: Dropped the earlier `smart and self.is_ranked` carve-out on both the movement branch (line ~5737) and the fire branch (line ~5801). Every bot in every mode now loses immunity the moment it moves or fires.
  - **BigFFA queue timing**: `BIGFFA_BOT_FILL_SEC` bumped from `12.0` → `60.0`; new `BIGFFA_ETA_MIN_SEC = 20.0` / `BIGFFA_ETA_MAX_SEC = 60.0` constants drive the per-join ETA pill sampled in `POST /queue/bigffa`. Matchmaker branch reads `BIGFFA_BOT_FILL_SEC` directly so the 60s hold + dispatch is automatic.
  - **Weapon leaderboard removed**: Deleted `WEAPON_LEADERBOARD_KEYS` + `/api/leaderboard/weapons` endpoint (verified 404). The seed-bot hashing logic went with it.
- **Frontend**:
  - `QueueContext.jsx`: bot_fill_seconds fallback bumped from 12 → 60 to match backend defaults.
  - `Leaderboard.jsx`: removed the WEAPON KINGS sub-tab, weapon-picker pills row, `WEAPON_TABS` constant, `weaponKey/weaponsData/weaponsLoading` state, weapon-fetch effect, weapon rendering block, and the "variant"/"hideStatus" props on `PlayerRow`. Sub-tab set is now just GLOBAL / FRIENDS. `Swords` import removed since nothing else on the page used it.
- **Tests**:
  - `tests/test_leaderboard_upgrades.py`: dropped the three `test_weapons_*` cases + the `WEAPON_KEYS` fixture.
  - `tests/test_bigffa_mode.py`: `test_bigffa_queue_join_returns_eta` now asserts `bot_fill_seconds == 60` and `20 ≤ estimated_wait_seconds ≤ 60`; timeout test poll deadline bumped from 20s → 70s.
  - `pytest tests/test_leaderboard_upgrades.py tests/test_bigffa_mode.py` → 12 passed.
- **Verified**:
  - curl `GET /api/leaderboard/weapons` → 404 (removed).
  - curl `POST /api/queue/bigffa` → `{bot_fill_seconds:60, estimated_wait_seconds:23, ...}` — ETA in-range.
  - Preview screenshot of `/leaderboard` shows only CURRENT SEASON / PAST SEASONS outer tabs and GLOBAL / FRIENDS inner tabs. No WEAPON KINGS chip anywhere.


### 2026-02-27 (later²⁰) — News thumbs-up, bigffa spawn-immunity carve-out, smurf HP cap
- **User requests**:
  1. Add a thumbs-up feature to the News tab and let admins edit the like count.
  2. In 12-player FFA, real players should keep the full 3-second spawn immunity (don't burn it on movement).
  3. Cap smurf bots at 100 HP.
- **News thumbs-up + admin edit** (backend `/app/backend/server.py`):
  - New `NewsPostPatchIn` payload model with all fields optional (title/body/pinned/likes).
  - New `PATCH /api/admin/news/{post_id}` endpoint — admin-only, applies any subset of fields; returns `{ok, updated:[keys]}`. Empty payload → 400.
  - New `POST /api/news/{post_id}/like` — toggles the caller's like via a compound unique index on `news_post_likes.{user_id, post_id}`; increments/decrements `news_posts.likes` accordingly. Returns `{likes, liked_by_me}` for optimistic UI.
  - `GET /api/news` now batch-fetches the caller's likes across all rendered posts in one query (no N+1), returning per-row `likes` + `liked_by_me` flags.
  - MongoDB index created at startup: `news_post_likes` compound `(user_id, post_id)` unique + secondary `post_id`.
- **News UI** (`/app/frontend/src/pages/News.jsx`):
  - Every card now shows a `ThumbsUp` toggle chip — filled yellow-on-black when liked, hollow when not — with a tabular-nums count that flips instantly on click via optimistic update, then resyncs from the server. Rollback on failure.
  - Admin-only pencil icon next to the like chip swaps in an inline `<input type=number>` with save (green check) / cancel (X) buttons that hits `PATCH /admin/news/{id}` with the new `likes` value. Keyboard shortcuts: `Enter` saves, `Escape` cancels.
- **BigFFA spawn immunity** (`server.py`): the "movement drops immunity" rule from the previous iteration now checks `not getattr(self, "is_bigffa", False)` — so real players in the 12-player deathmatch keep the full 3-second bubble regardless of movement. Every other mode still burns immunity on movement.
- **Smurf HP cap** (`server.py`): `spawn_bot` for casual FFA rooms now computes `bot.max_hp = min(MAX_HP, int(BOT_MAX_HP * bot.difficulty))`. Effect: default bots at diff=1.0 still spawn with 80 HP (unchanged); smurfs at diff≥1.25 that previously landed at 100/120 HP are now clamped at 100 HP — never exceeding a real player's pool.
- **Tests**:
  - `tests/test_news_likes.py` — 6 new cases: list carries likes/liked_by_me, toggle flips symmetrically, two users sum correctly, auth guard, admin PATCH override, PATCH empty-body 400.
  - `tests/test_bigffa_mode.py` — 3 new cases: casual bot HP capped at MAX_HP, normal 1.0-diff bot HP unchanged at 80, `bigffa_room.is_bigffa` flag locked in place.
  - `pytest tests/test_bigffa_mode.py tests/test_news_likes.py tests/test_leaderboard_upgrades.py` → 21 passed in 67s.
- **Verified end-to-end** in preview: News page shows filled thumbs-up chip at 127 likes after admin edit; unliked posts render a hollow chip at 0. Screenshots captured.


### 2026-02-27 (later²¹) — Moderation: account count + account management
- **User requests**:
  1. Show how many accounts have been created on the moderation page.
  2. Let admins manage other accounts — username changes and password changes.
- **Backend** (`/app/backend/server.py`):
  - `GET /api/admin/users/count` — returns `{total, real, seeded, admins}`. `real = total − seeded` so the headline number tracks human signups only.
  - `GET /api/admin/users/search?q=&limit=25` — case-insensitive username-prefix match OR exact-email lookup, always excluding seeded leaderboard bots. Returns id/username/email/role/level/rank_points/created_at/ban_status per row (all the chips the admin table needs).
  - `POST /api/admin/users/{username}/rename` — admin-only username change. Enforces the same 2-20 length window as user-facing rename plus a case-insensitive uniqueness check (409 on collision).
  - `POST /api/admin/users/{username}/password` — admin-only password reset via the shared `hash_password` (bcrypt) so the reset password verifies through the normal login flow. Guardrail: an admin can never reset ANOTHER admin's password (protects the seeded admin from lateral compromise).
- **Frontend** (`/app/frontend/src/pages/AdminReports.jsx`):
  - New yellow "ACCOUNTS" stat card in the top row (5-column grid instead of 4), showing the real-user total headline with a "N seeded · N admin" hint underneath. `StatCard` gained optional `hint` + `testid` props.
  - New `AccountsPanel` component — search input with 400ms debounce; each result row shows username + admin/ban chips + email/level/RP hint + two inline actions: RENAME (pencil → text input → save/cancel; Enter/Escape shortcuts) and RESET PW (key → password input → save/cancel). Successful actions toast + refresh the count stat card.
  - New `AccountRow` sub-component keeps each row's edit state local so multiple rows can be edited concurrently without cross-talk.
- **Tests** (`/app/backend/tests/test_admin_users.py`, 10 passed + 1 skipped):
  - count returns all buckets + `total == real + seeded`
  - count requires admin auth
  - search finds by username prefix + by exact email
  - search excludes seeded leaderboard bots
  - rename changes the username end-to-end
  - rename rejects duplicates with 409
  - rename requires admin auth
  - password reset lets the target log in with the new password AND blocks the old
  - password reset requires admin auth
- **Verified end-to-end** in preview: Moderation screenshot shows the "ACCOUNTS 980 · 107 SEEDED · 1 ADMIN" stat card at the top of the 5-column row and a functional ACCOUNTS panel with the debounced search filtering to matching users and inline RENAME + RESET PW buttons per row.


### 2026-02-27 (later²²) — Mobile-Only Matchmaking
- **User request**: Add a mobile-only toggle for mobile devices so they can play against only other mobile players.
- **Backend** (`/app/backend/server.py`):
  - New `QueueFlagsIn` optional Pydantic body model with `is_mobile: bool = False` and `mobile_only: bool = False`. Optional — legacy clients still work.
  - New `_platforms_compatible(a, b)` symmetric helper: two entries are incompatible iff one has `mobile_only=True` AND the other has `is_mobile=False`.
  - `POST /queue/casual`, `POST /queue/ranked`, `POST /queue/bigffa` all now accept the optional body and stamp `is_mobile`/`mobile_only` onto the queue entry.
  - Ranked + Casual matchmaker pairing loops rewritten from `pop(0) + pop(0)` to a pair-find loop that skips incompatible pairs (walks O(n²) once — fine for realistic queue sizes).
  - BigFFA dispatch rewritten: instead of dispatching the whole queue at once, each scan promotes a "lead" (either queue-size ≥ 12 → head, or oldest waited ≥ 60s → that entry). Only compat entries join the lead's match_id; the rest stay in queue. Loop repeats until no more dispatches this scan. Net effect: mobile-only + desktop queuers land in **different match IDs**.
- **Frontend**:
  - `settings.js`: new `mobileOnlyMatchmaking: false` default.
  - `SettingsModal.jsx` → Controls tab: new "MOBILE MATCHMAKING" section (Smartphone icon) with a "Mobile Only" toggle. Only rendered when `detectIsMobile()` returns true — hidden on desktop.
  - `QueueContext.jsx`: new `_platformFlags()` helper reads `settingsStore.get().mobileOnlyMatchmaking` and `detectIsMobile()` and returns `{is_mobile, mobile_only}`. `joinRanked`, `joinCasual`, `joinBigffa` all POST the flags.
- **Tests** (`/app/backend/tests/test_mobile_only_matchmaking.py`, 5/5 passing):
  - Endpoint payload acceptance (casual + bigffa)
  - Endpoints still accept legacy empty bodies
  - `_platforms_compatible` unit test with all 6 combos
  - **End-to-end**: mobile-only queuer + desktop queuer both dispatched by the 60s timeout → verified `match_id` differs (platform partition works)
- **Verified end-to-end** in preview: on a touch-emulated viewport the Settings → Controls tab shows the MOBILE MATCHMAKING section with the working toggle; screenshot confirms UI. Existing bigffa tests still pass (12/12).


### 2026-02-27 (later²³) — Mobile bots: phone icon + heavy difficulty nerf
- **User request**: When mobile matchmaking is on, ALL bots in the match should display the phone icon on the scoreboard AND be a lot worse.
- **Backend** (`/app/backend/server.py`):
  - `Player.__init__`: new `is_mobile_only: bool = False` attribute.
  - `WS /ws/game`: accepts two new query params — `mobile=0|1` (tags the caller's platform="mobile") and `mobile_only=0|1` (sets `player.is_mobile_only=True` so the room's mobile-mode check fires).
  - `GameRoom.has_mobile_only_players()`: single-source-of-truth helper that walks the room and returns True iff any real player is `is_mobile_only=True`.
  - `GameRoom.spawn_bot()`: gates a "mobile-mode" branch at the top. When `has_mobile_only_players()` is True, incoming difficulty is scaled × 0.45 (aggressive) before hitting the 0.5 floor. Disguised bots get `disguise_platform="mobile"` (instead of the previous PC-weighted random); non-disguised bots get `platform="mobile"`. The nerf applies to every subsequent spawn until the last mobile-only player leaves.
- **Frontend**:
  - `Game.jsx`: WS connect now derives `platformFlags` from `detectIsMobile()` + `settingsStore.get().mobileOnlyMatchmaking`, spreading `{mobile:1, mobile_only:1}` into the WS `extra` params exactly the same way the queue-join POSTs do. Party + spectate modes retain their existing param shapes plus the platform flags.
  - Scoreboard was already wired to render the phone chip when `platform === "mobile"` (via the existing `Smartphone` icon in `Hud.jsx`) — every bot now inherits that automatically.
- **Tests** (`/app/backend/tests/test_mobile_only_matchmaking.py`, now 8/8 passing):
  - Existing 5 (endpoint payload, legacy compat, `_platforms_compatible` unit, e2e bigffa partition)
  - New 3: `has_mobile_only_players` helper, mobile-mode bot spawn (diff × 0.45 + platform="mobile"), sanity control that non-mobile rooms preserve raw difficulty.
- **Verified end-to-end**:
  - Live WS test: joining bigffa with `?mobile=1&mobile_only=1` → all 12 combatants report `platform="mobile"` in state payload; scoreboard renders phone chips.
  - Backend log confirms fresh bot spawn diff=0.90 (raw 2.0 × 0.45) instead of the previous smurf-tier 1.70.


### 2026-02-27 (later²⁴) — Cross-play warning banner in the lobby
- **User request**: Toast a "you are queueing cross-play" reminder when a mobile user's Mobile Only toggle is off so they can flip it before searching.
- **Frontend** (`/app/frontend/src/pages/Lobby.jsx`):
  - New inline `lobby-crossplay-banner` component inserted right above the queue-mode buttons (below the PartyPanel).
  - Renders only when ALL of: `detectIsMobile()` is true, `settingsStore.mobileOnlyMatchmaking` is false, no active queue is in flight, and the banner wasn't dismissed for this session (`sessionStorage['virtue_crossplay_dismissed'] === '1'`).
  - Orange "CROSS-PLAY IS ON" header (matches the 12P FFA palette) + Smartphone icon + copy: *"You're queueing cross-play with desktop players. Tap to only match on mobile."*
  - Two actions: `MOBILE ONLY` (calls `settingsStore.set({mobileOnlyMatchmaking: true})` — banner disappears reactively, the next queue-join POST carries `mobile_only:1`) and dismiss `X` (session-scoped so the banner comes back next tab).
  - Subscribes to `settingsStore.subscribe` so if the Settings modal flips the toggle, the banner hides without a re-mount.
- **Verified in preview** (touch-emulated 390×844 viewport):
  - Banner visible after login with Mobile Only OFF.
  - Clicking `MOBILE ONLY` → banner disappears + `localStorage['virtue-settings-v1'].mobileOnlyMatchmaking = true` confirmed.
  - Screenshot captures both states.

### 2026-02-27 (later²⁵) — Hide EXIT button on mobile + harden mobile-only setting on desktop
- **User request**: Remove the EXIT button on mobile but keep it on desktop; make sure the Mobile Matchmaking option isn't available on PC.
- **Frontend changes** (verified via Playwright at both 1920×900 and 844×390 viewports):
  - `/app/frontend/src/pages/Lobby.jsx`: wrapped the header `lobby-exit-button` in `!detectIsMobile()`. Mobile users close via OS gestures / tab UI — no more crowding the compact header. Desktop retains the button + goodbye-page fallback.
  - `/app/frontend/src/components/Hud.jsx`: added `detectIsMobile` import; `game-exit-button` (top-left, pre-pointer-lock corner button) now gated behind `!detectIsMobile()` too. Touch users reach the pause menu via the on-screen pause control, so the corner EXIT is redundant clutter for them.
  - `/app/frontend/src/game/settings.js`: added defensive one-shot normalization at module load — if `detectIsMobile()` reports desktop AND `mobileOnlyMatchmaking:true` is persisted (e.g. same account/localStorage synced from a mobile session, or DevTools responsive-mode toggled off), the flag is auto-cleared and re-serialized so no invisible-checked-state can linger. Belt-and-suspenders on top of `QueueContext._platformFlags` which already `&&` the pref with `detectIsMobile()` before sending `mobile_only` upstream.
- **Verified end-to-end**:
  - Desktop 1920×900: `[data-testid="lobby-exit-button"]` count = 1 ✅ · `[data-testid="settings-mobile-only-section"]` count = 0 ✅
  - Mobile landscape 844×390: `[data-testid="lobby-exit-button"]` count = 0 ✅ · `[data-testid="settings-mobile-only-section"]` count = 1 ✅ (still available where relevant)

### 2026-02-27 (later²⁶) — Retag existing bots when a mobile-only player joins
- **User request**: When Mobile Matchmaking Only is on, the bots should ONLY have mobile icons on the scoreboard (some bots were still showing desktop icons because they spawned before the real player connected).
- **Root cause**: `spawn_bot()` already checks `has_mobile_only_players()` at spawn time and correctly tags fresh bots with `platform="mobile"` / `disguise_platform="mobile"`. BUT in casual/BigFFA the room can already be filled with disguised bots when a real mobile-only player finally joins — those pre-existing bots kept their pre-mobile-mode platform tags (random pc/mobile mix for disguised, pc/untagged for undisguised).
- **Backend fix** (`/app/backend/server.py`):
  - New `GameRoom.retag_existing_bots_mobile()` method — walks every bot in the room and forces `disguise_platform` (for disguised bots) or `platform` (for undisguised) to `"mobile"`. Idempotent. Only touches bots — real players' platform tags are untouched. Returns retag count for logging.
  - WS `/ws/game` handshake: right after `player.is_mobile_only = bool(...)` is set, if true, calls `room.retag_existing_bots_mobile()`. Wrapped in try/except so a failure here can't drop the connection.
- **Tests** (`/app/backend/tests/test_mobile_only_matchmaking.py`, now 10/10 passing):
  - `test_retag_existing_bots_flips_platform_to_mobile`: pre-seeds a disguised (`disguise_platform="pc"`) + undisguised (`platform="pc"`) bot, calls retag, asserts both flip to `"mobile"` and second call is idempotent.
  - `test_retag_ignores_real_players`: seeds a real PC player, calls retag, asserts real player's platform tag is preserved.
- **Behaviour after fix**: Mobile-only players see the phone chip on 100% of bots in their room regardless of whether the bot was spawned before or after they connected. Non-mobile players and non-mobile-only players are unaffected (retag only fires when `player.is_mobile_only=True`).

### 2026-02-27 (later²⁷) — Mobile aim assist: near-lock + sticky target tracking
- **User request**: Make mobile aim assist "almost lock onto players and continue tracking".
- **Root problem**: Previous touch aim assist did a per-frame nearest-enemy scan inside a ~50° acquire cone. When a target strafed out of that cone, aim would snap to whichever OTHER enemy was now closest to center — meaning the reticle never "followed" a moving target; it just swapped to a different one. There was also no distinction between "target near center" (should feel near-locked) and "target near edge" (should feel like a soft snap).
- **Frontend fix** (`/app/frontend/src/game/engine.js`):
  - New sticky-target state on the engine: `_stickyTargetId`, `_stickyTargetSince`. Initialized to null in the ctor.
  - Rewrote `applyAimAssist(dt, intensity)`:
    - Two cones for touch: `ACQUIRE_CONE = 0.90 rad` (~52°) to pick up a new target and `TRACK_CONE = 1.45 rad` (~83°) to keep tracking an existing one. Controller stays at 0.35 for both (no sticky, no behaviour change).
    - Every frame: if a sticky ID exists AND the target is alive + in range + inside TRACK_CONE, keep pulling toward THAT target. Otherwise clear sticky and run the old nearest-to-center acquire scan; the winner becomes the new sticky.
    - New "near-lock" boost: when the sticky target sits inside `ACQUIRE_CONE/2` (~26°) of center, lerp rate scales up to 1.7× baseline as the angle → 0. Perfectly-centered targets get a firm lock; edge-of-cone targets keep the softer snap so re-acquiring doesn't feel like a whip.
- **Verified via Playwright** (headless in-page test that mirrors the sticky state machine exactly):
  - Initial scan picks the closest-to-center enemy (E1). ✅
  - E1 strafes to ~63° (outside 52° acquire cone, inside 83° track cone) → aim STAYS on E1 despite E2 being closer to center now. ✅ (this is the tracking behaviour the user asked for)
  - E1 continues to ~100° (past 83° track cone) → sticky releases, re-acquisition picks E2. ✅
- **No behaviour change on desktop/controller**: sticky logic is gated on `this.touchActive`; the `TRACK_CONE` collapses to the same value as `ACQUIRE_CONE` for controller so nothing changes there.

### 2026-02-27 (later²⁸) — Bullet magnetism on mobile hip-fire
- **User request**: Bend fired bullets a few degrees toward the sticky target for extra polish on mobile hip-fire.
- **Frontend fix** (`/app/frontend/src/game/engine.js`):
  - New helper `_applyBulletMagnetism(rawYaw, rawPitch)` next to `applyAimAssist`. When the caller is on touch AND has a valid sticky target AND is NOT ADS, it computes the desired yaw/pitch to the sticky target's torso, then bends the outgoing shot direction toward it — capped at `MAX_BEND = 0.07 rad` (~4°) so a perfectly-aimed shot passes through unchanged and a "close enough" shoulder-graze becomes a torso hit.
  - Safety threshold: if the raw aim is more than 0.55 rad (~31.5°) off from the target, magnetism returns null (i.e. a completely missed shot stays missed — no aimbot).
  - Applied inside `_tryShoot` right before setting `pendingShootAim`. Camera doesn't move — only the direction sent to the server does. ADS shooters (right-click on desktop, ADS toggle on touch) get NO magnetism so precise scoped shots aren't nudged off-target.
- **Behavioural properties** (verified via headless Playwright test with 7 assertions):
  - `A_perfect`: perfectly-centered aim → 0 yaw change (no unwanted nudge)
  - `B_within`: 3° offset → fully corrected to target (below cap)
  - `C_capped`: 10° offset → shifted exactly 0.07 rad (~4°), no more
  - `D_safety`: 45° offset → returns null (missed shots stay missed)
  - `E_no_sticky`: no sticky target → null (magnetism only activates when aim assist has already locked on)
  - `F_dead`: dead sticky target → null
  - `G_never_exceeds_cap`: swept 0–30° offsets, max shift is exactly `MAX_BEND`
- **Where it applies**: touch hip-fire only. All primary weapons (AK / sniper hip-fire). Excludes ADS, desktop, controller. Server hitscan runs on the bent direction so this is authoritative — no client-side deception.

### 2026-02-27 (later²⁹) — Admin: edit leaderboard bot names
- **User request**: Add an option to edit the names of the leaderboard bots inside the Moderation dashboard.
- **Context**: The public leaderboard is populated by "seeded" users (`is_seeded:true` in the `users` collection). The existing Accounts panel in Moderation deliberately EXCLUDES seeded users so admin CRUD stays scoped to human accounts. That meant there was no way to rename filler names like "GoonMonarch474" without touching the seed script.
- **Backend** (`/app/backend/server.py`):
  - New endpoint `GET /api/admin/leaderboard_bots` — lists seeded users sorted by `rank_points` desc (mirrors the public leaderboard order), with optional case-insensitive `q` substring filter and a `limit` clamped to 200. Returns `{id, username, rank_points, avatar, seed_target_rp, matches, kills}` per row.
  - No new mutation endpoint — renames reuse the already-agnostic `/api/admin/users/{u}/rename` endpoint, so audit logging + collision checks stay centralised.
- **Frontend** (`/app/frontend/src/pages/AdminReports.jsx`):
  - New `LeaderboardBotsPanel` component inserted right below the existing `AccountsPanel` (`max-w-6xl mx-auto mb-6` wrapper).
  - Fields: search input (debounced 350ms), top-N limit dropdown (25/50/100/200), scrollable list capped at 520px.
  - Rows show `#rank`, current username, `{rp} RP · {matches}M · {kills}K` chip strip, and an inline rename pencil that expands to an input + save/cancel. Renamed rows patch in place, and the toast reports `Renamed <old> → <new>`.
  - Reuses the existing `admin/users/{u}/rename` endpoint so the rename UX matches the AccountRow flow exactly (Enter to save, Esc to cancel, 2-20 chars).
- **Tests** (`/app/backend/tests/test_admin_leaderboard_bots.py`, 5/5 passing):
  - Non-admin token → 401/403.
  - Happy path: top-10 bots returned, sorted RP-desc.
  - `limit` param honored + clamped to 200.
  - `q` substring filter (case-insensitive).
  - End-to-end rename + revert via the shared endpoint.
- **Verified in preview** with a Playwright smoke test: panel renders with 25 seeded bots after admin login → `/admin/reports`, clicking pencil on row 0 opens the rename input.

### 2026-02-27 (later³⁰) — Admin: edit leaderboard bot avatar + target RP
- **User request**: Extend the Leaderboard Bots panel to also tweak avatar + target RP so seasonal seeds can be re-shaped without redeploy.
- **Backend** (`/app/backend/server.py`):
  - New endpoint `PATCH /api/admin/leaderboard_bots/{username}` accepting an optional `AdminLeaderboardBotEditIn` payload — `avatar` (0-21, matches real player range) + `seed_target_rp` (0-10000, matches the seed climb window).
  - Refuses non-seeded users (400) so the mutation surface stays scoped; requires admin (403 otherwise).
  - When `seed_target_rp` is set, mirrors it into `rank_points` immediately so the leaderboard reflects the change in the very next `/leaderboard` fetch — otherwise admins would have to wait for the next climb-loop tick.
  - Returns the refreshed `{username, avatar, seed_target_rp, rank_points}` so the client can patch its row without a second fetch.
- **Frontend** (`/app/frontend/src/pages/AdminReports.jsx`):
  - Imported `Avatar` + `AVATAR_COUNT` from `PlayerCard.jsx` for the preview + grid.
  - Added a 40px `Avatar` preview to the left of each `LeaderboardBotRow` name.
  - New `Palette` button next to the rename pencil that toggles an inline "edit panel" beneath the row:
    - Compact grid of all 22 avatars (36px each) — click to select; active slot gets a yellow ring.
    - Numeric input for Target RP (0-10000, step 15 to match the ranked-match grid).
    - SAVE (green) + CANCEL (white) buttons.
  - SAVE PATCHes only the diff (avatar-only / rp-only edits both work). Successful save triggers `onEdited` callback which patches the parent's row state + toasts `Updated <name>: avatar → #X, <rp> RP`.
- **Tests** (`/app/backend/tests/test_admin_leaderboard_bots.py`, now 10/10 passing):
  - Existing 5 (list endpoint + rename e2e).
  - New 5: full avatar + RP PATCH round-trip (with revert), non-seeded refusal, partial-update (avatar-only) preserves RP, Pydantic gates on avatar>21 & rp>10000, non-admin gate.
- **Verified in preview** (Playwright): row-0 shows avatar preview, palette button opens edit panel, avatar grid renders 22+ options, RP input pre-filled, SAVE/CANCEL visible. Screenshot captures the full expanded state.

### 2026-02-27 (later³¹) — Friends list live status updates
- **User request**: Make the friends list status update live so it doesn't need a refresh.
- **Root cause**: `FriendsModal.jsx` only called `refresh()` once on open. The `last_seen_at` field on the server was being bumped on every 20Hz WS tick, but the modal never re-fetched, so users had to close+reopen to see a friend transition ONLINE → OFFLINE or LAST SEEN 5M → 6M.
- **Frontend fix** (`/app/frontend/src/components/FriendsModal.jsx`):
  - New `silentRefresh` callback that fetches `/friends` without toggling the loading spinner or wiping data on transient errors. Keeps the UI stable during background polling.
  - Added a 6s interval that fires `silentRefresh` while the modal is open (in addition to the existing 6s `refreshUnread` poll for whisper badges).
  - Also fires an immediate `silentRefresh` on `visibilitychange` when the tab becomes visible again — so a user who Alt-Tabs back after 20 minutes doesn't stare at stale statuses for up to 6 more seconds.
  - All timers + the visibility listener are cleaned up on modal close, verified via Playwright: 0 extra `/api/friends` calls in the 8s after close.
- **Verified in preview**: 1 initial fetch on open → 2 silent polls in the 14-second dwell window → 0 polls after close. Matches the 6s cadence exactly.
- **No new dependencies**: WhisperToaster / Leaderboard / PartyPanel already own their own refresh loops for their own data.

### 2026-02-27 (later³²) — Party stability: no more disappearing panel + follower actually joins the match
- **User request**: "Party constantly disappears and sometimes doesn't put both into same match."
- **Bug 1 — Party panel disappearing**: `Lobby.jsx` polled `/party/me` every 5s and tore the panel down after just 3 consecutive nulls (~15s). A single flake during the poll cadence + queue-state churn could flip the panel off, wasting whichever queue the leader had started.
  - **Fix** (`/app/frontend/src/pages/Lobby.jsx`):
    - Bumped miss threshold from 3 → 6 (~18s at 3s poll).
    - Poll cadence tightened from 5s → 3s so state transitions land within one queue-tick.
    - Added `activelyQueueingRef` (mirrored from queueContext state via a lightweight effect). Miss-teardown is now SKIPPED entirely whenever ANY queue is active — the party is literally what owns the queue entry, so a null response during matchmaking must be a transient blip.
    - Added a `visibilitychange` handler that fires an immediate `fetchAll` when the tab regains focus, mirroring the friends-list live-update fix.
- **Bug 2 — Party members split across matches**: The **casual queue had no background poll**, unlike the ranked queue. When a party leader hit Quick Match, only the leader's client entered the active-poll flow. The follower never observed the shared queue entry, never navigated at match-found, and either stayed on the lobby or joined a DIFFERENT casual match cycle when they eventually reached /play by another path.
  - **Fix** (`/app/frontend/src/context/QueueContext.jsx`):
    - Extracted the leader's active-poll setup into a reusable `beginCasualActivePoll(initial, joinTimestampMs)` — same match-found handling, same 1s poll, same 3-2-1 countdown, same 1.2s pre-nav delay.
    - Added a 3s background poll (mirrors the ranked bg poll) that fires once on mount + every 3s, hits `/queue/casual`, and if the server reports `in_queue` or `matched` (which happens for followers whose party leader queued them), the follower kicks into the same active-poll flow — including firing the match-found event and navigating to /play?mode=casual at the exact 4.2s timing the leader hit.
    - Skipped while `casualPollRef.current` is already set (leader path, or a follower who already discovered the queue) so we don't stack intervals.
- **Net effect**: Party of 2 now behaves like a real group:
  - Leader clicks Quick Match → follower's next 3s bg tick discovers `in_queue:true` → follower's active poll kicks in → both hit match-found at almost the same moment → both nav to /play?mode=casual within a second of each other → both land in the same singleton `game_room`/`tdm_room` match cycle.
  - Party panel stays visible through the entire matchmaking sequence (via the queue-active skip) plus tolerates 6 consecutive nulls before ever tearing down.
- **Verified in preview** (Playwright): app compiles cleanly (HTTP 200), casual bg poll fires `/api/queue/casual` at exactly the 3s cadence (2 requests in 8s dwell window), party poll fires `/api/party/me` at the new 3s cadence. Lobby renders normally with the new plumbing.

### 2026-02-27 (later³³) — Follower mini-toast for party queue discovery
- **User request**: Display a small notification when a follower detects the leader starting Quick Match (also useful for Ranked).
- **Frontend implementation**:
  - `/app/frontend/src/context/QueueContext.jsx`:
    - Ranked bg poll: on the first tick that discovers `in_queue || matched` for THIS client (only possible if a party leader queued us), dispatches `window` CustomEvent `virtue-follower-joined-ranked` before calling `beginActivePoll(s)`. The active-poll guard at the top of the tick guarantees this branch only runs on first successful discovery, so the event fires exactly once per queue session.
    - Casual bg poll: same pattern — dispatches `virtue-follower-joined-casual` before firing `beginCasualActivePoll(...)`.
  - `/app/frontend/src/pages/Lobby.jsx`:
    - New `followerToast` state (`{mode, ts}`) + a `useEffect` that listens for both custom events and stores the mode.
    - Second `useEffect` auto-clears the toast after 2.6s — short enough to clear before the 3-2-1 match-found overlay steals attention, long enough to read the copy.
    - Renders a top-right chip (`data-testid="follower-queue-toast"`) with a mode-tinted spinner (red for casual, blue for ranked), a small "PARTY" label, and the copy `Leader started Quick Match` or `Leader started Ranked`. Uses a local `@keyframes party-follower-toast-in` for the slide-down + fade-in entrance so it doesn't depend on any external animation utility.
- **Verified in preview** (Playwright):
  - Firing `virtue-follower-joined-casual` → toast renders with `data-mode="casual"`, inner text `PARTY\nLeader started Quick Match`. ✅
  - Firing `virtue-follower-joined-ranked` → toast renders with `data-mode="ranked"`, inner text `PARTY\nLeader started Ranked`. ✅
  - Auto-dismiss after 2.6s: count goes 1 → 0. ✅
- **Why only followers see it**: The leader path (`joinCasual` / `joinRanked`) calls `beginCasualActivePoll` / `beginActivePoll` directly with their own POST response — the bg poll's follower-detection branch is guarded by `casualPollRef.current` / `pollIdRef.current`, which are already set on the leader before the bg poll's next tick can run.

### 2026-02-27 (later³⁴) — Performance Auto Mode (BigFFA <60 FPS gate)
- **User request**: Add an auto low-detail switch that boosts FPS on weaker devices during 12P FFA only if drops below 60fps.
- **Frontend implementation**:
  - `/app/frontend/src/game/engine.js`:
    - Constructor now accepts `mode` (e.g. "bigffa", "casual"). Stored as `_matchMode` — used by the watchdog to gate its behaviour.
    - New watchdog state: `_autoPerfActive`, `_autoPerfSamples` (last 6 FPS samples ≈ 3s window), `_autoPerfBaseline` (snapshot of overridden fields), `_autoPerfPref` (`"auto" | "on" | "off"`).
    - `_autoPerfTick()` invoked once per ~500ms FPS window (from the fps counter block in the render loop, wrapped in try/catch so a watchdog bug can't crash rendering). Logic:
      - Wrong mode / pref off → force-disengage.
      - Pref on + BigFFA → force-engage.
      - Auto in BigFFA → wait for 6 samples, then engage if rolling avg < 60, disengage only after 10 consecutive samples with avg > 68 (hysteresis prevents 60/61 flapping).
    - `_autoPerfEngage()` — captures baseline once, then drops `renderer.pixelRatio → 0.6`, tightens `scene.fog.far` and `camera.far`, disables shadow map casts. Emits `virtue-autoperf-engaged` window event.
    - `_autoPerfDisengage()` — restores every field from the baseline. Emits `virtue-autoperf-disengaged`.
    - `applySettings({ autoPerf })` — writes the pref, and hot-engages / hot-disengages if the switch flip requires immediate effect.
  - `/app/frontend/src/pages/Game.jsx`: passes `mode` into the `new GameEngine(...)` constructor so BigFFA is detectable inside the engine.
  - `/app/frontend/src/game/settings.js`: new `autoPerf: "auto"` default.
  - `/app/frontend/src/components/SettingsModal.jsx` (Video tab): new 3-button segmented control (AUTO / ON / OFF) under Disable V-Sync, with the copy "Only in 12P FFA. AUTO drops resolution + fog only if your FPS falls under 60 for a few seconds. ON forces it every match. OFF keeps full quality."
  - `PerfCounter` in Game.jsx: mirrors the engine's watchdog state via the two custom events and shows an `AUTO PERF` yellow pill next to the FPS chip whenever it's active — so users know the engine adjusted quality for them instead of guessing why resolution suddenly softened.
- **Verified via Playwright** (9 assertions covering the full state machine):
  - Warmup: 5 samples at 45 FPS → still off (need full 6-sample window). ✅
  - 6th sample at 45 → avg 45 < 60 → engages. ✅
  - 20 more samples at 45 → stays engaged. ✅
  - Recover to 75, but < 10 consecutive high samples → still engaged (hysteresis). ✅
  - 10th consecutive high sample → disengages. ✅
  - Pref="on" → engages immediately in BigFFA regardless of FPS. ✅
  - Pref="off" → never engages even at 20 FPS. ✅
  - Non-BigFFA mode → never engages even at 20 FPS. ✅
  - Settings UI row + AUTO/ON/OFF buttons all render. ✅

### 2026-02-27 (later³⁵) — Mobile lobby: no more scrolling to see everything
- **User request**: Improve mobile UI so you don't have to scroll to see everything, without affecting the PC version.
- **Strategy**: Gate every compaction rule on `[@media(max-height:500px)]` — mobile landscape (post forced-rotate) is always ≤ ~400px tall, desktop laptops with narrow windows never are. This keeps the mobile fixes surgical and completely invisible to desktop.
- **Changes** (all `/app/frontend/src/pages/Lobby.jsx`):
  - Hero logo (`lobby-hero-logo`): `[@media(max-height:500px)]:!text-xl` forces the compact 20px size on short viewports; desktop keeps its `text-5xl → text-8xl` responsive ladder (96px on 1920×900).
  - Button-stack wrapper: `[@media(max-height:500px)]:space-y-1` tightens vertical gaps between mode buttons on short viewports without touching `sm:space-y-3` for desktop.
  - Rank progress bar (`lobby-rank-progress-wrap`): `[@media(max-height:500px)]:hidden` — info is still visible in Profile, but reclaims ~24px on mobile.
  - Placements badge (`placement-streak-badge`): `[@media(max-height:500px)]:hidden` — same rationale.
  - "SHOW TIERS" button: added `[@media(max-height:500px)]:!hidden` on top of existing `!hidden sm:!inline-block`.
  - Every mode button padding: `[@media(max-height:500px)]:[&]:!py-1 [@media(max-height:500px)]:!text-sm` — tighter vertical footprint per button.
  - **2-column grids on short viewports**: 12P FFA + Practice wrapped in `<div className="grid grid-cols-2 gap-1 [@media(min-height:501px)]:contents [@media(min-height:501px)]:gap-0">`. Same treatment for Leaderboard + Profile. The `min-height:501px` variant uses `display:contents` to flatten the wrapper back into the parent's vertical `space-y` stack on desktop, so the PC layout is completely untouched.
  - Cross-play banner: swapped in a shorter "Playing cross-play with desktop." one-liner via `hidden sm:inline` / `sm:hidden` twin spans.
  - `<main>` container: added base `overflow-y-auto` (with `lg:overflow-hidden` preserved for desktop) so if content still exceeds the fold, mobile users can scroll INSIDE the main flex-1 region instead of having content invisibly clipped by the fixed `h-[100dvh]` root.
- **Verified via Playwright**:
  - **Mobile 844×390** (post-forced-rotate landscape):
    - Hero renders at 20px (was 48px+). ✅
    - `ffaPracSameRow=true` — 12P FFA and Practice share a row. ✅
    - `lbProfSameRow=true` — Leaderboard and Profile share a row. ✅
    - Rank progress and placements badge hidden (`display:none`). ✅
    - After dismissing cross-play banner: `mainOverflow=2px` (was 240px+ before). Effectively no scroll needed. ✅
  - **Desktop 1920×900**:
    - Hero renders at 96px. ✅
    - Rank progress + Show Tiers + placements badge all visible. ✅
    - `ffaPracSameRow=false` and `lbProfSameRow=false` — vertical stack preserved. ✅
    - Daily Challenges panel renders on the right (unchanged). ✅

### 2026-02-27 (later³⁶) — Mobile lobby: VIRTUE logo moved into the header row
- **User request**: Move the VIRTUE logo in the mobile lobby higher, onto the same visual level as the banner (the top header row containing tier card, coins, PASS/FRIENDS/NEWS/SETTINGS/EXIT).
- **Frontend fix** (`/app/frontend/src/pages/Lobby.jsx`):
  - Added a NEW `data-testid="lobby-hero-logo-header"` `<h1>` INSIDE the `<header>` as its first child. Gated behind `hidden [@media(max-height:500px)]:block` so it only renders on short viewports (mobile landscape post-forced-rotate). `mr-auto` pushes the existing right-aligned header contents to the far right, so the tier card + coins + PASS/FRIENDS/NEWS/SETTINGS stay in their current positions — the logo just fills the previously-empty left half of the header row.
  - Changed the existing body-column hero (`data-testid="lobby-hero-logo"`) from `[@media(max-height:500px)]:!text-xl` to `[@media(max-height:500px)]:hidden` so the body version disappears entirely on short viewports — the header version replaces it (avoiding a duplicated logo).
- **Net effect on mobile 844×390**:
  - VIRTUE logo sits at `top: 35px, left: 48px` — inside the 90px-tall header row (top: 0), same visual level as the tier card + coins + PASS/FRIENDS buttons.
  - Body column starts directly with the tier badge row (BRONZE III · 0 RP), then goes straight into the Quick Match button — reclaims ~28px of vertical space so the full Ranked + 12P FFA + Practice + Leaderboard + Profile + Moderation grid fits above the fold with even MORE breathing room than before.
- **Verified via Playwright**:
  - Mobile 844×390: `lobby-hero-logo-header` visible with `display:block` at `top:35px`; `lobby-hero-logo` hidden with `display:none`. ✅
  - Desktop 1920×900: `lobby-hero-logo-header` hidden (base `hidden` class applies since max-height:500px doesn't match); `lobby-hero-logo` visible at 96px — big hero stays exactly where it was. ✅

### 2026-02-27 (later³⁷) — BigFFA queue: 20-64s range, weighted low
- **User request**: Make 12P FFA queue times 20-64s, but weighted so it's more likely to start before the 60s timer.
- **Backend fix** (`/app/backend/server.py`):
  - Bumped `BIGFFA_ETA_MAX_SEC` from 60 → 64 and `BIGFFA_BOT_FILL_SEC` from 60 → 64 (absolute hard cap).
  - New `BIGFFA_ETA_MODE_SEC = 38.0` — the peak of the triangular distribution.
  - Introduced `_sample_bigffa_dispatch_secs()` returning `random.triangular(20, 64, 38)`. Empirically over 100k samples:
    - `P(wait < 60s) ≈ 98.6%` (only 1.4% of players hit the 60s+ tail)
    - `P(wait ≤ 45s) ≈ 68%`
    - avg wait ≈ 41s
  - Enqueue path (`/queue/bigffa` POST): each new entry now carries BOTH `estimated_wait_seconds` (rounded int, for the pill display) AND `dispatch_after` (float, for the matchmaker). Two fields so future display tweaks (e.g. 5s buckets) can happen without moving the dispatch clock.
  - Matchmaker loop: switched from a global `(now - joined_at) >= BIGFFA_BOT_FILL_SEC` check to a per-entry `(now - joined_at) >= entry.dispatch_after`. Each queued player rolls their own personal timeout so a random subset of the cohort fires the dispatch — the "lead" then sweeps everyone platform-compatible into the same match. Fallback to the global 64s cap for entries missing `dispatch_after` (rolling deploy safety).
- **Tests** (`/app/backend/tests/test_bigffa_mode.py`, 14/14 passing):
  - Existing 12 tests updated for the new 64s cap (was 60).
  - `test_bigffa_dispatch_time_range_and_bias`: 5000 samples of `_sample_bigffa_dispatch_secs()` — asserts range [20, 64] AND ≥90% of samples land < 60s.
  - `test_bigffa_dispatch_after_persisted_on_queue_entry`: hits the POST endpoint 8 times, asserts every returned `estimated_wait_seconds` lands in [20, 64].
- **Client impact**: Zero client changes needed. The pill display + queue-poll wait-seconds field already source from `estimated_wait_seconds`, which now spans 20-64 with a strong low bias.

### 2026-02-27 (later³⁸) — Friends list: show queue kind for Quick Match / 12P FFA
- **User request**: Show "in queue" status on the friends list for 12P FFA and Quick Match (previously only Ranked triggered the badge).
- **Backend fix** (`/app/backend/server.py`, `_friend_card`):
  - Extended the queue-scan to also walk `CASUAL_QUEUE` and `BIGFFA_QUEUE` (was only scanning `RANKED_QUEUE`).
  - New `queue_kind` field on the response — one of `"ranked" | "casual" | "bigffa"` — so the client knows which mode label to render.
  - `queue_tier` still only populated for ranked (bronze/silver/etc.) since the other queues aren't tier-partitioned.
- **Frontend fix** (`/app/frontend/src/components/FriendsModal.jsx`):
  - Extended the `IN QUEUE` chip to suffix the queue kind: `IN QUEUE · QUICK`, `IN QUEUE · 12P FFA`, or `IN QUEUE · RANKED`. Fallback to plain `IN QUEUE` if the server hasn't yet exposed `queue_kind` (rolling deploy safety).
  - Added `data-queue-kind` attribute for tests.
- **Verified** (2 new pytests, `test_bigffa_mode.py` now 16/16 passing):
  - `test_friend_card_shows_casual_queue_kind` — A befriends B, B joins Quick Match queue → A's `/friends` response shows B with `in_queue:true, queue_kind:"casual"`.
  - `test_friend_card_shows_bigffa_queue_kind` — same flow for BigFFA. Both cleanup queue state in a `try/finally`.
- **Live status polling**: The 6s silent refresh in `FriendsModal` (from the earlier live-status fix) automatically picks up queue transitions — a friend clicking Quick Match now shows up as "IN QUEUE · QUICK" within one poll cycle.

### 2026-02-27 (later³⁹) — Spectator: can now leave the game
- **User request**: "You can't leave game when spectating."
- **Root cause**: The pause overlay (`showPause && ...`) was gated `!isSpectator`, so pressing ESC in spectator mode did nothing (`setShowPause(true)` fired but the overlay was hidden by the gate). The only visible action was the corner EXIT button on the Hud, which is easy to miss and doesn't have a spectate-specific tooltip.
- **Frontend fix** (`/app/frontend/src/pages/Game.jsx`):
  - Spectate banner (`[data-testid="spectate-banner"]`) now sits inside a flex wrapper (`spectate-banner-wrap`) alongside a new prominent red LEAVE button (`[data-testid="spectate-leave-button"]`). Click → same nav target as the pause-menu EXIT: `/lobby?spectate_ended=1&target=<username>`, which the lobby already knows how to toast as "you stopped spectating <target>".
  - ESC key handler in the game keydown listener now short-circuits when `isSpectator=true`: skips the pause overlay (which is gated off anyway) and navigates straight to the lobby with the same `spectate_ended=1` marker. Spectators now have three consistent ways to leave: corner EXIT, big red LEAVE button, ESC.
- **Verified in preview** (Playwright, SPA-nav after auth to avoid the 8-13s boot splash):
  - Banner + LEAVE button both render on `/spectate/anyplayer`. ✅
  - Clicking LEAVE navigates to `/lobby?spectate_ended=1&target=anyplayer`. ✅
  - Screenshot confirms banner + big red LEAVE button top-center alongside the corner EXIT — three visible exits, none blocking a real spectator from bailing.

### 2026-02-27 (later⁴⁰) — Quick Match queue phantom-popup on login FIXED
- **User report**: "The quick match queue pops up even when not queuing and pops up when I log in."
- **Root cause**: A stale `MATCHED_USERS[uid]` entry (casual or bigffa) survived across sessions when the WS game endpoint never got a chance to consume it (tab closed mid-3-2-1 countdown, connection dropped before ack, etc.). On next login the `QueueProvider` background poll fires immediately on mount, hits GET `/queue/casual`, sees `matched: true`, and instantly triggers the match-found overlay + 3-2-1 countdown + `nav("/play")` — even though the user never clicked Quick Match. `/queue/ranked` GET already had a 60s stale-sweep; casual and bigffa did not.
- **Backend fix** (`/app/backend/server.py`):
  - `queue_casual_state` (GET `/queue/casual`): sweep `MATCHED_USERS[uid]` if it's a casual entry older than 60s.
  - `queue_bigffa_state` (GET `/queue/bigffa`): mirror sweep for bigffa entries.
  - Same 60s window as ranked so legit party-follower auto-matches (resolve in <5s) still work.
- **Client belt-and-braces guard** (`/app/frontend/src/context/QueueContext.jsx`):
  - Ranked + casual bg-poll effects: track a `firstTick` and `sawInQueue` flag. On the very first poll after mount, suppress `matched:true` responses that arrived with no prior `in_queue:true` observation. Legit party-follower flows always transition idle → in_queue → matched across ≥2 poll ticks, so this doesn't break them; but a stale `MATCHED_USERS` entry within the 60s window is now silently ignored on load.
- **Verified** (`test_queue_stale_matched_sweep.py`, 5/5 passing):
  - Stale casual entry (>60s) → swept, GET returns `matched:false`.
  - Fresh casual entry (<60s) → still surfaces `matched:true` for legit followers.
  - Stale bigffa entry (>60s) → swept.
  - Fresh bigffa entry (<60s) → still surfaces.
  - Ranked entry doesn't leak into casual GET (or vice versa).
  - Existing `test_casual_queue.py::test_casual_matched_payload_includes_tdm_flag` updated to add `matched_at` (real matchmaker always stamps it; test was one of the only sites that didn't).

## 2026-06 — Admin Default Lobby Screen
- All 5 lobby screens restored for admins (Stormy Forest, Classic/meteor, Royal Castle, Winter/snow, Comic Poster); regular players keep Auto + Classic.
- Moderation tab: "Default Lobby Screen" panel (POST /api/admin/lobby/default_bg, persisted in db.app_settings `_id: lobby_bg`). Public GET /api/lobby/default_bg; lobby Auto resolves to it (polled every 30s).
- Non-admin stale picks (anything except auto/meteor) fall back to Auto. Tested: iteration_30 (100%).
- Pending/backlog: Android maskable icon fix (cancelled by user), refactor engine.js/server.py, WebRTC party voice.

## 2026-06 — Peak Online Persistence + Guest Presence
- Root cause: PEAK_ONLINE was in-memory only (reset on every backend restart/redeploy) and only sampled when admin polled live-stats.
- Fix: `online_peak_loop` samples every 5s; all-time peak persisted in db.meta `_id: peak_online`; 24h peak from db.online_samples (TTL 25h, written per-minute + on each new 24h high). Loaded at startup.
- Logged-out visitors (login/register/forgot screens) ping POST /api/presence/guest {guest_id} (localStorage `virtue_guest_id`); counted in real online + peaks only (not public displayed count). Guest entry dropped when that device logs in.
- Moderation Live Stats: "On Login Screens" + "Peak 24h" tiles; Real Online subtitle shows "N on login". Verified via curl across 2 backend restarts + screenshot.

## 2026-06 — Practice Map Selector Fit
- All 7 maps were already in the selector but the 2nd row (Crashsite, Tundra, Royal Guard, Silent Town) sat below the fold on desktop/phone. Selector now uses an 8-column single row (4 cols on narrow), wider modal (max-w-5xl), and a compact short-viewport layout (toggles on one row). Verified all cards visible at 1920x800 and 844x390.

## 2026-06 — Building Facade Stretch Fix
- engine.js `_buildBuilding` addFace: facade texture now tiles (RepeatWrapping, reps = round(faceWidth / max(3, height))) so long faces like the Crossfire center 20m corridor walls keep normal window proportions instead of one stretched 2x2 window grid. Applies to all maps' building faces.

## 2026-06 — Winter lobby: removed floating comic words, added SVG comic Christmas tree (twinkling lights + pulsing star, static in non-animated mode) at bottom-center.

## 2026-06 — Winter tree v2: 5 scalloped bough tiers w/ needle gradient + shading + snow dusting, glossy ornaments, glowing twinkle lights, gold bead garland, 5 3D wrapped presents w/ ribbons & bows.

## 2026-06 — New "Autumn" lobby (variant `fall`, LobbyBackgroundFall.jsx): sunset sky, hills, comic autumn trees, leaf pile, 16 falling/swaying maple+oak leaves (static scatter when animation off). Added to LOBBY_SCREENS + backend LOBBY_BG_VARIANTS; admin-selectable and settable as default in Moderation.

## 2026-06 — Fixed Stormy Forest flash when returning to lobby: autoVariant cached in localStorage `virtue_lobby_default_bg` (updated on fetch + admin save); explicit picks trusted while user loads.

## 2026-06 — Bot weapon variety
- `pick_bot_weapon(rank_tier, difficulty)` at spawn: sniper 6% (Bronze) -> ~45% (top tiers), laser 15% flat, else AK.
- Sniper bots: slower cadence (max(1000, 1700-180*diff) ms), tighter aim (x0.75 noise), casual dmg 50*min(1,0.5+0.2d), ranked smart full 50 + head/legs mults.
- Laser bots: hold beam within 30m w/ LOS via existing laser tick (now runs for laser bots); bots aim with noise (no autolock); casual dps scaled; smart bots vent at 80% heat.
- Tests: tests/test_bot_weapons.py (4 pass). Note: ~16 older source-grep tests in bot suites were already stale/failing (tier constants, peak seeding) — unrelated.

## 2026-06 — Visible weapons, sniper glint, bot loadout controls
- engine.js: remote humanoids carry AK / sniper (scope+cyan lens) / laser (cyan glow) models, swapped by `p.weapon` (_setRemoteWeapon). Sniper scope glint sprite shown while server/LocalSim `aim_at === youId` (_updateSniperGlint).
- Server: sniper bots hold aim 750ms on a LOS target before firing; `aim_at` serialized for sniper bots.
- Admin: Moderation "Bot Loadout" panel (sniper % Bronze, sniper % top rank, laser %) -> GET/POST /api/admin/bot_loadout (db.app_settings `bot_loadout`, validated sum<=100); public GET /api/bot_loadout cached to localStorage for offline LocalSim bots (now also get sniper/laser + aim-hold).
- Tests: test_bot_weapons.py + test_bot_loadout_api.py (15 pass, latter needs REACT_APP_BACKEND_URL env). iteration_31.

## 2026-06 — Killfeed: sniper kills show red Target (scope) icon (Hud.jsx WEAPON_META.sniper, testid kf-weapon-sniper).

## 2026-06 — Removed Team Deathmatch option from Practice selector (practice is FFA-only).

## 2026-06 — 12P FFA queue banner shows "Players X/12" + progress bar; cosmetic fill (11 random join times across min(ETA,15)s, never below real queue_size, 12/12 on match). QueueContext `bigffaPlayersInQueue`, testid bigffa-queue-players-count.

## 2026-06 — Ranked queue toast (QueueOverlay) shows "X/4" + blue progress bar; cosmetic fill (3 random join times across locked ETA or 30s), 4/4 on match. QueueContext `rankedPlayersInQueue`, testid queue-players-count.

## 2026-06 — Title Maker (custom shop titles)
- db.custom_titles {_id, text(upper, <=24), color #RRGGBB, style plain|shimmer|rainbow, price, active, ends_at?}; in-memory CUSTOM_TITLES cache (single worker). Users: owned_titles[], custom_title_id. public_user/public profiles expose custom_title {id,text,color,style}.
- Endpoints: admin GET/POST /api/admin/titles, PUT/DELETE /api/admin/titles/{id} (delete pulls from owners, no refund); GET /api/shop/titles, POST /api/shop/titles/buy (atomic coin deduct, auto-equip), POST /api/profile/me/custom_title {title_id|null}. Equipping season/ultimate title clears custom title and vice versa.
- Frontend: Moderation TitleMakerPanel (live preview, edit/hide/delete, Expired badge); Shop "Titles" tab (ShopTitlesTab.jsx, timer label for limited titles); banners (PlayerCard/Profile/PublicProfile) render custom text+color+style via bannerTitle.js helpers.
- Tests: backend/tests/test_custom_titles.py (15 pass), iteration_32 100%.

## 2026-06 — New Title pop-up + Title Bundles
- NewTitlePopup.jsx: lobby pop-up for newest unseen, unowned, on-sale title with ends_at (seen ids in localStorage virtue_seen_title_popups); VIEW IN SHOP opens ShopModal initialTab="titles".
- Bundles: db.title_bundles {title_id, skin_id, price, active, ends_at}; admin GET/POST/PUT/DELETE /api/admin/title_bundles; GET /api/shop/bundles (your_price = min(bundle price, value of unowned items)); POST /api/shop/bundles/buy grants+equips both (atomic, ownership guard). Deleting a title deletes its bundles. Bundle sale is independent of title active flag.
- UI: Moderation BundleMakerPanel (components/admin), Shop "Bundles" tab (ShopBundlesTab). Tests: tests/test_title_bundles.py + test_custom_titles.py (23 pass). iteration_33.

## 2026-06 — Fix: custom titles vanishing/reappearing
- Root cause: CUSTOM_TITLES (and BOT_LOADOUT) were per-process caches; production runs multiple workers/replicas so titles created/edited on one process were missing on others (Title Maker list, shop, banners flickered).
- Fix: every title/bundle endpoint + /auth/me reloads from Mongo first; background `custom_titles_refresh_loop` resyncs titles + bot loadout every 5s; reload swaps entries without clearing (no empty window). Verified by inserting a title directly in Mongo (simulated other worker).

## 2026-06 — Bundle skin dropdown now uses backend SKINS_CATALOG (GET /api/admin/title_bundles returns `skins`, all 29 non-default incl. ronin/monarch/neonknight/phoenix/shadowblade/knight/nurse); bundle skin payload carries colors for MiniSkin.

## 2026-06 — Public leaderboard bots
- ~50% of seeded leaderboard bots (stable md5(username) % 100 < 50 via `_bot_profile_public`) now return full public profiles: real lerped `stats` from seeded_climb_loop + `_synth_bot_history` (per-bot time grid, 1.5-5h period, 75% play chance per slot, seeded by name+slot) so new matches appear over time; the rest stay private. Unregistered disguised/custom bot names also use the rolling history. Tests: tests/test_bot_public_profiles.py.

## 2026-06 — Live bot activity: `bot_activity(username, tier)` derives online/in_match/match_kind from the same per-bot session grid as match history (in match during session, online 30m before/45m after). Used by leaderboard rows (seeded rows `spectatable:false` -> non-clickable IN MATCH chip) and public profiles (modal shows "IN MATCH · MODE"). History kills now scale to the bot doc kills/match average.

## 2026-06 — Match-history scoreboard bots open full profiles: PublicProfileModal now fetches /users/{name}/profile for bots too (named/custom bots get fabricated public profile + rolling history + live status); falls back to Private card only on 404.

## 2026-06 — Leaderboard bots show IN QUEUE (90-240s, deterministic per session) right before each fake match starts; leaderboard yellow spinner chip (data-status=in_queue), profile modal "IN QUEUE · MODE". `bot_activity` returns in_queue.

## 2026-06 — Bot profiles match lobby rank: `_remember_bot_identity(name, rp, level)` upserts db.bot_identity (_id=name.lower()) at disguised spawn, ranked-room reroll, and match end (ranked post-match RP / casual disguise RP). Unregistered bot profile endpoint uses this rp/level (unless admin rank override). Test: tests/test_bot_identity_profile.py.

## 2026-06 — FIX: game screen freezing when real players join
- Root cause: newer cosmetic skins (astronaut/Lunar Pioneer, knight, nurse, etc.) pushed raw meshes into `bodyMeshes` instead of {mesh, baseColor}; hit-flash loop in `_update` threw every frame for anyone seeing that player, and since update+render shared one try/catch the picture froze while HUD/audio kept going.
- Fix: `_buildHumanoid` normalizes bodyMeshes entries; hit-flash guards missing material color; `_loop` runs update and render in separate try/catch so a throwing update can never freeze the picture. Verified with two real accounts in a 12P FFA (frames advancing, 0 errors).

## 2026-06 — Stormy Forest lobby Android "lite" mode (AdminFogLobby ANDROID_LITE via UA): no CSS blur filters, no mix-blend (rain/grain), rain animated with translate3d instead of background-position, tree-crown SVG sway disabled, fog bands will-change: transform, eye-level haze uses radial gradient. Desktop unchanged.

## 2026-06 Bot Real Match Log
- Bots now record their real results at match end (db.bot_match_log, only when real players were in the match). Bot profiles (disguised/custom + public seeded leaderboard bots) merge these into history (newest first) and add them to Matches/Kills/Deaths/Wins totals.
- 2026-06: First-load spawn shield — real players get 10s immunity on first load into an online match (restarts when pre-match countdown ends; also each new round). Movement does not cancel it, only shooting/melee/laser. Respawns keep 3s (move/shoot cancels). Not in practice/offline, not for bots. FIRST_LOAD_SHIELD_S in server.py; tests/test_first_load_shield.py
- 2026-06: Mobile landscape fit — new tailwind `tiny` screen (max-height 500px). Match loading screen, match result overlay and pause menu (2-col grid) compact on short screens. Touch devices: Menu + red LEAVE button moved to top-left under ONLINE chip (top-right was covered by weapon slots), LEAVE opens "Leave match?" confirm; hidden in ranked/spectate.
- 2026-06: Mobile kill feed — touch devices show max 3 smaller semi-transparent rows, positioned left of weapon slots (right-[76px]), each fades out after 4s (KF_MOBILE_TTL_MS in Hud.jsx, .kf-row-mobile in index.css). Desktop unchanged.
- 2026-06: Mobile aim assist rewrite (engine.js `_applyTouchAimAssist`, `_aimMeasure`, `_hasLineOfSight`, `touchLook`). ROOT BUG: applyAimAssist bailed out because local player is not in this.players (used players.get(youId)) — assist never ran; now uses this.alive. New: LOS check vs obstacles, 25deg acquire / 40deg track, switch only if new target <0.5x angle, console-style strong lock scaled by nearness, aim friction near target, hard swipe away releases lock for 350ms, TDM teammates ignored, targets interpolated mesh position. Controller path unchanged.
- 2026-06: Auto Performance default OFF (settings.js DEFAULTS + engine default + SettingsModal fallback). One-time migration flag `autoPerfOffMigrated` flips existing saved "auto" to "off".
- 2026-06: Coin economy — online match rewards (play/kill/win, not practice/offline; TDM win = team win), ranked tier-up bonus, season-end coins by final tier (non-seeded users, in maybe_reset_season), 7-day daily login streak (GET /api/rewards/daily, POST /api/rewards/daily/claim; users.daily_streak/daily_last_claim). Admin GET/POST /api/admin/coin_config (db.meta coin_config) incl. timed multiplier (2x events). UI: DailyRewardModal (lobby), AdminCoinPanel (Moderation), "+N COINS" chip on match result (placements[].coins_earned). Tests: tests/test_coin_rewards.py
- 2026-06: Season reset rule changed — Goonmaster (>=2400) lands at Diamond III (1500); everyone else (incl. Diamond/Master/GM) −900 RP floor 0. Applies to real users (update_many $cond) and seeded bots (_rollback_rp). Test: tests/test_season_reset_goonmaster_diamond3.py
- 2026-06: Season Recap — users track season_peak_rp ($max on ranked), season_coins (match/daily), season_stats {matches,wins,kills} (ranked). At rollover build_season_recap() stamps users.season_recap + season_recap_seen=False (rank_points>0, non-seeded), then fields reset. GET /api/season/recap, POST /api/season/recap/seen. SeasonRecapModal.jsx in Lobby (one-time, staged animation, mobile-fit).
- 2026-06: Season History — rollover $push users.season_recaps; GET /api/me/season_recaps merges full recaps + legacy past_seasons (final rank only, full=false). Profile "Season History" card (replaces top-50 Past Seasons card) rows open SeasonRecapView (exported from SeasonRecapModal.jsx).
- 2026-06: Public Season History in PublicProfileModal (past_seasons list, uses stored tier_name). Real players keep earned tier_name (season_recap_history uses _earned_rank_snapshot). Bots: _bot_title_fields random title (55% past-season, 30% shop, 15% none); seeded bots normalized once (bot_titles_v2: tier_name from rp, drop seasons >= current / dupes); new seeds get random title; user-doc-less bots get deterministic _fake_bot_past_seasons + title. Fixed _backfill_past_seasons_once reading nonexistent db.season (now get_or_init_season) so prev-season cache = current-1.
- 2026-06: Placements hide rank — placements_done(u) (>=5 or seeded). Others see UNRANKED (rank_tier -1, grey, "?" icon, no RP) on public profile, friend cards/search, party, in-match state + killer card (Player.unranked), match-end rows (unranked flag; own row shows PREDICTED). Self sees "PREDICTED" in lobby RankBadge/PlayerCard (no RP/progress bar) and Profile ("Predicted Rank" + Placements x/5). Global/ranked leaderboards use LEADERBOARD_RANKED_QUERY (placements done or seeded); friends board masks unranked friends. Rank-up overlay suppressed during placements.
- 2026-06: Rank Reveal — RankRevealOverlay.jsx shown by Hud before MatchResultOverlay when my row is_placement && placement_match_number >= total (intro "YOUR RANK IS…", spinning icons w/ drumroll, slam + flash + burst, confetti for Gold+, tap to skip, Continue). audio.js revealDrumroll/revealImpact. Game.jsx rank-up overlay skipped for any placement match.
- 2026-06: Placement Tracker — GET /api/me/placements (this season ranked is_placement match_history, oldest first, win = 1st). PlacementTracker.jsx dots (W green / #N red / dashed pending + W-L summary, tooltip with kills & RP) under predicted rank in Lobby and in Profile Predicted Rank card footer.
- 2026-06: Mobile lobby — rank progress bar and purple Placements x/5 chip no longer hidden on short screens (progress bar max-w 320px on tiny); RankProgressBar `onDark` prop for readable labels in Lobby/Profile; public profile hides progress bar for UNRANKED; /me/placements returns only the last `placement_matches_played` results.
- 2026-06: Placement RP hidden — match-end RP tile shows "PLACEMENT", scoreboard delta "—" for is_placement rows; Profile/public history show "Placement" instead of RP; APIs (/profile/me/history, public profile) return rp_delta 0 for placement rows and public history rank_name_after "UNRANKED" for placement rows (non-self); PlacementTracker tooltip no RP.
- 2026-06: Placements — 2nd place always gains RP: +15 base + (kills*10-deaths*8)/4, clamped +10..+40 (_lib/ranks.py PLACEMENT_SECOND_*). 1st/3rd+ unchanged.
- 2026-06: Server Health panel (Moderation) — GET /api/admin/server_health: loop lag (sampled every 0.5s by _server_health_monitor), per-room tick avg/peak ms (GameRoom.run instrumentation), tick load %, process CPU/RSS (/proc), load avg, DB ping, rooms/players/bots, avg/max player ping (client now sends rtt in WS ping → player.last_ping_ms). AdminServerHealthPanel.jsx polls every 3s. High-ping investigation: live-only; deployer debug dispatched.
- 2026-06: Live ping RCA (deployer): prod tier_0 = 250m CPU, 2 replicas; single asyncio loop CPU-starved by 20Hz rooms + bots. Code fixes: GameRoom.run idles (0.5s sleep, no tick) when no human players; drift-compensated tick pacing; match_history insert/prune/skin grants moved to background task _persist_match_history. User action: raise tier in Deployment → Resources. Known: rooms are in-memory per pod (2 replicas) → players on different pods cannot meet.
- 2026-06: Settings → Server: fake region list removed; ServerRegionStatus shows real "US West (Oregon)" + live measured ping (GET /api/server_info, min of 3 samples) + NODE id (hostname hash) so users can see which replica they hit. Admin server_health includes node. Support: replica count / sticky sessions not user-configurable (2 fixed replicas) — cross-pod shared state needed for everyone to meet.
- 2026-06: Shared matchmaking across replicas — _lib/cluster.py: Mongo lease leader election (db.meta cluster_leader, TTL 10s, renew 3s); ClusterProxyMiddleware on followers forwards all /api HTTP + WS (/api/ws/game) to leader pod IP:8001 (x-virtue-proxied header prevents loops); on connect failure serves locally for 60s. Verified locally with a 2nd uvicorn on :8002 (HTTP + WS ping/pong + leader saw player). Prod pod-to-pod reachability unverified until deploy; server_health.cluster shows role/proxy counters.
- 2026-06: Party fix — TDM put party members on opposite teams. GameRoom._assign_team now joins a party mate's team (_party_mate_team via PARTY_MEMBER_INDEX); _rebalance_teams keeps party groups together (largest groups first to smaller side). Verified with /app/memory/party_probe.py (leader+follower casual queue → same match_id, same room, same team). Live split across replicas addressed by cluster proxy.
- 2026-06: Chat — placeholder "Enter", input bar always visible (desktop bottom-left above HP; press Enter/T to type). Mobile chat enabled: top-left under Menu/Leave, tap bar to type, last 3 messages.

## 2026-06 Respawn shield tweak
- Real-player respawn immunity now 4s (RESPAWN_SHIELD_S), ends early on movement or any attack. Bots keep 3s. First-load 10s shield unchanged.
- Test: tests/test_spawn_immunity_forfeit.py::test_real_player_respawn_shield_is_4s_and_breaks_on_move
- 2026-06: Mobile chat box narrowed to min(210px,28vw); messages 10px, max 2 lines, so chat stays in the left corner.
- 2026-06: Moderation "Queue Time Before Bot Autofill" panel (AdminQueueFillPanel.jsx) + GET/POST /api/admin/queue_fill_config (db.meta queue_fill_config): Quick Match secs, Big FFA min/max, Ranked min/max per each of 9 ranks. Re-synced every 30s on all pods.
- 2026-06: Quick Match autofill now min/max (casual_min/casual_max, random per queue join, stored as entry dispatch_after). Defaults 6/6.
- 2026-06: Bot match history fixed: synthetic lobby sizes now match real (FFA 4, ranked 4, TDM 8, BigFFA 12); synth ranked RP uses bot_ranked_delta (same perf formula as real); _merge_bot_history(synth, real, pts) re-walks rank_name_after from current RP. PayPal request cancelled by user.
- 2026-06: Moderation Rank Distribution chart (AdminRankDistributionPanel.jsx, GET /api/admin/rank_distribution; real players, every division + Unranked, hide-unranked toggle). Ranked level requirement removed (RANKED_MIN_LEVEL=0 backend+Lobby). "Quick Match" renamed "Casual" in all player-facing text.
- 2026-06: Rank distribution now excludes placement players (no Unranked bar) and bot accounts (is_seeded, no email, or username in custom/disguised/tiered bot name lists); response has excluded counts.
