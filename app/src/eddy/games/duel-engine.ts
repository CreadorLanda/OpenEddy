// Duelo de cartas do Eddy: regras e cabeça do Eddy, sem tela.
//
// Inspirado nos jogos de duelo de cartas, com cartas próprias (o mundo do
// Eddy: eletrodomésticos e tecnologia rebelde). Regras curtas para caber numa
// ligação:
//   - 4000 de vida, baralho de 20, mão inicial de 5; compra 1 por turno (quem
//     começa não compra nem ataca no primeiro turno);
//   - por turno: 1 invocação de monstro (nível 5–6 pede 1 sacrifício, 7+ pede 2),
//     magias à vontade, armadilhas preparadas viradas para baixo (até 2);
//   - batalha: cada monstro em ataque ataca uma vez. Ataque × ataque: o maior
//     destrói o menor e a diferença sai da vida do dono do menor (empate: os
//     dois saem). Ataque × defesa: passa da defesa, destrói sem dano; não passa,
//     o atacante leva a diferença. Campo vazio: ataque direto;
//   - armadilhas disparam sozinhas quando o oponente ataca;
//   - perde quem zera a vida ou precisa comprar de um baralho vazio.

export type P = 0 | 1; // 0 = a pessoa, 1 = o Eddy
export type Kind = "monster" | "spell" | "trap";
export type Pos = "atk" | "def";
export type Level = "easy" | "normal" | "hard";

export interface Card {
  id: string;
  name: string;
  kind: Kind;
  icon: string;
  text: string;
  level?: number;
  atk?: number;
  def?: number;
}

const M = (id: string, name: string, level: number, atk: number, def: number, icon: string, text: string): Card => ({ id, name, kind: "monster", level, atk, def, icon, text });
const S = (id: string, name: string, icon: string, text: string): Card => ({ id, name, kind: "spell", icon, text });
const T = (id: string, name: string, icon: string, text: string): Card => ({ id, name, kind: "trap", icon, text });

export const CARDS: Card[] = [
  M("modem", "Modem Discado Ancestral", 1, 400, 300, "📟", "Faz barulho de fax quando ataca. Ninguém sabe por quê."),
  M("drone", "Drone Fofoqueiro", 2, 900, 600, "🛸", "Viu tudo. Contou para todo mundo."),
  M("laptop", "Laptop com 1% de Bateria", 2, 1100, 200, "💻", "Vive no limite. Literalmente."),
  M("torradeira", "Torradeira com Wi-Fi", 3, 1200, 800, "🍞", "Queima o pão e vaza a sua senha."),
  M("aspirador", "Aspirador Rebelde", 3, 1000, 1400, "🧹", "Engole meias por esporte."),
  M("gato", "Gato Hacker", 3, 1300, 700, "🐱", "Anda no teclado e invade a NASA."),
  M("microondas", "Micro-ondas Furioso", 4, 1600, 1000, "♨️", "Apita às 3 da manhã de propósito."),
  M("geladeira", "Geladeira Blindada", 4, 800, 2000, "🧊", "Ninguém pega o último pudim."),
  M("robo", "Robô de Limpeza", 4, 1500, 1500, "🤖", "Limpa o chão. E o seu histórico."),
  M("impressora", "Impressora Possuída", 4, 1700, 400, "🖨️", "Atolamento de papel é um estado de espírito."),
  M("satelite", "Satélite Espião", 5, 2100, 1200, "🛰️", "Sabe onde você deixou as chaves."),
  M("muralha", "Firewall Ambulante", 5, 1000, 2600, "🧱", "Nada passa. Nem o que você queria."),
  M("servidor", "Servidor Superaquecido", 6, 2400, 1800, "🔥", "Roda tudo. Inclusive em chamas."),
  M("eddy", "Eddy Supremo", 7, 3000, 2500, "👑", "O sistema de casa mais inteligente do universo. Ele mesmo disse."),
  S("firmware", "Atualização de Firmware", "⬆️", "+600 de ATK para um monstro seu, para sempre."),
  S("reboot", "Reinicializar", "🔄", "Compre 2 cartas."),
  S("curto", "Curto-Circuito", "⚡", "Destrói um monstro do oponente com ATK 1600 ou menos."),
  S("backup", "Backup na Nuvem", "☁️", "Ganhe 1000 de vida."),
  S("formatar", "Formatar Disco", "💾", "Destrói TODOS os monstros do campo."),
  T("firewall", "Firewall", "🛡️", "Quando o oponente atacar: anula o ataque e encerra a batalha dele."),
  T("espelho", "Espelho Refletor", "🪞", "Quando o oponente atacar: destrói o monstro que atacou."),
  T("choque", "Choque Estático", "💥", "Quando o oponente atacar: anula o ataque e causa 600 de dano a ele."),
];
export const card = (id: string) => CARDS.find((c) => c.id === id)!;

