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
USER_AGENT = "Artha Research research@artha.app"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

SEED_VERSION = 2  # bump to force a reseed on next boot

# ── Programmatic instrument spaces (universe v2) ────────────────────────────
# FX and futures are enumerable by construction — build them, don't list
# them. Global equities get a curated blue-chip layer per native exchange; a
# paid global listing would replace that block wholesale via the same loader.

_G10 = ["USD", "EUR", "JPY", "GBP", "CHF", "CAD", "AUD", "NZD"]
_EM_CCY = ["CNY", "INR", "BRL", "MXN", "KRW", "TWD", "SGD", "HKD", "SEK",
           "NOK", "DKK", "PLN", "TRY", "ZAR", "THB", "IDR", "MYR", "PHP",
           "ILS", "CZK", "HUF", "CLP", "COP", "PEN", "VND"]


def _fx_pairs() -> list[tuple[str, str, str, str]]:
    out = []
    for i, a in enumerate(_G10):
        for b in _G10[i + 1:]:
            out.append((f"{a}{b}=X", f"{a}/{b}", "fx", "G10"))
    for c in _EM_CCY:
        out.append((f"USD{c}=X", f"USD/{c}", "fx", "EM"))
    out.append(("DX-Y.NYB", "US Dollar Index", "fx", "G10"))
    return out


_FUTURES_V2 = [
    ("CL=F", "WTI Crude Oil"), ("BZ=F", "Brent Crude"), ("NG=F", "Natural Gas"),
    ("RB=F", "RBOB Gasoline"), ("HO=F", "Heating Oil"),
    ("GC=F", "Gold"), ("SI=F", "Silver"), ("HG=F", "Copper"),
    ("PL=F", "Platinum"), ("PA=F", "Palladium"),
    ("ZC=F", "Corn"), ("ZW=F", "Chicago Wheat"), ("KE=F", "KC Wheat"),
    ("ZS=F", "Soybeans"), ("ZM=F", "Soybean Meal"), ("ZL=F", "Soybean Oil"),
    ("ZO=F", "Oats"), ("ZR=F", "Rough Rice"),
    ("KC=F", "Coffee"), ("SB=F", "Sugar"), ("CC=F", "Cocoa"),
    ("CT=F", "Cotton"), ("OJ=F", "Orange Juice"), ("LBR=F", "Lumber"),
    ("LE=F", "Live Cattle"), ("GF=F", "Feeder Cattle"), ("HE=F", "Lean Hogs"),
    ("ES=F", "E-mini S&P 500"), ("NQ=F", "E-mini Nasdaq 100"),
    ("YM=F", "E-mini Dow"), ("RTY=F", "E-mini Russell 2000"),
    ("ZT=F", "2-Year T-Note"), ("ZF=F", "5-Year T-Note"),
    ("ZN=F", "10-Year T-Note"), ("ZB=F", "30-Year T-Bond"),
    ("6E=F", "Euro FX Futures"), ("6J=F", "Yen Futures"), ("6B=F", "Pound Futures"),
    ("6A=F", "Aussie Futures"), ("6C=F", "CAD Futures"), ("6M=F", "Peso Futures"),
    ("BTC=F", "Bitcoin Futures"), ("ETH=F", "Ether Futures"),
]

_CRYPTO_V2 = ["BTC", "ETH", "SOL", "XRP", "BNB", "ADA", "DOGE", "AVAX", "DOT",
              "LINK", "LTC", "UNI", "ATOM", "XLM", "NEAR", "APT", "ARB", "OP",
              "FIL", "ICP", "HBAR", "VET", "ALGO", "AAVE", "MKR", "INJ", "SUI",
              "SEI", "TIA", "IMX", "GRT", "SAND", "MANA", "AXS", "FTM", "RUNE"]

