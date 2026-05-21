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
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  setMusicMuted(m) {
    this.musicMuted = m;
    if (this.musicGain) this.musicGain.gain.value = m ? 0 : this._musicVol;
  }

  setSfxMuted(m) {
    this.sfxMuted = m;
    if (this.sfxGain) this.sfxGain.gain.value = m ? 0 : this._sfxVol;
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
    // Two complementary phrases for bars 4 & 8.
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

      // Lead — sparse melodic phrase on bar 4 only of each 8-bar loop
      if (phraseBar === 7) {
        RIFF_A.forEach((s, i) => {
          if (s === null) return;
          playLead(root, s, startAt + i * sixteenth, sixteenth * 2.2);
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
