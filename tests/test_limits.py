"""Os limites de `core/limits.py`: balde de fichas e semáforo.

Nada de `sleep` aqui — o relógio vai por argumento, então os testes dizem
exactamente quando o balde enche.
"""

import threading
import unittest
from unittest import mock

import limits


class Relogio:
    """Um relógio que só anda quando alguém lhe manda."""

    def __init__(self, t=1000.0):
        self.agora = t

    def __call__(self):
        return self.agora

    def passa(self, segundos):
        self.agora += segundos


class RateLimitTest(unittest.TestCase):
    def setUp(self):
        self.relogio = Relogio()
        self.limite = limits.RateLimit(3, 1.0, relogio=self.relogio)

    def burst(self, vezes, chave="zeca"):
        return [self.limite.pega(chave)[0] for _ in range(vezes)]

    def test_a_rajada_inteira_passa(self):
        self.assertEqual(self.burst(3), [True, True, True])

    def test_a_ficha_seguinte_e_recusada(self):
        self.burst(3)
        pode, espera = self.limite.pega("zeca")
        self.assertFalse(pode)
        self.assertAlmostEqual(espera, 1.0)

    def test_o_balde_enche_com_o_tempo(self):
        self.burst(3)
        self.relogio.passa(0.5)
        self.assertFalse(self.limite.pega("zeca")[0])
        self.relogio.passa(0.5)  # mais meia ficha: chega a uma
        self.assertTrue(self.limite.pega("zeca")[0])
        self.assertFalse(self.limite.pega("zeca")[0])

    def test_o_balde_nao_enche_para_bem_dentro(self):
        """Uma rajada de 100 não pode virar 100 fichas só porque passou 100 s."""
        self.relogio.passa(1000)
        self.assertEqual(self.limite.fichas("zeca"), 3)

    def test_cada_pessoa_tem_o_seu_balde(self):
        self.burst(3, "zeca")
        self.assertFalse(self.limite.pega("zeca")[0])
        self.assertTrue(self.limite.pega("bruno")[0], "o bruno não entra na conta do zeca")

    def test_um_relogio_que_volta_para_tras_nao_da_fichas(self):
        self.burst(3)
        self.relogio.passa(-500)
        self.assertFalse(self.limite.pega("zeca")[0])

    def test_um_limite_sem_reposicao_e_absoluto(self):
        limite = limits.RateLimit(2, 0.0, relogio=self.relogio)
        self.assertEqual([limite.pega("zeca")[0] for _ in range(2)], [True, True])
        self.relogio.passa(3600)
        pode, espera = limite.pega("zeca")
        self.assertFalse(pode)
        self.assertEqual(espera, float("inf"))

    def test_as_chaves_que_ninguem_toca_desaparecem(self):
        """O dicionário dos baldes não pode crescer com cada pessoa que já passou
        por aqui. Um tecto de fichas para sempre não enche: quem volta começa de
        novo, como nasce."""
        limite = limits.RateLimit(1, 0.0, relogio=self.relogio)
        for i in range(limits.MAX_CHAVES):
            limite.pega(f"pessoa-{i}")
        self.assertEqual(len(limite._fichas), limits.MAX_CHAVES)
        self.relogio.passa(limits.DESCARTE_SEG + 1)
        limite.pega("outra")  # este pedido é o que dispara o descarte
        self.assertNotIn("pessoa-0", limite._fichas)
        self.assertTrue(limite.pega("pessoa-0")[0])

    def test_o_balde_so_cresce_aos_poucos(self):
        for i in range(limits.MAX_CHAVES - 1):
            self.limite.pega(f"pessoa-{i}")
        self.relogio.passa(limits.DESCARTE_SEG + 1)
        self.limite.pega("outra")
        self.assertIn("pessoa-0", self.limite._fichas, "ainda não é tempo de esquecer")

    def test_a_mesa_cheia_recusa_quem_chega_em_vez_de_crescer(self):
        """O tecto é duro: com `MAX_CHAVES` pessoas todas a usar, a
        chave nova é recusada e o dicionário não passa do tecto. Descarregar o
        balde de alguém para meter outro dava a uma enxurrada a forma de
        reiniciar os baldes dos outros."""
        limite = limits.RateLimit(1000, 1.0, relogio=self.relogio)
        for i in range(limits.MAX_CHAVES):
            self.assertTrue(limite.pega(f"pessoa-{i}")[0])
        self.assertEqual(len(limite._fichas), limits.MAX_CHAVES)
        self.relogio.passa(60)  # toda a gente continua a passar pelo servidor
        for i in range(limits.MAX_CHAVES):
            limite.pega(f"pessoa-{i}")
        pode, espera = limite.pega("a-que-chega")
        self.assertFalse(pode)
        self.assertGreater(espera, 0)
        self.assertEqual(len(limite._fichas), limits.MAX_CHAVES, "o tecto é o tecto")

    def test_a_mesa_cheia_nao_toca_no_balde_de_ninguem(self):
        limite = limits.RateLimit(1000, 1.0, relogio=self.relogio)
        for i in range(limits.MAX_CHAVES):
            limite.pega(f"pessoa-{i}")
        limite.pega("a-que-chega")  # recusada
        self.assertAlmostEqual(limite.fichas("pessoa-7"), 1000 - 1)
        self.assertTrue(limite.pega("pessoa-7")[0], "quem já estava cá continua a ter o seu balde")

    def test_a_espera_aponta_para_o_momento_em_que_a_mesa_abre(self):
        """A espera devolvida não é um número para encher: é o instante em que a
        chave mais antiga fica `DESCARTE_SEG` sem ninguém tocar nela — e, enquanto
        ninguém mexer na mesa nesse meio, é nesse instante mesmo que o pedido
        passa. Prometer 1 s mandava a pessoa voltar já e levar outra vez com o
        mesmo."""
        limite = limits.RateLimit(5, 1.0, relogio=self.relogio)
        for i in range(limits.MAX_CHAVES):
            limite.pega(f"pessoa-{i}")
        pode, espera = limite.pega("a-que-chega")
        self.assertFalse(pode)
        self.assertEqual(espera, limits.DESCARTE_SEG, "todas as chaves foram tocadas agora")
        self.relogio.passa(espera)
        self.assertTrue(limite.pega("a-que-chega")[0], "passado o tempo apontado, entra mesmo")

    def test_a_estimativa_move_se_alguem_voltar_a_usar_a_mesa(self):
        """A espera sai da mesa como ela está no instante do pedido. Se alguém
        voltar a usar uma das chaves entretanto, o relógio dessa recomeça e o
        espaço aparece mais tarde: por isso é uma estimativa, e não uma
        garantia. É o que vai no `Retry-After`, e está escrito como tal."""
        with mock.patch.object(limits, "MAX_CHAVES", 2):
            limite = limits.RateLimit(5, 1.0, relogio=self.relogio)
            limite.pega("ana")
            limite.pega("bruno")
            pode, espera = limite.pega("carlos")
            self.assertFalse(pode)
            self.assertAlmostEqual(espera, limits.DESCARTE_SEG)

            self.relogio.passa(1)
            limite.pega("ana")  # a ana volta: o relógio dela recomeça
            self.relogio.passa(1)
            limite.pega("bruno")  # e o do bruno também
            self.relogio.passa(espera - 2)

            self.assertFalse(limite.pega("carlos")[0],
                             "no instante apontado, com as duas chaves ainda em uso, continua cheio")
            _, nova = limite.pega("carlos")
            self.assertAlmostEqual(nova, 1.0, msg="a nova estimativa aponta para a ana, a mais antiga")
            self.relogio.passa(1)
            self.assertTrue(limite.pega("carlos")[0], "um segundo depois, já passa")

    def test_a_espera_encolhe_quando_ja_ha_alguem_pronto_a_sair(self):
        """Se uma das chaves está quase a ser descartada, o espaço abre antes do
        tecto — e a espera que se devolve é essa, não a maior possível."""
        limite = limits.RateLimit(5, 1.0, relogio=self.relogio)
        limite.pega("pessoa-0")
        self.relogio.passa(limits.DESCARTE_SEG - 10)  # a pessoa 0 está quase a cair
        for i in range(1, limits.MAX_CHAVES):
            limite.pega(f"pessoa-{i}")
        pode, espera = limite.pega("a-que-chega")
        self.assertFalse(pode)
        self.assertAlmostEqual(espera, 10.0)
        self.relogio.passa(10)
        self.assertTrue(limite.pega("a-que-chega")[0])

    def test_a_mesa_descongela_quando_a_gente_se_cansa(self):
        limite = limits.RateLimit(1, 0.0, relogio=self.relogio)
        for i in range(limits.MAX_CHAVES):
            limite.pega(f"pessoa-{i}")
        self.assertFalse(limite.pega("a-que-chega")[0])
        self.relogio.passa(limits.DESCARTE_SEG + 1)
        self.assertTrue(limite.pega("a-que-chega")[0], "espaço aberto, entra")
        self.assertEqual(len(limite._fichas), 1)


