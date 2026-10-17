// Damas, regras brasileiras (as internacionais num tabuleiro 8×8):
//   - a pedra anda uma casa na diagonal para a frente e captura para a frente e
//     para trás; a dama "voa": anda e captura a qualquer distância na diagonal;
//   - capturar é obrigatório, e vale a LEI DA MAIORIA: entre as capturas
//     possíveis, só as que levam mais peças;
//   - as peças capturadas só saem no fim do lance (não dá para pular a mesma
//     duas vezes, e elas bloqueiam o caminho até lá);
//   - a pedra só vira dama se o lance TERMINAR na última fileira.
//
// Casa = índice 0…63 (linha*8 + coluna), linha 0 em cima. Só as casas escuras
// ((linha + coluna) ímpar) são usadas. A pessoa (+1) começa embaixo e sobe; o
// Eddy (−1) começa em cima. Peça: ±1 pedra, ±2 dama, 0 vazio.

export type Side = 1 | -1;
export type Board = number[];

export interface CMove {
  from: number;
  to: number;
  /** casas por onde a peça pousa, do começo ao fim (inclui from e to) */
  path: number[];
  captured: number[];
}

const DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const dark = (i: number) => ((i >> 3) + (i & 7)) % 2 === 1;

export function initialBoard(): Board {
  const b: Board = new Array(64).fill(0);
  for (let i = 0; i < 64; i++) {
    if (!dark(i)) continue;
    const r = i >> 3;
    if (r <= 2) b[i] = -1;
    else if (r >= 5) b[i] = 1;
  }
  return b;
}

const sideOf = (p: number): Side | 0 => (p > 0 ? 1 : p < 0 ? -1 : 0);

/** Todas as sequências de captura a partir de `from` (sem filtrar a maioria). */
function captures(b: Board, from: number): CMove[] {
  const piece = b[from];
  const side = sideOf(piece) as Side;
  const king = Math.abs(piece) === 2;
  const out: CMove[] = [];

  const walk = (at: number, path: number[], taken: number[]) => {
    let extended = false;
    const r0 = at >> 3;
    const c0 = at & 7;
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr;
      let c = c0 + dc;
      if (king) {
        // voa por casas vazias até a primeira peça
        while (inside(r, c) && (b[r * 8 + c] === 0 || r * 8 + c === from)) {
          r += dr;
          c += dc;
        }
      }
      if (!inside(r, c)) continue;
      const mid = r * 8 + c;
      if (sideOf(b[mid]) !== -side || taken.includes(mid)) continue;
      // pousos depois da peça capturada
      let lr = r + dr;
      let lc = c + dc;
      while (inside(lr, lc)) {
        const land = lr * 8 + lc;
        if (b[land] !== 0 && land !== from) break;
        extended = true;
        walk(land, [...path, land], [...taken, mid]);
        if (!king) break;
        lr += dr;
        lc += dc;
      }
    }
    if (!extended && taken.length) out.push({ from, to: at, path, captured: taken });
  };

  walk(from, [from], []);
  return out;
}

function simpleMoves(b: Board, from: number): CMove[] {
  const piece = b[from];
  const side = sideOf(piece) as Side;
  const king = Math.abs(piece) === 2;
  const out: CMove[] = [];
  const r0 = from >> 3;
  const c0 = from & 7;
  for (const [dr, dc] of DIRS) {
    if (!king && dr !== -side) continue; // pedra só para a frente
    let r = r0 + dr;
    let c = c0 + dc;
    while (inside(r, c) && b[r * 8 + c] === 0) {
      out.push({ from, to: r * 8 + c, path: [from, r * 8 + c], captured: [] });
      if (!king) break;
      r += dr;
      c += dc;
    }
  }
  return out;
}

/** Os lances legais de `side`: capturas máximas se houver alguma, senão os simples. */
export function legalMoves(b: Board, side: Side): CMove[] {
  let caps: CMove[] = [];
  for (let i = 0; i < 64; i++) if (sideOf(b[i]) === side) caps = caps.concat(captures(b, i));
  if (caps.length) {
    const most = Math.max(...caps.map((m) => m.captured.length));
    return caps.filter((m) => m.captured.length === most);
  }
  let out: CMove[] = [];
  for (let i = 0; i < 64; i++) if (sideOf(b[i]) === side) out = out.concat(simpleMoves(b, i));
  return out;
}

/** Aplica o lance numa cópia do tabuleiro. */
export function applyMove(b: Board, m: CMove): Board {
  const n = b.slice();
  const piece = n[m.from];
  n[m.from] = 0;
  for (const c of m.captured) n[c] = 0;
  const lastRow = piece > 0 ? 0 : 7;
  n[m.to] = Math.abs(piece) === 1 && m.to >> 3 === lastRow ? piece * 2 : piece;
  return n;
}

export const count = (b: Board, side: Side) => b.reduce((s, p) => s + (sideOf(p) === side ? Math.abs(p) === 2 ? 3 : 1 : 0), 0);

// ── o Eddy jogando ────────────────────────────────────────────────────────────

/** Avaliação do ponto de vista de `side`: material, dama vale 3, pedra avançada vale mais. */
export function evaluate(b: Board, side: Side): number {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const r = i >> 3;
    const c = i & 7;
    let v = Math.abs(p) === 2 ? 300 : 100;
    if (Math.abs(p) === 1) v += (p > 0 ? 7 - r : r) * 4; // avanço
    if (c >= 2 && c <= 5 && r >= 2 && r <= 5) v += 6; // centro
    if (Math.abs(p) === 1 && (p > 0 ? r === 7 : r === 0)) v += 8; // guarda da última fileira
    s += sideOf(p) === side ? v : -v;
  }
  return s;
}

function negamax(b: Board, side: Side, depth: number, alpha: number, beta: number, ply: number): number {
  const moves = legalMoves(b, side);
  if (!moves.length) return -100000 + ply; // sem lance = perdeu
  if (depth <= 0 && !moves[0].captured.length) return evaluate(b, side);
  let best = -Infinity;
  for (const m of moves) {
    const v = -negamax(applyMove(b, m), -side as Side, depth - 1, -beta, -alpha, ply + 1);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** O lance do Eddy. `noise` deixa ele errar de propósito (nível fácil). */
export function bestMove(b: Board, side: Side, depth: number, noise = 0, rand = Math.random): CMove | null {
  const moves = legalMoves(b, side);
  if (!moves.length) return null;
  let best: CMove = moves[0];
  let bestV = -Infinity;
  for (const m of moves) {
    const v = -negamax(applyMove(b, m), -side as Side, depth - 1, -Infinity, Infinity, 1) + (rand() - 0.5) * 2 * noise;
    if (v > bestV) {
      bestV = v;
      best = m;
    }
  }
  return best;
}
