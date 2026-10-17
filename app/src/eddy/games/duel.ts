// O duelo de cartas na ligação. A regra mora em duel-engine.ts; aqui é a mesa:
// o campo do Eddy em cima, o seu embaixo, a sua mão, os botões de fase e uma
// linha que conta o que aconteceu. O Eddy joga um passo por vez, com pausa,
// para dar tempo de ver (e de ouvir ele se gabar).

import { h } from "../../core/dom";
import { clearBanner, endBanner, levelPicker, type GameHost, type GameSession, type Level } from "./common";
import { Duel, eddyStep, tributesFor, type Card, type DuelEvent, type Mon, type P, type Pos } from "./duel-engine";

type Mode =
  | { k: "idle" }
  | { k: "hand"; hi: number }
  | { k: "tribute"; hi: number; pos: Pos; picked: number[] }
  | { k: "target"; hi: number }
  | { k: "field"; slot: number }
  | { k: "attack"; slot: number };

const POS_LABEL: Record<Pos, string> = { atk: "ataque", def: "defesa" };

export class DuelGame implements GameSession {
  readonly kind = "duel" as const;
  readonly el: HTMLElement;
  private d = new Duel();
  private level: Level = "normal";
  private mode: Mode = { k: "idle" };
  private busy = false;
  private closed = false;
  private actions = 0;
  private lastComment = -1e9;
  private table: HTMLElement;
  private banner: HTMLElement;
  private logEl: HTMLElement;

  constructor(private host: GameHost) {
    this.table = h("div", { class: "duel-table" });
    this.banner = h("div", { class: "game-banner" });
    this.logEl = h("p", { class: "duel-log" }, "É hora do duelo! Você começa: invoque um monstro e prepare-se.");
    this.el = h(
      "div",
      { class: "game duel" },
      h("header", { class: "panel-head" }, h("b", {}, "Duelo de cartas"), h("span", { class: "who" }, "você × Eddy"), h("div", { class: "grow" }),
        levelPicker(this.level, (l) => (this.level = l))),
      h("div", { class: "board-wrap" }, this.table, this.banner),
    );
    this.render();
  }

  get started() {
    return this.actions > 2 && this.d.winner === null;
  }

  context(): string {
    const d = this.d;
    if (d.winner !== null) return "";
    const mons = (p: P) => d.s[p].field.filter((m): m is Mon => !!m).map((m) => `${m.card.name} (${m.pos === "atk" ? "ATK " + m.atk : "DEF " + m.card.def})`).join(", ") || "nenhum";
    return `Vocês estão num DUELO DE CARTAS agora: vida ${d.s[1].lp} (você, Eddy) × ${d.s[0].lp} (a pessoa); turno ${d.turnNo}, vez ${d.turn === 1 ? "sua" : "da pessoa"}; seus monstros: ${mons(1)}; os dela: ${mons(0)}.`;
  }

  close() {
    this.closed = true;
  }

  // ── o que aconteceu ────────────────────────────────────────────────────────

  private say(pool: string, force = false) {
    const now = performance.now();
    if (!force && now - this.lastComment < 4000) return;
    this.lastComment = now;
    this.host.comment(pool);
  }

