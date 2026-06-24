// LobbyBackgroundMeteor — Season 2 meteor-themed lobby backdrop.
//
// Two visual modes:
//   * `animated=true` (default, from settings.lobbyAnimatedBackground):
//     full parallax meteor scene with pulsing crater glow, three layers
//     of falling streaks at staggered speeds for depth, drifting ember
//     blobs with breathing pulse, comic words with subtle wobble, and
//     a faint scanning sweep across the horizon.
//   * `animated=false`: minimal static version — sky gradient + a
//     single calm halftone layer + slow blobs. Lower motion (helps
//     vestibular sensitivity / battery on weak devices).
//
// All animation is CSS-only via the `lobby-meteor-*` keyframes in
// index.css. The opt-out toggle lives in Settings → Graphics.

export default function LobbyBackgroundMeteor({ animated = true }) {
  if (!animated) {
    // Calm fallback: sky gradient + 1 halftone layer + 1 ember blob,
    // no streaks/words/scan. Reads as the "old" background.
    return (
      <>
        <div className="absolute inset-0 lobby-meteor-sky" aria-hidden />
        <div className="absolute inset-0 lobby-meteor-halftone" aria-hidden style={{ opacity: 0.5 }} />
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div className="lobby-bg-blob blob-meteor-orange" style={{ top: "30%", left: "30%" }} />
        </div>
      </>
    );
  }
  return (
    <>
      {/* Sky: deep ember gradient — top fades to bruised purple, bottom
          glows hot orange where the meteor sits just out of frame. */}
      <div
        className="absolute inset-0 lobby-meteor-sky"
        aria-hidden
      />

      {/* Crater glow — horizon-line radial light, sells the "meteor just
          impacted off-camera" mood. Pulses subtly to feel alive. */}
      <div
        className="absolute inset-0 lobby-meteor-glow lobby-meteor-pulse"
        aria-hidden
      />

      {/* Halftone dots, ember-tinted. */}
      <div className="absolute inset-0 lobby-meteor-halftone" aria-hidden />

      {/* Falling meteor streaks — 3 depth layers (back/mid/front) so the
          eye reads parallax. Back layer is slow + dim, front layer is
          fast + bright. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-meteor-streak streak-back"  style={{ left: "8%",  animationDelay: "0.4s", animationDuration: "8.5s" }} />
        <div className="lobby-meteor-streak streak-back"  style={{ left: "44%", animationDelay: "3.1s", animationDuration: "9.0s" }} />
        <div className="lobby-meteor-streak streak-back"  style={{ left: "78%", animationDelay: "5.5s", animationDuration: "8.2s" }} />
        <div className="lobby-meteor-streak"              style={{ left: "12%", animationDelay: "0s",   animationDuration: "5.2s" }} />
        <div className="lobby-meteor-streak"              style={{ left: "38%", animationDelay: "1.6s", animationDuration: "6.4s" }} />
        <div className="lobby-meteor-streak"              style={{ left: "64%", animationDelay: "3.0s", animationDuration: "4.8s" }} />
        <div className="lobby-meteor-streak"              style={{ left: "85%", animationDelay: "4.4s", animationDuration: "6.8s" }} />
        <div className="lobby-meteor-streak streak-front" style={{ left: "22%", animationDelay: "2.3s", animationDuration: "3.6s" }} />
        <div className="lobby-meteor-streak streak-front" style={{ left: "56%", animationDelay: "5.9s", animationDuration: "3.9s" }} />
      </div>

      {/* Floating comic words — re-themed for the meteor season. Adds a
          gentle wobble class so each tag bobs in place. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <span className="lobby-bg-word word-red    lobby-bg-word-wobble" style={{ top: "8%",  left: "6%",  animationDelay: "0.0s" }}>BOOM!</span>
        <span className="lobby-bg-word word-gold   lobby-bg-word-wobble" style={{ top: "72%", left: "10%", animationDelay: "0.6s" }}>CRASH!</span>
        <span className="lobby-bg-word word-purple lobby-bg-word-wobble" style={{ top: "18%", left: "74%", animationDelay: "1.2s" }}>BLAZE!</span>
        <span className="lobby-bg-word word-red    lobby-bg-word-wobble" style={{ top: "62%", left: "78%", animationDelay: "1.8s" }}>IMPACT!</span>
        <span className="lobby-bg-word word-gold   lobby-bg-word-wobble" style={{ top: "40%", left: "44%", animationDelay: "2.4s" }}>FLARE!</span>
      </div>

      {/* Drifting ember blobs (override the lobby-bg-blob colours for the
          meteor palette via the dedicated `blob-meteor-*` classes). */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-bg-blob blob-meteor-orange  lobby-bg-blob-breathe" style={{ top: "12%", left: "55%" }} />
        <div className="lobby-bg-blob blob-meteor-magenta lobby-bg-blob-breathe" style={{ top: "65%", left: "30%", animationDelay: "1.4s" }} />
        <div className="lobby-bg-blob blob-meteor-gold    lobby-bg-blob-breathe" style={{ top: "30%", left: "12%", animationDelay: "2.8s" }} />
      </div>

      {/* Horizon scan — a subtle horizontal sweep that drifts across the
          bottom third every ~12s. Adds a "scanning the impact site"
          beat without competing with the streaks. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-meteor-scan" />
      </div>
    </>
  );
}
