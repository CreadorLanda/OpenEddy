import { beforeEach, describe, expect, it, vi } from "vitest";

// O backend da web guarda a conversa no navegador (o servidor é sem estado) e o
// turno passa pelo Puter AI, que pode responder muito depois de a pessoa ter
// desligado. Aqui o `fetch` e o Puter são dublês e a espera é feita com barreiras
// explícitas, nunca com tempos a dormir.

const perfil = { nome: "Zeca", idade: 30, sexo: "masculino" as const, idioma: "pt" as const };

/** `travar("x")` segura o que usar a chave "x" até a função devolvida ser chamada. */
const barreiras = new Map<string, { espera: Promise<void>; abrir: () => void }>();

function travar(chave: string): () => void {
  let abrir = () => {};
  const espera = new Promise<void>((r) => (abrir = r));
  barreiras.set(chave, { espera, abrir });
  return abrir;
}

function esperar(chave: string): Promise<void> {
  return barreiras.get(chave)?.espera ?? Promise.resolve();
}

interface Pedido {
  path: string;
  body: Record<string, unknown>;
}

let pedidos: Pedido[] = [];
let silencios = 0;

function respostaDe(path: string): unknown {
  if (path === "/api/web/start") return { system: "prompt", greeting: "[sighs] Alô, garoto." };
  if (path === "/api/web/silence") return { text: `[scoffs] silêncio ${++silencios}` };
  return { text: null }; // /api/web/route sem atalho: quem responde é o Puter
}

function responder(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function fetchDublê(entrada: string, init: RequestInit): Promise<Response> {
  const path = entrada.replace(/^https?:\/\/[^/]+/, "");
  const body = init.body ? JSON.parse(String(init.body)) : {};
  pedidos.push({ path, body });
  await esperar(`rota:${path}`);
  return responder(respostaDe(path));
}

/** Um Puter AI cujo `chat` espera pela barreira "puter" antes de responder. */
function puterDublê(respostas: string[]) {
  const chamadas: { role: string; content: string }[][] = [];
  const chat = vi.fn(async (messages: { role: string; content: string }[]) => {
    chamadas.push(messages);
    const resposta = respostas[chamadas.length - 1] ?? "resposta";
    return (async function* () {
      await esperar("puter");
      yield { text: resposta };
    })();
  });
  (globalThis as Record<string, unknown>).puter = { authToken: "token", ai: { chat } };
  return chamadas;
}

let B: typeof import("./backend").B;

beforeEach(async () => {
  pedidos = [];
  silencios = 0;
  barreiras.clear();
  (globalThis as Record<string, unknown>).window = globalThis;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "" } });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
  });
  (globalThis as Record<string, unknown>).fetch = vi.fn(fetchDublê);
  vi.resetModules();
  B = (await import("./backend")).B;
});

const conteudo = (chamadas: { content: string }[][], i: number) => chamadas[i].map((m) => m.content);

describe("a conversa da web não herda da chamada anterior", () => {
  it("um turno da chamada velha não entra na conversa da nova", async () => {
    const chamadas = puterDublê(["resposta velha", "resposta nova"]);
    await B.callStart(perfil);

    const abrir = travar("puter");
    const velha = B.turn("pergunta velha", perfil, () => {});
    await new Promise((r) => setTimeout(r, 0)); // o turno velho já chegou ao Puter
    await B.callStart(perfil); // a pessoa desliga e liga outra vez
    abrir();
    await velha;

    await B.turn("pergunta nova", perfil, () => {});
    const daNova = conteudo(chamadas, chamadas.length - 1);
    expect(daNova).not.toContain("pergunta velha");
    expect(daNova).not.toContain("resposta velha");
    expect(daNova).toContain("pergunta nova");
  });

  it("a chamada nova começa com o seu próprio 'alô'", async () => {
    const chamadas = puterDublê(["resposta da primeira", "resposta da segunda"]);
    await B.callStart(perfil);
    await B.turn("pergunta um", perfil, () => {});
    await B.callStart(perfil);
    await B.turn("pergunta dois", perfil, () => {});
    expect(conteudo(chamadas, 1)).toEqual(["prompt", "[sighs] Alô, garoto.", "pergunta dois"]);
  });

  it("um turno a sério continua a entrar na conversa", async () => {
    const chamadas = puterDublê(["primeira resposta", "segunda resposta"]);
    await B.callStart(perfil);
    await B.turn("pergunta um", perfil, () => {});
    await B.turn("pergunta dois", perfil, () => {});
    const segunda = conteudo(chamadas, 1);
    expect(segunda).toContain("pergunta um");
    expect(segunda).toContain("primeira resposta");
  });

  it("uma fala de silêncio de outra chamada não entra na lista de vistas", async () => {
    puterDublê([]);
    await B.callStart(perfil);
    const abrir = travar("rota:/api/web/silence");
    const velha = B.silence(perfil, false);
    await new Promise((r) => setTimeout(r, 0));
    await B.callStart(perfil); // chamada nova a meio
    abrir();
    await velha;

    await B.silence(perfil, false);
    const ultima = pedidos.filter((p) => p.path === "/api/web/silence").pop()!;
    expect(ultima.body.seen).toEqual([]);
  });

  it("o atalho que responde na hora continua a chegar à tela", async () => {
    puterDublê([]);
    await B.callStart(perfil);
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () =>
      responder({ text: "[scoffs] As notícias não respondem." }));
    const tokens: string[] = [];
    const resposta = await B.turn("notícias", perfil, (t) => tokens.push(t));
    expect(resposta.text).toBe("[scoffs] As notícias não respondem.");
    expect(tokens).toEqual(["[scoffs] As notícias não respondem."]);
  });
});