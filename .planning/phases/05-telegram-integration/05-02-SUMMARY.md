---
phase: 05-telegram-integration
plan: 02
subsystem: api
tags: [telegram, chat-api, websocket, polling, typescript]

# Dependency graph
requires:
  - phase: 05-01-telegram-integration
    provides: telegramUpdateId field on sendMessageSchema and 409 dedup handling in chat route
  - phase: 02-chat-api
    provides: chat threads and messages API endpoints (POST /companies/:companyId/chat/threads, POST/GET /chat/threads/:threadId/messages)
provides:
  - Fully migrated Telegram bot source using chat API (threads + messages) instead of issues/comments API
  - createChatThread, postChatMessage, getNewMessages API client functions
  - ConversationEntry with threadId/lastSeenMessageId and backward-compatible migration from old issueId schema
  - formatForTelegramHtml() converting agent Markdown to Telegram HTML
  - pollAgentReplies() filtering on senderType===agent with dedup via forwardedMessageIds Set
affects: [05-03-telegram-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fire-and-forget webhook: return 200 before awaiting message processing"
    - "dedup at two levels: telegramUpdateId in DB (409) and forwardedMessageIds in-memory Set"
    - "backward-compatible store migration: LegacyConversationEntry type handles old issueId files"

key-files:
  created: []
  modified:
    - services/telegram-bot/src/lib/conversation-store.ts
    - services/telegram-bot/src/lib/paperclip.ts
    - services/telegram-bot/src/lib/telegram.ts
    - services/telegram-bot/src/conversation-manager.ts
    - services/telegram-bot/src/app.ts

key-decisions:
  - "LegacyConversationEntry interface used for migration type safety — avoids casting raw JSON to final interface"
  - "chatFetch returns raw Response (not parsed JSON) — needed to inspect status codes like 409 before consuming body"
  - "getNewMessages uses ?limit=50 even without after param — consistent API call shape"

patterns-established:
  - "Chat API client: chatFetch returns raw Response; callers inspect status before parsing JSON"
  - "Dedup pattern: 409 from server returns 'duplicate' string literal; callers log and return early"
  - "HTML formatting: formatForTelegramHtml processes bold before italic to avoid double-asterisk conflicts"

requirements-completed: [TELE-01, TELE-02, TELE-03, TELE-04, TELE-05, TELE-06]

# Metrics
duration: 2min
completed: 2026-03-19
---

# Phase 5 Plan 02: Telegram Bot Chat API Migration Summary

**Telegram bot fully migrated to chat threads/messages API with HTML formatting, telegramUpdateId dedup, and backward-compatible conversation store migration**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-19T18:25:13Z
- **Completed:** 2026-03-19T18:27:43Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Bot now creates chat threads via POST /api/companies/:companyId/chat/threads on first message
- Bot posts messages with telegramUpdateId; 409 duplicate treated as success (no error to user)
- Agent replies polled from chat_messages filtered by senderType===agent, forwarded with Telegram HTML formatting
- Webhook still returns 200 immediately (fire-and-forget preserved)
- Old conversation JSON files with issueId/lastSeenCommentId gracefully migrated on load

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite conversation-store and paperclip API client** - `edcaa47` (feat)
2. **Task 2: Rewrite conversation-manager, update telegram.ts and app.ts** - `c464174` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `services/telegram-bot/src/lib/conversation-store.ts` - ConversationEntry uses threadId/lastSeenMessageId; load() migrates old issueId schema
- `services/telegram-bot/src/lib/paperclip.ts` - New createChatThread, postChatMessage (returns 'created'|'duplicate'), getNewMessages functions
- `services/telegram-bot/src/lib/telegram.ts` - parse_mode switched to HTML; formatForTelegramHtml() added
- `services/telegram-bot/src/conversation-manager.ts` - Full rewrite using chat API; handleBoardMessage accepts telegramUpdateId; pollAgentReplies replaces pollCeoReplies
- `services/telegram-bot/src/app.ts` - /new clears threadId/lastSeenMessageId; handleBoardMessage called with update.update_id

## Decisions Made
- `chatFetch` returns raw `Response` rather than parsed JSON — necessary to inspect 409 status before consuming body; if we parsed JSON blindly, 409 error body would throw before caller could handle dedup
- `LegacyConversationEntry` interface for migration — avoids `as unknown as` casting by giving old schema a proper type
- `getNewMessages` includes `?limit=50` even without `after` param — consistent with how the API is designed

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — TypeScript compilation succeeded cleanly after both tasks.

## User Setup Required

None — no external service configuration required. Bot uses same env vars (PAPERCLIP_API_URL, PAPERCLIP_COMPANY_ID, PAPERCLIP_API_KEY, PAPERCLIP_CEO_AGENT_ID).

## Next Phase Readiness
- Bot source fully migrated and TypeScript-clean; ready for Plan 03 (deployment/wiring)
- No blockers

## Self-Check: PASSED

All files present. All commits verified.

---
*Phase: 05-telegram-integration*
*Completed: 2026-03-19*
