"""
Two mandates, one firewall — "long term wealthy, short term rich."

The platform runs two books with different clocks, and the discipline lives
in keeping them separate:

- WEALTH (the core): long-horizon ownership of quality businesses. Underwritten
  on 7-17 fiscal years of filings, entered through the value/thesis zones,
  exited by thesis break — never by price alone. This is where net worth
  actually compounds.
- RICH (the satellite): short-horizon systematic alpha. The gated paper book —
  no capital until a study clears the trials-adjusted hurdle, then stops,
  class caps, a vol target and a kill-switch. Expected to be in cash most of
  the time; that is the design working, not failing.

The firewall between them is the whole point: a trade that wants to become
an investment failed as a trade, and conviction is never a funding source.
"""

import db
import portfolio
import validation

WEALTH = {
    "key": "wealth",
    "name": "Wealth — long term",
    "objective": "compound net worth by owning quality businesses for years",
    "horizon": "7+ years (underwritten on 7-17 fiscal years of filings)",
    "vehicle": "portfolio workspace: watchlist, value/thesis zones, ADR decision log",
    "entry_discipline": [
        "quality screen first: ROE > 15%, positive FCF, revenue CAGR > 5%, dilution <= 5%",
        "price second: the return rule — today's price must imply 15% a year at the least, "
        "20% for a full-size idea (5 years, growth capped at 15%, exit P/E capped at 25)",
        "falling-knife rule: a zone entered via a >40% collapse needs re-underwriting, not a buy",
        "stale-thesis rule: a thesis older than 90 days gets re-read before acting",
    ],
    "exit_discipline": "thesis break or a materially better use of the capital — never price alone",
}

RICH = {
    "key": "rich",
    "name": "Rich — short term",
    "objective": "harvest validated short-horizon alpha with strictly capped risk",
    "horizon": "days to weeks",
    "vehicle": "gated paper book (live broker adapter only after sustained paper edge)",
    "entry_discipline": [
        "the alpha gate: no new capital until a study clears the trials-adjusted t-hurdle",
        "verdicts need a positive tradable spread, not just a significant IC",
        "entries only inside the configured price band, sized signal-over-vol under caps",
    ],
    "exit_discipline": "signal decay, -8% stop per name, -15% kill-switch on the book",
}

FIREWALL = [
    "Profits harvest downward only: Rich gains sweep into Wealth. Wealth never refills Rich.",
    "After a kill-switch halt, Rich is funded again only by a NEW study clearing the "
    "hurdle — never by conviction.",
    "Positions never migrate between books: a trade that wants to become an investment "
    "failed as a trade.",
    "Cash waiting on either mandate is a position, not a failure.",
]


def snapshot() -> dict:
    """The two mandates with their live status attached."""
    wealth = dict(WEALTH)
    try:
        names = portfolio.watchlist()
        wealth["status"] = {
            "workspace_available": portfolio.PF_DIR.exists(),
            "watchlist_names": len(names),
        }
    except Exception:
        wealth["status"] = {"workspace_available": False, "watchlist_names": 0}

    rich = dict(RICH)
    gate = validation.alpha_gate()
    equity = cash = None
    try:
        conn = db.get_conn()
        row = conn.execute(
            "SELECT equity, cash FROM paper_equity ORDER BY id DESC LIMIT 1").fetchone()
        conn.close()
        if row:
            equity, cash = row["equity"], row["cash"]
    except Exception:
        pass
    rich["status"] = {"alpha_gate": gate, "paper_equity": equity, "paper_cash": cash}

    return {"tagline": "long term wealthy, short term rich",
            "mandates": [wealth, rich], "firewall": FIREWALL}
