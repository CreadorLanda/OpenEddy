// O Eddy cria jogos: a pessoa pede ("cria um jogo de pegar torradas"), o
// modelo escreve um jogo de um arquivo só e ele roda aqui, num iframe isolado.
//
// Isolamento: sandbox="allow-scripts" SEM allow-same-origin (o jogo não lê a
// conta, o app nem o armazenamento) e um CSP sem rede nenhuma (connect, img e
// fontes só de dentro do próprio arquivo). Na web o jogo vai por srcdoc; no PC
// ele é servido pelo núcleo noutra origem, com o CSP no cabeçalho (o srcdoc
// herdaria o CSP do app, que não deixa script inline).
//
// Enquanto ele programa, o código aparece sendo escrito; se o jogo quebrar logo
// no começo, o erro volta para o modelo uma vez e ele conserta.

import { h } from "../../core/dom";
import type { GameHost, GameSession } from "./common";
import { kitPage } from "./kit";

export interface MakerDeps {
  make(idea: string, onToken: (t: string) => void, fix?: { code: string; error: string }): Promise<string>;
  /** endereço do jogo (PC) ou null (web: srcdoc) */
  host(html: string): Promise<string | null>;
  theme(): "holo" | "classic";
  /** língua dos textos do Kit (início, fim de jogo) */
  lang(): string;
  /** modelo local na CPU: avisa que demora */
  slow: boolean;
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
const PALETTE = {
  holo: "--bg:#04080c;--ink:#6ee4ff;--accent:#f5d742;--muted:#5f8c9c;color-scheme:dark",
  classic: "--bg:#ffffff;--ink:#111111;--accent:#b3261e;--muted:#777777;color-scheme:light",
};
// os erros do jogo voltam para a tela (para o conserto automático)
const REPORT =
  "<script>(function(){var s=function(m){try{parent.postMessage({eddyGame:'error',message:String(m).slice(0,400)},'*')}catch(e){}};" +
  "addEventListener('error',function(e){s((e.message||'erro')+(e.lineno?' (linha '+e.lineno+')':''))});" +
  "addEventListener('unhandledrejection',function(e){s(e.reason)})})()</script>";

/**
 * O jogo de dentro da resposta do modelo. O normal são as regras para o Kit
 * (bloco ```js com Kit.game); um HTML inteiro também vale (alguns modelos
 * insistem). Devolve a página pronta para rodar, ou null.
 */
export function extractGame(text: string, lang: string): { page: string; source: string } | null {
  const js = /```(?:js|javascript)\s*\n([\s\S]*?)```/i.exec(text)?.[1] ?? /```\s*\n([\s\S]*?Kit\.game[\s\S]*?)```/.exec(text)?.[1];
  if (js && /Kit\.game\s*\(/.test(js)) return { page: kitPage(js.trim(), lang), source: js.trim() };
  if (!/```/.test(text) && /Kit\.game\s*\(/.test(text) && !/<html/i.test(text)) return { page: kitPage(text.trim(), lang), source: text.trim() };
  const html = extractHtml(text);
  return html ? { page: html, source: html } : null;
}

/** O HTML de dentro da resposta do modelo (bloco ```html, ou do <!doctype ao </html>). */
export function extractHtml(text: string): string | null {
  const fence = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text);
  let html = fence ? fence[1] : text;
  const start = html.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return null;
  html = html.slice(start);
  const end = html.search(/<\/html>/i);
  if (end >= 0) html = html.slice(0, end + 7);
  return /<script[\s>]/i.test(html) ? html.trim() : null;
}

/** Põe no começo do <head>: CSP sem rede, as cores do visual e o repórter de erros. */
export function prepareHtml(html: string, theme: "holo" | "classic"): string {
  const inject =
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    // :root:root e !important: ganha de um :root que o próprio jogo declare depois
    `<style>:root:root{${PALETTE[theme].replace(/;/g, " !important;")} !important}html,body{background:var(--bg);color:var(--ink)}</style>` +
    REPORT;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`);
  return inject + html;
}

export class MadeGame implements GameSession {
  readonly kind = "made" as const;
  readonly el: HTMLElement;
  private body: HTMLElement;
  private reload: HTMLButtonElement;
  private save: HTMLButtonElement;
  private frame: HTMLIFrameElement | null = null;
  private html = "";
  private source = "";
  private ready = "";
  private closed = false;
  private repaired = false;
  private playingSince = 0;
  private lastOver = 0;
  private gen = 0;

  constructor(private idea: string, private host: GameHost, private deps: MakerDeps) {
    this.body = h("div", { class: "made-body" });
    this.reload = h("button", { type: "button", class: "ghost", title: "Recomeçar o jogo", hidden: true, onclick: () => void this.play() }, "⟳") as HTMLButtonElement;
    this.save = h("button", { type: "button", class: "ghost", title: "Baixar o jogo (.html)", hidden: true, onclick: () => this.download() }, "⬇") as HTMLButtonElement;
    this.el = h(
      "div",
      { class: "game made" },
      h("header", { class: "panel-head" }, h("b", {}, `🛠 ${idea || "Jogo do Eddy"}`), h("span", { class: "who" }, "criado pelo Eddy"), h("div", { class: "grow" }), this.reload, this.save),
      this.body,
    );
    window.addEventListener("message", this.onMessage);
    void this.build();
  }

  get started() {
    return this.playingSince > 0;
  }

  context(): string {
    if (this.closed) return "";
    return this.playingSince
      ? `A pessoa está jogando agora um jogo que VOCÊ (Eddy) acabou de programar: “${this.idea || "um jogo seu"}”.`
      : `Você (Eddy) está programando agora um jogo: “${this.idea || "um jogo seu"}”.`;
  }

  close() {
    this.closed = true;
    window.removeEventListener("message", this.onMessage);
    this.frame?.remove();
  }

  // ── programando ────────────────────────────────────────────────────────────

  private async build(fix?: { code: string; error: string }) {
    const gen = ++this.gen;
    this.playingSince = 0;
    this.reload.hidden = this.save.hidden = true;
    const code = h("pre", { class: "code-stream" });
    const count = h("span", {}, "");
    this.body.replaceChildren(
      h("div", { class: "coding" },
        code,
        h("p", { class: "coding-status" },
          h("span", { class: "dots" }, h("i", {}, "●"), h("i", {}, "●"), h("i", {}, "●")),
          ` ${fix ? "Eddy consertando o bug" : "Eddy programando"}… `, count),
        this.deps.slow ? h("p", { class: "fine" }, "No PC o modelo local programa devagar: pode levar alguns minutos.") : null,
      ),
    );
    let text = "";
    let paint = 0;
    try {
      const out = await this.deps.make(this.idea, (t) => {
        if (this.closed || gen !== this.gen) return;
        text += t;
        // repinta no máximo a cada 80 ms: só as últimas linhas, como um terminal
        const now = performance.now();
        if (now - paint > 80) {
          paint = now;
          code.textContent = text.split("\n").slice(-22).join("\n");
          count.textContent = `${text.length.toLocaleString()} caracteres`;
        }
      }, fix);
      text = out || text;
    } catch (e) {
      if (!this.closed && gen === this.gen) this.fail((e as Error).message);
      return;
    }
    if (this.closed || gen !== this.gen) return;
    const game = extractGame(text, this.deps.lang());
    if (!game) return this.fail("o modelo não devolveu um jogo");
    this.html = game.page;
    this.source = game.source;
    await this.play();
    if (!this.closed) this.host.comment("m_ready", true);
  }

  private fail(why: string) {
    const again = h("button", { type: "button", class: "primary" }, "Tentar de novo");
    again.addEventListener("click", () => {
      this.repaired = false;
      void this.build();
    });
    this.body.replaceChildren(h("div", { class: "coding failed" }, h("p", {}, `Não deu: ${why}.`), again));
    this.host.comment("m_fail", true);
  }

  // ── jogando ─────────────────────────────────────────────────────────────────

  private async play() {
    this.ready = prepareHtml(this.html, this.deps.theme());
    const frame = h("iframe", { class: "made-frame", sandbox: "allow-scripts", title: this.idea || "Jogo do Eddy" }) as HTMLIFrameElement;
    const url = await this.deps.host(this.ready).catch(() => null);
    if (this.closed) return;
    if (url) frame.src = url;
    else frame.srcdoc = this.ready;
    frame.addEventListener("load", () => frame.focus());
    this.frame?.remove();
    this.frame = frame;
    this.body.replaceChildren(frame);
    this.reload.hidden = false;
    this.save.hidden = this.deps.slow; // no PC o webview não baixa arquivos
    this.playingSince = performance.now();
  }

  private onMessage = (ev: MessageEvent) => {
    if (!this.frame || ev.source !== this.frame.contentWindow) return;
    const data = ev.data as { eddyGame?: string; message?: string } | null;
    if (data?.eddyGame === "error") {
      // quebrou logo de cara: conserta uma vez (depois disso, é "arte")
      if (!this.repaired && performance.now() - this.playingSince < 8000) {
        this.repaired = true;
        this.host.comment("m_bug", true);
        void this.build({ code: this.source, error: String(data.message ?? "erro") });
      }
    } else if (data?.eddyGame === "over") {
      const now = performance.now();
      if (now - this.lastOver > 15000) {
        this.lastOver = now;
        this.host.comment("m_over");
      }
    }
  };

  private download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([this.ready], { type: "text/html" }));
    const slug = (this.idea || "jogo").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40);
    a.download = `eddy-${slug || "jogo"}.html`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
