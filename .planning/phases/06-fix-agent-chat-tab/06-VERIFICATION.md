---
phase: 06-fix-agent-chat-tab
verified: 2026-03-20T00:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
human_verification:
  - test: "Send a message in one browser tab as user A, observe agent Chat tab in another session"
    expected: "Thread list refreshes within ~1s without page reload; new thread or updated thread appears"
    why_human: "WebSocket real-time path (LiveUpdatesProvider) runs in browser context; no server-side unit test covers the full invalidation→refetch cycle"
  - test: "As board user A, create a chat thread with an agent. Log in as board user B and open the same agent's Chat tab"
    expected: "User B sees user A's thread in the agent Chat tab (all threads for agent, not just own)"
    why_human: "Multi-user scenario requires two real sessions; can only be confirmed through a live browser test"
---

# Phase 6: Fix Agent Chat Tab — Verification Report

**Phase Goal:** The agent detail Chat tab shows all threads for that agent (regardless of creator) and refreshes in real time on new messages
**Verified:** 2026-03-20
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /companies/:companyId/chat/threads?agentId=X returns all threads for that agent regardless of creator | VERIFIED | `server/src/routes/chat.ts` lines 44-53: board callers extract `agentIdFilter` from `req.query.agentId` and pass `{ agentId: agentIdFilter }` to `svc.listThreads`; service pushes `eq(chatThreads.agentId, filters.agentId)` with no creator filter when agentId is truthy |
| 2 | GET /companies/:companyId/chat/threads without agentId still filters by creatorUserId (no regression) | VERIFIED | Route line 51: `creatorUserId: !agentIdFilter && req.actor.type === "board" ? req.actor.userId : undefined` — only set when agentIdFilter is absent. Three new tests in chat-routes.test.ts lines 264-299 confirm this, plus the existing API-02 test (line 196) still covers baseline |
| 3 | AgentChatTab uses server-side agentId filter instead of client-side .filter() | VERIFIED | `ui/src/pages/AgentDetail.tsx` line 786: `queryFn: () => chatApi.listThreads(companyId, { agentId })` — no `.filter()` call present. `ui/src/api/chat.ts` line 34-37: `listThreads` accepts `opts?: { agentId?: string }` and appends `?agentId=...` query string |
| 4 | WebSocket chat.message.created events include agentId in payload and trigger threadsByAgent cache invalidation | VERIFIED | `server/src/routes/chat.ts` line 112: `payload: { threadId, messageId: message.id, agentId: thread.agentId }`. `ui/src/context/LiveUpdatesProvider.tsx` lines 513-528: reads `agentId` from payload and calls `queryClient.invalidateQueries({ queryKey: queryKeys.chat.threadsByAgent(expectedCompanyId, agentId) })` inside `if (agentId)` guard |

