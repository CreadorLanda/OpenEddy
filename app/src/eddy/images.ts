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

/** O painel com as imagens: uma de cada vez, setas para trocar, crédito embaixo. */
export function galleryPanel(q: string, pics: Pic[], onClose: () => void): HTMLElement {
  let i = 0;
  const img = h("img", { alt: "" }) as HTMLImageElement;
  const credit = h("a", { class: "credit" });
  const pos = h("span", { class: "who" });
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
  const nav = pics.length > 1
    ? [h("button", { type: "button", class: "ghost", title: "Anterior", onclick: () => step(-1) }, "‹"), h("button", { type: "button", class: "ghost", title: "Próxima", onclick: () => step(1) }, "›")]
    : [];
  paint();
  return h(
    "div",
    { class: "gallery" },
    h("header", { class: "panel-head" }, h("b", {}, `🔍 ${q}`), pos, h("div", { class: "grow" }), ...nav, h("button", { type: "button", class: "ghost", title: "Fechar", onclick: onClose }, "×")),
    h("div", { class: "pic" }, img),
    credit,
  );
}