_INDICES_V2 = [
    ("^GSPC", "S&P 500", "US"), ("^IXIC", "Nasdaq Composite", "US"),
    ("^DJI", "Dow Jones Industrial", "US"), ("^RUT", "Russell 2000", "US"),
    ("^VIX", "CBOE Volatility Index", "US"), ("^NDX", "Nasdaq 100", "US"),
    ("^SOX", "PHLX Semiconductor", "US"),
    ("^FTSE", "FTSE 100", "UK"), ("^GDAXI", "DAX", "DE"), ("^FCHI", "CAC 40", "FR"),
    ("^STOXX50E", "Euro Stoxx 50", "EU"), ("^STOXX", "Stoxx Europe 600", "EU"),
    ("^AEX", "AEX", "NL"), ("^IBEX", "IBEX 35", "ES"), ("FTSEMIB.MI", "FTSE MIB", "IT"),
    ("^SSMI", "SMI", "CH"), ("^OMX", "OMX Stockholm 30", "SE"),
    ("^N225", "Nikkei 225", "JP"), ("^HSI", "Hang Seng", "HK"),
    ("000001.SS", "Shanghai Composite", "CN"), ("399001.SZ", "Shenzhen Component", "CN"),
    ("^KS11", "KOSPI", "KR"), ("^TWII", "TAIEX", "TW"),
    ("^BSESN", "BSE Sensex", "IN"), ("^NSEI", "Nifty 50", "IN"), ("^NSEBANK", "Nifty Bank", "IN"),
    ("^STI", "Straits Times", "SG"), ("^JKSE", "IDX Composite", "ID"),
    ("^AXJO", "ASX 200", "AU"), ("^NZ50", "NZX 50", "NZ"),
    ("^GSPTSE", "TSX Composite", "CA"), ("^BVSP", "Bovespa", "BR"),
    ("^MXX", "IPC Mexico", "MX"), ("^MERV", "Merval", "AR"),
    ("XU100.IS", "BIST 100", "TR"),
]

_GLOBAL_EQUITIES = [
    ("SHEL.L", "Shell", "UK"), ("AZN.L", "AstraZeneca", "UK"), ("HSBA.L", "HSBC Holdings", "UK"),
    ("ULVR.L", "Unilever", "UK"), ("BP.L", "BP", "UK"), ("GSK.L", "GSK", "UK"),
    ("RIO.L", "Rio Tinto", "UK"), ("LSEG.L", "London Stock Exchange Group", "UK"),
    ("REL.L", "RELX", "UK"), ("DGE.L", "Diageo", "UK"),
    ("MC.PA", "LVMH", "FR"), ("OR.PA", "L'Oreal", "FR"), ("TTE.PA", "TotalEnergies", "FR"),
    ("SAN.PA", "Sanofi", "FR"), ("AIR.PA", "Airbus", "FR"), ("SU.PA", "Schneider Electric", "FR"),
    ("RMS.PA", "Hermes", "FR"), ("ASML.AS", "ASML Holding", "NL"), ("ADYEN.AS", "Adyen", "NL"),
    ("INGA.AS", "ING Groep", "NL"),
    ("SAP.DE", "SAP", "DE"), ("SIE.DE", "Siemens", "DE"), ("ALV.DE", "Allianz", "DE"),
    ("DTE.DE", "Deutsche Telekom", "DE"), ("MBG.DE", "Mercedes-Benz Group", "DE"),
    ("BMW.DE", "BMW", "DE"), ("BAS.DE", "BASF", "DE"), ("RHM.DE", "Rheinmetall", "DE"),
    ("NESN.SW", "Nestle", "CH"), ("NOVN.SW", "Novartis", "CH"), ("ROG.SW", "Roche", "CH"),
    ("UBSG.SW", "UBS Group", "CH"),
    ("NOVO-B.CO", "Novo Nordisk", "DK"), ("ERIC-B.ST", "Ericsson", "SE"),
    ("VOLV-B.ST", "Volvo", "SE"), ("EQNR.OL", "Equinor", "NO"), ("NOKIA.HE", "Nokia", "FI"),
    ("7203.T", "Toyota Motor", "JP"), ("6758.T", "Sony Group", "JP"),
    ("9984.T", "SoftBank Group", "JP"), ("8306.T", "Mitsubishi UFJ", "JP"),
    ("6861.T", "Keyence", "JP"), ("8035.T", "Tokyo Electron", "JP"),
    ("7974.T", "Nintendo", "JP"), ("6501.T", "Hitachi", "JP"),
    ("0700.HK", "Tencent Holdings", "HK"), ("9988.HK", "Alibaba Group", "HK"),
    ("3690.HK", "Meituan", "HK"), ("1299.HK", "AIA Group", "HK"),
    ("1398.HK", "ICBC", "HK"), ("1211.HK", "BYD", "HK"),
    ("600519.SS", "Kweichow Moutai", "CN"), ("300750.SZ", "CATL", "CN"),
    ("RELIANCE.NS", "Reliance Industries", "IN"), ("TCS.NS", "Tata Consultancy Services", "IN"),
    ("HDFCBANK.NS", "HDFC Bank", "IN"), ("INFY.NS", "Infosys", "IN"),
    ("ICICIBANK.NS", "ICICI Bank", "IN"), ("BHARTIARTL.NS", "Bharti Airtel", "IN"),
    ("SBIN.NS", "State Bank of India", "IN"), ("LT.NS", "Larsen & Toubro", "IN"),
    ("TATAMOTORS.NS", "Tata Motors", "IN"),
    ("005930.KS", "Samsung Electronics", "KR"), ("000660.KS", "SK Hynix", "KR"),
    ("2330.TW", "TSMC", "TW"), ("2317.TW", "Hon Hai Precision", "TW"),
    ("BHP.AX", "BHP Group", "AU"), ("CBA.AX", "Commonwealth Bank", "AU"), ("CSL.AX", "CSL", "AU"),
    ("RY.TO", "Royal Bank of Canada", "CA"), ("TD.TO", "Toronto-Dominion Bank", "CA"),
    ("SHOP.TO", "Shopify", "CA"), ("ENB.TO", "Enbridge", "CA"),
    ("VALE3.SA", "Vale", "BR"), ("PETR4.SA", "Petrobras", "BR"), ("ITUB4.SA", "Itau Unibanco", "BR"),
    ("WALMEX.MX", "Walmart de Mexico", "MX"), ("NPN.JO", "Naspers", "ZA"),
    ("2222.SR", "Saudi Aramco", "SA"),
]


