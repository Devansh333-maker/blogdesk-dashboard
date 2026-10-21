# Company hosting handover

## Scope of this repository

This is a clean snapshot of the dashboard source. It excludes old Git history, credentials, environment values, node_modules, generated builds, local Wrangler databases, logs, temporary archives and database exports. The October publication backfill JSON is intentional application data and is included.

The live site and all n8n workflows remain unchanged. Copying this repository does not copy live history or authorize any workflow edits.

## Data locations

| Data | Existing location | Handover requirement |
| --- | --- | --- |
| Daily blog summary snapshots | Sites-managed D1 `blog_daily_summaries` | Secure backup, import into company D1 and verify every date |
| Daily costs and usage snapshots | Sites-managed D1 `cost_daily_snapshots` | Secure backup, import and verify totals/currency |
| Analytics history | Configured n8n analytics endpoint | Preserve external history, schedules and access |
| Time-saved and creation timing data | Configured n8n endpoints | Preserve histories and endpoint contracts |
| Original article records | n8n data tables, Google Sheets, WordPress | Reuse approved read-only feeds; do not edit publishers |
| October publication classification backfill | `lib/data/october-publication-backfill.json` | Keep with source |
| To-do entries and UI cache | Browser storage | Origin-bound; does not automatically transfer to a new domain |

D1 also has rate-limit state and legacy credential/session tables. A database administrator must review those separately. Do not upload database backups or credential tables to Git, and do not blindly restore obsolete authentication state.

## Server configuration inventory

Active data feeds are configured through `N8N_BLOGS_WEBHOOK_URL`, `N8N_ANALYTICS_WEBHOOK_URL`, `N8N_OPENAI_COSTS_WEBHOOK_URL`, `N8N_TIME_SAVED_WEBHOOK_URL` and `N8N_CREATION_TIMINGS_WEBHOOK_URL`. The source also supports optional split-feed endpoints and `N8N_BLOGS_API_KEY`. Transfer actual values only through an approved vault.

The `.env.example` retains historical setup variables for source fidelity. The old dashboard key-entry/login endpoints are retired; do not treat every legacy variable as a current requirement. Review active route and rate-limit configuration during deployment. OpenAI Admin credentials should remain in the approved n8n credential, never in browser code, Git or responses.

## Deployment and cutover checklist

1. Company owns a private Git repository, cloud account, DNS, billing, secret vault and named administrators.
2. Choose target hosting. Retaining Workers/D1 minimizes runtime changes; another platform needs equivalent storage and runtime adaptation.
3. Replace/adapt the Sites-specific publishing integration in a company staging branch, without linking to the existing live Sites project. Provision a real D1 binding named `DB`.
4. Securely export the existing live database using an authorized export path. This repository does not contain that export. Preserve external n8n analytics history as well.
5. Apply migrations/import into staging; compare all dates, row coverage, per-variation totals, fresh/updated counts and costs with the old deployment. Do not reset historical data.
6. Configure server-only environment values. Review public report exposure, same-origin validation, endpoint authentication, throttling and long-running/streaming sync support.
7. Verify dashboard, analytics, efficiency, cost views, IST/UTC day boundaries, Excel downloads and error/partial-data states. Existing source publishing workflows must remain unchanged.
8. Back up production, import any final changes since the first export, then cut over company DNS after approval. Keep the old site available until rollback and parity checks finish.
9. Assign ongoing backups, monitoring and schedule ownership. No Sites cloud schedules were attached at the time of the hosting inspection; inventory n8n schedules independently.

## Continued editing

Use the company repository as the authoritative source after cutover. Contributors can edit a local checkout, push a branch and submit a review. Company CI should deploy approved changes. Uploading code to this personal repository does not transfer ownership of the original Sites application or configure company hosting.

## Security

Keep this repository private. Review any previously exposed API keys for rotation. Do not grant production access via a public URL or embed credentials in Git remotes. Public reports can still reveal draft metadata, costs and source details; company approval of the intended public fields is separate from infrastructure migration.
