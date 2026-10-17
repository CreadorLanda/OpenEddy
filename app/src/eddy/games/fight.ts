// A luta na ligação: você contra o Eddy, bonecos de traço no mesmo estilo do
// rosto dele (holograma ou clássico). A regra mora em fight-sim.ts; aqui é o
// desenho, o teclado, os botões de toque e os comentários.
//
// Teclado: ← → (ou A D) andam, ↑ (W) pula, J soco, K chute, L defende,
// U super força (com a energia cheia). No celular, os botões embaixo.

import { h } from "../../core/dom";
import { faceTheme } from "../eddy";
import { clearBanner, endBanner, levelPicker, type GameHost, type GameSession, type Level } from "./common";
import { FLOOR, FightSim, MOVES, ROUND_TIME, W, type Fighter, type FightEvent, type Input } from "./fight-sim";

const H = 450;
const KEYS: Record<string, keyof Input> = {
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
  ArrowUp: "jump", w: "jump", W: "jump",
  j: "punch", J: "punch", z: "punch", Z: "punch",
  k: "kick", K: "kick", x: "kick", X: "kick",
  l: "block", L: "block", c: "block", C: "block",
  u: "special", U: "special", v: "special", V: "special",
};
const HELD = new Set<keyof Input>(["left", "right", "block"]);

interface Spark {
  x: number;
  y: number;
  t: number;
  big: boolean;
}

export class FightGame implements GameSession {
  readonly kind = "fight" as const;
  readonly el: HTMLElement;
  private sim: FightSim;
  private level: Level = "normal";
  private canvas: HTMLCanvasElement;
  private banner: HTMLElement;
  private held: Input = { left: false, right: false, block: false };
  private taps: Partial<Input> = {};
  private raf = 0;
  private last = 0;
  private closed = false;
  private sparks: Spark[] = [];
  private shake = 0;
  private overlay: { text: string; t: number } | null = null;
  private lastComment = -10;
  private saidLow = false;
  private clock = 0;
  private hits = 0;

  constructor(private host: GameHost) {
    this.sim = new FightSim(this.level);
    this.canvas = h("canvas", { class: "arena" }) as HTMLCanvasElement;
    this.banner = h("div", { class: "game-banner" });
    const pad = (label: string, key: keyof Input, title: string) => {
      const b = h("button", { type: "button", class: "pad", title }, label);
      const down = (ev: Event) => {
        ev.preventDefault();
        if (HELD.has(key)) (this.held[key] as boolean) = true;
        else this.taps[key] = true;
        b.classList.add("on");
      };
      const up = () => {
        if (HELD.has(key)) (this.held[key] as boolean) = false;
        b.classList.remove("on");
      };
      b.addEventListener("pointerdown", down);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointerleave", up);
      b.addEventListener("pointercancel", up);
      return b;
    };
    this.el = h(
      "div",
      { class: "game fight" },
      h("header", { class: "panel-head" }, h("b", {}, "Luta"), h("span", { class: "who" }, "você × Eddy · melhor de 3"), h("div", { class: "grow" }),
        levelPicker(this.level, (l) => ((this.level = l), (this.sim.level = l)))),
      h("div", { class: "board-wrap" }, this.canvas, this.banner),
      h(
        "div",
        { class: "pads" },
        h("div", { class: "pad-group" }, pad("◀", "left", "Andar (← ou A)"), pad("▲", "jump", "Pular (↑ ou W)"), pad("▶", "right", "Andar (→ ou D)")),
        h("div", { class: "pad-group" }, pad("Soco", "punch", "Soco (J)"), pad("Chute", "kick", "Chute (K)"), pad("Defesa", "block", "Defender (L)"), pad("⚡ Super", "special", "Super força (U), com a energia cheia")),
      ),
      h("p", { class: "keys-hint" }, "Teclado: ← → andar · ↑ pular · J soco · K chute · L defesa · U super força"),
    );
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    this.raf = requestAnimationFrame(this.frame);
  }

  get started() {
    return !this.sim.over && (this.sim.round > 1 || this.hits > 2);
  }

  context(): string {
    const s = this.sim;
    if (s.over) return "";
    return `Vocês estão LUTANDO agora (jogo de luta 2D, melhor de 3): round ${s.round}; rounds ${s.wins[1]}×${s.wins[0]} (você, Eddy × a pessoa); vida: você ${s.f[1].hp}, a pessoa ${s.f[0].hp}.`;
  }

