// Procedural audio: per-shooter pitch variation, distance attenuation,
// footsteps, rock-style lobby music.
class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicTimer = null;
    this.musicPlaying = false;
    this.muted = false;
    this.musicMuted = false;
    this.sfxMuted = false;
    this._musicVol = 0.32;
    this._sfxVol = 0.65;
    this._masterVol = 0.9;
    // 3D / spatial audio. When enabled, SFX with a world position go
    // through a PannerNode so they stereo-pan + attenuate based on the
    // listener's location and yaw. The engine drives the listener state
    // via `updateListener(x, y, z, yaw)` each frame.
    this._audio3D = true;
    this._listenerYaw = 0;
  }

  /* Toggle spatial audio. Off = legacy distance-only volume falloff
     (one mono gain), on = PannerNode chain. Cheap — just flips a flag;
     subsequent SFX pick the chosen path. */
  set3DAudio(on) {
    this._audio3D = !!on;
  }

  /* Engine drives this each frame so spatialised SFX have a current
     listener pose. AudioListener positioning defaults to (0, 0, 0)
     looking down -Z, which matches our camera convention. */
  updateListener(x, y, z, yaw) {
    if (!this.ctx || !this.ctx.listener) return;
    const L = this.ctx.listener;
    this._listenerYaw = yaw;
    // Web Audio: prefer positionX/Y/Z + forwardX/Y/Z setters (newer API),
    // fall back to setPosition/setOrientation on older Safari.
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(x, t, 0.02);
      L.positionY.setTargetAtTime(y, t, 0.02);
      L.positionZ.setTargetAtTime(z, t, 0.02);
      // Forward vector — camera convention (-sin yaw, 0, -cos yaw).
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      L.forwardX.setTargetAtTime(fx, t, 0.02);
      L.forwardY.setTargetAtTime(0, t, 0.02);
      L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(0, t, 0.02);
      L.upY.setTargetAtTime(1, t, 0.02);
      L.upZ.setTargetAtTime(0, t, 0.02);
    } else if (L.setPosition) {
      L.setPosition(x, y, z);
      L.setOrientation(-Math.sin(yaw), 0, -Math.cos(yaw), 0, 1, 0);
    }
  }

  /* Build a PannerNode at the given world position. Returns a node that
     should be the LAST node before sfxGain. Caller is responsible for
     disposing the chain after the SFX ends — but PannerNode is GC'd as
     soon as no OscillatorNode/BufferSource references it, so a one-shot
     SFX can just connect and forget. */
  _makePanner(x, y, z) {
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 4;       // full volume within 4m
    p.maxDistance = 80;       // silent past 80m
    p.rolloffFactor = 1.4;    // steeper falloff than default 1.0
    p.coneInnerAngle = 360;   // omnidirectional source
    if (p.positionX) {
      const t = this.ctx.currentTime;
      p.positionX.setValueAtTime(x, t);
      p.positionY.setValueAtTime(y, t);
      p.positionZ.setValueAtTime(z, t);
    } else if (p.setPosition) {
      p.setPosition(x, y, z);
    }
    return p;
  }

  /* Decide the output node for a positional SFX. Returns either a fresh
     PannerNode (when 3D audio is on AND world position was provided) or
     the global sfxGain (legacy path). Callers should connect their last
     gain → returned node, then the returned node already feeds sfxGain. */
  _spatialOut(x, y, z) {
    if (!this._audio3D || x === undefined || x === null) return this.sfxGain;
    const p = this._makePanner(x, y, z);
    p.connect(this.sfxGain);
    return p;
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this._masterVol;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicMuted ? 0 : this._musicVol;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxMuted ? 0 : this._sfxVol;
      this.sfxGain.connect(this.master);
    }
    // Browser autoplay policy: AudioContext starts "suspended" until a
    // user gesture. resume() returns a Promise that resolves whenever
    // the context actually transitions to "running". Some browsers
    // (notably Safari) reject if there's no active gesture, which is
    // fine — the next interaction listener will retry.
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  /* Tiny UI blip used on button hover. Triangle-wave chirp from a
     base frequency (default 880Hz) → +50% over ~55ms with a fast
     pluck envelope. Passing different `seed` values produces a
     stable-but-distinct timbre per button so a row of buttons sweeps
     a melodic arpeggio instead of a single repeating chirp. The
     `useButtonSounds` hook hashes the button's data-testid (or text
     fallback) into a seed in the 0..11 range, then maps that to a
     pentatonic-ish frequency table for pleasant-sounding combos. */
  playUIBlip(seed = 0) {
    if (!this._ensure()) return;
    if (this.sfxMuted) return;
    // 12-note scale tuned to feel like distinct comic "blips" without
    // jangling — major pentatonic spanning ~1.5 octaves (D-pentatonic
    // in the 660Hz..1490Hz range).
    const SCALE = [660, 740, 880, 990, 1100, 1240, 1390, 1480, 740, 880, 1100, 1390];
    const base = SCALE[((seed % SCALE.length) + SCALE.length) % SCALE.length];
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    // Alternating waveforms (triangle / square light) per seed give
    // an additional timbre layer beyond pitch.
    osc.type = seed % 3 === 0 ? "sine" : seed % 3 === 1 ? "triangle" : "square";
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.055);
    gain.gain.setValueAtTime(0.0, t);
    gain.gain.linearRampToValueAtTime(osc.type === "square" ? 0.06 : 0.10, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.10);
  }

  /* Queue-start fanfare. Three short notes arpeggiating up — comic
     "ready, set, go!" feel. Plays whenever the player enters a
     matchmaking queue (ranked / casual). Louder than the hover blip
     since it's a deliberate user action moment. */
  playQueueStart() {
    if (!this._ensure()) return;
    if (this.sfxMuted) return;
    const t0 = this.ctx.currentTime;
    const notes = [
      { f: 660, at: 0.00, dur: 0.16 },
      { f: 880, at: 0.10, dur: 0.16 },
      { f: 1240, at: 0.22, dur: 0.30 },
    ];
    for (const n of notes) {
      const t = t0 + n.at;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(n.f, t);
      osc.frequency.exponentialRampToValueAtTime(n.f * 1.06, t + n.dur);
      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + n.dur);
      osc.connect(gain).connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + n.dur + 0.05);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this._masterVol;
  }

  setMusicMuted(m) {
    this.musicMuted = m;
    if (this.musicGain) this.musicGain.gain.value = m ? 0 : this._musicVol;
  }

  setSfxMuted(m) {
    this.sfxMuted = m;
    if (this.sfxGain) this.sfxGain.gain.value = m ? 0 : this._sfxVol;
  }

  /* Volume setters (0..1). Used by the new slider UI. Mute toggles still
     work — a 0-volume mute is treated as muted = true so the SFX preview
     button can still wake the audio context. */
  setMasterVolume(v) {
    this._masterVol = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master) this.master.gain.value = this.muted ? 0 : this._masterVol;
  }
  setMusicVolume(v) {
    this._musicVol = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.musicGain) this.musicGain.gain.value = this.musicMuted ? 0 : this._musicVol;
  }
  setSfxVolume(v) {
    this._sfxVol = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxMuted ? 0 : this._sfxVol;
  }
  getVolumes() {
    return {
      master: this._masterVol ?? 0.9,
      music: this._musicVol,
      sfx: this._sfxVol,
    };
  }

  /* -------- UI cue: triumphant "match found" fanfare --------
     3-note ascending chord (perfect 4th → 5th → octave) over a soft sub thump,
     ~700ms total. Mixed through sfxGain so the Mute SFX toggle silences it. */
  matchFound() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const root = 440;
    const intervals = [1.0, 4 / 3, 3 / 2, 2.0]; // root, P4, P5, octave
    const out = this.sfxGain;

    intervals.forEach((mult, i) => {
      const t0 = now + i * 0.12;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i === intervals.length - 1 ? "triangle" : "square";
      osc.frequency.value = root * mult;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
      osc.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(t0 + 0.5);
    });

    // Sub-bass thump under the chord
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(80, now);
    sub.frequency.exponentialRampToValueAtTime(40, now + 0.6);
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(0.24, now + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    sub.connect(sg);
    sg.connect(out);
    sub.start(now);
    sub.stop(now + 0.75);
  }

  /* Victory fanfare — bright ascending C-major arpeggio + soaring top
     note with shimmer + sub-bass swell. Roughly 2.0s total. Plays once
     when the match-result overlay mounts in 1st-place state. */
  victory() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.sfxGain;
    // C major arpeggio: C5, E5, G5, C6, E6, G6
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0];
    notes.forEach((freq, i) => {
      const t0 = now + i * 0.11;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      osc.connect(g); g.connect(out);
      osc.start(t0); osc.stop(t0 + 0.4);
    });
    // Sustained top C with vibrato — the "trumpet hold"
    const holdStart = now + notes.length * 0.11;
    const hold = ctx.createOscillator();
    const hg = ctx.createGain();
    hold.type = "triangle";
    hold.frequency.value = 1046.5; // C6
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain).connect(hold.frequency);
    hg.gain.setValueAtTime(0.0001, holdStart);
    hg.gain.exponentialRampToValueAtTime(0.2, holdStart + 0.05);
    hg.gain.setValueAtTime(0.2, holdStart + 0.7);
    hg.gain.exponentialRampToValueAtTime(0.0001, holdStart + 1.2);
    hold.connect(hg); hg.connect(out);
    hold.start(holdStart); hold.stop(holdStart + 1.25);
    lfo.start(holdStart); lfo.stop(holdStart + 1.25);
    // Sub-bass swell underneath
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(65, now);
    sub.frequency.exponentialRampToValueAtTime(130, now + 1.4);
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(0.28, now + 0.6);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
    sub.connect(sg); sg.connect(out);
    sub.start(now); sub.stop(now + 2.0);
    // Bright shimmer — high noise burst gated by lowpass for a "magic"
    // sparkle texture on top of the chord
    const noiseLen = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.4);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 3500;
    const sn = ctx.createGain();
    sn.gain.setValueAtTime(0.0001, holdStart);
    sn.gain.exponentialRampToValueAtTime(0.08, holdStart + 0.1);
    sn.gain.exponentialRampToValueAtTime(0.0001, holdStart + 1.3);
    src.connect(hp); hp.connect(sn); sn.connect(out);
    src.start(holdStart); src.stop(holdStart + 1.4);
  }

  /* Defeat sting — descending minor "sad trombone" trio with a final
     pitch-bend down + low buzz. Roughly 1.6s. Plays once when match
     ends in any non-1st placement. */
  defeat() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.sfxGain;
    // Three descending notes ~ minor 2nd / minor 3rd intervals (sad horn)
    const notes = [
      { f: 392.0, t: 0.00, dur: 0.32 },  // G4
      { f: 349.2, t: 0.32, dur: 0.32 },  // F4
      { f: 293.7, t: 0.64, dur: 0.42 },  // D4
    ];
    notes.forEach((n) => {
      const t0 = now + n.t;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = n.f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
      g.gain.setValueAtTime(0.16, t0 + n.dur - 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
      // Lowpass for a softer brass tone (sawtooth alone is too harsh)
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 1400;
      osc.connect(lp); lp.connect(g); g.connect(out);
      osc.start(t0); osc.stop(t0 + n.dur + 0.05);
    });
    // Final "wah-wah" pitch bend on the last note's tail — drop another
    // tritone down for the classic comedic defeat
    const bendStart = now + 1.06;
    const bend = ctx.createOscillator();
    const bg = ctx.createGain();
    bend.type = "sawtooth";
    bend.frequency.setValueAtTime(293.7, bendStart);
    bend.frequency.exponentialRampToValueAtTime(180, bendStart + 0.45);
    bg.gain.setValueAtTime(0.0001, bendStart);
    bg.gain.exponentialRampToValueAtTime(0.18, bendStart + 0.04);
    bg.gain.exponentialRampToValueAtTime(0.0001, bendStart + 0.55);
    const lp2 = ctx.createBiquadFilter();
    lp2.type = "lowpass"; lp2.frequency.value = 1100;
    bend.connect(lp2); lp2.connect(bg); bg.connect(out);
    bend.start(bendStart); bend.stop(bendStart + 0.6);
    // Low sub-rumble that fades in then crashes out
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(70, now);
    sub.frequency.exponentialRampToValueAtTime(36, now + 1.5);
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(0.22, now + 0.4);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    sub.connect(sg); sg.connect(out);
    sub.start(now); sub.stop(now + 1.65);
  }


  /* Quiet thunder — picks one of three variants at random for variety:
       0) "rumble"      — long low brown-noise roll (~1.6s)
       1) "boom"        — short heavy single hit, lots of low + a sharp crack
       2) "rolling"     — multi-burst rumble with two crackles
     All variants peak at the same crackle time (~0.78s) so the caller's
     visual flash sync stays consistent. */
  thunder(variant = null) {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.sfxGain;
    const v = variant != null ? variant : Math.floor(Math.random() * 3);
    // Per-variant tuning. All louder than the prior single-version build.
    const tune = (
      v === 1 ? { dur: 1.2,  peakGain: 0.42, lpStart: 220, lpEnd: 140, crackleGain: 0.32, crackleQ: 0.6, crackleFreq: 1100, doubleCrackle: false } :
      v === 2 ? { dur: 1.9,  peakGain: 0.34, lpStart: 170, lpEnd: 100, crackleGain: 0.22, crackleQ: 0.7, crackleFreq:  800, doubleCrackle: true  } :
                { dur: 1.6,  peakGain: 0.36, lpStart: 180, lpEnd: 110, crackleGain: 0.24, crackleQ: 0.8, crackleFreq:  900, doubleCrackle: false }
    );
    // 1) Brown-noise rumble body
    const sampleCount = Math.floor(ctx.sampleRate * tune.dur);
    const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < sampleCount; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(tune.lpStart, now);
    lp.frequency.linearRampToValueAtTime(tune.lpEnd, now + tune.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(tune.peakGain, now + 0.30);
    g.gain.linearRampToValueAtTime(tune.peakGain * 0.85, now + 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, now + tune.dur);
    src.connect(lp); lp.connect(g); g.connect(out);
    src.start(now);
    src.stop(now + tune.dur);
    // 2) Crackle(s) — one always at the peak (0.78s), optionally a second
    // a beat later for "rolling thunder" effect.
    const fireCrackle = (offset, gain) => {
      const startAt = now + offset;
      const c = ctx.createBufferSource();
      const cbuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.22), ctx.sampleRate);
      const cdata = cbuf.getChannelData(0);
      for (let i = 0; i < cdata.length; i++) cdata[i] = (Math.random() * 2 - 1) * 0.9;
      c.buffer = cbuf;
      const cbp = ctx.createBiquadFilter();
      cbp.type = "bandpass";
      cbp.frequency.value = tune.crackleFreq;
      cbp.Q.value = tune.crackleQ;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, startAt);
      cg.gain.linearRampToValueAtTime(gain, startAt + 0.02);
      cg.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
      c.connect(cbp); cbp.connect(cg); cg.connect(out);
      c.start(startAt);
      c.stop(startAt + 0.24);
    };
    fireCrackle(0.78, tune.crackleGain);
    if (tune.doubleCrackle) fireCrackle(1.10, tune.crackleGain * 0.7);
  }

  /* Looping rain-on-wet-streets ambient. Idempotent: calling start when
     already running is a no-op; stop fades out cleanly. Volume is very
     low so it sits under the gun + UI sounds and acts as atmosphere. */
  rainAmbient(on) {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    if (on) {
      if (this._rainAmbient && !this._rainAmbient.ended) return; // already running
      // Looping white-noise buffer (2s) filtered through a high-shelf so
      // it reads as soft hissing rather than full-spectrum static.
      const dur = 2.0;
      const sampleCount = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // High-pass to remove low rumble (we already have thunder for that)
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      // Band-pass-style notch so it sounds like wet asphalt hissing
      const bp = ctx.createBiquadFilter();
      bp.type = "peaking";
      bp.frequency.value = 4500;
      bp.Q.value = 0.7;
      bp.gain.value = 4;
      // Volume — quiet
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.025, ctx.currentTime + 1.2);
      src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.sfxGain);
      src.start();
      this._rainAmbient = src;
      this._rainAmbientGain = g;
    } else if (this._rainAmbient) {
      try {
        const g = this._rainAmbientGain;
        if (g) {
          g.gain.cancelScheduledValues(ctx.currentTime);
          g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
        }
        const src = this._rainAmbient;
        setTimeout(() => { try { src.stop(); } catch {} }, 900);
      } catch {}
      this._rainAmbient = null;
      this._rainAmbientGain = null;
    }
  }

  _hashId(id) {
    if (!id) return 0;
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h;
  }

  // distance: 0 (right next to you) to ~100 (across map)
  _distVolume(distance) {
    if (!distance || distance <= 1) return 1.0;
    // Smooth falloff: full at 0m, half at 25m, ~0 at 80m
    return Math.max(0, 1 - distance / 80);
  }

  /* -------- Weapon sounds: AK = noisy bang+thump, Laser = futuristic zap -------- */
  gunshot(shooterId = null, distance = 0, weapon = "ak47", pos = null) {
    if (!this._ensure()) return;
    const vol = this._distVolume(distance);
    if (vol <= 0.02) return;
    // 3D-audio path: route to a PannerNode at the shooter's world
    // position so the shot reads as coming from a specific direction.
    // Falls back to flat sfxGain when 3D audio is off or position is
    // missing (e.g. local shots, where pan doesn't matter anyway).
    const out = (pos && this._audio3D)
      ? this._spatialOut(pos.x, pos.y ?? 1.6, pos.z)
      : this.sfxGain;
    if (weapon === "laser") {
      this._laserShot(vol, out);
    } else if (weapon === "sniper") {
      this._sniperShot(shooterId, vol, out);
    } else if (weapon === "melee" || weapon === "katana") {
      // Melee ("KATANA" legacy id) — short punchy thud rather than a
      // sword swing. Plays for local swings AND remote ones so nearby
      // players hear the smack even without a hit registered.
      this._punchSwing(shooterId, vol, out);
    } else {
      this._akShot(shooterId, vol, out);
    }
  }

  /* Punch/thud — used for the MELEE weapon (renamed from "Katana").
   * A quick low whoosh plus a mid-band thump — reads as "fist meets
   * chest" without needing a sample. Kept short (0.12s) so a spam-
   * click stacks into a rapid-fire punch pattern instead of muddling. */
  _punchSwing(shooterId, vol, out) {
    const ctx = this.ctx;
    out = out || this.sfxGain;
    const t0 = ctx.currentTime;
    const dur = 0.12;
    // 1) Low body — sine 140 Hz → 60 Hz (chest thump).
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(140, t0);
    body.frequency.exponentialRampToValueAtTime(60, t0 + dur);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0, t0);
    bg.gain.linearRampToValueAtTime(0.85 * vol, t0 + 0.006);
    bg.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    body.connect(bg); bg.connect(out);
    body.start(t0); body.stop(t0 + dur + 0.02);
    // 2) Mid-band noise burst — the flesh-slap crack.
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = (Math.random() * 2 - 1);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 700;
    nf.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0, t0);
    ng.gain.linearRampToValueAtTime(0.5 * vol, t0 + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.8);
    noise.connect(nf); nf.connect(ng); ng.connect(out);
    noise.start(t0); noise.stop(t0 + dur + 0.02);
  }

  _akShot(shooterId, vol, out) {
    const ctx = this.ctx;
    out = out || this.sfxGain;
    // Per-shooter pitch ratio 0.78 - 1.28 from hash; local shooter gets stable 1.0
    let pitch = 1.0;
    if (shooterId) {
      const h = this._hashId(shooterId);
      pitch = 0.78 + (h % 50) / 100;
    }
    // Per-shooter timbre: 4 different filter cutoffs to mimic different "guns"
    const cutoffOptions = [500, 900, 1400, 2100];
    const cutoff = shooterId
      ? cutoffOptions[this._hashId(shooterId) % cutoffOptions.length]
      : 1500;

    const dur = 0.2 / pitch;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cutoff + 600, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.3), ctx.currentTime + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 80;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1.0 * vol, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
    src.start();

    // body thump
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const baseThump = 160 * pitch;
    osc.frequency.setValueAtTime(baseThump, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40 * pitch, ctx.currentTime + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7 * vol, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(og); og.connect(out);
    osc.start(); osc.stop(ctx.currentTime + 0.16);
  }

  /* Sniper: cinematic bolt-action boom.
     A single, LOUD report with an immediate high-freq CRACK (supersonic
     snap), a deep low-end THUMP (the powder concussion), and a long
     tail echo that rolls off over ~0.8s. Roughly 2.5x louder than an
     AK shot to sell the "one-shot kill cannon" feel — deliberately
     pushed into soft-clip territory so the transient reads as "big". */
  _sniperShot(shooterId, vol, out) {
    const ctx = this.ctx;
    out = out || this.sfxGain;
    const t0 = ctx.currentTime;
    // Snipers all sound similar to each other — the huge report doesn't
    // benefit from as much per-shooter timbre variance as the AK, but a
    // tiny pitch jitter still helps back-to-back shots not sound looped.
    let pitch = 1.0;
    if (shooterId) {
      const h = this._hashId(shooterId);
      pitch = 0.94 + (h % 12) / 100; // 0.94..1.05
    }

    // 1) Powder concussion — deep 90 Hz → 30 Hz sine drop, LOUD.
    // Uses a sine so it hits the subwoofer without a lot of harmonics.
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(90 * pitch, t0);
    thump.frequency.exponentialRampToValueAtTime(30 * pitch, t0 + 0.24);
    const thumpG = ctx.createGain();
    thumpG.gain.setValueAtTime(4.2 * vol, t0);
    thumpG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);
    thump.connect(thumpG); thumpG.connect(out);
    thump.start(t0); thump.stop(t0 + 0.38);

    // 1b) Extra sub layer — a second, even-lower sine an octave down for
    // real chest-thump. Pushes the report into "cannon" territory.
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(55 * pitch, t0);
    sub.frequency.exponentialRampToValueAtTime(22 * pitch, t0 + 0.28);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(3.2 * vol, t0);
    subG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36);
    sub.connect(subG); subG.connect(out);
    sub.start(t0); sub.stop(t0 + 0.40);

    // 2) Supersonic CRACK — short white-noise burst pushed through a
    // sharp bandpass around 2.2 kHz. This is the "you just fired a
    // magnum" transient. Longer + hotter than the AK's crackle.
    const crackDur = 0.16;
    const crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * crackDur), ctx.sampleRate);
    const cData = crackBuf.getChannelData(0);
    for (let i = 0; i < cData.length; i++) {
      const t = i / cData.length;
      cData[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.6);
    }
    const crackSrc = ctx.createBufferSource();
    crackSrc.buffer = crackBuf;
    crackSrc.playbackRate.value = pitch;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2200, t0);
    bp.frequency.exponentialRampToValueAtTime(900, t0 + crackDur);
    bp.Q.value = 1.2;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300;
    const crackG = ctx.createGain();
    crackG.gain.setValueAtTime(0, t0);
    crackG.gain.linearRampToValueAtTime(3.8 * vol, t0 + 0.004);
    crackG.gain.exponentialRampToValueAtTime(0.001, t0 + crackDur);
    crackSrc.connect(hp); hp.connect(bp); bp.connect(crackG); crackG.connect(out);
    crackSrc.start(t0);

    // 3) Mid-body noise — broader lowpassed noise (the "boom" body).
    const bodyDur = 0.42;
    const bodyBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * bodyDur), ctx.sampleRate);
    const bData = bodyBuf.getChannelData(0);
    for (let i = 0; i < bData.length; i++) {
      const t = i / bData.length;
      bData[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.0);
    }
    const bodySrc = ctx.createBufferSource();
    bodySrc.buffer = bodyBuf;
    bodySrc.playbackRate.value = pitch;
    const bodyLP = ctx.createBiquadFilter();
    bodyLP.type = "lowpass";
    bodyLP.frequency.setValueAtTime(1400, t0);
    bodyLP.frequency.exponentialRampToValueAtTime(180, t0 + bodyDur);
    const bodyG = ctx.createGain();
    bodyG.gain.setValueAtTime(0, t0);
    bodyG.gain.linearRampToValueAtTime(3.0 * vol, t0 + 0.008);
    bodyG.gain.exponentialRampToValueAtTime(0.001, t0 + bodyDur);
    bodySrc.connect(bodyLP); bodyLP.connect(bodyG); bodyG.connect(out);
    bodySrc.start(t0);

    // 4) Echo tail — two delayed, quieter crackle repeats to sell an
    // outdoor arena. Not a real reverb (expensive) — just two damped
    // taps that fade out over ~0.8s.
    const tailDelays = [0.18, 0.42];
    for (let i = 0; i < tailDelays.length; i++) {
      const delay = tailDelays[i];
      const tailDur = 0.26;
      const tailBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * tailDur), ctx.sampleRate);
      const tData = tailBuf.getChannelData(0);
      for (let j = 0; j < tData.length; j++) {
        const t = j / tData.length;
        tData[j] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.0);
      }
      const tSrc = ctx.createBufferSource();
      tSrc.buffer = tailBuf;
      tSrc.playbackRate.value = pitch;
      const tLP = ctx.createBiquadFilter();
      tLP.type = "lowpass";
      tLP.frequency.setValueAtTime(1600, t0 + delay);
      tLP.frequency.exponentialRampToValueAtTime(220, t0 + delay + tailDur);
      const tG = ctx.createGain();
      const echoVol = (i === 0 ? 1.5 : 0.85) * vol;
      tG.gain.setValueAtTime(0, t0 + delay);
      tG.gain.linearRampToValueAtTime(echoVol, t0 + delay + 0.008);
      tG.gain.exponentialRampToValueAtTime(0.001, t0 + delay + tailDur);
      tSrc.connect(tLP); tLP.connect(tG); tG.connect(out);
      tSrc.start(t0 + delay);
    }
  }

  /* Laser: short sci-fi "pew" — descending square sweep + bright ring + zap noise. */
  _laserShot(vol, out) {
    const ctx = this.ctx;
    out = out || this.sfxGain;
    const t0 = ctx.currentTime;
    const dur = 0.18;

    // 1) Pitched sweep — square wave 2200 Hz → 380 Hz
    const sweep = ctx.createOscillator();
    sweep.type = "square";
    sweep.frequency.setValueAtTime(2200, t0);
    sweep.frequency.exponentialRampToValueAtTime(380, t0 + dur);
    const sweepFilt = ctx.createBiquadFilter();
    sweepFilt.type = "lowpass";
    sweepFilt.frequency.setValueAtTime(4000, t0);
    sweepFilt.frequency.exponentialRampToValueAtTime(900, t0 + dur);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t0);
    sg.gain.linearRampToValueAtTime(0.55 * vol, t0 + 0.005);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    sweep.connect(sweepFilt); sweepFilt.connect(sg); sg.connect(out);
    sweep.start(t0); sweep.stop(t0 + dur + 0.02);

    // 2) Bright ringing partial — sine 1760 Hz with slight vibrato
    const ring = ctx.createOscillator();
    ring.type = "sine";
    ring.frequency.value = 1760;
    const vib = ctx.createOscillator();
    vib.frequency.value = 22;
    const vibG = ctx.createGain();
    vibG.gain.value = 80;
    vib.connect(vibG); vibG.connect(ring.frequency);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0, t0);
    rg.gain.linearRampToValueAtTime(0.35 * vol, t0 + 0.005);
    rg.gain.exponentialRampToValueAtTime(0.001, t0 + dur + 0.05);
    ring.connect(rg); rg.connect(out);
    ring.start(t0); ring.stop(t0 + dur + 0.07);
    vib.start(t0); vib.stop(t0 + dur + 0.07);

    // 3) High-pass noise zap for crackle
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25 * vol, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    src.connect(hp); hp.connect(ng); ng.connect(out);
    src.start(t0);
  }

  /* -------- Reload SFX (AK-style mag drop + slap) --------
     Three quick beats: mag click-out (high tick), drop (low thud), slap-in
     (sharper thud). Cheap envelope-driven white-noise + sine combo. */
  reload(weapon = "ak47") {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const tick = (t, freq, dur, vol, type = "triangle") => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(this.sfxGain);
      osc.start(t); osc.stop(t + dur + 0.02);
    };
    const thud = (t, dur, vol, hp = 80, lp = 700) => {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.6);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hpF = ctx.createBiquadFilter();
      hpF.type = "highpass"; hpF.frequency.value = hp;
      const lpF = ctx.createBiquadFilter();
      lpF.type = "lowpass"; lpF.frequency.value = lp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hpF); hpF.connect(lpF); lpF.connect(g); g.connect(this.sfxGain);
      src.start(t);
    };

    if (weapon === "laser") {
      // Sci-fi "energy cell swap" — two ascending blips + soft whoosh
      tick(t0,        660, 0.07, 0.28, "square");
      tick(t0 + 0.12, 990, 0.09, 0.30, "square");
      thud(t0 + 0.22, 0.18, 0.35, 800, 4000);
      tick(t0 + 0.45, 1320, 0.10, 0.32, "sine");
    } else {
      // AK-style: mag click-out → drop → slap-in
      tick(t0,        1100, 0.05, 0.32);       // metallic click-out
      thud(t0 + 0.08, 0.12, 0.55, 100, 900);   // mag hits palm/floor
      thud(t0 + 0.55, 0.10, 0.65, 120, 1200);  // fresh mag slap-in
      tick(t0 + 0.65, 600, 0.08, 0.45);        // bolt thunk
      tick(t0 + 0.85, 1800, 0.04, 0.25);       // charging-handle click
    }
  }

  /* -------- Continuous laser beam (looping hum) --------
     Two detuned saw oscillators + a high sine "whine" through a slow LFO
     band-pass for a sci-fi sustained beam tone. _beam holds the active node
     graph so laserBeamStop() can fade it out cleanly. */
  laserBeamStart() {
    if (!this._ensure()) return;
    if (this._beam) return; // already running
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const beam = {};
    // Low body — detuned saws
    beam.saw1 = ctx.createOscillator();
    beam.saw1.type = "sawtooth";
    beam.saw1.frequency.value = 220;
    beam.saw2 = ctx.createOscillator();
    beam.saw2.type = "sawtooth";
    beam.saw2.frequency.value = 224; // slight detune for chorus
    // Band-pass filter with slow LFO sweep
    beam.bp = ctx.createBiquadFilter();
    beam.bp.type = "bandpass";
    beam.bp.frequency.value = 900;
    beam.bp.Q.value = 6;
    beam.lfo = ctx.createOscillator();
    beam.lfo.frequency.value = 5.5; // 5.5 Hz wobble
    beam.lfoG = ctx.createGain();
    beam.lfoG.gain.value = 280;
    beam.lfo.connect(beam.lfoG);
    beam.lfoG.connect(beam.bp.frequency);
    // High whine sine
    beam.whine = ctx.createOscillator();
    beam.whine.type = "sine";
    beam.whine.frequency.value = 1760;
    beam.whineG = ctx.createGain();
    beam.whineG.gain.value = 0.06;
    // Master beam gain (fade in)
    beam.g = ctx.createGain();
    beam.g.gain.setValueAtTime(0.0001, t0);
    beam.g.gain.linearRampToValueAtTime(0.32, t0 + 0.06);
    beam.saw1.connect(beam.bp);
    beam.saw2.connect(beam.bp);
    beam.bp.connect(beam.g);
    beam.whine.connect(beam.whineG);
    beam.whineG.connect(beam.g);
    beam.g.connect(this.sfxGain);
    beam.saw1.start(t0);
    beam.saw2.start(t0);
    beam.lfo.start(t0);
    beam.whine.start(t0);
    this._beam = beam;
  }

  laserBeamStop() {
    if (!this._beam || !this.ctx) return;
    const beam = this._beam;
    this._beam = null;
    const t = this.ctx.currentTime;
    try {
      beam.g.gain.cancelScheduledValues(t);
      beam.g.gain.setValueAtTime(beam.g.gain.value, t);
      beam.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    } catch {}
    const stopAt = t + 0.12;
    try { beam.saw1.stop(stopAt); } catch {}
    try { beam.saw2.stop(stopAt); } catch {}
    try { beam.lfo.stop(stopAt); } catch {}
    try { beam.whine.stop(stopAt); } catch {}
  }

  /* -------- Overheat alarm (sizzle + descending alarm beep) --------
     Played once when the laser's heat hits 1.0 and the weapon locks. */
  laserOverheat() {
    if (!this._ensure()) return;
    // Always cut the beam first so the overheat is audible.
    this.laserBeamStop();
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    // 1) Sizzle: filtered white noise that drops in pitch
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.45), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 0.6);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(3200, t0);
    bp.frequency.exponentialRampToValueAtTime(420, t0 + 0.4);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
    src.connect(bp); bp.connect(ng); ng.connect(this.sfxGain);
    src.start(t0);

    // 2) Descending warning bleep — square wave 900 → 240 Hz
    const beep = ctx.createOscillator();
    beep.type = "square";
    beep.frequency.setValueAtTime(900, t0);
    beep.frequency.exponentialRampToValueAtTime(240, t0 + 0.35);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t0);
    bg.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    beep.connect(bg); bg.connect(this.sfxGain);
    beep.start(t0); beep.stop(t0 + 0.42);

    // 3) Sub thump for body
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(110, t0);
    sub.frequency.exponentialRampToValueAtTime(40, t0 + 0.2);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.4, t0);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    sub.connect(sg); sg.connect(this.sfxGain);
    sub.start(t0); sub.stop(t0 + 0.24);
  }

  /* -------- Hit marker (you hit someone) -------- */
  hitmark(headshot = false) {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Headshot = higher, brighter "ting-ting" (Overwatch headshot ding).
    const tones = headshot
      ? [{ f: 2400, t: now, dur: 0.05 }, { f: 3400, t: now + 0.03, dur: 0.10 }]
      : [{ f: 1800, t: now, dur: 0.06 }, { f: 2400, t: now + 0.04, dur: 0.08 }];
    tones.forEach(({ f, t, dur }) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(headshot ? 0.42 : 0.32, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(this.sfxGain);
      osc.start(t); osc.stop(t + dur + 0.02);
    });
  }

  hurt() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(260, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.22);
  }

  killSfx(headshot = false) {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = headshot ? [1175, 1568, 1976] : [880, 1175, 1568];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = now + i * 0.07;
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(headshot ? 0.3 : 0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g); g.connect(this.sfxGain);
      osc.start(t); osc.stop(t + 0.2);
    });
  }

  /* -------- Death -------- */
  deathSfx() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Downward "WAH-WAH" — saw that sweeps down from 320 → 80 Hz with a
    // soft low-pass + a thump at the tail. Heavy, somber.
    const sweep = ctx.createOscillator();
    sweep.type = "sawtooth";
    sweep.frequency.setValueAtTime(320, now);
    sweep.frequency.exponentialRampToValueAtTime(80, now + 0.55);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1800, now);
    lp.frequency.linearRampToValueAtTime(400, now + 0.55);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0, now);
    sg.gain.linearRampToValueAtTime(0.32, now + 0.04);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    sweep.connect(lp); lp.connect(sg); sg.connect(this.sfxGain);
    sweep.start(now); sweep.stop(now + 0.75);
    // Sub thump on the tail
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(60, now + 0.45);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.85);
    const subg = ctx.createGain();
    subg.gain.setValueAtTime(0.0, now + 0.45);
    subg.gain.linearRampToValueAtTime(0.4, now + 0.5);
    subg.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    sub.connect(subg); subg.connect(this.sfxGain);
    sub.start(now + 0.45); sub.stop(now + 0.95);
  }

  /* -------- Respawn -------- */
  respawnSfx() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Ascending power-up chord: comic-style "WHOOSH-ZING" — a swept saw +
    // two sparkle triangles. Punchy but short (~0.5s).
    const sweep = ctx.createOscillator();
    sweep.type = "sawtooth";
    sweep.frequency.setValueAtTime(120, now);
    sweep.frequency.exponentialRampToValueAtTime(900, now + 0.32);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(400, now);
    lp.frequency.linearRampToValueAtTime(2400, now + 0.32);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0, now);
    sg.gain.linearRampToValueAtTime(0.22, now + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    sweep.connect(lp); lp.connect(sg); sg.connect(this.sfxGain);
    sweep.start(now); sweep.stop(now + 0.5);
    // Two-note "ZING" chime — bright triangles, perfect-fifth interval.
    [880, 1320].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = now + 0.15 + i * 0.06;
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      osc.connect(g); g.connect(this.sfxGain);
      osc.start(t); osc.stop(t + 0.34);
    });
  }

  /* Soft "teleport hum" played when ANOTHER player respawns nearby. Falls
     off with distance using the same curve as gunshots (≈half at 25m,
     silent past 80m). A short detuned sine pad ramp-up + a quick high
     shimmer so the player can pick up the directional cue without it
     being distracting. */
  remoteRespawn(distance = 0, pos = null) {
    if (!this._ensure()) return;
    const vol = this._distVolume(distance);
    if (vol <= 0.04) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = (pos && this._audio3D) ? this._spatialOut(pos.x, pos.y ?? 1.6, pos.z) : this.sfxGain;
    // Low hum — two slightly-detuned sines for a "warpy" character.
    [110, 113.5].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * 0.85, now);
      osc.frequency.exponentialRampToValueAtTime(freq, now + 0.45);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, now);
      g.gain.linearRampToValueAtTime(0.13 * vol, now + 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
      osc.connect(g);
      g.connect(out);
      osc.start(now);
      osc.stop(now + 0.9);
    });
    // High shimmer — a single bright triangle that rises and fades, gives
    // the "materialise" finish.
    const shim = ctx.createOscillator();
    shim.type = "triangle";
    shim.frequency.setValueAtTime(1320, now + 0.18);
    shim.frequency.exponentialRampToValueAtTime(2200, now + 0.42);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0, now + 0.18);
    sg.gain.linearRampToValueAtTime(0.09 * vol, now + 0.23);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    shim.connect(sg);
    sg.connect(out);
    shim.start(now + 0.18);
    shim.stop(now + 0.6);
  }

  /* -------- Footstep -------- */
  /* Internal footstep builder. `volMul` scales both noise + sub thump
     (used to make local footsteps much quieter than remote ones so the
     player can actually HEAR enemy footsteps approaching). `out` lets
     the caller route the sound through a PannerNode for 3D positioning. */
  _footstepInner(sprint, volMul, out) {
    const ctx = this.ctx;
    out = out || this.sfxGain;
    // Short noise pulse with body thump
    const dur = sprint ? 0.07 : 0.09;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = sprint ? 1200 : 800;
    const g = ctx.createGain();
    g.gain.value = (sprint ? 0.18 : 0.12) * volMul;
    src.connect(lp); lp.connect(g); g.connect(out);
    src.start();

    // sub thump
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.07);
    const og = ctx.createGain();
    og.gain.setValueAtTime((sprint ? 0.22 : 0.14) * volMul, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    osc.connect(og); og.connect(out);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
  }

  /* Local-player footstep — much quieter than before so enemy footsteps
     are audible. Drop to 0.28x of previous volume (≈70% reduction). */
  footstep(sprint = false) {
    if (!this._ensure()) return;
    this._footstepInner(sprint, 0.28, this.sfxGain);
  }

  /* Remote-player footstep — full base volume + distance attenuation +
     3D pan when enabled. This is the cue that lets the player hear
     enemies approaching around corners. */
  remoteFootstep(sprint = false, distance = 0, pos = null) {
    if (!this._ensure()) return;
    const vol = this._distVolume(distance);
    if (vol <= 0.05) return;
    const out = (pos && this._audio3D) ? this._spatialOut(pos.x, pos.y ?? 0.1, pos.z) : this.sfxGain;
    // Slight boost (1.15x) on top of the base envelope so enemy footsteps
    // are decisively louder than the new quieter local steps.
    this._footstepInner(sprint, 1.15 * vol, out);
  }

  /* -------- Lobby music --------
     Melodic synthwave/arena-pop: smooth saw pads, arpeggiated bass,
     soulful lead with vibrato, soft drums. 110 bpm, 8-bar phrase. */
  _makeDistortionCurve(amount) {
    const k = amount;
    const samples = 1024;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * Math.PI) / (Math.PI + k * Math.abs(x));
      curve[i] = Math.tanh(curve[i] * 0.05);
    }
    return curve;
  }

  startLobbyMusic(variant = "default") {
    if (!this._ensure()) return;
    // Track id now encodes the variant so a season change can hot-swap
    // the loop without leaving the old timer running underneath.
    const trackId = `lobby:${variant}`;
    if (this.musicTrack === trackId && this.musicPlaying) return;
    // If a different track (or different lobby variant) was playing,
    // stop it so the new loop replaces it cleanly.
    if (this.musicPlaying) this.stopLobbyMusic();
    this._restoreMusicGain();
    this.musicPlaying = true;
    this.musicTrack = trackId;
    const isMeteor = variant === "meteor";
    // Snow variant — a chime/glockenspiel remix of the DEFAULT chord
    // progression (not meteor). Same Am-F-C-G-Am-F-G-E loop as Season 1
    // but with a bell shimmer layer on offbeats, a filtered "wind noise"
    // pad, and a slightly slower tempo for that winter-stillness feel.
    const isSnow = variant === "snow";
    const ctx = this.ctx;

    // -- Helpers --
    const semi = (n) => Math.pow(2, n / 12);
    // Base note A2 = 110 Hz. Chord roots & their pitch class:
    // Default (Season 1): Am - F - C - G - Am - F - G - E (8-bar minor-pop loop)
    // Meteor  (Season 2): Am - Em - F - E (4-bar Phrygian-flavoured minor
    //   loop with a half-step pull from F→E). The drop from F major to
    //   E major every 4 bars sells the "doomy meteor closing in" mood
    //   without ever resolving back to a major key.
    const A2 = 110.0;
    const ROOTS = (isMeteor
      ? [0, -5, -4, -5, 0, -5, -4, -5]                  // Am, Em, F, E (looped)
      : [0, -4, 3, -2, 0, -4, -2, -5]                   // Am, F, C, G, Am, F, G, E
    ).map((s) => A2 * semi(s));
    // Chord qualities (triads). Meteor uses Em (minor 3rd) on bar 2 so
    // the texture stays minor instead of brightening to F major early.
    const CHORDS = isMeteor
      ? [
          [0, 3, 7],   // Am
          [0, 3, 7],   // Em (relative semis from its root)
          [0, 4, 7],   // F major (passing)
          [0, 4, 7],   // E major (Phrygian dominant)
          [0, 3, 7],   // Am
          [0, 3, 7],   // Em
          [0, 4, 7],   // F
          [0, 4, 7],   // E
        ]
      : [
          [0, 3, 7],   // Am
          [0, 4, 7],   // F major
          [0, 4, 7],   // C major
          [0, 4, 7],   // G major
          [0, 3, 7],   // Am
          [0, 4, 7],   // F major
          [0, 4, 7],   // G major
          [0, 4, 7],   // E major
        ];
    // 16-step melody (semitone offset from root, or null for rest).
    // RIFF_A used to play on bar 7 (the loop's last bar) which made the
    // song feel like it ended each cycle. Removed for a continuous loop;
    // RIFF_B plays mid-loop instead.
    // eslint-disable-next-line no-unused-vars
    const RIFF_A = [12, null, 10, 12, null, 7, null, 10, null, 7, 5, null, 7, null, 12, null];
    const RIFF_B = [10, null, 7,  10, null, 5, null, 7,  null, 3, 5, 7,  null, null, 12, null];

    const BPM = isMeteor ? 78 : (isSnow ? 76 : 84);
    const beat = 60 / BPM;
    const sixteenth = beat / 4;

    // -- Buses --
    // Soft pad (low-pass filtered saw). Meteor variant pushes the
    // cutoff slightly higher for a brighter "sky" wash but routes
    // straight through (no overdrive) so the pad stays clean — the
    // earlier waveshaper made the layer feel grungy / distorted per
    // user feedback. Detune is also brought in from ±12c → ±9c so the
    // chorus shimmer is wider than Season 1's ±6c but no longer harsh.
    const padFilt = ctx.createBiquadFilter();
    padFilt.type = "lowpass";
    padFilt.frequency.value = isMeteor ? 1100 : 950;
    padFilt.Q.value = isMeteor ? 0.55 : 0.4;
    const padBus = ctx.createGain();
    padBus.gain.value = isMeteor ? 0.28 : 0.26;
    padFilt.connect(padBus);
    padBus.connect(this.musicGain);

    // Lead bus with gentle overdrive + slap-back delay
    const leadDrive = ctx.createWaveShaper();
    leadDrive.curve = this._makeDistortionCurve(8);
    leadDrive.oversample = "4x";
    const leadFilt = ctx.createBiquadFilter();
    leadFilt.type = "lowpass";
    leadFilt.frequency.value = 2200;
    const leadBus = ctx.createGain();
    leadBus.gain.value = 0.18;
    leadDrive.connect(leadFilt); leadFilt.connect(leadBus);
    leadBus.connect(this.musicGain);

    // Clean lead bus — meteor lead riff feeds this instead of the heavy
    // `leadDrive`/`leadFilt` Season-1 chain. Just a low-passed gain stage
    // so the sparse melody reads as a wistful sine-ish saw, not a
    // crunchy fuzz-lead. The delay tap below is shared between both
    // chains (still adds depth without adding grit).
    const leadCleanFilt = ctx.createBiquadFilter();
    leadCleanFilt.type = "lowpass";
    leadCleanFilt.frequency.value = 1600;
    leadCleanFilt.Q.value = 0.3;
    const leadCleanBus = ctx.createGain();
    leadCleanBus.gain.value = 0.14;
    leadCleanFilt.connect(leadCleanBus);
    leadCleanBus.connect(this.musicGain);

    const delay = ctx.createDelay(0.6);
    delay.delayTime.value = sixteenth * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const delayMix = ctx.createGain();
    delayMix.gain.value = 0.26;
    delay.connect(fb); fb.connect(delay);
    delay.connect(delayMix); delayMix.connect(this.musicGain);
    leadBus.connect(delay);
    leadCleanBus.connect(delay);

    // Bass bus
    const bassFilt = ctx.createBiquadFilter();
    bassFilt.type = "lowpass";
    bassFilt.frequency.value = 450;
    const bassBus = ctx.createGain();
    bassBus.gain.value = 0.28;
    bassFilt.connect(bassBus);
    bassBus.connect(this.musicGain);

    // -- Voices --
    // Pad: triad held for the whole bar with soft attack
    const playPad = (root, triad, t, dur) => {
      triad.forEach((semiOffset, i) => {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = "sawtooth";
        osc2.type = "sawtooth";
        const f = root * semi(semiOffset);
        osc1.frequency.value = f;
        osc2.frequency.value = f;
        osc1.detune.value = isMeteor ? -9 : -6;
        osc2.detune.value = isMeteor ? +9 : +6;
        const g = ctx.createGain();
        const peak = 0.28 / (1 + i * 0.2);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.25);
        g.gain.setValueAtTime(peak, t + dur - 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc1.connect(g); osc2.connect(g);
        g.connect(padFilt);
        osc1.start(t); osc2.start(t);
        osc1.stop(t + dur + 0.05);
        osc2.stop(t + dur + 0.05);
      });
    };

    // Bass: gentle root on every beat (calmer than 8ths)
    const playBassArp = (root, t) => {
      const seq = [1, 1, 1, 1];
      seq.forEach((mult, i) => {
        const tt = t + i * beat;
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = root * 0.5 * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0, tt);
        g.gain.linearRampToValueAtTime(0.55, tt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, tt + beat * 0.85);
        // sub layer
        const sub = ctx.createOscillator();
        sub.type = "sine";
        sub.frequency.value = root * 0.5;
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.35, tt);
        sg.gain.exponentialRampToValueAtTime(0.001, tt + beat * 0.9);
        osc.connect(g); g.connect(bassFilt);
        sub.connect(sg); sg.connect(bassFilt);
        osc.start(tt); osc.stop(tt + beat * 0.95);
        sub.start(tt); sub.stop(tt + beat);
      });
    };

    // Lead: vibrato saw lead in higher register
    const playLead = (root, semiOffset, t, dur) => {
      const f = root * 2 * semi(semiOffset); // up an octave
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 3.5;
      vib.connect(vibGain); vibGain.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.42, t + 0.015);
      g.gain.setTargetAtTime(0.26, t + 0.1, 0.12);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(leadDrive);
      osc.start(t); osc.stop(t + dur + 0.05);
      vib.start(t); vib.stop(t + dur + 0.05);
    };

    // Drums (softer / lobby-appropriate)
    const kick = (t, accent = false) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(accent ? 0.45 : 0.35, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + 0.25);
    };

    const snare = (t) => {
      // Soft rim/tick instead of full snare for ambient feel
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 3500;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      src.connect(bp); bp.connect(g); g.connect(this.musicGain);
      src.start(t);
    };

    const hihat = (t, open = false, accent = false) => {
      const dur = open ? 0.16 : 0.025;
      const buf = ctx.createBuffer(1, Math.max(2, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (open ? Math.pow(1 - i / d.length, 1.5) : 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 9000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(open ? 0.06 : (accent ? 0.05 : 0.03), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hp); hp.connect(g); g.connect(this.musicGain);
      src.start(t);
    };

    const shimmer = (t) => {
      // Soft cymbal swell at phrase start
      const dur = 1.2;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const env = Math.sin((i / d.length) * Math.PI);
        d[i] = (Math.random() * 2 - 1) * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hp); hp.connect(g); g.connect(this.musicGain);
      src.start(t);
    };

    // -- Meteor-only voices --
    // Sub-drone: a continuous low sine that holds across the whole bar
    // and ties the loop together with a "burning atmosphere" rumble.
    // Pitch follows the bar root one octave below the bass.
    const playMeteorDrone = (root, t, dur) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = root * 0.25; // 2 octaves below bass
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.6);
      g.gain.setValueAtTime(0.18, t + dur - 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + dur + 0.1);
    };

    // Impact gong: low-pitched percussive boom at the start of every
    // 4-bar phrase. Suggests a distant meteor strike echoing in.
    const playMeteorImpact = (t) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(80, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 1.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.50, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + 1.5);
      // Soft noisy "ember" tail behind the boom (highpassed white noise).
      // Volume kept low so it reads as air-shimmer, not crackle/static.
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.9), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.4);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1400;
      const gN = ctx.createGain();
      gN.gain.setValueAtTime(0.06, t);
      gN.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      src.connect(hp); hp.connect(gN); gN.connect(this.musicGain);
      src.start(t);
    };

    // Sparse minor-pentatonic lead — only on bar 0 of each 4-bar phrase.
    // 8 sixteenth-note positions (with rests) climbing then falling, so
    // the loop has a singing-meteor-streak melodic moment without ever
    // sounding triumphant. Uses a triangle wave through the clean lead
    // bus so the melody sits gentle against the pad instead of carrying
    // the Season-1 lead's overdrive grit.
    const METEOR_LEAD_RIFF = [0, null, 3, null, 7, null, 10, 7, null, 3, null, 0, null, null, null, null];
    const playMeteorLead = (root, t) => {
      METEOR_LEAD_RIFF.forEach((semiOffset, i) => {
        if (semiOffset === null) return;
        const f = root * 2 * semi(semiOffset);
        const noteT = t + i * sixteenth;
        const dur = sixteenth * 2;
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        const vib = ctx.createOscillator();
        vib.frequency.value = 5;
        const vibGain = ctx.createGain();
        vibGain.gain.value = 2.5;
        vib.connect(vibGain); vibGain.connect(osc.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0, noteT);
        g.gain.linearRampToValueAtTime(0.32, noteT + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, noteT + dur);
        osc.connect(g); g.connect(leadCleanFilt);
        osc.start(noteT); osc.stop(noteT + dur + 0.05);
        vib.start(noteT); vib.stop(noteT + dur + 0.05);
      });
    };

    // ─────────────────────────────────────────────────────────────
    // Snow variant helpers — a glockenspiel/bell shimmer + soft wind
    // noise layer over the DEFAULT chord progression. Meant to read as
    // "same song, wintered". Only referenced when `isSnow === true`.
    // ─────────────────────────────────────────────────────────────
    // High-pass filtered noise buffer, cached across bars.
    let snowNoiseBuf = null;
    const getSnowNoise = () => {
      if (snowNoiseBuf) return snowNoiseBuf;
      const dur = 4.0;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
      snowNoiseBuf = buf;
      return buf;
    };
    // Wind gust — plays once per bar, layered noise through a bandpass
    // filter that sweeps up then down. Sits low in the mix (0.08 gain)
    // so it's felt more than heard.
    const playSnowWind = (t, dur) => {
      const src = ctx.createBufferSource();
      src.buffer = getSnowNoise();
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(600, t);
      bp.frequency.linearRampToValueAtTime(1400, t + dur * 0.55);
      bp.frequency.linearRampToValueAtTime(400, t + dur);
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.4);
      g.gain.linearRampToValueAtTime(0.05, t + dur - 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      src.connect(bp); bp.connect(g); g.connect(this.musicGain);
      src.start(t); src.stop(t + dur + 0.1);
    };
    // Bell — bright triangle+sine chime with a long exponential decay.
    // Uses the triad note offsets so bells arpeggiate the current chord.
    const playSnowBell = (freq, t, level = 0.22) => {
      const dur = 1.6;
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = "triangle"; o1.frequency.value = freq;
      // Slight inharmonic partial for that glassy bell timbre.
      o2.type = "sine"; o2.frequency.value = freq * 2.005;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0002, t + dur);
      const g2 = ctx.createGain();
      g2.gain.value = 0.28;
      o1.connect(g); o2.connect(g2); g2.connect(g);
      // Route through a mild low-pass so the bells sit above the pad
      // without becoming ice-picky.
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 300;
      g.connect(hp); hp.connect(this.musicGain);
      o1.start(t); o2.start(t);
      o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    };
    // Bar-level glockenspiel pattern: 4 arpeggiated triad notes on
    // beats 1, 2.5, 3, 4.5 (a subtle syncopation) climbing +2 octaves
    // above the chord root. Bar-4 (phrase reset) adds a 5th shimmer
    // note high above for that Christmas-morning tag.
    const playSnowBells = (root, triad, t, isPhraseReset) => {
      // Triad → up 2 octaves relative to root's fundamental.
      const octUp = 4;   // 2 octaves = 2 doublings above the pad root
      const beats = [
        { off: 0.0 * beat,  idx: 0 },
        { off: 1.5 * beat,  idx: 1 },
        { off: 2.0 * beat,  idx: 2 },
        { off: 3.5 * beat,  idx: 0 },
      ];
      beats.forEach(({ off, idx }) => {
        const s = triad[idx % triad.length] ?? 0;
        const f = root * octUp * semi(s);
        playSnowBell(f, t + off, 0.20);
      });
      // Phrase-reset sparkle — a high 12th (perfect 5th above the top
      // triad note) on the "and" of beat 4 to punctuate the loop.
      if (isPhraseReset) {
        const topSemi = (triad[triad.length - 1] ?? 7) + 12;
        playSnowBell(root * octUp * semi(topSemi), t + 3.75 * beat, 0.18);
      }
    };
    // Sleigh-bell-ish tick — very short, closed-hihat-style shimmer on
    // the offbeat 16ths. Uses filtered white noise + a super-quick env.
    const playSnowTick = (t) => {
      const src = ctx.createBufferSource();
      src.buffer = getSnowNoise();
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 4500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      src.connect(hp); hp.connect(g); g.connect(this.musicGain);
      src.start(t); src.stop(t + 0.12);
    };

    const scheduleBar = (startAt, barIndex) => {
      // Loop length: 4 bars. Default = Am-F-C-G (Season 1). Meteor =
      // Am-Em-F-E (Season 2 dark Phrygian-flavoured variant). Snow
      // uses the DEFAULT progression with bells + wind layered on top.
      const phraseBar = barIndex % 4;
      const root = ROOTS[phraseBar];
      const triad = CHORDS[phraseBar];

      // Pad — sustained throughout the bar
      playPad(root, triad, startAt, beat * 4);

      // Bass arp — 8 eighth notes
      playBassArp(root, startAt);

      // Drums — gentle / ambient: soft kick on 1+3, soft rim/tick on 2+4, light closed hat 8ths
      kick(startAt);
      kick(startAt + beat * 2);
      snare(startAt + beat * 1);
      snare(startAt + beat * 3);
      for (let i = 0; i < 8; i++) {
        hihat(startAt + i * (beat / 2), false, false);
      }

      if (isMeteor) {
        // Meteor variant overlays — sub-drone every bar, impact gong on
        // bar 0 of each 4-bar phrase, sparse minor-pentatonic lead also
        // on bar 0 so the loop has one melodic moment per cycle. The
        // shimmer/cymbal swell on bar 0 reinforces the "phrase reset".
        playMeteorDrone(root, startAt, beat * 4);
        if (phraseBar === 0) {
          playMeteorImpact(startAt);
          shimmer(startAt);
          playMeteorLead(root, startAt + beat * 0.5);
        }
      } else if (isSnow) {
        // Snow overlays — bell arpeggio every bar (louder on the phrase
        // reset), sleigh-bell ticks on 16th offbeats, and a slow wind
        // gust every 2 bars. The wind gust length is one bar so it
        // ducks under the bells without overlapping itself.
        playSnowBells(root, triad, startAt, phraseBar === 0);
        // Offbeat 16ths (positions 2, 6, 10, 14 in a 16-step bar) —
        // sparse enough to feel like distant sleigh bells.
        [2, 6, 10, 14].forEach((step) => {
          playSnowTick(startAt + step * sixteenth);
        });
        if (barIndex % 2 === 0) {
          playSnowWind(startAt, beat * 4);
        }
      }

      // Lead (Season 1) — DISABLED. The distorted saw lead read as a
      // "horn" fanfare every loop; per user request the melody fragment
      // is removed entirely for the default variant. The meteor variant
      // re-introduces a darker, pentatonic riff above (gated by isMeteor).
    };

    const start = ctx.currentTime + 0.15;
    scheduleBar(start, 0);
    let nextBar = start + beat * 4;
    let barIdx = 1;
    this.musicTimer = setInterval(() => {
      if (!this.musicPlaying || !this.ctx) return;
      const cur = this.ctx.currentTime;
      while (nextBar < cur + 2.0) {
        scheduleBar(nextBar, barIdx);
        nextBar += beat * 4;
        barIdx += 1;
      }
    }, 250);
  }

  stopLobbyMusic() {
    this.musicPlaying = false;
    this.musicTrack = null;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    // Hard-cut the *current* music bus: every track schedules audio
    // 1-2s ahead through `this.musicGain` (captured at schedule time).
    // Just lowering the gain doesn't help — the old node still emits
    // any oscillators that were started. So we ramp the old node to 0
    // over 80ms, disconnect it from master after the tail, and create
    // a fresh `musicGain` so the next track starts on a clean bus.
    if (this.musicGain && this.ctx) {
      const old = this.musicGain;
      const now = this.ctx.currentTime;
      try {
        old.gain.cancelScheduledValues(now);
        old.gain.setValueAtTime(old.gain.value, now);
        old.gain.linearRampToValueAtTime(0, now + 0.08);
      } catch {}
      // Disconnect the old bus once everything ramped down so its
      // already-scheduled audio dies off cleanly (and the GC can reap
      // it).
      setTimeout(() => { try { old.disconnect(); } catch {} }, 200);
      // Create a brand-new music bus at the user's chosen volume so the
      // next track starts at full level — no overlap.
      const fresh = this.ctx.createGain();
      fresh.gain.value = this.musicMuted ? 0 : this._musicVol;
      fresh.connect(this.master);
      this.musicGain = fresh;
    }
  }

  /* No-op kept for back-compat — the new stopLobbyMusic already builds
     a fresh musicGain at the right volume, so start*Music doesn't need
     to do anything special here. */
  _restoreMusicGain() {}

  /* Generic alias — pages don't care which track was playing, they just
     want to stop whatever music the previous page started. */
  stopMusic() { this.stopLobbyMusic(); this.stopFogAmbient(); }

  /* -------- Fog-Lobby ambient (streamed MP3) --------
     Routes an HTMLAudioElement through the Web Audio graph so the master
     and music sliders / mute toggles control it exactly like the synth
     lobby loops. Idempotent: calling start when already running is a
     no-op; stop pauses + disconnects so the track cannot leak into the
     next route (e.g. a match). */
  startFogAmbient(url) {
    if (!this._ensure()) return;
    // Already streaming this exact url → do nothing.
    if (this._fogAmbient && this._fogAmbient.el && this._fogAmbient.url === url) {
      // If it was paused (e.g. we stopped then re-mounted quickly), resume.
      if (this._fogAmbient.el.paused) {
        this._fogAmbient.el.play().catch(() => {
          this._fogArmGesture();
        });
      }
      return;
    }
    // Different url or first start → tear down any prior element cleanly.
    if (this._fogAmbient) this.stopFogAmbient();

    const el = new Audio(url);
    el.loop = true;
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    // Element volume stays at 1 — the musicGain node handles user volume.
    el.volume = 1.0;

    let node;
    try {
      node = this.ctx.createMediaElementSource(el);
      node.connect(this.musicGain);
    } catch {
      // Some browsers throw if the same element was already piped once.
      // Fall back to setting element.volume directly against the mix.
      el.volume = this.musicMuted ? 0 : this._musicVol * (this.muted ? 0 : this._masterVol);
      node = null;
    }

    this._fogAmbient = { el, node, url, armed: false, kick: null };

    // Attempt immediate play; if the browser blocks (no user gesture yet)
    // arm one-shot listeners on the window that will retry on the first
    // click / key / touch.
    el.play().catch(() => this._fogArmGesture());
  }

  _fogArmGesture() {
    if (!this._fogAmbient || this._fogAmbient.armed) return;
    this._fogAmbient.armed = true;
    const kick = () => {
      if (!this._fogAmbient) return;
      this._fogAmbient.armed = false;
      this._fogAmbient.el.play().catch(() => {});
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      window.removeEventListener("touchstart", kick);
    };
    this._fogAmbient.kick = kick;
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
    window.addEventListener("touchstart", kick, { once: true });
  }

  stopFogAmbient() {
    if (!this._fogAmbient) return;
    const { el, node, armed, kick } = this._fogAmbient;
    this._fogAmbient = null;
    try { el.pause(); } catch {}
    try { el.currentTime = 0; } catch {}
    try { el.src = ""; el.load(); } catch {}
    try { if (node) node.disconnect(); } catch {}
    if (armed && kick) {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      window.removeEventListener("touchstart", kick);
    }
  }

  /* Leaderboard music — triumphant uptempo 8-bit synth-pop in C major.
     Brighter than the lobby loop: square-wave lead, faster bass, sparkle
     hi-hats. Designed to feel celebratory while reading the rankings.
     Implementation is self-contained; calling it while another track is
     playing crossfades by stopping the previous timer first. */
  startLeaderboardMusic() {
    if (!this._ensure()) return;
    if (this.musicTrack === "leaderboard" && this.musicPlaying) return;
    this.stopLobbyMusic();
    this._restoreMusicGain();
    this.musicPlaying = true;
    this.musicTrack = "leaderboard";
    const ctx = this.ctx;
    const semi = (n) => Math.pow(2, n / 12);
    const C3 = 130.81;
    // Triumphant I-V-vi-IV in C: C - G - Am - F (x2)
    const ROOTS = [0, 7, 9, 5, 0, 7, 9, 5].map((s) => C3 * semi(s));
    const QUAL  = [[0,4,7],[0,4,7],[0,3,7],[0,4,7],[0,4,7],[0,4,7],[0,3,7],[0,4,7]];
    const BPM = 110;
    const beat = 60 / BPM;
    const sixteenth = beat / 4;

    const leadBus = ctx.createGain(); leadBus.gain.value = 0.14;
    const leadFilt = ctx.createBiquadFilter();
    leadFilt.type = "lowpass"; leadFilt.frequency.value = 3200;
    leadFilt.connect(leadBus); leadBus.connect(this.musicGain);
    const bassBus = ctx.createGain(); bassBus.gain.value = 0.22;
    const bassFilt = ctx.createBiquadFilter();
    bassFilt.type = "lowpass"; bassFilt.frequency.value = 380;
    bassFilt.connect(bassBus); bassBus.connect(this.musicGain);
    const padBus = ctx.createGain(); padBus.gain.value = 0.10;
    padBus.connect(this.musicGain);

    const playSquare = (freq, t, dur, peak) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(leadFilt);
      osc.start(t); osc.stop(t + dur + 0.02);
    };
    const playBass = (root, t) => {
      // Galloping eighth-note bass on the root
      for (let i = 0; i < 8; i++) {
        const tt = t + i * (beat / 2);
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = root * 0.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.45, tt);
        g.gain.exponentialRampToValueAtTime(0.001, tt + (beat * 0.45));
        osc.connect(g); g.connect(bassFilt);
        osc.start(tt); osc.stop(tt + beat * 0.5);
      }
    };
    const playPad = (root, triad, t, dur) => {
      triad.forEach((s) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = root * semi(s);
        osc.detune.value = 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
        g.gain.setValueAtTime(0.12, t + dur - 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(padBus);
        osc.start(t); osc.stop(t + dur + 0.05);
      });
    };
    const hihat = (t, accent = false) => {
      const dur = 0.04;
      const buf = ctx.createBuffer(1, Math.max(2, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 9000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(accent ? 0.08 : 0.045, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hp); hp.connect(g); g.connect(this.musicGain);
      src.start(t);
    };
    const kick = (t) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + 0.2);
    };
    // Arpeggio pattern (semitone offsets within the triad — 0, 7, 12, 16)
    const ARP = [0, 7, 12, 16, 12, 7, 16, 7, 0, 7, 12, 16, 19, 16, 12, 7];

    const scheduleBar = (startAt, barIdx) => {
      const phraseBar = barIdx % 8;
      const root = ROOTS[phraseBar];
      const triad = QUAL[phraseBar];
      playPad(root, triad, startAt, beat * 4);
      playBass(root, startAt);
      // Arpeggiated square lead — sixteenth notes
      for (let i = 0; i < 16; i++) {
        const s = ARP[i];
        const f = root * 2 * semi(s);
        playSquare(f, startAt + i * sixteenth, sixteenth * 0.9, 0.22);
      }
      // Drums — 4-on-the-floor with hihat 8ths and snare on 2+4
      for (let i = 0; i < 4; i++) kick(startAt + i * beat);
      for (let i = 0; i < 8; i++) hihat(startAt + i * (beat / 2), i % 2 === 0);
    };
    const start = ctx.currentTime + 0.15;
    scheduleBar(start, 0);
    let nextBar = start + beat * 4;
    let barIdx = 1;
    this.musicTimer = setInterval(() => {
      if (!this.musicPlaying || !this.ctx) return;
      const cur = this.ctx.currentTime;
      while (nextBar < cur + 2.0) {
        scheduleBar(nextBar, barIdx);
        nextBar += beat * 4;
        barIdx += 1;
      }
    }, 250);
  }

  /* Profile music — chill lo-fi electric piano. Slower (~72 BPM), minor-key
     contemplative loop. Uses triangle+sine "Rhodes" stack, soft brush hat,
     light sub bass on root. No drums on every beat — sparse so the page
     reads as introspective rather than energetic. */
  startProfileMusic() {
    if (!this._ensure()) return;
    if (this.musicTrack === "profile" && this.musicPlaying) return;
    this.stopLobbyMusic();
    this._restoreMusicGain();
    this.musicPlaying = true;
    this.musicTrack = "profile";
    const ctx = this.ctx;
    const semi = (n) => Math.pow(2, n / 12);
    const D3 = 146.83;
    // Dm - Bb - F - C  (vi-IV-I-V in F major / natural minor in D)
    const ROOTS = [0, -4, 3, 10, 0, -4, 3, 10].map((s) => D3 * semi(s));
    const QUAL  = [[0,3,7],[0,4,7],[0,4,7],[0,4,7],[0,3,7],[0,4,7],[0,4,7],[0,4,7]];
    const BPM = 72;
    const beat = 60 / BPM;

    const epBus = ctx.createGain(); epBus.gain.value = 0.22;
    const epFilt = ctx.createBiquadFilter();
    epFilt.type = "lowpass"; epFilt.frequency.value = 2200;
    epFilt.connect(epBus); epBus.connect(this.musicGain);
    const bassBus = ctx.createGain(); bassBus.gain.value = 0.20;
    const bassFilt = ctx.createBiquadFilter();
    bassFilt.type = "lowpass"; bassFilt.frequency.value = 320;
    bassFilt.connect(bassBus); bassBus.connect(this.musicGain);

    // "Rhodes" voice — triangle fundamental + sine partial 2 oct up.
    const playRhodes = (freq, t, dur, peak = 0.22) => {
      const o1 = ctx.createOscillator(); o1.type = "triangle"; o1.frequency.value = freq;
      const o2 = ctx.createOscillator(); o2.type = "sine";     o2.frequency.value = freq * 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      g.gain.setTargetAtTime(peak * 0.55, t + 0.08, 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      o1.connect(g); o2.connect(g2); g2.connect(g);
      g.connect(epFilt);
      o1.start(t); o2.start(t);
      o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    };
    const playChord = (root, triad, t, dur) => {
      triad.forEach((s) => playRhodes(root * semi(s), t, dur, 0.18));
    };
    const playBass = (root, t, dur) => {
      // One soft sub note per bar with a quick second on beat 3
      const make = (tt, dd) => {
        const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = root * 0.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(0.55, tt + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + dd);
        osc.connect(g); g.connect(bassFilt);
        osc.start(tt); osc.stop(tt + dd + 0.05);
      };
      make(t, beat * 2);
      make(t + beat * 2, beat * 2);
    };
    const brushHat = (t) => {
      const dur = 0.09;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.4);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 4500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hp); hp.connect(g); g.connect(this.musicGain);
      src.start(t);
    };
    // Sparse melody — 4 notes per bar at quarter-then-rest, only on bars 0, 2, 4, 6.
    const MELODY = [12, 14, 17, 12];
    const scheduleBar = (startAt, barIdx) => {
      const phraseBar = barIdx % 8;
      const root = ROOTS[phraseBar];
      const triad = QUAL[phraseBar];
      playChord(root, triad, startAt, beat * 4);
      playBass(root, startAt, beat * 4);
      // Brushed hat on the 2 & 4 (back-beat) feels lofi
      brushHat(startAt + beat * 1);
      brushHat(startAt + beat * 3);
      if (phraseBar % 2 === 0) {
        MELODY.forEach((s, i) => {
          const tt = startAt + i * beat;
          playRhodes(root * 2 * semi(s), tt, beat * 0.85, 0.20);
        });
      }
    };
    const start = ctx.currentTime + 0.15;
    scheduleBar(start, 0);
    let nextBar = start + beat * 4;
    let barIdx = 1;
    this.musicTimer = setInterval(() => {
      if (!this.musicPlaying || !this.ctx) return;
      const cur = this.ctx.currentTime;
      while (nextBar < cur + 2.0) {
        scheduleBar(nextBar, barIdx);
        nextBar += beat * 4;
        barIdx += 1;
      }
    }, 250);
  }
}

const audioBus = new AudioBus();
export default audioBus;
