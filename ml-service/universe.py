"""
Tradable-securities universe registry.

Goal: signal coverage for any traded security, not a hardcoded watchlist.
Seeded from:
- SEC company_tickers.json — every US-listed ticker + issuer name (~10k), free
- A static global layer: major indices, FX pairs, futures, crypto

The registry is a table + loader, so a broader universe file (e.g. a paid
global listing) can be imported later without touching the pipeline. Symbol
extraction consults this registry at match time — cashtags always match;
bare tickers and issuer names match when they're in the registry.
"""

import json
import re

import httpx

import db

# SEC fair-access policy wants an identifying UA with a contact address.
USER_AGENT = "ClearLens Research research@clearlens.app"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

# Non-equity layer: indices, FX, futures, crypto (Yahoo-style symbols).
GLOBAL_LAYER: list[tuple[str, str, str, str]] = [
    # symbol, name, asset_class, region
    ("^GSPC", "S&P 500", "index", "US"), ("^IXIC", "Nasdaq Composite", "index", "US"),
    ("^DJI", "Dow Jones Industrial", "index", "US"), ("^RUT", "Russell 2000", "index", "US"),
    ("^VIX", "CBOE Volatility Index", "index", "US"),
    ("^FTSE", "FTSE 100", "index", "UK"), ("^GDAXI", "DAX", "index", "DE"),
    ("^FCHI", "CAC 40", "index", "FR"), ("^STOXX50E", "Euro Stoxx 50", "index", "EU"),
    ("^N225", "Nikkei 225", "index", "JP"), ("^HSI", "Hang Seng", "index", "HK"),
    ("000001.SS", "Shanghai Composite", "index", "CN"), ("^KS11", "KOSPI", "index", "KR"),
    ("^BSESN", "BSE Sensex", "index", "IN"), ("^NSEI", "Nifty 50", "index", "IN"),
    ("^BVSP", "Bovespa", "index", "BR"), ("^GSPTSE", "TSX Composite", "index", "CA"),
    ("^AXJO", "ASX 200", "index", "AU"), ("^MXX", "IPC Mexico", "index", "MX"),
    ("EURUSD=X", "Euro / US Dollar", "fx", "G10"), ("GBPUSD=X", "Pound / US Dollar", "fx", "G10"),
    ("USDJPY=X", "US Dollar / Yen", "fx", "G10"), ("USDCNY=X", "US Dollar / Yuan", "fx", "EM"),
    ("USDINR=X", "US Dollar / Rupee", "fx", "EM"), ("DX-Y.NYB", "US Dollar Index", "fx", "G10"),
    ("CL=F", "WTI Crude Oil", "future", "GLOBAL"), ("BZ=F", "Brent Crude", "future", "GLOBAL"),
    ("GC=F", "Gold", "future", "GLOBAL"), ("SI=F", "Silver", "future", "GLOBAL"),
    ("HG=F", "Copper", "future", "GLOBAL"), ("NG=F", "Natural Gas", "future", "GLOBAL"),
    ("ZW=F", "Wheat", "future", "GLOBAL"), ("ZC=F", "Corn", "future", "GLOBAL"),
    ("ZS=F", "Soybeans", "future", "GLOBAL"), ("KC=F", "Coffee", "future", "GLOBAL"),
    ("BTC-USD", "Bitcoin", "crypto", "GLOBAL"), ("ETH-USD", "Ethereum", "crypto", "GLOBAL"),
    ("SOL-USD", "Solana", "crypto", "GLOBAL"), ("XRP-USD", "XRP", "crypto", "GLOBAL"),
    ("TLT", "iShares 20+ Year Treasury ETF", "etf", "US"),
    ("SPY", "SPDR S&P 500 ETF", "etf", "US"), ("QQQ", "Invesco QQQ ETF", "etf", "US"),
]

