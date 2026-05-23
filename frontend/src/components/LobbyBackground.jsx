// LobbyBackground — animated comic/pop-art backdrop for the lobby.
// Composed of three parallax-drifting layers + a slow zoom on the supplied
// poster image so the lobby never feels static.
//
// Layers:
//   1. Slowly zooming/panning poster image (`imageUrl`) — foundation
//   2. Drifting yellow-on-navy halftone dot field
//   3. Floating comic "BANG / POW / ZAP" word-bursts
//   4. Streaking red/blue/yellow diagonal speed lines
//
// All animation is CSS-only via @keyframes (see App.css). No JS RAF loop.

export default function LobbyBackground({ imageUrl }) {
  return (
    <>
      {/* Poster image, slow Ken-Burns zoom */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-80 lobby-bg-zoom"
        style={{ backgroundImage: `url(${imageUrl})` }}
        aria-hidden
      />

      {/* Dark mask + animated halftone */}
      <div className="absolute inset-0 bg-black/55" aria-hidden />
      <div className="absolute inset-0 lobby-bg-halftone" aria-hidden />

      {/* Speed-line streaks */}
      <div className="absolute inset-0 lobby-bg-streaks" aria-hidden />

      {/* Floating comic words */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <span className="lobby-bg-word word-red"    style={{ top: "8%",  left: "6%"  }}>BANG!</span>
        <span className="lobby-bg-word word-blue"   style={{ top: "72%", left: "10%" }}>POW!</span>
        <span className="lobby-bg-word word-gold"   style={{ top: "18%", left: "76%" }}>ZAP!</span>
        <span className="lobby-bg-word word-purple" style={{ top: "60%", left: "82%" }}>BOOM!</span>
        <span className="lobby-bg-word word-green"  style={{ top: "40%", left: "44%" }}>WHAM!</span>
      </div>

      {/* Drifting comic-shape blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="lobby-bg-blob blob-red"  style={{ top: "12%", left: "55%" }} />
        <div className="lobby-bg-blob blob-blue" style={{ top: "65%", left: "30%" }} />
        <div className="lobby-bg-blob blob-gold" style={{ top: "30%", left: "12%" }} />
      </div>
    </>
  );
}
