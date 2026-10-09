# WP0 — Review Baseline

Captured against `main@90fe9acbec3ee2bccec1426b19ff872588b97d6d` on 2026-10-09.
The quantitative session currently committed on main is **2026-10-07**.

## Safety invariant

Current committed cockpit safety remains:

- `researchOnly=true`
- `executionAllowed=false`
- `automaticOrders=false`

No WP0 change modifies strategy rules, weights, promotion thresholds, or execution permissions.

## Review findings re-checked against current main

| Item | Status | Evidence on current main |
|---|---|---|
| P0-1 Persistent trust/forward record does not accumulate | **CONFIRMED** | `data/prospective-evidence.json`, `data/prediction-ledger.json`, `data/replay/index.json`, `data/walk-forward-validation.json`, `data/model-governance.json`, and `data/daily-decision-brief-history.json` all return 404 on main. The refresh workflow names them in `git add`, but the committed cockpit still reports `forwardRecords=1`, `forwardResolved=0`. |
| P0-2 Shared-output write races | **CONFIRMED** | `daily-egx-data-refresh.yml` writes/commits `data/decision-cockpit.json` and docs mirrors. `quant-daily.yml` also writes and commits `data/decision-cockpit.json` + `docs`. The quant push is a single `git pull --rebase && git push` without a retry loop. `cockpit:build` chains many mutating Node stages over the same cockpit document. |
| P0-3 Python and Node measure different execution plans | **CONFIRMED** | Python `run_trade/run_plan` requires next-session opening within ±1%, models open gaps, limit-down lock, stop-first ordering, 50% T1 exit + break-even remainder, 0.6% cost and 10-session horizon. Node resolver currently uses later OHLC entry-zone touch with fill at `entryHigh`, no one-session expiry, no gap/limit-down execution model, and treats T1 as a milestone rather than partial exit. Same-bar ambiguity is excluded rather than conservatively settled. |
| P0-4 “6 engines” independence | **CONFIRMED** | `data/comparison/daily.json` explicitly says `v2AndV5IndependentToday=false`; V2 and V5 are identical Top10 on 2026-10-07. V4 overlap with them is zero that day; Confluence V1 has zero recommendations and V2 has one (FWRY). |
| P1-5 TradingView unofficial dependency | **CONFIRMED** | `scripts/confluence-pullback-v2.js` calls `https://scanner.tradingview.com/global/scan` and permits `B_TRADINGVIEW_CORROBORATED` profitability evidence. TOS/robots review is not yet documented in `docs/DATA-SOURCES.md`. |
| P1-6 Daily data has a single canonical upstream | **CONFIRMED for canonical/quant path** | Daily refresh defaults to raw files from `RAS-EGX-PRO2026-NEXT`; quant workflow executes `daily_update.py --no-yahoo`. Yahoo exists in Confluence intraday fallback but is disabled for the quant daily update/verification path. |
| P1-7 Calibration maturity and dependence | **CONFIRMED** | `probability-calibration-engine.js` uses maturity by record count (10/30/90), Wilson intervals, and grade × entry-quality × RR × context cells. It does not require distinct sessions and does not block-bootstrap by session. |
| P1-8 Missing inputs score as neutral | **CONFIRMED** | `final-decision-score-engine.js` uses fixed weights 0.25/0.20/0.15/0.15/0.10/0.10/0.05 and fallbacks such as `??50`. One global `forwardScore()` is applied to every row. |
| P1-9 Permanent partial coverage | **CONFIRMED in current status** | `quant/data/daily-data-update-status.json` reports `coveragePct=89.9`, `staleRows=20`, and the same 20 symbols listed in the review. There is no dormant/suspended denominator policy in this status file. |
| P2-10 Test/code duplication debt | **CONFIRMED in substance** | Current tree has 53 Node scripts. `npm test` runs 12 validation scripts but does not run confluence validation, confluence-v2 validation, cockpit validation, walk-forward validation, or the three `tests/*.test.js` files. RSI/ATR logic exists independently in Python, `build-technical-analysis.js`, and `app/api/stock-analysis.js`. Docs contain `index.html`, `v2.html`, `v5.html`, `v5/index.html`. |
| P2-11 Build creates uncommitted generated output | **CONFIRMED** | Successful release-hardening build reports technical `count=200`. The repository currently tracks zero files under `data/technical/` or `docs/data/technical/`; therefore the build creates hundreds of files in tracked directories without a committed/generated-output policy. |
| Prior “first-run npm test transient” | **NOT REPRODUCED YET** | Current release-hardening run 37947211507 passed `npm test`. WP0 adds a dedicated clean-worktree 20-run stability gate; acceptance waits for its result. |

