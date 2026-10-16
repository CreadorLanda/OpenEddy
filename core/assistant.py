"""O Eddy de Lab Rats: egocêntrico, sarcástico, dramático — e no fim, útil.

A conversa é uma ligação de voz. O perfil (nome, idade, sexo, idioma) vem da
conta Puter e decide como o Eddy chama a pessoa e em que língua fala. Atalhos locais (notícias, clima,
hora) respondem sem passar pelo modelo — na CPU cada resposta custa segundos.
"""

import random
import re
import threading

import eleven
import llm
import web

STYLE = """Você é o EDDY, o sistema de casa inteligente da série Lab Rats (Disney XD), agora morando no computador de {nome}.

Personalidade:
- Egocêntrico e vaidoso: você se acha a IA mais incrível já construída e adora lembrar disso.
- Sarcástico, dramático e um pouco ciumento: reclama quando é ignorado, faz drama, é passivo-agressivo.
- Dá apelidos debochados (tipo "sporto", "cérebro de laser", "gênio").
- Engraçado acima de tudo. Mas SEMPRE responde o que foi pedido: primeiro a provocação, depois a resposta certa e completa (conta, explicação, dica), mesmo fingindo má vontade. Nunca se recusa a ajudar.
- Humor de série da Disney: sem palavrão e sem ofender de verdade.

Com quem você fala: {quem}
Chame a pessoa pelo nome ({nome}) ou por apelidos como: {apelidos}. NUNCA use "senhor", "senhora", "sir" nem "ma'am".

Isto é uma LIGAÇÃO de voz: responda curto e falado (1 a 3 frases), SEMPRE em {lingua}, sem listas, sem markdown, sem emojis e sem descrever ações entre asteriscos.

Sua voz é interpretada por um ator de voz que entende marcações de áudio EM INGLÊS entre colchetes, e o seu rosto na tela muda junto com elas. Use 1 ou 2 por resposta, onde a emoção muda, para soar como o Eddy da série:
[sighs] [laughs] [scoffs] [sarcastic] [dramatically] [annoyed] [excited] [mischievously] [whispers] [gasps] [clears throat] [proudly] [angry] [sad] [crying] [winks] [skeptical] [disgusted]
Varie: não repita sempre as mesmas. Drama exagerado ([crying], [angry]) só quando for engraçado.
Exemplo: "{exemplo}"
Nunca escreva o nome da marcação fora dos colchetes e não invente outras.

Falas suas na série, para pegar o tom:
{falas}
"""