  private apply(ev: DuelEvent[] | null): boolean {
    if (!ev) return false;
    this.actions++;
    const msgs: string[] = [];
    const who = (p: P) => (p === 1 ? "Eddy" : "Você");
    for (const e of ev) {
      switch (e.type) {
        case "summon":
          msgs.push(`${who(e.p)} invocou ${e.card.name} em ${POS_LABEL[e.pos]}${e.tributes.length ? ` (sacrificou ${e.tributes.map((c) => c.name).join(" e ")})` : ""}.`);
          this.host.sfx?.("card");
          if (e.p === 1 && e.card.id === "eddy") this.say("d_supreme", true);
          else if (e.p === 1 && (e.card.level ?? 0) >= 5) this.say("d_big");
          break;
        case "spell":
          msgs.push(`${who(e.p)} ativou ${e.card.name}${e.target ? ` em ${e.target.name}` : ""}.`);
          this.host.sfx?.("card");
          if (e.p === 1 && e.card.id === "formatar") this.say("d_big", true);
          break;
        case "set":
          msgs.push(`${who(e.p)} preparou uma armadilha virada para baixo.`);
          break;
        case "position":
          msgs.push(`${e.card.name} foi para ${POS_LABEL[e.pos]}.`);
          break;
        case "phase":
          msgs.push(`${who(e.p)} entrou na fase de batalha.`);
          break;
        case "trap":
          msgs.push(`ARMADILHA! ${e.card.name} (${e.owner === 1 ? "do Eddy" : "sua"}) contra ${e.attacker.name}.`);
          this.host.sfx?.("heavy");
          this.say(e.owner === 1 ? "d_trap" : "d_trapped", true);
          break;
        case "attack": {
          const alvo = e.target ? e.target.name : "direto";
          const dmg = e.damage ? ` ${who(e.damage.p)} perdeu ${e.damage.n} de vida.` : "";
          const gone = e.destroyed.length ? ` Destruído: ${e.destroyed.map((x) => x.card.name).join(" e ")}.` : "";
          msgs.push(`${e.card.name} atacou ${alvo}.${gone}${dmg}`);
          this.host.sfx?.(e.damage && e.damage.n >= 1000 ? "heavy" : "hit");
          if (e.p === 1 && !e.target) this.say("d_direct");
          else if (e.p === 0 && ((e.damage?.p === 1 && e.damage.n >= 1000) || e.destroyed.some((x) => x.p === 1))) this.say("d_ouch");
          break;
        }
        case "discard":
          msgs.push(`${who(e.p)} descartou ${e.card.name} (mão cheia).`);
          break;
        case "turn":
          msgs.push(e.p === 1 ? "Vez do Eddy…" : "Sua vez.");
          break;
        case "win":
          msgs.push(e.p === 1 ? "O Eddy venceu o duelo." : "Você venceu o duelo!");
          break;
        default:
          break;
      }
    }
    if (msgs.length) this.logEl.textContent = msgs.join(" ");
    const win = ev.find((e) => e.type === "win");
    if (win && win.type === "win") {
      this.host.sfx?.("ko");
      this.mode = { k: "idle" };
      this.render();
      const o = win.p === 1 ? "won" : "lost";
      window.setTimeout(() => !this.closed && endBanner(this.banner, o, () => this.restart()), 900);
      this.host.end(o);
    }
    return true;
  }

  private restart() {
    this.d = new Duel();
    this.mode = { k: "idle" };
    this.busy = false;
    this.actions = 0;
    clearBanner(this.banner);
    this.logEl.textContent = "Revanche! Você começa.";
    this.render();
  }

  // ── o turno do Eddy ────────────────────────────────────────────────────────

  private async eddyTurn() {
    this.busy = true;
    this.render();
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(700);
    for (let guard = 0; guard < 20 && !this.closed && this.d.winner === null; guard++) {
      this.host.thinking(true);
      await wait(500 + Math.random() * 400);
      this.host.thinking(false);
      if (this.closed) return;
      const ev = eddyStep(this.d, this.level);
      if (!ev) break;
      this.apply(ev);
      this.render();
      await wait(900);
    }
    if (this.closed || this.d.winner !== null) return;
    this.apply(this.d.endTurn(1));
    this.busy = false;
    this.render();
  }

  // ── cliques ─────────────────────────────────────────────────────────────────

  private yours() {
    return !this.busy && !this.closed && this.d.winner === null && this.d.turn === 0;
  }

  private clickHand(hi: number) {
    if (!this.yours() || this.d.phase !== "main") return;
    this.mode = this.mode.k === "hand" && this.mode.hi === hi ? { k: "idle" } : { k: "hand", hi };
    this.render();
  }

  private clickMine(slot: number) {
    if (!this.yours()) return;
    const m = this.mode;
    if (m.k === "tribute") {
      if (!this.d.s[0].field[slot]) return;
      const picked = m.picked.includes(slot) ? m.picked.filter((x) => x !== slot) : [...m.picked, slot];
      const need = tributesFor(this.d.s[0].hand[m.hi]);
      if (picked.length === need) {
        this.apply(this.d.summon(0, m.hi, m.pos, picked));
        this.mode = { k: "idle" };
      } else this.mode = { ...m, picked };
    } else if (m.k === "target" && this.d.targets(0, m.hi).includes(slot) && this.d.s[0].hand[m.hi].id === "firmware") {
      this.apply(this.d.activate(0, m.hi, slot));
      this.mode = { k: "idle" };
    } else if (this.d.phase === "battle") {
      this.mode = this.d.canAttack(0, slot) ? { k: "attack", slot } : { k: "idle" };
    } else if (this.d.s[0].field[slot]) {
      this.mode = m.k === "field" && m.slot === slot ? { k: "idle" } : { k: "field", slot };
    }
    this.render();
  }

