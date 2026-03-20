# Codebase Concerns

**Analysis Date:** 2026-03-19

## Tech Debt

**Unshipped Experimental Worktree UI (Scattered Feature Flag):**
- Issue: `SHOW_EXPERIMENTAL_ISSUE_WORKTREE_UI = false` is copy-pasted as a module-level constant in four separate files with no central feature flag system. The guarded code and associated logic still ships in the bundle.
- Files: `ui/src/adapters/runtime-json-fields.tsx`, `ui/src/components/IssueProperties.tsx`, `ui/src/components/NewIssueDialog.tsx`, `ui/src/components/ProjectProperties.tsx`
- Impact: Dead code is shipped in the production bundle. When the feature is ready, four files must be updated individually, increasing the risk of partial enablement. Business logic relying on the flag (e.g. `executionWorkspacePolicy` calculation in `NewIssueDialog.tsx`) runs with a null result and adds conditional complexity throughout.
- Fix approach: Introduce a single feature flag module or environment variable. Remove the guarded code paths entirely until the feature is production-ready, or centralize behind a shared constant with a single import.

**`any` Types in Core Server Services:**
- Issue: Server-side service functions accept `dbOrTx: any` instead of a typed union of `Db | Transaction`, bypassing type safety on the most critical data layer.
- Files: `server/src/services/issues.ts` (lines 236, 257, 273, 359, 374), `server/src/services/projects.ts` (line 295), `server/src/services/finance.ts` (line 13), `server/src/routes/access.ts` (line 1517), `server/src/index.ts` (line 174)
- Impact: Drizzle ORM type errors caused by wrong db/tx arguments will surface only at runtime. Refactors to the DB layer will not produce compile-time feedback.
- Fix approach: Extract a `DbOrTx` union type from Drizzle's inferred transaction type and replace all `any` parameters.

**`(res as any)` in Error Handler:**
- Issue: `server/src/middleware/error-handler.ts` attaches error context to the response object by casting to `any` rather than extending the Express `Response` type.
- Files: `server/src/middleware/error-handler.ts` (lines 20, 29)
- Impact: The error context attachment is untyped and invisible to TypeScript. If the property name changes, the logger middleware will silently lose structured error context.
- Fix approach: Extend the Express `Response` interface in `server/src/types/express.d.ts` to include `__errorContext` and `err` properties.

**`(Ajv as any).default` and `(addFormats as any).default` Workarounds:**
- Issue: The plugin config validator uses double `any` casts to work around ESM/CJS interop issues with `ajv` and `ajv-formats`.
- Files: `server/src/services/plugin-config-validator.ts` (lines 31–36)
- Impact: If the package export shapes change on upgrade, the validator silently gets an undefined constructor and throws at runtime with an opaque error.
- Fix approach: Use the correct ESM import path or add an explicit `import type` check. Alternatively, pin the workaround behind a typed helper with a clear comment.

**`eslint-disable react-hooks/exhaustive-deps` Suppressions:**
- Issue: Eight `useEffect` dependency arrays are intentionally incomplete and have the exhaustive-deps rule disabled inline rather than being refactored.
- Files: `ui/src/pages/IssueDetail.tsx` (lines 577, 586), `ui/src/pages/NewAgent.tsx` (line 109), `ui/src/pages/GoalDetail.tsx` (line 111), `ui/src/plugins/bridge.ts` (line 297), `ui/src/plugins/launchers.tsx` (line 625), `ui/src/components/AgentConfigForm.tsx` (line 205), `ui/src/hooks/useDateRange.ts` (line 104)
- Impact: Each suppressed case is a potential stale-closure bug. The `IssueDetail.tsx` case suppresses `openPanel`, `closePanel`, and `updateIssue` from the dependency array, meaning panel content may not reflect updated issue data.
- Fix approach: Audit each case individually. The `IssueDetail.tsx` panel effect should wrap `openPanel` and `closePanel` in `useCallback` and include them as deps. The `AgentConfigForm.tsx` effect should use a ref to avoid the dependency on the agent object identity.

