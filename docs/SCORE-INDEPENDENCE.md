# WP6 — Engine Family Independence & Missing-Aware Final Score

## Objective

Remove two sources of false confidence:

1. treating related engine labels as if they were independent votes;
2. replacing missing score inputs with a neutral `50`.

The Final Decision Score remains a **research ranking score**, not a probability of profit.

## Engine-family policy

Source: `config/engine-family-registry.json`.

ASTRA counts agreement by declared family, not by raw engine label:

| Family | Members | Maximum vote |
|---|---|---:|
| NEXT_QUANT | V2.1, V5 | 1 |
| V4 | V4 | 1 |
| CLAUDE | CLAUDE_RC2 | 1 |
| CONFLUENCE | V1, V2 | 1 |

Important: a different code path is **not proof of statistical independence**. Therefore every family currently has:

`statisticalIndependenceClaim=false`

The cockpit exposes `familyBreadthCount`. The old `agreementCount` remains only as a compatibility alias and must equal the family count.

V2.1 and V5 currently publish the same ranking payload and can never create two votes. Confluence V1/V2 also count once.

## Family breadth bonus

The broad-conviction layer now uses a smaller, explicit breadth term:

`+4 points per additional declared family`

instead of `+6 per “independent engine family”`.

This is deliberately labeled **family breadth**, not independence.

## Missing-value policy

The previous Final Decision Score used fallbacks such as `?? 50`. That can hide missing information behind a neutral-looking value.

V6.9 removes that behavior.

Components:

- technical;
- entry quality;
- context;
- risk/reward;
- risk control;
- evidence.

Missing components are **not imputed**.

The score is calculated from available components with their configured weights renormalized. Missing data then causes explicit conservative caps:

- missing technical → score capped below 50;
- missing entry quality, R:R, or risk control → score capped below the B gate (61.9);
- missing context → score capped at 74.9;
- low total score coverage also applies conservative caps.

Every setup exposes:

- `finalDecisionCompleteness.coveragePct`;
- `missingComponents`;
- `scoreCap`;
- `capReasons`;
- `neutralImputationUsed=false`.

## Forward evidence removed from Final Score

The old score added one global forward-evidence value to every ticker. A global value cannot discriminate one ticker from another and can make the ranking look more evidence-based without adding ticker-specific information.

WP6 removes forward evidence from Final Decision Score entirely.

Forward evidence continues to exist in:

- prospective evidence;
- outcome analytics;
- walk-forward validation;
- WP5 calibrated forward estimates/probabilities.

Only WP5 may release ticker-level validated probabilities when its evidence gates mature.

## Weight sensitivity

For each setup, ASTRA now performs a deterministic sensitivity check:

1. perturb one available component weight by `-20%`;
2. renormalize available weights;
3. recompute score;
4. repeat at `+20%`;
5. do this for each available component.

The cockpit records:

- minimum score;
- maximum score;
- maximum absolute delta;
- whether the letter grade changes;
- all perturbation cases.

Robustness states:

- `STABLE` — max absolute score movement ≤ 2.5;
- `SENSITIVE` — ≤ 5;
- `FRAGILE` — > 5.

This is a sensitivity diagnostic, not a probability.

## Safety

No automatic execution is introduced.

- research only;
- execution OFF;
- missing data can only reduce/cap confidence, never improve eligibility.