def _global_layer() -> list[tuple[str, str, str, str]]:
    rows: list[tuple[str, str, str, str]] = []
    rows += [(s, n, "index", r) for s, n, r in _INDICES_V2]
    rows += _fx_pairs()
    rows += [(s, n, "future", "GLOBAL") for s, n in _FUTURES_V2]
    rows += [(f"{c}-USD", c, "crypto", "GLOBAL") for c in _CRYPTO_V2]
    rows += [(s, n, "equity", r) for s, n, r in _GLOBAL_EQUITIES]
    rows += [("TLT", "iShares 20+ Year Treasury ETF", "etf", "US"),
             ("SPY", "SPDR S&P 500 ETF", "etf", "US"),
             ("QQQ", "Invesco QQQ ETF", "etf", "US")]
    return rows


# Superseded by _global_layer() — kept only until the next cleanup pass.
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
    seeded_version = conn.execute("PRAGMA user_version").fetchone()[0]
    if have > 100 and seeded_version >= SEED_VERSION and not force:
        conn.close()
        return have

    # Full rebuild: rowid order encodes priority (global layer, then SEC by
    # cap), and INSERT OR REPLACE over old rows would scramble it.
    conn.execute("DELETE FROM securities")
    rows: list[tuple[str, str, str, str]] = _global_layer()
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
    conn.execute(f"PRAGMA user_version = {int(SEED_VERSION)}")
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
    global _tickers, _names, _name_pattern, _symbols_seen
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
    # A fresh dict, not clear(): a thread that matched against the half-built
    # registry still holds the old dict, so its answer is thrown away.
    _symbols_seen = {}


# A crypto cashtag means the coin, not whatever equity holds the bare ticker
# ($ETH is Ethereum, not Ethan Allen). Canonicalize to the -USD instruments.
_CRYPTO_CANON = {"BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD",
                 "XRP": "XRP-USD", "DOGE": "DOGE-USD", "ADA": "ADA-USD"}


def ensure_loaded() -> None:
    if not _tickers and not _names:
        load()


# Symbols found per text. Headlines are re-scanned by every study and every
# engine cycle, and the scan runs a 700-name pattern over each one.
_symbols_seen: dict[str, tuple[str, ...]] = {}
_SYMBOLS_SEEN_MAX = 200_000


def extract_symbols(text: str, max_symbols: int = 6) -> list[str]:
    """Cashtags, registry tickers, and issuer-name mentions in `text`."""
    if not text:
        return []
    ensure_loaded()
    seen = _symbols_seen
    found = seen.get(text)
    if found is None:
        if len(seen) >= _SYMBOLS_SEEN_MAX:
            seen.clear()
        found = seen[text] = _find_symbols(text)
    return list(found[:max_symbols])


