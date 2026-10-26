# Phase 2 — Source-level security and test inventory (2026-10-26)

## Scope and evidence
**Read-only analysis only.** Reviewed `workers/worker.js`, `wrangler.toml`, `src/server/songRequestHandler.ts`, `src/server/overlayConfigHandler.ts`, `src/services/supabaseClient.ts`, related SQL migrations, `package.json`, `tests/` and `docs/phase37-release-readiness.md`. GitHub code may not perfectly match the deployed Worker revision. This is not a penetration test or production security certification.

Owner confirmed: **any change merged into GitHub `main` triggers a Cloudflare production deployment**. Therefore even docs-only PR merges need a release decision; do not merge this draft automatically.

## System map
| Entry point | Route / component | Authorization / dependencies | What to verify |
|---|---|---|---|
| Cloudflare Worker | `workers/worker.js` | Cloudflare environment bindings | Deployed revision, secret bindings, route smoke tests |
| Song request GET | `/api/song-requests?book=UUID` | Public GET via Worker service-role RPC | Public fields and rate patterns, invalid UUID |
| Song request POST | `/api/song-requests` | Public POST; server validation; DB rate-limit/dedup RPC | Request limits, abuse handling, actual DB grants |
| Overlay settings GET | `/api/overlay-config?book=UUID&kind=...` | Public read of presentation-only settings | Only nonsecret fields, method rejection |
| YouTube lookup | `/api/youtube-search?q=...` | Server-side `YOUTUBE_API_KEY` | Key secrecy, quotas, response errors |
| Client session/data | `src/services/supabaseClient.ts` | Public anon key + Supabase RLS | Real RLS tests as each user role |
| Static SPA | Cloudflare assets `dist` | Vite build | Route fallback, cache behavior, mobile/OBS loading |

## Source-level findings and priorities
1. **P0 — release boundary (confirmed by owner):** `main` auto-deploys. Never merge a draft PR or let an agent push to `main` without explicit release approval. A successful CI run does not establish integration safety.
2. **P1 — live security validation still missing:** historical Phase 3.7 document reports actual Supabase Auth/RLS and Worker integration **not tested** at that point. SQL defines RLS/revokes and service-role RPC grants, but the *live database grants and deployed migrations* have not been independently verified. Confirm effective privileges in a non-production environment before payments, customer data expansion, or public launch.
3. **P1 — POST body handling review:** `handleSongRequests` awaits `request.text()` then checks encoded length against 2,048 bytes. This enforces a parsed-size limit **after** loading the body; consider rejecting oversized `Content-Length` where provided and a streaming body cap in a dedicated change. This is a hardening opportunity, **not evidence of an observed exploit**.
4. **P1 — abuse and quota review:** public YouTube search endpoint forwards client query via Worker-held API key. Inspect Cloudflare rate limits, caching, and quota usage. DB request RPC has cooldown and hourly limits by requester key; verify real abuse resistance and Cloudflare controls without using production load tests.
5. **P2 — origin behavior:** song-request POST rejects mismatched `Origin` when it is present; requests with absent `Origin` remain accepted (typical non-browser clients). Document this as public-API behavior rather than assuming Origin validates all clients.
6. **P2 — test automation gap:** `tests/` contains multiple Node test files and SQL/manual checks, but GitHub's initial safe CI PR only typechecks/builds. Introduce a reproducible, pinned offline-safe test runner **after** verifying executable commands and dependency requirements. Do not include real-API or DB-migration tests in default CI.
7. **P2 — drift/documentation:** Netlify files and dev references coexist with Cloudflare Worker configuration. Keep legacy paths until references and actual environment are mapped; don't delete them blindly. The README is Vite boilerplate and does not describe installation/operations.

## Controls observed in source (not live-verified)
- Service-role key is read from Worker environment, not frontend Supabase client.
- Song request RPC checks ownership of songs, duplicate queue entries, per-user active counts, cooldown and hourly rate limits in SQL.
- SQL migrations enable row-level security and revoke anonymous access to the relevant tables/RPC.
- Overlay public RPC is designed to return `config` and `rev`, not request identifiers or service credentials.

## Safe follow-up PRs (one independently reviewable goal each)
1. **CI-02:** determine existing unit test runtime; add a pinned test command to `package.json` and PR CI; preserve external/manual checks as opt-in. No Worker/database changes.
2. **SEC-01:** add focused tests for public API invalid input, method restrictions, response redaction and oversize requests using mocks only; fix flaws only if reproduced. No production keys.
3. **SEC-02:** use a disposable/staging Supabase project to exercise anonymous/authenticated/service-role grants, RLS, RPC isolation and rollback; never run migrations directly against production by automation.
4. **OPS-01:** document Cloudflare build branch, preview environments, secrets ownership, deployment version mapping and rollback rehearsal; no automatic production deployment.
5. **BIZ-01:** interview and onboard test users before implementing paywalls; retain current free user access during testing.

## Production safety
This PR changes **documentation only**. No live requests, credentials, migrations, account settings or deploys performed. Review and merge only as part of an explicitly approved Cloudflare production release because `main` automatically triggers a deploy.

## Follow-up verification — 2026-10-26 (after PR #1 and #3)
- PR #1 was merged into `main` and added GitHub PR workflows for ESLint, typecheck, Vite build, offline unit tests, and isolated PGlite SQL regressions. **The original CI gap in finding #6 is now partially resolved.** These checks are not live Supabase/RLS or production API checks.
- PR #3 was merged into `main` and renamed the non-hook `useServer` helper in `src/services/broadcastRepository.ts` to `getAvailableServerDb`. The owner reported normal operation after deployment.
- Current `main` source still calls `await request.text()` before testing `MAX_BODY_BYTES = 2048` in `src/server/songRequestHandler.ts`. Prioritize a mocked regression test and bounded body reading. Do not claim an exploitable production vulnerability solely from source review.
- Current `main` `workers/worker.js` still allows public calls to `/api/youtube-search` that use `YOUTUBE_API_KEY`. Rate limits, quota usage and cache behavior have not been verified on Cloudflare. Avoid live load tests.
- Effective Supabase staging/production grants, Auth isolation and RLS remain unverified in the deployed environment.

### Immediate next work (separate PRs, no production changes without approval)
1. **SEC-01 — safest first code change:** add offline tests for oversize and malformed song-request POST, invalid UUIDs, missing/mismatched Origin policy, and disallowed methods. If tests expose a concrete issue, implement a bounded request-body reader in a separate small change or in the same clearly reviewed PR; cap the read before allocating the full body. Tests must not contact live Supabase or Cloudflare.
2. **SEC-02 — quota assessment:** document the YouTube Data API endpoint's quota cost, traffic amplification, potential rate limiting and caching options. Do not enable paid services or alter production API behavior automatically.
3. **SEC-03 — staging DB validation:** only with separate explicitly approved disposable Supabase project credentials, test effective grants, RLS and RPC isolation. Never execute migrations against production from AI/CI.

### Operational limit
This is a documentation-only draft PR. It can be reviewed or left pending while SEC-01 work proceeds separately. Merging it into `main` is still an automatic Cloudflare production release and requires a new explicit release approval.
