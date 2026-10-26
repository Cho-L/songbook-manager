# AI automation and monetization plan (non-production)

## Current facts checked on 2026-10-26
- Deployment target described by repository: Cloudflare Workers via `wrangler.toml` and `workers/worker.js`.
- Production URL supplied by owner: https://songbook-manager.sbook.workers.dev/
- Historic Netlify files remain in repo; they are not evidence of the live target.
- App stack: React, TypeScript, Vite, Supabase.
- Existing tests in `tests/`; historical release-readiness notes in `docs/phase37-release-readiness.md` say some real external integrations were not verified at that time.
- GitHub's source tree is not necessarily identical to the currently deployed Worker revision. **Do not assume a change on GitHub matches production until deployment lineage is verified.**

## Phase 0: protect current production (this PR)
- Establish agent constraints in root `AGENTS.md`.
- Add pull-request-only GitHub Actions typecheck/build with no Cloudflare token or deployment capability.
- Leave app source, schema, routing, secrets, and deployment settings untouched.
- PR must stay draft until a human checks the proposed changes.

## Phase 1: audit and verify (next PR, no deployment)
- Map features, routes, request flows, third-party APIs, data access, and tests.
- Identify actual Cloudflare deployment source/branch, production/preview environment separation, and whether the platform automatically creates preview builds.
- Run reproducible local tests, and label mocked checks accurately.
- Record existing behavior before making breaking changes.

## Phase 2: user demand validation (no code changes required)
- Interview small Twitch/CHZZK streamers about request queues, songbooks, lyric overlays, and pain points.
- Test a pricing hypothesis rather than assuming subscription revenue.
- Define free/paid packaging, onboarding, support effort, cancellation/refund rules, and license/data privacy obligations.
- Avoid mass unsolicited messages or unapproved integration/API use.

## Phase 3: isolated commercial MVP (explicit approval required)
- Build a feature flag or separate staging environment and rollback plan.
- Implement payments/account entitlements only after vendor choice and legal/security review.
- Keep free user functionality stable; test against non-production data.
- Require explicit manual approval for any release.

## Manual release checklist
- Owner confirms deployed Cloudflare project and connected GitHub branch.
- Owner reviews PR and exact changed files, backups/rollback, and QA evidence.
- Validate live site functionality separately; Cloudflare Worker, OBS, YouTube, Supabase/Auth/RLS may need real-environment checks.
- Owner explicitly authorizes production deployment. No AI agent should infer authorization from green CI.