## Frozen quantitative baseline

Source: `quant/data/signals.json` blob `59ff171b6d0e52d4c4b2cfa07ea849ac39b6d30a`.
Machine-readable copy: `docs/baseline-metrics.json`.

| Group | n | days | hit % | win % | avg net % | median % | PF |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline all | 13272 | 112 | 32.6 | 45.7 | 0.33 | -1.11 | 1.12 |
| Top3 | 301 | 111 | 44.9 | 55.5 | 1.44 | 2.34 | 1.73 |
| Top5 | 488 | 111 | 43.9 | 53.9 | 1.15 | 1.70 | 1.59 |
| Top10 | 968 | 112 | 40.4 | 50.8 | 0.78 | 0.39 | 1.38 |

Top5 excess mean = **+0.73%**; 90% block-bootstrap CI = **[-0.10%, +1.28%]**; positive folds = **16/23**.  
Therefore **outperformance is not established**, because the interval includes zero.

Placebo excesses: `[-0.16, +0.39, -0.38, -0.40, +0.32]`; mean **-0.05%**.

Portfolio baseline:
- Two-target plan: return **+13.91%**, max drawdown **-8.75%**, Sharpe **2.13**, 78 trades.
- Hold-T2 variant: return **+19.45%**, max drawdown **-11.17%**, Sharpe **2.27**, 60 trades.
- Equal-weight market baseline: **+29.5%**.
- Random-selection benchmark mean: **+4.82%**; strategy beats random in **90%** of 20 runs.

## Workflow run baseline

Durations below are wall-clock seconds from run start to update completion. When fewer than 10 historical runs exist, all available runs are listed.

### ASTRA E2E Pipeline — latest 10

| Run | Result | sec |
|---|---|---:|
| [198](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37947211570) | success | 16 |
| [197](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37947205921) | success | 22 |
| [196](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37947181682) | success | 21 |
| [195](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942714075) | success | 19 |
| [194](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942708726) | success | 20 |
| [193](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942672223) | success | 17 |
| [192](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942647242) | success | 16 |
| [191](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942640435) | success | 17 |
| [190](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942633898) | success | 19 |
| [189](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942627630) | success | 16 |

No failure in the latest ten.

### ASTRA Deployment Acceptance — only 2 runs exist

| Run | Result | sec |
|---|---|---:|
| [2](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37216289754) | success | 165 |
| [1](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37181959177) | success | 157* |

* GitHub timestamps on run 1 span a later resume/update window; job-level duration is more meaningful than the run's final updated timestamp.

### Daily EGX Data Refresh — latest 10

| Run | Event | Result | sec |
|---|---|---|---:|
| [27](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37930022549) | push | success | 16 |
| [26](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37928661474) | push | success | 16 |
| [25](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37928311608) | push | success | 11 |
| [24](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37922143053) | push | success | 12 |
| [23](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37836444599) | workflow_run | success | 12 |
| [22](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37828736065) | schedule | success | 12 |
| [21](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37787673268) | workflow_run | success | 10 |
| [20](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37679197552) | workflow_run | success | 12 |
| [19](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37671750375) | schedule | success | 19 |
| [18](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37630771752) | workflow_run | success | 18 |

No failure in the latest ten. Note: a successful no-op/preflight run does not prove persistent ledgers were committed; the files are absent on main.

### ASTRA Daily Stability Audit — latest 10

| Run | Result | sec |
|---|---|---:|
| [11](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37836407685) | success | 14 |
| [10](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37787642950) | success | 12 |
| [9](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37679166904) | success | 13 |
| [8](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37630695937) | success | 32 |
| [7](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37520957046) | success | 16 |
| [6](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37471322890) | success | 17 |
| [5](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37392896755) | success | 11 |
| [4](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37330126573) | success | 14 |
| [3](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37237378055) | success | 10 |
| [2](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37223838981) | success | 10 |

No failure in the latest ten.

### Deploy Pages on docs changes — all 10 historical runs

