"""Barramento de eventos: o servidor repassa tudo por SSE para as janelas."""

import queue
import threading
import time

_subs: list[queue.Queue] = []
_lock = threading.Lock()


def publish(kind: str, **data):
    ev = {"type": kind, "ts": time.time(), **data}
    with _lock:
        subs = list(_subs)
    for q in subs:
        try:
            q.put_nowait(ev)
        except queue.Full:
            pass  # janela travada não pode travar os bots


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=2000)
    with _lock:
        _subs.append(q)
    return q


def unsubscribe(q: queue.Queue):
    with _lock:
        if q in _subs:
            _subs.remove(q)