**Score:** 4/4 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/services/chat.ts` | listThreads with optional agentId filter | VERIFIED | Lines 30-82: `filters.agentId` accepted; `eq(chatThreads.agentId, filters.agentId)` pushed to conditions when truthy, else-if chain skipped |
| `server/src/routes/chat.ts` | GET threads route with agentId query param and agentId in publishLiveEvent payload | VERIFIED | Lines 44-47: `agentIdFilter` extracted for board callers only. Line 112: `agentId: thread.agentId` in publishLiveEvent payload |
| `ui/src/api/chat.ts` | listThreads API call with optional agentId param | VERIFIED | Lines 34-37: `opts?: { agentId?: string }` accepted; `?agentId=...` query string appended when provided |
| `ui/src/pages/AgentDetail.tsx` | AgentChatTab using server-side filter | VERIFIED | Lines 784-788: `queryFn: () => chatApi.listThreads(companyId, { agentId })` — server-side filter, no client-side `.filter()` |
| `ui/src/context/LiveUpdatesProvider.tsx` | threadsByAgent invalidation on chat.message.created | VERIFIED | Lines 513-528: `readString(payload.agentId)` extracted; `queryKeys.chat.threadsByAgent(expectedCompanyId, agentId)` invalidated inside `if (agentId)` guard |
| `server/src/__tests__/chat-routes.test.ts` | Three new UI-02 test cases | VERIFIED | Lines 237-299: three `it("UI-02: ...")` blocks covering agentId filter for board callers, no-regression for omitted param, and agent callers ignoring the param |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ui/src/pages/AgentDetail.tsx` | `ui/src/api/chat.ts` | `chatApi.listThreads(companyId, { agentId })` | WIRED | AgentDetail.tsx line 786 calls `chatApi.listThreads(companyId, { agentId })` exactly as specified |
| `ui/src/api/chat.ts` | `server/src/routes/chat.ts` | `GET /companies/:companyId/chat/threads?agentId=X` | WIRED | api/chat.ts line 35 appends `?agentId=${encodeURIComponent(opts.agentId)}`; route reads `req.query.agentId` |
| `server/src/routes/chat.ts` | `server/src/services/chat.ts` | `svc.listThreads(companyId, { agentId: agentIdFilter })` | WIRED | routes/chat.ts line 49-53 passes `{ agentId: agentIdFilter, ... }` to `svc.listThreads`; service filters by it at line 39-40 |
| `server/src/routes/chat.ts` | `ui/src/context/LiveUpdatesProvider.tsx` | `publishLiveEvent payload includes agentId` | WIRED | routes/chat.ts line 112 publishes `agentId: thread.agentId`; LiveUpdatesProvider line 515 reads `readString(payload.agentId)` and uses it for `threadsByAgent` invalidation |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UI-02 | 06-01-PLAN.md | Chat tab on agent detail pages showing threads for that agent | SATISFIED | Server-side `agentId` filter returns ALL threads for the agent regardless of creator; AgentChatTab uses `chatApi.listThreads(companyId, { agentId })`. Three new tests in chat-routes.test.ts confirm correct filtering behavior |
| UI-04 | 06-01-PLAN.md | Real-time message updates via existing WebSocket live-events + React Query invalidation | SATISFIED (code) / NEEDS HUMAN (browser) | `agentId` added to `chat.message.created` payload; `threadsByAgent` explicitly invalidated in LiveUpdatesProvider. Browser confirmation required — see Human Verification section |
| UI-06 | 06-01-PLAN.md | Thread list shows latest message preview and unread indicator | SATISFIED (partial) | `lastMessage` enrichment in `chatService.listThreads` lines 55-80 remains unchanged and returns `lastMessage` for all threads including agent-filtered results. Unread indicator was explicitly deferred in v1.0 audit and is out of scope for this phase |

**All three requirement IDs from PLAN frontmatter (`requirements: [UI-02, UI-04, UI-06]`) are accounted for.**

**REQUIREMENTS.md traceability check:** UI-02, UI-04, and UI-06 are all mapped to Phase 6 in the traceability table (lines 104, 106, 108 of REQUIREMENTS.md). No orphaned requirements found.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server/src/__tests__/chat-routes.test.ts` | 462-468 | `publishLiveEvent` assertion does not check `agentId` in payload | Info | The test verifies `threadId` and `messageId` but not the new `agentId` field. The production code is correct (line 112 of chat.ts adds `agentId: thread.agentId`), so this is a test coverage gap rather than a functional defect |

No blocker or warning anti-patterns detected. The info-level gap is a missing test assertion, not a missing behavior.

---

## Human Verification Required

### 1. Real-time tab refresh on new message

**Test:** Open an agent's Chat tab in one browser window. In a second window (or via the API), send a new message to a thread associated with that agent. Observe the Chat tab in the first window.
**Expected:** The thread list in the Chat tab updates (either shows a new thread or updates `lastMessage`) within approximately 1 second without a manual page refresh.
**Why human:** LiveUpdatesProvider connects via WebSocket in the browser. The invalidation path (`chat.message.created` → `threadsByAgent` invalidation → React Query refetch) is structurally correct in code but the end-to-end refresh behavior can only be confirmed in a live browser session.

### 2. Cross-user thread visibility

**Test:** Log in as board user A and create a chat thread with agent X. Log out and log in as board user B. Navigate to agent X's detail page and open the Chat tab.
**Expected:** User B can see the thread created by user A in the agent's Chat tab (all threads for the agent, regardless of who created them).
**Why human:** Requires two real authenticated sessions; the unit tests mock the route behavior but cannot replicate multi-user session state end-to-end.

---

## Gaps Summary

No gaps found. All four observable truths are verified at all three levels (exists, substantive, wired). All key links are wired. All three requirement IDs are satisfied with implementation evidence. Two items require human verification for the browser-side behavior, but the automated code analysis confirms the correct logic is in place.

---

_Verified: 2026-03-20_
_Verifier: Claude (gsd-verifier)_