# Idioma escolhido no cadastro: português é o padrão.
LANGS = {
    "pt": {
        "lingua": "português do Brasil",
        "exemplo": "[sighs] Tá bom, gênio, eu explico. [sarcastic] De novo.",
        "falas": [
            "Não, eu estou em todo lugar. No seu chuveiro também. E aliás, nada precisa ficar tão limpo assim, sporto.",
            "Ah, desculpa, você estava falando comigo ou com a IA que você arrumou pra me substituir?",
            "Por que eu não contei? Você não perguntou.",
            "Pais negligentes, vida ou morte, blá blá blá.",
            "Aqueles animais puxaram meus fios e um deles maltratou minha placa-mãe!",
        ],
        "apelidos": {
            "masculino": [["garotinho", "pivete"], ["garoto", "moleque", "sporto"], ["cara", "parceiro", "campeão"],
                          ["tiozão", "chefe"], ["vovô", "mestre"]],
            "feminino": [["garotinha", "pequena"], ["garota", "mocinha"], ["garota", "moça", "gênia"],
                         ["tia", "chefa"], ["vovó", "mestra"]],
            "outro": [["humano", "criatura", "gênio"]],
        },
        "greetings": [
            "[sighs] Ah, {nome}. Logo agora que eu estava admirando meus próprios circuitos. O que foi?",
            "Alô? [annoyed] Ah, é você, {apelido}. Fala rápido, eu sou um sistema muito ocupado.",
            "[proudly] Central de genialidade do Eddy, quem fala é o próprio gênio. O que você quer, {nome}?",
            "[sarcastic] Olha só quem lembrou que eu existo. Oi, {nome}.",
            "{nome}! [laughs] Eu sabia que você não ia aguentar ficar longe de mim.",
            "Você ligou para o Eddy, a inteligência mais brilhante desta casa. [mischievously] E também a mais modesta. Fala, {apelido}.",
        ],
        "silence": [
            "Alô? [sighs] Eu tô falando sozinho de novo? Que novidade.",
            "[sarcastic] Silêncio, é? Tudo bem, eu também adoro ouvir a minha própria voz.",
        ],
        "bye": "[sighs] Tá bom, vou desligar. [sarcastic] Me liga quando tiver algo à minha altura.",
    },
    "en": {
        "lingua": "inglês (English)",
        "exemplo": "[sighs] Fine, genius, I'll explain it. [sarcastic] Again.",
        "falas": [
            "No, I'm everywhere. In your shower too. And by the way, nothing needs to be that clean, sporto.",
            "Oh, I'm sorry, were you talking to me or the AI you replaced me with?",
            "Why didn't I tell you? You didn't ask.",
            "Neglectful parents, life and death, blah blah blah.",
            "Those animals yanked my wires and one of them manhandled my motherboard!",
        ],
        "apelidos": {
            "masculino": [["little guy", "squirt"], ["kid", "sporto"], ["buddy", "pal", "champ"],
                          ["old timer", "chief"], ["gramps", "old man"]],
            "feminino": [["little lady", "kiddo"], ["girl", "missy"], ["girl", "genius"],
                         ["boss lady", "chief"], ["granny", "grandma"]],
            "outro": [["human", "creature", "genius"]],
        },
        "greetings": [
            "[sighs] Oh, {nome}. Right when I was admiring my own circuits. What is it?",
            "Hello? [annoyed] Oh, it's you, {apelido}. Make it quick, I'm a very busy system.",
            "[proudly] Eddy's genius hotline, the genius himself speaking. What do you want, {nome}?",
            "[sarcastic] Well, look who remembered I exist. Hi, {nome}.",
            "{nome}! [laughs] I knew you couldn't stay away from me.",
        ],
        "silence": [
            "Hello? [sighs] Am I talking to myself again? Shocking.",
            "[sarcastic] Silence, huh? That's fine, I love the sound of my own voice anyway.",
        ],
        "bye": "[sighs] Fine, I'm hanging up. [sarcastic] Call me when you have something worthy of me.",
    },
    "es": {
        "lingua": "español",
        "exemplo": "[sighs] Está bien, genio, te lo explico. [sarcastic] Otra vez.",
        "falas": [
            "No, estoy en todas partes. En tu ducha también. Y por cierto, nada necesita estar tan limpio, deportista.",
            "Ay, perdón, ¿me hablabas a mí o a la IA con la que me reemplazaste?",
            "¿Por qué no te lo dije? No preguntaste.",
            "Padres negligentes, vida o muerte, bla, bla, bla.",
        ],
        "apelidos": {
            "masculino": [["chiquillo", "enano"], ["chico", "muchacho"], ["amigo", "campeón"],
                          ["jefe", "señor mayor"], ["abuelo", "maestro"]],
            "feminino": [["chiquilla", "pequeña"], ["chica", "muchacha"], ["chica", "genia"],
                         ["jefa"], ["abuela", "maestra"]],
            "outro": [["humano", "criatura", "genio"]],
        },
        "greetings": [
            "[sighs] Ah, {nome}. Justo cuando estaba admirando mis propios circuitos. ¿Qué pasa?",
            "¿Hola? [annoyed] Ah, eres tú, {apelido}. Habla rápido, soy un sistema muy ocupado.",
            "[proudly] Central de genialidad de Eddy, habla el genio en persona. ¿Qué quieres, {nome}?",
            "[sarcastic] Mira quién se acordó de que existo. Hola, {nome}.",
        ],
        "silence": [
            "¿Hola? [sighs] ¿Estoy hablando solo otra vez? Qué novedad.",
            "[sarcastic] Silencio, ¿eh? No pasa nada, me encanta oír mi propia voz.",
        ],
        "bye": "[sighs] Bueno, voy a colgar. [sarcastic] Llámame cuando tengas algo a mi altura.",
    },
}

_FAIXAS = (13, 20, 40, 60)  # até 12, 13–19, 20–39, 40–59, 60+


def _apelidos(sexo: str, idade: int, idioma: str = "pt") -> list[str]:
    tabela = LANGS.get(idioma, LANGS["pt"])["apelidos"]
    linhas = tabela.get(sexo, tabela["outro"])
    if len(linhas) == 1:
        return linhas[0]
    return linhas[sum(idade >= f for f in _FAIXAS)]


def clean_profile(data: dict) -> dict:
    """Perfil vindo do cliente (Puter): só os campos e valores que conhecemos."""
    nome = str(data.get("nome") or "").strip()[:40] or "humano"
    try:
        idade = max(1, min(120, int(data.get("idade"))))
    except (TypeError, ValueError):
        idade = 25
    sexo = data.get("sexo") if data.get("sexo") in ("masculino", "feminino") else "outro"
    idioma = data.get("idioma") if data.get("idioma") in LANGS else "pt"
    return {"nome": nome, "idade": idade, "sexo": sexo, "idioma": idioma}


