---
phase: 03-compaction-agent-integration
verified: 2026-03-19T11:55:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "End-to-end compaction with a real thread exceeding 110k tokens"
    expected: "Agent receives a prompt containing <conversation_summary> and <recent_messages> XML tags"
    why_human: "Requires a live Anthropic API key and a seeded database with a long thread — cannot verify programmatically without external services"
  - test: "Server starts without ANTHROPIC_API_KEY set"
    expected: "Server starts cleanly; token counting returns null gracefully and createMessage still returns a message row with tokenCount=null"
    why_human: "Environment variable behaviour and runtime startup path"
---

# Phase 3: Compaction and Agent Integration Verification Report

**Phase Goal:** Agents receive a correctly compacted prompt from every chat thread so their responses are context-aware regardless of conversation length
**Verified:** 2026-03-19T11:55:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every message written via the API has an accurate token_count recorded at write time | VERIFIED | `chatService.createMessage` calls `compactionSvc.countMessageTokens` synchronously after insert and updates `tokenCount` column; returns null on failure without blocking |
| 2 | When a thread exceeds 55% of the model context window, `buildThreadPrompt` returns a compacted representation with summary + verbatim recent messages | VERIFIED | `COMPACTION_THRESHOLD_RATIO = 0.55`, threshold check at line 146 of compaction.ts; XML tags `<conversation_summary>` and `<recent_messages>` confirmed in code; 11 unit tests pass |
| 3 | Stored messages in the DB are never modified or deleted by the compaction process | VERIFIED | `compaction.ts` has no `delete` or `update(chatMessages)` calls; only `insert(chatCompactionEvents)` at audit time; comment on line 129 explicitly documents this invariant |
| 4 | Each compaction event is recorded in the audit table with what was summarised and token counts before and after | VERIFIED | `db.insert(chatCompactionEvents).values({...})` at line 182 of compaction.ts; COMP-04 tests assert audit row fields including `summaryText`, `tokenCountBefore`, `tokenCountAfter`, `compactedMessageCount` |
| 5 | When an agent heartbeat fires for a chat-triggered run, the agent receives the compacted thread context in `contextSnapshot.paperclipChatThreadContext` | VERIFIED | `chat.ts` route calls `compactionSvc.buildThreadPrompt` and passes `compacted.prompt` as `contextSnapshot.paperclipChatThreadContext` before `heartbeat.wakeup`; 3 COMP-05 tests pass |
| 6 | The Claude adapter extracts `paperclipChatThreadContext` from contextSnapshot and injects it into the final prompt | VERIFIED | Line 392 of execute.ts: `asString(context.paperclipChatThreadContext, "").trim()`; line 396: included in `joinPromptSections`; `promptMetrics.chatThreadContextChars` tracking present |
| 7 | Token counting returns null on API failure without blocking message creation | VERIFIED | `countMessageTokens` wraps Anthropic call in try/catch, returns null on failure; COMP-01 test "returns null when Anthropic API throws" passes |
| 8 | Consecutive same-role messages are merged before Anthropic API calls | VERIFIED | `toAnthropicMessages` helper merges consecutive same-role messages; COMP-02 merge test passes |
| 9 | Agent messages do not trigger compaction or wakeup | VERIFIED | Route guard: `if (senderType === "user")` wraps the compaction + wakeup block; COMP-05 regression test asserts `buildThreadPrompt` not called for agent sender |
| 10 | compactionService is wired with a real Anthropic client in production app bootstrap | VERIFIED | `app.ts` lines 146-154: Anthropic client instantiated with graceful API-key-missing fallback; `compactionService(db, anthropicClient)` passed to `chatRoutes` |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/chat_compaction_events.ts` | Compaction audit table schema | VERIFIED | Exists, 14 lines, exports `chatCompactionEvents` pgTable with all required columns |
| `packages/db/src/migrations/0036_chat_compaction_events.sql` | Migration for compaction events table | VERIFIED | Exists, contains `CREATE TABLE IF NOT EXISTS "chat_compaction_events"` with all columns |
| `server/src/services/compaction.ts` | CompactionService with `countMessageTokens` and `buildThreadPrompt` | VERIFIED | 205 lines (above 80 minimum), exports `compactionService` factory; both public methods present |
| `packages/adapters/claude-local/src/server/execute.ts` | Adapter prompt assembly reading `paperclipChatThreadContext` | VERIFIED | Contains `paperclipChatThreadContext` at lines 392 and 396 |
| `server/src/__tests__/compaction-service.test.ts` | Unit tests for COMP-01 through COMP-04 | VERIFIED | 390 lines (above 100 minimum), 11 tests — all pass |
| `server/src/__tests__/chat-routes.test.ts` | Extended tests including COMP-05 context injection | VERIFIED | 532 lines, contains `paperclipChatThreadContext`; 28 tests pass (25 original + 3 COMP-05) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/src/services/chat.ts` | `server/src/services/compaction.ts` | `countMessageTokens` called after `createMessage` insert | WIRED | Lines 80-88: `compactionSvc.countMessageTokens(data.body, DEFAULT_TOKEN_COUNT_MODEL)` with conditional update |
| `server/src/services/compaction.ts` | `packages/db/src/schema/chat_compaction_events.ts` | `insert into chatCompactionEvents` on compaction | WIRED | Line 182: `db.insert(chatCompactionEvents).values({...})` |
| `server/src/services/compaction.ts` | `@anthropic-ai/sdk` | `client.messages.countTokens` and `client.messages.create` | WIRED | Line 96: `anthropicClient.messages.countTokens`; line 112: `anthropicClient.messages.create` |
| `server/src/routes/chat.ts` | `server/src/services/compaction.ts` | `buildThreadPrompt` called before wakeup, result injected into contextSnapshot | WIRED | Lines 95-109: `compactionSvc.buildThreadPrompt(threadId, ...)`, then `paperclipChatThreadContext: compacted.prompt` in `contextSnapshot` |
| `packages/adapters/claude-local/src/server/execute.ts` | contextSnapshot | `asString` extracts `paperclipChatThreadContext`, `joinPromptSections` injects into final prompt | WIRED | Lines 392-398: extraction and injection both present with `promptMetrics` tracking |
| `server/src/app.ts` | `server/src/services/compaction.ts` | Anthropic client instantiation and `compactionService` wired to `chatRoutes` | WIRED | Lines 28, 153-154: import, instantiation, and passing to `chatRoutes` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| COMP-01 | 03-01, 03-02 | Token counting per message using Anthropic SDK countTokens at write time | SATISFIED | `chatService.createMessage` calls `countMessageTokens` synchronously; 2 COMP-01 tests pass |
| COMP-02 | 03-01, 03-02 | Sliding window prompt builder — full recent messages + LLM-summarised older messages | SATISFIED | `buildThreadPrompt` implements split at `messages.length - DEFAULT_VERBATIM_TURNS`; 4 COMP-02 tests pass |
| COMP-03 | 03-01, 03-02 | Compaction threshold at 55% of target model's context window | SATISFIED | `COMPACTION_THRESHOLD_RATIO = 0.55`; 3 COMP-03 tests pass including unknown-model fallback |
| COMP-04 | 03-01, 03-02 | Compaction audit table — track when compaction occurred, what was summarised, token counts | SATISFIED | `chatCompactionEvents` schema, migration, and insert in compaction service; 2 COMP-04 tests pass |
| COMP-05 | 03-02 | Thread context injection into agent prompt during heartbeat execution | SATISFIED | Route injects `paperclipChatThreadContext`; adapter reads and includes it via `joinPromptSections`; 3 COMP-05 tests pass |