def _find_symbols(text: str) -> tuple[str, ...]:
    out: set[str] = set()
    for m in _CASHTAG.finditer(text):
        sym = m.group(1).upper()
        out.add(_CRYPTO_CANON.get(sym, sym))
    for w in _TICKERISH.findall(text):
        if w in _tickers and w not in _AMBIGUOUS:
            out.add(_CRYPTO_CANON.get(w, w))
    if _name_pattern:
        for m in _name_pattern.finditer(text):
            sym = _names.get(m.group(1))
            if sym:
                out.add(sym)
    return tuple(sorted(out))


def lookup(symbol: str) -> dict | None:
    conn = db.get_conn()
    row = conn.execute(
        "SELECT symbol, name, asset_class, region FROM securities WHERE symbol = ? COLLATE NOCASE",
        (symbol,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


# ── Tradable price band ──────────────────────────────────────────────────────
# The book starts in low-priced names (user policy: under $10 first, widen
# later). Configuration, not code: ARTHA_PRICE_MIN / ARTHA_PRICE_MAX.

import os as _os


def price_band() -> tuple[float, float]:
    lo = float(_os.environ.get("ARTHA_PRICE_MIN", 1.0))
    hi = float(_os.environ.get("ARTHA_PRICE_MAX", 10.0))
    return (lo, hi) if lo < hi else (1.0, 10.0)


def in_band(price: float | None) -> bool:
    if price is None:
        return False
    lo, hi = price_band()
    return lo <= price <= hi


async def screen_band(max_checks: int = 500, max_keep: int = 120,
                      min_dollar_volume: float = 500_000.0) -> list[dict]:
    """Sweep the registry for US equities inside the band with real turnover
    (price x average volume above `min_dollar_volume` — thin names are where
    manipulation lives). Results persist to the band_universe table so the
    ingestors and the book share one list."""
    import asyncio
    import httpx

    conn = db.get_conn()
    conn.execute("""CREATE TABLE IF NOT EXISTS band_universe (
        symbol TEXT PRIMARY KEY, price REAL, dollar_volume REAL,
        checked_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    rows = conn.execute(
        """SELECT symbol FROM securities WHERE asset_class = 'equity'
           AND region = 'US' ORDER BY rowid""").fetchall()
    conn.close()
    symbols = [r[0] for r in rows if r[0].isalpha()]
    # Sample across the whole cap spectrum, not just the top
    step = max(1, len(symbols) // max_checks)
    sample = symbols[::step][:max_checks]

    kept: list[dict] = []
    sem = asyncio.Semaphore(8)
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

    async def check(client, sym):
        async with sem:
            try:
                r = await client.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
                    params={"range": "1mo", "interval": "1d"})
                r.raise_for_status()
                res = r.json()["chart"]["result"][0]
                price = res["meta"].get("regularMarketPrice")
                vols = [v for v in res["indicators"]["quote"][0].get("volume") or [] if v]
                adv = (sum(vols) / len(vols)) if vols else 0
                if price and in_band(price) and price * adv >= min_dollar_volume:
                    kept.append({"symbol": sym, "price": float(price),
                                 "dollar_volume": float(price * adv)})
            except Exception:
                pass

    async with httpx.AsyncClient(timeout=15, headers=headers) as client:
        await asyncio.gather(*[check(client, s) for s in sample])

    kept.sort(key=lambda x: -x["dollar_volume"])
    kept = kept[:max_keep]
    conn = db.get_conn()
    conn.execute("DELETE FROM band_universe")
    conn.executemany(
        "INSERT INTO band_universe (symbol, price, dollar_volume) VALUES (?,?,?)",
        [(k["symbol"], k["price"], k["dollar_volume"]) for k in kept])
    conn.commit()
    conn.close()
    print(f"[universe] band screen: {len(kept)} names in "
          f"${price_band()[0]:g}-${price_band()[1]:g} with real turnover")
    return kept


def band_symbols(limit: int = 120) -> list[str]:
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT symbol FROM band_universe ORDER BY dollar_volume DESC LIMIT ?",
            (limit,)).fetchall()
    except Exception:
        rows = []
    conn.close()
    return [r[0] for r in rows]