**Mega-Files with Multiple Responsibilities:**
- Issue: Several files exceed 1,000 lines, combining data-fetching, state management, and rendering in a single component.
- Files: `ui/src/pages/AgentDetail.tsx` (2,511 lines), `ui/src/components/AgentConfigForm.tsx` (1,415 lines), `ui/src/components/OnboardingWizard.tsx` (1,373 lines), `ui/src/components/NewIssueDialog.tsx` (1,346 lines), `server/src/services/heartbeat.ts` (3,179 lines), `server/src/routes/access.ts` (2,647 lines), `server/src/routes/plugins.ts` (2,219 lines)
- Impact: Changes to any one feature within these files require reading thousands of lines of context. Test coverage is harder to scope. `heartbeat.ts` in particular is the most critical runtime service and the largest file.
- Fix approach: Extract sub-components from page-level components. Split `heartbeat.ts` into `heartbeat-start.ts`, `heartbeat-run.ts`, and `heartbeat-schedule.ts`. Split `access.ts` routes by resource type.

**`DesignGuide` and `RunTranscriptUxLab` Pages Shipped in Production Bundle:**
- Issue: Two development/testing UI pages (`/design-guide` and `/tests/ux/runs`) are registered as public routes with no authentication guard or environment check.
- Files: `ui/src/App.tsx` (lines 158–159), `ui/src/pages/DesignGuide.tsx`, `ui/src/pages/RunTranscriptUxLab.tsx`
- Impact: Any user with the URL can access these pages in production. The design guide page imports many UI components increasing bundle size.
- Fix approach: Wrap the routes in an environment check (`import.meta.env.DEV`) or remove them from the production router entirely.

---

## Security Considerations

**Hardcoded Fallback Auth Secret:**
- Risk: `server/src/auth/better-auth.ts` falls back to the string `"paperclip-dev-secret"` if neither `BETTER_AUTH_SECRET` nor `PAPERCLIP_AGENT_JWT_SECRET` is set. This secret signs all session cookies and JWTs.
- Files: `server/src/auth/better-auth.ts` (line 70)
- Current mitigation: The fallback only activates when both env vars are missing. Local development defaults use this path.
- Recommendations: Add a startup assertion that fails loudly in `authenticated` deployment mode if neither env var is set. The `doctor` command in `cli/src/commands/doctor.ts` should include this check.

**Node.js VM Sandbox for Plugin Workers:**
- Risk: The plugin sandbox in `server/src/services/plugin-runtime-sandbox.ts` uses `vm.runInContext` which is not a security boundary. Node.js documentation explicitly states this is not safe for untrusted code. A plugin can escape the VM context using well-known techniques.
- Files: `server/src/services/plugin-runtime-sandbox.ts`
- Current mitigation: Plugins also run in a separate child process via `PluginWorkerManager`, which provides actual OS-level isolation. The VM sandbox is only used for the initial module load phase; the RPC dispatch happens over stdio between processes.
- Recommendations: Clarify in code comments that the VM is not the security boundary — the child process is. Consider whether the VM sandbox adds meaningful protection beyond the process isolation, or whether it should be removed to reduce complexity.

**`permissionKey: any` in Access Route:**
- Risk: `assertCompanyPermission` in `server/src/routes/access.ts` accepts `permissionKey: any`, meaning arbitrary strings can be passed through to the permission check. A typo in a permission key will not produce a compile-time error and may silently result in incorrect access decisions.
- Files: `server/src/routes/access.ts` (line 1517)
- Current mitigation: The permission keys are validated at the data layer via `PERMISSION_KEYS` from `@paperclipai/shared`.
- Recommendations: Type `permissionKey` as `(typeof PERMISSION_KEYS)[number]` to enforce correct values at call sites.

**Email Verification Disabled:**
- Risk: `requireEmailVerification: false` in the better-auth configuration means users can register with any email address without verifying ownership.
- Files: `server/src/auth/better-auth.ts` (line 91)
- Current mitigation: In `local_trusted` mode, authentication is bypassed entirely. In `authenticated` mode, sign-up can be restricted via `disableSignUp` config.
- Recommendations: This is a known product decision but should be re-evaluated if open instance registration is ever enabled.

**`globalThis.__paperclipPluginBridge__` Global Pollution:**
- Risk: React and React DOM are registered on a global variable, making them accessible to any code running in the page including third-party scripts.
- Files: `ui/src/plugins/bridge-init.ts`, `ui/src/plugins/slots.tsx`
- Current mitigation: This is an intentional design for the plugin architecture. Plugins are first-party controlled.
- Recommendations: Consider scoping the bridge to a Symbol key rather than a string to reduce the likelihood of accidental collision.

---

