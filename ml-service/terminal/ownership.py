"""INSD and GPTR (insider trades), FLNG and PHDC (a manager's 13F
holdings), SIA (short interest history), SPOS (UK disclosed short
positions) and the filing searches (CFS, EDGS, ACF, CFA, DSCO).

Sources, all free:
- Yahoo's insider transactions, which follow SEC Forms 3, 4 and 5
- SEC EDGAR: submissions, 13F information tables, full-text search
- FINRA's consolidated short interest, twice a month
- The UK Financial Conduct Authority's aggregated net short positions by
  company (since July 2026 it no longer names each holder)
"""

import asyncio
import csv
import io
import re
import xml.etree.ElementTree as ET
from datetime import date, timedelta

from . import web, yahoo
from .filings import SEC_HEADERS

EFTS = "https://efts.sec.gov/LATEST/search-index"
SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}"
FINRA = "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"
FCA = "https://www.fca.org.uk/publication/documents/aggregated-current-net-short-positions.csv"


def raw(x):
    return x.get("raw") if isinstance(x, dict) else x


# ── insiders ─────────────────────────────────────────────────────────────────

def kind(text: str) -> str:
    """What a Form 4 line was, from Yahoo's description of it."""
    t = (text or "").lower()
    for word, k in (("purchase", "buy"), ("sale", "sell"), ("gift", "gift"), ("exercise", "option exercise"),
                    ("conversion", "option exercise"), ("award", "award"), ("grant", "award")):
        if word in t:
            return k
    return "other"


def insiders(qs: dict) -> dict:
    rows = []
    for t in (qs.get("insiderTransactions") or {}).get("transactions", []):
        shares, value = raw(t.get("shares")), raw(t.get("value"))
        rows.append({"date": (t.get("startDate") or {}).get("fmt"), "name": (t.get("filerName") or "").title(),
                     "relation": t.get("filerRelation"), "text": t.get("transactionText") or "",
                     "kind": kind(t.get("transactionText")), "shares": shares, "value": value or None,
                     "price": value / shares if value and shares else None,
                     "direct": t.get("ownership") == "D"})
    rows.sort(key=lambda r: r["date"] or "", reverse=True)
    net = qs.get("netSharePurchaseActivity") or {}
    six = {k: raw(net.get(k)) for k in ("buyInfoShares", "buyInfoCount", "sellInfoShares", "sellInfoCount",
                                         "netInfoShares", "totalInsiderShares", "netPercentInsiderShares")}
    since = (date.today() - timedelta(days=365)).isoformat()
    year = [r for r in rows if (r["date"] or "") >= since]
    return {
        "transactions": rows, "six_months": six,
        "year": {k: {"count": sum(r["kind"] == k for r in year), "shares": sum(r["shares"] or 0 for r in year if r["kind"] == k),
                     "value": sum(r["value"] or 0 for r in year if r["kind"] == k)} for k in ("buy", "sell")},
    }


async def insider_view(symbol: str) -> dict:
    return {"symbol": symbol, **insiders(await yahoo.summary(symbol))}


# ── 13F holdings ─────────────────────────────────────────────────────────────

def parse_13f(xml: str) -> list[dict]:
    """One row per security from a 13F information table, lines for the
    same CUSIP and kind (shares, puts, calls) added together. Values are in
    dollars for filings since 2023."""
    root = ET.fromstring(xml)
    ns = {"n": root.tag.split("}")[0].strip("{")} if root.tag.startswith("{") else {}
    p = "n:" if ns else ""
    out: dict[tuple, dict] = {}
    for t in root.findall(f"{p}infoTable", ns):
        def get(path):
            e = t.find(path, ns)
            return e.text.strip() if e is not None and e.text else None
        cusip = get(f"{p}cusip")
        put_call = get(f"{p}putCall")
        key = (cusip, put_call)
        row = out.setdefault(key, {"issuer": get(f"{p}nameOfIssuer"), "class": get(f"{p}titleOfClass"), "cusip": cusip,
                                   "put_call": put_call, "value": 0.0, "shares": 0.0})
        row["value"] += float(get(f"{p}value") or 0)
        row["shares"] += float(get(f"{p}shrsOrPrnAmt/{p}sshPrnamt") or 0)
    rows = sorted(out.values(), key=lambda r: -r["value"])
    total = sum(r["value"] for r in rows if not r["put_call"])
    for r in rows:
        r["weight"] = r["value"] / total if total and not r["put_call"] else None
    return rows


def changes(now: list[dict], before: list[dict]) -> list[dict]:
    """Each holding's share change against the previous quarter."""
    prev = {(r["cusip"], r["put_call"]): r for r in before}
    seen = set()
    out = []
    for r in now:
        k = (r["cusip"], r["put_call"])
        seen.add(k)
        p = prev.get(k)
        status = "new" if not p else "added" if r["shares"] > p["shares"] * 1.001 else "reduced" if r["shares"] < p["shares"] * 0.999 else "same"
        out.append({**r, "previous_shares": p["shares"] if p else 0.0, "status": status})
    for k, p in prev.items():
        if k not in seen:
            out.append({**p, "value": 0.0, "shares": 0.0, "weight": None, "previous_shares": p["shares"], "status": "sold"})
    return out


async def _sec(c, url: str):
    r = await c.get(url, headers=SEC_HEADERS)
    r.raise_for_status()
    return r


async def find_entities(query: str) -> list[dict]:
    async def make():
        async with web.client() as c:
            r = await _sec(c, f"{EFTS}?keysTyped={query}")
        return [{"cik": int(h["_id"]), "name": h["_source"].get("entity")} for h in r.json()["hits"]["hits"]]
    return await web.cached(f"entities:{query.lower()}", 86400, make)


