/* Progression modal — single hub for the three new progression systems:
   - Season Pass (30-tier track, ramp by season_xp)
   - Daily Challenges (3/day, give season_xp + coins, reset daily)
   - Lifetime Challenges (6 big goals, give big coin payouts on claim)

   Backend bundles all three under GET /api/progression. Claims go through
   POST /api/progression/claim with { kind, id?|tier? }. Every successful
   claim refreshes the user (coins, owned_skins) and re-fetches the
   progression payload so UI state stays consistent.
*/
import { useEffect, useState } from "react";
import api from "@/api";
import { useAuth } from "@/context/AuthContext";
import { skinById } from "@/game/skins";
import SeasonTrailer from "@/components/SeasonTrailer";
import { Coins, Check, X, Lock, Star, Calendar, Trophy, Zap, Flame, Play, Clock } from "lucide-react";

// Same format helper used by the Leaderboard so the timer reads identically.
function fmtDHMS(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return { d, h, m, s: r };
}

const TABS = [
  { key: "season",    label: "Season Pass", icon: Star },
  { key: "daily",     label: "Daily",       icon: Calendar },
  { key: "lifetime",  label: "Challenges",  icon: Trophy },
];

export default function ProgressionModal({ open, onClose }) {
  const { refreshMe } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("season");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null); // { kind: 'ok'|'err', text: string }
  // Season 2 cinematic. Triggered by the PLAY TRAILER button in the
  // Season Pass modal header. Available to every account.
  const [showTrailer, setShowTrailer] = useState(false);
  // Season countdown — shared with the ranked season (same backend doc).
  // Polled once on open + live-ticked locally so the timer feels alive.
  const [seasonMeta, setSeasonMeta] = useState(null); // { season_number, seconds_left, length_days }
  const [tick, setTick] = useState(0);

  const reload = async () => {
    try {
      const { data } = await api.get("/progression");
      setData(data);
    } catch (e) {
      setToast({ kind: "err", text: e.response?.data?.detail || "Failed to load progression." });
    }
  };

  useEffect(() => {
    if (!open) return;
    setToast(null);
    setTick(0);
    reload();
    // Fetch the live season countdown from the shared `/season` endpoint —
    // same one the Leaderboard uses, so timer matches ranked exactly.
    (async () => {
      try {
        const { data } = await api.get("/season");
        setSeasonMeta(data);
      } catch {
        setSeasonMeta(null);
      }
    })();
    // Locally tick every second so the displayed countdown feels live.
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const claim = async (body) => {
    if (busy) return;
    setBusy(true);
    setToast(null);
    try {
      const { data: res } = await api.post("/progression/claim", body);
      setToast({ kind: "ok", text: res?.label || "Claimed!" });
      await refreshMe?.();
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e.response?.data?.detail || "Couldn't claim." });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
      data-testid="progression-modal"
      onClick={onClose}
    >
      <div
        className="card-pow w-[min(1080px,96vw)] max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="font-display text-3xl text-pow-shadow flex items-center gap-3">
            <span className="text-[#FFD700]">PROGRESS</span><span className="text-white">!</span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="border-pow shadow-pow-sm px-3 py-1.5 flex items-center gap-2"
              style={{ background: "#FFD700", color: "#0A0A0A" }}
              data-testid="progression-coins"
            >
              <Coins size={14} strokeWidth={3} />
              <span className="font-display text-xl leading-none">{data?.coins ?? 0}</span>
            </div>
            <button
              onClick={() => setShowTrailer(true)}
              className="btn-pow bg-[#E62429] text-white [&]:px-3 [&]:py-1.5 [&]:text-sm"
              data-testid="progression-play-trailer-button"
              title="Play the Season 2 cinematic"
            >
              <span className="flex items-center gap-1.5">
                <Play size={14} strokeWidth={3} /> PLAY TRAILER
              </span>
            </button>
            <button onClick={onClose} className="text-neutral-400 hover:text-white" data-testid="progression-close">
              <X size={22} strokeWidth={3} />
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="bg-neutral-900 flex border-b-4 border-black flex-shrink-0">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-4 py-2.5 font-anton uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-colors ${
                  active ? "bg-[#0055FF] text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                }`}
                data-testid={`progression-tab-${t.key}`}
              >
                <Icon size={14} strokeWidth={3} />
                {t.label}
              </button>
            );
          })}
        </div>
        {/* Body */}
        <div className="bg-white p-4 overflow-y-auto flex-1" data-testid="progression-body">
          {toast && (
            <div
              className={`mb-3 px-3 py-2 border-2 ${toast.kind === "ok" ? "border-[#06A35F] bg-[#E4F7EC] text-[#0a4f2a]" : "border-[#E62429] bg-[#FFE4E4] text-[#7a1115]"} font-anton uppercase tracking-widest text-xs`}
              data-testid="progression-toast"
            >
              {toast.text}
            </div>
          )}
          {!data ? (
            <div className="text-center py-10 text-neutral-500 font-anton uppercase tracking-widest">Loading…</div>
          ) : tab === "season" ? (
            <SeasonTab season={data.season} seasonMeta={seasonMeta} tick={tick} busy={busy} onClaim={(tier) => claim({ kind: "season", tier })} />
          ) : tab === "daily" ? (
            <DailyTab daily={data.daily} busy={busy} onClaim={(id) => claim({ kind: "daily", id })} />
          ) : (
            <LifetimeTab lifetime={data.lifetime} busy={busy} onClaim={(id) => claim({ kind: "challenge", id })} />
          )}
        </div>
      </div>
      {/* Admin-only Season 2 cinematic. Mounted at modal root so it
          renders on top of the modal backdrop. */}
      {showTrailer && (
        <SeasonTrailer onComplete={() => setShowTrailer(false)} />
      )}
    </div>
  );
}

