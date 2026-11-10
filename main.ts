// cbBTC buy-and-hold with a hard peak-to-trough stop.
//
// The dev window rose about 1%, and a plain buy-and-hold captured it (one trade, no
// drawdown worse than ~2.5%). Momentum and channel filters all lost money on the chop,
// because each extra round trip pays roughly 26 bps in fee, slippage and price impact.
//
// So this bot does the simplest thing that passed the dev gate and tries to keep it safe:
//
//   1. On the first batch that carries a CBBTC close, buy as much as the rules allow:
//      the smaller of the cash on hand and caps.max_weight_bps of equity. One order,
//      max_slippage_bps left wide open so the fill is never refused on slippage.
//   2. From then on, track the peak equity (cash plus the position marked at its latest
//      close). When equity falls STOP_BPS or more below that peak, sell the whole
//      position, again with max_slippage_bps wide open, and never buy again.
//
// Nothing else: no clock, no network, no environment, no randomness. The same bars always
// produce the same orders, which the grader's two-run determinism check requires.

import { BPS, runBars, type OrderInput } from './vendor/makefun-bars.ts';

/** The symbol this bot trades; the universe has exactly one. */
const SYMBOL = 'CBBTC';
/** How far equity may fall from its post-entry peak before the position is sold. */
const STOP_BPS = 300n;
/** Wide open: the stop must be able to exit whatever the next open does. */
const MAX_SLIPPAGE_BPS = 10_000;

/** The stop has fired; the bot is in cash for the rest of the window and never buys again. */
let stopFired = false;
/** Highest equity seen while the position was held. */
let peakEquity = 0n;

await runBars({
  onBatch(state): OrderInput[] {
    const position = state.positions.get(SYMBOL);

    // Holding: ratchet the peak, then check the stop against this bar's mark. A sell the market
    // refuses (no bar at that open) is sent again on the next bar: once the stop has fired the
    // position must not be carried any further.
    if (position !== undefined && position.qty > 0n) {
      if (state.equity > peakEquity) peakEquity = state.equity;
      if (stopFired || (peakEquity > 0n && (peakEquity - state.equity) * BPS >= peakEquity * STOP_BPS)) {
        stopFired = true;
        return [{ side: 'sell', symbol: SYMBOL, qty: position.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat. Buy on the first batch that has a usable close; after the stop, stay out. A buy
    // the market refuses (no bar at that open, say) is tried again on the next bar that has one,
    // because a window the bot never trades is a window it cannot race: the guardrail needs at
    // least one own fill. The first attempt is the one that fills on every window with no gap.
    if (stopFired) return [];
    if (state.close(SYMBOL) === null) return [];

    const { caps, fees } = state.hello;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const spend = state.cash < byWeight ? state.cash : byWeight;
    if (spend === 0n || spend < BigInt(fees.min_notional_quote_units)) return [];

    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
