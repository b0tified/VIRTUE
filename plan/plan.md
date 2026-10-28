# Mode Switches: Turn Any or All Game Modes Off

Extends the Big FFA on/off switch to every game mode, plus one "turn everything off" control. Lets the admin pause modes for testing, fixes, maintenance or diagnosing lag without redeploying.

## Who it's for
- **The game's admin:** pauses one mode, several, or the whole game from Moderation.
- **Players:** see paused modes as unavailable in the lobby, with a clear message.

## Core features and experience
1. **One switch per mode in Moderation**
   - Modes: Casual (FFA and TDM, together and separately), Ranked, Big FFA (the existing switch), Party matches, and Practice (range and vs AI).
   - Each switch is ON/OFF, asks for confirmation when turning off, and shows when it was last changed and by whom.
   - Switching a mode **off**:
     - nobody new can queue for it or join it
     - anyone already queued is taken out with a short message
     - matches already running finish normally, then those players go back to the lobby
     - Ranked results from those finishing matches still count
   - Switching a mode **on** brings it back right away.
2. **Casual FFA and TDM separately**
   - With only one of them off, the Casual button still works and matchmaking uses the mode that's on.
   - The FFA/TDM picker greys out the mode that's off.
   - With both off, the Casual button itself shows as unavailable.
3. **"Turn all modes off" (maintenance mode)**
   - One button switches every mode off at once, after a stronger confirmation.
   - It takes an optional short message for players, for example "Back in 20 minutes – server maintenance".
   - "Turn all back on" restores every mode in one click.
   - A red banner at the top of the Moderation page shows while any mode is off, listing which ones, so it isn't forgotten.
4. **Player experience in the lobby**
   - Each paused mode's button is greyed out with "Temporarily unavailable".
   - When everything is off, a lobby banner shows the admin's message. The shop, profile, friends and other menus keep working.
   - Party leaders can't start a party match while Party is off. The party itself stays together.
   - Players already in a match at the moment of switching see nothing different until it ends.
5. **Saved and shared**
   - Settings survive restarts and apply to both live server copies within about 30 seconds.
   - Admins can still join paused modes, so fixes can be tested while players are kept out.

## User flow
1. The admin opens Moderation and finds the "Mode Switches" panel next to Server Health.
2. They flip one or more modes off, or press "Turn all modes off" and type a message.
3. Players in the lobby see those buttons greyed out within about 30 seconds, or immediately if they try to join.
4. Running matches finish and players return to the lobby.
5. When done, the admin flips modes back on, or presses "Turn all back on", and the red banner disappears.

## UI/UX feel
- Same comic Moderation style: thick black borders, bold uppercase labels, green ON and red OFF buttons.
- "Turn all modes off" is a large red button, set apart from the per-mode switches.
- Lobby buttons for paused modes are dimmed and show a clearly readable "Temporarily unavailable" tag on its own line.
- The maintenance banner in the lobby is a bold strip near the top that doesn't cover the player card.

## Implementation phases
- **Phase 1 (MVP, built now):**
  - per-mode switches, including Casual FFA and TDM separately
  - "Turn all modes off / back on" with a player message
  - lobby unavailable states and messages
  - the Moderation reminder banner
  - admins can still join paused modes
- **Phase 2:** scheduled pauses, for example off from 2–3 am, or a countdown warning in the lobby ("Ranked closes in 10 minutes").
- **Phase 3:** a history log of every switch change, and an option to show the maintenance message as an in-game News post automatically.

## Assumptions
- The existing Big FFA switch becomes one of the switches in the new panel and keeps working the same way.
- Casual has two separate switches (FFA and TDM), because Casual matchmaking already lets players pick one or both.
- Practice is included even though it uses little server power, so maintenance mode can truly stop all play.
- Ranked matches already in progress finish and count normally. Placement progress is unaffected.
- The player message is used only for "Turn all modes off". Single-mode pauses show the standard "Temporarily unavailable" text.
- Admin accounts can still queue for and join paused modes for testing.
- Spectating friends' matches that are still running keeps working.
- No automatic News post or email is sent to players.
