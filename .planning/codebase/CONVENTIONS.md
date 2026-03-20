# Coding Conventions

**Analysis Date:** 2026-03-19

## Naming Patterns

**Files:**
- kebab-case for all TypeScript and TSX files: `error-handler.ts`, `company-page-memory.ts`, `AgentProperties.tsx`
- React components use PascalCase filenames: `AgentProperties.tsx`, `OnboardingWizard.tsx`, `StatusBadge.tsx`
- Test files are suffixed `.test.ts` or `.test.tsx` — co-located or in `__tests__/` directories
- E2E spec files use `.spec.ts` suffix

**Functions:**
- camelCase for all functions: `createApp()`, `makeDb()`, `buildWorkspace()`, `hashToken()`
- Factory functions named `make*`, `create*`, or `build*` (e.g., `makeDb()`, `createApp()`, `buildWorkspace()`)
- Route factory functions named `*Routes(db)`: `companyRoutes(db)`, `costRoutes(db)`, `agentRoutes(db)`
- Service factory functions named `*Service(db)`: `companyService(db)`, `approvalService(db)`

**Variables:**
- camelCase throughout: `selectChain`, `thenableChain`, `mockCompanyService`, `leasedRunIds`
- Constants are camelCase or SCREAMING_SNAKE_CASE for true constants: `CONFIG_REVISION_FIELDS`, `REDACTED_EVENT_VALUE`, `RECENT_ISSUES_LIMIT`

**Types and Interfaces:**
- PascalCase for all types, interfaces, and classes: `HttpError`, `ErrorContext`, `AgentPropertiesProps`, `RevisionMetadata`
- Interface names are descriptive and not prefixed with `I`: `UpdateAgentOptions`, `AgentShortnameRow`
- Local-only types often defined inline within test files

**React Components:**
- PascalCase function components with named exports: `export function AgentProperties(...)`, `export function StatusBadge(...)`
- Props interfaces named `{ComponentName}Props`: `AgentPropertiesProps`

## Code Style

**Formatting:**
- No Prettier or Biome config detected — formatting is enforced via TypeScript strict mode and code review
- Consistent 2-space indentation throughout all source files
- Single quotes for imports in TypeScript; double quotes in some config files
- Trailing commas used in multi-line structures

