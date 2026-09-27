import particle


def test_topic_scope_boundaries():
    cases = {
        "Fed holds interest rates steady as inflation cools": {"Macro", "Bonds & Rates"},
        "Tropical storm warning issued for Gulf Coast": {"Severe Weather"},
        "Crude oil rallies; the euro slips against the yen": {"Commodities", "Currencies"},
    }
    for title, expected in cases.items():
        assert expected & set(particle.tag_topics(title, "")), title

    # substring traps that once leaked
    for title in [
        "Doctor reveals 10-year rule for dementia, neurological benchmark",
        "Turmoil in parliament as current polls shift",
        "Aces have taken WNBA by storm this season",
        "Taylor Swift announces tour",
    ]:
        assert particle.tag_topics(title, "") == [], title


def test_key_points_spread_and_budget():
    body = " ".join(f"Sentence number {i} talks about markets and rates today." for i in range(12))
    pts = particle.key_points("Markets", body, n=4)
    assert len(pts) == 4
    assert all(len(p.split()) <= 34 for p in pts)


def test_five_ws_clean_fields():
    ws = particle.five_ws(
        "Markets rally",
        "Stocks rose sharply on Tuesday after the Federal Reserve hinted at cuts. "
        "The S&P 500 gained 2 percent in New York. Traders cheered because the data showed cooling prices.",
    )
    assert ws["when"] == "on Tuesday"
    assert ws["where"] == "New York"
    # "after the Federal Reserve hinted" is a legitimate causal sentence and
    # appears before the "because" one — either counts as a why
    assert ws["why"] and any(k in ws["why"] for k in ("because", "after"))
    assert ws["who"] and "." not in ws["who"]  # never bleeds across sentences


def test_crossword_is_consistent():
    heads = [(f"{w} prices surge on strong demand", "Test") for w in
             ["Copper", "Nickel", "Cobalt", "Lithium", "Uranium", "Silver", "Platinum"]]
    puz = particle.build_crossword(heads, seed="2026-09-26")
    assert puz["entries"], "puzzle should place entries"
    grid = {}
    for e in puz["entries"]:
        assert "___" in e["clue"]
        for i, ch in enumerate(e["answer"]):
            r = e["row"] + (i if e["dir"] == "down" else 0)
            c = e["col"] + (i if e["dir"] == "across" else 0)
            assert 0 <= r < puz["rows"] and 0 <= c < puz["cols"], "entry escapes grid"
            if (r, c) in grid:
                assert grid[(r, c)] == ch, "conflicting letters at a crossing"
            grid[(r, c)] = ch


def test_symbol_extraction(offline_universe):
    u = offline_universe
    # cashtags canonicalize crypto
    assert u.extract_symbols("$ETH breaking out alongside $NVDA") == ["ETH-USD", "NVDA"]
    # bare registry tickers match; ambiguous words never do
    assert "SPY" in u.extract_symbols("Loaded up on SPY before the print")
    assert u.extract_symbols("ICE agents raided the warehouse HERE") == []
    # issuer names from the static layer, case-sensitive
    assert "7203.T" in u.extract_symbols("Toyota reported record output")
    assert u.extract_symbols("my toyota broke down") == []
