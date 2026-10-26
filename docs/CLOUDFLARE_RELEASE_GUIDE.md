# Safe release procedure — Cloudflare Workers

Production URL: https://songbook-manager.sbook.workers.dev/
GitHub: https://github.com/Cho-L/songbook-manager

> This document is a checklist, **not** authorization to deploy. Do not merge or deploy automatically.

## Verified deployment policy (owner confirmed 2026-10-26)
- Cloudflare is connected to this repository and **automatically deploys when `main` changes**.
- **Merging a PR into `main` is a production release**, not merely a source control action.
- Do not merge even documentation-only PRs unless explicitly approved, as each merge triggers the production pipeline.
- GitHub Actions quality-check PR workflow never deploys; keep release approval distinct from green CI.

## 1. Branch lifecycle
1. Start from the latest `main` branch. Use a separate `feature/*` or `fix/*` branch.
2. Open a **draft PR** with description, affected routes, tests, risks and rollback instructions.
3. Run GitHub Actions quality check (TypeScript and Vite build). If changing core logic also run the applicable tests; green build alone is insufficient.
4. Review how Supabase Auth/RLS, Worker API endpoints, OBS and lyrics/YouTube flows may be affected.
5. Mark ready and merge only after the owner explicitly approves the exact release.
6. The owner confirms Cloudflare watches `main` and auto-deploys its changes. Still verify Cloudflare deployment history, preview behavior, and rollback capabilities before the first approved release.

## 2. Cloudflare deployment path — choose only after verifying project setup
### A. Cloudflare Git integration
- In the Cloudflare dashboard open Workers & Pages > songbook-manager > Settings > Builds/Deployments (naming may change).
- Inspect linked repository, production branch, build command and deploy settings.
- If the production branch is `main`, merging an approved PR *may trigger immediate deployment*; merging is therefore a production release action.
- Ensure preview builds, if configured, use separate non-production credentials and databases. Do not assume pull request branches are isolated automatically.

### B. Manual Wrangler deploy
- Confirm the correct Cloudflare account, project, credentials, bindings, worker name and desired commit.
- Perform a clean `npm ci` and `npm run build` using required build-time variables in a secure local/CI environment.
- After explicit approval only, an authorized operator may run `npx wrangler deploy` from the verified release commit.
- Do not put secret values in repository files, shell history, comments or logs.

## 3. Pre-release checks (human-required)
- [ ] Production deployment source and branch confirmed in Cloudflare dashboard
- [ ] Backup/export and recovery paths confirmed for important Supabase data
- [ ] No unexpected schema, RLS, auth, environment variable, or API route changes
- [ ] Current Worker/API behavior captured (request queue, overlay-config, YouTube search)
- [ ] Songbook import/export and mobile/desktop smoke tests documented
- [ ] Streaming/OBS and external integration behavior checked where affected
- [ ] Clear rollback target (known-good deployment / previous commit) identified
- [ ] Owner explicitly approves production release

## 4. Post-release smoke checks
- [ ] Web app loads on desktop and mobile
- [ ] Authentication works with an authorized test account
- [ ] Songbook browse/search and playlist operations work
- [ ] Request queue and public overlay routes behave as before
- [ ] No unauthorized changes to data or access controls
- [ ] Monitor Cloudflare Worker errors and Supabase logs for unexpected regressions

## 5. If a release causes failures
1. Halt further changes and inform the owner.
2. Prefer Cloudflare's available previous-deployment rollback controls if verified in the project.
3. Otherwise restore a verified known-good release via the **approved** deployment process.
4. If a database migration occurred, do not blindly reverse it: assess data compatibility first.
5. Repeat smoke checks and document the incident.

## Current safety status (2026-10-26)
- GitHub `wrangler.toml` identifies Worker `songbook-manager`, `workers/worker.js`, `dist` static assets.
- Historical Netlify configuration is present but is not used as evidence of production routing.
- GitHub Actions in draft PR #1 only installs dependencies, typechecks and builds; it does **not** deploy.
- GitHub Actions quality check passed for PR #1's original head commit.
- Owner confirms GitHub `main` auto-deploys to Cloudflare. Actual dashboard settings, preview routing, and rollback procedure have not yet been independently inspected.
