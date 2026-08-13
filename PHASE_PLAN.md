# CodePulse — Phase-Wise Plan of Action

> Read `ARCHITECTURE.md` in full before starting any phase. Each phase
> below is scoped to roughly one coding session. Do not start a phase
> until the previous phase's "Exit Criteria" are met. Each phase lists:
> goal, prerequisites, APIs/modules to build, key functions with edge
> cases, and definition of done.
>
> Phases are grouped into stages. Stages A–C produce a working
> single-tenant-feeling MVP (one project, generated + deployed).
> Stages D onward add real multi-tenancy, observability, AI, and
> reliability hardening.

---

## STAGE A — Foundation

### Phase 1 — Repo scaffolding & health skeleton
**Goal:** Get a running backend + frontend skeleton with the directory
structure and a working `/health` endpoint, matching ARCHITECTURE.md §5.

**Build:**
- Directory structure: `backend/app/{api,services,models,schemas,generators,provisioning,rag,llm,github}`, `frontend/src`, `.github/workflows/`
- `backend/app/main.py` — FastAPI app, `GET /health` → `{"status": "healthy"}`
- `frontend` — React app shell, single page hitting `/health` on load
- `docker-compose.yml` for local dev (backend + frontend + Postgres)
- `.env.example`, `.gitignore` (never commit `.env`)
- PostgreSQL connection setup (SQLAlchemy or similar), migrations tool (Alembic) initialized

**Edge cases:**
- Backend must start even if Postgres isn't reachable yet — health check should distinguish "app up" vs "app up + DB connected" (`GET /health` returns DB status separately, e.g. `{"status":"healthy","db":"connected"}`).

**Exit criteria:** `docker compose up` locally boots backend + frontend + DB; `/health` returns 200; frontend renders the health status.

---

### Phase 2 — Tenant/User & Auth model
**Goal:** Real accounts, so onboarding has an owner.

**Build:**
- `Tenant`, `User` tables/models (per ARCHITECTURE.md §6)
- Auth: email/password or a simple provider (decide once, document in ARCHITECTURE.md if changed) + session/JWT handling
- `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`

**Key functions & edge cases:**
- `create_tenant(user)` — every new user gets exactly one default tenant on signup; must be idempotent (no duplicate tenant if signup retried).
- Password hashing (never plaintext); rate-limit login attempts.
- JWT expiry + refresh handling; reject expired tokens with 401, not 500.

**Exit criteria:** Can sign up, log in, and hit an authenticated `/auth/me` that returns the tenant id.

---

## STAGE B — Onboarding & GitHub Integration

### Phase 3 — GitHub App integration
**Goal:** Connect a user's GitHub account/repo so CodePulse can read code and later commit files.

**Build:**
- GitHub App registration (manual step — see setup guide) + OAuth callback flow
- `POST /auth/github/callback` — exchanges code for installation token, stores installation id against the tenant
- `GET /projects/available-repos` — lists repos accessible to the installation
- `POST /projects` — creates a `Project` row from a selected repo (`github_repo_url`, default branch, empty `stack_type` for now)

**Key functions & edge cases:**
- `get_installation_token(installation_id)` — must refresh/cache correctly; GitHub App tokens expire (~1hr) — do not hardcode a long-lived token anywhere.
- Handle: user revokes the GitHub App mid-session → next API call must fail gracefully with a clear "reconnect GitHub" error, not a raw 500.
- Handle: repo is private vs public — installation token must have correct scope either way.

**Exit criteria:** A logged-in user can connect GitHub and see a real list of their repos in the UI; selecting one creates a `Project`.

---

### Phase 4 — Onboarding config (`codepulse.yaml` + form)
**Goal:** Capture the structured input needed to generate files later — env vars, cloud target, app shape.

