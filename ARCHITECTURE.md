# CodePulse — Architecture (Source of Truth)

> This file is the single source of truth for the overall system design.
> Any coding agent (Claude, GPT, Codex, Antigravity, etc.) working on this
> project should read this file first, in full, before writing any code.
> The companion file `PHASE_PLAN.md` breaks this architecture into ordered,
> session-sized implementation phases — read both together.

---

## 1. One-Line Description

CodePulse is a multi-tenant platform that takes a user's existing GitHub
repository (any stack — MERN, Python, etc.), and automatically generates,
provisions, deploys, monitors, and explains that application's full
DevOps pipeline — CI/CD, infrastructure, observability, and AI-assisted
incident diagnosis — without the user writing any Dockerfiles, CI YAML,
Terraform, or monitoring config themselves.

## 2. Problem Statement

Most small teams and solo developers who want proper DevOps (CI/CD,
containerization, cloud deployment, metrics, alerting, incident
diagnosis) have to hand-build every layer of that stack themselves —
Docker, GitHub Actions, Terraform, Ansible, Prometheus, Grafana,
Alertmanager — before they can even deploy their first real feature.
CodePulse removes that setup cost: a user brings a repo + env vars +
cloud credentials, and CodePulse builds and operates the pipeline for
them, on their own infrastructure.

## 3. Non-Negotiable Design Principles

These principles override any convenience shortcut later. Every phase
must respect them.

1. **AI recommends, deterministic automation acts.**
   The LLM/RAG layer may explain failures and *suggest* actions
   (e.g. "consider rolling back to commit abc123"). It must **never**
   directly trigger infrastructure changes, deployments, or rollbacks.
   Those are plain, deterministic API calls with no LLM in the call
   path. This is the single most important architectural boundary in
   the whole system.
2. **Tenant isolation is a security requirement, not a nice-to-have.**
   Every credential, secret, Terraform state file, vector DB namespace,
   Prometheus scrape target, and generated file must be scoped to a
   single tenant. No cross-tenant data leakage, ever — including in AI
   answers.
3. **No plaintext, no shared static keys.**
   User AWS credentials and app secrets are never logged, never
   embedded in generated files, and never stored outside a vault.
   Prefer short-lived, scoped credentials (assumed IAM roles) over
   long-lived access keys.
4. **Generated changes to a user's repo are visible and reversible.**
   CodePulse commits Dockerfiles/workflows/configs into the user's repo
   as plain files (or a PR the user approves) — never as hidden,
   opaque automation. The user can always read, edit, or delete what
   was generated.
5. **High-trust actions require an explicit preview/approval step.**
   Before provisioning real cloud infrastructure or pushing to a user's
   default branch, the user sees what will happen (Terraform plan,
   estimated cost, list of files to be committed) and confirms it.
6. **Idempotency everywhere.**
   Re-running provisioning, config generation, or deployment against
   the same tenant must not create duplicate resources or break an
   already-running instance.

## 4. System Actors

- **User (tenant owner)** — connects a repo, provides env vars and AWS
  target info, triggers/monitors deployments, talks to the AI assistant.
- **CodePulse platform** — the system itself: backend, frontend,
  provisioner, generators, observability stack, AI layer.
- **GitHub** — source of truth for the user's code; also hosts the
  generated CI/CD workflows that actually build and deploy the app.
- **User's AWS account** — where the actual application infrastructure
  (EC2 instance, security groups) lives. CodePulse never runs the app
  on its own infrastructure — it operates *the user's* cloud account.

## 5. High-Level Architecture

