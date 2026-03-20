# Testing Patterns

**Analysis Date:** 2026-03-19

## Test Framework

**Runner:**
- Vitest 3.x
- Root config: `vitest.config.ts` (workspace mode — projects array)
- Per-project configs: `server/vitest.config.ts`, `ui/vitest.config.ts`, `cli/vitest.config.ts`, `packages/adapters/opencode-local/vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`) — no separate assertion library

**E2E Framework:**
- Playwright 1.x for end-to-end browser tests
- Config: `tests/e2e/playwright.config.ts`

**HTTP Testing:**
- `supertest` for integration-level server route testing

**Run Commands:**
```bash
pnpm test              # Run all tests in watch mode (vitest workspace)
pnpm test:run          # Run all tests once (CI mode)
pnpm test:e2e          # Run Playwright E2E tests
pnpm test:e2e:headed   # Run Playwright E2E tests in headed mode
```

## Test File Organization

**Unit/Integration Tests — Server:**
- Location: `server/src/__tests__/` directory (separate from source)
- Naming: `{feature-name}.test.ts` (kebab-case)
- Examples: `server/src/__tests__/error-handler.test.ts`, `server/src/__tests__/costs-service.test.ts`

**Unit Tests — UI:**
- Location: Co-located with source files, same directory
- Naming: `{module-name}.test.ts` or `{module-name}.test.tsx`
- Examples: `ui/src/lib/inbox.test.ts`, `ui/src/components/transcript/RunTranscriptView.test.tsx`

**Unit Tests — Packages:**
- Location: Co-located with source files
- Examples: `packages/adapter-utils/src/billing.test.ts`, `packages/adapters/opencode-local/src/server/models.test.ts`

**E2E Tests:**
- Location: `tests/e2e/` directory
- Naming: `{feature}.spec.ts`
- Example: `tests/e2e/onboarding.spec.ts`

**Structure:**
```
server/
  src/
    __tests__/           # All server unit/integration tests
      costs-service.test.ts
      error-handler.test.ts
      ...
ui/
  src/
    lib/
      inbox.ts
      inbox.test.ts      # Co-located with source
    hooks/
      useCompanyPageMemory.ts
      useCompanyPageMemory.test.ts
    components/
      transcript/
        RunTranscriptView.tsx
        RunTranscriptView.test.tsx
packages/
  adapter-utils/
    src/
      billing.ts
      billing.test.ts    # Co-located
tests/
  e2e/
    onboarding.spec.ts
    playwright.config.ts
```

## Test Structure

**Suite Organization:**
```typescript
// Standard unit test structure — no setup needed
import { describe, expect, it } from "vitest";

describe("featureName", () => {
  it("does the expected thing when condition", () => {
    const result = functionUnderTest(input);
    expect(result).toEqual(expectedOutput);
  });
});
```

**With beforeEach reset:**
```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mock return values
  mockService.method.mockResolvedValue(defaultValue);
});

describe("feature suite", () => {
  it("specific behavior description", async () => {
    const app = createApp();
    const res = await request(app).get("/api/endpoint");
    expect(res.status).toBe(200);
  });
});
```

**Patterns:**
- `beforeEach` used to clear all mocks and reset return values — avoids state leakage between tests
- `afterEach` used for cleanup of real resources (temp files, git worktrees, runtime leases)
- Tests are named as readable sentences: `"accepts valid ISO date strings and passes them to cost summary routes"`
- Negative test names start with action verbs: `"rejects company budget updates for..."`, `"returns 400 for an invalid..."`

## Mocking

**Framework:** Vitest's built-in `vi.mock()` and `vi.hoisted()`

**Patterns:**

`vi.hoisted()` for module-level mock references (avoids temporal dead zone issues):
```typescript
const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  companyService: () => mockCompanyService,
}));
```

`vi.mock()` for module replacement — always at module scope, not inside `describe/it`:
```typescript
vi.mock("../services/agents.js", () => ({
  agentService: vi.fn(() => mockAgentService),
}));

vi.mock("../services/hire-hook.js", () => ({
  notifyHireApproved: mockNotifyHireApproved,
}));
```

Chained mock builders for Drizzle query chain mocking:
```typescript
function makeDb(overrides: Record<string, unknown> = {}) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn().mockResolvedValue([]),
  };
  return {
    select: vi.fn().mockReturnValue(thenableChain),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }),
    ...overrides,
  };
}
```

**What to Mock:**
- External service dependencies (database, other services)
- File system operations when testing at unit level
- Environment variables (`process.env.VAR = "..."` then clean up in `afterEach`)
- Time-sensitive operations

**What NOT to Mock:**
- The function or module under test itself
- Pure utility functions being tested directly
- Node.js built-ins when testing real behavior (e.g., `workspace-runtime.test.ts` runs real `git` commands)

## Fixtures and Factories

**Test Data Factory Pattern:**
All test files define local `make*` or `create*` factory functions returning fully-typed objects:

