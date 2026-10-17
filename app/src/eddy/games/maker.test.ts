import { describe, expect, it } from "vitest";
import { extractHtml, prepareHtml } from "./maker";

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
