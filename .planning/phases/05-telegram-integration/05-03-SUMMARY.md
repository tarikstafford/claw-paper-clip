---
phase: 05-telegram-integration
plan: 03
subsystem: testing
tags: [vitest, telegram, unit-tests, mocking, bot]

# Dependency graph
requires:
  - phase: 05-telegram-integration/05-02
    provides: "Rewritten paperclip.ts, telegram.ts, conversation-manager.ts, app.ts with chat API integration"

provides:
  - "Vitest configuration for telegram-bot service"
  - "Unit tests covering all 7 TELE requirements (TELE-01 through TELE-07)"
  - "telegram-bot included in root vitest projects array for CI"

affects:
  - CI pipelines
  - future telegram-bot changes

# Tech tracking
tech-stack:
  added:
    - "vitest ^3.0.5 (devDependency in telegram-bot)"
  patterns:
    - "vi.stubEnv before dynamic import to bypass top-level throw guards"
    - "vi.stubGlobal('fetch', vi.fn()) for mocking global fetch in Node ESM"
    - "vi.mock with factory for all module dependencies before import"
    - "Fastify inject() for HTTP testing without supertest"

key-files:
  created:
    - services/telegram-bot/vitest.config.ts
    - services/telegram-bot/src/__tests__/paperclip.test.ts
    - services/telegram-bot/src/__tests__/telegram.test.ts
    - services/telegram-bot/src/__tests__/conversation-manager.test.ts
    - services/telegram-bot/src/__tests__/app.test.ts
  modified:
    - services/telegram-bot/package.json
    - vitest.config.ts

key-decisions:
  - "vi.stubEnv + dynamic import pattern used for modules with top-level throw guards on missing env vars — avoids need for vi.mock of entire module"
  - "vi.stubGlobal('fetch', vi.fn()) placed at top-level before any module import to intercept both module-level fetch calls (app.ts bot username resolution) and function-level calls"
  - "Fastify inject() used for HTTP testing rather than supertest — built into Fastify, no extra dependency needed"

patterns-established:
  - "ESM module with top-level env guards: use vi.stubEnv before dynamic import() to set env before module evaluation"
  - "app.ts module-level side effects (fetch calls): mock global fetch at file top before any imports to prevent real network calls in tests"

requirements-completed: [TELE-01, TELE-02, TELE-03, TELE-04, TELE-05, TELE-06, TELE-07]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 5 Plan 03: Telegram Bot Tests Summary

**Vitest unit test suite covering all 7 TELE requirements across 4 test files (32 tests), using vi.stubEnv + dynamic import pattern for top-level throw guards**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-19T18:29:01Z
- **Completed:** 2026-03-19T18:33:56Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Configured vitest for the telegram-bot service (vitest.config.ts, devDependency, test script) and added it to root projects array
- Created paperclip.test.ts (9 tests): TELE-01 (createChatThread, postChatMessage, getNewMessages API calls with auth headers) and TELE-07 (409 dedup returns 'duplicate', 500 throws)
- Created telegram.test.ts (9 tests): TELE-05 (formatForTelegramHtml conversions for bold/italic/code/headings/hr removal, sendMessage with parse_mode HTML and retry on parse error)
- Created conversation-manager.test.ts (8 tests): TELE-03 (auto-create thread on first message, reuse existing, reset on empty threadId) and TELE-06 (agent message forwarding, user message filtering, updateLastSeen, threadless conversation skip)
- Created app.test.ts (6 tests): TELE-02 (immediate 200 while handleBoardMessage promise pending) and TELE-04 (/new clears threadId to '' and lastSeenMessageId to null)

## Task Commits

Each task was committed atomically:

1. **Task 1: Set up vitest and create paperclip + telegram tests** - `eeb00ac` (feat)
2. **Task 2: Create conversation-manager and app tests** - `09e7b33` (feat)

## Files Created/Modified

- `services/telegram-bot/vitest.config.ts` - Vitest config for telegram-bot service
- `services/telegram-bot/package.json` - Added vitest devDependency and test script
- `vitest.config.ts` - Added "services/telegram-bot" to projects array
- `services/telegram-bot/src/__tests__/paperclip.test.ts` - TELE-01 and TELE-07 tests
- `services/telegram-bot/src/__tests__/telegram.test.ts` - TELE-05 tests
- `services/telegram-bot/src/__tests__/conversation-manager.test.ts` - TELE-03 and TELE-06 tests
- `services/telegram-bot/src/__tests__/app.test.ts` - TELE-02 and TELE-04 tests

## Decisions Made

- **vi.stubEnv + dynamic import:** paperclip.ts and telegram.ts have top-level `throw new Error(...)` guards for missing env vars. The solution is `vi.stubEnv(...)` calls at file top-level followed by `await import(...)` inside the test file — env vars are set before module evaluation.
- **vi.stubGlobal('fetch') at file top:** app.ts calls `fetch(...)` at module load time to resolve bot username. Stubbing fetch globally before any imports prevents real network calls and prevents test failures on module initialization.
- **Fastify inject() for HTTP testing:** No supertest needed — Fastify has a built-in `inject()` method that handles the full request/response lifecycle without starting a real HTTP server.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Telegram URL assertion in telegram.test.ts**
- **Found during:** Task 1 (telegram.test.ts)
- **Issue:** Test asserted URL contained `/bot test-bot-token/sendMessage` (with space) but the actual URL is `/bottest-bot-token/sendMessage` (no space — `bot` is a prefix, not a path segment)
- **Fix:** Corrected assertion to check for `/bottest-bot-token/sendMessage`
- **Files modified:** services/telegram-bot/src/__tests__/telegram.test.ts
- **Verification:** Test passed after fix
- **Committed in:** eeb00ac (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test assertion)
**Impact on plan:** Minor test correction, no scope change.

## Issues Encountered

A pre-existing test failure exists in `server/src/__tests__/plugin-worker-manager.test.ts` (missing `@paperclipai/plugin-sdk` package entry). This is unrelated to our changes and pre-dates this plan. Deferred to `deferred-items.md` for visibility.

## Next Phase Readiness

- All 7 TELE requirements have automated test coverage
- telegram-bot is included in CI via root vitest.config.ts projects array
- Phase 5 (telegram-integration) is complete

---
*Phase: 05-telegram-integration*
*Completed: 2026-03-20*