```typescript
// Minimal factories — only set what matters for the test
function makeApproval(status: Approval["status"]): Approval {
  return {
    id: `approval-${status}`,
    companyId: "company-1",
    type: "hire_agent",
    status,
    payload: {},
    // ... all required fields with sensible defaults
  };
}

function makeRun(id: string, status: HeartbeatRun["status"], createdAt: string, agentId = "agent-1"): HeartbeatRun {
  return { id, companyId: "company-1", agentId, status, createdAt: new Date(createdAt), ... };
}
```

**App Factory Pattern (server integration tests):**
```typescript
function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "board", userId: "board-user", source: "local_implicit" };
    next();
  });
  app.use("/api", costRoutes(makeDb() as any));
  app.use(errorHandler);
  return app;
}

// Variant for actor-specific tests
function createAppWithActor(actor: any) { ... }
```

**Location:**
- No shared fixture files — factories are defined locally within each test file
- Test data uses realistic but clearly fake IDs: `"company-1"`, `"agent-1"`, `"approval-1"`
- Dates use ISO strings with `new Date("2026-03-11T00:00:00.000Z")` pattern

## Coverage

**Requirements:** Not enforced — no coverage threshold configuration found in any vitest config

**View Coverage:**
```bash
pnpm vitest run --coverage  # Coverage not configured by default
```

## Test Types

**Unit Tests:**
- Scope: Pure functions, utility helpers, service logic
- Location: `packages/*/src/*.test.ts`, `ui/src/lib/*.test.ts`, `ui/src/hooks/*.test.ts`
- No external I/O; all dependencies mocked
- Examples: `billing.test.ts`, `inbox.test.ts`, `assignees.test.ts`, `redaction.test.ts`

**Integration Tests (Server):**
- Scope: Full Express route handlers wired with middleware and mocked services
- Location: `server/src/__tests__/*.test.ts`
- Uses `supertest` to make HTTP requests against a real Express app instance
- Mocks: services mocked via `vi.mock()`, real `errorHandler` middleware included
- Examples: `costs-service.test.ts`, `approvals-service.test.ts`, `companies-route-path-guard.test.ts`

**Integration Tests (File System):**
- Scope: Tests that require real filesystem or git operations
- Pattern: Create temp directories in `os.tmpdir()`, clean up in `afterEach`
- Example: `workspace-runtime.test.ts` creates real temp git repos

**E2E Tests:**
- Framework: Playwright (Chromium)
- Location: `tests/e2e/*.spec.ts`
- Runs against a real server instance started via `webServer` in `playwright.config.ts`
- Uses `page.request.get()` for API assertion alongside UI interactions
- Example: `tests/e2e/onboarding.spec.ts`

## Common Patterns

**Async Testing:**
```typescript
// Standard async/await — no done() callbacks
it("resolves when model is missing", async () => {
  await expect(
    ensureOpenCodeModelConfiguredAndAvailable({ model: "" }),
  ).rejects.toThrow("OpenCode requires `adapterConfig.model`");
});

// Resolved value assertion
it("returns empty list when unavailable", async () => {
  await expect(listOpenCodeModels()).resolves.toEqual([]);
});
```

**HTTP Route Testing with supertest:**
```typescript
it("returns 400 for an invalid 'from' date string", async () => {
  const app = createApp();
  const res = await request(app)
    .get("/api/companies/company-1/costs/summary")
    .query({ from: "not-a-date" });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/invalid 'from' date/i);
});
```

**Error Testing:**
```typescript
// Test that side-effects did NOT happen
expect(mockCompanyService.update).not.toHaveBeenCalled();

// Test specific call arguments
expect(mockFinanceService.list).toHaveBeenCalledWith("company-1", undefined, 25);

// Test error message patterns with regex
expect(res.body.error).toMatch(/invalid 'from' date/i);
```

**Environment Variable Testing:**
```typescript
afterEach(() => {
  delete process.env.PAPERCLIP_OPENCODE_COMMAND;
  resetOpenCodeModelsCacheForTests();  // cache reset exposed specifically for tests
});

it("handles missing command", async () => {
  process.env.PAPERCLIP_OPENCODE_COMMAND = "__paperclip_missing_opencode_command__";
  await expect(listOpenCodeModels()).resolves.toEqual([]);
});
```

**Browser API Mocking (UI tests):**
```typescript
// @vitest-environment node  (directive at file top)

// Define globalThis polyfills for localStorage, etc.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    clear: () => { storage.clear(); },
  },
  configurable: true,
});
```

**Component Rendering Tests (UI):**
```typescript
// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";

it("renders markdown correctly", () => {
  const html = renderToStaticMarkup(
    <ThemeProvider>
      <RunTranscriptView density="compact" entries={[...]} />
    </ThemeProvider>,
  );
  expect(html).toContain("<strong>world</strong>");
});
```

**Idempotency / Edge Case Testing:**
```typescript
// Test that repeated operations are no-ops
it("treats repeated approve retries as no-ops after another worker resolves the approval", async () => {
  const svc = approvalService(dbStub.db as any);
  const result = await svc.approve("approval-1", "board", "ship it");
  expect(result.applied).toBe(false);
  expect(mockAgentService.activatePendingApproval).not.toHaveBeenCalled();
});
```

---

*Testing analysis: 2026-03-19*