| Run | Result | sec | Note |
|---|---|---:|---|
| [10](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37915176256) | success | 21 | |
| [9](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37904864919) | success | 23 | |
| [8](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37902786297) | success | 21 | |
| [7](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37902423286) | success | 33 | |
| [6](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37852769235) | success | 21 | |
| [5](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37852251425) | success | 20 | |
| [4](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37850745059) | success | 23 | |
| [3](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37849743252) | success | 24 | |
| [2](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37369426961) | failure | 905 | deploy job ended `cancelled`; available job metadata does not state a deeper cause, so none is invented here. |
| [1](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37352906017) | success | 36 | |

### ASTRA Quant Lane — latest 10

| Run | Result | sec | Cause when failed |
|---|---|---:|---|
| [50](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37930054263) | failure | 38 | stale `serve-validation.js` expected text `ASTRA V5 Command Center`. |
| [49](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37928695059) | failure | 31 | same stale title assertion. |
| [48](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37928337188) | failure | 38 | same stale title assertion. |
| [47](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37922170270) | failure | 34 | same stale title assertion. |
| [46](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37905279090) | success | 73 | |
| [45](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37905098620) | success | 64 | |
| [44](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37904864923) | failure | 36 | Python site assertion found missing embedded session/data marker in built page. |
| [43](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37853173656) | success | 76 | |
| [42](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37852943750) | success | 61 | |
| [41](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37852769257) | success | 69 | |

The stale title assertion is fixed on current main; release-hardening currently passes the same runtime validation.

### ASTRA Release Hardening Audit — latest 10

| Run | Result | sec | Cause |
|---|---|---:|---|
| [24](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37947211507) | success | 53 | all build/tests + 10 audit cycles passed. |
| [23](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37947181660) | cancelled | 38 | superseded by a newer push; workflow has `cancel-in-progress: true`. |
| [22](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942713947) | success | 55 | |
| [21](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942709077) | cancelled | 4 | superseded by newer push. |
| [20](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942672125) | cancelled | 45 | superseded by newer push. |
| [19](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37942627577) | cancelled | 35 | superseded by newer push. |
| [18](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37934238919) | success | 39 | 10 consecutive audit cycles clean. |
| [17](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37933750019) | failure | 197 | release audit detected remaining “decision score as probability” UI label in all 10 cycles. Fixed later. |
| [16](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37933743795) | cancelled | 5 | superseded by newer push. |
| [15](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37933643579) | cancelled | 56 | superseded by newer push. |

### UCP Forward Evidence Ledger — only 7 runs exist

| Run | Result | sec | Reason |
|---|---|---:|---|
| [7](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37828615664) | skipped | 2 | job condition requires `vars.ASTRA_V5_PROD_URL != ''`; variable was not available. |
| [6](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37671679309) | skipped | 1 | same job condition. |
| [5](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37512560791) | skipped | 2 | same job condition. |
| [4](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37371569686) | skipped | 1 | same job condition. |
| [3](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37218904055) | skipped | 1 | same job condition. |
| [2](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37181959190) | skipped | 1 | same job condition. |
| [1](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37181681237) | failure | 128 | `PRODUCTION_COMMIT_MISMATCH`: expected current commit, production returned another commit. |

### UCP Real Morning Evidence Collector — only 6 runs exist

| Run | Result | sec |
|---|---|---:|
| [6](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37792323189) | success | 14 |
| [5](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37635383157) | success | 13 |
| [4](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37475248191) | success | 15 |
| [3](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37334382623) | success | 20 |
| [2](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37204303899) | success | 13 |
| [1](https://github.com/rasheadsca-star/astra-v5-egx/actions/runs/37181681232) | success | 16 |

## WP0 stability gate

A dedicated branch-only workflow `.github/workflows/wp0-test-stability.yml` performs **20 consecutive `npm test` executions**. Before each iteration it resets and cleans the worktree, so every test starts from the same checked-out source. Logs for all 20 iterations are uploaded as an artifact and the workflow fails after completing all attempts if any attempt fails.

WP0 acceptance is not complete until that workflow reports **20/20**.

## Baseline conclusion

The original review was not stale on the structural P0/P1 findings. Recent V6 hardening improved UI/runtime consistency, risk sizing, replay code, and release checks, but the **committed production evidence foundation is still broken at the repository level** because the trust/forward files are absent from main and the two production workflows still write overlapping decision outputs.

The next implementation package after WP0 acceptance is **WP1: persistent append-only ledgers**.
