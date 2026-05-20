// Procedural audio via Web Audio API — gunshots, hit markers, lobby music.
class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicNodes = [];
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
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.6;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  /* -------- Gunshot -------- */
  gunshot() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const dur = 0.18;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1600, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 80;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    src.start();

    // body thump
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(160, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
    osc.connect(og); og.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
  }

  /* -------- Hit marker (you hit someone) -------- */
  hitmark() {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(); osc.stop(ctx.currentTime + 0.08);
  }

  /* -------- Damage (you got hit) -------- */
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

  /* -------- Kill sound -------- */
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

  /* -------- Lobby music: simple comic-bop loop -------- */
  startLobbyMusic() {
    if (!this._ensure()) return;
    if (this.musicPlaying) return;
    this.musicPlaying = true;

    const ctx = this.ctx;
    // bass notes (E minor pentatonic vibe)
    const bassPattern = [55, 55, 73, 65, 55, 55, 82, 65]; // Hz approx
    // lead/arp on top
    const leadPattern = [165, 220, 247, 220, 196, 220, 247, 294];
    const beat = 0.32; // ~94 bpm
    const barLen = bassPattern.length * beat;

    const scheduleBar = (startAt) => {
      for (let i = 0; i < bassPattern.length; i++) {
        const t = startAt + i * beat;
        // Bass
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = bassPattern[i];
        const filt = ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = 600;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.95);
        osc.connect(filt); filt.connect(g); g.connect(this.musicGain);
        osc.start(t); osc.stop(t + beat);

        // Lead
        const lo = ctx.createOscillator();
        lo.type = "triangle";
        lo.frequency.value = leadPattern[i];
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0.0, t);
        lg.gain.linearRampToValueAtTime(0.16, t + 0.005);
        lg.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.7);
        lo.connect(lg); lg.connect(this.musicGain);
        lo.start(t); lo.stop(t + beat);

        // Kick on 1 & 5
        if (i % 4 === 0) {
          const k = ctx.createOscillator();
          k.type = "sine";
          k.frequency.setValueAtTime(120, t);
          k.frequency.exponentialRampToValueAtTime(40, t + 0.18);
          const kg = ctx.createGain();
          kg.gain.setValueAtTime(0.6, t);
          kg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          k.connect(kg); kg.connect(this.musicGain);
          k.start(t); k.stop(t + 0.22);
        }
        // Snare-ish noise on 3 & 7
        if (i % 4 === 2) {
          const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
          const d = buf.getChannelData(0);
          for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const sg = ctx.createGain();
          sg.gain.setValueAtTime(0.35, t);
          sg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
          src.connect(sg); sg.connect(this.musicGain);
          src.start(t);
        }
      }
    };

    const start = ctx.currentTime + 0.05;
    scheduleBar(start);
    let nextBar = start + barLen;
    this.musicTimer = setInterval(() => {
      if (!this.musicPlaying || !this.ctx) return;
      const cur = this.ctx.currentTime;
      while (nextBar < cur + 1.0) {
        scheduleBar(nextBar);
        nextBar += barLen;
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
