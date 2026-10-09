# WP5 — Forward Calibration Governance

## Objective

ASTRA must not convert a small or highly dependent forward sample into a precise-looking probability.

WP5 separates three concepts:

1. **Decision Score** — ranking signal from the decision model.
2. **Forward Empirical Estimate** — descriptive frequency/return estimate from recorded-forward outcomes.
3. **Validated Probability** — released only after sample maturity **and** the independent walk-forward release gate.

Automatic execution remains OFF.

## Eligible evidence

Only records satisfying all of the following enter calibration:

- `recordedForwardEligible=true`;
- not excluded as a duplicate;
- terminal outcome is `RESOLVED`;
- prediction existed contemporaneously rather than being reconstructed later.

Late captures remain stored for audit but are excluded from forward calibration.

## Maturity uses outcomes AND distinct sessions

Record count alone is not enough.

| State | Minimum resolved | Minimum distinct sessions |
|---|---:|---:|
| INSUFFICIENT_EVIDENCE | below 30 or below 10 | — |
| PRELIMINARY | 30 | 10 |
| CALIBRATING | 60 | 20 |
| MATURE_SAMPLE | 90 | 30 |

Even `MATURE_SAMPLE` does **not** automatically become a validated probability.

The engine status becomes `VALIDATED` only when the walk-forward governance gate also passes:

- at least 3 valid forward folds;
- at least 30 resolved OOS outcomes;
- at least 10 distinct OOS sessions.

Until then the state is `MATURE_SAMPLE_WAITING_WALK_FORWARD`.

## Hierarchical pooling

ASTRA no longer relies on one sparse 4-dimensional cell or immediately collapses to one global average.

Pooling walks from most specific to broadest:

1. grade + entry quality + R:R + context;
2. grade + entry quality + R:R;
3. grade + entry quality;
4. grade;
5. overall recorded-forward pool.

An empirical bucket requires at least **30 resolved outcomes across 10 distinct sessions**. A validated probability pool requires the full mature threshold **90 / 30**.

The chosen pool level is exposed in every `targetAchievement`.

## Session-block bootstrap

Forward observations from the same market session are correlated.

WP5 therefore replaces record-level confidence assumptions with a deterministic **session-block bootstrap**:

- resample distinct sessions with replacement;
- retain every record belonging to each sampled session;
- 500 deterministic resamples;
- report the 5th and 95th percentiles as a 90% interval.

Intervals are produced for:

- T1 empirical estimate;
- T2 empirical estimate;
- stop estimate;
- average net return.

The deterministic seed makes the audit reproducible.

## Probability fields are withheld

Before validation, ASTRA may expose fields such as:

- `t1EstimatePct`;
- `t2EstimatePct`;
- `stopEstimatePct`;
- `expectedValueEstimatePct`.

But these remain null until validation:

- `t1ProbabilityPct`;
- `t2ProbabilityPct`;
- `stopProbabilityPct`;
- `expectedValuePct`.

This prevents the UI from presenting an empirical estimate as a calibrated probability.

## Ex-ante probability scoring

New evidence records use `evidenceKeyVersion=session+ticker/v3` and freeze the probability state that existed **at capture time**:

- T1 probability;
- T2 probability;
- stop probability;
- calibration status;
- sample size;
- distinct sessions;
- pooling level.

Older v2 hashes remain backward-compatible.

When at least 30 scored predictions across 10 distinct sessions exist, WP5 reports:

- **Brier score**;
- **ECE** (expected calibration error);
- five reliability bins showing predicted vs observed frequency.

Only predictions that were already `VALIDATED` at capture are eligible for these calibration-quality scores. Later knowledge cannot be backfilled.

## Walk-forward ordering

The production build now runs:

`resolve outcomes → walk-forward validation → probability calibration → decision/risk pipeline → capture new evidence → replay/governance`

This ensures probability release uses the current walk-forward gate rather than a stale prior-build gate.

## Current production state

The current persisted evidence begins with a late-captured 2026-10-07 session, so it is not valid forward calibration evidence.

WP5 therefore intentionally shows **INSUFFICIENT_EVIDENCE**, not a manufactured percentage.

The system must accumulate genuinely contemporaneous future sessions before calibration can mature.

## Safety

- Research only.
- No automatic orders.
- No threshold relaxation.
- No historical backfill presented as a recorded prediction.
