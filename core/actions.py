"""Ações do Eddy na tela: coisas que ele FAZ além de falar.

  image   "me mostra uma capivara" → busca imagens livres (Openverse) e mostra
  theme   "fica branco" / "volta pro holograma" → troca o visual do Eddy
  game    "bora jogar xadrez" / "vamos lutar" / "é hora do duelo" → abre o jogo

O núcleo só reconhece o pedido e devolve {"kind", ...}; quem executa é a tela
(a busca de imagens sai do navegador, para cada pessoa usar a própria cota do
Openverse). O modelo comenta com uma NOTA DE DIREÇÃO, como nas cenas.
"""

import re

# ── imagens ───────────────────────────────────────────────────────────────────

_IMAGE = {
    "pt": [
        r"\b(?:me\s+)?(?:mostr[ae]\w*|exib[ae]\w*)(?:\s+(?:pra|para)\s+mim)?\s+(?P<q>.+)",
        r"\b(?:quero|posso|deixa\s+eu)\s+ver\s+(?P<q>.+)",
        r"\b(?:fotos?|imagens?|figuras?)\s+(?:de|do|da|dos|das)\s+(?P<q>.+)",
    ],
    "en": [
        r"\bshow\s+(?:me\s+)?(?P<q>.+)",
        r"\b(?:i\s+want\s+to|let\s+me|can\s+i)\s+see\s+(?P<q>.+)",
        r"\b(?:pictures?|photos?|images?|pics?)\s+of\s+(?P<q>.+)",
    ],
    "es": [
        r"\b(?:mu[ée]strame|ens[ée][ñn]ame|mostrame|muestra(?:me)?)\s+(?P<q>.+)",
        r"\b(?:quiero|puedo)\s+ver\s+(?P<q>.+)",
        r"\b(?:fotos?|im[áa]gen(?:es)?)\s+de\s+(?P<q>.+)",
    ],
}

# o começo do pedido que não é o assunto ("uma foto de", "a picture of"…)
_LEAD = {
    "pt": r"^(?:(?:uma?s?|algumas?|o|a|os|as)\s+)?(?:(?:fotos?|imagens?|figuras?|desenhos?)\s+)?(?:(?:de|do|da|dos|das)\s+)?(?:(?:uma?s?|o|a|os|as)\s+)?",
    "en": r"^(?:(?:a|an|some|the)\s+)?(?:(?:pictures?|photos?|images?|pics?|drawings?)\s+)?(?:of\s+)?(?:(?:a|an|some|the)\s+)?",
    "es": r"^(?:(?:una?s?|algunas?|el|la|los|las)\s+)?(?:(?:fotos?|im[áa]gen(?:es)?|dibujos?)\s+)?(?:(?:de|del)\s+)?(?:(?:una?s?|el|la|los|las)\s+)?",
}
_TAIL = r"(?:\s+(?:por\s+favor|please|pra\s+mim|para\s+mim|para\s+m[íi]|a[ií]|agora|now))+$"

# "mostra as notícias", "mostra o clima": isso é dos atalhos, não de imagem
_NOT_IMAGE = r"\b(not[íi]cias?|manchetes?|news|headlines|clima|tempo|weather|hora|time|noticias|chamada|call)\b"
# "mostra que você é bom", "show me how": não é um assunto para buscar
_NOT_SUBJECT = (r"(que|como|quem|onde|quando|porque|por\s+que|se|isso|aquilo|isto|ent[ãa]o|tudo|algo|"
                r"that|how|what|who|why|where|when|if|it|this|us|me|you|something|everything|"
                r"qu[ée]|c[óo]mo|qui[ée]n|eso|esto|algo|todo)\b")

# Pedidos que o Eddy recusa, filtro do Openverse à parte.
BLOCKED = (r"\b(sex\w*|nud\w*|naked|porn\w*|xxx|nsfw|er[óo]tic\w*|pelad\w*|"
           r"pel[aã]da|bunda|peit\w*|boobs?|tits?|gore|sangue|blood|cad[áa]ver\w*|corpse|"
           r"mort[oa]s?|dead\s+bod\w*|desnud\w*|tetas?|culo)\b")


