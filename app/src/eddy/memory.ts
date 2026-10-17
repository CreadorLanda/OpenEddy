// A memória entre chamadas: o que o Eddy se lembra de si, e quem manda.
//
// Só aparece no app do PC (o modo web não tem memória: os factos são do núcleo
// local e não vão para lado nenhum). Fica desligada até a pessoa ligar, e
// guardar um facto é sempre um gesto explícito — nada é extraído da conversa.

import { Api, type MemoryEntry } from "../core/api";
import { h } from "../core/dom";

/** Um painel de memória, ou nada se o backend web não tiver memória. */
export function memoryPanel(disponivel: boolean, recarrega: () => void): HTMLElement | null {
  if (!disponivel) return null;

  const wrap = h("div", { class: "mem" });
  const aviso = h("p", { class: "error" });
  let ligado = false;
  let entradas: MemoryEntry[] = [];

  const falhar = (e: unknown) => {
    aviso.textContent = (e as Error).message; // a mensagem vem do núcleo, já sem detalhes internos
  };

  const segs = h("div", { class: "segs" });
  const lista = h("div", { class: "mem-list" });
  const guardar = h("button", { class: "ghost", type: "button" }, "Guardar") as HTMLButtonElement;
  const facto = h("input", { maxlength: 280, placeholder: "Um facto sobre mim…" }) as HTMLInputElement;

  const pintar = () => {
    lista.replaceChildren(
      ...entradas.map((e) =>
        h(
          "div",
          { class: "mem-item" },
          h("span", {}, e.text),
          h("button", {
            type: "button",
            class: "ghost",
            title: "Esquecer este facto",
            onclick: async () => {
              try {
                await Api.memoryDelete(e.id);
                aviso.textContent = "";
                await recarrega();
              } catch (err) {
                falhar(err);
              }
            },
          }, "×"),
        ),
      ),
      ...(ligado && !entradas.length ? [h("p", { class: "fine" }, "Ainda não guardaste nada.")] : []),
    );
    guardar.disabled = !ligado;
    facto.disabled = !ligado;
  };

  const alternar = async (novo: boolean) => {
    try {
      await Api.memoryToggle(novo);
      aviso.textContent = "";
      await recarrega();
    } catch (e) {
      falhar(e);
    }
  };

  for (const [valor, titulo] of [[true, "Ligada"], [false, "Desligada"]] as const) {
    const b = h("button", { type: "button", class: "seg" }, titulo);
    b.addEventListener("click", () => void alternar(valor));
    segs.append(b);
  }

  guardar.addEventListener("click", async () => {
    const texto = facto.value.trim();
    if (!texto) return;
    try {
      await Api.memoryAdd(texto);
      facto.value = "";
      aviso.textContent = "";
      await recarrega();
    } catch (e) {
      falhar(e);
    }
  });

  const esquecer = h("button", { type: "button", class: "ghost" }, "Esquecer tudo");
  esquecer.addEventListener("click", async () => {
    if (!confirm("Esquecer todos os factos que o Eddy guardou sobre ti?")) return;
    try {
      await Api.memoryClear();
      aviso.textContent = "";
      await recarrega();
    } catch (e) {
      falhar(e);
    }
  });

  wrap.append(
    h("h3", {}, "Memória"),
    h("p", { class: "fine" },
      "O Eddy pode lembrar-se de factos que mandares guardar, de uma chamada para a outra. Nada é guardado sem o mandares, e nunca ficam conversas inteiras."),
    segs,
    h("div", { class: "mem-add" }, facto, guardar),
    lista,
    esquecer,
    aviso,
  );

  void Api.memory().then((s) => {
    ligado = s.enabled;
    entradas = s.entries;
    for (const b of segs.children) b.classList.toggle("on", (b.textContent === "Ligada") === ligado);
    pintar();
  }).catch(falhar);

  return wrap;
}