import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

const HERO_BG = "https://static.prod-images.emergentagent.com/jobs/956e5f81-3c5a-4b45-a2da-bf26ea4fc4d1/images/8b081fa1209a187bd002c4c2742fa0fa5a8482ace16352fe59e7f8325721f8f8.png";

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="relative min-h-screen overflow-hidden" data-testid="landing-page">
      {/* Background hero comic burst */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${HERO_BG})` }}
        aria-hidden
      />
      <div className="absolute inset-0 halftone-light pointer-events-none" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5">
        <div className="font-display text-3xl md:text-5xl text-[#E62429] text-pow-shadow" data-testid="brand-logo">
          VIR<span className="text-[#0055FF]">TUE</span>
        </div>
        <nav className="flex gap-3">
          {user ? (
            <Link to="/lobby" className="btn-pow bg-[#FFD700] text-black" data-testid="nav-lobby">
              <span>LOBBY</span>
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn-pow bg-white text-black" data-testid="nav-login">
                <span>LOG IN</span>
              </Link>
              <Link to="/register" className="btn-pow bg-[#E62429] text-white" data-testid="nav-register">
                <span>SIGN UP</span>
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <main className="relative z-10 px-6 md:px-12 lg:px-20 mt-6 md:mt-12">
        <div className="max-w-4xl">
          <div className="inline-block bg-[#FFD700] border-pow shadow-pow-sm px-4 py-1 mb-6 -rotate-3" data-testid="hero-tag">
            <span className="font-anton uppercase tracking-widest text-lg">Online · FFA</span>
          </div>
          <h1 className="font-display uppercase text-6xl md:text-7xl lg:text-8xl leading-[0.92] text-[#0A0A0A]" data-testid="hero-title">
            <span className="text-pow-shadow-lg text-[#E62429]">FRAG</span>{" "}
            <span className="text-pow-shadow-lg">YOUR</span>
            <br />
            <span className="text-pow-shadow-lg text-[#0055FF]">FRENEMIES</span>
            <br />
            <span className="text-pow-shadow-lg">IN 3D!</span>
          </h1>
          <p className="font-body text-lg md:text-xl mt-6 max-w-xl text-black" data-testid="hero-sub">
            A comic-book brawl in your browser. Server-authoritative shooting, free-for-all deathmatch,
            one arena, zero excuses. Grab a username, lock in, and start blasting.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 items-center">
            <Link
              to={user ? "/lobby" : "/register"}
              className="btn-pow bg-[#E62429] text-white text-3xl"
              data-testid="cta-play-now"
            >
              <span>PLAY NOW &gt;</span>
            </Link>
            <Link to="/leaderboard" className="btn-pow bg-white text-black" data-testid="cta-leaderboard">
              <span>LEADERBOARD</span>
            </Link>
          </div>

          {/* Stat badges */}
          <div className="mt-10 flex flex-wrap gap-3">
            {[
              { k: "WASD", v: "MOVE" },
              { k: "MOUSE", v: "AIM" },
              { k: "CLICK", v: "SHOOT" },
              { k: "TAB", v: "SCORE" },
            ].map((b) => (
              <div key={b.k} className="card-pow px-4 py-2 -rotate-1" data-testid={`badge-${b.k.toLowerCase()}`}>
                <div className="font-anton text-xl uppercase">{b.k}</div>
                <div className="font-body text-xs uppercase tracking-widest text-neutral-600">{b.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature panels */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 pb-16">
          {[
            { t: "Online Servers", d: "Real-time WebSocket gameplay at 20Hz. No bots." },
            { t: "Install & Play", d: "Tap Install — VIRTUE drops a desktop icon and launches in its own fullscreen window." },
            { t: "Persistent Stats", d: "Kills, deaths and K/D tracked across every match." },
          ].map((f, i) => (
            <div key={f.t} className={`card-pow p-6 ${i % 2 ? "-rotate-1" : "rotate-1"}`} data-testid={`feature-${i}`}>
              <div className="font-display text-3xl uppercase text-[#E62429] text-pow-shadow">{f.t}</div>
              <p className="font-body mt-2 text-black">{f.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
