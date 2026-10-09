# WP8 — Operations, Health & Automatic Issue Reconciliation

## Objective

Turn ASTRA's integrity checks into an operational surface that can answer:

- Is the current session safe to research?
- Are market/history stores aligned?
- Are the persistent ledgers intact?
- Is the source universe degraded?
- Does quant freshness disagree with canonical freshness?
- Is evidence maturity still insufficient?
- Is automatic execution still OFF?

WP8 does **not** turn operational health into a trading signal.

## Health artifact

The canonical build writes:

- `data/operations-health.json`
- `docs/data/operations-health.json`

and embeds the same snapshot in:

`decision-cockpit.operationsHealthEngine`

Schema:

`astra-operations-health/v1`

## Operational states

Overall state is one of:

- `HEALTHY`
- `DEGRADED`
- `CRITICAL`

A warning such as partial source coverage may produce `DEGRADED` without falsely implying the decision engine is unusable.

Critical state is reserved for failures such as:

- automatic-execution safety invariant failure;
- broken market/history atomic handoff;
- broken persistent ledger chains.

Release hardening refuses a `CRITICAL` operational build.

## Checks

WP8 evaluates:

- execution safety;
- atomic market/history handoff;
- decision-data freshness;
- active-universe source coverage;
- canonical-vs-quant freshness consistency;
- prediction/event ledger hash chains;
- current-session replay persistence;
- quant pipeline status;
- calibration maturity;
- walk-forward maturity;
- independent-source quorum disclosure.

Evidence maturity and lack of independent quorum are informational limitations, not silently converted into failures.

## Health page

Static health page:

`docs/health.html`

Vercel route:

`/health`

The page refreshes the no-cache operational JSON every 60 seconds and displays the current checks and active issue candidates.

## GitHub Actions Summary

The sole canonical production writer adds an **ASTRA Operations Health** table to `GITHUB_STEP_SUMMARY` after the build/ledger verification and before the canonical commit.

The summary includes:

- overall state;
- session;
- PASS/WARN/FAIL/INFO counts;
- active issue candidate count;
- every check and detail;
- explicit `Automatic execution: OFF`.

## Automatic issue reconciliation

Workflow:

`.github/workflows/operations-watch.yml`

It runs:

- after a successful Daily EGX Data Refresh;
- on an after-market schedule;
- manually.

For each known operational condition it uses a stable issue title. It does not create a new issue on every run.

Behavior:

- active condition + no issue → open issue;
- active condition + existing issue → update/reopen same issue;
- cleared condition + open issue → comment and close automatically.

Current automatic candidates include:

- execution safety;
- atomic handoff;
- ledger integrity;
- current-session persistence;
- active source coverage below 80%;
- explicit active-symbol source failures;
- canonical/quant freshness mismatch;
- stale decision data.

If GitHub Issues is disabled or unavailable, the workflow records a warning in the Actions summary rather than pretending issue automation succeeded.

## Release policy

Release audit requires:

- operations-health schema present;
- health session equals cockpit session;
- automatic execution false;
- no duplicate check or issue keys;
- overall state not `CRITICAL`.

`DEGRADED` may still ship when the degradation is explicitly surfaced and mandatory decision gates remain intact.

## Safety

WP8 is operational governance only.

Automatic execution remains OFF.
