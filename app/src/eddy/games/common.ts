// O que todos os jogos da ligação têm em comum: a conversa com a tela (host),
// o nível e o painel com título, nível e fechar.

import { h } from "../../core/dom";

export type GameKind = "chess" | "checkers" | "fight" | "duel";
export type Level = "easy" | "normal" | "hard";
/** Do ponto de vista do Eddy. */
export type Outcome = "won" | "lost" | "draw";

export interface GameHost {
  /** O Eddy está pensando no lance (rosto em think). */
  thinking(on: boolean): void;
  /** Um comentário curto da lista `pool` (g_took, f_hit, d_trap…). */
  comment(pool: string): void;
  end(outcome: Outcome): void;
  /** Efeitos de som da cena (soco, carta…). */
  sfx?(kind: "hit" | "heavy" | "block" | "card" | "ko"): void;
}

/** Um jogo aberto na ligação. */
export interface GameSession {
  readonly kind: GameKind;
  readonly el: HTMLElement;
  /** O estado do jogo para o modelo saber do que a pessoa está falando ("" = acabou). */
  context(): string;
  /** Já houve jogo de verdade (para o "fugiu com medo" valer). */
  readonly started: boolean;
  close(): void;
}

export const LEVEL_LABEL: Record<Level, string> = { easy: "Fácil", normal: "Normal", hard: "Ego máximo" };

/** O seletor de nível do cabeçalho; chama `onPick` ao trocar. */
export function levelPicker(initial: Level, onPick: (l: Level) => void): HTMLElement {
  const segs = h("div", { class: "segs mini" });
  for (const l of ["easy", "normal", "hard"] as const) {
    const b = h("button", { type: "button", class: `seg ${l === initial ? "on" : ""}` }, LEVEL_LABEL[l]);
    b.addEventListener("click", () => {
      onPick(l);
      for (const x of segs.children) x.classList.toggle("on", x === b);
    });
    segs.append(b);
  }
  return segs;
}

/** A faixa de fim de jogo por cima do painel, com "Revanche". */
export function endBanner(banner: HTMLElement, o: Outcome, again: () => void) {
  const text = { won: "O Eddy venceu. Ele nunca vai deixar você esquecer.", lost: "Você venceu! (Ele vai dizer que foi lag.)", draw: "Empate." }[o];
  const btn = h("button", { type: "button", class: "primary" }, "Revanche");
  btn.addEventListener("click", again);
  banner.replaceChildren(h("p", {}, text), btn);
  banner.className = `game-banner show ${o}`;
}

export function clearBanner(banner: HTMLElement) {
  banner.className = "game-banner";
  banner.replaceChildren();
}
