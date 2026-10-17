"""Limites de uso por pessoa e de concorrência.

Duas peças pequenas para o mesmo problema: um pedido a mais não pode ficar à
espera de ninguém, tem de ser recusado. `RateLimit` conta pedidos por chave (a
conta da pessoa) num balde de fichas; `Semaforo` limita quantas operações ao
mesmo tempo — sem fila, e sem prender quem não tem nada a ver.

Só stdlib. O relógio vem por argumento (`time.monotonic` por omissão) para os
testes serem determinísticos em vez de dependerem de `sleep`.
"""

import threading
import time

# Uma chave parada há tanto tempo já não interessa: volta ao balde cheio, que é
# como nasceria. `MAX_CHAVES` é o tecto duro: é o número máximo de chaves que
# chega a existir, não um aviso. Ver `RateLimit.pega`.
DESCARTE_SEG = 300.0
MAX_CHAVES = 1000
# O tecto do que se diz a quem chega com a mesa cheia: o tempo que uma chave
# parada demora a ser descartada. Ver `pega` — é um tecto, não uma garantia.
CHEIA_ESPERA = DESCARTE_SEG


class RateLimit:
    """Balde de fichas por chave: `capacidade` fichas guardadas e `por_segundo`
    fichas a encher. `pega()` devolve (True, 0) ou (False, segundos a esperar)."""

    def __init__(self, capacidade, por_segundo, relogio=time.monotonic):
        self.capacidade = float(capacidade)
        self.por_segundo = float(por_segundo)
        self._relogio = relogio
        self._fichas: dict[str, tuple[float, float]] = {}  # chave → (fichas, quando)
        self._lock = threading.Lock()

    def pega(self, chave):
        agora = self._relogio()
        with self._lock:
            conhecidos = self._fichas.get(chave)
            if conhecidos is None and len(self._fichas) >= MAX_CHAVES:
                self._descarta(agora)
                if len(self._fichas) >= MAX_CHAVES:
                    # Tecto duro, e com a mesa cheia o que se recusa é quem chega.
                    # Evitar o balde de alguém para meter outro seria uma porta
                    # aberta: uma enxurrada de chaves novas reiniciava os baldes
                    # dos outros e o limite deixava de valer. Assim ninguém
                    # perde o seu, e a mesa nunca passa de `MAX_CHAVES`.
                    #
                    # A espera que se devolve não é zero: com a mesa cheia não há
                    # ficha nenhuma a encher, e o que falta é espaço. Calcula-se
                    # com a mesa como ela está agora — a chave mais antiga fica
                    # `DESCARTE_SEG` sem ninguém tocar nela — e por isso é uma
                    # estimativa, não uma promessa: se alguém voltar a usar uma
                    # dessas chaves entretanto, o relógio dela recomeça e o espaço
                    # aparece mais tarde do que o que se disse. Fica sempre com o
                    # tecto `CHEIA_ESPERA` para não subestimar.
                    #
                    # E se as chaves que lá estão se continuarem a usar, o espaço
                    # não aparece sequer. Não há espera verdadeira a prometer nesse
                    # caso, e dizer 1 s seria pior do que dizer cinco minutos.
                    if self._fichas:
                        mais_velhe = min(quando for _, quando in self._fichas.values())
                        return False, min(CHEIA_ESPERA, max(0.0, mais_velhe + DESCARTE_SEG - agora))
                    return False, CHEIA_ESPERA
            fichas, quando = conhecidos if conhecidos else (self.capacidade, agora)
            fichas = min(self.capacidade, fichas + max(0.0, agora - quando) * self.por_segundo)
            if fichas >= 1:
                self._fichas[chave] = (fichas - 1, agora)
                return True, 0.0
            self._fichas[chave] = (fichas, agora)
            return False, self.espera(fichas)

    def espera(self, fichas=0.0):
        """Quantos segundos faltam para a chave ter uma ficha. Com `por_segundo`
        a zero o balde nunca enche: o limite é absoluto."""
        if self.por_segundo <= 0:
            return float("inf")
        return max(0.0, (1.0 - fichas) / self.por_segundo)

    def fichas(self, chave):
        with self._lock:
            return self._fichas.get(chave, (self.capacidade, 0.0))[0]

    def _descarta(self, agora):
        # `>=` e não `>`: uma chave parada há `DESCARTE_SEG` já está fora, e é
        # exactamente esse o instante que `pega` promete a quem foi recusado.
        for chave, (_, quando) in list(self._fichas.items()):
            if agora - quando >= DESCARTE_SEG:
                del self._fichas[chave]


class Semaforo:
    """No máximo `n` operações ao mesmo tempo. Sem fila: quem não entra recebe
    False logo, para não bloquear quem chegou depois. `largar()` nunca passa do
    `n`, mesmo que seja chamada a mais — um `finally` a mais não cria lugares."""

    def __init__(self, n):
        self.n = max(0, int(n))
        self._livres = self.n
        self._lock = threading.Lock()

    def adquirir(self):
        with self._lock:
            if self._livres <= 0:
                return False
            self._livres -= 1
            return True

    def largar(self):
        with self._lock:
            self._livres = min(self.n, self._livres + 1)

    def livres(self):
        with self._lock:
            return self._livres
