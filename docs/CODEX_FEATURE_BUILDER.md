# Codex feature builder — manual feature to Draft PR

## Goal
A repository-owner-authored GitHub Issue is the feature request. The owner manually starts the GitHub Actions workflow with its Issue number. Codex writes source files in a constrained runner. A second, separate read-only job applies only a restricted patch and runs typecheck, build and existing offline tests. A third job, with GitHub write access **but no OpenAI API key**, creates a new branch and **Draft PR only**.

**Never merge automatically.** Changes to `main` automatically deploy to the live Cloudflare site, as confirmed by the owner.

## Prerequisites (one-time)
1. Review automation PR #1 before explicitly approving merge to `main`. A merge, even of GitHub workflows, triggers a Cloudflare production pipeline.
2. Create an OpenAI **Platform API** key and add it in GitHub repository Settings → Secrets and variables → Actions → New repository secret with name `OPENAI_API_KEY`. Do not paste the key into issues or chat. API usage is billed separately from ChatGPT subscriptions.
3. In GitHub repository Settings → Actions → General → Workflow permissions, allow GitHub Actions to create pull requests. This is usually disabled for personal repositories by default. The workflow uses restricted per-job permissions.
4. First trial: create a harmless Issue authored by the repository owner, using the feature request template. Once the workflow is installed on default branch, open Actions → Codex feature builder → Run workflow, input the Issue number.
5. Review the produced Draft PR before any merge. Actual external integrations and production Cloudflare/Supabase were **not** tested in this workflow.

## Automation boundary
| Job | Privileges | Result |
|---|---|---|
| `build-feature` | Repo read, OpenAI key | Codex outputs restricted patch artifact |
| `validate-patch` | Repo read, **no OpenAI key** | Apply patch; TypeScript, Vite build, offline unit tests |
| `publish-draft-pr` | Repo write + PR write, **no OpenAI key** | New branch, Draft PR; no test commands or deployments |

Allowed patch paths: `src/`, `tests/`, `docs/`, `public/`. Other paths (workflows, migrations, Worker, package scripts, config, env/secrets) are excluded. Symlinks and patches over 250 KB are rejected at validation. This is a best-effort guardrail, not a substitute for code review: permitted source or tests could still be malicious or incorrect.

## Limitations
- It starts **manually**, not automatically from messages in ChatGPT or every GitHub Issue. Connecting chat-to-issue may be added later.
- An API key and GitHub workflow settings have not yet been configured or verified by this assistant.
- The GitHub `GITHUB_TOKEN` that creates the Draft PR normally does **not** trigger additional `pull_request` workflows. The separate validation job must pass first. For fully independent PR checks, configure a scoped GitHub App token in a future approved change.
- `main` branch protections, the live Cloudflare dashboard and rollback capabilities need owner review before considering automatic merges.
- Cloudflare branch preview builds may exist; preview routing/secrets are not verified.
- This workflow never applies SQL to real Supabase, deploys, approves, or merges. Auth, billing, migration, and runtime configuration changes need a different human-approved process.

## Troubleshooting
- **Missing OPENAI_API_KEY**: register GitHub Actions repository secret.
- **Cannot create pull request**: check Actions → General → Allow GitHub Actions to create and approve pull requests.
- **No permitted file changes**: Codex may have produced only a plan or requested a prohibited change; read its output.
- **Build/test failure**: no PR is created; check logs and retry after adjusting the Issue.
- **Permission denied on git push**: check repository Actions workflow token policy and branch rules; no bypass or automatic merge.
