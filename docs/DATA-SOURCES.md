# ASTRA Data Sources & Coverage Policy

## Purpose

ASTRA must distinguish **missing data** from **bad signals**. Source failures are never converted into negative investment signals, and coverage is never improved by silently deleting stale symbols from the denominator.

## Active source registry

Machine-readable source policy: `config/data-source-registry.json`.

### RAS-EGX-PRO2026-NEXT

Role: **authoritative upstream mirror**.

ASTRA consumes the user's canonical repository through an atomic handoff and verifies:

- expected market session;
- execution-grade flag;
- current-session row count;
- market/history session equality;
- market/history source fingerprint equality;
- freshness of the upstream decision artifacts used by the handoff.

This is the only enabled current-session source in WP4.

### Mubasher provenance

Some upstream rows carry Mubasher provenance. WP4 does **not** add a new ASTRA scraper for Mubasher. Those labels are treated as upstream provenance only.

### Yahoo Finance

Automated Yahoo collection is **disabled**.

The Yahoo Terms reviewed on 2026-10-09 prohibit automated collection from the Services without express prior permission. The existing legacy Yahoo fallback code therefore cannot be enabled by configuration alone: `quant/fetch/daily_update.py` now also checks the central registry and refuses automated Yahoo access unless the registry explicitly records both:

- `enabled=true`
- `automatedAccessAllowed=true`

Until express permission exists, both remain false.

Terms reviewed:
`https://legal.yahoo.com/in/en/yahoo/terms/otos/index.html`

Yahoo historical provenance that already exists in old files is not deleted; it is labeled as provenance and is not treated as a newly authorized verifier.

## Coverage states

Each symbol is placed in exactly one state:

- `CURRENT_VERIFIED` — latest history session equals the expected session and the source is not marked stale/failed.
- `ACTIVE_STALE` — presumed active but behind the expected session.
- `SOURCE_FAILED` — source explicitly reports an update failure.
- `DORMANT` — explicit inactive metadata exists.
- `SUSPENDED` — explicit suspension evidence exists.
- `DELISTED` — explicit delisting evidence exists.

### Denominator rule

Only `DORMANT`, `SUSPENDED`, and `DELISTED` may be removed from the active coverage denominator, and only when the status is supported by explicit metadata.

`ACTIVE_STALE` and `SOURCE_FAILED` **remain in the denominator**.

This prevents the system from manufacturing a higher coverage percentage by calling stale symbols inactive.

## Current baseline finding

On the current 2026-10-07 canonical history snapshot:

- registered history symbols: 201;
- current-session symbols: 183;
- `NDRL` and `SPHT` carry explicit `updateFailed=true`, so they are `SOURCE_FAILED`, not dormant;
- the remaining behind-session symbols remain `ACTIVE_STALE` unless explicit inactive evidence later appears;
- `EFID` and `EXPA` are current in the canonical history store while the older quant status still lists them as stale. WP4 exposes this as a **cross-store consistency warning**, rather than silently choosing whichever number looks better.

The source-health engine writes:

- `data/source-health.json`
- `docs/data/source-health.json`

and embeds the same report into `data/decision-cockpit.json`.

## Independent quorum

WP4 does not claim an independent source quorum.

The canonical upstream may itself contain verification/provenance evidence, but that is not the same as ASTRA independently collecting a second permitted source. Until an independent verifier is legally and technically enabled, the status is:

`SINGLE_SOURCE_NO_INDEPENDENT_QUORUM`

This is displayed as a limitation, not hidden.

## Safety

Source governance does not alter the research strategy and cannot enable order execution.

Automatic execution remains OFF.
