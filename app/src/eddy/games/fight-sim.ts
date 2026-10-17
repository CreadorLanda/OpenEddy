// A luta, sem tela: física, golpes, defesa, energia, rounds e a cabeça do
// Eddy. A tela (fight.ts) só desenha e lê o teclado; aqui dá para testar.
//
// Arena de 800 × 450 unidades, chão em y = 380. Melhor de 3 rounds de 45 s.
// Golpes (inspirados nos poderes biônicos de Lab Rats):
//   soco   rápido e curto          6 de dano
//   chute  mais lento e mais longo 9 de dano
//   SUPER FORÇA  energia cheia     22 de dano e arremessa
// Defender segura 80% do dano. Bater e apanhar enchem a energia.

import type { Level } from "./common";

export const W = 800;
export const FLOOR = 380;
const GRAVITY = 1700;
const WALK = 240;
const JUMP = -640;
const MIN_GAP = 52;
export const ROUND_TIME = 45;

export type Who = 0 | 1; // 0 = a pessoa, 1 = o Eddy
export type FState = "idle" | "walk" | "jump" | "punch" | "kick" | "special" | "block" | "hurt" | "ko";
export type Attack = "punch" | "kick" | "special";

interface Move {
  start: number; // fim da preparação (s)
  end: number; // fim da janela que acerta
  total: number;
  range: number;
  dmg: number;
  push: number;
  stun: number;
}

export const MOVES: Record<Attack, Move> = {
  punch: { start: 0.08, end: 0.17, total: 0.3, range: 72, dmg: 6, push: 70, stun: 0.26 },
  kick: { start: 0.15, end: 0.26, total: 0.46, range: 98, dmg: 9, push: 120, stun: 0.36 },
  special: { start: 0.22, end: 0.34, total: 0.62, range: 112, dmg: 22, push: 300, stun: 0.65 },
};

export interface Input {
  left: boolean;
  right: boolean;
  block: boolean;
  /** de um quadro só (apertou agora) */
  jump?: boolean;
  punch?: boolean;
  kick?: boolean;
  special?: boolean;
}

export interface Fighter {
  x: number;
  y: number; // pés
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  energy: number;
  state: FState;
  t: number; // tempo no estado
  stun: number;
  hit: boolean; // o golpe atual já acertou
  air: boolean;
}

export type FightEvent =
  | { type: "hit"; by: Who; move: Attack; dmg: number; blocked: boolean }
  | { type: "round"; winner: Who | null; round: number }
  | { type: "roundStart"; round: number }
  | { type: "over"; winner: Who | null };

const fighter = (x: number, facing: 1 | -1): Fighter => ({
  x, y: FLOOR, vx: 0, vy: 0, facing, hp: 100, energy: 0, state: "idle", t: 0, stun: 0, hit: false, air: false,
});

const isAttack = (s: FState): s is Attack => s === "punch" || s === "kick" || s === "special";

export class FightSim {
  f: [Fighter, Fighter] = [fighter(250, 1), fighter(550, -1)];
  round = 1;
  wins: [number, number] = [0, 0];
  clock = ROUND_TIME;
  /** pausa entre rounds (anúncio, K.O.) */
  hold = 1.6;
  over = false;
  winner: Who | null = null;
  events: FightEvent[] = [];
  private ai = { next: 0, input: { left: false, right: false, block: false } as Input };

  constructor(public level: Level = "normal", private rand: () => number = Math.random) {
    this.events.push({ type: "roundStart", round: 1 });
  }

