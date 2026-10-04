"""
The return rule for the long-term book: a business enters the buy zone only
if today's price implies at least MIN_RETURN a year, and it is a full-size
idea only at TARGET_RETURN or better.

Expected yearly return over HORIZON years, from three plain inputs:

    terminal price = EPS today x (1 + growth)^HORIZON x exit P/E
    return         = (terminal / price)^(1/HORIZON) - 1 + dividend yield

Every input is held down on purpose, so the estimate errs low:
- earnings are the latest year or the three-year average, whichever is lower;
- growth is the SLOWEST of the full revenue record, the last three years of
  revenue, and the EPS record — never above GROWTH_CAP, never below zero;
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
# An estimate above this is far more likely a data fault (a mis-scaled EPS
# fact, a reused ticker) than a bargain. It is flagged, never trusted.
MAX_CREDIBLE = 0.60
# The latest annual EPS must be this recent, in fiscal years.
MAX_EPS_AGE_YEARS = 2


def base_eps(eps_by_year: list[float]) -> float | None:
    """Earnings to value: the latest year, or the three-year average when
    that is lower — one windfall year must not set the price. None when
    either is not positive."""
    if not eps_by_year:
        return None
    latest = eps_by_year[-1]
    recent = eps_by_year[-3:]
    avg = sum(recent) / len(recent)
    base = min(latest, avg)
    return base if base > 0 else None


def cagr(first: float, last: float, years: int) -> float | None:
    if first <= 0 or last <= 0 or years < 1:
        return None
    return (last / first) ** (1 / years) - 1


def conservative_growth(*rates: float | None) -> float:
    """The slowest of the records given, held inside [0, GROWTH_CAP]."""
    known = [g for g in rates if g is not None]
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
    if ret is None or ret > MAX_CREDIBLE:
        return None
    if ret >= TARGET_RETURN:
        return "target"
    if ret >= MIN_RETURN:
        return "minimum"
    return None
