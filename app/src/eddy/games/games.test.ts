import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { bestMove as chessBest, material } from "./chess";
import { applyMove, bestMove, initialBoard, legalMoves, type Board } from "./checkers";

const at = (r: number, c: number) => r * 8 + c;
const empty = (): Board => new Array(64).fill(0);

describe("damas (regras brasileiras)", () => {
  it("começa com 12 pedras de cada lado e 7 lances para as brancas", () => {
    const b = initialBoard();
    expect(b.filter((p) => p === 1)).toHaveLength(12);
    expect(b.filter((p) => p === -1)).toHaveLength(12);
    expect(legalMoves(b, 1)).toHaveLength(7);
  });

  it("captura é obrigatória", () => {
    const b = empty();
    b[at(5, 2)] = 1;
    b[at(4, 3)] = -1;
    b[at(6, 7)] = 1; // tem lance simples, mas não pode
    const moves = legalMoves(b, 1);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: at(5, 2), to: at(3, 4), captured: [at(4, 3)] });
  });

  it("pedra captura para trás", () => {
    const b = empty();
    b[at(3, 2)] = 1;
    b[at(4, 3)] = -1;
    expect(legalMoves(b, 1)[0]).toMatchObject({ to: at(5, 4), captured: [at(4, 3)] });
  });

  it("lei da maioria: só a sequência que leva mais peças", () => {
    const b = empty();
    b[at(7, 0)] = 1;
    b[at(6, 1)] = -1; // 1 peça: 7,0 → 5,2 → e daí 4,3 → 3,4
    b[at(4, 3)] = -1;
    b[at(2, 5)] = 1;
    b[at(1, 6)] = -1; // outra pedra só leva 1
    const moves = legalMoves(b, 1);
    expect(moves.every((m) => m.captured.length === 2)).toBe(true);
    expect(moves[0]).toMatchObject({ from: at(7, 0), to: at(3, 4) });
  });

  it("dama voa: captura de longe e pousa em qualquer casa depois", () => {
    const b = empty();
    b[at(7, 0)] = 2;
    b[at(3, 4)] = -1;
    const tos = legalMoves(b, 1).map((m) => m.to).sort((x, y) => x - y);
    expect(tos).toEqual([at(0, 7), at(1, 6), at(2, 5)].sort((x, y) => x - y));
  });

  it("não pula a mesma peça duas vezes", () => {
    const b = empty();
    b[at(4, 3)] = 2;
    b[at(3, 4)] = -1;
    for (const m of legalMoves(b, 1)) expect(new Set(m.captured).size).toBe(m.captured.length);
  });

  it("vira dama só terminando na última fileira", () => {
    const b = empty();
    b[at(1, 2)] = 1;
    const n = applyMove(b, legalMoves(b, 1)[0]);
    expect(n.filter((p) => p === 2)).toHaveLength(1);
  });

  it("o Eddy pega a peça que está dando sopa", () => {
    const b = empty();
    b[at(2, 3)] = -1;
    b[at(3, 4)] = 1;
    b[at(7, 0)] = 1;
    const m = bestMove(b, -1, 4);
    expect(m?.captured).toEqual([at(3, 4)]);
  });
});

describe("xadrez: o motor do Eddy", () => {
  it("pega a dama de graça", () => {
    // dama branca em d5 sem defesa, peão preto em e6 captura
    const m = chessBest("rnb1kbnr/pppp1ppp/4p3/3Q4/8/8/PPPP1PPP/RNB1KBNR b KQkq - 0 3", 2);
    expect(m).toEqual({ from: "e6", to: "d5" });
  });

  it("acha o mate em um (mate do louco)", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2";
    const m = chessBest(fen, 2);
    const ch = new Chess(fen);
    ch.move(m!);
    expect(ch.isCheckmate()).toBe(true);
  });

  it("sem lance (levou mate) devolve null", () => {
    expect(chessBest("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3", 2)).toBeNull();
  });

  it("todo lance escolhido é legal no chess.js, partida inteira", () => {
    const ch = new Chess();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let ply = 0; ply < 80 && !ch.isGameOver(); ply++) {
      const m = chessBest(ch.fen(), 2, 60, rand);
      expect(m).not.toBeNull();
      expect(() => ch.move(m!)).not.toThrow();
    }
  });

  it("material conta do ponto de vista das brancas", () => {
    expect(material("4k3/8/8/8/8/8/8/3QK3 w - - 0 1")).toBe(900);
  });
});
