---
phase: 05-telegram-integration
plan: 01
subsystem: api
tags: [telegram, dedup, zod, postgres, unique-constraint, 409]

# Dependency graph
requires:
  - phase: 01-data-schema
    provides: "chat_messages schema with telegramUpdateId bigint column and unique index"
  - phase: 02-chat-api
    provides: "sendMessageSchema, chatService.createMessage, POST /chat/threads/:threadId/messages route"
provides:
  - "sendMessageSchema with optional telegramUpdateId field"
  - "chatService.createMessage accepting and persisting telegramUpdateId"
  - "HTTP 409 on duplicate telegramUpdateId (Postgres 23505 unique constraint)"
  - "TELE-07 integration tests proving dedup behavior"
affects: [05-telegram-integration-02, 05-telegram-integration-03]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Catch Postgres 23505 to return 409 (unique constraint violation pattern)"]

key-files:
  created: []
  modified:
    - packages/shared/src/validators/chat.ts
    - server/src/services/chat.ts
    - server/src/routes/chat.ts
    - server/src/__tests__/chat-routes.test.ts

key-decisions:
  - "telegramUpdateId flows as optional on sendMessageSchema — backward-compatible; existing callers omit it and DB gets null"
  - "23505 detection in route handler (not service) keeps service layer generic and route responsible for HTTP semantics"
  - "publishLiveEvent and heartbeat wakeup only run after successful insert — 409 early-returns before those side effects"

patterns-established:
  - "Unique constraint 409 pattern: catch err with code===23505, return res.status(409).json({ error: ... }), re-throw otherwise"

requirements-completed: [TELE-01, TELE-07]

# Metrics
duration: 2min
completed: 2026-03-19
---

# Phase 5 Plan 01: Telegram Update ID Dedup API Summary

**telegramUpdateId wired through sendMessageSchema, chatService, and chat route with HTTP 409 on Postgres 23505 unique constraint violation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-19T18:20:11Z
- **Completed:** 2026-03-19T18:22:20Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `telegramUpdateId: z.number().int().optional()` to `sendMessageSchema` — type infers automatically via `z.infer`
- Updated `chatService.createMessage` to accept and insert `telegramUpdateId` into the DB — pre-existing unique index handles constraint enforcement
- Chat route extracts `telegramUpdateId` from request body, catches Postgres 23505 to return 409, re-throws anything else to global error handler
- Added 2 new TELE-07 integration tests: 201 on first send with telegramUpdateId, 409 on duplicate — all 30 chat-route tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add telegramUpdateId to sendMessageSchema and wire through chatService** - `349143b` (feat)
2. **Task 2: Add 409 dedup handling in chat route and integration test for TELE-07** - `9faba84` (feat)

## Files Created/Modified

- `packages/shared/src/validators/chat.ts` - Added optional `telegramUpdateId` integer field to `sendMessageSchema`
- `server/src/services/chat.ts` - Updated `createMessage` data type and `.values()` to include `telegramUpdateId`
- `server/src/routes/chat.ts` - Extracts `telegramUpdateId` from body; try/catch 23505 → 409; side-effects only on success
- `server/src/__tests__/chat-routes.test.ts` - Added TELE-07 describe block with 201 and 409 test cases

## Decisions Made

- `telegramUpdateId` flows as optional on `sendMessageSchema` — backward-compatible; existing callers omit it and DB gets null
- 23505 detection in route handler (not service) keeps service layer generic and route responsible for HTTP semantics
- `publishLiveEvent` and heartbeat wakeup only run after successful insert — 409 early-returns before those side effects

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in `server/src/routes/plugins.ts` and plugin-sdk service files caused `tsc --noEmit -p server/tsconfig.json` to fail. These errors are unrelated to this plan's changes (all in `@paperclipai/plugin-sdk` imports that don't resolve). No errors in the files we modified. Logged as out-of-scope.

## Next Phase Readiness

- Plan 02 (bot migration) can now pass `telegramUpdateId` on message creation and rely on 409 for dedup
- The unique index was already in place from Plan 01-01; this plan completes the API-layer wiring
- No blockers for Plan 02

## Self-Check: PASSED

- FOUND: packages/shared/src/validators/chat.ts
- FOUND: server/src/services/chat.ts
- FOUND: server/src/routes/chat.ts
- FOUND: server/src/__tests__/chat-routes.test.ts
- FOUND: .planning/phases/05-telegram-integration/05-01-SUMMARY.md
- FOUND: commit 349143b (feat(05-01): add telegramUpdateId to sendMessageSchema and chatService)
- FOUND: commit 9faba84 (feat(05-01): add 409 dedup handling for telegramUpdateId in chat route)

---
*Phase: 05-telegram-integration*
*Completed: 2026-03-19*
