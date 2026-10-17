import { describe, expect, it } from "vitest";
import { FightSim, MOVES, type Input } from "./fight-sim";
import { card, Duel, eddyStep, type Card, type P } from "./duel-engine";

const idle: Input = { left: false, right: false, block: false };
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Uma luta parada: os dois perto, o Eddy sem pensar (decisão sempre no futuro). */
function closeFight() {
  const s = new FightSim("normal", () => 0.99);
  s.hold = 0;
  s.f[0].x = 360;
  s.f[1].x = 420;
  (s as unknown as { ai: { next: number } }).ai.next = 1e9;
  return s;
}

describe("luta", () => {
  it("o soco acerta de perto e tira 6", () => {
    const s = closeFight();
    s.step(1 / 60, { ...idle, punch: true });
    for (let i = 0; i < 20; i++) s.step(1 / 60, idle);
    expect(s.f[1].hp).toBe(100 - MOVES.punch.dmg);
  });

  it("de longe não acerta", () => {
    const s = closeFight();
    s.f[1].x = 700;
    s.step(1 / 60, { ...idle, punch: true });
    for (let i = 0; i < 20; i++) s.step(1 / 60, idle);
    expect(s.f[1].hp).toBe(100);
  });

  it("defender segura 80% do dano", () => {
    const s = closeFight();
    s.f[1].state = "block";
    s.f[1].facing = -1;
    const keep = (s as unknown as { ai: { input: Input } }).ai;
    keep.input = { ...idle, block: true };
    s.step(1 / 60, { ...idle, kick: true });
    for (let i = 0; i < 30; i++) s.step(1 / 60, idle);
    expect(s.f[1].hp).toBe(100 - Math.round(MOVES.kick.dmg * 0.2));
  });

  it("super força só com a energia cheia", () => {
    const s = closeFight();
    s.step(1 / 60, { ...idle, special: true });
    expect(s.f[0].state).not.toBe("special");
    s.f[0].energy = 100;
    s.step(1 / 60, { ...idle, special: true });
    expect(s.f[0].state).toBe("special");
    expect(s.f[0].energy).toBeLessThan(1); // gastou tudo (a energia volta a encher devagar)
  });

  it("nocaute fecha o round e melhor de 3 fecha a luta", () => {
    const s = closeFight();
    const evs = [];
    for (let r = 0; r < 2; r++) {
      s.f[1].hp = 1;
      s.f[0].x = s.f[1].x - 60;
      s.f[0].facing = 1;
      (s as unknown as { ai: { next: number } }).ai.next = 1e9;
      s.step(1 / 60, { ...idle, punch: true });
      for (let i = 0; i < 400 && !s.over; i++) {
        evs.push(...s.step(1 / 60, idle));
        if (s.hold <= 0 && s.round > r + 1) break;
      }
      s.hold = 0;
    }
    expect(s.wins[0]).toBe(2);
    expect(s.over).toBe(true);
    expect(s.winner).toBe(0);
  });

  it("o Eddy luta sozinho uma partida inteira sem travar", () => {
    for (const level of ["easy", "normal", "hard"] as const) {
      const s = new FightSim(level, seeded(42));
      for (let i = 0; i < 60 * 60 * 6 && !s.over; i++) s.step(1 / 60, idle);
      expect(s.over).toBe(true);
      expect(s.winner).toBe(1); // contra quem não faz nada, ele ganha
    }
  });
});

describe("duelo de cartas", () => {
  const deck = (...ids: string[]): Card[] => [...ids.map(card), ...Array(20).fill(card("modem"))];

  it("começa com 5 na mão e a pessoa joga primeiro sem atacar", () => {
    const d = new Duel(seeded(1), [deck(), deck()]);
    expect(d.s[0].hand).toHaveLength(5);
    expect(d.turn).toBe(0);
    expect(d.canBattle(0)).toBe(false);
  });

  it("nível 5 pede um sacrifício", () => {
    const d = new Duel(seeded(1), [deck("satelite", "torradeira"), deck()]);
    const sat = d.s[0].hand.findIndex((c) => c.id === "satelite");
    expect(d.canSummon(0, sat)).toBe(false);
    d.summon(0, d.s[0].hand.findIndex((c) => c.id === "torradeira"), "atk");
    d.endTurn(0);
    d.endTurn(1);
    const sat2 = d.s[0].hand.findIndex((c) => c.id === "satelite");
    expect(d.summon(0, sat2, "atk", [])).toBeNull();
    expect(d.summon(0, sat2, "atk", [0])).not.toBeNull();
    expect(d.s[0].field[0]?.card.id).toBe("satelite");
  });

  it("ataque × ataque: o maior destrói e a diferença sai da vida", () => {
    const d = new Duel(seeded(1), [deck("microondas"), deck("torradeira")]);
    d.summon(0, 0, "atk");
    d.endTurn(0);
    d.summon(1, 0, "atk");
    d.endTurn(1);
    d.toBattle(0);
    d.attack(0, 0, 0);
    expect(d.s[1].field[0]).toBeNull();
    expect(d.s[1].lp).toBe(4000 - (1600 - 1200));
  });

  it("bater numa defesa maior machuca quem atacou", () => {
    const d = new Duel(seeded(1), [deck("torradeira"), deck("geladeira")]);
    d.summon(0, 0, "atk");
    d.endTurn(0);
    d.summon(1, 0, "def");
    d.endTurn(1);
    d.toBattle(0);
    d.attack(0, 0, 0);
    expect(d.s[1].field[0]).not.toBeNull();
    expect(d.s[0].lp).toBe(4000 - (2000 - 1200));
  });

  it("armadilha dispara sozinha no ataque", () => {
    const d = new Duel(seeded(1), [deck("microondas"), deck("espelho")]);
    d.summon(0, 0, "atk");
    d.endTurn(0);
    d.setTrap(1, 0);
    d.endTurn(1);
    d.toBattle(0);
    const ev = d.attack(0, 0, "direct")!;
    expect(ev[0].type).toBe("trap");
    expect(d.s[0].field[0]).toBeNull();
    expect(d.s[1].lp).toBe(4000);
  });

  it("baralho vazio perde", () => {
    const d = new Duel(seeded(1), [Array(5).fill(card("modem")), Array(6).fill(card("modem"))]);
    d.endTurn(0); // Eddy compra a 6ª
    const ev = d.endTurn(1)!; // a pessoa não tem o que comprar
    expect(ev.some((e) => e.type === "win")).toBe(true);
    expect(d.winner).toBe(1);
  });

  it("o Eddy joga contra o Eddy até alguém vencer", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rand = seeded(seed);
      const d = new Duel(rand);
      // a pessoa também joga com a cabeça do Eddy (espelhando os lados)
      for (let turn = 0; turn < 200 && d.winner === null; turn++) {
        const p = d.turn as P;
        if (p === 1) {
          for (let k = 0; k < 30 && eddyStep(d, "normal", rand); k++);
        } else {
          // espelho: troca os lados, deixa o Eddy pensar, destroca
          d.s.reverse();
          d.turn = 1;
          for (let k = 0; k < 30 && eddyStep(d, "normal", rand); k++);
          d.s.reverse();
          d.turn = 0;
        }
        if (d.winner === null) d.endTurn(p);
      }
      expect(d.winner).not.toBeNull();
    }
  });
});
