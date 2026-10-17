"""CTM (futures contract tables) and IMAP (industry map from sector and
industry ETFs). Prices about 10 to 15 minutes late."""

from dataclasses import dataclass
from datetime import date

from . import web
from .history import fetch_many, moves

MONTH_CODES = "FGHJKMNQUVXZ"
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

QUARTERLY = "HMUZ"
ALL = MONTH_CODES


@dataclass(frozen=True)
class Root:
    code: str
    name: str
    exchange: str
    months: str          # the delivery months the exchange lists


GROUPS: dict[str, list[Root]] = {
    "Energy": [
        Root("CL", "WTI crude oil", "NYM", ALL), Root("BZ", "Brent crude", "NYM", ALL),
        Root("NG", "Natural gas", "NYM", ALL), Root("RB", "Gasoline", "NYM", ALL),
        Root("HO", "Heating oil", "NYM", ALL),
    ],
    "Metals": [
        Root("GC", "Gold", "CMX", "GJMQVZ"), Root("SI", "Silver", "CMX", "HKNUZ"),
        Root("HG", "Copper", "CMX", "HKNUZ"), Root("PL", "Platinum", "NYM", "FJNV"),
    ],
    "Equity index": [
        Root("ES", "S&P 500 E-mini", "CME", QUARTERLY), Root("NQ", "Nasdaq 100 E-mini", "CME", QUARTERLY),
        Root("YM", "Dow E-mini", "CBT", QUARTERLY), Root("RTY", "Russell 2000 E-mini", "CME", QUARTERLY),
    ],
    "Rates": [
        Root("ZT", "2-year note", "CBT", QUARTERLY), Root("ZF", "5-year note", "CBT", QUARTERLY),
        Root("ZN", "10-year note", "CBT", QUARTERLY), Root("ZB", "30-year bond", "CBT", QUARTERLY),
    ],
    "Currencies": [
        Root("6E", "Euro", "CME", QUARTERLY), Root("6J", "Japanese yen", "CME", QUARTERLY),
        Root("6B", "British pound", "CME", QUARTERLY),
    ],
    "Grains": [
        Root("ZC", "Corn", "CBT", "HKNUZ"), Root("ZS", "Soybeans", "CBT", "FHKNQUX"),
        Root("ZW", "Wheat", "CBT", "HKNUZ"),
    ],
    "Softs and livestock": [
        Root("KC", "Coffee", "NYB", "HKNUZ"), Root("SB", "Sugar", "NYB", "HKNV"),
        Root("CT", "Cotton", "NYB", "HKNZ"), Root("LE", "Live cattle", "CME", "GJMQVZ"),
        Root("HE", "Lean hogs", "CME", "GJKMNQVZ"),
    ],
}

CONTRACTS_PER_ROOT = 5
STALE_DAYS = 7   # a contract with no bar this recent has expired


def listed_months(today: date, letters: str, n: int) -> list[tuple[int, int]]:
    """The next n delivery months the exchange lists, starting this month."""
    out, y, m = [], today.year, today.month
    while len(out) < n:
        if MONTH_CODES[m - 1] in letters:
            out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def contract_symbol(root: Root, year: int, month: int) -> str:
    return f"{root.code}{MONTH_CODES[month - 1]}{year % 100:02d}.{root.exchange}"


def curve_shape(prices: list[float]) -> str | None:
    """Contango when later months cost more than the front, backwardation
    when less; flat inside a quarter of a percent."""
    if len(prices) < 2:
        return None
    slope = (prices[-1] / prices[0] - 1) * 100
    if abs(slope) < 0.25:
        return "flat"
    return "contango" if slope > 0 else "backwardation"


def chain(root: Root, today: date, closes: dict[str, list[tuple[date, float]]]) -> dict:
    rows = []
    for y, m in listed_months(today, root.months, CONTRACTS_PER_ROOT + 1):
        sym = contract_symbol(root, y, m)
        s = closes.get(sym) or []
        if len(s) < 2 or (today - s[-1][0]).days > STALE_DAYS:
            continue
        rows.append({"symbol": sym, "month": f"{MONTH_NAMES[m - 1]} {y % 100:02d}",
                     "price": s[-1][1], "change_pct": round((s[-1][1] / s[-2][1] - 1) * 100, 3)})
    rows = rows[:CONTRACTS_PER_ROOT]
    return {"root": root.code, "name": root.name, "contracts": rows,
            "shape": curve_shape([r["price"] for r in rows])}


async def tables() -> dict:
    async def make():
        today = date.today()
        roots = [r for group in GROUPS.values() for r in group]
        symbols = [contract_symbol(r, y, m) for r in roots
                   for y, m in listed_months(today, r.months, CONTRACTS_PER_ROOT + 1)]
        closes = await fetch_many(symbols, span="5d", parallel=8)
        return {"groups": [{"name": g, "roots": [chain(r, today, closes) for r in rs]}
                           for g, rs in GROUPS.items()]}
    return await web.cached("ctm", 600, make)


# ── IMAP ─────────────────────────────────────────────────────────────────────

SECTOR_ETFS = {
    "XLK": "Technology", "XLC": "Communication", "XLY": "Consumer cyclical", "XLP": "Consumer defensive",
    "XLF": "Financials", "XLV": "Health care", "XLI": "Industrials", "XLE": "Energy",
    "XLB": "Materials", "XLRE": "Real estate", "XLU": "Utilities",
}

INDUSTRY_ETFS = {
    "SMH": "Semiconductors", "IGV": "Software", "XBI": "Biotech", "IHI": "Medical devices",
    "KRE": "Regional banks", "IAI": "Brokers and exchanges", "ITB": "Homebuilders", "XRT": "Retail",
    "XOP": "Oil and gas producers", "OIH": "Oil services", "GDX": "Gold miners", "XME": "Metals and mining",
    "JETS": "Airlines", "IYT": "Transport", "ITA": "Aerospace and defense", "TAN": "Solar",
    "VNQ": "Real estate trusts", "PBJ": "Food and drink",
}


def industry_rows(etfs: dict[str, str], closes: dict[str, list[tuple[date, float]]]) -> list[dict]:
    rows = []
    for sym, name in etfs.items():
        s = closes.get(sym) or []
        if len(s) < 2:
            continue
        rows.append({"symbol": sym, "name": name, "price": s[-1][1], **moves(s)})
    return rows


async def industries() -> dict:
    async def make():
        closes = await fetch_many([*SECTOR_ETFS, *INDUSTRY_ETFS])
        return {"sectors": industry_rows(SECTOR_ETFS, closes),
                "industries": industry_rows(INDUSTRY_ETFS, closes)}
    return await web.cached("imap", 600, make)
