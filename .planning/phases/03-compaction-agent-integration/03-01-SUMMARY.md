---
phase: 03-compaction-agent-integration
plan: "01"
subsystem: compaction
tags: [compaction, anthropic-sdk, token-counting, db-schema, migration]
dependency_graph:
  requires: [02-chat-api]
  provides: [CompactionService, chatCompactionEvents schema, token-counting in chatService]
  affects: [server/src/services/chat.ts, packages/db/src/schema/index.ts]
tech_stack:
  added: ["@anthropic-ai/sdk"]
  patterns: [factory-function-service, audit-table, best-effort-token-counting]
key_files:
  created:
    - packages/db/src/schema/chat_compaction_events.ts
    - packages/db/src/migrations/0036_chat_compaction_events.sql
    - server/src/services/compaction.ts
  modified:
    - packages/db/src/schema/index.ts
    - server/src/services/chat.ts
    - server/package.json
decisions:
  - "Manual migration file over drizzle-kit generate — drizzle config requires built dist and live DB connection; manual SQL is equivalent and simpler"
  - "Best-effort token counting: countMessageTokens returns null on failure to avoid blocking message creation"
  - "toAnthropicMessages merges consecutive same-role messages to satisfy Anthropic alternating-role API constraint"
metrics:
  duration: "3 min"
  completed_date: "2026-03-19"
  tasks_completed: 3
  files_changed: 6
---

# Phase 3 Plan 01: Compaction Infrastructure Summary

JWT-free compaction infrastructure: chatCompactionEvents audit table, CompactionService with token counting and sliding-window prompt builder (55% threshold), and synchronous token counting wired into chatService.createMessage.

## What Was Built

### Task 1: Compaction Audit Table + Anthropic SDK
- Created `chatCompactionEvents` pgTable schema following existing schema conventions
- Added export to `packages/db/src/schema/index.ts`
- Created manual migration `0036_chat_compaction_events.sql`
- Installed `@anthropic-ai/sdk` in server package

### Task 2: CompactionService
- `countMessageTokens(body, model)`: calls `anthropicClient.messages.countTokens`, returns `null` on failure
- `buildThreadPrompt(threadId, model)`: loads all messages, sums token counts (uses `Math.ceil(body.length/4)` fallback for null tokenCount), checks 55% threshold, returns verbatim or compacted prompt
- `summarizeMessages`: uses `claude-haiku-3-5` with structured summarization system prompt
- `toAnthropicMessages`: maps senderType to Anthropic role, merges consecutive same-role messages
- Records compaction audit event in `chatCompactionEvents` on each compaction
- Stored DB messages are never modified or deleted — compaction is read-time only

### Task 3: Token Counting in chatService
- `chatService` factory accepts optional `compactionSvc` parameter (backward compatible)
- `createMessage` counts tokens synchronously after insert via `compactionSvc.countMessageTokens`
- Updates `tokenCount` column on message row if count succeeds
- Returns message with `tokenCount` populated (satisfies COMP-01)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**Note on migration generation:** Plan listed `pnpm --filter @paperclipai/db exec drizzle-kit generate` as primary with manual fallback. Used manual fallback because drizzle config requires `./dist/schema/*.js` (compiled output) and a live DB connection. Manual SQL produces identical schema.

## Verification Results

- `pnpm --filter @paperclipai/db exec tsc --noEmit` — PASS
- `ls packages/db/src/migrations/0036_*` — FOUND
- `grep "chatCompactionEvents" packages/db/src/schema/index.ts` — FOUND
- `grep "countMessageTokens" server/src/services/compaction.ts` — FOUND
- `grep "buildThreadPrompt" server/src/services/compaction.ts` — FOUND
- Server compaction.ts and chat.ts compile without new errors

## Commits

- `933675a` feat(03-01): add compaction audit table schema, migration, and install Anthropic SDK
- `8381ab0` feat(03-01): implement CompactionService with token counting and prompt builder
- `49297e7` feat(03-01): wire token counting into chatService.createMessage

## Self-Check: PASSED
