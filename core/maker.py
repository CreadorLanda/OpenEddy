"""O Eddy cria jogos: o pedido para o modelo escrever um jogo de um arquivo só.

A tela roda o resultado num iframe isolado (sandbox sem mesma origem, sem rede):
o jogo não vê a conta, o app nem a internet. As cores vêm da tela por
variáveis CSS (--bg, --ink, --accent, --muted), para o jogo combinar com o
visual do Eddy (holograma ou clássico).

Se o jogo quebrar logo no começo, a tela manda o erro de volta uma vez
(`fix`) e o modelo devolve o arquivo inteiro consertado.
"""

LANG_NAME = {"pt": "português do Brasil", "en": "English", "es": "español"}

SYSTEM = """Você é um programador de jogos de navegador rápido e caprichoso.
Escreva UM jogo pequeno e jogável em UM arquivo HTML completo (<!doctype html> … </html>), com o CSS e o JavaScript dentro dele.

Regras do arquivo:
- Nada de fora: sem CDN, sem imagens, sem fontes, sem fetch, sem localStorage, sem alert/prompt/confirm. Desenhe tudo com <canvas> ou com HTML/CSS.
- O jogo roda dentro de uma moldura de mais ou menos 800×500 (pode ser menor, no celular): ocupe 100% da largura e da altura (html, body {{margin:0; height:100%; overflow:hidden}}) e redimensione o canvas quando a janela mudar.
- Cores: use SEMPRE as variáveis CSS que já existem na página: var(--bg) fundo, var(--ink) traço e texto, var(--accent) destaque, var(--muted) secundário. No canvas, leia com getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(). Estilo de traço/linhas, como desenho de linha.
- Controles de teclado (setas/espaço) E de toque/mouse (toque ou clique na tela). Dê foco ao jogo ao clicar.
- Mostre o título, uma instrução curta, a pontuação, e uma tela de fim com "jogar de novo".
- Quando a partida acabar, chame: parent.postMessage({{eddyGame: 'over', score: PONTOS}}, '*')
- Todo texto que aparece no jogo em {lingua}.
- Código curto e correto (no máximo umas 250 linhas). Teste mentalmente: nada de variável indefinida, o laço com requestAnimationFrame.

Responda APENAS com o arquivo, dentro de um bloco ```html … ```."""

FIX = """O jogo que você escreveu quebrou ao rodar, com este erro:

{erro}

Devolva o arquivo INTEIRO consertado (o da sua resposta anterior), no mesmo formato: só o bloco ```html."""


def messages(idea: str, lang: str, fix: dict | None = None) -> list[dict]:
    """As mensagens para o modelo escrever (ou consertar) o jogo `idea`."""
    idea = (" ".join(str(idea).split())[:200]
            or "um jogo original à sua escolha, no mundo do Eddy (casa inteligente, eletrodomésticos rebeldes)")
    out = [
        {"role": "system", "content": SYSTEM.format(lingua=LANG_NAME.get(lang, LANG_NAME["pt"]))},
        {"role": "user", "content": f"Crie este jogo: {idea}"},
    ]
    if fix and fix.get("code"):
        out.append({"role": "assistant", "content": "```html\n" + str(fix["code"])[:40000] + "\n```"})
        out.append({"role": "user", "content": FIX.format(erro=str(fix.get("error", ""))[:600])})
    return out
