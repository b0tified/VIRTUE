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
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.32;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.65;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
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

  /* -------- Gunshot: pitch depends on shooter id, volume on distance -------- */
  gunshot(shooterId = null, distance = 0) {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const vol = this._distVolume(distance);
    if (vol <= 0.02) return;

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

  /* -------- Hit marker (you hit someone) -------- */
  hitmark() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [
      { f: 1800, t: now, dur: 0.06 },
      { f: 2400, t: now + 0.04, dur: 0.08 },
    ].forEach(({ f, t, dur }) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.32, t + 0.005);
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

  killSfx() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = [880, 1175, 1568];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = now + i * 0.07;
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g); g.connect(this.sfxGain);
      osc.start(t); osc.stop(t + 0.2);
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

  /* -------- ROCK Lobby music -------- */
  // Distorted power-chord progression Em - G - D - A, 140 bpm, with kick/snare/hat
  _makeDistortionCurve(amount) {
    const k = amount;
    const samples = 1024;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * Math.PI) / (Math.PI + k * Math.abs(x));
      // Soft clip
      curve[i] = Math.tanh(curve[i] * 0.05);
    }
    return curve;
  }

  startLobbyMusic() {
    if (!this._ensure()) return;
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    const ctx = this.ctx;

    // Power-chord roots in Hz: E2, G2, D3, A2 (mid-bass region)
    const chordRoots = [82.41, 98.0, 146.83, 110.0];
    const beat = 60 / 140; // 140 bpm

    // Distortion bus for guitar
    const dist = ctx.createWaveShaper();
    dist.curve = this._makeDistortionCurve(60);
    dist.oversample = "4x";
    const guitarPostFilter = ctx.createBiquadFilter();
    guitarPostFilter.type = "lowpass";
    guitarPostFilter.frequency.value = 2200;
    const guitarBus = ctx.createGain();
    guitarBus.gain.value = 0.45;
    dist.connect(guitarPostFilter);
    guitarPostFilter.connect(guitarBus);
    guitarBus.connect(this.musicGain);

    const playPowerChord = (root, t, dur) => {
      // root + fifth (3:2) + octave for power chord feel
      const ratios = [1, 1.5, 2];
      ratios.forEach((r, idx) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = root * r;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0, t);
        g.gain.linearRampToValueAtTime(0.45 / (idx + 1), t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.85);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        osc.connect(g);
        g.connect(dist);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      });
    };

    const playBass = (root, t, dur) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = root * 0.5; // octave below
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.55, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.95);
      osc.connect(filt); filt.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + dur + 0.02);
    };

    const kick = (t) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.85, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + 0.25);
    };

    const snare = (t) => {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.13, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      src.connect(bp); bp.connect(g); g.connect(this.musicGain);
      src.start(t);
      // ring tone for snare body
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 220;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.18, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(og); og.connect(this.musicGain);
      osc.start(t); osc.stop(t + 0.1);
    };

    const hihat = (t, accent = false) => {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.value = accent ? 0.22 : 0.1;
      src.connect(hp); hp.connect(g); g.connect(this.musicGain);
      src.start(t);
    };

    const scheduleBar = (startAt, barIndex) => {
      const root = chordRoots[barIndex % chordRoots.length];
      // 4 beats per bar
      // Power chord on beat 1 (sustained ~4 beats)
      playPowerChord(root, startAt, beat * 4);
      // bass: root on every beat, with palm-mute feel
      for (let b = 0; b < 4; b++) {
        playBass(root, startAt + b * beat, beat * 0.9);
      }
      // drums: kick on 1+3, snare on 2+4, hi-hat 8ths
      kick(startAt + 0);
      kick(startAt + beat * 2);
      snare(startAt + beat * 1);
      snare(startAt + beat * 3);
      for (let i = 0; i < 8; i++) {
        hihat(startAt + i * (beat / 2), i % 2 === 0);
      }
    };

    const start = ctx.currentTime + 0.05;
    scheduleBar(start, 0);
    let nextBar = start + beat * 4;
    let barIdx = 1;
    this.musicTimer = setInterval(() => {
      if (!this.musicPlaying || !this.ctx) return;
      const cur = this.ctx.currentTime;
      while (nextBar < cur + 1.5) {
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
