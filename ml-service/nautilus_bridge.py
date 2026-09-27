"""
NautilusTrader bridge — Phase 5: execution parity.

The strategy that runs here is the platform's own book policy (hold the
top-K names by signal, exit on decay) expressed as a Nautilus Strategy, fed
by bars straight from the PIT store. The point of the exercise:

- the SAME engine and event semantics serve backtest, paper and (later)
  live — research-to-live parity, the property our hand-rolled paper loop
  cannot offer;
- the PIT store is the single source of bars, so a Nautilus run is as
  replayable as any other study;
- a live adapter is a config change (Nautilus ships binance/IB/etc.
  adapters), not a rewrite.

run_parity_backtest() executes a deterministic signal schedule against PIT
bars in a Nautilus BacktestEngine with the same frictions as the paper
broker, and returns the engine's account report — the harness the parity
acceptance test drives.
"""

from datetime import datetime, timezone

import pandas as pd

import pit

from nautilus_trader.backtest.engine import BacktestEngine, BacktestEngineConfig
from nautilus_trader.config import LoggingConfig
from nautilus_trader.model.currencies import USD
from nautilus_trader.model.data import Bar, BarType
from nautilus_trader.model.enums import AccountType, OmsType, OrderSide, TimeInForce
from nautilus_trader.model.identifiers import InstrumentId, TraderId, Venue
from nautilus_trader.model.objects import Money, Price, Quantity
from nautilus_trader.test_kit.providers import TestInstrumentProvider
from nautilus_trader.trading.strategy import Strategy

VENUE = Venue("ARTHA")


def _bars_from_pit(symbol: str, as_of: str, bar_type: BarType, instrument) -> list[Bar]:
    conn = pit.connect()
    df = pit.prices_asof(conn, as_of, symbols=[symbol])
    if df.empty:
        return []
    bars = []
    for row in df.itertuples():
        if any(pd.isna(x) for x in (row.open, row.high, row.low, row.close)):
            continue
        ts = int(pd.Timestamp(row.date, tz=timezone.utc).value)
        bars.append(Bar(
            bar_type=bar_type,
            open=Price(round(float(row.open), 2), instrument.price_precision),
            high=Price(round(float(max(row.high, row.open, row.close)), 2), instrument.price_precision),
            low=Price(round(float(min(row.low, row.open, row.close)), 2), instrument.price_precision),
            close=Price(round(float(row.close), 2), instrument.price_precision),
            volume=Quantity(int(row.volume or 0), 0),
            ts_event=ts, ts_init=ts,
        ))
    return bars


class SignalScheduleStrategy(Strategy):
    """Enters/exits on a pre-computed signal schedule {date: qty} — the same
    decisions the paper book would make, replayed through Nautilus's engine
    so fills, positions and PnL come from production execution semantics."""

    def __init__(self, instrument_id: InstrumentId, bar_type: BarType,
                 schedule: dict[str, int]):
        super().__init__()
        self._instrument_id = instrument_id
        self._bar_type = bar_type
        self._schedule = schedule

    def on_start(self):
        self.subscribe_bars(self._bar_type)

    def on_bar(self, bar: Bar):
        day = pd.Timestamp(bar.ts_event, unit="ns", tz="UTC").strftime("%Y-%m-%d")
        target = self._schedule.get(day)
        if target is None:
            return
        instrument = self.cache.instrument(self._instrument_id)
        net = self.portfolio.net_position(self._instrument_id)
        delta = target - int(net)
        if delta == 0:
            return
        order = self.order_factory.market(
            instrument_id=self._instrument_id,
            order_side=OrderSide.BUY if delta > 0 else OrderSide.SELL,
            quantity=instrument.make_qty(abs(delta)),
            time_in_force=TimeInForce.GTC,
        )
        self.submit_order(order)


def run_parity_backtest(symbol: str = "AAPL", schedule: dict[str, int] | None = None,
                        as_of: str | None = None) -> dict:
    """Execute a signal schedule on PIT bars inside Nautilus; return the
    engine's own accounting."""
    as_of = as_of or datetime.now(timezone.utc).isoformat()

    engine = BacktestEngine(config=BacktestEngineConfig(
        trader_id=TraderId("ARTHA-001"),
        logging=LoggingConfig(bypass_logging=True),
    ))
    engine.add_venue(
        venue=VENUE,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        base_currency=USD,
        starting_balances=[Money(100_000, USD)],
    )
    instrument = TestInstrumentProvider.equity(symbol, str(VENUE))
    engine.add_instrument(instrument)

    bar_type = BarType.from_str(f"{symbol}.{VENUE}-1-DAY-LAST-EXTERNAL")
    bars = _bars_from_pit(symbol, as_of, bar_type, instrument)
    if len(bars) < 30:
        raise RuntimeError(f"PIT store holds too few bars for {symbol}")
    engine.add_data(bars)

    if schedule is None:
        # default drill: buy 20 shares a quarter of the way in, flat at 3/4
        days = [pd.Timestamp(b.ts_event, unit="ns", tz="UTC").strftime("%Y-%m-%d") for b in bars]
        schedule = {days[len(days) // 4]: 20, days[3 * len(days) // 4]: 0}

    engine.add_strategy(SignalScheduleStrategy(instrument.id, bar_type, schedule))
    engine.run()

    account = engine.trader.generate_account_report(VENUE)
    fills = engine.trader.generate_order_fills_report()
    result = {
        "symbol": symbol,
        "bars": len(bars),
        "orders_filled": int(len(fills)),
        "ending_balance": float(account["total"].iloc[-1]) if len(account) else None,
        "engine": "nautilus_trader",
    }
    engine.reset()
    engine.dispose()
    return result
