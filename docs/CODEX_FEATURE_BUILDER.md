# Codex feature builder — operator guide

## Current state
This is an **opt-in, manual first milestone** for feature coding. It does not autonomously receive ChatGPT requests, push to GitHub, open a PR, merge, or deploy. The Codex result is an isolated **downloadable patch artifact** for review. The eventual draft-PR creation stage is intentionally held back until its safety checks are tested.

## Preconditions
1. Merge the automation setup PR into `main` only after explicit release approval. **The owner reports that any merge to `main` triggers Cloudflare production deployment**, even if the change contains only CI config.
2. In GitHub repository **Settings → Secrets and variables → Actions**, store a newly created OpenAI Platform API key under `OPENAI_API_KEY`. Do not paste it into issues, logs, chat or code. ChatGPT Plus membership is not the API credit balance; API usage is billed separately.
3. In GitHub Actions, find **Codex feature builder (manual, draft PR only)** → **Run workflow**, enter an existing owner-authored, open Issue number. No pull requests or other users' Issues are accepted.
4. Review GitHub Actions results. The feature patch is saved as an artifact; do not apply it blindly.

## Security and limitations
- Manual trigger only; only GitHub repository owner's username may start it.
- Source-only patch; automation explicitly discards changes to deployment, credentials, GitHub workflows, and database migration files.
- Uses `openai/codex-action@v1` with a workspace permission profile. The OpenAI API key is passed to that action, never to repository tests.
- The artifact is **not** an approved release. Changes need additional checks and a PR before they can be merged. No automatic deploy.
- GitHub Actions only runs workflows installed in the repository's default branch; this file has not been activated while it remains in a draft PR.
- The API key and actual Codex execution are **not yet verified**. A real dry run against a harmless, owner-authored issue is required.
- Treat Issue text as untrusted instructions; the issue-author check is not a substitute for sandboxing and PR review.

## Next milestone
A separate, reviewed workflow may take a validated source patch, create a draft PR and run required checks. Protect main with branch rules before considering auto-merge, and ensure Cloudflare previews are separate from production.
