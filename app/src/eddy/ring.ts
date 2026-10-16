// Toque de chamada sintetizado (440 + 480 Hz, 1,2 s ligado / 2 s desligado),
// e os bipes de atender e desligar. Nada de arquivo de áudio.

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
}
