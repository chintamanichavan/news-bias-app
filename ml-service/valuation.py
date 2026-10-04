"""
The return rule for the long-term book: a business enters the buy zone only
if today's price implies at least MIN_RETURN a year, and it is a full-size
idea only at TARGET_RETURN or better.

Expected yearly return over HORIZON years, from three plain inputs:

    terminal price = EPS today x (1 + growth)^HORIZON x exit P/E
    return         = (terminal / price)^(1/HORIZON) - 1 + dividend yield

Every input is held down on purpose, so the estimate errs low:
- growth is the SLOWER of the revenue and EPS records, never above GROWTH_CAP
  and never below zero;
- the exit multiple is the company's own decade-median P/E, never above
  EXIT_PE_CAP — no credit for the market staying generous;
- dividends count at today's payout, with no growth.

It is an estimate from the past record, not a forecast. Its job is to say no.
"""

HORIZON = 5
MIN_RETURN = 0.15
TARGET_RETURN = 0.20
GROWTH_CAP = 0.15
EXIT_PE_CAP = 25.0


def conservative_growth(rev_cagr: float | None, eps_cagr: float | None) -> float:
    """The slower of the two records, held inside [0, GROWTH_CAP]."""
    known = [g for g in (rev_cagr, eps_cagr) if g is not None]
    if not known:
        return 0.0
    return max(0.0, min(GROWTH_CAP, min(known)))


def terminal_price(eps: float, growth: float, exit_pe: float) -> float:
    return eps * (1 + growth) ** HORIZON * min(exit_pe, EXIT_PE_CAP)


def expected_return(price: float, eps: float, growth: float, exit_pe: float,
                    dps: float = 0.0) -> float | None:
    """Yearly return implied by `price`. None when the business has no
    earnings to value or the price is not positive."""
    if price <= 0 or eps <= 0 or exit_pe <= 0:
        return None
    terminal = terminal_price(eps, growth, exit_pe)
    return (terminal / price) ** (1 / HORIZON) - 1 + max(0.0, dps) / price


def price_for_return(hurdle: float, eps: float, growth: float, exit_pe: float,
                     dps: float = 0.0) -> float | None:
    """The highest price that still implies `hurdle` a year. The return falls
    as the price rises, so a bisection finds it."""
    if eps <= 0 or exit_pe <= 0:
        return None
    lo, hi = 1e-6, terminal_price(eps, growth, exit_pe) * 4 + 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        r = expected_return(mid, eps, growth, exit_pe, dps)
        if r is not None and r >= hurdle:
            lo = mid
        else:
            hi = mid
    return lo


def tier(ret: float | None) -> str | None:
    """'target' at TARGET_RETURN or better, 'minimum' at MIN_RETURN or
    better, None below the floor (or when no estimate exists)."""
    if ret is None:
        return None
    if ret >= TARGET_RETURN:
        return "target"
    if ret >= MIN_RETURN:
        return "minimum"
    return None