# Common words that are also tickers — never match these bare (cashtag only).
_AMBIGUOUS = {
    "A", "ALL", "AN", "ARE", "AT", "BE", "BIG", "BY", "CAN", "CEO", "DAY", "DO",
    "EAT", "FOR", "GO", "GOOD", "HAS", "HE", "IT", "LOVE", "LOW", "MAIN", "NEW",
    "NEXT", "NOW", "ON", "ONE", "OPEN", "OR", "OUT", "PLAY", "REAL", "RIDE",
    "RUN", "SEE", "SHE", "SO", "TALK", "TECH", "THE", "TWO", "UP", "US", "WELL",
    "YOU", "AI", "EV", "GDP", "CPI", "ETF", "IPO", "FED", "NWS", "USA", "UK",
    # Found polluting the alpha panel — place names, headline words, acronyms
    "HERE", "WASH", "NYC", "HOPE", "PLAN", "CASH", "FUND", "TELL", "GAIN",
    "HEAT", "COLD", "WARM", "JOBS", "NICE", "PEAK", "EDGE", "PLUS", "SAFE",
    "FAST", "FREE", "LIVE", "MOVE", "RISE", "SELF", "TEAM", "TRUE", "TURN",
    "ICE", "WAR", "OIL", "GAS", "ARM", "KEY", "MAP", "NET", "SKY", "SUN",
    "TV", "EU", "UN", "AM", "PM", "GDPR", "DOE", "SEC", "IRS", "GOP",
}

_CASHTAG = re.compile(r"\$([A-Za-z]{1,6})(?:[.-][A-Za-z]{1,4})?\b")
_TICKERISH = re.compile(r"\b[A-Z]{2,6}\b")

# Issuer first-words too generic to treat as a company mention. Includes
# places, institutions, and headline vocabulary discovered polluting the
# alpha panel ("China" → CAAS, "Washington" → WASH, "House" → HODO,
# "Trump" → DJT, "Israel" → ISRLF).
_NAME_STOP = {
    "first", "best", "one", "two", "national", "united", "american", "america",
    "general", "energy", "trust", "global", "north", "south", "east", "west",
    "grand", "royal", "star", "summit", "unity", "next", "open", "core",
    "bright", "capital", "century", "city", "coastal", "community", "digital",
    "empire", "federal", "franklin", "future", "golden", "great", "green",
    "health", "home", "liberty", "life", "main", "pacific", "premier", "prime",
    "public", "pure", "real", "safe", "silver", "smart", "solar", "southern",
    "standard", "state", "sterling", "super", "texas", "union", "universal",
    "value", "victory", "vision", "world",
    # geography + politics that double as issuer names
    "china", "japan", "india", "israel", "brazil", "canada", "mexico",
    "germany", "france", "britain", "russia", "korea", "europe", "african",
    "washington", "boston", "chicago", "houston", "dallas", "denver",
    "phoenix", "atlanta", "miami", "seattle", "california", "hawaiian",
    "alaska", "london", "paris", "berlin", "trump", "house", "senate",
    # headline vocabulary + common person first-names among issuers
    "daily", "news", "times", "journal", "post", "media", "trade", "market",
    "stock", "power", "white", "black", "blue", "gold", "live", "storm",
    "fire", "water", "earth", "ocean", "river", "wind", "solar", "air",
    "ice", "snow", "rain", "spring", "summer", "winter", "autumn",
    "james", "john", "jack", "henry", "morgan", "charles", "franklin",
}

_tickers: set[str] = set()
_names: dict[str, str] = {}  # lowercased issuer name -> symbol
_name_pattern: re.Pattern | None = None


