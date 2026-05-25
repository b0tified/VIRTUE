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
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
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

  /* Quiet thunder — a low rumbling roll that precedes a lightning strike.
     Implemented as filtered brown noise with a slow attack/release. The
     volume is intentionally low (~0.15 of sfx gain peak) so it serves as
     atmosphere, not an interruption. ~1.4s long; the caller's flash should
     hit around the 800ms mark. */
  thunder() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.sfxGain;
    // 1) Brown-noise buffer for the rumble body
    const dur = 1.4;
    const sampleCount = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < sampleCount; i++) {
      // Brown noise via integrated white noise → low-frequency emphasis.
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 2) Low-pass it to keep the boom in the bass range
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(180, now);
    lp.frequency.linearRampToValueAtTime(120, now + dur);
    // 3) Envelope — gentle attack, sustained mid, slow decay
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.16, now + 0.30);
    g.gain.linearRampToValueAtTime(0.14, now + 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(lp); lp.connect(g); g.connect(out);
    src.start(now);
    src.stop(now + dur);
    // 4) Tiny mid-frequency crackle around the strike peak (~0.8s in)
    const crackleStart = now + 0.78;
    const crackle = ctx.createBufferSource();
    const cbuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.18), ctx.sampleRate);
    const cdata = cbuf.getChannelData(0);
    for (let i = 0; i < cdata.length; i++) cdata[i] = (Math.random() * 2 - 1) * 0.8;
    crackle.buffer = cbuf;
    const cbp = ctx.createBiquadFilter();
    cbp.type = "bandpass";
    cbp.frequency.value = 900;
    cbp.Q.value = 0.8;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, crackleStart);
    cg.gain.linearRampToValueAtTime(0.10, crackleStart + 0.02);
    cg.gain.exponentialRampToValueAtTime(0.0001, crackleStart + 0.18);
    crackle.connect(cbp); cbp.connect(cg); cg.connect(out);
    crackle.start(crackleStart);
    crackle.stop(crackleStart + 0.2);
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
      g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.2);
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
  gunshot(shooterId = null, distance = 0, weapon = "ak47") {
    if (!this._ensure()) return;
    const vol = this._distVolume(distance);
    if (vol <= 0.02) return;
    if (weapon === "laser") {
      this._laserShot(vol);
    } else {
      this._akShot(shooterId, vol);
    }
  }

  _akShot(shooterId, vol) {
    const ctx = this.ctx;
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

    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.sfxGain);
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
    osc.connect(og); og.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.16);
  }

  /* Laser: short sci-fi "pew" — descending square sweep + bright ring + zap noise. */
  _laserShot(vol) {
    const ctx = this.ctx;
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
    sweep.connect(sweepFilt); sweepFilt.connect(sg); sg.connect(this.sfxGain);
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
    ring.connect(rg); rg.connect(this.sfxGain);
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
    src.connect(hp); hp.connect(ng); ng.connect(this.sfxGain);
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

  /* -------- Footstep -------- */
  footstep(sprint = false) {
    if (!this._ensure()) return;
    const ctx = this.ctx;
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
    g.gain.value = sprint ? 0.18 : 0.12;
    src.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    src.start();

    // sub thump
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.07);
    const og = ctx.createGain();
    og.gain.setValueAtTime(sprint ? 0.22 : 0.14, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    osc.connect(og); og.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
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

  startLobbyMusic() {
    if (!this._ensure()) return;
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    const ctx = this.ctx;

    // -- Helpers --
    const semi = (n) => Math.pow(2, n / 12);
    // Base note A2 = 110 Hz. Chord roots & their pitch class:
    // Am - F - C - G - Am - F - G - E (8 bar minor-pop loop)
    const A2 = 110.0;
    // Semitone offsets from A2 for roots:
    const ROOTS = [0, -4, 3, -2, 0, -4, -2, -5].map((s) => A2 * semi(s));
    // Chord qualities (triads): Am, F, C, G, Am, F, G, E (relative semitones)
    const CHORDS = [
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

    const BPM = 84;
    const beat = 60 / BPM;
    const sixteenth = beat / 4;

    // -- Buses --
    // Soft pad (low-pass filtered saw)
    const padFilt = ctx.createBiquadFilter();
    padFilt.type = "lowpass";
    padFilt.frequency.value = 950;
    padFilt.Q.value = 0.4;
    const padBus = ctx.createGain();
    padBus.gain.value = 0.26;
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

    const delay = ctx.createDelay(0.6);
    delay.delayTime.value = sixteenth * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const delayMix = ctx.createGain();
    delayMix.gain.value = 0.26;
    delay.connect(fb); fb.connect(delay);
    delay.connect(delayMix); delayMix.connect(this.musicGain);
    leadBus.connect(delay);

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
        osc1.detune.value = -6;
        osc2.detune.value = +6;
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

    const scheduleBar = (startAt, barIndex) => {
      const phraseBar = barIndex % 8;
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

      // Lead — DISABLED for a seamless continuous loop (the bar-7 riff used
      // to give the song an audible "ending" that broke the loop). Quiet
      // melody fragments instead, played every 4 bars so the texture stays
      // ambient but never resolves.
      if (phraseBar === 3) {
        // Half the original RIFF_B, no resolution back to root
        RIFF_B.slice(0, 8).forEach((s, i) => {
          if (s === null) return;
          playLead(root, s, startAt + i * sixteenth, sixteenth * 1.6);
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

  stopLobbyMusic() {
    this.musicPlaying = false;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}

const audioBus = new AudioBus();
export default audioBus;