**Linting:**
- No ESLint config detected at the root or package level
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.base.json`)
- `isolatedModules: true` enforces clean module boundaries
- `forceConsistentCasingInFileNames: true` in base tsconfig

**TypeScript Configuration:**
- Base config: `tsconfig.base.json` — `ES2023` target, `NodeNext` module resolution, strict mode
- Each package/app extends the base config
- `declaration`, `declarationMap`, and `sourceMap` enabled for all packages
- Explicit `.js` extensions used in all relative imports (ESM NodeNext requirement): `import { errorHandler } from "../middleware/error-handler.js"`

## Import Organization

**Order (consistently observed):**
1. Node built-in modules (`node:path`, `node:fs`, `node:crypto`)
2. External package imports (`express`, `drizzle-orm`, `zod`)
3. Internal workspace packages (`@paperclipai/db`, `@paperclipai/shared`, `@paperclipai/adapter-utils`)
4. Local relative imports (`../errors.js`, `./authz.js`, `../services/index.js`)

**Path Aliases:**
- `@/` alias used in UI for `src/`: `import { Link } from "@/lib/router"`, `import { Separator } from "@/components/ui/separator"`
- Workspace packages imported as `@paperclipai/*`: `@paperclipai/db`, `@paperclipai/shared`, `@paperclipai/adapter-claude-local`

**Extension Rules:**
- All relative server/package imports must include `.js` extension (NodeNext ESM requirement)
- UI imports may omit extensions (Vite handles resolution)

## Error Handling

**Server HTTP Errors:**
- Centralized `HttpError` class in `server/src/errors.ts`
- Helper factories for common statuses: `badRequest()`, `unauthorized()`, `forbidden()`, `notFound()`, `conflict()`, `unprocessable()`
- Routes throw `HttpError` and let `errorHandler` middleware catch and serialize

```typescript
// Throwing pattern
throw forbidden("Forbidden");
throw notFound("Not found");
throw badRequest("Invalid 'from' date", { received: fromParam });

// Error handler catches all — routes do NOT try/catch
router.get("/:companyId", async (req, res) => {
  const company = await svc.getById(companyId);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  res.json(company);
});
```

**Express Error Middleware:**
- Global `errorHandler` in `server/src/middleware/error-handler.ts` handles `HttpError`, `ZodError`, and generic `Error`
- Attaches `__errorContext` to `res` for structured logging
- 500 responses always return `{ error: "Internal server error" }` to the client

**UI API Errors:**
- `ApiError` class in `ui/src/api/client.ts` wraps failed fetch responses
- Auto-redirects to `/auth` on 401/403
- All API calls use the shared `api` helper object: `api.get()`, `api.post()`, `api.patch()`, `api.delete()`

**Validation:**
- Zod schemas defined in `@paperclipai/shared` for shared types
- Server uses `validate(schema)` middleware in `server/src/middleware/validate.ts` to parse and throw on invalid bodies
- ZodError is caught by errorHandler and returns 400 with structured error details

## Logging

**Framework:** Pino with `pino-pretty` for development, file transport for debug logs

**Location:** `server/src/middleware/logger.ts`

**Patterns:**
- HTTP request logging via `pinoHttp` middleware (`httpLogger`)
- Log level `info` to stdout (colored), `debug` to file (`server.log`)
- Custom log levels per HTTP status: `error` (5xx), `warn` (4xx), `info` (2xx/3xx)
- Error context attached to `res.__errorContext` for log enrichment
- `logger` exported for use in services requiring structured logging

## Comments

**When to Comment:**
- Inline comments for non-obvious behavior: `// Common malformed path when companyId is empty`
- Block comments for E2E test intent (JSDoc-style above test suites)
- `// @vitest-environment node` directive at file top when overriding environment
- `TODO(issue-label)` format for tracked future work: `// TODO(issue-worktree-support): re-enable this UI once the workflow is ready to ship.`

**JSDoc/TSDoc:**
- Minimal JSDoc in application code
- E2E test files include JSDoc block comments explaining test scope and environment flags

## Function Design

**Size:** Functions are kept focused and single-purpose; route handlers delegate to service objects immediately

**Parameters:**
- Options objects preferred over long parameter lists: `interface UpdateAgentOptions { recordRevision?: RevisionMetadata }`
- Required parameters come before optional ones
- `db` (Drizzle instance) is the first and often only parameter to service factories

**Return Values:**
- Services return plain objects or arrays (no wrapping)
- Route handlers respond via `res.json()` directly — no return value from route callbacks
- Async functions always return typed promises

## Module Design

**Exports:**
- Named exports used exclusively — no default exports in server/packages code
- UI components use named exports: `export function AgentProperties(...)`
- Service barrel via `server/src/services/index.ts` re-exports all services

**Service Pattern:**
```typescript
// Service factory pattern — takes db, returns object with methods
export function companyService(db: Db) {
  return {
    list: async () => { ... },
    getById: async (id: string) => { ... },
    update: async (id: string, data: ...) => { ... },
  };
}
```

**Route Factory Pattern:**
```typescript
// Route factory — takes db, returns Express Router
export function companyRoutes(db: Db) {
  const router = Router();
  const svc = companyService(db);
  router.get("/", async (req, res) => { ... });
  return router;
}
```

**Barrel Files:**
- `server/src/services/index.ts` — re-exports all service factories
- `server/src/routes/index.ts` — re-exports route factories
- `server/src/middleware/index.ts` — re-exports middleware
- `packages/*/src/index.ts` — package public surface

---

*Convention analysis: 2026-03-19*