def seed(force: bool = False) -> int:
    """Populate the securities table. SEC fetch failures degrade to the static
    layer — the pipeline must boot offline."""
    conn = db.get_conn()
    conn.execute("""CREATE TABLE IF NOT EXISTS securities (
        symbol TEXT PRIMARY KEY, name TEXT, asset_class TEXT, region TEXT)""")
    have = conn.execute("SELECT COUNT(*) FROM securities").fetchone()[0]
    if have > 100 and not force:
        conn.close()
        return have

    rows: list[tuple[str, str, str, str]] = list(GLOBAL_LAYER)
    try:
        r = httpx.get(SEC_TICKERS_URL, headers={"User-Agent": USER_AGENT}, timeout=20)
        r.raise_for_status()
        for item in r.json().values():
            rows.append((item["ticker"], item["title"], "equity", "US"))
    except Exception as e:
        print(f"[universe] SEC roster fetch failed ({e!r}) — static layer only")

    conn.executemany(
        "INSERT OR REPLACE INTO securities (symbol, name, asset_class, region) VALUES (?,?,?,?)",
        rows,
    )
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM securities").fetchone()[0]
    conn.close()
    print(f"[universe] registry holds {n} securities")
    return n


NAME_MATCH_TOP = 700  # only the biggest issuers earn bare-name matching


def load():
    """Build in-memory match structures from the registry. Tickers match for
    the whole universe; issuer-name matching is restricted to the largest
    issuers (the SEC file is cap-ordered and rowid preserves it) — matching
    "Stock Yards Bancorp" on the word "Stock" taught us why."""
    global _tickers, _names, _name_pattern
    conn = db.get_conn()
    try:
        rows = conn.execute("SELECT symbol, name FROM securities ORDER BY rowid").fetchall()
    except Exception:
        rows = []
    conn.close()

    _tickers = set()
    _names = {}
    for idx, (sym, name) in enumerate(rows):
        bare = re.sub(r"[\^=.-].*$", "", sym) or sym
        if bare.isalpha() and 2 <= len(bare) <= 6:
            _tickers.add(bare.upper())
        if idx >= NAME_MATCH_TOP or not name or len(name) < 5:
            continue
        words = re.sub(r"[^A-Za-z0-9 ]", "", name).split()
        if not words:
            continue
        # The issuer's distinctive first word is how headlines name it
        # ("Tesla", "Nvidia"). SEC's file is ordered by market cap, so on a
        # collision the biggest issuer claims the handle. Matching is done
        # case-sensitively on the capitalized form, which is what keeps
        # "apple pie" from tagging AAPL.
        w0 = words[0]
        if len(w0) >= 4 and w0.lower() not in _NAME_STOP and w0.capitalize() not in _names:
            _names[w0.capitalize()] = sym
    if _names:
        alts = sorted((re.escape(k) for k in _names), key=len, reverse=True)[:12000]
        _name_pattern = re.compile(r"\b(" + "|".join(alts) + r")\b")
    else:
        _name_pattern = None


# A crypto cashtag means the coin, not whatever equity holds the bare ticker
# ($ETH is Ethereum, not Ethan Allen). Canonicalize to the -USD instruments.
_CRYPTO_CANON = {"BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD",
                 "XRP": "XRP-USD", "DOGE": "DOGE-USD", "ADA": "ADA-USD"}


def extract_symbols(text: str, max_symbols: int = 6) -> list[str]:
    """Cashtags, registry tickers, and issuer-name mentions in `text`."""
    if not text:
        return []
    out: set[str] = set()
    for m in _CASHTAG.finditer(text):
        sym = m.group(1).upper()
        out.add(_CRYPTO_CANON.get(sym, sym))
    for w in _TICKERISH.findall(text):
        if w in _tickers and w not in _AMBIGUOUS:
            out.add(w)
    if _name_pattern:
        for m in _name_pattern.finditer(text):
            sym = _names.get(m.group(1))
            if sym:
                out.add(sym)
    return sorted(out)[:max_symbols]


def lookup(symbol: str) -> dict | None:
    conn = db.get_conn()
    row = conn.execute(
        "SELECT symbol, name, asset_class, region FROM securities WHERE symbol = ? COLLATE NOCASE",
        (symbol,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None
