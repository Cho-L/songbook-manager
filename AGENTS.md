# AI contributor instructions — Songbook Manager

## Project and deployment
- Production is served at https://songbook-manager.sbook.workers.dev/ using Cloudflare Workers (see `wrangler.toml`, `workers/worker.js`).
- React / TypeScript / Vite frontend; Supabase integration.
- Historical `netlify.toml` does NOT establish the current production deployment target.

## Non-negotiable safety rules
1. Never deploy, publish, merge into `main`, or run `wrangler deploy` without the owner's explicit approval.
2. Never modify production Cloudflare bindings, secrets, Supabase projects, authentication policies, database records, or migrations as an incidental change.
3. Work on a separate branch and open a **draft pull request** for review. No automatic merging.
4. Do not use real user data, tokens, or production credentials in tests. Do not echo secrets to logs.
5. Preserve backward compatibility for songbooks, song requests, OBS overlays, import/export, and user data.
6. Changes affecting Cloudflare Worker routes, Supabase schema/RLS, auth, payments, or user data require a specific risk assessment, rollback instructions, and explicit human approval.
7. Do not confuse mock tests with verified external integrations. Describe exactly what was tested.

## Workflow
1. Read `README.md`, `package.json`, `wrangler.toml`, relevant `docs/`, and target source files.
2. Propose small, reversible changes. Avoid large refactors and new paid features until current behavior is understood.
3. Run `npm ci`, `npm run typecheck`, `npm run build`; if touching relevant logic run applicable tests. If a command cannot run, report it rather than claiming success.
4. Document changed files, test results, risks, and manual verification requirements in the draft PR.
5. Never automate production deployment in GitHub Actions until the owner explicitly opts in.

## Commercialization guardrails
- Monetization changes must preserve existing users' access and data.
- Do not add paywalls, telemetry, third-party trackers, payment providers, or send promotional messages without an explicit product decision.
- First validate user demand and licensing/security requirements using a separate plan.
