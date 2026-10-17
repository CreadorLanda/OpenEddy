// Os jogos da ligação. Este arquivo tem o tabuleiro (xadrez e damas) e a
// fábrica `createGame`; a luta fica em fight.ts e o duelo de cartas em duel.ts.
//
// Tabuleiro: xadrez ou damas contra o Eddy.
//
// A pessoa joga com as brancas, embaixo, e começa. Ela clica na peça e depois
// na casa; o Eddy "pensa" (o rosto entra em think) e responde. No meio do jogo
// ele solta comentários curtos (listas g_* de scenes.py, sem passar pelo
// modelo) e, no fim, a tela pede ao modelo uma fala de vitória ou de derrota.

import { Chess, type Square } from "chess.js";
import { h } from "../../core/dom";
import { bestMove as chessBest, material } from "./chess";
import * as ck from "./checkers";
import { clearBanner, endBanner, levelPicker, type GameHost, type GameKind, type GameSession, type Level, type Outcome } from "./common";
import { DuelGame } from "./duel";
import { FightGame } from "./fight";

export type { GameHost, GameKind, GameSession, Level, Outcome } from "./common";

type BoardKind = "chess" | "checkers";

/** Abre o jogo pedido. */
export function createGame(kind: Exclude<GameKind, "made">, host: GameHost): GameSession {
  if (kind === "fight") return new FightGame(host);
  if (kind === "duel") return new DuelGame(host);
  return new GameView(kind, host);
}

const LEVELS: Record<BoardKind, Record<Level, { depth: number; noise: number }>> = {
  chess: { easy: { depth: 1, noise: 150 }, normal: { depth: 2, noise: 30 }, hard: { depth: 4, noise: 0 } },
  checkers: { easy: { depth: 2, noise: 60 }, normal: { depth: 4, noise: 10 }, hard: { depth: 7, noise: 0 } },
};

const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";
const sqName = (i: number) => (FILES[i & 7] + String(8 - (i >> 3))) as Square;
const sqIndex = (s: string) => (8 - Number(s[1])) * 8 + FILES.indexOf(s[0]);

/** O que muda entre os dois jogos: quem está onde e o que dá para fazer. */
interface Rules {
  piece(i: number): { cls: string; glyph: string } | null;
  /** casas de onde a pessoa pode mexer agora */
  sources(): Set<number>;
  targets(from: number): number[];
  /** lance da pessoa; devolve o que ela capturou (valor em "pontos") */
  play(from: number, to: number): number;
  /** lance do Eddy; devolve [de, para, valor capturado] ou null se ele não tem lance */
  reply(level: Level): [number, number, number] | null;
  /** fim de jogo, do ponto de vista do Eddy, ou null */
  over(): Outcome | null;
  check(): "eddy" | "me" | null;
  /** vantagem do Eddy em pontos (negativo = perdendo) */
  balance(): number;
  context(): string;
}

function chessRules(): Rules {
  const ch = new Chess();
  const val: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  return {
    piece(i) {
      const p = ch.get(sqName(i));
      return p ? { cls: p.color === "w" ? "me" : "eddy", glyph: GLYPH[p.type] + "︎" } : null;
    },
    sources() {
      const s = new Set<number>();
      if (ch.turn() !== "w" || ch.isGameOver()) return s;
      for (const m of ch.moves({ verbose: true })) s.add(sqIndex(m.from));
      return s;
    },
    targets(from) {
      return ch.moves({ square: sqName(from), verbose: true }).map((m) => sqIndex(m.to));
    },
    play(from, to) {
      const m = ch.move({ from: sqName(from), to: sqName(to), promotion: "q" });
      return m.captured ? val[m.captured] : 0;
    },
    reply(level) {
      const { depth, noise } = LEVELS.chess[level];
      const best = chessBest(ch.fen(), depth, noise);
      if (!best) return null;
      let m;
      try {
        m = ch.move(best);
      } catch {
        // não deve acontecer (o motor só escolhe lances legais); se acontecer, qualquer um legal
        const any = ch.moves({ verbose: true })[0];
        if (!any) return null;
        m = ch.move(any);
      }
      return [sqIndex(m.from), sqIndex(m.to), m.captured ? val[m.captured] : 0];
    },
    over() {
      if (ch.isCheckmate()) return ch.turn() === "w" ? "won" : "lost";
      if (ch.isDraw() || ch.isStalemate()) return "draw";
      return null;
    },
    check() {
      if (!ch.isCheck()) return null;
      return ch.turn() === "b" ? "eddy" : "me";
    },
    balance() {
      return -material(ch.fen()) / 100;
    },
    context() {
      const lance = Math.ceil(ch.history().length / 2);
      const b = Math.round(this.balance());
      const placar = b > 0 ? `você (Eddy) está ${b} pontos na frente` : b < 0 ? `a pessoa está ${-b} pontos na frente` : "material empatado";
      return `Vocês estão jogando XADREZ agora (a pessoa de brancas, você de pretas), lance ${lance}; ${placar}${ch.isCheck() ? "; há um xeque" : ""}.`;
    },
  };
}

