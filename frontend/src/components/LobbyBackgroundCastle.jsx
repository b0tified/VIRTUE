/* LobbyBackgroundCastle — Royal Guard themed lobby backdrop.
 *
 * Composition (back to front):
 *   1. Night-sky gradient — deep indigo overhead fading to warm violet
 *      along the horizon, with a slow "torchlight" pulse.
 *   2. Twinkling stars — hand-placed pinpricks scattered across the top
 *      third, with staggered opacity animation.
 *   3. A pale rising moon on the right side + soft moon halo.
 *   4. Two parallax layers of stone castle silhouette (crenellated
 *      towers + battlements + a curtain wall). Back layer sits low +
 *      dim; front layer sits taller + slightly closer, both painted as
 *      pure CSS clip-paths so no image assets are needed.
 *   5. Two banner pennants swaying in the wind (left + right of the
 *      main gate), with a burgundy pennant flag + gold trim.
 *   6. Four torch flames flanking the front castle wall — flickering
 *      radial-gradient halos that pulse on staggered timers.
 *   7. Floating comic-style words ("HONOR!" "GUARD!" "VALOR!") to
 *      match the lobby's comic aesthetic.
 *   8. Slow drifting fog blobs low on the ground for depth.
 *
 * All keyframes/classes live in index.css prefixed with `lobby-castle-`
 * so they don't collide with the meteor / snow / default backgrounds.
 *
 * `animated=false` renders the calm subset (sky + silhouette + moon)
 * for low-motion / battery-saver users.
 */

