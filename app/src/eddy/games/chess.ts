// Xadrez: as REGRAS da partida são do chess.js (xeque, roque, en passant,
// empates). O Eddy PENSA com um motor próprio e enxuto — o chess.js gera os
// lances legais testando cada um e fica lento demais para uma busca.
//
// O motor: tabuleiro 0x88, negamax com poda alfa-beta, material + tabelas de
// casas, e capturas no fim da busca (quiescência) para ele não entregar a dama
// no último lance que viu. Ele não roca, não captura en passant e só promove a
// dama: assim todo lance que ele escolhe também é legal no chess.js, só que com
// menos opções. Para um Eddy de sala de estar, sobra.

export interface ChessMove {
  from: string;
  to: string;
  promotion?: string;
}

const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
export const VALUE = [0, 100, 320, 330, 500, 900, 0];
const LETTER: Record<string, number> = { p: P, n: N, b: B, r: R, q: Q, k: K };

// tabelas do ponto de vista das brancas, da 8ª fileira para a 1ª (índice linha*8 + coluna)
const PST: number[][] = [
  [],
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
];

const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
const DIAG = [-17, -15, 15, 17];
const ORTHO = [-16, -1, 1, 16];
const ALL = [...DIAG, ...ORTHO];

const off = (sq: number) => (sq & 0x88) !== 0;
const idx64 = (sq: number) => (sq >> 4) * 8 + (sq & 7);
const name = (sq: number) => "abcdefgh"[sq & 7] + String(8 - (sq >> 4));

class Engine {
  b = new Int8Array(128); // +branca / −preta; 0x88: linha 0 = 8ª fileira
  side = 1;
  nodes = 0;

  constructor(fen: string) {
    const [placement, turn] = fen.split(" ");
    let r = 0;
    let c = 0;
    for (const ch of placement) {
      if (ch === "/") {
        r++;
        c = 0;
      } else if (/\d/.test(ch)) c += Number(ch);
      else {
        const t = LETTER[ch.toLowerCase()];
        this.b[r * 16 + c] = ch === ch.toLowerCase() ? -t : t;
        c++;
      }
    }
    this.side = turn === "b" ? -1 : 1;
  }

  attacked(sq: number, by: number): boolean {
    const b = this.b;
    // peões: um peão branco ataca para cima (−16±1)
    const pd = by === 1 ? 16 : -16;
    for (const d of [pd - 1, pd + 1]) {
      const s = sq + d;
      if (!off(s) && b[s] === by * P) return true;
    }
    for (const d of KNIGHT) {
      const s = sq + d;
      if (!off(s) && b[s] === by * N) return true;
    }
    for (const d of ALL) {
      const s = sq + d;
      if (!off(s) && b[s] === by * K) return true;
    }
    for (const d of DIAG) {
      for (let s = sq + d; !off(s); s += d) {
        const p = b[s];
        if (p) {
          if (p === by * B || p === by * Q) return true;
          break;
        }
      }
    }
    for (const d of ORTHO) {
      for (let s = sq + d; !off(s); s += d) {
        const p = b[s];
        if (p) {
          if (p === by * R || p === by * Q) return true;
          break;
        }
      }
    }
    return false;
  }

  king(side: number): number {
    for (let s = 0; s < 128; s++) if (!off(s) && this.b[s] === side * K) return s;
    return -1;
  }

  inCheck(side: number) {
    const k = this.king(side);
    return k >= 0 && this.attacked(k, -side);
  }

  /** Lances pseudo-legais: [de, para, pontuação de ordem] achatados. */
  gen(capturesOnly: boolean): number[] {
    const b = this.b;
    const side = this.side;
    const out: number[] = [];
    const add = (from: number, to: number) => {
      const cap = b[to];
      if (capturesOnly && !cap && !(Math.abs(b[from]) === P && (to >> 4 === 0 || to >> 4 === 7))) return;
      const score = cap ? 10 * VALUE[Math.abs(cap)] - VALUE[Math.abs(b[from])] + 10000 : 0;
      out.push(from, to, score);
    };
    for (let s = 0; s < 128; s++) {
      if (off(s)) {
        s += 7;
        continue;
      }
      const p = b[s] * side;
      if (p <= 0) continue;
      if (p === P) {
        const fwd = side === 1 ? -16 : 16;
        const start = side === 1 ? 6 : 1;
        const one = s + fwd;
        if (!off(one) && !b[one]) {
          add(s, one);
          const two = one + fwd;
          if (s >> 4 === start && !b[two]) add(s, two);
        }
        for (const d of [fwd - 1, fwd + 1]) {
          const t = s + d;
          if (!off(t) && b[t] * side < 0) add(s, t);
        }
      } else if (p === N || p === K) {
        for (const d of p === N ? KNIGHT : ALL) {
          const t = s + d;
          if (!off(t) && b[t] * side <= 0) add(s, t);
        }
      } else {
        for (const d of p === B ? DIAG : p === R ? ORTHO : ALL) {
          for (let t = s + d; !off(t); t += d) {
            if (b[t] * side > 0) break;
            add(s, t);
            if (b[t]) break;
          }
        }
      }
    }
    return out;
  }

