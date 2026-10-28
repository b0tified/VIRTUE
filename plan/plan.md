# Big FFA Ping Check: Per-Mode Server Load + Big FFA Switch

A way to find out whether the 12-player Big FFA mode is causing the higher ping on the live site. It adds live measurements for each game mode and a Moderation switch to turn Big FFA off and on, so ping can be compared with and without it.

## Who it's for
- **The game's admin:** uses the Server Health panel and the switch to diagnose ping on live.
- **Players:** only affected while Big FFA is switched off. They see it as temporarily unavailable.

## Core features and experience
1. **Per-mode load in Server Health**
   - Each mode gets its own row: Casual FFA, TDM, Ranked, Big FFA, Party and Practice.
   - Each row shows:
     - active matches
     - real players and bots
     - average and worst server time per game update (in ms, with each update allowed 50 ms)
     - data sent to players per second
   - Totals for the whole server copy appear underneath, next to the existing event-loop lag and ping figures.
   - The numbers refresh about every 5 seconds, like the rest of the panel.
   - A short note explains how to read the numbers. Low server time with high ping means distance or relay cost, not the mode.
2. **Big FFA on/off switch in Moderation**
   - Switching it **off**:
     - the Big FFA queue button in the lobby shows "Temporarily unavailable" and can't be pressed
     - nobody new can queue
     - players already queued are taken out with a short message
     - **matches already running finish normally**
   - Switching it **on** brings the mode back right away.
   - The setting is saved, so it survives server restarts and applies to both live server copies within about 30 seconds.
   - The panel shows when the switch was last changed and by whom.
3. **Ping comparison readout**
   - Server Health shows the average ping of real players over the last 15 minutes, split into "Big FFA on" and "Big FFA off" periods.
   - This lets the admin compare the two without writing anything down.

## User flow
1. The admin opens Moderation → Server Health and looks at the per-mode rows during normal play.
2. If Big FFA's server time is low, it's very unlikely to be the cause. To test anyway, the admin flips the Big FFA switch off.
3. Running Big FFA matches finish. New players can't join, and the lobby shows it as temporarily unavailable.
4. The admin plays or watches for 15–30 minutes, then compares the on and off ping figures.
5. The admin switches Big FFA back on and keeps it, or leaves it off if ping clearly improved.

## UI/UX feel
- Same comic Moderation style as the existing panels: thick black borders, bold uppercase labels and the yellow/red accents.
- Per-mode rows turn yellow when server time per update goes over 15 ms and red over 30 ms.
- The switch is a clear ON/OFF toggle. Turning it off asks for confirmation.
- In the lobby, the disabled Big FFA button is greyed out with a small "Temporarily unavailable" label. The other buttons don't change.

## Implementation phases
- **Phase 1 (MVP, built now):**
  - per-mode load measurements in Server Health
  - the Big FFA on/off switch (current matches finish, queue blocked, lobby button disabled)
  - the on/off ping comparison readout
- **Phase 2:** a 24-hour history chart of ping and server time per mode, to spot the times of day when lag starts.
- **Phase 3:** a pause switch for each mode (Casual, TDM, Ranked), plus a scheduled pause option (for example, off during peak hours).

## Assumptions
- My expectation from earlier measurements is that Big FFA is **probably not** the cause:
  - live CPU was about 4%
  - match updates measured under 1.5 ms of the 50 ms allowed
  - data sent was only about 10 KB/s per player
- The plan measures to confirm this rather than assuming.
- Measurements only cover the server copy the admin's panel is talking to. The other copy's figures appear only if that copy answers; otherwise they're labelled "this copy only".
- "Data sent per second" counts game updates sent to players, not website or shop traffic.
- Bots in Big FFA count towards its load figures. The always-running background rooms each count under their own mode.
- The ping comparison uses the ping each player's game already reports. It needs at least 3 real players in the period to show a number; otherwise it shows "not enough data".
- With Big FFA off, its background rooms also stop running new matches, so the test removes all of Big FFA's server cost.
- Only admins can see the measurements and use the switch. No player-facing announcement is added.
