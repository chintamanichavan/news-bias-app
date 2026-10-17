"""News filters: headline terms, trend lift, company names and the 8-K feed."""

from collections import Counter

from terminal import newsfilters


def test_terms_skip_stop_words_and_count_once_per_headline():
    c = newsfilters.terms(["Fed raises rates as inflation rises", "Rates rise, rates rise again"])
    assert c["rates"] == 2 and c["fed raises"] == 1 and "the" not in c and "as" not in c


def test_trends_rank_by_lift_and_fold_words_into_phrases():
    now = Counter({"strike": 10, "port strike": 9, "fed": 10})
    before = Counter({"fed": 400, "strike": 2, "port strike": 0})
    rows = newsfilters.trends(now, before, 100, 1000)
    assert rows[0]["term"] == "port strike"
    assert "strike" not in [r["term"] for r in rows]          # folded into the phrase
    assert rows[-1]["term"] == "fed" and rows[-1]["lift"] < 1


def test_company_name_words():
    assert newsfilters._name_words("Apple Inc.", "AAPL") == ["Apple", "(AAPL)"]
    assert newsfilters._name_words("The Coca-Cola Company", "KO") == ["Coca-Cola"]


def test_sec_current_feed():
    xml = ('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>8-K - ACME CORP (0000012345) (Filer)</title>'
           '<link rel="alternate" href="https://www.sec.gov/x"/><summary type="html">&lt;b&gt;Filed:&lt;/b&gt; 2026-10-16 Item 2.02: Results Item 9.01: Exhibits</summary>'
           '<updated>2026-10-16T17:00:00-04:00</updated></entry></feed>')
    row = newsfilters.parse_atom(xml)[0]
    assert row["company"] == "ACME CORP" and row["form"] == "8-K" and row["items"] == ["2.02", "9.01"]
