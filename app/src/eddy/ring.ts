// Toque de chamada sintetizado (440 + 480 Hz, 1,2 s ligado / 2 s desligado),
// os bipes de atender e desligar, e os efeitos das cenas do Eddy (telefone
// batido, chiado de sinal ruim, fanfarra do ego, musiquinha de espera).
// Nada de arquivo de áudio.

export class Ringer {
  private ctx: AudioContext;
  private nodes: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private timer = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  start() {
    this.stop();
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.ctx.destination);
    const osc = [440, 480].map((f) => {
      const o = this.ctx.createOscillator();
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      return o;
    });
    this.nodes = { osc, gain };
    const cycle = () => {
      const t = this.ctx.currentTime;
      gain.gain.setTargetAtTime(0.08, t, 0.01);
      gain.gain.setTargetAtTime(0, t + 1.2, 0.02);
    };
    cycle();
    this.timer = window.setInterval(cycle, 3200);
  }

  stop() {
    window.clearInterval(this.timer);
    if (this.nodes) {
      for (const o of this.nodes.osc) o.stop();
      this.nodes.gain.disconnect();
      this.nodes = null;
    }
  }

  /** Dois bipes curtos: subindo = atendeu, descendo = desligou. */
  beep(up: boolean) {
    const t = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.connect(this.ctx.destination);
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.connect(gain);
    const [a, b] = up ? [660, 990] : [660, 440];
    o.frequency.setValueAtTime(a, t);
    o.frequency.setValueAtTime(b, t + 0.12);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.01);
    gain.gain.setValueAtTime(0.09, t + 0.22);
    gain.gain.linearRampToValueAtTime(0, t + 0.26);
    o.start(t);
    o.stop(t + 0.3);
  }

  private tone(freq: number, at: number, dur: number, vol = 0.08, type: OscillatorType = "sine") {
    const g = this.ctx.createGain();
    g.connect(this.ctx.destination);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.015);
    g.gain.setTargetAtTime(0, at + dur * 0.7, dur * 0.15);
    o.start(at);
    o.stop(at + dur + 0.2);
  }

  /** Telefone batido: pancada grave + o tom de ocupado. */
  slam() {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.ctx.destination);
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    o.connect(g);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.start(t);
    o.stop(t + 0.35);
    for (let i = 0; i < 3; i++) this.tone(480, t + 0.5 + i * 0.5, 0.25, 0.06, "square");
  }

  /** Chiado de ligação ruim. */
  staticBurst(ms = 1400) {
    const len = Math.floor((this.ctx.sampleRate * ms) / 1000);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(i / 900));
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 2200;
    const g = this.ctx.createGain();
    g.gain.value = 0.07;
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start();
  }

  /** Fanfarra do ego. */
  fanfare() {
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.12, i > 3 ? 0.4 : 0.14, 0.07, "sawtooth"));
  }

  /** Efeitos dos jogos: soco, golpe forte, defesa, carta, nocaute. */
  sfx(kind: "hit" | "heavy" | "block" | "card" | "ko") {
    const t = this.ctx.currentTime;
    if (kind === "ko") {
      [392, 330, 262, 196].forEach((f, i) => this.tone(f, t + i * 0.16, 0.22, 0.06, "square"));
      return;
    }
    if (kind === "block") return this.tone(1400, t, 0.06, 0.05, "square");
    const ms = kind === "card" ? 180 : kind === "heavy" ? 260 : 110;
    const len = Math.floor((this.ctx.sampleRate * ms) / 1000);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, kind === "card" ? 1 : 3);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = kind === "card" ? "highpass" : "lowpass";
    f.frequency.value = kind === "card" ? 2500 : kind === "heavy" ? 500 : 1100;
    const g = this.ctx.createGain();
    g.gain.value = kind === "heavy" ? 0.5 : kind === "card" ? 0.08 : 0.3;
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t);
    if (kind === "heavy") this.tone(70, t, 0.25, 0.25, "sine");
  }

  private holdTimer = 0;

  /** Musiquinha de espera em loop (bem genérica, de propósito). */
  holdMusic(on: boolean) {
    window.clearInterval(this.holdTimer);
    if (!on) return;
    const notes = [392, 440, 494, 523, 494, 440, 392, 330, 349, 392, 440, 392];
    const play = () => {
      const t = this.ctx.currentTime;
      notes.forEach((f, i) => this.tone(f, t + i * 0.22, 0.2, 0.045, "triangle"));
    };
    play();
    this.holdTimer = window.setInterval(play, notes.length * 220);
  }
}