```
                         ┌─────────────────────────┐
                         │   CodePulse Frontend     │
                         │  (React) — dashboard,    │
                         │  onboarding, AI chat      │
                         └────────────┬─────────────┘
                                      │ REST/WS
                         ┌────────────▼─────────────┐
                         │   CodePulse Backend        │
                         │   (FastAPI)                │
                         │                             │
                         │  ┌───────────────────────┐ │
                         │  │ Tenant/Auth service    │ │
                         │  ├───────────────────────┤ │
                         │  │ GitHub integration     │ │
                         │  │ (OAuth/App, webhooks)  │ │
                         │  ├───────────────────────┤ │
                         │  │ Stack detector          │ │
                         │  ├───────────────────────┤ │
                         │  │ File generator          │ │
                         │  │ (Dockerfile/CI/monitor) │ │
                         │  ├───────────────────────┤ │
                         │  │ Secrets vault client    │ │
                         │  ├───────────────────────┤ │
                         │  │ Provisioner              │ │
                         │  │ (Terraform + Ansible     │ │
                         │  │  job runner)             │ │
                         │  ├───────────────────────┤ │
                         │  │ Deployment orchestrator │ │
                         │  │ (job/state machine)     │ │
                         │  ├───────────────────────┤ │
                         │  │ RAG + LLM service        │ │
                         │  │ (tenant-scoped)          │ │
                         │  └───────────────────────┘ │
                         └──┬────────┬────────┬────────┘
                            │        │        │
              ┌─────────────▼┐  ┌────▼─────┐ ┌▼──────────────┐
              │ Secrets Vault │  │ Vector DB │ │ Tenant/State   │
              │ (e.g. AWS     │  │ (per-     │ │ store          │
              │ Secrets Mgr)  │  │ tenant    │ │ (Postgres)     │
              └───────────────┘  │ namespace)│ └────────────────┘
                                  └───────────┘

     ── on the user's own AWS account (per tenant) ──
     ┌─────────────────────────────────────────────────┐
     │  EC2 instance                                     │
     │   ├── App containers (backend + frontend, via     │
     │   │    Docker Compose, pulled from GHCR)           │
     │   ├── node_exporter (infra metrics)                │
     │   └── app /metrics endpoint (app-level metrics)    │
     └───────────────┬─────────────────────────────────┘
                      │ scraped by
     ┌────────────────▼─────────────────────────────────┐
     │  Shared Observability Stack (CodePulse-operated)   │
     │   Prometheus (tenant-labeled) → Grafana (per-tenant│
     │   dashboards) → Alertmanager (per-tenant routing)  │
     └─────────────────────────────────────────────────┘

     ── GitHub side (user's repo) ──
     .github/workflows/ci.yml, deploy.yml   (generated, committed)
     GHCR: ghcr.io/codepulse/tenant-<id>/<app>:<tag>
```

## 6. Core Data Entities

| Entity | Key fields | Notes |
|---|---|---|
| `Tenant` | id, owner_user_id, created_at | Top-level isolation boundary |
| `Project` | id, tenant_id, github_repo_url, stack_type, config (parsed `codepulse.yaml`) | One per connected repo |
| `EnvVar` | id, project_id, key, vault_reference | Value never stored in DB — only a pointer into the vault |
| `CloudTarget` | id, project_id, provider ("aws"), region, instance_type, iam_role_arn | Provisioning target config |
| `Deployment` | id, project_id, commit_sha, image_tag, status, started_at, finished_at | One per CI/CD run |
| `InfraJob` | id, project_id, type ("provision"/"reprovision"/"deprovision"), status, terraform_state_key, logs | Tracks Terraform/Ansible job lifecycle |
| `MetricSnapshot` (ephemeral, not stored long-term) | pulled live from Prometheus at query time | Never bulk-embedded into RAG |
| `Incident` | id, project_id, detected_at, alert_rule, resolved_at | Created from Alertmanager events |
| `KnowledgeChunk` | id, project_id (tenant scope), embedding, source_type | RAG vector store entries, always project-scoped |

## 7. End-to-End Pipeline (Deploy Flow)

```
1. User clicks "Deploy"
2. Backend creates/loads tenant + project workspace
   → reads repo via GitHub App installation token
3. Stack detection
   → scans package.json / requirements.txt / etc.
   → classifies backend/frontend framework, package manager, ports
4. File generation (templated, not hand-written per tenant)
   → Dockerfiles, docker-compose.yml
   → .github/workflows/ci.yml, deploy.yml
   → monitoring/prometheus.yml, alerts.yml (tenant-labeled)
   → metrics middleware injected into app config if missing
   → committed via bot commit or opened as a PR (user-configurable)
5. Secrets stored in vault; workflows reference them by name, never
   by value
6. Infra provisioning (Terraform + Ansible), isolated per tenant:
   → EC2 instance, security group, key pair
   → Ansible: Docker/Compose install, deploy user, node_exporter
   → remote Terraform state, keyed per tenant, with locking
7. CI triggers (push or manual trigger)
   → lint → test → docker build → push to GHCR (tenant namespace)
8. CD triggers
   → SSH to EC2 → docker compose pull && up -d
   → GET /health polled → pass/fail gate
   → automatic rollback to previous image on failure (deterministic)
9. Observability comes online
   → Prometheus scrapes app + node_exporter metrics
   → Grafana dashboard auto-provisioned per project
   → Alertmanager rules activated, routed to user's webhook
10. AI layer (if enabled)
   → RAG knowledge base seeded with this project's generated
     configs + deployment metadata (tenant-scoped)
   → ready to answer questions using retrieved knowledge + live
     data fetched at query time
```

