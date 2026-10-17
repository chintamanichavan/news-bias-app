"""CF: a company's SEC filings, newest first, linked to the documents."""

from . import web

TICKERS = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}"
SEC_HEADERS = {"User-Agent": "Artha Research research@artha.app"}

# what the common forms are, for a reader who does not know SEC numbering
FORM_NAMES = {
    "10-K": "Annual report", "10-Q": "Quarterly report", "8-K": "Current report (material event)",
    "4": "Insider trade", "3": "New insider", "144": "Planned insider sale", "DEF 14A": "Proxy statement",
    "S-1": "IPO registration", "S-3": "Shelf registration", "SC 13G": "5%+ holder (passive)",
    "SC 13D": "5%+ holder (active)", "20-F": "Annual report (foreign)", "6-K": "Current report (foreign)",
    "11-K": "Employee plan annual report", "424B2": "Prospectus", "SD": "Conflict minerals",
}

SHOWN = 60


async def cik_for(ticker: str) -> int | None:
    async def make():
        async with web.client() as c:
            r = await c.get(TICKERS, headers=SEC_HEADERS)
            r.raise_for_status()
            return {row["ticker"].upper(): int(row["cik_str"]) for row in r.json().values()}
    return (await web.cached("sec-tickers", 86400, make)).get(ticker.upper())


def parse_submissions(payload: dict) -> dict:
    cik = int(payload["cik"])
    rec = (payload.get("filings") or {}).get("recent") or {}
    rows = []
    for i, form in enumerate(rec.get("form", [])[:SHOWN]):
        accession = rec["accessionNumber"][i]
        document = rec["primaryDocument"][i]
        rows.append({
            "form": form,
            "what": FORM_NAMES.get(form) or (rec.get("primaryDocDescription") or [""] * (i + 1))[i] or form,
            "filed": rec["filingDate"][i],
            "period": rec.get("reportDate", [""] * (i + 1))[i] or None,
            "url": ARCHIVE.format(cik=cik, accession=accession.replace("-", ""), document=document),
        })
    return {"name": payload.get("name"), "industry": payload.get("sicDescription"),
            "fiscal_year_end": payload.get("fiscalYearEnd"), "filings": rows}


class NotFiler(Exception):
    pass


async def filings(ticker: str) -> dict:
    cik = await cik_for(ticker)
    if cik is None:
        raise NotFiler(f"{ticker} does not file with the SEC under that ticker.")

    async def make():
        async with web.client() as c:
            r = await c.get(SUBMISSIONS.format(cik=cik), headers=SEC_HEADERS)
            r.raise_for_status()
            return parse_submissions(r.json())
    return await web.cached(f"cf:{cik}", 3600, make)