/* ─── Season Pass tab ──────────────────────────────────────────────── */
function SeasonTab({ season, seasonMeta, tick, busy, onClaim }) {
  const pct = season.tier >= season.max_tier ? 100 : Math.round((season.xp_in_tier / season.xp_per_tier) * 100);
  // Live-ticked countdown — pulls the base from the API meta and decrements
  // locally each second so the timer feels alive without spamming requests.
  const secondsLeft = seasonMeta ? Math.max(0, (seasonMeta.seconds_left || 0) - (tick || 0)) : null;
  const dhms = secondsLeft !== null ? fmtDHMS(secondsLeft) : null;
  return (
    <div data-testid="progression-season">
      {/* Season countdown — mirrors the ranked season clock (shared
          backend doc), so when this hits zero ranks reset too. */}
      {seasonMeta && (
        <div
          className="mb-3 p-3 border-pow shadow-pow-sm bg-black text-white flex items-center justify-between gap-3"
          data-testid="season-pass-countdown"
        >
          <div className="flex items-center gap-2">
            <div className="inline-block bg-[#E62429] text-white border-pow-thin px-2 py-0.5 font-anton uppercase tracking-widest text-xs rotate-2">
              SEASON {seasonMeta.season_number}
            </div>
            <div className="font-anton uppercase tracking-widest text-xs opacity-70 hidden sm:inline">
              ends with ranked
            </div>
          </div>
          <div className="flex items-center gap-2 font-anton">
            <Clock size={14} strokeWidth={3} className="text-[#FFD700]" />
            {dhms && (
              <div className="flex items-baseline gap-1 tabular-nums" data-testid="season-pass-countdown-value">
                {dhms.d > 0 && (
                  <span>
                    <span className="font-display text-xl text-[#FFD700]">{dhms.d}</span>
                    <span className="text-[10px] uppercase tracking-widest opacity-70 ml-0.5">d</span>
                  </span>
                )}
                <span>
                  <span className="font-display text-xl text-[#FFD700]">{String(dhms.h).padStart(2, "0")}</span>
                  <span className="text-[10px] uppercase tracking-widest opacity-70 ml-0.5">h</span>
                </span>
                <span>
                  <span className="font-display text-xl text-[#FFD700]">{String(dhms.m).padStart(2, "0")}</span>
                  <span className="text-[10px] uppercase tracking-widest opacity-70 ml-0.5">m</span>
                </span>
                <span>
                  <span className="font-display text-xl text-[#FFD700]">{String(dhms.s).padStart(2, "0")}</span>
                  <span className="text-[10px] uppercase tracking-widest opacity-70 ml-0.5">s</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Top progress strip */}
      <div className="mb-4 p-3 border-pow shadow-pow-sm bg-gradient-to-br from-[#FFD700] to-[#FFA500]">
        <div className="flex items-center justify-between mb-2">
          <div className="font-display text-2xl text-pow-shadow">
            TIER <span className="text-white">{season.tier}</span> <span className="text-neutral-700 text-lg">/ {season.max_tier}</span>
          </div>
          <div className="font-anton uppercase tracking-widest text-sm text-neutral-800">
            {season.xp} <span className="opacity-60">Season XP</span>
          </div>
        </div>
        {season.tier < season.max_tier && (
          <>
            <div className="h-3 bg-black border-2 border-black overflow-hidden">
              <div
                className="h-full bg-[#FFFFFF]"
                style={{ width: `${pct}%`, transition: "width 0.4s ease" }}
                data-testid="progression-season-bar"
              />
            </div>
            <div className="font-anton uppercase tracking-widest text-[10px] text-neutral-800 mt-1">
              {season.xp_in_tier} / {season.xp_per_tier} XP to next tier
            </div>
          </>
        )}
        {season.tier >= season.max_tier && (
          <div className="font-anton uppercase tracking-widest text-sm text-neutral-800">
            ⚡ PASS COMPLETE — ALL TIERS UNLOCKED
          </div>
        )}
      </div>
      {/* Tier grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {(season.tiers || []).map((t) => (
          <SeasonTierCard
            key={t.tier}
            tier={t}
            busy={busy}
            onClaim={() => onClaim(t.tier)}
          />
        ))}
      </div>
    </div>
  );
}

function SeasonTierCard({ tier, busy, onClaim }) {
  const isSkin = tier.reward_type === "skin";
  const skin = isSkin ? skinById(tier.reward_skin) : null;
  const colorHex = (n) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");
  const canClaim = tier.unlocked && !tier.claimed;
  const isMilestone = tier.tier % 5 === 0 || isSkin;
  return (
    <div
      className={`border-pow ${tier.claimed ? "opacity-50" : ""}`}
      style={{
        background: isMilestone ? (isSkin ? "#FFD700" : "#FFE680") : "#F4F4F4",
      }}
      data-testid={`season-tier-${tier.tier}`}
      data-claimed={tier.claimed ? "true" : "false"}
      data-unlocked={tier.unlocked ? "true" : "false"}
    >
      <div className="px-2 py-1 bg-black text-white text-center font-anton uppercase tracking-widest text-[10px] flex items-center justify-center gap-1">
        {tier.claimed ? <Check size={11} strokeWidth={3} className="text-[#06A35F]" /> : tier.unlocked ? <Star size={11} strokeWidth={3} className="text-[#FFD700]" /> : <Lock size={11} strokeWidth={3} />}
        T{tier.tier}
      </div>
      <div className="p-2 flex flex-col items-center text-center">
        {isSkin && skin ? (
          // Mini skin preview
          <div className="relative" style={{ width: 38, height: 64 }}>
            <div className="absolute left-1/2 -translate-x-1/2 rounded-full border border-black" style={{ width: 14, height: 14, top: 0, background: colorHex(skin.head) }} />
            <div className="absolute left-1/2 -translate-x-1/2 border border-black" style={{ width: 22, height: 24, top: 16, background: colorHex(skin.body) }} />
            <div className="absolute border border-black" style={{ width: 8, height: 22, top: 38, left: 9, background: colorHex(skin.leg) }} />
            <div className="absolute border border-black" style={{ width: 8, height: 22, top: 38, right: 9, background: colorHex(skin.leg) }} />
          </div>
        ) : (
          <Coins size={32} strokeWidth={3} className="text-[#a36a00]" />
        )}
        <div className="font-anton uppercase tracking-widest text-[10px] mt-1 leading-tight">{tier.reward_label}</div>
        <button
          disabled={!canClaim || busy}
          onClick={onClaim}
          className={`mt-2 btn-pow [&]:px-2 [&]:py-1 [&]:text-[10px] ${
            tier.claimed ? "bg-neutral-300 text-neutral-500" :
            !tier.unlocked ? "bg-neutral-200 text-neutral-500" :
            "bg-[#06A35F] text-white"
          }`}
          data-testid={`season-tier-claim-${tier.tier}`}
        >
          {tier.claimed ? "CLAIMED" : !tier.unlocked ? "LOCKED" : "CLAIM"}
        </button>
      </div>
    </div>
  );
}

/* ─── Daily tab ───────────────────────────────────────────────────── */
function DailyTab({ daily, busy, onClaim }) {
  return (
    <div data-testid="progression-daily">
      <div className="mb-3 flex items-center gap-2 text-sm font-anton uppercase tracking-widest text-neutral-600">
        <Calendar size={14} strokeWidth={3} />
        Resets daily ({daily?.date} UTC)
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(daily?.challenges || []).map((c) => (
          <ChallengeCard
            key={c.id}
            challenge={c}
            busy={busy}
            onClaim={() => onClaim(c.id)}
            testid={`daily-challenge-${c.id}`}
            highlightXp
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Lifetime tab ────────────────────────────────────────────────── */
function LifetimeTab({ lifetime, busy, onClaim }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="progression-lifetime">
      {(lifetime || []).map((c) => (
        <ChallengeCard
          key={c.id}
          challenge={c}
          busy={busy}
          onClaim={() => onClaim(c.id)}
          testid={`lifetime-challenge-${c.id}`}
        />
      ))}
    </div>
  );
}

/* Single challenge card — handles both daily + lifetime since their shape
   is identical (id, name, desc, progress, goal, completed, claimed, coins,
   season_xp). */
function ChallengeCard({ challenge, busy, onClaim, testid, highlightXp }) {
  const c = challenge;
  const pct = Math.max(0, Math.min(100, Math.round((c.progress / c.goal) * 100)));
  const canClaim = c.completed && !c.claimed;
  return (
    <div
      className={`border-pow shadow-pow-sm bg-neutral-50 p-3 ${c.claimed ? "opacity-50" : ""}`}
      data-testid={testid}
      data-completed={c.completed ? "true" : "false"}
      data-claimed={c.claimed ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-anton uppercase tracking-widest text-sm">{c.name}</div>
          <div className="text-xs text-neutral-600">{c.desc}</div>
        </div>
        {c.claimed ? (
          <Check size={20} strokeWidth={3} className="text-[#06A35F] flex-shrink-0" />
        ) : c.completed ? (
          <Zap size={20} strokeWidth={3} className="text-[#FFD700] flex-shrink-0 animate-pulse" />
        ) : (
          <Flame size={20} strokeWidth={3} className="text-neutral-300 flex-shrink-0" />
        )}
      </div>
      {/* Progress bar */}
      <div className="h-2 bg-neutral-200 border border-black mb-1">
        <div
          className={`h-full ${c.completed ? "bg-[#06A35F]" : "bg-[#0055FF]"}`}
          style={{ width: `${pct}%`, transition: "width 0.4s ease" }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] font-anton uppercase tracking-widest">
        <span className="text-neutral-700">{c.progress} / {c.goal}</span>
        <div className="flex items-center gap-2">
          {c.season_xp ? (
            <span className={`flex items-center gap-1 ${highlightXp ? "text-[#FFD700]" : "text-[#0055FF]"}`}>
              <Star size={11} strokeWidth={3} /> +{c.season_xp}
            </span>
          ) : null}
          {c.coins ? (
            <span className="flex items-center gap-1 text-[#a36a00]">
              <Coins size={11} strokeWidth={3} /> +{c.coins}
            </span>
          ) : null}
        </div>
      </div>
      <button
        disabled={!canClaim || busy}
        onClick={onClaim}
        className={`mt-2 w-full btn-pow [&]:py-1.5 [&]:text-xs ${
          c.claimed ? "bg-neutral-300 text-neutral-500" :
          c.completed ? "bg-[#06A35F] text-white" :
          "bg-neutral-200 text-neutral-500"
        }`}
        data-testid={`${testid}-claim`}
      >
        {c.claimed ? "CLAIMED" : c.completed ? "CLAIM" : "IN PROGRESS"}
      </button>
    </div>
  );
}
