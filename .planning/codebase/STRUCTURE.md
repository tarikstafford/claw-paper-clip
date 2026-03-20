# Codebase Structure

**Analysis Date:** 2026-03-19

## Directory Layout

```
claw-paper-clip/                          # Monorepo root
├── server/                               # Express API server (pnpm workspace member)
│   └── src/
│       ├── index.ts                      # Server entry point (startServer)
│       ├── app.ts                        # Express app factory (createApp)
│       ├── config.ts                     # Config loading from env/config file
│       ├── routes/                       # HTTP route handlers
│       ├── services/                     # Business logic services
│       ├── middleware/                   # Express middleware
│       ├── adapters/                     # AI adapter registry and process/http adapters
│       ├── realtime/                     # WebSocket live-events server
│       ├── auth/                         # BetterAuth integration
│       ├── storage/                      # File storage providers (local disk, S3)
│       ├── secrets/                      # Secret provider integrations
│       └── types/                        # Express augmentation (req.actor)
│
├── ui/                                   # React SPA (pnpm workspace member)
│   └── src/
│       ├── main.tsx                      # React root / providers bootstrap
│       ├── App.tsx                       # Route tree
│       ├── pages/                        # Page-level components (one per route)
│       ├── components/                   # Shared UI components
│       │   ├── ui/                       # Primitive design-system components
│       │   └── transcript/               # Agent run transcript components
│       ├── api/                          # API client functions (per-domain files)
│       ├── context/                      # React context providers
│       ├── hooks/                        # Custom React hooks
│       ├── adapters/                     # Per-adapter UI components
│       ├── plugins/                      # Plugin bridge and launcher
│       └── lib/                          # Shared utilities (queryKeys, router, etc.)
│
├── cli/                                  # paperclipai CLI (pnpm workspace member)
│   └── src/
│       ├── index.ts                      # CLI entry point (Commander program)
│       ├── commands/                     # Top-level commands (onboard, doctor, run, etc.)
│       │   └── client/                   # API client sub-commands (issue, agent, etc.)
│       ├── adapters/                     # CLI-side adapter helpers
│       ├── checks/                       # Doctor check implementations
│       ├── client/                       # API client for CLI-to-server calls
│       ├── config/                       # Config and env loading
│       ├── prompts/                      # Interactive prompt helpers
│       └── utils/                        # CLI utilities
│
├── packages/
│   ├── shared/                           # Shared types, validators, constants
│   │   └── src/
│   │       ├── types/                    # TypeScript interfaces (Agent, Issue, etc.)
│   │       └── validators/               # Zod schemas for API payloads
│   │
│   ├── db/                               # Drizzle ORM schema + migrations
│   │   └── src/
│   │       ├── schema/                   # One file per DB table
│   │       └── migrations/               # SQL migration files
│   │
│   ├── adapter-utils/                    # Shared types and utilities for adapters
│   │   └── src/
│   │       ├── types.ts                  # AdapterExecutionContext, ServerAdapterModule, etc.
│   │       ├── billing.ts                # OpenAI-compatible billing inference
│   │       └── log-redaction.ts          # Home path redaction utilities
│   │
│   ├── adapters/                         # Per-AI-tool adapter packages
│   │   ├── claude-local/                 # Claude Code CLI adapter
│   │   ├── codex-local/                  # OpenAI Codex adapter
│   │   ├── cursor-local/                 # Cursor adapter
│   │   ├── gemini-local/                 # Google Gemini CLI adapter
│   │   ├── opencode-local/               # OpenCode adapter
│   │   ├── pi-local/                     # Pi adapter
│   │   └── openclaw-gateway/             # OpenClaw Gateway adapter
│   │       (each contains src/server/, src/cli/, src/ui/)
│   │
│   └── plugins/
│       ├── sdk/                          # Plugin authoring SDK
│       │   └── src/
│       │       ├── define-plugin.ts      # definePlugin() entry point
│       │       ├── types.ts              # PluginContext, capabilities
│       │       ├── protocol.ts           # Host-worker RPC protocol
│       │       └── worker-rpc-host.ts    # Worker-side RPC host
│       ├── create-paperclip-plugin/      # Plugin scaffolding CLI
│       └── examples/                     # Example plugin implementations
│
├── services/
│   └── telegram-bot/                     # Standalone Telegram bot service
│       └── src/
│           ├── main.ts                   # Bot entry point
│           ├── app.ts                    # Bot application
│           └── lib/                      # Bot utilities
│
├── tests/
│   └── e2e/                              # Playwright end-to-end tests
│
├── scripts/                              # Build, release, smoke-test shell scripts
├── docker/                               # Docker helper configs
├── docs/                                 # Published documentation (Mintlify)
├── doc/                                  # Internal planning docs and specs
├── skills/                               # Agent skill definitions
├── .agents/                              # Agent adapter skill definitions
├── .claude/                              # Claude-specific skill definitions
├── .planning/                            # GSD planning documents
│   └── codebase/                         # Codebase analysis documents (this dir)
├── supabase/                             # Supabase config (temp/legacy)
├── Dockerfile                            # Production Docker image
├── docker-compose.yml                    # Full stack compose
├── package.json                          # Root workspace scripts
├── pnpm-workspace.yaml                   # pnpm workspace members
├── tsconfig.base.json                    # Shared TypeScript base config
└── vitest.config.ts                      # Vitest root config
```

