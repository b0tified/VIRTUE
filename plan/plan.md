# VIRTUE PVE: Experimental Copy of VIRTUE

A separate project that starts as an exact copy of VIRTUE, renamed "VIRTUE PVE", for trying out new ideas.
The original VIRTUE project and its live game are not changed.

## Who it's for
The game owner, who wants to experiment freely without any risk to the live game or its players.

## Core features and experience
- **Two separate projects:**
  - VIRTUE (original) stays exactly as it is, including the code, the live site, player accounts and the chat history.
  - VIRTUE PVE (new) is its own project with its own chat, preview and database.
- **The copy starts identical:** every mode, map, weapon, cosmetic, the Moderation tools and the settings.
- **Name change in the copy only:** every place that shows the game name says "VIRTUE PVE", including:
  - the start-up screen logo text,
  - the browser tab title,
  - the home-screen install name,
  - the lobby header.
- **Changes never cross over:** nothing done in one project affects the other, and there is no automatic syncing between them.

## User flow
1. In this project, the owner uses **Save → Save to GitHub** to save the current VIRTUE code to a GitHub repository.
2. The owner starts a **new Emergent project** and imports that GitHub repository.
3. In the new project's chat, the owner asks for the rename to "VIRTUE PVE". That rename is Phase 1 below.
4. From then on, all experiments are requested in the VIRTUE PVE chat. This chat (VIRTUE) is used only for the real game.

## UI/UX feel
Identical to VIRTUE, with the same comic look, colours and layout. Only the name reads "VIRTUE PVE".

## Implementation phases
- **Phase 1 (MVP, built in the new VIRTUE PVE project):** rename the game to "VIRTUE PVE" everywhere players see the name, and test it in preview. Nothing is built or changed in this original project.
- **Phase 2 (later, optional):** start the experiments themselves in VIRTUE PVE, for example player-vs-AI modes.
- **Phase 3 (later, optional):** publish VIRTUE PVE as its own live site with a separate link, if it's ready for testers. This adds 50 credits a month.

## Assumptions
- **Copy method:** "its own project" means a fully separate project, so the copy is made through GitHub rather than by forking this chat. A fork is also independent, but it continues as a branch of this conversation, not a fresh project.
- **Accounts and data:** the new project starts with an empty database. Live player accounts, coins and match history are not copied, and Moderation settings like mode names and queue times go back to their defaults. Test accounts can be recreated in the new project.
- **No live site yet:** VIRTUE PVE stays in preview only, so there is no extra monthly cost and live players never see it.
- **Sign-in:** Google sign-in works on the new preview without extra setup.
- **Name only for now:** "PVE" is only added to the name. No player-vs-AI gameplay is added in Phase 1.
- **Saving to GitHub doesn't affect the live game:** VIRTUE's live site keeps running unchanged.
