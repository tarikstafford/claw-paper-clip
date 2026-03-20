# Technology Stack

**Analysis Date:** 2026-03-19

## Languages

**Primary:**
- TypeScript 5.7.3 - All packages (server, UI, CLI, adapters, packages)

**Secondary:**
- JavaScript (ESM) - Build scripts (`scripts/dev-runner.mjs`, `monitor.mjs`, `esbuild.config.mjs`)
- Shell - Release and utility scripts (`scripts/*.sh`, `docker-entrypoint.sh`)
- SQL - Database migrations (`packages/db/src/migrations/*.sql`)

## Runtime

**Environment:**
- Node.js >=20 (enforced via `engines` in root `package.json`; Docker uses `node:lts-trixie-slim`)

**Package Manager:**
- pnpm 9.15.4
- Lockfile: `pnpm-lock.yaml` present

## Frameworks

**Backend:**
- Express 5.1.0 (`server`) - HTTP API server
- Fastify 5.7.4 (`services/telegram-bot`) - Telegram webhook service

**Frontend:**
- React 19.0.0 (`ui`) - Component framework
- React Router 7.1.5 (`ui`) - Client-side routing
- Vite 6.1.0 (`ui`) - Dev server and build tool; configured in `ui/vite.config.ts`

**Styling:**
- Tailwind CSS 4.0.7 (`ui`) - Utility-first CSS; configured via `@tailwindcss/vite` plugin
- Radix UI (via `radix-ui` ^1.4.3 and `@radix-ui/react-slot` ^1.2.4) - Accessible primitives
- `class-variance-authority`, `clsx`, `tailwind-merge` - Class composition utilities
- `lucide-react` 0.574.0 - Icon library

**CLI:**
- Commander 13.1.0 (`cli`) - CLI argument parsing
- `@clack/prompts` 0.10.0 (`cli`) - Interactive terminal prompts

**Testing:**
- Vitest 3.0.5 - Test runner across all packages (root config at `vitest.config.ts`, per-package configs in `server/vitest.config.ts`, `ui/vitest.config.ts`, `cli/vitest.config.ts`)
- Playwright 1.58.2 - E2E tests (`tests/e2e/playwright.config.ts`)
- Supertest 7.0.0 - HTTP integration tests (`server`)

## Key Dependencies

**Critical:**
- `drizzle-orm` 0.38.4 - ORM for all database access; used in `packages/db`, `server`, `cli`
- `drizzle-kit` 0.31.9 - Schema generation and migration tooling; config at `packages/db/drizzle.config.ts`
- `postgres` 3.4.5 - PostgreSQL client used by `packages/db/src/client.ts`
- `embedded-postgres` 18.1.0-beta.16 - Bundles PostgreSQL for zero-config local mode; used in `server` and `cli`
- `better-auth` 1.4.18 - Authentication library; configured in `server/src/auth/better-auth.ts`
- `zod` 3.24.2 - Runtime schema validation; used in `server`, `packages/shared`, `packages/plugins/sdk`
- `ws` 8.19.0 - WebSocket server; used in `server` (realtime live events) and `packages/adapters/openclaw-gateway`
- `pino` 9.6.0 + `pino-http` 10.4.0 + `pino-pretty` 13.1.3 - Structured logging (`server`)

**Infrastructure:**
- `@aws-sdk/client-s3` 3.888.0 - S3-compatible object storage; provider at `server/src/storage/s3-provider.ts`
- `dotenv` 17.0.1 - Environment variable loading (`server`, `cli`)
- `chokidar` 4.0.3 - File watching for hot-reload in dev mode (`server`)
- `multer` 2.0.2 - Multipart file upload handling (`server`)
- `ajv` 8.18.0 + `ajv-formats` 3.0.1 - JSON schema validation for plugin manifests (`server`)
- `dompurify` 3.3.2 + `jsdom` 28.1.0 - HTML sanitization (`server`)
- `@tanstack/react-query` 5.90.21 - Server state management (`ui`)
- `@mdxeditor/editor` 3.52.4 - Rich text/MDX editor (`ui`)
- `mermaid` 11.12.0 - Diagram rendering (`ui`)
- `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 - Markdown rendering (`ui`)
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` - Drag-and-drop (`ui`)
- `cmdk` 1.1.1 - Command palette (`ui`)
- `esbuild` 0.27.3 - CLI bundle (`cli/esbuild.config.mjs`)
- `tsx` 4.19.2 - TypeScript direct execution for dev mode (`server`, `cli`, `services`)
- `@changesets/cli` 2.30.0 - Monorepo versioning and changelog management

**AI Agent Runtimes (installed globally in Docker, `Dockerfile` line 45):**
- `@anthropic-ai/claude-code` - Claude Code CLI
- `@openai/codex` - OpenAI Codex CLI
- `opencode-ai` - OpenCode CLI

## Configuration

**Environment:**
- `.env` and `.env.example` at repo root (loaded by `server/src/config.ts` via `dotenv`)
- Per-instance config file: JSON at `PAPERCLIP_CONFIG` env path (default `~/.paperclip/instances/default/config.json`), parsed by `server/src/config-file.ts`
- Key env vars: `DATABASE_URL`, `PORT`, `HOST`, `SERVE_UI`, `BETTER_AUTH_SECRET`, `PAPERCLIP_DEPLOYMENT_MODE`, `PAPERCLIP_DEPLOYMENT_EXPOSURE`, `PAPERCLIP_PUBLIC_URL`, `PAPERCLIP_SECRETS_PROVIDER`, `PAPERCLIP_STORAGE_PROVIDER`, `PAPERCLIP_STORAGE_S3_BUCKET`, `PAPERCLIP_STORAGE_S3_REGION`, `PAPERCLIP_STORAGE_S3_ENDPOINT`

**Build:**
- Root `tsconfig.json` + `tsconfig.base.json` - TypeScript project references
- Per-package `tsconfig.json` extending `../../tsconfig.base.json`
- `ui/vite.config.ts` - Vite build config (React plugin, Tailwind plugin, proxy to `localhost:3100`)
- `cli/esbuild.config.mjs` - esbuild bundler config for CLI distribution
- `Dockerfile` - Multi-stage build: deps → build → production

## Platform Requirements

**Development:**
- Node.js >=20, pnpm 9.15.4
- Optional: external PostgreSQL via `DATABASE_URL` (falls back to embedded PostgreSQL)
- UI dev server: port 5173; API server: port 3100

**Production:**
- Docker (Debian slim base `node:lts-trixie-slim`)
- External PostgreSQL recommended (or embedded PostgreSQL auto-starts)
- Port 3100 exposed
- Vercel supported for UI-only static deployment (`vercel.json`)

---

*Stack analysis: 2026-03-19*