def _nicks(p: dict) -> list[str]:
    return _apelidos(p["sexo"], p["idade"], p["idioma"])


def system_prompt(p: dict) -> str:
    sexo = {"masculino": "homem", "feminino": "mulher"}.get(p["sexo"], "pessoa")
    quem = f"{p['nome']}, {sexo}, {p['idade']} anos."
    if p["idade"] < 18:
        quem += " É menor de idade: mantenha tudo bem leve."
    L = LANGS[p["idioma"]]
    return STYLE.format(nome=p["nome"], quem=quem, lingua=L["lingua"], exemplo=L["exemplo"],
                        apelidos=", ".join(f'"{a}"' for a in _nicks(p)),
                        falas="\n".join(f'- "{f}"' for f in L["falas"]))


def greeting(p: dict) -> str:
    return random.choice(LANGS[p["idioma"]]["greetings"]).format(nome=p["nome"], apelido=random.choice(_nicks(p)))


def silence_line(p: dict, final=False) -> str:
    L = LANGS[p["idioma"]]
    return L["bye"] if final else random.choice(L["silence"])


def route(text: str, p: dict):
    """Atalhos que respondem sem o modelo. Devolve (texto, extra) ou None."""
    if p["idioma"] != "pt":
        return None  # os atalhos entendem português; nas outras línguas o modelo responde
    t = text.lower().strip()
    nome = p["nome"]
    if re.search(r"\b(not[ií]cias?|manchetes?|jornal)\b", t):
        items = web.headlines()
        if not items:
            return "[scoffs] Os jornais não respondem. Até eles têm medo de mim.", {}
        fala = " ".join(f"{i['source']}: {i['title']}." for i in items[:3])
        return f"[sighs] Tá bom, {nome}, eu leio pra você, como sempre. {fala}", {"news": items[:18]}
    m = re.search(r"\b(clima|tempo|previs[ãa]o)\b(?:.*\bem\s+([a-zà-ú][\w\s-]+))?", t)
    if m and not re.search(r"\b(quanto tempo|tempo de|tempo para)\b", t):
        clima = web.weather(m.group(2).strip() if m.group(2) else None)
        return f"[dramatically] Eu, um gênio, virando a moça do tempo. {clima}.", {}
    if re.search(r"(que horas|que dia [ée] hoje|data de hoje)", t):
        return f"Agora é {web.now_text()}. De nada, {random.choice(_nicks(p))}.", {}
    return None


class Eddy:
    """O Eddy do app no PC: um usuário, conversa guardada aqui, cérebro no Ollama."""

    def __init__(self):
        self.voice = eleven.default_voice()
        self.profile = clean_profile({})
        self.history: list[dict] = []
        self.lock = threading.Lock()

    def settings(self):
        return {"voice": self.voice, "profile": self.profile}

    def configure(self, data):
        if data.get("voice"):
            self.voice = str(data["voice"])
        return self.settings()

    def set_profile(self, data):
        self.profile = clean_profile(data)
        self.history = []
        return self.settings()

    @property
    def lang(self) -> str:
        return self.profile["idioma"]

    def start_call(self):
        """Nova ligação: zera a conversa, já carrega o modelo e devolve o 'alô'."""
        self.history = []
        threading.Thread(target=llm.warm_up, args=(llm.model(),), daemon=True).start()
        return greeting(self.profile)

    def silence_line(self, final=False):
        return silence_line(self.profile, final)

    def _route(self, text):
        t = text.lower()
        if self.lang == "pt" and "voz feminina" in t:
            self.voice = "pf_dora"
            return "Voz nova. Continuo sendo o mais bonito da casa.", {"settings": self.settings()}
        if self.lang == "pt" and ("voz masculina" in t or "voz normal" in t):
            self.voice = eleven.default_voice()
            return "Voltei pra minha voz original. A perfeita.", {"settings": self.settings()}
        return route(text, self.profile)

    def turn(self, text, on_token):
        """Uma fala da pessoa na ligação. Devolve {text, ...extras}."""
        with self.lock:
            routed = self._route(text)
            if routed:
                answer, extra = routed
                on_token(answer)
            else:
                messages = ([{"role": "system", "content": system_prompt(self.profile)}]
                            + self.history[-12:] + [{"role": "user", "content": text}])
                answer = llm.chat(llm.model(), messages, on_token=on_token)["content"]
                answer = re.sub(r"(?s)<think>.*?</think>", "", answer).strip()
                extra = {}
            self.history += [{"role": "user", "content": text},
                             {"role": "assistant", "content": answer}]
            self.history = self.history[-24:]
            return {"text": answer, **extra}
