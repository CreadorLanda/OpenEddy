// Imagens que o Eddy mostra: busca no Openverse (imagens livres, Creative
// Commons), direto do navegador — cada pessoa usa a própria cota (anônimo: 20
// por minuto, 200 por dia por IP), sem chave e sem passar pelo servidor.
//
// O Openverse já tira o que é marcado como adulto (mature=false); por cima, o
// núcleo recusa pedidos impróprios (actions.BLOCKED) e aqui caem os resultados
// com títulos suspeitos.

import { h } from "../core/dom";

export interface Pic {
  thumb: string;
  title: string;
  creator: string;
  license: string;
  link: string;
}

const API = "https://api.openverse.org/v1/images/";
const BAD = /\b(sex\w*|nud\w*|naked|porn\w*|xxx|nsfw|erotic\w*|topless|lingerie|bikini|boobs?|tits?|gore|blood\w*|corpse|dead|pelad\w*|desnud\w*)\b/i;
const STOP = new Set(
  "de do da dos das um uma uns umas o a os as com sem em no na nos nas e ou pra para por of the a an with in on and or for el la los las un una con en y".split(" "),
);

const licenseName = (l: string) => (l === "cc0" ? "CC0" : l === "pdm" ? "Domínio público" : `CC ${l.toUpperCase()}`);

interface Result {
  thumbnail?: string;
  title?: string;
  creator?: string;
  license?: string;
  foreign_landing_url?: string;
  mature?: boolean;
}

async function query(q: string, signal?: AbortSignal): Promise<Pic[]> {
  const url = `${API}?q=${encodeURIComponent(q)}&page_size=16&mature=false`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(res.status === 429 ? "limite do Openverse por hoje" : `Openverse ${res.status}`);
  const data = (await res.json()) as { results?: Result[] };
  return (data.results ?? [])
    .filter((r) => r.thumbnail && !r.mature && !BAD.test(`${r.title ?? ""}`))
    .slice(0, 8)
    .map((r) => ({
      thumb: r.thumbnail!,
      title: (r.title ?? "").slice(0, 80),
      creator: (r.creator ?? "").slice(0, 60),
      license: licenseName(r.license ?? ""),
      link: r.foreign_landing_url ?? "",
    }));
}

/**
 * Busca com recuo: o Openverse é quase todo em inglês, então "capivara de
 * chapéu" pode dar zero. Tenta a frase, depois só as palavras que importam, e
 * por fim a palavra mais longa sozinha.
 */
export async function searchImages(q: string, signal?: AbortSignal): Promise<Pic[]> {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  const tries = [q, words.join(" "), ...[...words].sort((a, b) => b.length - a.length).slice(0, 2)];
  const seen = new Set<string>();
  for (const t of tries) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const pics = await query(t, signal);
    if (pics.length) return pics;
  }
  return [];
}

/** Carrega a imagem de verdade antes de mostrar (o Openverse às vezes demora). */
function preload(src: string, ms = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const im = new Image();
    const t = window.setTimeout(() => resolve(false), ms);
    im.onload = () => (window.clearTimeout(t), resolve(true));
    im.onerror = () => (window.clearTimeout(t), resolve(false));
    im.src = src;
  });
}

export interface Gallery {
  el: HTMLElement;
  /** Carrega a primeira imagem que abrir (o painel continua procurando); false se nenhuma abriu. */
  prepare(pics: Pic[]): Promise<boolean>;
  /** Troca a busca pela imagem já carregada. */
  reveal(): void;
  /** Não achou nada (ou deu erro): troca a busca pelo aviso. */
  empty(why?: string): void;
}

/**
 * O painel das imagens. Nasce PROCURANDO (varredura animada) e só troca para a
 * imagem quando ela já carregou — o Eddy nunca diz "aí está" para uma tela vazia.
 */
export function galleryPanel(q: string, onClose: () => void): Gallery {
  let pics: Pic[] = [];
  let i = 0;
  const img = h("img", { alt: "" }) as HTMLImageElement;
  const credit = h("a", { class: "credit" });
  const pos = h("span", { class: "who" });
  const searching = h("div", { class: "searching" },
    h("div", { class: "scan" }, h("span", { class: "beam" })),
    h("p", {}, `Procurando “${q}”`, h("span", { class: "dots" }, h("i", {}, "."), h("i", {}, "."), h("i", {}, "."))),
  );
  const pic = h("div", { class: "pic" }, searching);
  const prev = h("button", { type: "button", class: "ghost", title: "Anterior", hidden: true }, "‹");
  const next = h("button", { type: "button", class: "ghost", title: "Próxima", hidden: true }, "›");
  const paint = () => {
    const p = pics[i];
    img.src = p.thumb;
    img.alt = p.title;
    credit.setAttribute("href", p.link);
    credit.textContent = `${p.title || "sem título"}${p.creator ? " — " + p.creator : ""} · ${p.license} · Openverse`;
    pos.textContent = pics.length > 1 ? `${i + 1}/${pics.length}` : "";
  };
  const step = (d: number) => {
    i = (i + d + pics.length) % pics.length;
    paint();
  };
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  // uma imagem quebrada no meio da lista: sai dela e segue para a próxima
  img.addEventListener("error", () => {
    if (pics.length <= 1) return;
    pics.splice(i, 1);
    i %= pics.length;
    paint();
  });
  const el = h(
    "div",
    { class: "gallery loading" },
    h("header", { class: "panel-head" }, h("b", {}, `🔍 ${q}`), pos, h("div", { class: "grow" }), prev, next, h("button", { type: "button", class: "ghost", title: "Fechar", onclick: onClose }, "×")),
    pic,
    credit,
  );
  return {
    el,
    async prepare(found) {
      // a primeira que abrir de verdade vai na frente
      for (let k = 0; k < Math.min(found.length, 4); k++) {
        if (await preload(found[k].thumb)) {
          pics = found.slice(k);
          i = 0;
          return true;
        }
      }
      return false;
    },
    reveal() {
      if (!pics.length) return;
      paint();
      pic.replaceChildren(img);
      el.classList.remove("loading");
      prev.hidden = next.hidden = pics.length < 2;
    },
    empty(why = "Nada encontrado.") {
      el.classList.remove("loading");
      pic.replaceChildren(h("p", { class: "muted" }, why));
    },
  };
}