**Build:**
- Schema/parser for `codepulse.yaml` (optional file in user's repo) — backend/frontend paths, start/build commands, port, health-check path
- Fallback: if no `codepulse.yaml`, collect the same fields via a frontend form
- `POST /projects/{id}/env-vars` — accepts key/value pairs
- `POST /projects/{id}/cloud-target` — provider, region, instance_type, (placeholder for IAM role for now)

**Key functions & edge cases:**
- `parse_codepulse_yaml(raw_text)` — must validate required fields and return clear per-field errors (not a generic parse failure) if the file is malformed.
- Env var keys: reject reserved/dangerous names (e.g. overriding `PATH`), validate no accidental secret-looking values are logged anywhere (add a redaction util used everywhere env vars touch logs).
- Cloud target: validate instance_type against an allow-list (don't let a user request something absurdly expensive by typo — confirm explicitly if above a cost threshold).

**Exit criteria:** A `Project` can be fully configured (repo + env vars + cloud target) via API/UI and persisted.

---

## STAGE C — Generation Engine

### Phase 5 — Stack detector
**Goal:** Given a repo, classify its stack automatically.

**Build:**
- `backend/app/generators/stack_detector.py`
- Detection rules: presence/content of `package.json` (Node — check `dependencies` for `express`, `react`, `next`, etc.), `requirements.txt`/`pyproject.toml` (Python — Flask/Django/FastAPI), monorepo heuristics (separate `backend/`/`frontend/` folders vs single root)

**Key functions & edge cases:**
- `detect_stack(repo_files) -> StackProfile` — must handle: monorepo vs. single-app repo, missing lockfile, multiple candidate frameworks in one `package.json` (e.g. both `express` and `next` present — needs a priority/tiebreak rule), and the "unsupported stack" case (must return a clear "not auto-detectable, please fill in `codepulse.yaml` manually" result rather than guessing silently).
- Unit tests: seed several fixture repos (plain MERN, Python/Flask, monorepo, empty repo) and assert correct classification for each — this function is high-leverage, test it well before moving on.

**Exit criteria:** Given the fixture repos, detector correctly classifies stack type and file layout; unsupported cases fail loudly and clearly, not silently.

---

### Phase 6 — File generator (templates)
**Goal:** Produce Dockerfiles, Compose file, CI workflow, from templates + detected stack + onboarding config.

**Build:**
- `backend/app/generators/templates/` — Jinja2 (or similar) templates: `Dockerfile.node.j2`, `Dockerfile.python.j2`, `docker-compose.yml.j2`, `ci.yml.j2`, `deploy.yml.j2`
- `generate_files(project) -> dict[path, content]`

**Key functions & edge cases:**
- Template must correctly parameterize: build command, start command, port, health-check path, node/python version.
- Edge case: user's app doesn't expose a health-check path at all → generator must inject a minimal one (e.g. wrap start command, or note in output that the user should add `/health`) rather than generating a CI/CD pipeline that will always fail its health gate.
- Idempotent regeneration: re-running generation on an already-generated project must produce a diff-able result, not silently duplicate files.

**Exit criteria:** For each fixture repo from Phase 5, generated files build and run locally via `docker compose up` without manual edits.

---

### Phase 7 — Metrics middleware injection
**Goal:** Ensure every deployed app exposes `/metrics`, even if it didn't originally.

**Build:**
- Stack-specific injector: for Node/Express, add `prom-client` + a small metrics route/middleware snippet; equivalent for Python frameworks.
- Injection strategy: prefer a small, clearly-marked generated file (`codepulse-metrics.js`) that's imported, over rewriting the user's existing entrypoint in place.

**Key functions & edge cases:**
- `inject_metrics(stack_profile, target_files) -> patch_set` — must detect if `/metrics` already exists (user already instrumented) and skip injection rather than creating a route conflict.
- Must not break the user's existing routes/middleware order (e.g. body-parsers, auth middleware ordering matters in Express).

**Exit criteria:** Deployed fixture apps expose `GET /metrics` in Prometheus text format without manual code changes, and injection is a no-op if metrics already exist.

---

### Phase 8 — Commit-back flow (bot commit / PR)
**Goal:** Get generated files into the user's actual repo, safely.

**Build:**
- `POST /projects/{id}/generate` — runs Phases 5–7, returns a preview (list of files + diffs) without committing yet
- `POST /projects/{id}/generate/confirm` — commits via GitHub API as a bot commit on a new branch, opens a PR (default) or commits to main (opt-in, explicit)

**Key functions & edge cases:**
- Must show a real diff/preview before committing (Principle 5 in ARCHITECTURE.md) — never silently push to `main`.
- Handle merge conflicts if the user already has a file at a generated path — must not silently overwrite; flag for manual resolution.
- Handle repo permissions failure (installation lacks write access) with a clear actionable error.

**Exit criteria:** User can preview generated files, approve, and see a real PR (or commit) appear on their GitHub repo.

---

## STAGE D — Secrets & Infra Provisioning

### Phase 9 — Secrets vault integration
**Goal:** Store env vars and cloud credentials securely, referenced (not embedded) by generated workflows.

**Build:**
- Vault client wrapper (AWS Secrets Manager to start) — `store_secret(tenant_id, key, value)`, `get_secret_ref(tenant_id, key)`
- Update `EnvVar` model to store only a vault reference
- Generated GitHub Actions workflows reference secrets by name (GitHub Actions secrets synced from the vault, or vault accessed at runtime — decide and document which)

**Key functions & edge cases:**
- Redaction: build one shared `redact()` util and audit every log line touching env vars/credentials to use it — do this before any other phase writes more logging code.
- Rotation: changing an env var value must not require regenerating the whole project, just updating the vault entry.
- Deletion: deprovisioning a project must also delete its vault entries (no orphaned secrets).

**Exit criteria:** No secret value appears in the Postgres DB, in application logs, or in generated files — only references do.

---

### Phase 10 — Cross-account AWS access
**Goal:** CodePulse can act in the user's AWS account without holding a permanent static key.

**Build:**
- Onboarding step: user creates an IAM role in their account with a trust policy allowing CodePulse's AWS account to assume it (document exact trust policy + minimal permission policy in the setup guide)
- `assume_tenant_role(project) -> temp_credentials` — calls `sts:AssumeRole`, short-lived session

**Key functions & edge cases:**
- Cache temp credentials for their validity window only; never persist them past expiry.
- Handle: role doesn't exist yet / trust policy misconfigured → clear, specific error surfaced to the user (not a generic AWS SDK stack trace).
- Fallback path (documented, discouraged): static access keys stored in the vault for users who can't set up role assumption yet.

**Exit criteria:** Backend can successfully assume a test IAM role and list EC2 instances in a sandbox AWS account using only temporary credentials.

---

### Phase 11 — Terraform module + provisioner job
**Goal:** Programmatically provision an EC2 instance + security group per tenant.

**Build:**
- `infra/modules/app_instance/` — reusable Terraform module (instance, security group, key pair association)
- Remote state backend: S3 bucket + DynamoDB lock table, state key `tenants/<project_id>/terraform.tfstate`
- `backend/app/provisioning/terraform_runner.py` — writes `.tfvars`, shells out `terraform init/plan/apply`, captures output
- `POST /projects/{id}/provision` — enqueues an `InfraJob`, `GET /projects/{id}/jobs/{job_id}` — polls status/logs

**Key functions & edge cases:**
- `run_terraform_plan(project) -> plan_summary` — must be callable separately from apply, so the UI can show a preview (Principle 5).
- Concurrency: two provisioning requests for the same project must not race — acquire a lock (DynamoDB lock table handles the Terraform-level race; also guard at the job-queue level so you don't even attempt two applies at once).
- Partial failure: `apply` succeeds but the job process crashes before recording success — on restart, job runner must detect drift (`terraform plan` shows no changes needed) rather than blindly re-applying or losing track of the resource.
- Teardown path: `POST /projects/{id}/deprovision` must exist from day one, not bolted on later — destroying tenant infra cleanly is as important as creating it.

**Exit criteria:** A real EC2 instance + security group is created in a sandbox AWS account from an API call, state is isolated per tenant, and a repeat `provision` call is a safe no-op if nothing changed.

---

### Phase 12 — Ansible configuration
**Goal:** Configure the freshly provisioned EC2 instance.

**Build:**
- `ansible/roles/{docker,deploy_user,node_exporter}/`
- `backend/app/provisioning/ansible_runner.py` — generates dynamic inventory from Terraform output, waits for SSH reachability, runs the playbook

**Key functions & edge cases:**
- `wait_for_ssh(host, timeout)` — must poll with backoff, not a single blind attempt (freshly booted instances take time).
- Idempotency: re-running the playbook against an already-configured host must not restart running app containers unnecessarily.
- Failure mid-playbook: job status must reflect exactly which role failed, so retries can be targeted, not "redo everything."

**Exit criteria:** After `provision`, the EC2 instance has Docker/Compose installed, a non-root deploy user, and `node_exporter` running and reachable — verified by an automated check, not manual SSH.

---

## STAGE E — CI/CD Execution

### Phase 13 — CI trigger & GHCR push
**Goal:** Generated `ci.yml` actually builds and pushes tenant-namespaced images.

**Build:**
- Finalize `ci.yml` template: lint → test → docker build → push to `ghcr.io/codepulse/tenant-<id>/<app>:<sha>`
- Webhook handling: `POST /webhooks/github` receives push events, updates `Deployment` records

**Key functions & edge cases:**
- Tag strategy: use commit SHA (immutable) as the primary tag, not just `latest`, so rollback (Phase 15) has something concrete to target.
- Handle: lint/test failure — workflow must stop before attempting a build/push, and the failure must be retrievable later by the AI explainer (Phase 18).
- GHCR auth: use the GitHub Actions built-in `GITHUB_TOKEN` (scoped, ephemeral) — do not generate a long-lived PAT for this.

**Exit criteria:** A push to a connected repo results in a new tagged image visible in GHCR, and a `Deployment` row recording pass/fail per CI stage.

---

### Phase 14 — CD trigger & deploy execution
**Goal:** Generated `deploy.yml` actually ships the new image to the tenant's EC2 instance.

**Build:**
- Finalize `deploy.yml` template: SSH to EC2 → `docker compose pull && up -d` → poll `GET /health`

**Key functions & edge cases:**
- Health poll: must have a bounded timeout and clear failure state — don't poll forever.
- SSH key handling: deploy key stored in the vault, injected into the Action run only as a masked secret, never printed.
- Concurrent deploys to the same project: queue them, don't let two deploys race on the same Compose stack.

**Exit criteria:** A push triggers a real container update on the EC2 instance, verified by the new commit SHA showing up in the running container's image tag.

---

### Phase 15 — Automatic rollback
**Goal:** Failed health check after deploy reverts to the previous known-good image — deterministically, no AI involved.

**Build:**
- `rollback_to_previous_image(project)` — pure deployment logic
- `POST /projects/{id}/deployments/{id}/rollback` — manual trigger, same underlying function as the automatic path

**Key functions & edge cases:**
- "Previous known-good" must be tracked explicitly (last deployment with a passing health check), not just "previous tag" — two bad deploys in a row shouldn't roll back to another bad one.
- Rollback itself must also be health-checked — if rollback fails too, stop and surface a clear alert rather than looping.

**Exit criteria:** Deliberately deploying a broken image triggers an automatic, verified rollback to the last-good image, end to end, with no manual intervention.

---

## STAGE F — Observability

### Phase 16 — Multi-tenant Prometheus + Grafana
**Goal:** Metrics flow from each tenant's app into a shared, tenant-labeled observability stack.

**Build:**
- Prometheus scrape config generator — appends a tenant-labeled job per project (`project_id` label on every metric)
- Grafana provisioning API calls — per-tenant folder + dashboard from a template (reuses panels: CPU, memory, latency, error rate, request rate)

**Key functions & edge cases:**
- Scrape target must resolve the tenant's current EC2 IP — handle IP changes after reprovisioning (update scrape config, don't leave stale targets).
- Dashboard provisioning must be idempotent — re-running onboarding shouldn't create duplicate dashboards per project.

**Exit criteria:** Each project's Grafana dashboard shows live metrics scoped to only that project — verified with two test projects side by side.

---

### Phase 17 — Alertmanager routing
**Goal:** Threshold alerts route to the correct tenant's own notification channel.

**Build:**
- Alert rule generator (CPU/memory/latency/error-rate thresholds, tenant-labeled)
- Per-tenant routing config → user's Slack/Discord webhook (stored via the vault, Phase 9)

**Key functions & edge cases:**
- Routing must match on `project_id` label — verify no cross-tenant alert delivery with a two-tenant test.
- Webhook failures (bad/revoked URL) must be visibly surfaced in the CodePulse dashboard, not silently dropped.

**Exit criteria:** Triggering a real threshold breach on a test project sends a notification only to that project's configured webhook.

---

## STAGE G — AI Layer

### Phase 18 — Tenant-scoped RAG knowledge base
**Goal:** Seed and query a knowledge base scoped strictly per project.

**Build:**
- Ingestion pipeline: chunk + embed the project's generated configs, deployment metadata, and (optionally) user-supplied docs
- Vector DB writes/queries always filtered by `project_id`

**Key functions & edge cases:**
- `query_knowledge(project_id, question)` — must hard-filter by `project_id` at the query level, not just at ingestion — a missing filter here is a cross-tenant data leak, treat it as a security bug class.
- Re-ingestion after regeneration (Phase 6 reruns) must update, not duplicate, chunks.

**Exit criteria:** Querying project A's knowledge base never returns project B's content, verified with an explicit adversarial test.

---

### Phase 19 — Live data fetch + LLM explainer endpoints
**Goal:** Implement the advisory-only AI endpoints from ARCHITECTURE.md §9.

**Build:**
- `fetch_recent_ci_logs(project_id)`, `fetch_recent_metrics(project_id, window)`, `fetch_recent_incidents(project_id)` — live fetch, not pre-embedded (per ARCHITECTURE.md §7/§21 principle)
- `POST /ai/explain-ci-failure`, `POST /ai/explain-incident`, `POST /ai/health-summary`, `POST /ai/ask`
- Prompt template producing structured output: Likely Cause / Evidence / Recommended Action

**Key functions & edge cases:**
- Every "Evidence" item returned must carry a reference (link/id) back to the real source (specific CI run, Grafana panel, log line) — no unattributed claims.
- The LLM call path must have zero ability to call any mutating endpoint (rollback, deploy, provision) — enforce this at the tool/function-calling layer if using function calling at all: don't expose those functions to the model.
- Handle LLM API failure/timeout gracefully — the dashboard's core function (deploy/monitor) must not depend on the LLM being up.

**Exit criteria:** Asking "why did this fail?" on a real failed deployment returns a structured, correctly-attributed answer, and confirmed that no AI code path can trigger a rollback or deploy.

---

## STAGE H — Frontend / Dashboard

### Phase 20 — Project list + onboarding UI
**Goal:** Turn the API surface from Stages B–D into a usable onboarding flow.

**Build:** Repo connect screen, config form, env var form, cloud target form, generate-preview/approve screen, provisioning progress view (real-time via polling or WebSocket).

**Exit criteria:** A new user can go from signup to a provisioned, generated project entirely through the UI, no API calls by hand.

---

### Phase 21 — Live dashboard (CI/CD, monitoring, AI chat)
**Goal:** Implement the per-project dashboard described in the original single-tenant spec, now project-scoped.

**Build:** Dashboard panel (status, current deployment), CI/CD panel (recent runs), monitoring panel (embedded Grafana panels or charts from `/metrics/overview`), AI Assistant panel (chat + quick-ask shortcuts + rollback button wired to the deterministic rollback endpoint, not the LLM).

**Exit criteria:** All four panels show real, live, project-scoped data for a deployed test project.

---

## STAGE I — Reliability & Hardening (do after the above is genuinely working)

### Phase 22 — Job orchestration hardening
Retry policy for provisioning/generation jobs, dead-letter handling for permanently failed jobs, visible job history per project.

### Phase 23 — Concurrency & rate limiting
Prevent concurrent conflicting operations per project (e.g. deploy while reprovisioning); global rate limits so one tenant can't starve infra job workers for others.

### Phase 24 — Cost visibility
Show estimated AWS cost from the Terraform plan before provisioning; simple ongoing cost display per project.

### Phase 25 — Backups & recovery
Backup strategy for the tenant/state Postgres DB, the vector DB, and Terraform state; documented recovery runbook.

---

## How to Use This With an Agentic IDE

- Start every new coding session by pointing the agent at both
  `ARCHITECTURE.md` and this file, and state which Phase you're doing.
- Do not let the agent skip ahead to a later phase's concerns
  mid-phase — if it notices something belonging to a later phase,
  it should note it (e.g. as a `TODO(phase-N)` comment) and continue.
- At the end of each phase, verify the stated **Exit Criteria**
  explicitly before starting the next phase — treat it as a hard gate.
