# WP3 — Single-Writer Production Pipeline

## Goal

Remove production-state races by assigning one authoritative workflow to canonical ASTRA outputs.

## Authoritative producer

`.github/workflows/daily-egx-data-refresh.yml` is now the sole writer for:

- canonical market/history stores;
- quant/published signals;
- engine comparison and Confluence outputs;
- decision cockpit;
- prospective evidence;
- evidence-event ledger;
- prediction ledger and replay archive;
- walk-forward validation;
- model governance;
- daily brief history;
- static docs generated from the same session.

The output contract is machine-readable in `config/output-ownership.json`.

## Read-only quant lane

`.github/workflows/quant-daily.yml` is converted into a validation-only workflow:

- no schedule;
- no `workflow_run` production trigger;
- `contents: read`;
- no `git commit`;
- no `git push`;
- it may generate outputs only inside the ephemeral Actions workspace.

## Production order

The single producer performs:

1. source readiness preflight;
2. canonical market/history refresh;
3. atomic-store validation;
4. ASTRA -> quant session bridge;
5. guarded quant update;
6. astra-quant publication;
7. static site build;
8. Confluence V1/V2 build + validation;
9. engine comparison;
10. full canonical cockpit/trust build;
11. persistent-ledger verification;
12. **one canonical commit**;
13. non-force rebase/push retry loop.

This ensures cockpit/trust state is built from the same quant/confluence session that is committed with it.

## Generated technical data

`data/technical/**` and `docs/data/technical/**` remain reproducible build outputs and are deliberately reset from the production commit staging area.

## Independent UCP ledger

`data/ucp/forward-ledger.json` remains an isolated experimental ledger with its own writer. Its workflow is prohibited from writing canonical cockpit/trust paths. It is not treated as an authoritative ASTRA decision-state producer.

## Safety

This work changes orchestration only.

- research-only remains true;
- execution stays disabled;
- no automatic order path is added.
