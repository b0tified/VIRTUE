// LobbyBackgroundMeteor — Season 2 meteor-themed lobby backdrop.
//
// Reuses the same layered architecture as `LobbyBackground` so the lobby
// shell doesn't have to know which season it's in — drop-in replacement
// triggered by `season_number >= 2` (or admin preview).
//
// Visual stack (back → front):
//   1. Deep red-orange sky gradient (matches the meteor crashsite map's
//      atmosphere — same palette the engine uses for `crashsite` arenas).
//   2. Glowing horizon line / crater glow at the bottom (radial gradient).
//   3. Drifting halftone dots, but tinted ember instead of yellow.
//   4. Diagonal falling meteor streaks — fire-trail comic SFX.
//   5. Floating comic word-bursts re-themed: "BOOM!", "CRASH!", "BLAZE!".
//   6. Slow-drifting ember blobs (orange / magenta / gold).
//
// All animation is CSS-only via the `lobby-meteor-*` keyframes in index.css.
// Mirrors the lobby-bg-* structure so existing layout (z-index, sizing,
// pointer-events) works without changes.

export default function LobbyBackgroundMeteor() {
  return (
    <>
      {/* Sky: deep ember gradient — top fades to bruised purple, bottom
          glows hot orange where the meteor sits just out of frame. */}
      <div
        className="absolute inset-0 lobby-meteor-sky"
        aria-hidden
      />

      {/* Crater glow — horizon-line radial light, sells the "meteor just
          impacted off-camera" mood. */}
      <div className="absolute inset-0 lobby-meteor-glow" aria-hidden />

      {/* Halftone dots, ember-tinted. */}
      <div className="absolute inset-0 lobby-meteor-halftone" aria-hidden />

      {/* Falling meteor streaks (4 staggered diagonals). */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-meteor-streak" style={{ left: "12%", animationDelay: "0s",   animationDuration: "5.2s" }} />
        <div className="lobby-meteor-streak" style={{ left: "38%", animationDelay: "1.6s", animationDuration: "6.4s" }} />
        <div className="lobby-meteor-streak" style={{ left: "64%", animationDelay: "3.0s", animationDuration: "4.8s" }} />
        <div className="lobby-meteor-streak" style={{ left: "85%", animationDelay: "4.4s", animationDuration: "6.8s" }} />
      </div>

      {/* Floating comic words — re-themed for the meteor season. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <span className="lobby-bg-word word-red"    style={{ top: "8%",  left: "6%"  }}>BOOM!</span>
        <span className="lobby-bg-word word-gold"   style={{ top: "72%", left: "10%" }}>CRASH!</span>
        <span className="lobby-bg-word word-purple" style={{ top: "18%", left: "74%" }}>BLAZE!</span>
        <span className="lobby-bg-word word-red"    style={{ top: "62%", left: "78%" }}>IMPACT!</span>
        <span className="lobby-bg-word word-gold"   style={{ top: "40%", left: "44%" }}>FLARE!</span>
      </div>

      {/* Drifting ember blobs (override the lobby-bg-blob colours for the
          meteor palette via the dedicated `blob-meteor-*` classes). */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-bg-blob blob-meteor-orange" style={{ top: "12%", left: "55%" }} />
        <div className="lobby-bg-blob blob-meteor-magenta" style={{ top: "65%", left: "30%" }} />
        <div className="lobby-bg-blob blob-meteor-gold"   style={{ top: "30%", left: "12%" }} />
      </div>
    </>
  );
}
