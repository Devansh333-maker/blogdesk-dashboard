# Reporting-history backups

These reviewed, private, point-in-time backups preserve dashboard reporting data independently of the live website. They do not replace production hosting and do not make GitHub the live database. No scheduled future backup is configured by this commit.

Each dated directory contains full reporting API responses in JSON, CSVs for Excel analysis, a source database date/timestamp inventory, a checksum manifest, and a logical reporting SQL restore file. Dates missing in the sources stay missing; they are not converted into zero counts. Today's snapshot may be incomplete.

## Use without the live dashboard

Clone/download this private repository and open the CSV files in Excel. JSON retains nested fields and source-coverage details. Existing code and the October classification backfill are in the same repository. A clone is an additional local copy; keep an independent offline copy too.

## Verify

Run `node scripts/verify-reporting-backup.mjs 2026-10-21` from the repository root. This checks SHA-256 hashes and tests the reporting SQL against an in-memory database. It never connects to production.

## Restore boundaries

`restore-reporting.sql` reconstructs canonical merged blog summaries and saved cost/usage reports into the two reporting tables. It does NOT contain exact raw D1 payloads, credentials, sessions, rate-limit state or original source-system records. The Sites table browser truncates large cells; the complete dashboard reporting APIs are used instead. Existing records are not overwritten by the SQL.

Test a restore into an isolated database first. Migrations and an appropriate D1 binding are still required for a hosted deployment. Some application routes also require external n8n endpoints; importing this SQL alone does not turn the current application into a fully offline dashboard. Time-saved and creation histories are backed up in JSON/CSV, but require an application adapter or source-system import to serve from a replacement backend.

## Refresh manually

The supplied exporter performs GET requests to saved reporting endpoints only; it does not call Sync, publish articles, edit workflows or deploy. First prepare a fresh database date inventory, review the source coverage, then run `node scripts/backup-reporting-history.mjs YYYY-MM-DD`. It refuses to overwrite existing generated files. Check the manifest, scan for sensitive data and review the Git diff before committing/pushing. Do not run this blindly as an automated job: date inventory and retention need an approved automation design.

Only intended reporting history belongs here. Never add raw environment files, database credential/session tables, n8n credential exports or article bodies. This repository must remain private, with company permission for retaining company reporting data.