## Directory Purposes

**`server/src/routes/`:**
- Purpose: HTTP route handlers; one file per domain (agents, issues, projects, etc.)
- Contains: Express `Router` factories receiving `db: Db` as first argument
- Key files: `server/src/routes/agents.ts`, `server/src/routes/issues.ts`, `server/src/routes/plugins.ts`

**`server/src/services/`:**
- Purpose: Business logic, database queries, background tasks
- Contains: Service factories (`agentService(db)`, `heartbeatService(db)`) and singleton exports
- Key files: `server/src/services/heartbeat.ts`, `server/src/services/agents.ts`, `server/src/services/plugin-worker-manager.ts`

**`server/src/adapters/`:**
- Purpose: Registry of all AI adapter modules; thin process/http generic adapters
- Contains: `registry.ts` (maps type string to `ServerAdapterModule`), `process/`, `http/`
- Key files: `server/src/adapters/registry.ts`

**`packages/db/src/schema/`:**
- Purpose: Drizzle table definitions, one file per logical entity
- Contains: ~50 schema files covering all tables (agents, issues, projects, plugins, auth, etc.)
- Key files: `packages/db/src/schema/agents.ts`, `packages/db/src/schema/issues.ts`, `packages/db/src/schema/heartbeat_runs.ts`

**`ui/src/api/`:**
- Purpose: API client modules mirroring server routes; one file per domain
- Contains: Functions calling `api.get/post/patch/delete` from `ui/src/api/client.ts`
- Key files: `ui/src/api/agents.ts`, `ui/src/api/issues.ts`, `ui/src/api/client.ts`

**`ui/src/pages/`:**
- Purpose: Full-page route components rendered by React Router
- Contains: One `.tsx` file per route (Dashboard, Agents, AgentDetail, Issues, etc.)
- Key files: `ui/src/pages/AgentDetail.tsx`, `ui/src/pages/IssueDetail.tsx`

**`ui/src/context/`:**
- Purpose: React context providers for app-wide state
- Contains: CompanyContext, LiveUpdatesProvider, DialogContext, ToastContext, ThemeContext, etc.
- Key files: `ui/src/context/CompanyContext.tsx`, `ui/src/context/LiveUpdatesProvider.tsx`

## Key File Locations

**Entry Points:**
- `server/src/index.ts`: Server process entry (`startServer()`)
- `server/src/app.ts`: Express app factory (`createApp()`)
- `ui/src/main.tsx`: React SPA bootstrap
- `ui/src/App.tsx`: React Router route tree
- `cli/src/index.ts`: CLI Commander program

**Configuration:**
- `server/src/config.ts`: Server config loading (env vars + YAML config file)
- `tsconfig.base.json`: Shared TypeScript compiler options
- `pnpm-workspace.yaml`: Workspace member declarations
- `.env.example`: Required environment variables reference