  close() {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
  }

  private onKey = (ev: KeyboardEvent) => {
    if (this.closed || document.activeElement instanceof HTMLInputElement) return;
    const key = KEYS[ev.key];
    if (!key) return;
    ev.preventDefault();
    const down = ev.type === "keydown";
    if (HELD.has(key)) (this.held[key] as boolean) = down;
    else if (down && !ev.repeat) this.taps[key] = true;
  };

  private restart() {
    this.sim = new FightSim(this.level);
    this.saidLow = false;
    this.hits = 0;
    this.sparks = [];
    clearBanner(this.banner);
    cancelAnimationFrame(this.raf);
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number) => {
    if (this.closed) return;
    const dt = this.last ? Math.min(1 / 30, (t - this.last) / 1000) : 0;
    this.last = t;
    this.clock += dt;
    const input: Input = { ...this.held, ...this.taps };
    this.taps = {};
    for (const ev of this.sim.step(dt, input)) this.react(ev);
    this.tick(dt);
    this.draw();
    if (!this.sim.over || this.overlay) this.raf = requestAnimationFrame(this.frame);
  };

  private say(pool: string, force = false) {
    if (!force && this.clock - this.lastComment < 5) return;
    this.lastComment = this.clock;
    this.host.comment(pool);
  }

  private react(ev: FightEvent) {
    const s = this.sim;
    if (ev.type === "hit") {
      this.hits++;
      const o = s.f[1 - ev.by];
      this.sparks.push({ x: o.x - o.facing * 6, y: o.y - 100, t: 0, big: ev.move === "special" });
      if (ev.move === "special" && !ev.blocked) this.shake = 0.35;
      this.host.sfx?.(ev.blocked ? "block" : ev.move === "special" ? "heavy" : "hit");
      if (o.hp <= 0) this.host.sfx?.("ko");
      if (ev.by === 1 && ev.move === "special" && !ev.blocked) this.say("f_special");
      else if (ev.by === 0 && ev.move === "special" && !ev.blocked) this.say("f_hurt");
      else if (!this.saidLow && s.f[1].hp > 0 && s.f[1].hp < 30) {
        this.saidLow = true;
        this.say("f_low", true);
      }
    } else if (ev.type === "roundStart") {
      this.overlay = { text: `ROUND ${ev.round}`, t: 1.4 };
    } else if (ev.type === "round") {
      const ko = s.f[0].hp <= 0 || s.f[1].hp <= 0;
      this.overlay = { text: ko ? "K.O.!" : "TEMPO!", t: 2.1 };
      if (!s.over) {
        if (ev.winner === 1) this.say("f_round_won", true);
        else if (ev.winner === 0) this.say("f_round_lost", true);
      }
    } else if (ev.type === "over") {
      const o = ev.winner === 1 ? "won" : ev.winner === 0 ? "lost" : "draw";
      window.setTimeout(() => {
        if (this.closed) return;
        endBanner(this.banner, o, () => this.restart());
      }, 1500);
      this.host.end(o);
    }
  }

  private tick(dt: number) {
    for (const sp of this.sparks) sp.t += dt;
    this.sparks = this.sparks.filter((sp) => sp.t < 0.3);
    this.shake = Math.max(0, this.shake - dt);
    if (this.overlay) {
      this.overlay.t -= dt;
      if (this.overlay.t <= 0) {
        const fight = this.overlay.text.startsWith("ROUND");
        this.overlay = fight ? { text: "LUTEM!", t: 0.6 } : null;
      }
    }
  }

  // ── desenho ─────────────────────────────────────────────────────────────────

