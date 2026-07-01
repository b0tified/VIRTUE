// LobbyBackgroundSnow — winter lobby backdrop, gated to admin accounts
// for now while we validate the aesthetic.
//
// Structure mirrors LobbyBackgroundMeteor so the visual style is
// consistent across seasonal themes:
//   * Cool blue-to-white sky gradient (arctic overcast).
//   * Halftone snowfall + parallax flake layers (back / mid / front)
//     — front flakes are big and fast, back flakes are tiny and slow.
//   * Frost-tinted pulsing blobs so the corners of the screen glow
//     like an aurora peeking through.
//   * Floating comic-style words re-themed for the winter mood.
//   * A slow horizon shimmer (like frost catching the light).
//
// `animated=false` renders the calm subset (sky + one halftone layer
// + slow blob) for low-motion / battery-saver users.
//
// All keyframes/classes live in index.css prefixed with `lobby-snow-`
// so they don't collide with the meteor/default backgrounds.

export default function LobbyBackgroundSnow({ animated = true }) {
  if (!animated) {
    return (
      <>
        <div className="absolute inset-0 lobby-snow-sky" aria-hidden />
        <div className="absolute inset-0 lobby-snow-halftone" aria-hidden style={{ opacity: 0.45 }} />
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div className="lobby-bg-blob blob-snow-cyan" style={{ top: "30%", left: "30%" }} />
        </div>
      </>
    );
  }
  return (
    <>
      {/* Sky — deep steel blue overhead fading to milky white at the
          bottom horizon, like an overcast blizzard morning. */}
      <div className="absolute inset-0 lobby-snow-sky" aria-hidden />

      {/* Aurora glow — soft cyan halo along the top-third that pulses
          slowly, evoking pale northern lights bleeding through cloud. */}
      <div className="absolute inset-0 lobby-snow-aurora lobby-snow-pulse" aria-hidden />

      {/* Halftone — cool blue dots at low opacity, ties the palette in. */}
      <div className="absolute inset-0 lobby-snow-halftone" aria-hidden />

      {/* Falling snowflakes — 3 parallax layers. `snow-back` is small,
          slow, and dim; `snow-front` is big, fast, and bright. Each
          flake is a pure-CSS radial-gradient dot, no images. Positions
          / delays are hand-picked so the field feels random without
          leaving big empty vertical stripes. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {/* Back layer — 10 tiny flakes */}
        <div className="lobby-snow-flake flake-back" style={{ left: "5%",  animationDelay: "0.0s", animationDuration: "12s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "13%", animationDelay: "2.4s", animationDuration: "13s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "22%", animationDelay: "4.8s", animationDuration: "11s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "31%", animationDelay: "1.1s", animationDuration: "14s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "42%", animationDelay: "6.7s", animationDuration: "12s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "54%", animationDelay: "3.5s", animationDuration: "13s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "65%", animationDelay: "0.9s", animationDuration: "12s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "76%", animationDelay: "5.3s", animationDuration: "14s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "86%", animationDelay: "2.0s", animationDuration: "11s" }} />
        <div className="lobby-snow-flake flake-back" style={{ left: "95%", animationDelay: "4.1s", animationDuration: "13s" }} />
        {/* Mid layer — 8 medium flakes */}
        <div className="lobby-snow-flake"            style={{ left: "8%",  animationDelay: "1.2s", animationDuration: "8s" }} />
        <div className="lobby-snow-flake"            style={{ left: "20%", animationDelay: "3.6s", animationDuration: "7s" }} />
        <div className="lobby-snow-flake"            style={{ left: "34%", animationDelay: "0.5s", animationDuration: "9s" }} />
        <div className="lobby-snow-flake"            style={{ left: "48%", animationDelay: "5.9s", animationDuration: "8s" }} />
        <div className="lobby-snow-flake"            style={{ left: "60%", animationDelay: "2.7s", animationDuration: "7s" }} />
        <div className="lobby-snow-flake"            style={{ left: "72%", animationDelay: "4.4s", animationDuration: "9s" }} />
        <div className="lobby-snow-flake"            style={{ left: "83%", animationDelay: "1.8s", animationDuration: "8s" }} />
        <div className="lobby-snow-flake"            style={{ left: "92%", animationDelay: "6.1s", animationDuration: "7s" }} />
        {/* Front layer — 5 big fast flakes */}
        <div className="lobby-snow-flake flake-front" style={{ left: "15%", animationDelay: "0.0s", animationDuration: "4.5s" }} />
        <div className="lobby-snow-flake flake-front" style={{ left: "38%", animationDelay: "2.1s", animationDuration: "5.2s" }} />
        <div className="lobby-snow-flake flake-front" style={{ left: "56%", animationDelay: "4.4s", animationDuration: "4.0s" }} />
        <div className="lobby-snow-flake flake-front" style={{ left: "72%", animationDelay: "1.3s", animationDuration: "5.8s" }} />
        <div className="lobby-snow-flake flake-front" style={{ left: "88%", animationDelay: "3.6s", animationDuration: "4.7s" }} />
      </div>

      {/* Floating comic words — winter-themed callouts. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <span className="lobby-bg-word word-cyan  lobby-bg-word-wobble" style={{ top: "8%",  left: "6%",  animationDelay: "0.0s" }}>FROST!</span>
        <span className="lobby-bg-word word-gold  lobby-bg-word-wobble" style={{ top: "72%", left: "10%", animationDelay: "0.6s" }}>CHILL!</span>
        <span className="lobby-bg-word word-cyan  lobby-bg-word-wobble" style={{ top: "18%", left: "74%", animationDelay: "1.2s" }}>BLIZZARD!</span>
        <span className="lobby-bg-word word-red   lobby-bg-word-wobble" style={{ top: "62%", left: "78%", animationDelay: "1.8s" }}>ICE!</span>
        <span className="lobby-bg-word word-gold  lobby-bg-word-wobble" style={{ top: "40%", left: "44%", animationDelay: "2.4s" }}>FLURRY!</span>
      </div>

      {/* Drifting frost blobs — cyan + pale-blue palette. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-bg-blob blob-snow-cyan   lobby-bg-blob-breathe" style={{ top: "12%", left: "55%" }} />
        <div className="lobby-bg-blob blob-snow-ice    lobby-bg-blob-breathe" style={{ top: "65%", left: "30%", animationDelay: "1.4s" }} />
        <div className="lobby-bg-blob blob-snow-white  lobby-bg-blob-breathe" style={{ top: "30%", left: "12%", animationDelay: "2.8s" }} />
      </div>

      {/* Horizon shimmer — slow horizontal sweep, like frost catching
          reflected light along the ground line. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-snow-shimmer" />
      </div>
    </>
  );
}