  /** Avança `dt` segundos com o que a pessoa está apertando. Devolve os eventos do passo. */
  step(dt: number, you: Input): FightEvent[] {
    this.events = [];
    if (this.over) return this.events;
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0 && this.roundEnded) this.nextRound();
      for (const f of this.f) this.physics(f, dt);
      return this.events;
    }
    this.clock -= dt;
    const eddy = this.think(dt);
    this.control(this.f[0], you, dt);
    this.control(this.f[1], eddy, dt);
    for (const f of this.f) this.physics(f, dt);
    this.separate();
    this.face();
    this.strike(0);
    this.strike(1);
    for (const f of this.f) f.energy = Math.min(100, f.energy + dt * 2);
    this.checkRound();
    return this.events;
  }

  private roundEnded = false;

  private control(f: Fighter, inp: Input, dt: number) {
    f.t += dt;
    if (f.state === "ko") return;
    if (f.state === "hurt") {
      f.stun -= dt;
      if (f.stun <= 0) this.set(f, "idle");
      return;
    }
    if (isAttack(f.state)) {
      if (f.t >= MOVES[f.state].total) this.set(f, f.air ? "jump" : "idle");
      else return; // golpe não se cancela
    }
    if (inp.special && f.energy >= 100) {
      f.energy = 0;
      f.vx = 0;
      return this.set(f, "special");
    }
    if (inp.punch) return this.set(f, "punch");
    if (inp.kick) return this.set(f, "kick");
    if (f.air) return;
    if (inp.block) {
      f.vx = 0;
      if (f.state !== "block") this.set(f, "block");
      return;
    }
    if (inp.jump) {
      f.vy = JUMP;
      f.air = true;
      return this.set(f, "jump");
    }
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    f.vx = dir * WALK;
    const st: FState = dir ? "walk" : "idle";
    if (f.state !== st) this.set(f, st);
  }

  private set(f: Fighter, s: FState) {
    f.state = s;
    f.t = 0;
    f.hit = false;
  }

  private physics(f: Fighter, dt: number) {
    if (f.air) {
      f.vy += GRAVITY * dt;
      f.y += f.vy * dt;
      if (f.y >= FLOOR) {
        f.y = FLOOR;
        f.vy = 0;
        f.air = false;
        if (f.state === "jump") this.set(f, "idle");
      }
    }
    // empurrão (apanhou) perde força com o atrito
    if (f.state === "hurt" || f.state === "ko") f.vx *= Math.pow(0.02, dt);
    f.x = Math.max(40, Math.min(W - 40, f.x + f.vx * dt));
  }

  private separate() {
    const [a, b] = this.f;
    const gap = b.x - a.x;
    if (Math.abs(gap) < MIN_GAP && Math.abs(a.y - b.y) < 80) {
      const push = (MIN_GAP - Math.abs(gap)) / 2;
      const s = gap >= 0 ? 1 : -1;
      a.x = Math.max(40, a.x - push * s);
      b.x = Math.min(W - 40, b.x + push * s);
    }
  }

  private face() {
    const [a, b] = this.f;
    for (const [f, o] of [[a, b], [b, a]] as const) {
      if (!isAttack(f.state) && f.state !== "hurt" && f.state !== "ko") f.facing = o.x >= f.x ? 1 : -1;
    }
  }

  private strike(by: Who) {
    const f = this.f[by];
    const o = this.f[1 - by];
    if (!isAttack(f.state) || f.hit || o.state === "ko") return;
    const mv = MOVES[f.state];
    if (f.t < mv.start || f.t > mv.end) return;
    const dx = o.x - f.x;
    if (Math.sign(dx) !== f.facing || Math.abs(dx) > mv.range || Math.abs(o.y - f.y) > 95) return;
    f.hit = true;
    const blocked = o.state === "block" && o.facing === -f.facing;
    const dmg = Math.round(blocked ? mv.dmg * 0.2 : mv.dmg);
    o.hp = Math.max(0, o.hp - dmg);
    o.vx = f.facing * mv.push * (blocked ? 0.5 : 1);
    f.energy = Math.min(100, f.energy + (blocked ? 3 : 9));
    o.energy = Math.min(100, o.energy + 5);
    if (o.hp <= 0) {
      this.set(o, "ko");
      o.vx = f.facing * 320;
    } else if (!blocked) {
      this.set(o, "hurt");
      o.stun = mv.stun;
    }
    this.events.push({ type: "hit", by, move: f.state, dmg, blocked });
  }

  private checkRound() {
    const [a, b] = this.f;
    if (a.hp > 0 && b.hp > 0 && this.clock > 0) return;
    let winner: Who | null = null;
    if (a.hp !== b.hp) winner = a.hp > b.hp ? 0 : 1;
    if (winner !== null) this.wins[winner]++;
    this.events.push({ type: "round", winner, round: this.round });
    this.roundEnded = true;
    this.hold = 2.2;
    for (const f of this.f) {
      if (f.state === "ko") continue;
      this.set(f, f.air ? "jump" : "idle");
      f.vx = 0;
    }
    if (this.wins[0] >= 2 || this.wins[1] >= 2 || this.round >= 5) {
      this.over = true;
      this.winner = this.wins[0] === this.wins[1] ? null : this.wins[0] > this.wins[1] ? 0 : 1;
      this.events.push({ type: "over", winner: this.winner });
    }
  }

  private nextRound() {
    this.roundEnded = false;
    this.round++;
    this.clock = ROUND_TIME;
    const energy = [this.f[0].energy, this.f[1].energy];
    this.f = [fighter(250, 1), fighter(550, -1)];
    this.f[0].energy = energy[0];
    this.f[1].energy = energy[1];
    this.hold = 1.4;
    this.events.push({ type: "roundStart", round: this.round });
  }

  // ── o Eddy lutando ──────────────────────────────────────────────────────────

  private think(dt: number): Input {
    const me = this.f[1];
    const you = this.f[0];
    const ai = this.ai;
    ai.next -= dt;
    // golpes são de um quadro: só valem no quadro da decisão
    const keep: Input = { left: ai.input.left, right: ai.input.right, block: ai.input.block };
    if (ai.next > 0) return keep;
    const L = { easy: { every: 0.42, guard: 0.15, aggro: 0.45 }, normal: { every: 0.26, guard: 0.45, aggro: 0.6 }, hard: { every: 0.14, guard: 0.8, aggro: 0.75 } }[this.level];
    ai.next = L.every * (0.7 + this.rand() * 0.6);
    const dist = Math.abs(you.x - me.x);
    const toward = you.x > me.x ? { right: true, left: false } : { left: true, right: false };
    const away = { left: toward.right, right: toward.left };
    const threat = isAttack(you.state) && you.t < MOVES[you.state].end && dist < MOVES[you.state].range + 30;
    const r = this.rand();
    let out: Input;
    if (threat && r < L.guard) out = { left: false, right: false, block: true };
    else if (me.energy >= 100 && dist < MOVES.special.range && r < 0.8) out = { left: false, right: false, block: false, special: true };
    else if (dist < MOVES.punch.range) {
      out = r < L.aggro * 0.6 ? { left: false, right: false, block: false, punch: true }
        : r < L.aggro ? { left: false, right: false, block: false, kick: true }
        : r < L.aggro + 0.15 ? { ...away, block: false }
        : { left: false, right: false, block: this.rand() < L.guard };
    } else if (dist < MOVES.kick.range) {
      out = r < L.aggro ? { left: false, right: false, block: false, kick: true } : { ...toward, block: false };
    } else {
      out = r < 0.07 ? { ...toward, block: false, jump: true } : { ...toward, block: false };
    }
    ai.input = { left: out.left, right: out.right, block: out.block };
    return out;
  }
}