## Performance Bottlenecks

**Broad Query Invalidation on Live Events:**
- Problem: `invalidateHeartbeatQueries` in `LiveUpdatesProvider` invalidates 6+ query keys on every heartbeat event, including `costs`, `dashboard`, and `sidebarBadges`. Every active tab in the browser refetches these on every agent run update.
- Files: `ui/src/context/LiveUpdatesProvider.tsx` (lines 331–348)
- Cause: Defensive broad invalidation was chosen over targeted cache updates.
- Improvement path: Move to optimistic cache writes for known entity changes. Only invalidate aggregate queries (costs, dashboard) when the run reaches a terminal status.

**`startLocksByAgent` Module-Level In-Process Map:**
- Problem: Concurrent-run prevention is implemented as a module-level `Map<string, Promise<void>>` in `heartbeat.ts`. This works correctly for a single process but provides no cross-process coordination.
- Files: `server/src/services/heartbeat.ts` (line 50)
- Cause: Simpler than a distributed lock.
- Improvement path: If the server is ever horizontally scaled, this lock must be replaced with a database-backed advisory lock (Postgres `pg_advisory_lock`) or a Redis lock. The current design limits horizontal scaling.

**`embedded-postgres` Beta Dependency:**
- Problem: Both `server` and `cli` depend on `embedded-postgres@^18.1.0-beta.16`, a pre-release version. The package bundles a Postgres binary that must be downloaded per platform.
- Files: `server/package.json` (line 57), `cli/package.json` (line 51)
- Cause: The stable release may not support the required features.
- Improvement path: Monitor for a stable release and migrate. The beta version introduces installation reliability risk in CI and production environments on uncommon platforms.

**Plugin Stream Events Accumulate in Memory:**
- Problem: `usePluginStream` in `bridge.ts` appends all received events to a `useState` array without any cap or eviction policy. Long-running plugin streams accumulate unboundedly.
- Files: `ui/src/plugins/bridge.ts` (lines 398–399, 438–441)
- Cause: Simple initial implementation.
- Improvement path: Add a `maxEvents` option (defaulting to e.g. 200) that slices the array on append, or switch to only exposing `lastEvent` for use cases that don't need history.

---

## Fragile Areas

**`heartbeat.ts` — Critical Path with No Unit Tests:**
- Files: `server/src/services/heartbeat.ts` (3,179 lines)
- Why fragile: The heartbeat service contains the core agent run lifecycle — scheduling, execution, session management, cost accounting, and workspace provisioning. At 3,179 lines it is the largest file. Tests exist for specific sub-behaviours (`heartbeat-run-summary.test.ts`, `heartbeat-workspace-session.test.ts`, `issues-checkout-wakeup.test.ts`) but there are no integration tests covering the full `wakeup → execute → finalize` path.
- Safe modification: Changes to `wakeup()`, `executeRun()`, or `finalizeRun()` should be accompanied by a test that fakes the adapter and verifies the DB state transitions.
- Test coverage: Partial — surface-level behaviours tested, core execution flow untested end-to-end.

**Plugin Worker Manager — Backpressure and RPC Timeout:**
- Files: `server/src/services/plugin-worker-manager.ts`
- Why fragile: Pending RPC requests are tracked in a `Map<string | number, PendingRequest>` (line 378). If a plugin worker crashes mid-request, the caller's Promise hangs until `DEFAULT_RPC_TIMEOUT_MS` (30 seconds) elapses. There is no explicit backpressure mechanism if a plugin processes requests slowly.
- Safe modification: Always pass an explicit `timeoutMs` when calling `callWorker`. Do not assume the default is appropriate for user-facing request paths.
- Test coverage: `plugin-worker-manager.test.ts` covers startup and crash recovery but not timeout edge cases.

**`LiveUpdatesProvider` WebSocket Reconnect State:**
- Files: `ui/src/context/LiveUpdatesProvider.tsx`
- Why fragile: The reconnect logic manages `reconnectTimer`, `socket`, and `closed` state variables inside a `useEffect` closure. The `pushToast` function is a dependency but is recreated on each render of `ToastContext`, potentially causing the WebSocket to reconnect on every toast. The `pushToast` reference instability is mitigated by the `useCallback` in `ToastContext` but any change to the toast context shape could silently break reconnect stability.
- Safe modification: Extract the WebSocket lifecycle into a standalone hook with explicit stable dependency refs. Add a reconnect counter to the dependency array explicitly rather than relying on closure capture.
- Test coverage: No tests for the WebSocket provider.