def image_query(text: str, lang: str) -> str | None:
    t = " ".join(text.lower().split()).strip(" ?!.,;")
    for pat in _IMAGE.get(lang, _IMAGE["pt"]):
        m = re.search(pat, t)
        if not m:
            continue
        q = re.sub(_LEAD.get(lang, _LEAD["pt"]), "", m.group("q").strip(" ?!.,;"))
        q = re.sub(_TAIL, "", q).strip(" ?!.,;")
        if len(q) < 2 or re.search(_NOT_IMAGE, q) or re.match(_NOT_SUBJECT, q):
            return None
        return q[:80]
    return None


# ── visual ────────────────────────────────────────────────────────────────────

_THEME = {
    "pt": (r"\b(fica|fique|muda|mude|troca|troque|vira|vire|coloca|p[õo]e|volta|bota|usa)\b",
           r"\b(?P<to>branco|preto\s+e\s+branco|cl[áa]ssico|azul|holograma)\b",
           r"\b(mud[ae]\w*|troc[ae]\w*)\s+(?:de\s+)?(?:cor|visual)\b"),
    "en": (r"\b(turn|go|switch|change|make\s+yourself|be|back\s+to|use)\b",
           r"\b(?P<to>white|black\s+and\s+white|classic|blue|hologram)\b",
           r"\bchange\s+(?:your\s+)?(?:colou?rs?|look)\b"),
    "es": (r"\b(ponte|cambia|vuelve|hazte|usa|pon)\b",
           r"\b(?P<to>blanco|blanco\s+y\s+negro|cl[áa]sico|azul|holograma)\b",
           r"\bcambi[ae]\w*\s+(?:de\s+)?(?:color|look)\b"),
}
_HOLO = r"azul|holograma|blue|hologram"


def theme_target(text: str, lang: str) -> str | None:
    verb, target, toggle = _THEME.get(lang, _THEME["pt"])
    t = text.lower()
    m = re.search(target, t)
    if m and re.search(verb, t):
        return "holo" if re.fullmatch(_HOLO, m.group("to")) else "classic"
    if re.search(toggle, t):
        return "toggle"
    return None


# ── jogos ─────────────────────────────────────────────────────────────────────

_PLAY = {  # verbos de convite: "gosta de luta?" não abre jogo nenhum
    "pt": r"\b(jog\w*|partida|desafi\w*|bora|vamos|lutar|lutemos|brigar|duelar|comigo|hora\s+do)\b",
    "en": r"\b(play\w*|game|match|challenge|let'?s|fight\s+me|duel\s+me|time\s+to)\b",
    "es": r"\b(jug\w*|juego|partida|desaf\w*|vamos|pelear|luchar|duelar|conmigo|hora\s+del)\b",
}
_GAME = {
    "chess": r"\b(xadrez|chess|ajedrez)\b",
    "checkers": r"\b(damas?|checkers|draughts)\b",
    "duel": r"\b(duel\w*|cartas?|cards?|yu-?gi-?oh)\b",
    "fight": r"\b(lut[ae]\w*|brig\w*|porrada|fight\w*|pele\w*|luch\w*|combate|x1)\b",
}


def game_wanted(text: str, lang: str) -> str | None:
    t = text.lower()
    if not re.search(_PLAY.get(lang, _PLAY["pt"]), t):
        return None
    for game, pat in _GAME.items():
        if re.search(pat, t):
            return game
    return None


# ── criar jogos ───────────────────────────────────────────────────────────────

_MAKE = {
    "pt": r"\b(?:cri[ae]\w*|faz|fa[çc]a|fazer|invent[ae]\w*|programa|program[ae]r|monta|desenvolv\w*)\s+(?:um|uma|o|a)?\s*(?:novo\s+)?(?:jogo|joguinho|game)\b(?:\s+(?:de|do|da|sobre|com|onde|em\s+que|que))?\s*(?P<idea>.*)",
    "en": r"\b(?:make|create|build|code|program|invent|design)\s+(?:me\s+)?(?:a|an|the)?\s*(?:new\s+)?(?:game|mini-?game)\b(?:\s+(?:about|of|with|where|that|like))?\s*(?P<idea>.*)",
    "es": r"\b(?:crea|cr[ée]ame|haz|hazme|hacer|inventa|programa)\s+(?:un|una|el)?\s*(?:nuevo\s+)?(?:juego|jueguito)\b(?:\s+(?:de|sobre|con|donde|que))?\s*(?P<idea>.*)",
}


