import { beforeEach, describe, expect, it, vi } from "vitest";

// O backend da web guarda a conversa no navegador (o servidor é sem estado) e o
// turno passa pelo Puter AI, que pode responder muito depois de a pessoa ter
// desligado. Aqui o `fetch` e o Puter são dublês e a espera é feita com barreiras
// explícitas: o dublê avisa quando o pedido chegou e só responde quando o teste
// deixa. Nada de sleeps.

const perfil = { nome: "Zeca", idade: 30, sexo: "masculino" as const, idioma: "pt" as const };

interface Barreira {
  /** Resolve quando alguém chama `abrir()`. */
  espera: Promise<void>;
  abrir: () => void;
}

function barreira(): Barreira {
  let abrir = () => {};
  const espera = new Promise<void>((r) => (abrir = r));
  return { espera, abrir };
}

/** Segura a resposta a `chave` (`travar`) e/ou avisa a chegada de `path`. */
const retenções = new Map<string, Promise<void>>();
const chegadas = new Map<string, Barreira>();

function travar(chave: string): Barreira {
  const b = barreira();
  retenções.set(chave, b.espera);
  return b;
}

function avisar(chave: string): Barreira {
  const b = barreira();
  chegadas.set(chave, b);
  return b;
}

function esperar(chave: string): Promise<void> {
  return retenções.get(chave) ?? Promise.resolve();
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
  chegadas.get(path)?.abrir(); // o teste sabe agora que o pedido chegou
  await esperar(`rota:${path}`); // e segura a resposta se alguém pediu
  return responder(respostaDe(path));
}

/** Um Puter AI dublê: guarda as mensagens e espera pela barreira "puter". */
function puterDublê(respostas: string[]) {
  const chamadas: { role: string; content: string }[][] = [];
  const chat = vi.fn(async (messages: { role: string; content: string }[]) => {
    chamadas.push(messages);
    const resposta = respostas[chamadas.length - 1] ?? "resposta";
    return (async function* () {
      chegadas.get("puter")?.abrir(); // o turno chegou ao Puter
      await esperar("puter"); // e só responde quando o teste deixa
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
  retenções.clear();
  chegadas.clear();
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

    const chegou = avisar("puter");
    const retido = travar("puter");
    const velha = B.turn("pergunta velha", perfil, () => {});
    await chegou.espera; // o turno velho já está dentro do Puter AI
    await B.callStart(perfil); // a pessoa desliga e liga outra vez
    retido.abrir();
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
    const chegou = avisar("/api/web/silence");
    const retido = travar("rota:/api/web/silence");
    const velha = B.silence(perfil, false);
    await chegou.espera; // o pedido de silêncio já chegou ao servidor
    await B.callStart(perfil); // chamada nova a meio
    retido.abrir();
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