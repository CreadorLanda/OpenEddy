#!/usr/bin/env python3
"""Gera os ícones do app (o rosto-E do Eddy) sem dependências além do numpy.

  ../.venv/bin/python scripts/gen_icons.py
"""

import os
import struct
import zlib

import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src-tauri", "icons")


def seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(px - ax - t * dx, py - ay - t * dy)


def arc(px, py, cx, cy, r, upper=True):
    """Distância a um semicírculo (de cima se upper, senão de baixo)."""
    d = np.abs(np.hypot(px - cx, py - cy) - r)
    side = (py <= cy) if upper else (py >= cy)
    ends = np.minimum(np.hypot(px - cx + r, py - cy), np.hypot(px - cx - r, py - cy))
    return np.where(side, d, ends)


def render(size):
    s = size / 360.0
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    px, py = (x + 0.5) / s + 10, (y + 0.5) / s - 6  # espaço de desenho 360×360, centrado

    def ink(dist, w):
        return np.clip((w / 2 - dist) * s + 0.5, 0, 1)

    head = np.minimum.reduce([
        seg(px, py, 268, 300, 112, 300),
        seg(px, py, 112, 300, 112, 118),
        arc(px, py, 192, 118, 80),
        seg(px, py, 112, 212, 248, 212),
    ])
    a = ink(head, 26)
    thin = np.minimum.reduce([
        seg(px, py, 150, 220, 190, 262), seg(px, py, 230, 220, 190, 262),
        seg(px, py, 190, 262, 190, 300),
        arc(px, py, 160, 112, 21), seg(px, py, 139, 112, 181, 112),
        arc(px, py, 220, 112, 21), seg(px, py, 199, 112, 241, 112),
        seg(px, py, 150, 146, 232, 146), arc(px, py, 191, 146, 41, upper=False),
    ])
    a = np.maximum(a, ink(thin, 9 if size >= 64 else 14))

    # fundo: quadrado arredondado azul-noite
    r = 0.22 * size
    qx = np.maximum(np.abs(x + 0.5 - size / 2) - (size / 2 - r), 0)
    qy = np.maximum(np.abs(y + 0.5 - size / 2) - (size / 2 - r), 0)
    bg = np.clip(r - np.hypot(qx, qy) + 0.5, 0, 1)
    glow = np.exp(-((x - size / 2) ** 2 + (y - size * 0.45) ** 2) / (2 * (size * 0.35) ** 2))
    base = np.stack([8 + 18 * glow, 14 + 30 * glow, 24 + 46 * glow], -1)
    cyan = np.array([110, 228, 255])
    rgb = base * (1 - a[..., None]) + cyan * a[..., None]
    rgba = np.concatenate([rgb, (bg * 255)[..., None]], -1).clip(0, 255).astype(np.uint8)
    return rgba


def png(path, img):
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[i].tobytes() for i in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, size in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256),
                       ("icon.png", 512)]:
        png(os.path.join(OUT, name), render(size))
    print("ícones em", os.path.abspath(OUT))
