# External Integrations

**Analysis Date:** 2026-03-19

## APIs & External Services

**AI Agent CLIs (spawned as local subprocesses):**
- Claude Code (`@anthropic-ai/claude-code`) - Adapter: `packages/adapters/claude-local/`
  - Launched as a local CLI subprocess by the server
  - Quota probing: `packages/adapters/claude-local/src/cli/quota-probe.ts`
- OpenAI Codex (`@openai/codex`) - Adapter: `packages/adapters/codex-local/`
  - Launched as a local CLI subprocess
- Google Gemini CLI (`gemini`) - Adapter: `packages/adapters/gemini-local/`
  - Launched as a local CLI subprocess
- OpenCode AI (`opencode-ai`) - Adapter: `packages/adapters/opencode-local/`
  - Launched as a local CLI subprocess
- Cursor (`cursor`) - Adapter: `packages/adapters/cursor-local/`
  - Launched as a local CLI subprocess
- Pi AI (`pi`) - Adapter: `packages/adapters/pi-local/`
  - Launched as a local CLI subprocess

**OpenClaw Gateway (remote agent proxy):**
- `packages/adapters/openclaw-gateway/` - Connects to a remote OpenClaw gateway over WebSocket (`ws` library)
  - Enables cloud-hosted or remote agent execution

**Third-party community adapters:**
- `hermes-paperclip-adapter` 0.1.1 - External community adapter (`server/package.json`)

**Telegram:**
- `services/telegram-bot/` - Standalone Fastify service receiving Telegram Bot API webhooks
  - Listens for incoming bot messages/updates; no official Telegram SDK listed (raw HTTP)

## Data Storage

**Databases:**
- PostgreSQL (primary)
  - Two modes:
    1. **Embedded**: `embedded-postgres` 18.1.0-beta.16 auto-starts a bundled PostgreSQL instance when `DATABASE_URL` is not set. Data directory defaults to `~/.paperclip/.embedded-postgres-data`, port 54329.
    2. **External**: Any PostgreSQL 17+ instance via `DATABASE_URL` connection string (e.g., `postgres://paperclip:paperclip@localhost:5432/paperclip`).
  - ORM: Drizzle ORM (`drizzle-orm`) with `postgres` client (`packages/db/src/client.ts`)
  - Schema: 40+ tables in `packages/db/src/schema/` covering agents, issues, companies, plugins, auth, finance, costs, approvals, etc.
  - Migrations: SQL files in `packages/db/src/migrations/`, managed via `drizzle-kit` and custom migration runtime in `packages/db/src/client.ts`
  - Connection env var: `DATABASE_URL`

**File Storage:**
- Two providers, selectable via `PAPERCLIP_STORAGE_PROVIDER`:
  1. **`local_disk`** (default): Files stored at `PAPERCLIP_STORAGE_LOCAL_DIR` (defaults to `~/.paperclip/storage`)
     - Implementation: `server/src/storage/local-disk-provider.ts`
  2. **`s3`**: AWS S3 or any S3-compatible endpoint
     - SDK: `@aws-sdk/client-s3` 3.888.0
     - Implementation: `server/src/storage/s3-provider.ts`
     - Env vars: `PAPERCLIP_STORAGE_S3_BUCKET`, `PAPERCLIP_STORAGE_S3_REGION`, `PAPERCLIP_STORAGE_S3_ENDPOINT`, `PAPERCLIP_STORAGE_S3_PREFIX`, `PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE`

**Caching:**
- None detected (no Redis or in-memory cache layer)

## Authentication & Identity