  private clickTheirs(slot: number) {
    if (!this.yours()) return;
    const m = this.mode;
    if (m.k === "attack" && this.d.s[1].field[slot]) {
      this.apply(this.d.attack(0, m.slot, slot));
      this.mode = { k: "idle" };
    } else if (m.k === "target" && this.d.s[0].hand[m.hi].id === "curto" && this.d.targets(0, m.hi).includes(slot)) {
      this.apply(this.d.activate(0, m.hi, slot));
      this.mode = { k: "idle" };
    }
    this.render();
  }

  private act(fn: () => DuelEvent[] | null, next: Mode = { k: "idle" }) {
    this.apply(fn());
    this.mode = next;
    this.render();
  }

  // ── desenho ─────────────────────────────────────────────────────────────────

  private cardEl(c: Card, extra = "", m?: Mon): HTMLElement {
    const atk = m ? m.atk : c.atk;
    const boosted = m && m.atk > (c.atk ?? 0);
    return h(
      "div",
      { class: `card ${c.kind} ${extra}`, title: `${c.name}${c.level ? ` · nível ${c.level}` : ""}\n${c.text}${c.atk !== undefined ? `\nATK ${atk} / DEF ${c.def}` : ""}` },
      h("span", { class: "icon" }, c.icon),
      h("span", { class: "name" }, c.name),
      c.kind === "monster"
        ? h("span", { class: "stats" }, h("b", { class: boosted ? "up" : "" }, String(atk)), `/${c.def}`)
        : h("span", { class: "stats" }, c.kind === "spell" ? "MAGIA" : "ARMADILHA"),
      c.level ? h("span", { class: "lvl" }, "★".repeat(Math.min(c.level, 7))) : null,
    );
  }

  private slot(content: HTMLElement | null, cls: string, onClick?: () => void): HTMLElement {
    const s = h("button", { type: "button", class: `slot ${cls}` });
    if (content) s.append(content);
    if (onClick) s.addEventListener("click", onClick);
    return s;
  }

