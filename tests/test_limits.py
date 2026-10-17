"""Os limites de `core/limits.py`: balde de fichas e semáforo.

Nada de `sleep` aqui — o relógio vai por argumento, então os testes dizem
exactamente quando o balde enche.
"""

import threading
import unittest

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
