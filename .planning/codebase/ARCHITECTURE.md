# Architecture

**Analysis Date:** 2026-03-19

## Pattern Overview

**Overall:** Multi-package monorepo with a pluggable adapter pattern for AI agent execution

**Key Characteristics:**
- pnpm workspace monorepo with packages in `packages/`, `server/`, `ui/`, `cli/`, `services/`
- Express.js REST + WebSocket server with a React SPA frontend served from the same process
- AI agent execution delegated to pluggable adapter modules (`ServerAdapterModule`), each wrapping a specific AI tool (Claude, Codex, Cursor, Gemini, OpenCode, Pi, OpenClaw Gateway)
- Multi-tenant: data is scoped to Companies, each company has its own agents, projects, issues, etc.
- Two deployment modes: `local_trusted` (loopback-only, no auth) and `authenticated` (BetterAuth sessions + JWT)

## Layers

**Shared Types (`packages/shared`):**
- Purpose: Cross-package type definitions, validators, and constants consumed by server, CLI, and UI
- Location: `packages/shared/src/`
- Contains: Zod schemas, TypeScript types, constants for deployment modes, adapter types
- Depends on: Nothing internal
- Used by: `server/`, `ui/`, `cli/`, all adapter packages

**Database (`packages/db`):**
- Purpose: Drizzle ORM schema definitions and migration management
- Location: `packages/db/src/`
- Contains: Schema files per entity (`schema/*.ts`), migration files, `createDb()` factory
- Depends on: Nothing internal
- Used by: `server/` only (direct DB access is server-side only)

**Adapter Utils (`packages/adapter-utils`):**
- Purpose: Shared types and utilities for all adapter packages
- Location: `packages/adapter-utils/src/`
- Contains: `AdapterExecutionContext`, `ServerAdapterModule`, `AdapterSessionCodec`, billing helpers, log redaction
- Depends on: Nothing internal
- Used by: All adapter packages and `server/src/adapters/`

**Adapter Packages (`packages/adapters/*`):**
- Purpose: Per-AI-tool execution wrappers implementing `ServerAdapterModule`
- Location: `packages/adapters/{claude-local,codex-local,cursor-local,gemini-local,opencode-local,pi-local,openclaw-gateway}/`
- Each contains three sub-folders: `src/server/` (execute, test, quota), `src/cli/`, `src/ui/`
- Depends on: `packages/adapter-utils`, `packages/shared`
- Used by: `server/src/adapters/registry.ts`

**Server (`server/src`):**
- Purpose: Express HTTP API, WebSocket real-time events, plugin system, background services
- Location: `server/src/`
- Entry point: `server/src/index.ts` (`startServer()`)
- App factory: `server/src/app.ts` (`createApp()`)
- Depends on: `@paperclipai/db`, `@paperclipai/shared`, all adapter packages, `@paperclipai/plugin-sdk`
- Used by: Process entrypoint, Docker

**UI (`ui/src`):**
- Purpose: React SPA served by the server in static or Vite-dev mode
- Location: `ui/src/`
- Entry point: `ui/src/main.tsx`
- Depends on: `@paperclipai/shared` (types only)
- Used by: Browser; served from server via static files or Vite middleware

**CLI (`cli/src`):**
- Purpose: `paperclipai` CLI for setup, diagnostics, and client operations
- Location: `cli/src/`
- Entry point: `cli/src/index.ts`
- Depends on: `@paperclipai/shared`, server HTTP API (via client commands)
- Used by: Operators and agents via terminal

**Plugin SDK (`packages/plugins/sdk`):**
- Purpose: Public API for plugin authors to define plugins with events, jobs, UI, secrets
- Location: `packages/plugins/sdk/src/`
- Contains: `definePlugin()`, `PluginContext`, RPC protocol, worker host factory
- Depends on: Nothing internal
- Used by: Plugin packages and `server/src/services/plugin-*.ts`

**Services (`services/telegram-bot`):**
- Purpose: Standalone Telegram bot service that integrates with the Paperclip API
- Location: `services/telegram-bot/src/`
- Depends on: Paperclip HTTP API (external calls)

## Data Flow

**Agent Heartbeat Execution:**

1. Heartbeat scheduler (`server/src/services/heartbeat.ts`) triggers a run for an agent on a timer
2. `server/src/routes/agents.ts` or heartbeat service invokes the adapter via `getServerAdapter(type)`
3. The adapter module's `execute()` function spawns the AI process (e.g., Claude CLI subprocess) and streams output
4. Run events are written to `heartbeat_run_events` table via `server/src/services/heartbeat.ts`
5. Live events are published to WebSocket subscribers via `server/src/services/live-events.ts`
6. UI `LiveUpdatesProvider` receives WebSocket events and calls `queryClient.invalidateQueries()`

**HTTP API Request:**

1. Request hits Express app
2. `privateHostnameGuard` middleware checks host if in private authenticated mode
3. `actorMiddleware` (`server/src/middleware/auth.ts`) resolves actor: `board` (session cookie or local_trusted), `agent` (JWT or API key), or `none`
4. Route handler (`server/src/routes/*.ts`) calls service functions from `server/src/services/index.ts`
5. Service functions query/mutate database via Drizzle ORM
6. Route handler returns JSON response
7. On mutations, `logActivity()` and `publishLiveEvent()` are called to broadcast changes