class NoFilings(Exception):
    pass


async def _table(c, cik: int, acc: str) -> list[dict]:
    folder = ARCHIVE.format(cik=cik, acc=acc.replace("-", ""))
    items = (await _sec(c, f"{folder}/index.json")).json()["directory"]["item"]
    xmls = [i["name"] for i in items if i["name"].endswith(".xml") and i["name"] != "primary_doc.xml"]
    if not xmls:
        return []
    return parse_13f((await _sec(c, f"{folder}/{xmls[0]}")).text)


async def manager(query: str) -> dict:
    """The latest 13F of the manager named (or with this CIK), and what
    changed since the one before."""
    async def make():
        cik = int(query) if query.isdigit() else None
        name = None
        if cik is None:
            for e in await find_entities(query):
                async with web.client() as c:
                    sub = (await _sec(c, SUBMISSIONS.format(cik=e["cik"]))).json()
                if "13F-HR" in sub["filings"]["recent"]["form"]:
                    cik, name = e["cik"], sub.get("name")
                    break
            if cik is None:
                raise NoFilings(f"No 13F filer matches {query}.")
        async with web.client() as c:
            sub = (await _sec(c, SUBMISSIONS.format(cik=cik))).json()
            rec = sub["filings"]["recent"]
            idx = [i for i, f in enumerate(rec["form"]) if f == "13F-HR"][:2]       # amendments left out
            if not idx:
                raise NoFilings(f"{sub.get('name')} files no 13F.")
            tables = await asyncio.gather(*(_table(c, cik, rec["accessionNumber"][i]) for i in idx))
        now = tables[0]
        before = tables[1] if len(tables) > 1 else []
        return {"cik": cik, "name": name or sub.get("name"), "period": rec["reportDate"][idx[0]],
                "filed": rec["filingDate"][idx[0]], "previous_period": rec["reportDate"][idx[1]] if len(idx) > 1 else None,
                "value": sum(r["value"] for r in now if not r["put_call"]), "positions": len(now),
                "holdings": changes(now, before)}
    return await web.cached(f"13f:{query.lower()}", 6 * 3600, make)


# ── short interest ───────────────────────────────────────────────────────────

async def short_history(symbol: str) -> dict:
    async def make():
        start = (date.today() - timedelta(days=730)).isoformat()
        body = {"compareFilters": [{"compareType": "EQUAL", "fieldName": "symbolCode", "fieldValue": symbol}], "limit": 200,
                "dateRangeFilters": [{"fieldName": "settlementDate", "startDate": start, "endDate": date.today().isoformat()}]}
        async with web.client() as c:
            r = await c.post(FINRA, json=body, headers={"Accept": "application/json"})
            r.raise_for_status()
            rows = r.json() if r.content else []
        return {"symbol": symbol, "rows": [{"date": x["settlementDate"], "short": x["currentShortPositionQuantity"],
                                            "days_to_cover": x.get("daysToCoverQuantity"), "change_pct": x.get("changePercent"),
                                            "avg_volume": x.get("averageDailyVolumeQuantity")}
                                           for x in sorted(rows, key=lambda x: x["settlementDate"])]}
    return await web.cached(f"finra:{symbol}", 6 * 3600, make)


def parse_fca(text: str) -> list[dict]:
    """The FCA's aggregated file: company, ISIN, total net short %, date."""
    rows = []
    for line in csv.reader(io.StringIO(text.lstrip("\ufeff"))):
        if len(line) < 4 or not line[2].replace(".", "", 1).isdigit():
            continue
        d, m, y = line[3].split("/")
        rows.append({"issuer": line[0].strip(), "isin": line[1].strip(), "net_short_pct": float(line[2]), "date": f"{y}-{m}-{d}"})
    return sorted(rows, key=lambda r: -r["net_short_pct"])


async def uk_shorts(issuer: str | None) -> dict:
    async def load():
        async with web.client() as c:
            r = await c.get(FCA)
            r.raise_for_status()
            return parse_fca(r.text)
    rows = await web.cached("fca", 6 * 3600, load)
    if issuer:
        q = re.sub(r"\b(plc|ltd|limited|group|holdings?|inc)\b", "", issuer.lower()).strip(" .,")
        rows = [r for r in rows if q and q in r["issuer"].lower()]
    return {"as_of": max((r["date"] for r in rows), default=None), "issuers": rows[:300]}


# ── filing search ────────────────────────────────────────────────────────────

def parse_hits(payload: dict) -> list[dict]:
    out = []
    for h in payload.get("hits", {}).get("hits", []):
        s = h["_source"]
        adsh, doc = h["_id"].split(":", 1)
        cik = int((s.get("ciks") or ["0"])[0])
        out.append({"company": (s.get("display_names") or [""])[0], "form": s.get("form"), "filed": s.get("file_date"),
                    "period": s.get("period_ending"), "document": s.get("file_type"), "description": s.get("file_description"),
                    "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{adsh.replace('-', '')}/{doc}"})
    return out


async def search(q: str, forms: str | None, start: str | None, end: str | None, cik: int | None) -> dict:
    params = {"q": q}
    if forms:
        params["forms"] = forms
    if start or end:
        params.update(dateRange="custom", startdt=start or "2001-01-01", enddt=end or date.today().isoformat())
    if cik:
        params["ciks"] = f"{cik:010d}"
    key = "fts:" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))

    async def make():
        async with web.client() as c:
            r = await c.get(EFTS, params=params, headers=SEC_HEADERS)
            r.raise_for_status()
            d = r.json()
        return {"total": d["hits"]["total"]["value"], "more": d["hits"]["total"]["relation"] == "gte", "hits": parse_hits(d)}
    return await web.cached(key, 3600, make)