export const tributesFor = (c: Card) => ((c.level ?? 0) >= 7 ? 2 : (c.level ?? 0) >= 5 ? 1 : 0);

export interface Mon {
  card: Card;
  atk: number;
  pos: Pos;
  turnPlayed: number;
  attacked: boolean;
  changed: boolean;
}

export interface Side {
  lp: number;
  deck: Card[];
  hand: Card[];
  field: (Mon | null)[];
  traps: (Card | null)[];
  summoned: boolean;
}

export type DuelEvent =
  | { type: "draw"; p: P; n: number }
  | { type: "summon"; p: P; card: Card; pos: Pos; tributes: Card[] }
  | { type: "spell"; p: P; card: Card; target?: Card }
  | { type: "set"; p: P }
  | { type: "position"; p: P; card: Card; pos: Pos }
  | { type: "phase"; p: P; phase: "battle" }
  | { type: "trap"; owner: P; card: Card; attacker: Card }
  | { type: "attack"; p: P; card: Card; target: Card | null; damage: { p: P; n: number } | null; destroyed: { p: P; card: Card }[] }
  | { type: "lp"; p: P; delta: number }
  | { type: "turn"; p: P; turnNo: number }
  | { type: "discard"; p: P; card: Card }
  | { type: "win"; p: P; why: "lp" | "deck" };