**`usePluginData` ESLint Suppression:**
- Files: `ui/src/plugins/bridge.ts` (line 297)
- Why fragile: The dependency array for the `usePluginData` effect includes `paramsKey` (a serialized string) but the suppression comment also hides any new dependencies added during future refactors. The `params` object reference is deliberately excluded and replaced by the serialized key, but this is non-obvious and the suppression makes it invisible to future contributors.
- Safe modification: Replace the suppression with an explicit `useRef` to hold the params, or document the intentional exclusion inline.

---

## Scaling Limits

**Single-Process Run Concurrency Lock:**
- Current capacity: One server process, in-memory `startLocksByAgent` map
- Limit: Horizontal scaling (running multiple server instances behind a load balancer) will result in the same agent being started concurrently on different nodes.
- Scaling path: Add a Postgres advisory lock keyed by agent ID, or a Redis-based distributed lock. The database-level `idempotencyKey` on wakeup requests partially mitigates duplicate runs but does not prevent concurrent starts.

**In-Process Plugin Rate Limiter:**
- Current capacity: Single process, `Map<string, number[]>` rate limiter per plugin secrets handler instance
- Limit: Rate limits reset on server restart and are not shared across horizontal replicas.
- Scaling path: Move rate limit state to the database (a `plugin_rate_limits` table with timestamps) or to Redis.

---

## Dependencies at Risk

**`embedded-postgres@^18.1.0-beta.16`:**
- Risk: Pre-release dependency used in production for database bootstrap. The `^` range allows automatic upgrades to breaking beta versions.
- Impact: Database initialization could break on next install if the beta API changes.
- Migration plan: Pin to the exact beta version (`18.1.0-beta.16`) to prevent auto-upgrade, and actively monitor for a stable release.

**`hermes-paperclip-adapter@0.1.1` (Pinned, No `^`):**
- Risk: Exact pin with no caret — the adapter is frozen at a specific version and will not receive bug fixes automatically.
- Impact: If `hermes-paperclip-adapter` publishes security fixes, the server will not receive them without a manual bump.
- Migration plan: Review the adapter's changelog on each release cycle and manually update.

**`better-auth@1.4.18` (Pinned):**
- Risk: Auth library pinned at an exact version. Session handling is security-critical and the library is relatively new.
- Impact: Security patches require a deliberate upgrade step.
- Migration plan: Add `better-auth` to a regular dependency audit process.

---

## Test Coverage Gaps

**No Tests for `LiveUpdatesProvider` WebSocket Behavior:**
- What's not tested: WebSocket connection lifecycle, reconnect backoff, toast deduplication, and query invalidation routing.
- Files: `ui/src/context/LiveUpdatesProvider.tsx`
- Risk: Regressions in real-time updates are invisible until manual QA.
- Priority: High

**No Tests for `AgentDetail` Page:**
- What's not tested: The largest UI file (2,511 lines) has no associated test file. Tab switching, run display, key management, and config form integration are all untested.
- Files: `ui/src/pages/AgentDetail.tsx`
- Risk: Regressions in core agent management UX go undetected.
- Priority: High

**No Tests for `OnboardingWizard`:**
- What's not tested: The multi-step onboarding flow (adapter selection, company creation, goal creation) has no test coverage.
- Files: `ui/src/components/OnboardingWizard.tsx`
- Risk: Breakage in the onboarding flow is the worst first-time user experience failure.
- Priority: High

**No Integration Tests for the Full Heartbeat Execution Path:**
- What's not tested: `heartbeat.wakeup() → executeRun() → finalizeRun()` as a unit. Individual sub-functions are tested but not composed.
- Files: `server/src/services/heartbeat.ts`
- Risk: A regression in run state transitions (e.g. a run stuck in `running` on error) would not be caught before deployment.
- Priority: High

**Minimal UI Component Tests:**
- What's not tested: Only one component has a test (`RunTranscriptView.test.tsx`). `NewIssueDialog`, `IssueProperties`, `AgentConfigForm`, `JsonSchemaForm`, and `OnboardingWizard` are untested.
- Files: `ui/src/components/`
- Risk: Component regressions require manual UI testing to detect.
- Priority: Medium

---

*Concerns audit: 2026-03-19*