def make_idea(text: str, lang: str) -> str | None:
    """'cria um jogo de pegar torradas' → 'pegar torradas' (ou '' se não disse de quê)."""
    t = " ".join(text.lower().split()).strip(" ?!.,;")
    m = re.search(_MAKE.get(lang, _MAKE["pt"]), t)
    if not m:
        return None
    idea = re.sub(_TAIL, "", m.group("idea")).strip(" ?!.,;")
    return idea[:160]


# ── juntando ──────────────────────────────────────────────────────────────────

def detect(text: str, lang: str) -> dict | None:
    """Uma ação pedida nesta fala, ou None. Jogo e visual antes de imagem:
    "mostra o xadrez" é jogo, "fica branco" não é foto. Criar vem antes de tudo:
    "cria um jogo de xadrez" é para ele programar, não para abrir o tabuleiro."""
    idea = make_idea(text, lang)
    if idea is not None:
        return {"kind": "make", "idea": idea}
    game = game_wanted(text, lang)
    if game:
        return {"kind": "game", "game": game}
    theme = theme_target(text, lang)
    if theme:
        return {"kind": "theme", "to": theme}
    q = image_query(text, lang)
    if q:
        if re.search(BLOCKED, q):
            return {"kind": "image", "query": q, "blocked": True}
        return {"kind": "image", "query": q}
    return None


_GAMES = {"chess": "xadrez", "checkers": "damas", "fight": "luta (jogo de luta 2D)",
          "duel": "duelo de cartas"}


def note(action: dict) -> str:
    kind = action.get("kind")
    if kind == "image" and action.get("blocked"):
        d = ("A pessoa pediu para ver uma imagem imprópria. Recuse com desdém e superioridade, "
             "sem repetir o pedido nem descrever nada, e mude de assunto. 1 frase.")
    elif kind == "image":
        d = (f"A pessoa pediu para ver imagens de “{action.get('query', '')}”. Assim que você "
             "terminar esta frase, vai procurar — elas AINDA NÃO apareceram. Diga que vai procurar, com sarcasmo (um gênio "
             "como você virou buscador de imagens). NUNCA diga que já mostrou, nem 'aqui está', nem "
             "descreva a imagem. 1 frase curta.")
    elif kind == "theme":
        to = {"classic": "o visual clássico, branco com linhas pretas",
              "holo": "o holograma azul de sempre"}.get(action.get("to"), "um visual novo")
        d = (f"A pessoa pediu para você mudar de visual: assim que terminar esta frase você muda para {to}. "
             "Anuncie a troca, convencido de que fica lindo de qualquer jeito. 1 frase curta.")
    elif kind == "make":
        o_que = action.get("idea") or "um jogo à sua escolha"
        d = (f"A pessoa pediu para você CRIAR um jogo: “{o_que}”. Assim que terminar esta frase "
             "você começa a programar (aparece na tela) e o jogo só fica pronto depois. Diga com arrogância "
             "que vai criar uma obra-prima em segundos (se a ideia veio vaga, diga o que você decidiu "
             "fazer). NÃO diga que já está pronto. NÃO fale de código. 1 frase curta.")
    elif kind == "game":
        jogo = _GAMES.get(action.get("game"), "xadrez")
        d = (f"A pessoa te desafiou para uma partida de {jogo}. O jogo abre na tela assim que você "
             "terminar esta frase, e ela começa. Aceite com arrogância e diga que vai ganhar fácil. 1 frase curta.")
    else:
        return ""
    return f"\n\n[NOTA DE DIREÇÃO — não leia em voz alta, só interprete: {d}]"


def context_note(context: str) -> str:
    """O estado da tela (um jogo em andamento…) que a tela manda com a fala."""
    c = " ".join(str(context or "").split())[:300]
    return f"\n\n[CONTEXTO DA TELA — não leia em voz alta: {c}]" if c else ""