function checkersRules(): Rules {
  let b = ck.initialBoard();
  let turn: ck.Side = 1;
  let quiet = 0; // lances seguidos sem captura nem pedra andando (empate em 40)
  const apply = (m: ck.CMove) => {
    const pedra = Math.abs(b[m.from]) === 1;
    b = ck.applyMove(b, m);
    quiet = m.captured.length || pedra ? 0 : quiet + 1;
    turn = -turn as ck.Side;
    return m.captured.length;
  };
  return {
    piece(i) {
      const p = b[i];
      if (!p) return null;
      return { cls: `disc ${p > 0 ? "me" : "eddy"}${Math.abs(p) === 2 ? " king" : ""}`, glyph: Math.abs(p) === 2 ? "♛︎" : "" };
    },
    sources() {
      return new Set(turn === 1 ? ck.legalMoves(b, 1).map((m) => m.from) : []);
    },
    targets(from) {
      return ck.legalMoves(b, 1).filter((m) => m.from === from).map((m) => m.to);
    },
    play(from, to) {
      const m = ck.legalMoves(b, 1).find((x) => x.from === from && x.to === to);
      return m ? apply(m) : 0;
    },
    reply(level) {
      const { depth, noise } = LEVELS.checkers[level];
      const m = ck.bestMove(b, -1, depth, noise);
      if (!m) return null;
      const from = m.from;
      return [from, m.to, apply(m)];
    },
    over() {
      if (quiet >= 40) return "draw";
      if (!ck.legalMoves(b, turn).length) return turn === 1 ? "won" : "lost";
      return null;
    },
    check: () => null,
    balance() {
      return ck.count(b, -1) - ck.count(b, 1);
    },
    context() {
      const bal = this.balance();
      const placar = bal > 0 ? `você (Eddy) está ${bal} pontos na frente` : bal < 0 ? `a pessoa está ${-bal} pontos na frente` : "empatados em peças";
      return `Vocês estão jogando DAMAS agora (a pessoa de brancas, você de pretas); ${placar}.`;
    },
  };
}

const TITLE: Record<BoardKind, string> = { chess: "Xadrez", checkers: "Damas" };
const BIG: Record<BoardKind, number> = { chess: 3, checkers: 2 }; // captura que merece comentário

export class GameView implements GameSession {
  readonly el: HTMLElement;
  private rules: Rules;
  private cells: HTMLButtonElement[] = [];
  private selected = -1;
  private last: number[] = [];
  private busy = false;
  private done = false;
  private plies = 0;
  private quietPlies = 0; // lances do Eddy sem comentário
  private saidLosing = false;
  private closed = false;
  private banner: HTMLElement;
  level: Level = "normal";

