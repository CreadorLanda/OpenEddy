"""As notícias de `core/web.py`: tetos por fonte e teto do conjunto.

Um RSS responde em menos de um segundo ou não responde; o que interessava era
que três fontes em fila não segurassem um pedido durante três timeouts.
"""

import unittest
from unittest import mock

import web

RSS = """<rss><channel><item>
  <title>Título da notícia</title>
  <link>https://exemplo.pt/1</link>
  <description>Resumo.</description>
</item></channel></rss>"""


class Relogio:
    def __init__(self):
        self.agora = 100.0

    def __call__(self):
        return self.agora

    def passa(self, segundos):
        self.agora += segundos


class FonteTest(unittest.TestCase):
    def test_uma_fonte_bem_comportada_da_o_que_sempre_deu(self):
        with mock.patch.object(web, "http_get", return_value=RSS):
            itens = web._feed("G1", "https://exemplo.pt/rss")
        self.assertEqual([i["title"] for i in itens], ["Título da notícia"])
        self.assertEqual([i["source"] for i in itens], ["G1"])

    def test_uma_fonte_lenta_da_vazia_e_nao_levanta(self):
        """Sem notícias é melhor do que com um erro: o atalho diz que os
        jornais não respondem, e a pessoa continua a falar com o Eddy."""
        with mock.patch.object(web, "http_get", side_effect=TimeoutError("passou do tempo")):
            self.assertEqual(web._feed("G1", "https://exemplo.pt/rss"), [])

    def test_o_tecto_da_fonte_via_no_pedido_http(self):
        with mock.patch.object(web, "http_get", return_value=RSS) as pedir:
            web._feed("G1", "https://exemplo.pt/rss")
        self.assertEqual(pedir.call_args.args[1], web.FEED_TIMEOUT)
        self.assertLess(web.FEED_TIMEOUT, 12, "o valor por omissão de `http_get` são 12 s")


class HeadlinesTest(unittest.TestCase):
    def test_cada_fonte_recebe_o_seu_tecto(self):
        with mock.patch.object(web, "_feed", return_value=[]) as f:
            web.headlines()
        self.assertEqual([c.args[2] for c in f.call_args_list], [web.FEED_TIMEOUT] * 3)

    def test_o_tecto_do_conjunto_corta_as_fontes_restantes(self):
        relogio = Relogio()
        with mock.patch.object(web, "time", mock.Mock(monotonic=relogio)), \
                mock.patch.object(web, "_feed",
                                  side_effect=lambda *a: (relogio.passa(100), [])[1]) as f:
            self.assertEqual(web.headlines(), [])
        self.assertEqual(f.call_count, 1,
                         "a segunda fonte já não entra: o pedido inteiro já esperou o tecto")

    def test_a_fonte_seguinte_so_herda_o_que_falta_do_tecto(self):
        relogio = Relogio()
        vistos = []

        def gasta(_nome, _url, timeout):
            vistos.append(timeout)
            relogio.passa(10)  # já vão 10 dos 12 segundos
            return []

        with mock.patch.object(web, "time", mock.Mock(monotonic=relogio)), \
                mock.patch.object(web, "_feed", side_effect=gasta):
            web.headlines()
        self.assertEqual(vistos, [web.FEED_TIMEOUT, 2], "a última fonte fica com o que resta")

    def test_falar_duma_fonte_so_nao_desperta_as_outras(self):
        with mock.patch.object(web, "_feed", return_value=[]) as f:
            web.headlines(source="bbc")
        self.assertEqual([c.args[0] for c in f.call_args_list], ["BBC World"])


if __name__ == "__main__":
    unittest.main()