## 8. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | Python, FastAPI | Async, good fit for orchestration + LLM calls |
| Frontend | React | Dashboard, onboarding, AI chat UI |
| Containerization | Docker, Docker Compose | Per-tenant app runtime |
| CI | GitHub Actions (generated per repo) | Lint, test, build, push |
| Registry | GHCR, namespaced per tenant | `ghcr.io/codepulse/tenant-<id>/<app>` |
| IaC | Terraform, tenant-parameterized module | Remote state: S3 + DynamoDB lock table |
| Config management | Ansible | Idempotent playbooks/roles |
| Metrics | Prometheus (shared, tenant-labeled) + node_exporter + app-level exporter (e.g. prom-client) | |
| Dashboards | Grafana | Per-tenant folder/dashboard provisioning |
| Alerting | Alertmanager | Per-tenant routing to Slack/Discord webhook |
| Secrets | AWS Secrets Manager (or Vault) | No plaintext secrets outside the vault |
| Vector DB | e.g. pgvector / Chroma / Pinecone | Namespaced per tenant/project |
| LLM | External LLM API | Advisory only — see Principle 1 |
| Tenant/metadata DB | PostgreSQL | Tenants, projects, deployments, jobs |
| Job orchestration | Queue + worker (e.g. Celery/RQ, or a lightweight custom job runner) | Runs provisioning/generation jobs async, tracks status |

## 9. API Surface (high level — detailed per-phase in PHASE_PLAN.md)

```
Auth / Tenant
  POST /auth/github/callback
  GET  /projects

Onboarding
  POST /projects                      (connect a repo, initial config)
  POST /projects/{id}/env-vars
  POST /projects/{id}/cloud-target
  POST /projects/{id}/generate        (stack detect + file generation)
  POST /projects/{id}/provision       (kick off Terraform+Ansible job)
  GET  /projects/{id}/jobs/{job_id}   (poll job status/logs)

Deploy
  POST /projects/{id}/deploy          (manual trigger)
  GET  /projects/{id}/deployments
  POST /projects/{id}/deployments/{id}/rollback   (deterministic, no LLM)

Observability
  GET  /projects/{id}/health-summary
  GET  /projects/{id}/metrics/overview

AI Assistant (advisory only)
  POST /projects/{id}/ai/explain-ci-failure
  POST /projects/{id}/ai/explain-incident
  POST /projects/{id}/ai/health-summary
  POST /projects/{id}/ai/ask          (free-text question)
```

## 10. Security Model Summary

- GitHub access via GitHub App installation tokens (scoped, revocable),
  not personal access tokens where avoidable.
- AWS access via cross-account IAM role assumption (`sts:AssumeRole`),
  short-lived credentials, scoped to EC2/VPC/security-group actions only.
- Secrets vault is the only place env var values and access keys are
  ever stored; the DB stores references, never values.
- Terraform state isolated per tenant (`tenants/<id>/terraform.tfstate`
  in a shared S3 backend with DynamoDB locking).
- RAG vector store queries are always filtered by `project_id` /
  `tenant_id` — no global similarity search across tenants.
- Every provisioning/deploy action is logged and attributable to the
  job/user that triggered it.

## 11. What This Is Not

- Not a generic PaaS competitor at first — the target is small teams /
  solo devs deploying to their own AWS account, not a hosted compute
  marketplace.
- Not a system where the AI can modify infrastructure directly.
- Not a system that stores or trains on user secrets or proprietary
  code beyond what's needed to generate configs and answer questions.

---

*Read `PHASE_PLAN.md` next for the ordered, session-by-session build
plan that implements this architecture.*
