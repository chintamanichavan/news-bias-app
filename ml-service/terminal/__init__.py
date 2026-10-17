"""Data behind the Artha Terminal's market-wide functions (docs/TERMINAL.md).

One module per kind of source; api.py wires them to HTTP. Every source here
is free and keyless. Parsers are pure functions so they can be tested on
saved text without the network.
"""
