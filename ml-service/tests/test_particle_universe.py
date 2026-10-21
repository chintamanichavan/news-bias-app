"""The securities registry: symbols found in text."""


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


def test_remembered_symbols_are_dropped_when_the_registry_reloads(offline_universe):
    assert "BTC-USD" in offline_universe.extract_symbols("$BTC breaks out")
    offline_universe.load()
    assert offline_universe._symbols_seen == {}
    assert offline_universe.extract_symbols("$BTC breaks out", max_symbols=0) == []
    assert "BTC-USD" in offline_universe.extract_symbols("$BTC breaks out")
