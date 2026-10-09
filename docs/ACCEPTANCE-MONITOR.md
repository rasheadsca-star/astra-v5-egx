# ASTRA V6.11 — Live Acceptance Monitor

## Frozen release

- Release: **ASTRA V6.11**
- Frozen commit: `f5d8dce6961f9485d83c4ae51bdfdfcac1d7d6b4`
- Stable release branch: `release-v6.11-stable`
- Baseline session: **2026-10-07**
- Production deployment at freeze: `dpl_BzvJHa47X6CtKyMrjuACHy1XV4Uf`
- Automatic execution: **OFF**

The stable branch is an immutable reference point for the acceptance window. Main may receive only acceptance/operations plumbing while the code-freeze is active.

## Acceptance window

ASTRA V6.11 is accepted only after the **first two distinct replay sessions after 2026-10-07** both pass all checks.

Each session must satisfy:

1. The replay session is unique.
2. The prediction-ledger session is unique.
3. Capture timing is `ON_SESSION_AFTER_CLOSE`.
4. `recordedForwardEligible=true`.
5. A replay snapshot exists and its stored SHA-256 is valid.
6. The prediction-ledger record links to the exact replay snapshot.
7. The source-session fingerprint matches between ledger and replay.
8. The snapshot confirms an atomic market/history handoff for the same session.
9. Prediction capture events exist in the append-only event ledger.
10. Prospective evidence exists and is forward-eligible.
11. Prediction and event hash chains remain VERIFIED.
12. The frozen 2026-10-07 baseline snapshot and prediction-record hash remain unchanged.
13. `researchOnly=true`, `executionAllowed=false`, and `automaticOrders=false`.

A repeated build of the same session must not create another replay or prediction-ledger session.

## Status meanings

- `WAITING_FOR_FIRST_SESSION`: no post-freeze live session captured yet.
- `ONE_SESSION_ACCEPTED`: first live session passed; one remains.
- `ACCEPTANCE_COMPLETE`: first two live sessions both passed.
- `ACCEPTANCE_FAILED`: an integrity, timing, persistence, fingerprint, duplicate, or safety check failed.

## Files

- Freeze contract: `config/release-freeze.json`
- Acceptance engine: `scripts/live-acceptance-engine.js`
- Pure evaluator: `scripts/lib/live-acceptance.js`
- Persistent report: `data/live-acceptance.json`
- Public mirror: `docs/data/live-acceptance.json`
- Dashboard: `docs/acceptance.html`
- Watch workflow: `.github/workflows/live-acceptance-watch.yml`
- Freeze guard: `.github/workflows/release-freeze-guard.yml`

No probability maturity or walk-forward status is promoted by this acceptance test. Those metrics continue to require their own real forward sample thresholds.