**Core Logic:**
- `server/src/adapters/registry.ts`: Maps adapter type strings to `ServerAdapterModule` implementations
- `server/src/middleware/auth.ts`: Actor resolution middleware (`actorMiddleware`)
- `server/src/services/heartbeat.ts`: Agent run scheduling, execution, and recovery
- `packages/shared/src/types/`: All shared TypeScript interfaces
- `packages/db/src/schema/index.ts`: Database schema barrel export

**Testing:**
- `vitest.config.ts`: Root Vitest configuration
- `tests/e2e/`: Playwright E2E tests
- `server/src/__tests__/`: Server unit/integration tests
- `cli/src/__tests__/`: CLI unit tests

## Naming Conventions

**Files:**
- Server routes: `kebab-case.ts`, named after the resource (e.g., `agents.ts`, `sidebar-badges.ts`)
- Server services: `kebab-case.ts`, named after the domain (e.g., `heartbeat.ts`, `plugin-loader.ts`)
- UI pages: `PascalCase.tsx`, named after the page (e.g., `AgentDetail.tsx`, `IssueDetail.tsx`)
- UI components: `PascalCase.tsx` for components, `kebab-case.ts` for utilities
- DB schema: `snake_case.ts`, named after the table (e.g., `heartbeat_runs.ts`)
- Adapter packages: `{name}-local` or `{name}-gateway` pattern

**Directories:**
- Packages: `kebab-case` (e.g., `adapter-utils`, `claude-local`)
- UI feature directories: `kebab-case` (e.g., `claude-local`, `openclaw-gateway`)

## Where to Add New Code

**New API Route:**
- Route handler: `server/src/routes/{resource}.ts`
- Service logic: `server/src/services/{resource}.ts`
- Export service from: `server/src/services/index.ts`
- Mount route in: `server/src/app.ts` inside `createApp()`
- Add Zod schemas to: `packages/shared/src/validators/`

**New UI Page:**
- Component: `ui/src/pages/{PageName}.tsx`
- API client: `ui/src/api/{resource}.ts` (add function calls using `api.get/post`)
- Add route in: `ui/src/App.tsx` inside the appropriate `<Route>` block
- Add query keys to: `ui/src/lib/queryKeys.ts`

**New Database Table:**
- Schema file: `packages/db/src/schema/{table_name}.ts`
- Export from: `packages/db/src/schema/index.ts`
- Generate migration: `pnpm db:generate`
- Apply migration: `pnpm db:migrate`

**New Adapter:**
- Create package: `packages/adapters/{name}-local/`
- Implement: `src/server/execute.ts`, `src/server/test.ts`, `src/server/index.ts`
- Register in: `server/src/adapters/registry.ts`
- Add adapter type to: `packages/shared/src/` constants

**New Plugin:**
- Scaffold with: `pnpm create paperclip-plugin`
- Main entrypoint: `src/worker.ts` calling `definePlugin({ setup })`
- SDK import: `@paperclipai/plugin-sdk`

**New CLI Command:**
- Top-level command: `cli/src/commands/{command}.ts`
- Client command (talks to API): `cli/src/commands/client/{resource}.ts`
- Register in: `cli/src/index.ts`

**Shared Types:**
- TypeScript interfaces: `packages/shared/src/types/`
- Zod validators: `packages/shared/src/validators/`
- Export from: `packages/shared/src/index.ts`

## Special Directories

**`server/dist/`:**
- Purpose: Compiled server output for production Docker builds
- Generated: Yes (TypeScript compilation)
- Committed: No

**`ui/dist/`:**
- Purpose: Vite-built static frontend assets
- Generated: Yes (`pnpm build` in `ui/`)
- Committed: No

**`packages/db/src/migrations/`:**
- Purpose: SQL migration files generated by Drizzle Kit
- Generated: Yes (`pnpm db:generate`)
- Committed: Yes (migrations are source-controlled)

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents consumed by plan-phase and execute-phase
- Generated: Yes (by `/gsd:map-codebase`)
- Committed: Optional (team preference)

**`doc/`:**
- Purpose: Internal planning docs, specs, experimental notes — NOT the published docs site
- Generated: No
- Committed: Yes

**`docs/`:**
- Purpose: Published Mintlify documentation site source
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-03-19*