export default function LobbyBackgroundCastle({ animated = true }) {
  if (!animated) {
    return (
      <>
        <div className="absolute inset-0 lobby-castle-sky" aria-hidden />
        <div className="absolute inset-0 lobby-castle-moon-halo" aria-hidden />
        <div className="absolute inset-0 lobby-castle-moon" aria-hidden />
        <div className="absolute inset-0 lobby-castle-silhouette-back" aria-hidden />
        <div className="absolute inset-0 lobby-castle-silhouette-front" aria-hidden />
      </>
    );
  }
  return (
    <>
      {/* Deep-night royal gradient. */}
      <div className="absolute inset-0 lobby-castle-sky lobby-castle-pulse" aria-hidden />

      {/* Twinkling star field — 24 hand-placed dots so the density feels
          natural without leaving obvious grid patterns. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-castle-star" style={{ top: "6%",  left: "8%",  animationDelay: "0.0s" }} />
        <div className="lobby-castle-star" style={{ top: "10%", left: "18%", animationDelay: "1.4s" }} />
        <div className="lobby-castle-star" style={{ top: "4%",  left: "27%", animationDelay: "0.7s" }} />
        <div className="lobby-castle-star" style={{ top: "14%", left: "34%", animationDelay: "2.1s" }} />
        <div className="lobby-castle-star" style={{ top: "8%",  left: "43%", animationDelay: "3.4s" }} />
        <div className="lobby-castle-star" style={{ top: "18%", left: "52%", animationDelay: "1.9s" }} />
        <div className="lobby-castle-star" style={{ top: "6%",  left: "60%", animationDelay: "0.4s" }} />
        <div className="lobby-castle-star" style={{ top: "12%", left: "68%", animationDelay: "2.8s" }} />
        <div className="lobby-castle-star" style={{ top: "4%",  left: "78%", animationDelay: "1.1s" }} />
        <div className="lobby-castle-star" style={{ top: "10%", left: "88%", animationDelay: "3.6s" }} />
        <div className="lobby-castle-star" style={{ top: "16%", left: "94%", animationDelay: "0.2s" }} />
        <div className="lobby-castle-star" style={{ top: "22%", left: "12%", animationDelay: "2.4s" }} />
        <div className="lobby-castle-star" style={{ top: "24%", left: "40%", animationDelay: "1.6s" }} />
        <div className="lobby-castle-star" style={{ top: "26%", left: "58%", animationDelay: "0.9s" }} />
        <div className="lobby-castle-star" style={{ top: "20%", left: "72%", animationDelay: "3.2s" }} />
        <div className="lobby-castle-star" style={{ top: "28%", left: "82%", animationDelay: "2.6s" }} />
        <div className="lobby-castle-star star-big" style={{ top: "8%",  left: "15%", animationDelay: "0.5s" }} />
        <div className="lobby-castle-star star-big" style={{ top: "12%", left: "50%", animationDelay: "1.8s" }} />
        <div className="lobby-castle-star star-big" style={{ top: "6%",  left: "84%", animationDelay: "3.0s" }} />
        <div className="lobby-castle-star star-big" style={{ top: "22%", left: "24%", animationDelay: "2.2s" }} />
        <div className="lobby-castle-star star-big" style={{ top: "18%", left: "64%", animationDelay: "0.8s" }} />
        <div className="lobby-castle-star star-big" style={{ top: "26%", left: "90%", animationDelay: "1.4s" }} />
      </div>

      {/* Rising moon (right of centre, upper third) — pale gold disc
          with a warm halo so it feels like a fantasy moon. */}
      <div className="absolute inset-0 lobby-castle-moon-halo" aria-hidden />
      <div className="absolute inset-0 lobby-castle-moon" aria-hidden />

      {/* Distant castle silhouette — small, dim, sits low on horizon. */}
      <div className="absolute inset-0 lobby-castle-silhouette-back" aria-hidden />

      {/* Foreground castle silhouette — taller, sharper, dominates the
          bottom third. Includes crenellated towers + curtain wall. */}
      <div className="absolute inset-0 lobby-castle-silhouette-front" aria-hidden />

      {/* Fluttering banners hanging off the castle towers. Two pennants
          on either side of the main gate. Colored burgundy with gold
          trim (matches the Royal Guard palette). */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-castle-banner banner-left" />
        <div className="lobby-castle-banner banner-right" />
      </div>

      {/* Torch flames — four warm radial halos flanking the front
          silhouette. Staggered flicker so they don't pulse in sync. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-castle-torch" style={{ bottom: "22%", left: "18%", animationDelay: "0.0s" }} />
        <div className="lobby-castle-torch" style={{ bottom: "24%", left: "36%", animationDelay: "0.8s" }} />
        <div className="lobby-castle-torch" style={{ bottom: "24%", left: "62%", animationDelay: "1.4s" }} />
        <div className="lobby-castle-torch" style={{ bottom: "22%", left: "80%", animationDelay: "0.4s" }} />
      </div>

      {/* Floating comic words — kingdom-themed callouts. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <span className="lobby-bg-word word-gold   lobby-bg-word-wobble" style={{ top: "12%", left: "8%",  animationDelay: "0.0s" }}>HONOR!</span>
        <span className="lobby-bg-word word-purple lobby-bg-word-wobble" style={{ top: "68%", left: "10%", animationDelay: "0.7s" }}>GUARD!</span>
        <span className="lobby-bg-word word-red    lobby-bg-word-wobble" style={{ top: "20%", left: "70%", animationDelay: "1.3s" }}>VALOR!</span>
        <span className="lobby-bg-word word-gold   lobby-bg-word-wobble" style={{ top: "58%", left: "76%", animationDelay: "2.0s" }}>REIGN!</span>
        <span className="lobby-bg-word word-purple lobby-bg-word-wobble" style={{ top: "38%", left: "44%", animationDelay: "2.6s" }}>KNIGHTS!</span>
      </div>

      {/* Low fog drift — soft purple blobs breathing near the ground. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-bg-blob blob-castle-purple lobby-bg-blob-breathe" style={{ top: "72%", left: "20%" }} />
        <div className="lobby-bg-blob blob-castle-gold   lobby-bg-blob-breathe" style={{ top: "78%", left: "48%", animationDelay: "1.5s" }} />
        <div className="lobby-bg-blob blob-castle-red    lobby-bg-blob-breathe" style={{ top: "70%", left: "72%", animationDelay: "3.0s" }} />
      </div>
    </>
  );
}
