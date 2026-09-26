"""
Execution layer — an order/fill boundary between strategy and market.

The paper trader routes every order through a Broker instead of writing
fills itself. PaperBroker models the frictions a live adapter would face:
slippage against the side of the order and a per-trade commission. A live
adapter (Alpaca, IBKR) implements the same one-method interface and slots
in behind a credential check — the strategy code doesn't change.
"""

from dataclasses import dataclass

SLIPPAGE_BPS = 5.0     # paid against the order's side
COMMISSION = 1.00      # flat per order, on the paper book


@dataclass
class Fill:
    symbol: str
    side: str        # "buy" | "sell"
    qty: float
    ref_price: float  # the quote the strategy saw
    fill_price: float
    commission: float

    @property
    def cash_delta(self) -> float:
        """Signed cash impact including commission."""
        gross = self.qty * self.fill_price
        return (-gross if self.side == "buy" else gross) - self.commission


class PaperBroker:
    """Fills immediately at ref price adjusted for slippage."""

    def execute(self, side: str, symbol: str, qty: float, ref_price: float) -> Fill:
        slip = ref_price * SLIPPAGE_BPS / 10_000
        fill_price = ref_price + slip if side == "buy" else ref_price - slip
        return Fill(symbol=symbol, side=side, qty=qty,
                    ref_price=ref_price, fill_price=round(fill_price, 4),
                    commission=COMMISSION)


broker = PaperBroker()