  /** Faz o lance; devolve a peça capturada (para desfazer). Peão na última fileira vira dama. */
  make(from: number, to: number): number {
    const b = this.b;
    const cap = b[to];
    const p = b[from];
    b[to] = Math.abs(p) === P && (to >> 4 === 0 || to >> 4 === 7) ? Math.sign(p) * Q : p;
    b[from] = 0;
    this.side = -this.side;
    return cap;
  }

  unmake(from: number, to: number, cap: number, piece: number) {
    this.b[from] = piece;
    this.b[to] = cap;
    this.side = -this.side;
  }

  evaluate(): number {
    let s = 0;
    const b = this.b;
    for (let sq = 0; sq < 128; sq++) {
      if (off(sq)) {
        sq += 7;
        continue;
      }
      const p = b[sq];
      if (!p) continue;
      const t = Math.abs(p);
      const i = idx64(sq);
      s += p > 0 ? VALUE[t] + PST[t][i] : -(VALUE[t] + PST[t][(7 - (i >> 3)) * 8 + (i & 7)]);
    }
    return s * this.side;
  }

  private sorted(capturesOnly: boolean): number[][] {
    const flat = this.gen(capturesOnly);
    const moves: number[][] = [];
    for (let i = 0; i < flat.length; i += 3) moves.push([flat[i], flat[i + 1], flat[i + 2]]);
    return moves.sort((a, b) => b[2] - a[2]);
  }

  quiesce(alpha: number, beta: number, depth: number): number {
    this.nodes++;
    const stand = this.evaluate();
    if (depth <= 0 || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    for (const [from, to] of this.sorted(true)) {
      const piece = this.b[from];
      const cap = this.make(from, to);
      if (this.inCheck(-this.side)) {
        this.unmake(from, to, cap, piece);
        continue;
      }
      const v = -this.quiesce(-beta, -alpha, depth - 1);
      this.unmake(from, to, cap, piece);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  search(depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    if (depth <= 0) return this.quiesce(alpha, beta, 4);
    let legal = 0;
    let best = -Infinity;
    for (const [from, to] of this.sorted(false)) {
      const piece = this.b[from];
      const cap = this.make(from, to);
      if (this.inCheck(-this.side)) {
        this.unmake(from, to, cap, piece);
        continue;
      }
      legal++;
      const v = -this.search(depth - 1, -beta, -alpha, ply + 1);
      this.unmake(from, to, cap, piece);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (!legal) return this.inCheck(this.side) ? -100000 + ply : 0;
    return best;
  }

  root(depth: number, noise: number, rand: () => number): ChessMove | null {
    let best: number[] | null = null;
    let bestV = -Infinity;
    let alpha = -Infinity;
    for (const [from, to] of this.sorted(false)) {
      const piece = this.b[from];
      const cap = this.make(from, to);
      if (this.inCheck(-this.side)) {
        this.unmake(from, to, cap, piece);
        continue;
      }
      // com ruído a raiz não poda: o valor de cada lance importa para o sorteio
      const v = -this.search(depth - 1, -Infinity, noise ? Infinity : -alpha, 1) + (rand() - 0.5) * 2 * noise;
      this.unmake(from, to, cap, piece);
      if (v > bestV) {
        bestV = v;
        best = [from, to];
      }
      if (!noise && v > alpha) alpha = v;
    }
    if (!best) return null;
    const [from, to] = best;
    const promo = Math.abs(this.b[from]) === P && (to >> 4 === 0 || to >> 4 === 7);
    return { from: name(from), to: name(to), ...(promo ? { promotion: "q" } : {}) };
  }
}

/** O lance do Eddy na posição `fen`. `noise` (centipeões) faz ele errar de propósito. */
export function bestMove(fen: string, depth: number, noise = 0, rand = Math.random): ChessMove | null {
  return new Engine(fen).root(depth, noise, rand);
}

/** Material das brancas menos o das pretas, em centipeões, direto do FEN. */
export function material(fen: string): number {
  let s = 0;
  for (const ch of fen.split(" ")[0]) {
    const t = LETTER[ch.toLowerCase()];
    if (t) s += (ch === ch.toLowerCase() ? -1 : 1) * VALUE[t];
  }
  return s;
}