**UI Data Flow:**

1. `ui/src/main.tsx` bootstraps providers: QueryClient, CompanyProvider, LiveUpdatesProvider
2. Page components call `useQuery()` with API functions from `ui/src/api/*.ts`
3. `ui/src/api/client.ts` wraps `fetch()` to `/api/*`, handles 401 redirects
4. `LiveUpdatesProvider` subscribes to `ws://.../api/companies/:id/events/ws`
5. On WebSocket events, React Query caches are invalidated, triggering re-fetches

**Plugin Execution:**

1. `pluginLoader` scans `DEFAULT_LOCAL_PLUGIN_DIR` for installed plugins at startup
2. Each plugin is loaded as a Worker thread via `createPluginWorkerManager()`
3. Plugin worker calls `definePlugin({ setup })` and the SDK wires it to the host via RPC
4. Host dispatches events, jobs, and tool calls through `pluginEventBus`, `pluginJobScheduler`, `pluginToolDispatcher`
5. Plugin UI is served as static files at `/plugins/:pluginId/*` via `pluginUiStaticRoutes`

**State Management (UI):**

- React Query (`@tanstack/react-query`) is the primary server-state cache with `staleTime: 30_000`
- React Context provides: company selection, sidebar state, toast notifications, theme, breadcrumbs, dialogs
- No Redux or Zustand; all server state flows through React Query

## Key Abstractions

**`ServerAdapterModule`:**
- Purpose: Contract every AI agent adapter must satisfy
- Examples: `packages/adapters/claude-local/src/server/`, `packages/adapters/codex-local/src/server/`
- Pattern: `{ type, execute, testEnvironment, sessionCodec, models, listModels?, getQuotaWindows?, supportsLocalAgentJwt }`

**`Actor` (request identity):**
- Purpose: Who is making an API request — board user, agent, or anonymous
- File: `server/src/middleware/auth.ts`, type declaration in `server/src/types/express.d.ts`
- Pattern: `req.actor` is always set by `actorMiddleware`; types are `{ type: "board" | "agent" | "none", ... }`

**`Db` (Drizzle database handle):**
- Purpose: Type-safe database client passed by dependency injection to all services and routes
- File: Created by `createDb()` in `packages/db/src/`
- Pattern: Services are factories receiving `db` as first argument: `agentService(db)`, `issueService(db)`

**Plugin Context (`PluginContext`):**
- Purpose: Sandboxed API surface exposed to plugin worker threads
- File: `packages/plugins/sdk/src/types.ts`
- Pattern: `ctx.events.on()`, `ctx.jobs.register()`, `ctx.data.register()`, `ctx.config.get()`, `ctx.secrets.resolve()`

## Entry Points

**Server:**
- Location: `server/src/index.ts`
- Triggers: Direct execution (`node server/src/index.ts`) or `pnpm dev:server`
- Responsibilities: Load config, start embedded/external PostgreSQL, run migrations, create Express app, start WebSocket server, start heartbeat scheduler, start database backup scheduler

**UI:**
- Location: `ui/src/main.tsx`
- Triggers: Browser load or Vite dev server
- Responsibilities: Mount React root, initialize plugin bridge, register service worker, bootstrap providers

**CLI:**
- Location: `cli/src/index.ts`
- Triggers: `pnpm paperclipai <command>` or `npx paperclipai`
- Responsibilities: Parse commands, dispatch to onboard/doctor/configure/heartbeat-run/client commands

**Plugin SDK Worker:**
- Location: `packages/plugins/sdk/src/define-plugin.ts`
- Triggers: Plugin worker thread startup by server
- Responsibilities: Expose `definePlugin()` so plugin authors can register event/job handlers

## Error Handling

**Strategy:** Structured error objects with HTTP status codes on the server; React Query error state on the client

**Patterns:**
- Server routes use helper factories from `server/src/errors.ts`: `notFound()`, `forbidden()`, `conflict()`, `unprocessable()`
- `errorHandler` middleware in `server/src/middleware/error-handler.ts` catches thrown errors and serializes them
- UI `api/client.ts` throws `ApiError` with `status` and `body` for non-2xx responses; 401/403 redirect to `/auth`
- Adapter execution errors are caught per-run and stored in `heartbeat_runs` table with a `failed` status

## Cross-Cutting Concerns

**Logging:** Pino logger at `server/src/middleware/logger.ts`; all services import `logger` from there. Structured JSON in production, pretty-print in dev.

**Validation:** Zod schemas defined in `packages/shared/src/validators/`; `validate()` middleware in `server/src/middleware/validate.ts` wraps schema parsing for request bodies.

**Authentication:** Two paths — board users via BetterAuth session cookies (authenticated mode) or implicit local trust (local_trusted mode); agents via signed JWT (`server/src/agent-auth-jwt.ts`) or hashed API keys stored in `agent_api_keys` table.

---

*Architecture analysis: 2026-03-19*
