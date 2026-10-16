// Utilitários de DOM.

type Attrs = Record<string, string | number | boolean | ((ev: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Links abrem no navegador, nunca dentro do app. */
export function externalLinks(root: HTMLElement, open: (url: string) => unknown) {
  root.addEventListener("click", (ev) => {
    const a = (ev.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    ev.preventDefault();
    if (/^https?:\/\//.test(a.href)) void open(a.href);
  });
}
