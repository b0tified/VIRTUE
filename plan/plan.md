# Start-Up Screen Background Picture

A single, clean picture of the VIRTUE start-up screen background, with no logo, text or loading bar.
It is delivered in chat as an image file the user can save. Nothing in the game changes.

## Who it's for
The game owner, for use in promo posts, thumbnails, store pages or other artwork.

## Core features and experience
- One picture of the background exactly as players see it when the game opens:
  - the dark red-to-black glow,
  - the gold comic halftone dots,
  - the red-and-gold speed lines streaking across.
- Removed from the picture: the VIRTUE logo, the "Season N" line, the loading bar, the "Loading" label and the percentage.
- Widescreen desktop size (1920 × 1080), saved as a sharp PNG.

## User flow
1. The start-up screen is opened with its text and bar hidden, for this capture only.
2. The background is captured while the speed lines are mid-streak, so they show up in the picture.
3. The picture is sent in chat and the user downloads it.

## UI/UX feel
It matches the live start-up screen pixel for pixel: the same gritty comic look and gold/red palette, with nothing added or restyled.

## Implementation phases
- **Phase 1 (now, MVP):** capture and send the clean 1920 × 1080 background picture. The game itself is not touched.
- **Phase 2 (later, optional):** extra sizes, such as phone portrait (1080 × 1920) and square (1080 × 1080) for social posts.
- **Phase 3 (later, optional):** a short looping video or GIF of the moving speed lines, for animated promo use.

## Assumptions
- "Loading screen" means the game start-up screen with the VIRTUE logo, not the screen shown before a match (the user confirmed this).
- Only the picture is wanted. No permanent no-text mode is added to the game (the user confirmed this).
- Size is widescreen 1920 × 1080, because the screen fills the whole window.
- The speed lines move, so the picture is one frozen moment of the animation. A capture with a good spread of visible lines will be used.
- The picture is taken from the preview version, which looks the same as the live version.