/** Baralho de 20: 12 monstros (mais dos fracos), 5 magias, 3 armadilhas. */
export function buildDeck(rand: () => number, withEddy: boolean): Card[] {
  const pick = <X>(xs: X[]) => xs[Math.floor(rand() * xs.length)];
  const mons = CARDS.filter((c) => c.kind === "monster" && c.id !== "eddy");
  const weighted = mons.flatMap((c) => Array((c.level ?? 1) <= 4 ? 3 : 1).fill(c) as Card[]);
  const deck: Card[] = [];
  const count = (id: string) => deck.filter((c) => c.id === id).length;
  while (deck.length < (withEddy ? 11 : 12)) {
    const c = pick(weighted);
    if (count(c.id) < 2) deck.push(c);
  }
  if (withEddy) deck.push(card("eddy"));
  const spells = CARDS.filter((c) => c.kind === "spell");
  while (deck.filter((c) => c.kind === "spell").length < 5) {
    const c = pick(spells);
    if (count(c.id) < (c.id === "formatar" ? 1 : 2)) deck.push(c);
  }
  const traps = CARDS.filter((c) => c.kind === "trap");
  for (let i = 0; i < 3; i++) deck.push(pick(traps));
  // embaralha
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const side = (deck: Card[]): Side => ({ lp: 4000, deck, hand: [], field: [null, null, null], traps: [null, null], summoned: false });

export class Duel {
  s: [Side, Side];
  turn: P = 0;
  turnNo = 1;
  phase: "main" | "battle" = "main";
  winner: P | null = null;

  constructor(rand: () => number = Math.random, decks?: [Card[], Card[]]) {
    const [a, b] = decks ?? [buildDeck(rand, false), buildDeck(rand, true)];
    this.s = [side(a), side(b)];
    for (const p of [0, 1] as const) this.draw(p, 5);
  }

  private draw(p: P, n: number): DuelEvent[] {
    const sd = this.s[p];
    const k = Math.min(n, sd.deck.length);
    sd.hand.push(...sd.deck.splice(0, k));
    return k ? [{ type: "draw", p, n: k }] : [];
  }

  private mine(p: P) {
    return this.winner === null && this.turn === p;
  }

  private damage(p: P, n: number): DuelEvent[] {
    if (n <= 0) return [];
    this.s[p].lp = Math.max(0, this.s[p].lp - n);
    const ev: DuelEvent[] = [{ type: "lp", p, delta: -n }];
    if (this.s[p].lp === 0 && this.winner === null) {
      this.winner = (1 - p) as P;
      ev.push({ type: "win", p: this.winner, why: "lp" });
    }
    return ev;
  }

  // ── invocar ─────────────────────────────────────────────────────────────────

  /** Dá para invocar a carta `hi` da mão? (precisa de vaga e de sacrifícios) */
  canSummon(p: P, hi: number): boolean {
    const sd = this.s[p];
    const c = sd.hand[hi];
    if (!this.mine(p) || this.phase !== "main" || !c || c.kind !== "monster" || sd.summoned) return false;
    const mons = sd.field.filter(Boolean).length;
    const need = tributesFor(c);
    return mons >= need && mons - need < 3;
  }

  summon(p: P, hi: number, pos: Pos, tributes: number[] = []): DuelEvent[] | null {
    if (!this.canSummon(p, hi)) return null;
    const sd = this.s[p];
    const c = sd.hand[hi];
    const need = tributesFor(c);
    const uniq = [...new Set(tributes)];
    if (uniq.length !== need || uniq.some((t) => !sd.field[t])) return null;
    const gone = uniq.map((t) => sd.field[t]!.card);
    for (const t of uniq) sd.field[t] = null;
    const slot = sd.field.indexOf(null);
    sd.field[slot] = { card: c, atk: c.atk!, pos, turnPlayed: this.turnNo, attacked: false, changed: true };
    sd.hand.splice(hi, 1);
    sd.summoned = true;
    return [{ type: "summon", p, card: c, pos, tributes: gone }];
  }

  togglePos(p: P, slot: number): DuelEvent[] | null {
    const m = this.s[p].field[slot];
    if (!this.mine(p) || this.phase !== "main" || !m || m.changed || m.attacked) return null;
    m.pos = m.pos === "atk" ? "def" : "atk";
    m.changed = true;
    return [{ type: "position", p, card: m.card, pos: m.pos }];
  }

  // ── magias e armadilhas ─────────────────────────────────────────────────────

  /** De quem é o alvo da magia: "own" (um monstro seu), "enemy" ou null (sem alvo). */
  static target(c: Card): "own" | "enemy" | null {
    return c.id === "firmware" ? "own" : c.id === "curto" ? "enemy" : null;
  }

  /** Os alvos válidos (vagas do campo) da magia `hi`. */
  targets(p: P, hi: number): number[] {
    const c = this.s[p].hand[hi];
    if (!c) return [];
    const t = Duel.target(c);
    if (t === "own") return this.s[p].field.flatMap((m, i) => (m ? [i] : []));
    if (t === "enemy") return this.s[1 - p].field.flatMap((m, i) => (m && m.atk <= 1600 ? [i] : []));
    return [];
  }

  canActivate(p: P, hi: number): boolean {
    const c = this.s[p].hand[hi];
    if (!this.mine(p) || this.phase !== "main" || !c || c.kind !== "spell") return false;
    if (Duel.target(c)) return this.targets(p, hi).length > 0;
    if (c.id === "reboot") return this.s[p].deck.length > 0;
    if (c.id === "formatar") return this.s.some((sd) => sd.field.some(Boolean));
    return true;
  }

  activate(p: P, hi: number, target?: number): DuelEvent[] | null {
    if (!this.canActivate(p, hi)) return null;
    const me = this.s[p];
    const foe = this.s[1 - p];
    const c = me.hand[hi];
    if (Duel.target(c) && (target === undefined || !this.targets(p, hi).includes(target))) return null;
    me.hand.splice(hi, 1);
    const ev: DuelEvent[] = [];
    if (c.id === "firmware") {
      const m = me.field[target!]!;
      m.atk += 600;
      ev.push({ type: "spell", p, card: c, target: m.card });
    } else if (c.id === "curto") {
      const m = foe.field[target!]!;
      foe.field[target!] = null;
      ev.push({ type: "spell", p, card: c, target: m.card });
    } else if (c.id === "reboot") {
      ev.push({ type: "spell", p, card: c }, ...this.draw(p, 2));
    } else if (c.id === "backup") {
      me.lp += 1000;
      ev.push({ type: "spell", p, card: c }, { type: "lp", p, delta: 1000 });
    } else if (c.id === "formatar") {
      me.field = [null, null, null];
      foe.field = [null, null, null];
      ev.push({ type: "spell", p, card: c });
    }
    return ev;
  }

  setTrap(p: P, hi: number): DuelEvent[] | null {
    const sd = this.s[p];
    const c = sd.hand[hi];
    const slot = sd.traps.indexOf(null);
    if (!this.mine(p) || this.phase !== "main" || !c || c.kind !== "trap" || slot < 0) return null;
    sd.traps[slot] = c;
    sd.hand.splice(hi, 1);
    return [{ type: "set", p }];
  }

  // ── batalha ─────────────────────────────────────────────────────────────────

  canBattle(p: P) {
    return this.mine(p) && this.phase === "main" && this.turnNo > 1;
  }

  toBattle(p: P): DuelEvent[] | null {
    if (!this.canBattle(p)) return null;
    this.phase = "battle";
    return [{ type: "phase", p, phase: "battle" }];
  }

  canAttack(p: P, slot: number): boolean {
    const m = this.s[p].field[slot];
    return this.mine(p) && this.phase === "battle" && !!m && m.pos === "atk" && !m.attacked;
  }

  attack(p: P, slot: number, target: number | "direct"): DuelEvent[] | null {
    if (!this.canAttack(p, slot)) return null;
    const me = this.s[p];
    const q = (1 - p) as P;
    const foe = this.s[q];
    if (target === "direct" ? foe.field.some(Boolean) : !foe.field[target]) return null;
    const a = me.field[slot]!;
    a.attacked = true;
    const ev: DuelEvent[] = [];

    // armadilha do defensor dispara sozinha
    const ti = foe.traps.findIndex(Boolean);
    if (ti >= 0) {
      const trap = foe.traps[ti]!;
      foe.traps[ti] = null;
      ev.push({ type: "trap", owner: q, card: trap, attacker: a.card });
      if (trap.id === "firewall") {
        for (const m of me.field) if (m) m.attacked = true;
        return ev;
      }
      if (trap.id === "espelho") {
        me.field[slot] = null;
        return ev;
      }
      if (trap.id === "choque") return [...ev, ...this.damage(p, 600)];
    }

    if (target === "direct") {
      ev.push({ type: "attack", p, card: a.card, target: null, damage: { p: q, n: a.atk }, destroyed: [] });
      return [...ev, ...this.damage(q, a.atk)];
    }
    const d = foe.field[target]!;
    const destroyed: { p: P; card: Card }[] = [];
    let dmg: { p: P; n: number } | null = null;
    if (d.pos === "atk") {
      if (a.atk > d.atk) {
        foe.field[target] = null;
        destroyed.push({ p: q, card: d.card });
        dmg = { p: q, n: a.atk - d.atk };
      } else if (a.atk < d.atk) {
        me.field[slot] = null;
        destroyed.push({ p, card: a.card });
        dmg = { p, n: d.atk - a.atk };
      } else {
        foe.field[target] = null;
        me.field[slot] = null;
        destroyed.push({ p: q, card: d.card }, { p, card: a.card });
      }
    } else {
      const def = d.card.def!;
      if (a.atk > def) {
        foe.field[target] = null;
        destroyed.push({ p: q, card: d.card });
      } else if (a.atk < def) dmg = { p, n: def - a.atk };
    }
    ev.push({ type: "attack", p, card: a.card, target: d.card, damage: dmg, destroyed });
    if (dmg) ev.push(...this.damage(dmg.p, dmg.n));
    return ev;
  }

  // ── turno ───────────────────────────────────────────────────────────────────

  endTurn(p: P): DuelEvent[] | null {
    if (!this.mine(p)) return null;
    const ev: DuelEvent[] = [];
    const me = this.s[p];
    while (me.hand.length > 6) ev.push({ type: "discard", p, card: me.hand.shift()! });
    const q = (1 - p) as P;
    this.turn = q;
    this.turnNo++;
    this.phase = "main";
    const next = this.s[q];
    next.summoned = false;
    for (const m of next.field) if (m) (m.attacked = false), (m.changed = false);
    ev.push({ type: "turn", p: q, turnNo: this.turnNo });
    if (!next.deck.length) {
      this.winner = p;
      ev.push({ type: "win", p, why: "deck" });
      return ev;
    }
    ev.push(...this.draw(q, 1));
    return ev;
  }
}

// ── o Eddy duelando ───────────────────────────────────────────────────────────

const value = (m: Mon) => (m.pos === "atk" ? m.atk : m.card.def!);

/**
 * Um passo do Eddy no turno dele: faz UMA coisa e devolve os eventos, ou null
 * quando já não tem nada a fazer (aí a tela encerra o turno). Um passo por vez
 * para a tela mostrar cada jogada com calma.
 */
export function eddyStep(d: Duel, level: Level, rand: () => number = Math.random): DuelEvent[] | null {
  const p: P = 1;
  if (d.winner !== null || d.turn !== p) return null;
  const me = d.s[1];
  const foe = d.s[0];
  const sloppy = level === "easy" ? 0.3 : level === "normal" ? 0.08 : 0;
  const foeMons = foe.field.filter((m): m is Mon => !!m);
  const myMons = me.field.filter((m): m is Mon => !!m);
  const foeBest = Math.max(0, ...foeMons.map((m) => (m.pos === "atk" ? m.atk : 0)));

  if (d.phase === "main") {
    // magias
    for (let hi = 0; hi < me.hand.length; hi++) {
      const c = me.hand[hi];
      if (c.kind !== "spell" || !d.canActivate(p, hi)) continue;
      if (c.id === "backup" && me.lp <= 2500) return d.activate(p, hi);
      if (c.id === "reboot" && me.hand.length <= 4) return d.activate(p, hi);
      if (c.id === "curto") {
        const ts = d.targets(p, hi);
        const best = ts.sort((x, y) => value(foe.field[y]!) - value(foe.field[x]!))[0];
        return d.activate(p, hi, best);
      }
      if (c.id === "formatar") {
        const theirs = foeMons.reduce((s, m) => s + value(m), 0);
        const ours = myMons.reduce((s, m) => s + value(m), 0);
        if (foeMons.length >= 2 && theirs >= ours + 1200) return d.activate(p, hi);
      }
      if (c.id === "firmware" && myMons.length) {
        const ts = d.targets(p, hi);
        const best = ts.sort((x, y) => me.field[y]!.atk - me.field[x]!.atk)[0];
        if (me.field[best]!.atk <= foeBest + 600 || rand() < 0.4) return d.activate(p, hi, best);
      }
    }
    // invocação: o melhor monstro que dá para pôr, sacrificando os mais fracos
    if (!me.summoned) {
      const options = me.hand
        .map((c, hi) => ({ c, hi }))
        .filter(({ hi }) => d.canSummon(p, hi))
        .map(({ c, hi }) => {
          const need = tributesFor(c);
          const weakest = me.field
            .map((m, i) => ({ m, i }))
            .filter((x): x is { m: Mon; i: number } => !!x.m)
            .sort((x, y) => value(x.m) - value(y.m))
            .slice(0, need);
          const lost = weakest.reduce((s, x) => s + value(x.m), 0);
          return { c, hi, tributes: weakest.map((x) => x.i), score: Math.max(c.atk!, c.def!) - lost * 0.9 };
        })
        .filter((o) => o.score > 0 || tributesFor(o.c) === 0)
        .sort((x, y) => y.score - x.score);
      if (options.length) {
        const o = rand() < sloppy ? options[Math.floor(rand() * options.length)] : options[0];
        const pos: Pos = o.c.atk! >= foeBest || o.c.atk! >= o.c.def! ? "atk" : "def";
        const ev = d.summon(p, o.hi, pos, o.tributes);
        if (ev) return ev;
      }
    }
    // armadilhas
    const trap = me.hand.findIndex((c) => c.kind === "trap");
    if (trap >= 0 && me.traps.includes(null)) return d.setTrap(p, trap);
    // um defensor que agora ganha de todo mundo vai para o ataque
    for (let i = 0; i < 3; i++) {
      const m = me.field[i];
      if (m && m.pos === "def" && !m.changed && m.atk > foeBest && m.turnPlayed < d.turnNo) return d.togglePos(p, i);
    }
    if (d.canBattle(p) && me.field.some((m) => m && m.pos === "atk" && !m.attacked)) return d.toBattle(p);
    return null;
  }

  // batalha: o melhor alvo para cada atacante, sem suicídio (a não ser no fácil)
  for (let i = 0; i < 3; i++) {
    if (!d.canAttack(p, i)) continue;
    const a = me.field[i]!;
    if (!foeMons.length) return d.attack(p, i, "direct");
    let best = -1;
    let bestScore = 0;
    foe.field.forEach((m, j) => {
      if (!m) return;
      const wins = m.pos === "atk" ? a.atk > m.atk : a.atk > m.card.def!;
      const score = wins ? value(m) + (m.pos === "atk" ? a.atk - m.atk : 0) : 0;
      if (score > bestScore) (bestScore = score), (best = j);
    });
    if (best < 0 && rand() < sloppy) best = foe.field.findIndex(Boolean);
    if (best >= 0) return d.attack(p, i, best);
    a.attacked = true; // sem ataque bom: este fica parado
  }
  return null;
}
