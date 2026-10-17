"""Insiders, 13F tables and their changes, UK shorts and filing search."""

from terminal import ownership


def test_insider_kind_from_yahoo_text():
    assert ownership.kind("Sale at price 332.01 per share.") == "sell"
    assert ownership.kind("Purchase at price 10 per share.") == "buy"
    assert ownership.kind("Stock Award(Grant) at price 0.00 per share.") == "award"
    assert ownership.kind("Stock Gift at price 0.00 per share.") == "gift"
    assert ownership.kind("") == "other"


def test_insiders_price_and_totals():
    qs = {"insiderTransactions": {"transactions": [
        {"shares": {"raw": 100}, "value": {"raw": 1000}, "transactionText": "Sale at price 10", "filerName": "DOE JANE",
         "filerRelation": "Officer", "startDate": {"fmt": "2099-01-02"}, "ownership": "D"}]}}
    d = ownership.insiders(qs)
    t = d["transactions"][0]
    assert t["name"] == "Doe Jane" and t["price"] == 10 and t["kind"] == "sell"
    assert d["year"]["sell"] == {"count": 1, "shares": 100, "value": 1000}


TABLE = """<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
<infoTable><nameOfIssuer>ALLY</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>A1</cusip><value>600</value>
<shrsOrPrnAmt><sshPrnamt>60</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
<infoTable><nameOfIssuer>ALLY</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>A1</cusip><value>200</value>
<shrsOrPrnAmt><sshPrnamt>20</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
<infoTable><nameOfIssuer>BETA</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>B2</cusip><value>200</value>
<shrsOrPrnAmt><sshPrnamt>5</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
<infoTable><nameOfIssuer>BETA</nameOfIssuer><titleOfClass>PUT</titleOfClass><cusip>B2</cusip><value>50</value>
<shrsOrPrnAmt><sshPrnamt>5</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><putCall>Put</putCall></infoTable>
</informationTable>"""


def test_13f_lines_are_summed_and_weighted_without_options():
    rows = ownership.parse_13f(TABLE)
    ally = next(r for r in rows if r["cusip"] == "A1")
    assert ally["value"] == 800 and ally["shares"] == 80 and ally["weight"] == 0.8
    put = next(r for r in rows if r["put_call"] == "Put")
    assert put["weight"] is None


def test_13f_changes_quarter_on_quarter():
    now = [{"cusip": "A", "put_call": None, "shares": 10, "value": 1}, {"cusip": "N", "put_call": None, "shares": 1, "value": 1}]
    before = [{"cusip": "A", "put_call": None, "shares": 5, "value": 1}, {"cusip": "S", "put_call": None, "shares": 3, "value": 1}]
    got = {r["cusip"]: r["status"] for r in ownership.changes(now, before)}
    assert got == {"A": "added", "N": "new", "S": "sold"}


def test_fca_aggregated_file():
    text = ("\ufeffName of Company,ISIN,Aggregated net short position (%),Position date\n"
            "3I GROUP PLC,GB00B1YW4409,1.1,06/10/2026\nA.G. BARR PLC,GB00B6XZKY75,1.31,13/10/2026\n")
    rows = ownership.parse_fca(text)
    assert rows[0] == {"issuer": "A.G. BARR PLC", "isin": "GB00B6XZKY75", "net_short_pct": 1.31, "date": "2026-10-13"}


def test_full_text_hit_becomes_a_link():
    hits = ownership.parse_hits({"hits": {"hits": [{"_id": "0001193125-19-214158:d771911dex993.htm", "_source": {
        "ciks": ["0001585219"], "display_names": ["Steadfast (CIK 0001585219)"], "form": "8-K", "file_date": "2019-08-06",
        "file_type": "EX-99.3"}}]}})
    assert hits[0]["url"] == "https://www.sec.gov/Archives/edgar/data/1585219/000119312519214158/d771911dex993.htm"