All 5 COMP requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

No anti-patterns detected in phase-modified files.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | — |

---

### Human Verification Required

#### 1. End-to-end compaction with live thread

**Test:** Seed a thread with more than 20 messages totalling over 110,000 tokens (or enough to trigger the 55% threshold), then send a new user message via POST `/chat/threads/:threadId/messages`.
**Expected:** The agent heartbeat fires with `contextSnapshot.paperclipChatThreadContext` containing `<conversation_summary>` and `<recent_messages>` XML-tagged sections; a row appears in `chat_compaction_events`.
**Why human:** Requires a live `ANTHROPIC_API_KEY`, a running Postgres instance, and a seeded thread — cannot replicate with static mocks.

#### 2. Server graceful degradation without ANTHROPIC_API_KEY

**Test:** Start the server with `ANTHROPIC_API_KEY` unset or empty. Send a chat message.
**Expected:** Server starts without crashing; message is created with `tokenCount=null`; no unhandled exceptions in logs.
**Why human:** Runtime environment variable and startup path behaviour.

---

### Gaps Summary

No gaps. All must-haves from both plans (03-01 and 03-02) are fully implemented, wired, and tested.

The pre-existing test failure in `plugin-worker-manager.test.ts` (due to `@paperclipai/plugin-sdk` package entry resolution) was present before this phase and is not caused by phase-03 changes — 61 of 62 test files pass.

---

_Verified: 2026-03-19T11:55:00Z_
_Verifier: Claude (gsd-verifier)_
