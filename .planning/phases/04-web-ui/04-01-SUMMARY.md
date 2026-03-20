---
phase: 04-web-ui
plan: "01"
subsystem: ui
tags: [react, tanstack-query, drizzle-orm, websocket, typescript]

# Dependency graph
requires:
  - phase: 02-chat-api
    provides: chat HTTP endpoints (listThreads, listMessages, createMessage, createThread)
  - phase: 03-compaction-agent-integration
    provides: chat.message.created WebSocket event published on message send
provides:
  - lastMessage field on each chatThread in listThreads API response
  - ui/src/api/chat.ts chatApi with all 4 HTTP methods and TypeScript types
  - queryKeys.chat.threads / threadsByAgent / messages for cache management
  - /chat and /chat/:threadId routes in boardRoutes and unprefixed redirects
  - Chat sidebar nav item with MessageSquare icon
  - chat.message.created WebSocket handler with dual query invalidation
affects: [04-web-ui plan 02 and beyond — all chat UI components depend on these contracts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "chatApi pattern: thin wrapper around api.get/post, exporting typed interfaces + object with named methods"
    - "Dual cache invalidation on WebSocket event: invalidate both messages(threadId) and threads(companyId)"
    - "lastMessage via in-memory Map deduplication after desc-ordered query (avoids lateral join complexity)"

key-files:
  created:
    - ui/src/api/chat.ts
    - ui/src/pages/Chat.tsx
  modified:
    - server/src/services/chat.ts
    - ui/src/lib/queryKeys.ts
    - ui/src/App.tsx
    - ui/src/components/Sidebar.tsx
    - ui/src/context/LiveUpdatesProvider.tsx

key-decisions:
  - "lastMessage fetched via second query + in-memory Map deduplication — avoids complex lateral join SQL, efficient for expected small thread counts"
  - "Chat nav item placed inside SidebarSection Work after Issues — groups task and communication tools together"
  - "Placeholder Chat page exports named function for TypeScript route compilation — real implementation deferred to Plan 02"

patterns-established:
  - "Dual invalidation pattern: chat.message.created invalidates both messages(threadId) AND threads(companyId) to keep sidebar thread list fresh"

requirements-completed: [UI-01, UI-04, UI-06]

# Metrics
duration: 7min
completed: 2026-03-19
---

# Phase 4 Plan 01: Chat UI Foundation Summary

**Server enriches thread list with lastMessage preview; UI ships chatApi module, query keys, /chat routes, sidebar nav item, and real-time dual cache invalidation for chat.message.created events**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-19T09:04:44Z
- **Completed:** 2026-03-19T09:05:05Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Server listThreads now attaches `lastMessage: { body, senderType, createdAt } | null` to each thread without schema changes
- Created `ui/src/api/chat.ts` with `chatApi` object (listThreads, createThread, listMessages, sendMessage) and full TypeScript type exports
- Added `queryKeys.chat.threads`, `queryKeys.chat.threadsByAgent`, `queryKeys.chat.messages` following existing pattern
- Registered `/chat` and `/chat/:threadId` routes in both boardRoutes and unprefixed redirect section of App.tsx
- Added Chat nav item with MessageSquare icon to Sidebar Work section after Issues
- Wired `chat.message.created` WebSocket handler in LiveUpdatesProvider with dual invalidation (messages + threads)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add lastMessage to server listThreads response** - `c467553` (feat)
2. **Task 2: Create UI chat API module and query keys** - `09ca7df` (feat)
3. **Task 3: Wire routes, sidebar nav, and WebSocket chat handler** - `524f9d7` (feat)

## Files Created/Modified
- `server/src/services/chat.ts` - Extended listThreads to fetch latest message per thread via second query + in-memory Map
- `ui/src/api/chat.ts` - New file: chatApi object wrapping all 4 chat HTTP endpoints, plus ChatThread/ChatMessage/MessagesPage types
- `ui/src/lib/queryKeys.ts` - Added queryKeys.chat block with threads/threadsByAgent/messages factories
- `ui/src/App.tsx` - Imported Chat page, added /chat routes to boardRoutes and unprefixed redirects
- `ui/src/components/Sidebar.tsx` - Added MessageSquare import, added Chat nav item in Work section
- `ui/src/context/LiveUpdatesProvider.tsx` - Added chat.message.created handler with dual cache invalidation
- `ui/src/pages/Chat.tsx` - New placeholder file: exports Chat component returning `<div>Chat</div>`

## Decisions Made
- lastMessage fetched via second query with desc-ordered results and in-memory Map deduplication — avoids complex SQL lateral joins, efficient for small thread counts typical in this system
- Chat nav item placed in the Work section after Issues rather than a new section — chat is a work communication tool
- Placeholder Chat page created now so route compilation succeeds; full implementation deferred to Plan 02

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Server TypeScript has pre-existing errors in plugin-sdk modules (Cannot find module '@paperclipai/plugin-sdk') that are unrelated to chat changes. Confirmed no chat.ts-specific errors. All 28 chat-routes tests pass.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All contracts established for Plan 02 chat UI components: chatApi, queryKeys, routes, sidebar entry, real-time events
- Plan 02 can immediately build ChatThread list, ChatMessage view, and send message form using these foundations
- No blockers

---
*Phase: 04-web-ui*
*Completed: 2026-03-19*
