"""Acesso à web usado pelo Eddy (notícias, clima)."""

import datetime
import html
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (X11; Linux x86_64) OpenEddy/1.0"

FEEDS = {
    "G1": "https://g1.globo.com/rss/g1/",
    "RTP": "https://www.rtp.pt/noticias/rss",
    "BBC World": "https://feeds.bbci.co.uk/news/world/rss.xml",
}

# Notícias: um RSS responde em menos de um segundo ou não responde. O teto por
# fonte é curto e há ainda um teto para as três em conjunto (ver `headlines`).
FEED_TIMEOUT = 5
HEADLINES_TIMEOUT = 12

WX = {0: "céu limpo", 1: "quase limpo", 2: "parcialmente nublado", 3: "nublado",
      45: "nevoeiro", 48: "nevoeiro com geada", 51: "garoa leve",
      53: "garoa", 55: "garoa forte", 61: "chuva fraca", 63: "chuva",
      65: "chuva forte", 71: "neve fraca", 73: "neve", 75: "neve forte",
      77: "granizo", 80: "pancadas leves", 81: "pancadas", 82: "pancadas fortes",
      95: "tempestade", 96: "tempestade com granizo", 99: "tempestade forte"}

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]
DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
        "sexta-feira", "sábado", "domingo"]


def http_get(url, timeout=12, data=None, binary=False, limit=3_000_000):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(limit)
        charset = r.headers.get_content_charset() or "utf-8"
    return raw if binary else raw.decode(charset, "replace")


def today_text() -> str:
    d = datetime.date.today()
    return f"{DIAS[d.weekday()]}, {d.day} de {MESES[d.month - 1]} de {d.year}"


def now_text() -> str:
    d = datetime.datetime.now()
    return (f"{DIAS[d.weekday()]}, {d.day} de {MESES[d.month - 1]} de {d.year}, "
            f"{d.strftime('%H:%M')}")


# ── notícias ──────────────────────────────────────────────────────────────────

def _feed(name, url, timeout=FEED_TIMEOUT):
    try:
        root = ET.fromstring(http_get(url, timeout))
    except Exception:
        return []
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        desc = re.sub("<[^>]+>", "", it.findtext("description") or "").strip()[:240]
        img = None
        for tag in ("{http://search.yahoo.com/mrss/}content",
                    "{http://search.yahoo.com/mrss/}thumbnail"):
            el = it.find(tag)
            if el is not None and el.get("url"):
                img = el.get("url")
                break
        if img is None:
            enc = it.find("enclosure")
            if enc is not None and (enc.get("type") or "").startswith("image"):
                img = enc.get("url")
        if title and link:
            items.append({"source": name, "title": html.unescape(title), "link": link,
                          "summary": html.unescape(desc), "image": img,
                          "published": (it.findtext("pubDate") or "").strip()})
    return items


def headlines(source: str | None = None, per_feed=8, timeout=FEED_TIMEOUT,
              total=HEADLINES_TIMEOUT):
    """Lê os três RSS, um a um, com dois tetos: `timeout` por fonte e `total`
    para as três em conjunto. Um jornal lento custa uns segundos; três em
    fila custavam até `3 × timeout` de um pedido só, e essa espera é a que
    prende a pessoa à frente do Eddy."""
    fim = time.monotonic() + total
    out = []
    for name, url in FEEDS.items():
        if source and source.lower() not in name.lower():
            continue
        resta = fim - time.monotonic()
        if resta <= 0:
            break
        out += _feed(name, url, min(timeout, resta))[:per_feed]
    return out


# ── clima ─────────────────────────────────────────────────────────────────────

def _geo_ip():
    try:
        d = json.loads(http_get("http://ip-api.com/json/?fields=status,lat,lon,city,country", 8))
        if d.get("status") == "success":
            return d["lat"], d["lon"], f"{d['city']} ({d['country']})"
    except Exception:
        pass
    return -8.84, 13.23, "Luanda"


def _geo_city(city):
    q = urllib.parse.urlencode({"name": city, "count": 1, "language": "pt"})
    d = json.loads(http_get(f"https://geocoding-api.open-meteo.com/v1/search?{q}", 8))
    r = (d.get("results") or [None])[0]
    if not r:
        raise ValueError(f"cidade não encontrada: {city}")
    return r["latitude"], r["longitude"], f"{r['name']} ({r.get('country', '')})"


def weather(city: str | None = None) -> str:
    lat, lon, place = _geo_city(city) if city else _geo_ip()
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           "&current=temperature_2m,weather_code,wind_speed_10m"
           "&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto")
    d = json.loads(http_get(url, 10))
    c, day = d["current"], d["daily"]
    return (f"{place}: {round(c['temperature_2m'])}°C, {WX.get(c['weather_code'], '—')}, "
            f"vento {round(c['wind_speed_10m'])} km/h; hoje entre "
            f"{round(day['temperature_2m_min'][0])} e {round(day['temperature_2m_max'][0])}°C")


# ── busca e leitura de páginas ────────────────────────────────────────────────

def search(query: str, n=6):
    """Busca no DuckDuckGo (versão HTML, sem chave de API)."""
    raw = http_get("https://html.duckduckgo.com/html/",
                   data=urllib.parse.urlencode({"q": query, "kl": "br-pt"}).encode())
    results = []
    for m in re.finditer(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>(.*?)'
        r'(?:<a[^>]+class="result__snippet"[^>]*>(.*?)</a>|</div>\s*</div>)',
        raw, re.S,
    ):
        href = html.unescape(m.group(1))
        if "uddg=" in href:
            href = urllib.parse.unquote(urllib.parse.parse_qs(
                urllib.parse.urlparse(href).query).get("uddg", [href])[0])
        if "duckduckgo.com/y.js" in href:  # anúncio
            continue
        strip = lambda s: html.unescape(re.sub("<[^>]+>", "", s or "")).strip()  # noqa: E731
        results.append({"title": strip(m.group(2)), "url": href, "snippet": strip(m.group(4))})
        if len(results) >= n:
            break
    return results


def page_text(url: str, limit=6000) -> str:
    if not re.match(r"^https?://", url):
        raise ValueError("só endereços http(s)")
    raw = http_get(url, timeout=15)
    title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    body = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>", " ", raw)
    body = re.sub(r"(?i)<br\s*/?>|</p>|</h\d>|</li>", "\n", body)
    body = html.unescape(re.sub(r"<[^>]+>", " ", body))
    body = re.sub(r"[ \t\r\f\v]+", " ", body)
    body = re.sub(r"\n\s*\n+", "\n", body).strip()
    head = f"# {html.unescape(title.group(1).strip())}\n" if title else ""
    return (head + body)[:limit]