**Auth Provider:**
- `better-auth` 1.4.18 - Self-hosted auth library
  - Implementation: `server/src/auth/better-auth.ts`
  - Two deployment modes:
    1. **`local_trusted`**: No auth; auto-creates a trusted local board principal. Only for loopback host bindings.
    2. **`authenticated`**: Full email/password auth via `better-auth`, with session cookies
  - Database adapter: Drizzle adapter (`better-auth/adapters/drizzle`) backed by PostgreSQL auth tables in `packages/db/src/schema/auth.ts`
  - Auth tables: `authUsers`, `authSessions`, `authAccounts`, `authVerifications`
  - Required env vars (authenticated mode): `BETTER_AUTH_SECRET` (or `PAPERCLIP_AGENT_JWT_SECRET`)
  - Optional env vars: `BETTER_AUTH_URL` / `BETTER_AUTH_BASE_URL` / `PAPERCLIP_AUTH_PUBLIC_BASE_URL` / `PAPERCLIP_PUBLIC_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `PAPERCLIP_AUTH_DISABLE_SIGN_UP`
  - Sign-up can be disabled via `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true`

**Agent Auth:**
- JWT-based agent authentication; secret via `PAPERCLIP_AGENT_JWT_SECRET`
  - Implementation: `server/src/agent-auth-jwt.ts`

## Secrets Management

**Secrets Provider:**
- Selectable via `PAPERCLIP_SECRETS_PROVIDER`:
  1. **`local_encrypted`** (default): Master key file at `PAPERCLIP_SECRETS_MASTER_KEY_FILE` (defaults to `~/.paperclip/secrets.key`)
     - Implementation: `server/src/secrets/local-encrypted-provider.ts`
  2. **External stub providers**: Defined in `server/src/secrets/external-stub-providers.ts`
- Secrets stored in `packages/db/src/schema/company_secrets.ts` and `company_secret_versions.ts`

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry or similar)

**Logs:**
- `pino` 9.6.0 structured JSON logging in `server`
- `pino-http` for HTTP request logging
- `pino-pretty` for human-readable dev output
- Logger instantiated at `server/src/middleware/logger.ts`
- Log redaction utilities: `server/src/log-redaction.ts`, `packages/adapter-utils/src/log-redaction.ts`

## CI/CD & Deployment

**Hosting:**
- Docker - Primary deployment via `Dockerfile` (multi-stage build) and `docker-compose.yml`
- Docker Compose variants: `docker-compose.yml` (standard), `docker-compose.quickstart.yml`, `docker-compose.untrusted-review.yml`
- Vercel - UI-only static deployment (`vercel.json`); builds `@paperclipai/ui`, serves from `ui/dist`
- Self-hosted: Direct Node.js via `cli` package (`paperclipai` binary)

**CI Pipeline:**
- Not detected (no `.github/workflows`, `.circleci`, or similar in explored directories)

**Release Process:**
- `@changesets/cli` for version management
- Scripts: `scripts/release.sh`, `scripts/release-start.sh`, `scripts/release-preflight.sh`, `scripts/create-github-release.sh`, `scripts/rollback-latest.sh`
- NPM publishing: `scripts/build-npm.sh`

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string (optional; embedded PostgreSQL used if absent)
- `PORT` - Server port (default: 3100)
- `HOST` - Bind host (default: `127.0.0.1`)
- `SERVE_UI` - Whether server serves the UI bundle (default: `true`)
- `BETTER_AUTH_SECRET` - Required in `authenticated` deployment mode
- `PAPERCLIP_DEPLOYMENT_MODE` - `local_trusted` or `authenticated`
- `PAPERCLIP_DEPLOYMENT_EXPOSURE` - `private` or `public`
- `PAPERCLIP_PUBLIC_URL` - Public-facing URL for auth callbacks

**Optional env vars:**
- `PAPERCLIP_STORAGE_PROVIDER` - `local_disk` (default) or `s3`
- `PAPERCLIP_STORAGE_S3_BUCKET`, `PAPERCLIP_STORAGE_S3_REGION`, `PAPERCLIP_STORAGE_S3_ENDPOINT`
- `PAPERCLIP_SECRETS_PROVIDER` - `local_encrypted` (default) or external
- `PAPERCLIP_SECRETS_MASTER_KEY_FILE` - Path to encryption key file
- `PAPERCLIP_AGENT_JWT_SECRET` - JWT secret for agent authentication
- `PAPERCLIP_AUTH_DISABLE_SIGN_UP` - `true` to disable new registrations
- `BETTER_AUTH_TRUSTED_ORIGINS` - Comma-separated additional trusted origins
- `PAPERCLIP_EMBEDDED_POSTGRES_VERBOSE` - `true` for embedded PostgreSQL verbose logs
- `PAPERCLIP_MIGRATION_AUTO_APPLY` - `true` to auto-apply migrations without prompt
- `PAPERCLIP_DB_BACKUP_ENABLED`, `PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES`, `PAPERCLIP_DB_BACKUP_RETENTION_DAYS`, `PAPERCLIP_DB_BACKUP_DIR`
- `HEARTBEAT_SCHEDULER_ENABLED`, `HEARTBEAT_SCHEDULER_INTERVAL_MS`

**Secrets location:**
- `.env` at repo root (loaded by `server/src/config.ts`; never committed with real secrets)
- `.env.example` documents minimal required vars

## Webhooks & Callbacks

**Incoming:**
- Telegram Bot API webhooks received by `services/telegram-bot/` (Fastify HTTP server)
- Plugin webhooks: defined in DB schema `packages/db/src/schema/plugin_webhooks.ts`; handled by plugin runtime in `server/src/services/plugin-*.ts`

**Outgoing:**
- Agent CLIs make outbound calls to their respective AI provider APIs (Anthropic, OpenAI, Google, etc.) directly from the subprocess; the server does not proxy these calls
- OpenClaw Gateway adapter connects outbound via WebSocket to a remote gateway

---

*Integration audit: 2026-03-19*
