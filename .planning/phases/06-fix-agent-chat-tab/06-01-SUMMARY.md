---
phase: 06-fix-agent-chat-tab
plan: 01
subsystem: chat
tags: [chat, agent-detail, real-time, server-filter, query-invalidation]
dependency-graph:
  requires: []
  provides: [server-side-agentId-filter, threadsByAgent-realtime-invalidation]
  affects: [ui/AgentDetail, server/chat-routes, server/chat-service, ui/LiveUpdatesProvider]
tech-stack:
  added: []
  patterns: [server-side-filtering, react-query-invalidation, query-string-param]
key-files:
  created: []
  modified:
    - server/src/services/chat.ts
    - server/src/routes/chat.ts
    - ui/src/api/chat.ts
    - ui/src/pages/AgentDetail.tsx
    - ui/src/context/LiveUpdatesProvider.tsx
    - server/src/__tests__/chat-routes.test.ts
decisions:
  - agentId filter is exclusive — when agentId is truthy it skips creatorUserId/creatorAgentId conditions entirely
  - agent callers always use creatorAgentId regardless of agentId query param (only board callers can use agentId param)
  - threadsByAgent invalidation is belt-and-suspenders alongside threads(companyId) prefix match
metrics:
  duration: 15 min
  completed: "2026-03-20"
  tasks: 2
  files: 6
---

# Phase 6 Plan 1: Fix Agent Chat Tab — Server-Side Filter and Real-Time Updates Summary

Server-side agentId filter on GET threads endpoint with explicit threadsByAgent React Query cache invalidation on chat.message.created WebSocket events.

## What Was Built

### Task 1: Server-side agentId filter + live event agentId payload

**server/src/services/chat.ts** — Extended `listThreads` filters to accept `agentId?: string`. When `filters.agentId` is truthy, pushes `eq(chatThreads.agentId, filters.agentId)` into conditions and skips the `creatorUserId`/`creatorAgentId` else-if chain entirely.

**server/src/routes/chat.ts** — GET threads handler now extracts `agentIdFilter` from `req.query.agentId` (board callers only). Passes it to `svc.listThreads` with the exclusion logic (`creatorUserId` only set when `!agentIdFilter`). Also added `agentId: thread.agentId` to the `publishLiveEvent` payload in the POST messages handler.

**ui/src/api/chat.ts** — `listThreads` now accepts optional `opts?: { agentId?: string }` and appends `?agentId=...` query string when provided.

**ui/src/pages/AgentDetail.tsx** — `AgentChatTab` `queryFn` changed from `chatApi.listThreads(companyId).then(ts => ts.filter(t => t.agentId === agentId))` to `chatApi.listThreads(companyId, { agentId })`. Client-side filter removed.

**ui/src/context/LiveUpdatesProvider.tsx** — `chat.message.created` handler now reads `agentId` from the event payload and calls `queryClient.invalidateQueries({ queryKey: queryKeys.chat.threadsByAgent(expectedCompanyId, agentId) })` inside the `expectedCompanyId` guard.

### Task 2: New test cases for agentId query param behavior

**server/src/__tests__/chat-routes.test.ts** — Added three new test cases to the GET threads describe block:

1. `UI-02: board user with agentId param receives all threads for that agent` — verifies `svc.listThreads` called with `{ agentId: AGENT_UUID }` and `creatorUserId: undefined`
2. `UI-02: board user without agentId param still receives own threads only (no regression)` — verifies `{ creatorUserId: USER_ID }` and `agentId: undefined`
3. `UI-02: agent caller ignores agentId query param` — verifies agent caller always uses `{ creatorAgentId: AGENT_ID }` regardless of query param

## Test Results

- 33 tests total (30 original + 3 new): all pass
- No TypeScript errors in modified files

## Findings Closed

- **FINDING-01** (scope gap: client-side filter hides other users' threads) — Resolved by moving filter to server-side with `agentId` query param
- **FINDING-02** (real-time gap: threadsByAgent query key not invalidated on new messages) — Resolved by adding `agentId` to live event payload and explicit `threadsByAgent` invalidation in LiveUpdatesProvider

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] server/src/services/chat.ts modified
- [x] server/src/routes/chat.ts modified
- [x] ui/src/api/chat.ts modified
- [x] ui/src/pages/AgentDetail.tsx modified
- [x] ui/src/context/LiveUpdatesProvider.tsx modified
- [x] server/src/__tests__/chat-routes.test.ts modified with 3 new test cases
- [x] Task 1 commit: a4f5a10
- [x] Task 2 commit: 1343030
