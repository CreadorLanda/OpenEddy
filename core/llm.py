"""Cliente mínimo do Ollama (stdlib apenas) e gestão do `ollama serve`."""

import atexit
import json
import os
import subprocess
import time
import urllib.error
import urllib.request

from config import HOME, MODEL, OLLAMA_BIN, OLLAMA_URL

_spawned: subprocess.Popen | None = None

def _get(path, timeout=3):
    with urllib.request.urlopen(f"{OLLAMA_URL}{path}", timeout=timeout) as r:
        return json.loads(r.read())


def alive() -> bool:
    try:
        _get("/api/version", timeout=1.5)
        return True
    except Exception:
        return False


def ensure_running(wait=20.0) -> bool:
    """Sobe o ollama empacotado em open-eddy/bin se ninguém estiver servindo."""
    global _spawned
    if alive():
        return True
    if _spawned is None and os.path.exists(OLLAMA_BIN):
        env = dict(os.environ)
        env.setdefault("OLLAMA_HOST", OLLAMA_URL.split("://", 1)[-1])
        _spawned = subprocess.Popen(
            [OLLAMA_BIN, "serve"],
            cwd=HOME,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=open(os.path.join(HOME, "serve.log"), "ab"),
        )
        atexit.register(_spawned.terminate)
    deadline = time.time() + wait
    while time.time() < deadline:
        if alive():
            return True
        time.sleep(0.4)
    return False


_models_cache: tuple[float, list[str]] = (0.0, [])


def models() -> list[str]:
    global _models_cache
    if time.time() - _models_cache[0] < 30:
        return _models_cache[1]
    try:
        names = sorted(m["name"] for m in _get("/api/tags")["models"])
    except Exception:
        return []
    _models_cache = (time.time(), names)
    return names


def model() -> str:
    return MODEL


def warm_up(name: str):
    """Carrega o modelo na RAM (enquanto o telefone toca)."""
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=json.dumps({"model": name, "keep_alive": "30m"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=120).read()
    except Exception:
        pass


def chat(model, messages, tools=None, on_token=None, should_stop=None, timeout=600, options=None):
    """Chama /api/chat em streaming.

    Devolve {"content": str, "tool_calls": [...]} — os tokens de texto vão
    sendo entregues a `on_token` conforme chegam.
    """
    # keep_alive: recarregar um 8B na CPU leva dezenas de segundos.
    body = {"model": model, "messages": messages, "stream": True, "think": False,
            "keep_alive": "30m"}
    if tools:
        body["tools"] = tools
    if options:
        body["options"] = options
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    content, calls = [], []
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ollama: {e.read().decode(errors='replace')[:200]}") from e
    with r:
        for line in r:
            if should_stop and should_stop():
                break
            line = line.strip()
            if not line:
                continue
            chunk = json.loads(line)
            if chunk.get("error"):
                raise RuntimeError(f"ollama: {chunk['error']}")
            msg = chunk.get("message") or {}
            tok = msg.get("content") or ""
            if tok:
                content.append(tok)
                if on_token:
                    on_token(tok)
            calls += msg.get("tool_calls") or []
    return {"content": "".join(content).strip(), "tool_calls": calls}