  constructor(readonly kind: BoardKind, private host: GameHost) {
    this.rules = kind === "chess" ? chessRules() : checkersRules();
    const grid = h("div", { class: `board ${kind}` });
    for (let i = 0; i < 64; i++) {
      const light = ((i >> 3) + (i & 7)) % 2 === 0;
      const cell = h("button", { type: "button", class: `sq ${light ? "l" : "d"}`, "aria-label": sqName(i) }) as HTMLButtonElement;
      cell.addEventListener("click", () => this.click(i));
      this.cells.push(cell);
      grid.append(cell);
    }
    const levels = levelPicker(this.level, (l) => (this.level = l));
    this.banner = h("div", { class: "game-banner" });
    this.el = h(
      "div",
      { class: "game" },
      h("header", { class: "panel-head" }, h("b", {}, TITLE[kind]), h("span", { class: "who" }, "você (brancas) × Eddy"), h("div", { class: "grow" }), levels),
      h("div", { class: "board-wrap" }, grid, this.banner),
    );
    this.render();
  }

  /** O estado da partida para o modelo saber do que a pessoa está falando. */
  context(): string {
    return this.done ? "" : this.rules.context();
  }

  /** Andou alguma coisa? (para o "fugiu com medo" só valer numa partida de verdade) */
  get started() {
    return this.plies > 1 && !this.done;
  }

  close() {
    this.closed = true;
  }

  private render() {
    const sources = this.busy || this.done ? new Set<number>() : this.rules.sources();
    const targets = this.selected >= 0 ? new Set(this.rules.targets(this.selected)) : new Set<number>();
    for (let i = 0; i < 64; i++) {
      const cell = this.cells[i];
      const p = this.rules.piece(i);
      cell.replaceChildren(...(p ? [h("span", { class: `pc ${p.cls}` }, p.glyph)] : []));
      cell.classList.toggle("can", sources.has(i));
      cell.classList.toggle("sel", i === this.selected);
      cell.classList.toggle("tgt", targets.has(i));
      cell.classList.toggle("last", this.last.includes(i));
    }
  }

  private click(i: number) {
    if (this.busy || this.done || this.closed) return;
    if (this.selected >= 0 && this.rules.targets(this.selected).includes(i)) {
      const took = this.rules.play(this.selected, i);
      this.last = [this.selected, i];
      this.selected = -1;
      this.plies++;
      this.render();
      void this.afterMine(took);
      return;
    }
    this.selected = this.rules.sources().has(i) && i !== this.selected ? i : -1;
    this.render();
  }

  private async afterMine(took: number) {
    if (this.finish()) return;
    if (took >= BIG[this.kind] && Math.random() < 0.6) this.host.comment("g_lost_piece");
    else if (this.rules.check() === "eddy" && Math.random() < 0.5) this.host.comment("g_in_check");
    this.busy = true;
    this.render();
    this.host.thinking(true);
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 30)); // deixa a tela desenhar o lance antes de pensar
    const mv = this.closed ? null : this.rules.reply(this.level);
    await new Promise((r) => setTimeout(r, Math.max(0, 650 + Math.random() * 600 - (performance.now() - t0))));
    this.host.thinking(false);
    if (this.closed) return;
    this.busy = false;
    if (mv) {
      this.last = [mv[0], mv[1]];
      this.plies++;
    }
    this.render();
    if (this.finish()) return;
    this.quietPlies++;
    const said = (pool: string) => {
      this.host.comment(pool);
      this.quietPlies = 0;
    };
    if (mv && mv[2] >= BIG[this.kind] && Math.random() < 0.6) said("g_took");
    else if (this.rules.check() === "me" && Math.random() < 0.7) said("g_check");
    else if (!this.saidLosing && this.rules.balance() <= -BIG[this.kind] - 2) {
      this.saidLosing = true;
      said("g_losing");
    } else if (this.quietPlies >= 5 && Math.random() < 0.35) said("g_taunt");
  }

  private finish(): boolean {
    const o = this.rules.over();
    if (!o) return false;
    this.done = true;
    this.render();
    endBanner(this.banner, o, () => this.restart());
    this.host.end(o);
    return true;
  }

  restart() {
    this.rules = this.kind === "chess" ? chessRules() : checkersRules();
    this.done = false;
    this.busy = false;
    this.selected = -1;
    this.last = [];
    this.plies = 0;
    this.quietPlies = 0;
    this.saidLosing = false;
    clearBanner(this.banner);
    this.render();
  }
}
