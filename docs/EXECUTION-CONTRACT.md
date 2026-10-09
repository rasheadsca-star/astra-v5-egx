# WP2 — Canonical Execution Contract

## Objective

Make the Python quant backtest and the Node prospective resolver evaluate the **same trade contract**. This package changes evaluation semantics only; it does not enable execution or place orders.

Safety remains:

- `researchOnly=true`
- `executionAllowed=false`
- `automaticOrders=false`

## Canonical contract

Source of truth: `config/execution-contract.json`.

The contract is:

1. Signal is frozen at session close.
2. Entry is allowed **only at the next session open**.
3. The next open must be inside the frozen entry zone; otherwise the setup expires unfilled.
4. Later sessions cannot create a delayed entry.
5. Intraday tie: stop is evaluated before target.
6. Later-session gap through stop/target fills at the open.
7. Limit-down lock handling follows the same Python rule used by the historical engine.
8. T1 exits 50% of the position.
9. After T1, the remaining 50% moves to breakeven.
10. On the same post-T1 bar, breakeven is checked before T2.
11. T2 ends the remaining position.
12. Maximum holding horizon is 10 sessions.
13. Time exit is the close at the horizon.
14. One 0.60% round-trip cost is deducted from the combined plan return.

## Cross-language golden vectors

`config/execution-golden-vectors.json` contains **36 fixed cases** covering three price scales and twelve execution scenarios:

- high/low open outside the entry zone;
- entry-day stop;
- T1 then breakeven;
- T1 then T2;
- T1 then gap below breakeven;
- later gap above T2;
- gap through stop;
- limit-down lock then next-open exit;
- fixed-horizon time exit;
- same entry bar stop+T1;
- same post-T1 bar breakeven+T2.

Both evaluators must pass every vector:

- Node: `scripts/execution-contract-validation.js`
- Python: `quant/tests/test_execution_contract.py`

## Before / after

Before WP2:

- Python used next-open-only entry, gap rules, stop-first ordering, limit-down lock, partial T1, breakeven remainder, 10-session horizon and 0.60% cost.
- Node prospective evidence used later OHLC zone touches, could enter after the next session, filled at entry-high, treated T1 as a milestone, and used ambiguous-bar states instead of the Python stop-first rule.

After WP2:

- Python constants are loaded from the shared JSON contract.
- Node prospective resolution uses the canonical evaluator.
- Late captures are not admitted to forward calibration.
- Walk-forward validation is restricted to `recordedForwardEligible=true`.
- The same fixed golden vectors are executed in both languages.

## Baseline impact

The Python numeric constants in WP2 are identical to the frozen WP0 values:

- horizon = 10
- cost = 0.006
- stop ATR = 1.5
- T1 ATR = 1.0
- T2 ATR = 2.5
- entry zone = ±1%
- T1 fraction = 50%

Therefore the historical Python contract is intentionally preserved while the Node prospective resolver is brought into parity. Any unexpected change in the frozen WP0 quant metrics is a release failure and must be investigated, not normalized away.

## Acceptance

WP2 is accepted only if:

- all 36 Node golden vectors pass;
- all 36 Python golden vectors pass;
- existing Node tests pass;
- existing Python quant tests pass;
- full cockpit build succeeds;
- automatic execution remains OFF.
