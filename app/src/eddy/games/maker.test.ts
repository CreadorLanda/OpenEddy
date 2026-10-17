import { describe, expect, it } from "vitest";
import { extractGame, extractHtml, prepareHtml } from "./maker";

describe("o Eddy cria jogos", () => {
  it("tira o HTML de dentro do bloco de código", () => {
    const t = "Aqui está!\n```html\n<!doctype html><html><head></head><body><script>1</script></body></html>\n```\nDivirta-se.";
    expect(extractHtml(t)).toBe("<!doctype html><html><head></head><body><script>1</script></body></html>");
  });

  it("aceita resposta sem bloco e corta o que vem depois do </html>", () => {
    const t = "<html><body><canvas></canvas><script>go()</script></body></html> e mais texto";
    expect(extractHtml(t)).toBe("<html><body><canvas></canvas><script>go()</script></body></html>");
  });

  it("sem HTML (ou sem script) não é jogo", () => {
    expect(extractHtml("desculpa, não consigo")).toBeNull();
    expect(extractHtml("```html\n<html><body>oi</body></html>\n```")).toBeNull();
  });

  it("põe CSP sem rede, as cores e o repórter de erro logo no <head>", () => {
    const out = prepareHtml('<!doctype html><html><head><title>x</title></head><body><script>1</script></body></html>', "classic");
    const head = out.slice(out.indexOf("<head>"), out.indexOf("<title>"));
    expect(head).toContain("Content-Security-Policy");
    expect(head).toContain("default-src 'none'");
    expect(head).toContain("--bg:#ffffff");
    expect(head).toContain("eddyGame:'error'");
  });

  it("sem <head>, cria um", () => {
    const out = prepareHtml("<html><body><script>1</script></body></html>", "holo");
    expect(out).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy"/);
    expect(out).toContain("--bg:#04080c");
  });
});

describe("o Kit", () => {
  it("regras em ```js viram uma página com o Kit por baixo", () => {
    const g = extractGame("Toma:\n```js\nKit.game({ title: 'X', setup(s){}, update(){}, draw(){} });\n```", "en");
    expect(g).not.toBeNull();
    expect(g!.source).toBe("Kit.game({ title: 'X', setup(s){}, update(){}, draw(){} });");
    expect(g!.page).toContain("window.Kit=");
    expect(g!.page).toContain("Game over"); // textos do Kit na língua da pessoa
    expect(g!.page.indexOf("window.Kit=")).toBeLessThan(g!.page.indexOf("Kit.game({ title"));
  });

  it("um </script> dentro das regras não fecha a tag antes da hora", () => {
    const g = extractGame("```js\nKit.game({ title: '</script><b>' });\n```", "pt")!;
    expect(g.page).toContain("<\\/script><b>");
  });

  it("HTML inteiro ainda vale, e resposta sem jogo não", () => {
    expect(extractGame("```html\n<html><body><script>1</script></body></html>\n```", "pt")?.page).toContain("<script>1</script>");
    expect(extractGame("não sei programar isso", "pt")).toBeNull();
  });
});