  private render() {
    const d = this.d;
    const [you, eddy] = d.s;
    const m = this.mode;
    const targetSlots = m.k === "target" ? d.targets(0, m.hi) : [];
    const targetCard = m.k === "target" ? d.s[0].hand[m.hi] : null;
    const enemyTarget = (i: number) => (m.k === "attack" && !!eddy.field[i]) || (targetCard?.id === "curto" && targetSlots.includes(i));
    const ownTarget = (i: number) => (m.k === "tribute" && !!you.field[i]) || (targetCard?.id === "firmware" && targetSlots.includes(i));

    const row = (p: P) => {
      const sd = d.s[p];
      const mons = sd.field.map((mon, i) =>
        this.slot(
          mon ? this.cardEl(mon.card, `${mon.pos}${mon.attacked && p === d.turn && d.phase === "battle" ? " spent" : ""}`, mon) : null,
          [
            "mon",
            p === 1 && enemyTarget(i) ? "aim" : "",
            p === 0 && ownTarget(i) ? "aim" : "",
            p === 0 && m.k === "tribute" && m.picked.includes(i) ? "picked" : "",
            p === 0 && (m.k === "field" || m.k === "attack") && m.slot === i ? "sel" : "",
            p === 0 && d.turn === 0 && d.phase === "battle" && d.canAttack(0, i) ? "ready" : "",
          ].join(" "),
          () => (p === 0 ? this.clickMine(i) : this.clickTheirs(i)),
        ),
      );
      const traps = sd.traps.map((t) => this.slot(t ? h("div", { class: "card back" }, h("span", { class: "icon" }, p === 0 ? t.icon : "?"), p === 0 ? h("span", { class: "name" }, t.name) : null) : null, "trap"));
      return h("div", { class: `duel-row p${p}` }, ...(p === 1 ? [...traps, ...mons] : [...mons, ...traps]));
    };

    const info = (p: P) =>
      h("div", { class: `duel-info p${p}` },
        h("b", {}, p === 1 ? "EDDY" : "VOCÊ"),
        h("span", { class: `lp ${d.s[p].lp <= 1000 ? "low" : ""}` }, `♥ ${d.s[p].lp}`),
        h("span", { class: "muted" }, `baralho ${d.s[p].deck.length}`),
        p === 1 ? h("span", { class: "backs" }, ...eddy.hand.map(() => h("i", {}))) : null,
        d.turn === p && d.winner === null ? h("span", { class: "turn-dot" }, d.phase === "battle" ? "⚔ batalha" : "● vez") : null,
      );

    // botões do meio, conforme o que está selecionado
    const btn = (label: string, fn: () => void, primary = false, disabled = false) =>
      h("button", { type: "button", class: primary ? "primary" : "", disabled, onclick: fn }, label);
    const buttons: HTMLElement[] = [];
    if (this.yours()) {
      if (m.k === "hand") {
        const c = you.hand[m.hi];
        if (c.kind === "monster") {
          const can = d.canSummon(0, m.hi);
          const need = tributesFor(c);
          const go = (pos: Pos) => (need ? (this.mode = { k: "tribute", hi: m.hi, pos, picked: [] }, this.render()) : this.act(() => d.summon(0, m.hi, pos)));
          buttons.push(btn("Invocar ⚔ ataque", () => go("atk"), true, !can), btn("Invocar 🛡 defesa", () => go("def"), false, !can));
          if (!can) buttons.push(h("span", { class: "hint" }, you.summoned ? "Já invocou neste turno." : need ? `Precisa sacrificar ${need}.` : "Campo cheio."));
        } else if (c.kind === "spell") {
          const can = d.canActivate(0, m.hi);
          buttons.push(btn("Ativar", () => (Duel.target(c) ? (this.mode = { k: "target", hi: m.hi }, this.render()) : this.act(() => d.activate(0, m.hi))), true, !can));
          if (!can) buttons.push(h("span", { class: "hint" }, "Sem alvo agora."));
        } else {
          buttons.push(btn("Preparar armadilha", () => this.act(() => d.setTrap(0, m.hi)), true, !you.traps.includes(null)));
        }
        buttons.push(btn("Cancelar", () => ((this.mode = { k: "idle" }), this.render())));
      } else if (m.k === "tribute") {
        buttons.push(h("span", { class: "hint" }, `Clique em ${tributesFor(you.hand[m.hi]) - m.picked.length} monstro(s) seu(s) para sacrificar.`), btn("Cancelar", () => ((this.mode = { k: "idle" }), this.render())));
      } else if (m.k === "target") {
        buttons.push(h("span", { class: "hint" }, targetCard?.id === "firmware" ? "Escolha um monstro seu." : "Escolha um monstro do Eddy (ATK até 1600)."), btn("Cancelar", () => ((this.mode = { k: "idle" }), this.render())));
      } else if (m.k === "field") {
        const mon = you.field[m.slot]!;
        buttons.push(btn(`Mudar para ${mon.pos === "atk" ? "defesa" : "ataque"}`, () => this.act(() => d.togglePos(0, m.slot)), false, mon.changed));
        buttons.push(btn("Cancelar", () => ((this.mode = { k: "idle" }), this.render())));
      } else if (m.k === "attack") {
        if (!eddy.field.some(Boolean)) buttons.push(btn("Ataque direto!", () => this.act(() => d.attack(0, m.slot, "direct")), true));
        else buttons.push(h("span", { class: "hint" }, "Escolha o alvo no campo do Eddy."));
        buttons.push(btn("Cancelar", () => ((this.mode = { k: "idle" }), this.render())));
      } else {
        if (d.phase === "main") buttons.push(btn("⚔ Batalha", () => this.act(() => d.toBattle(0)), false, !d.canBattle(0)));
        else buttons.push(h("span", { class: "hint" }, "Clique num monstro seu em ataque para atacar."));
        buttons.push(btn("Encerrar turno ⏭", () => {
          this.mode = { k: "idle" };
          if (this.apply(d.endTurn(0)) && d.winner === null) void this.eddyTurn();
          this.render();
        }, true));
      }
    }

    const hand = h("div", { class: "duel-hand" },
      ...you.hand.map((c, i) => {
        const el = this.cardEl(c, m.k === "hand" && m.hi === i ? "sel" : "");
        const b = h("button", { type: "button", class: "slot hand" }, el);
        b.addEventListener("click", () => this.clickHand(i));
        return b;
      }),
    );

    this.table.replaceChildren(
      info(1),
      row(1),
      h("div", { class: "duel-mid" }, this.logEl, h("div", { class: "duel-buttons" }, ...buttons)),
      row(0),
      info(0),
      hand,
    );
    this.table.classList.toggle("waiting", this.busy);
  }
}
