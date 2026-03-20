---
phase: 02-chat-api
plan: "01"
subsystem: chat-api
tags: [api, chat, express, zod, drizzle, live-events, heartbeat]
dependency_graph:
  requires: [01-data-schema/01-01]
  provides: [chat-threads-crud, chat-messages-crud, agent-wakeup-on-user-message, chat-live-events]
  affects: [server, packages/shared]
tech_stack:
  added: []
  patterns: [route-factory, chatService-factory, keyset-cursor-pagination, fire-and-forget-wakeup]
key_files:
  created:
    - packages/shared/src/validators/chat.ts
    - server/src/services/chat.ts
    - server/src/routes/chat.ts
  modified:
    - packages/shared/src/validators/index.ts
    - packages/shared/src/index.ts
    - packages/shared/src/constants.ts
    - server/src/routes/index.ts
    - server/src/app.ts
decisions:
  - "Import validators from @paperclipai/shared (not subpath) — main index explicitly re-exports all validators"
  - "List threads ordered asc by createdAt — consistent with message listing order"
  - "Re-export CreateThread/SendMessage types from shared/src/index.ts — required for TypeScript resolution at server build time"
metrics:
  duration: "~15 min"
  completed: "2026-03-19T05:31:49Z"
  tasks_completed: 3
  files_changed: 8
---

# Phase 02 Plan 01: Chat API Summary

**One-liner:** REST Chat API with 5 Express endpoints, Zod validators, cursor-paginated messages, fire-and-forget agent wakeup, and chat.message.created live events.

## What Was Built

A complete Chat REST API layer wired into the existing Paperclip server:

1. **Zod validators** (`packages/shared/src/validators/chat.ts`) — `createThreadSchema` (agentId + optional title) and `sendMessageSchema` (body 1-50000 chars). Exported through the shared validators index and the shared package main index.

2. **Chat service** (`server/src/services/chat.ts`) — `chatService(db)` factory with five DB query functions: `createThread`, `listThreads`, `getThread`, `createMessage`, and `listMessages`. The `listMessages` function uses a keyset cursor pattern identical to `issueService.listComments` — queries by `(createdAt, id)` composite key for stable pagination.

3. **Chat routes** (`server/src/routes/chat.ts`) — `chatRoutes(db)` factory returning an Express Router with all 5 endpoints:
   - `POST /companies/:companyId/chat/threads` — creates thread, returns 201
   - `GET /companies/:companyId/chat/threads` — lists threads filtered by actor (userId for board, agentId for agent)
   - `GET /chat/threads/:threadId/messages` — cursor-paginated messages with `nextCursor`
   - `POST /chat/threads/:threadId/messages` — inserts message, fires live event, conditionally wakes agent

4. **Constants update** — `"chat.message.created"` added to `LIVE_EVENT_TYPES` in `packages/shared/src/constants.ts`.

5. **App wiring** — `chatRoutes(db)` mounted in `server/src/app.ts` alongside existing route families.

## Key Links Verified

- `chatRoutes` uses `chatService(db)` factory (confirmed pattern)
- `validate(createThreadSchema)` middleware applied to thread creation
- `void heartbeat.wakeup(...)` fires only when `senderType === "user"` (prevents agent infinite loop)
- `publishLiveEvent({ type: "chat.message.created", ... })` fires on every message insert
- `assertCompanyAccess(req, thread.companyId)` verifies thread ownership before message reads/writes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Added chat validators to shared/src/index.ts**
- **Found during:** Task 3 (TypeScript compilation)
- **Issue:** `@paperclipai/shared` main index explicitly re-exports each validator by name. The new `createThreadSchema`, `sendMessageSchema`, `CreateThread`, `SendMessage` were added to `validators/index.ts` but not to `shared/src/index.ts`, causing TS2305 errors in the server.
- **Fix:** Added explicit re-exports to `packages/shared/src/index.ts` from `./validators/index.js`
- **Files modified:** `packages/shared/src/index.ts`
- **Commit:** adc650c

## Pre-existing Issues (Out of Scope)

The server package had pre-existing TypeScript errors in `src/routes/plugins.ts` and `src/services/plugin-*.ts` related to a missing `@paperclipai/plugin-sdk` module. These were present before this plan and are not caused by any changes here. Logged to deferred-items.

## Self-Check: PASSED

- [x] `packages/shared/src/validators/chat.ts` exists
- [x] `server/src/services/chat.ts` exists
- [x] `server/src/routes/chat.ts` exists
- [x] Commit dae778f: feat(02-chat-api-01): add Zod validators and chat.message.created live event type
- [x] Commit 0d63ac7: feat(02-chat-api-01): create chat service with DB query functions
- [x] Commit adc650c: feat(02-chat-api-01): create chat routes, wire into app, export from shared
- [x] `pnpm -C packages/shared exec tsc --noEmit` — clean
- [x] `pnpm -C server exec tsc --noEmit` — no errors in any chat files