class SemaforoTest(unittest.TestCase):
    def test_o_numero_de_lugares_e_o_pedido(self):
        s = limits.Semaforo(2)
        self.assertTrue(s.adquirir())
        self.assertTrue(s.adquirir())
        self.assertFalse(s.adquirir(), "não há terceiro lugar")
        self.assertEqual(s.livres(), 0)

    def test_largar_da_de_volta_o_lugar(self):
        s = limits.Semaforo(1)
        s.adquirir()
        s.largar()
        self.assertTrue(s.adquirir())

    def test_largar_a_mais_nao_cria_lugares(self):
        """Um `finally` a mais não pode abrir a porta a mais do que a que havia."""
        s = limits.Semaforo(2)
        s.largar()
        s.largar()
        self.assertEqual(s.livres(), 2)
        self.assertEqual([s.adquirir() for _ in range(3)], [True, True, False])

    def test_um_semaforo_fechado_recusa_tudo(self):
        s = limits.Semaforo(0)
        self.assertFalse(s.adquirir())
        s.largar()
        self.assertEqual(s.livres(), 0)

    def test_o_lugar_que_da_falha_também_volta(self):
        """É isto que impede que uma exceção deixe o servidor mais estreito para
        sempre: `adquirir`/`largar` em `try/finally`."""
        s = limits.Semaforo(2)

        def trabalho():
            if not s.adquirir():
                return
            try:
                raise RuntimeError("a coisa lá de fora caiu")
            finally:
                s.largar()

        for _ in range(3):
            with self.assertRaises(RuntimeError):
                trabalho()
        self.assertEqual(s.livres(), 2)

    def test_o_semaforo_nao_da_o_mesmo_lugar_a_dois(self):
        """Seis a bater ao mesmo tempo a três lugares: três entram e ficam lá
        dentro até o teste mandar sair, três são recusados. Sem `sleep` — quem
        entra segura o lugar, e o teste só continua quando os seis decidiram."""
        s = limits.Semaforo(3)
        fechar = threading.Condition()
        largar = threading.Event()
        self.addCleanup(largar.set)
        dentro, fora = [], []

        def trabalho():
            entrou = s.adquirir()
            with fechar:
                (dentro if entrou else fora).append(1)
                fechar.notify_all()
            if not entrou:
                return
            largar.wait(5)  # segura o lugar: sem isto os três podiam sair já
            s.largar()

        threads = [threading.Thread(target=trabalho) for _ in range(6)]
        for t in threads:
            t.start()
        with fechar:
            self.assertTrue(fechar.wait_for(lambda: len(fora) == 3, 5),
                            f"os três de fora têm de ser recusados, veio {dentro} e {fora}")
        self.assertEqual(len(dentro), 3, "e enquanto isso os três de dentro ficam dentro")
        largar.set()
        for t in threads:
            t.join(10)
        self.assertEqual(s.livres(), 3, "todos os lugares voltaram")


if __name__ == "__main__":
    unittest.main()
