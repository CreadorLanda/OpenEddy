"""Testes do núcleo Python do Open Eddy.

Só stdlib (o próprio servidor web também é só stdlib): nada de rede, nada de
chave da ElevenLabs, nada de microfone. Os serviços de fora são dublês.

    python3 -m unittest discover -s tests -t .

Este arquivo roda antes de qualquer import do núcleo: `core/config.py` cria as
pastas de dados no `XDG_DATA_HOME`, e num teste isso tem de ir para um
diretório temporário, nunca para o `~/.local/share` de quem está a correr.
"""

import os
import sys
import tempfile

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "core"))

# tem de vir antes de importar config: as pastas de dados e os limites do
# servidor são lidos do ambiente quando o módulo entra.
_STATE = tempfile.mkdtemp(prefix="openeddy-tests-")
os.environ["XDG_DATA_HOME"] = os.path.join(_STATE, "data")

# Nenhum teste pode ver a chave de quem está a correr a suíte: `eleven_key()`
# guarda o resultado numa cache depois da primeira chamada, e sem esta linha ela
# ia buscar a chave ao cofre do sistema (secret-tool) e a rede.
import eleven  # noqa: E402

eleven._eleven_checked = True
eleven._eleven_key = None