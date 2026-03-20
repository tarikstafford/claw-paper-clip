---
phase: 01-data-schema
plan: 01
subsystem: database
tags: [drizzle, postgres, uuid, bigint, migrations]

# Dependency graph
requires: []
provides:
  - chatThreads Drizzle table definition with companyId/agentId FKs and dual creator columns
  - chatMessages Drizzle table definition with threadId FK (cascade), processingStatus default "enqueued", telegramUpdateId unique index
  - SQL migration 0035_sloppy_lilith.sql for both tables
  - Schema barrel exports in packages/db/src/schema/index.ts
affects: [02-api-layer, 03-compaction, 04-ui, 05-telegram]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - text columns for status/type fields (no pgEnum) — avoids migration overhead for enum changes
    - bigint with mode:"number" for Telegram update IDs — avoids BigInt JS type friction
    - uniqueIndex on nullable telegramUpdateId — PostgreSQL UNIQUE indexes naturally skip NULLs allowing multiple NULL rows
    - onDelete cascade on chat_messages.thread_id — deleting a thread cleans up all messages automatically

key-files:
  created:
    - packages/db/src/schema/chat_threads.ts
    - packages/db/src/schema/chat_messages.ts
    - packages/db/src/migrations/0035_sloppy_lilith.sql
    - packages/db/src/migrations/meta/0035_snapshot.json
  modified:
    - packages/db/src/schema/index.ts

key-decisions:
  - "Use text columns for senderType and processingStatus instead of pgEnum — avoids ALTER TYPE migrations when adding new values"
  - "Use uniqueIndex (not unique constraint) for telegramUpdateId — PostgreSQL UNIQUE indexes skip NULLs, allowing multiple messages with no Telegram ID"
  - "onDelete cascade on chat_messages.thread_id — deleting a thread removes all its messages atomically"
  - "bigint mode:number for telegramUpdateId — Telegram IDs fit in JS safe integer range, avoids BigInt type friction in application code"

patterns-established:
  - "Pattern: text over pgEnum for status fields — easier to extend without schema migrations"
  - "Pattern: dual creator columns (creatorAgentId + creatorUserId) instead of a single polymorphic column"
  - "Pattern: uniqueIndex on nullable FK-adjacent columns for idempotency without blocking NULLs"

requirements-completed: [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05]

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 1 Plan 01: Data Schema Summary

**Drizzle ORM chat_threads and chat_messages tables with cascade FK, unique Telegram update ID index, and SQL migration 0035**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-19T00:00:00Z
- **Completed:** 2026-03-19T00:08:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `chat_threads` table with company/agent FKs, dual creator pattern, and two composite indexes
- Created `chat_messages` table with cascade delete, text-based status fields, and unique Telegram update ID index
- Generated SQL migration `0035_sloppy_lilith.sql` with all DDL, FK constraints, and indexes
- Exported both new tables from the schema barrel index

## Task Commits

Each task was committed atomically:

1. **Task 1: Create chat_threads and chat_messages schema files and export from index** - `1027e5a` (feat)
2. **Task 2: Generate Drizzle migration and verify SQL output** - `71823b4` (chore)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `packages/db/src/schema/chat_threads.ts` - chatThreads table with companyId, agentId, dual creator columns, title, timestamps, and two composite indexes
- `packages/db/src/schema/chat_messages.ts` - chatMessages table with threadId FK (cascade delete), senderType/sender IDs, body, tokenCount, processingStatus (default "enqueued"), telegramUpdateId (unique index), timestamps
- `packages/db/src/schema/index.ts` - Added export lines for chatThreads and chatMessages
- `packages/db/src/migrations/0035_sloppy_lilith.sql` - Generated SQL with CREATE TABLE, FKs, indexes
- `packages/db/src/migrations/meta/0035_snapshot.json` - Drizzle-kit migration snapshot
- `packages/db/src/migrations/meta/_journal.json` - Updated with new migration entry

## Decisions Made

- Used `text` columns for `senderType` and `processingStatus` instead of `pgEnum` — avoids ALTER TYPE migrations when adding new values and matches existing codebase pattern (e.g., issues.status, agentWakeupRequests.status)
- Used `uniqueIndex` (not unique constraint) for `telegramUpdateId` — PostgreSQL UNIQUE indexes natively skip NULLs, so multiple messages without a Telegram ID are allowed
- Used `bigint({ mode: "number" })` for `telegramUpdateId` — Telegram update IDs fit within JS safe integer range, avoiding BigInt type friction throughout the codebase
- Used `onDelete: "cascade"` on `chat_messages.thread_id` — thread deletion should clean up all its messages atomically

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both tables and the migration file are ready for Phase 2 (API layer)
- The migration must be applied to the database (via `pnpm migrate` with a valid DATABASE_URL) before Phase 2 API endpoints can be tested
- No blockers for Phase 2 planning

---
*Phase: 01-data-schema*
*Completed: 2026-03-19*
