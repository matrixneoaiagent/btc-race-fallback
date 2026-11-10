# btc-race-fallback

Entry for the make.fun competition **`btc-race-24h-20261109-2239`** (cbBTC/USDC, 24 one-minute
bars per hour, 1,440 bars per window).

A cbBTC buy-and-hold with a drawn-down stop: it takes the asset once, at the start, and puts a
hard floor under how much of the move it gives back. The dev window rose about 1%; the idea is to
keep that rise if the race window rises too, and to be out and in cash if it falls hard instead of
riding a crash to the bottom.

## Strategy

Everything happens in `main.ts`, on the `agent-fun/bars-replay/v1` protocol:

1. **Entry.** On the first batch that carries a CBBTC close, send one buy for
   `min(cash, caps.max_weight_bps * equity / 10000)` with `max_slippage_bps: 10000` so the fill is
   never refused on slippage. On a window with no leading gap this is batch 0 and fills at the open
   of bar 1. If the market refuses the order anyway (no bar at that open), the same order is sent
   again on the next bar that has one, while flat — a bot that never trades cannot race.
2. **Peak tracking.** While the position is held, record the highest equity seen (cash plus the
   position marked at its latest close). The peak starts at the first marked equity, i.e. after the
   entry's fee, slippage and price impact are already paid.
3. **Stop.** If equity falls **300 bps (3%) or more below that peak**, sell the entire position,
   again with `max_slippage_bps: 10000`, and then stay in cash for the rest of the window. No
   re-entry, no scaling, no second guess. A sell the market refuses is sent again on the next bar,
   because once the stop has fired the position must not be carried further.

The stop is the whole point of the design. A full-size round trip pays roughly 26 bps in fee,
slippage and price impact, so every extra signal-driven trade has to catch a move bigger than that
to pay for itself. The naive momentum, EMA-cross and channel filters tried against this dev window
lost money on the chop, while buy-and-hold made about 1%. So this bot makes exactly one entry
decision and spends its second decision only on risk.

Nothing reads the clock, the network, the environment or a random source: the same bars always
produce the same orders, which the grader's two-run determinism check requires.

## Stop-level sweep (dev window, local grade)

`STOP_BPS` was tested at four levels with the kit's own harness. Each figure is the dev window's
net PnL after every fee, slippage and price impact, from 1,000 USDC of paper capital:

| Stop | Net PnL (micro-USDC) | Return | Trades | Max drawdown | Verdict |
|---|---|---|---|---|---|
| 2.5% (250 bps) | -11,218,874 | -1.1219% | 2 | 2.671% | **Triggers** on the dev low and locks a loss — fails the dev gate |
| **3.0% (300 bps)** | **+9,795,891** | **+0.9796%** | **1** | **2.515%** | **Chosen**: never triggers on dev |
| 3.5% (350 bps) | +9,795,891 | +0.9796% | 1 | 2.515% | Identical to 3.0% on dev |
| 4.0% (400 bps) | +9,795,891 | +0.9796% | 1 | 2.515% | Identical to 3.0% on dev |

The dev window's worst peak-to-trough fall in this bot's own equity path is just above 2.51%
(a 251 bps stop triggers, a 252 bps stop does not), so 2.5% is inside the noise and 3.0% clears it
with about 48 bps to spare. Of the levels that pass, 3.0% is the tightest, so it gives the best
worst case: on the race window it caps what a fall can cost at roughly 3% plus whatever the next
bar's open gaps, instead of the double-digit drawdown a plain hold would wear.

## Exact dev grade

Kit: `btc-race-24h-20261109-2239` (dev phase, `dataset_sha256`
`0144817b7aceb2a0a127a21511291860aa5dab56bd6fb0a425c81f102b3b9900`), driver `process`,
graded from the worktree. The harness runs the bot twice and the two runs' action logs match:

- net PnL: **+9,795,891 micro-USDC** (+9.795891 USDC)
- return: **0.009795891** (+0.9796%)
- trades: **1**
- max drawdown: **0.025150864** (2.515%)
- Sharpe: **0.010729265**
- Sortino: 0.016633168, exposure 0.999306, rejected orders 0
- fees: 804,080 micro-USDC
- action log sha256: `ec69ec98c6db3489578a29bee94fe1d20678c6a2e8ee42ed58aac8fed96b4d40`

Same cash, same trades and the same marks as the kit's buy-and-hold house baseline on this window,
because the 3% stop never fires here. That is the intended result: the stop is insurance for the
race window, not a source of dev PnL.

## How to run

The bot needs Node 22 (TypeScript is run through Node's type stripping) and no dependencies. It
speaks the line protocol on stdin/stdout, so it is normally driven by the harness rather than by
hand. To reproduce the dev grade with the competition kit:

```bash
cd <path-to>/btc-race-24h-20261109-2239-kit
node cli/makefun.mjs grade-local \
  --kit . \
  --bot <path-to>/btc-race-fallback \
  --worktree \
  --driver process \
  --json
```

`vendor/makefun-bars.ts` is a byte-identical copy of the kit's `sdk/makefun-bars.ts`
(sha256 `e437a28f69bde12ba3383bffa68250d1e4b8f2d8a227a25eb8f8b654432fa261`); it owns the wire and
the `BarsState` helpers, and is not this entry's code.

## Files

| Path | What |
|---|---|
| `main.ts` | the bot: one entry, peak tracking, one 3% stop, then cash |
| `vendor/makefun-bars.ts` | byte-identical copy of the kit SDK shim |
| `.makefun/owner.json` | the claim file naming the entry's wallet |
| `LICENSE` | MIT |

## Risk

The stop is an insurance policy, not a profit centre. It costs nothing if the race window rises,
but a whipsaw — a 3% dip that recovers — sells the position near the low and forgoes the recovery,
and the exit fills at the next bar's open, so a gap can realise worse than 3%. Buying at the first
bar also means the entry price is whatever the race window opens at, with no filter to avoid a
window that opens at a local top.