  private draw() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const hh = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(hh * dpr)) c.height = Math.round(hh * dpr);
    const ctx = c.getContext("2d")!;
    const k = (w / W) * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const classic = faceTheme() === "classic";
    const ink = classic ? "#111" : "#6ee4ff";
    const you = classic ? "#111" : "#eafcff";
    if (this.shake) ctx.translate((Math.random() - 0.5) * 14 * this.shake * 3, (Math.random() - 0.5) * 8 * this.shake * 3);

    // chão em perspectiva
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = classic ? "rgba(0,0,0,.18)" : "rgba(110,228,255,.16)";
    ctx.lineWidth = 1.5;
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 40, FLOOR);
      ctx.lineTo(W / 2 + i * 120, H);
      ctx.stroke();
    }
    ctx.strokeStyle = classic ? "#111" : "rgba(110,228,255,.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR + 2);
    ctx.lineTo(W, FLOOR + 2);
    ctx.stroke();

    const [p, e] = this.sim.f;
    this.fighter(ctx, p, you, false, classic);
    this.fighter(ctx, e, ink, true, classic);

    for (const sp of this.sparks) this.spark(ctx, sp, classic ? "#111" : "#fff6b0");
    this.hud(ctx, classic, ink, you);

    if (this.overlay) {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const a = Math.min(1, this.overlay.t * 3);
      ctx.globalAlpha = a;
      ctx.font = "800 64px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 8;
      ctx.strokeStyle = classic ? "#fff" : "#04080c";
      ctx.fillStyle = classic ? "#111" : "#eafcff";
      ctx.strokeText(this.overlay.text, W / 2, 210);
      ctx.fillText(this.overlay.text, W / 2, 210);
      ctx.globalAlpha = 1;
    }
  }

  private fighter(ctx: CanvasRenderingContext2D, f: Fighter, color: string, eddy: boolean, classic: boolean) {
    ctx.save();
    ctx.translate(f.x, f.y);
    if (f.state === "ko") {
      const fall = Math.min(1, f.t * 3);
      ctx.translate(0, -8 * fall);
      ctx.rotate((-Math.PI / 2) * fall * f.facing); // cai para trás
    }
    ctx.scale(f.facing * 1.3, 1.3); // bonecos maiores que a física (que é em unidades da arena)
    if (f.state === "hurt") ctx.rotate(-0.22);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 7;
    ctx.shadowColor = color;
    ctx.shadowBlur = classic ? 0 : eddy ? 14 : 8;
    if (f.energy >= 100 && !classic) ctx.shadowBlur = 22 + Math.sin(this.clock * 12) * 8;

    const ext = this.extension(f);
    const bob = f.state === "idle" ? Math.sin(this.clock * 4 + (eddy ? 1 : 0)) * 2 : 0;
    const hip: [number, number] = [0, -62 + bob];
    const neck: [number, number] = [0, -112 + bob];
    const line = (pts: [number, number][]) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    };

    // pernas
    if (f.state === "kick") {
      line([hip, [-12, -30], [-18, 0]]);
      line([hip, [20 + ext * 22, -62 - ext * 6], [24 + ext * 70, -60 - ext * 18]]);
    } else if (f.air) {
      line([hip, [-4, -40], [-14, -22]]);
      line([hip, [18, -44], [14, -18]]);
    } else {
      const s = f.state === "walk" ? Math.sin(this.clock * 12) * 14 : 0;
      line([hip, [-10, -31], [-18 - s, 0]]);
      line([hip, [12, -31], [18 + s, 0]]);
    }
    // tronco
    line([hip, neck]);
    // braços
    const sh: [number, number] = [0, -104 + bob];
    if (f.state === "punch") {
      line([sh, [18 + ext * 20, -106], [24 + ext * 50, -108]]);
      line([sh, [8, -92], [14, -114]]);
      if (ext > 0.9) this.fist(ctx, 26 + ext * 50, -108, 7);
    } else if (f.state === "special") {
      line([sh, [22 + ext * 26, -100], [30 + ext * 64, -102]]);
      line([sh, [20 + ext * 22, -112], [28 + ext * 60, -116]]);
      this.fist(ctx, 34 + ext * 64, -108, 9 + ext * 9);
    } else if (f.state === "block") {
      line([sh, [22, -96], [26, -128]]);
      line([sh, [16, -92], [20, -122]]);
    } else if (f.state === "hurt" || f.state === "ko") {
      line([sh, [-14, -96], [-26, -120]]);
      line([sh, [10, -90], [-6, -78]]);
    } else {
      line([sh, [16, -92], [24, -112]]);
      line([sh, [6, -94], [12, -116]]);
    }
    // cabeça
    if (eddy) this.eddyHead(ctx, 0, -134 + bob, f);
    else {
      ctx.beginPath();
      ctx.arc(4, -132 + bob, 15, 0, Math.PI * 2);
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Quanto o golpe está esticado (0 a 1) no tempo atual. */
  private extension(f: Fighter): number {
    if (f.state !== "punch" && f.state !== "kick" && f.state !== "special") return 0;
    const m = MOVES[f.state];
    if (f.t < m.start) return (f.t / m.start) * 0.5;
    if (f.t <= m.end) return 1;
    return Math.max(0, 1 - (f.t - m.end) / (m.total - m.end));
  }

  private fist(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** A cabeça do Eddy: o "E" com rosto, em miniatura. */
  private eddyHead(ctx: CanvasRenderingContext2D, x: number, y: number, f: Fighter) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(14, 18);
    ctx.lineTo(-14, 18);
    ctx.lineTo(-14, -4);
    ctx.arc(0, -4, 14, Math.PI, 0);
    ctx.stroke();
    ctx.lineWidth = 3;
    const mad = f.state === "hurt" || f.state === "ko";
    for (const ex of [-5, 6]) {
      ctx.beginPath();
      if (mad) {
        ctx.moveTo(ex - 3, -8);
        ctx.lineTo(ex + 3, -4);
      } else ctx.arc(ex, -4, 3, Math.PI, 0);
      ctx.stroke();
    }
    ctx.beginPath();
    if (mad) ctx.arc(1, 11, 5, Math.PI, 0);
    else ctx.arc(1, 4, 6, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  private spark(ctx: CanvasRenderingContext2D, sp: Spark, color: string) {
    const r = (sp.big ? 46 : 26) * (0.5 + sp.t * 3);
    ctx.save();
    ctx.globalAlpha = 1 - sp.t / 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = sp.big ? 5 : 3;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + sp.x;
      ctx.beginPath();
      ctx.moveTo(sp.x + Math.cos(a) * r * 0.35, sp.y + Math.sin(a) * r * 0.35);
      ctx.lineTo(sp.x + Math.cos(a) * r, sp.y + Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.restore();
  }

  private hud(ctx: CanvasRenderingContext2D, classic: boolean, ink: string, you: string) {
    const s = this.sim;
    const bar = (x: number, y: number, w: number, hgt: number, v: number, color: string, rtl: boolean) => {
      ctx.lineWidth = 2;
      ctx.strokeStyle = classic ? "#111" : "rgba(110,228,255,.6)";
      ctx.strokeRect(x, y, w, hgt);
      ctx.fillStyle = color;
      const fw = (w - 4) * Math.max(0, v);
      ctx.fillRect(rtl ? x + w - 2 - fw : x + 2, y + 2, fw, hgt - 4);
    };
    const hpColor = (v: number) => (v > 0.5 ? (classic ? "#111" : "#6ee4ff") : v > 0.25 ? "#f5a524" : "#ef4444");
    bar(20, 18, 320, 20, s.f[0].hp / 100, hpColor(s.f[0].hp / 100), false);
    bar(460, 18, 320, 20, s.f[1].hp / 100, hpColor(s.f[1].hp / 100), true);
    bar(20, 42, 160, 8, s.f[0].energy / 100, s.f[0].energy >= 100 ? "#f5d742" : classic ? "#666" : "rgba(110,228,255,.45)", false);
    bar(620, 42, 160, 8, s.f[1].energy / 100, s.f[1].energy >= 100 ? "#f5d742" : classic ? "#666" : "rgba(110,228,255,.45)", true);
    ctx.font = "700 15px Inter, system-ui, sans-serif";
    ctx.fillStyle = you;
    ctx.textAlign = "left";
    ctx.fillText("VOCÊ", 20, 70);
    ctx.fillStyle = ink;
    ctx.textAlign = "right";
    ctx.fillText("EDDY", 780, 70);
    // rounds ganhos
    for (const [who, x0, dir] of [[0, 84, 1], [1, 716, -1]] as const) {
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(x0 + dir * (i * 16), 65, 5, 0, Math.PI * 2);
        ctx.strokeStyle = classic ? "#111" : "#6ee4ff";
        ctx.lineWidth = 2;
        ctx.stroke();
        if (s.wins[who] > i) {
          ctx.fillStyle = "#f5d742";
          ctx.fill();
        }
      }
    }
    ctx.textAlign = "center";
    ctx.font = "800 30px Inter, system-ui, sans-serif";
    ctx.fillStyle = classic ? "#111" : "#eafcff";
    ctx.fillText(String(Math.max(0, Math.ceil(s.clock === ROUND_TIME ? ROUND_TIME : s.clock))), W / 2, 42);
  }
}
