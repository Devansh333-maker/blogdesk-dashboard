# BlogDesk dashboard

Private source handover snapshot prepared on 21 October 2026. This repository contains application code, not a backup of the live reporting database. No deployment or n8n changes are performed by uploading it.

## Stack

React 19, TypeScript, Tailwind, Recharts, Vinext/Vite, Cloudflare Workers, D1 and Drizzle migrations. This is not a static-only application or a stock Next.js deployment.

## Local development

1. Install Node.js >=22.13 and pnpm.
2. Run `pnpm install --frozen-lockfile`.
3. Configure approved read-only endpoints using `.env.example`. Use ignored local environment files or the hosting provider's secret store. Never commit real values.
4. Run `pnpm dev`. The database-backed routes also require a local D1 database with the SQL migrations applied.
5. Run `pnpm build` to compile. `pnpm start` is Wrangler local preview, not a production deployment command.

Missing endpoint configuration or history must remain unavailable, not be interpreted as zero.

## Important hosting boundary

`.openai/hosting.json` and `vite.config.ts` retain the existing Sites integration for source fidelity. The project identifier is metadata, not a credential. The all-zero D1 identifier in Vite configuration is a local placeholder, NOT the production database identifier. Do not deploy this copy against the existing Sites project or run production migrations as part of a repository upload.

Company hosting needs a separate approved deployment configuration, a company-owned D1 binding named `DB`, runtime secrets and a staging verification. No GitHub Actions deployment is included, so a push cannot change the live site.

See [Company handover](docs/COMPANY-HANDOVER.md) for data preservation and cutover requirements.
