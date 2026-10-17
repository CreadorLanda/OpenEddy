.PHONY: test test-python test-app build

# Testes do núcleo Python (só stdlib + numpy, nenhuma chamada para fora).
test-python:
	python3 -m unittest discover -s tests -t .

# Testes do app: fila de fala, cancelamento, ouvido do navegador e expressões.
test-app:
	npm test --prefix app

test: test-python test-app

build:
	npm run build --prefix app