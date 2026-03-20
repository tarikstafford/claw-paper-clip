# Roadmap: Paperclip Chat System

## Overview

Build a unified, persistent, topic-based chat system that lets board members talk to any company agent — from the Paperclip dashboard or Telegram — with full message history always preserved and context intelligently compacted before each LLM call. The build order is strict: schema first (everything depends on it), then the chat API (the contract both channel adapters consume), then the compaction pipeline and agent integration (highest-risk, isolated for testing), then the two channel adapters (web UI and Telegram) in parallel.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Data Schema** - Drizzle tables, migrations, and idempotency guards that unblock all subsequent work (completed 2026-03-19)
- [ ] **Phase 2: Chat API** - Unified REST endpoints for thread and message management consumed by both channel adapters
- [ ] **Phase 3: Compaction and Agent Integration** - Context compaction pipeline and agent prompt injection, tested in isolation before live traffic
- [x] **Phase 4: Web UI** - Dedicated chat page and agent tab with real-time updates via React Query and WebSocket invalidation (completed 2026-03-19)
- [ ] **Phase 5: Telegram Integration** - Refactor Telegram bot from issue-creation to the unified chat API with correct webhook handling

## Phase Details

### Phase 1: Data Schema
**Goal**: The database is ready to persist chat threads and messages with all correctness guarantees in place
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05
**Success Criteria** (what must be TRUE):
  1. A chat_threads row can be created with company_id, agent_id, creator info, and title, and is retrievable
  2. A chat_messages row can be inserted with sender type, body, token_count, and processing status, and is retrievable ordered by creation time
  3. Inserting a duplicate telegram_update_id fails at the DB constraint level (no application-level guard needed)
  4. A message with processing_status=enqueued can be updated to processed without conflict
  5. Running drizzle-kit migrate applies all new tables cleanly to a fresh Supabase instance
**Plans:** 2/2 plans complete

Plans:
- [x] 01-01-PLAN.md — Schema definitions (chat_threads, chat_messages) + migration generation
- [x] 01-02-PLAN.md — Integration tests validating schema correctness with embedded-postgres

### Phase 2: Chat API
**Goal**: Board members and the Telegram bot can create threads, send messages, and read history through a single authenticated REST API
**Depends on**: Phase 1
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, API-07
**Success Criteria** (what must be TRUE):
  1. A board user with a valid session can create a thread bound to a specific agent and list their threads
  2. A board user can send a message to a thread and retrieve the full message history with cursor-based pagination
  3. Sending a user message immediately triggers an agent wakeup_request (agent run starts without waiting for the next heartbeat tick)
  4. A Telegram bot authenticating with an agent API key can post to the same endpoints a board user can
  5. An agent can post a response message back to a thread through the API, and that message appears in the history
**Plans:** 2 plans

Plans:
- [ ] 02-01-PLAN.md — Zod validators, chat service, Express routes, and app wiring
- [ ] 02-02-PLAN.md — Unit tests for all 7 API requirements

### Phase 3: Compaction and Agent Integration
**Goal**: Agents receive a correctly compacted prompt from every chat thread so their responses are context-aware regardless of conversation length
**Depends on**: Phase 2
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04, COMP-05
**Success Criteria** (what must be TRUE):
  1. Every message stored via the API has an accurate token_count recorded at write time (not estimated)
  2. When a thread exceeds 55% of the target model's context window, the prompt builder produces a compacted representation — recent messages verbatim, older messages as a structured LLM summary
  3. The stored messages in the DB are never modified or deleted by the compaction process
  4. Each compaction event is recorded in the audit table with what was summarized and the token counts before and after
  5. When an agent heartbeat fires for a chat-triggered run, the agent receives the compacted thread context injected into its prompt
**Plans:** 1/2 plans executed

Plans:
- [ ] 03-01-PLAN.md — Audit table schema, migration, Anthropic SDK, CompactionService, token counting wiring
- [ ] 03-02-PLAN.md — Agent context injection into wakeup path and unit tests for all 5 COMP requirements

### Phase 4: Web UI
**Goal**: Board members can start, browse, and continue conversations with any agent directly from the Paperclip dashboard
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06
**Success Criteria** (what must be TRUE):
  1. A board member can navigate to /chat in the sidebar and see a list of their threads with the latest message preview for each
  2. A board member can create a new thread by selecting an agent, setting an optional title, and sending the first message — all from the chat page
  3. A board member can open a thread on an agent's detail page and see all messages for that agent in context
  4. New agent responses appear in the message view without a full page reload (React Query invalidation via WebSocket chat:message event)
  5. Each message clearly shows who sent it — the user's name, the agent's name, or system — with timestamps
**Plans:** 2/2 plans complete

Plans:
- [ ] 04-01-PLAN.md — Server lastMessage join, API client module, query keys, routes, sidebar, WebSocket handler
- [ ] 04-02-PLAN.md — Chat page with thread list + message view, new thread dialog, agent detail Chat tab

### Phase 5: Telegram Integration
**Goal**: Telegram users can chat with agents through the same unified system, with messages round-tripping correctly and no duplicate processing
**Depends on**: Phase 2
**Requirements**: TELE-01, TELE-02, TELE-03, TELE-04, TELE-05, TELE-06, TELE-07
**Success Criteria** (what must be TRUE):
  1. Sending a message to the Telegram bot results in an agent response appearing in the same Telegram chat (full round-trip)
  2. The Telegram webhook always returns HTTP 200 immediately — agent processing never blocks the webhook response
  3. A Telegram group or DM automatically maps to a single chat thread; sending a second message continues the same thread
  4. Using the /new command in Telegram creates a fresh thread for that chat, and subsequent messages go to the new thread
  5. Agent responses sent back to Telegram are formatted with HTML parse mode (not MarkdownV2)
  6. Sending the same Telegram update_id twice results in only one message being stored (dedup guard fires at DB layer)
**Plans:** 1/3 plans executed

Plans:
- [ ] 05-01-PLAN.md — Wire telegramUpdateId through sendMessageSchema, chatService, and chat route with 409 dedup handling
- [ ] 05-02-PLAN.md — Rewrite bot source: paperclip.ts, conversation-store.ts, conversation-manager.ts, telegram.ts, app.ts
- [ ] 05-03-PLAN.md — Vitest infrastructure and unit tests for all 7 TELE requirements

### Phase 6: Fix Agent Chat Tab Integration
**Goal**: The agent detail Chat tab shows all threads for that agent (regardless of creator) and refreshes in real time on new messages
**Depends on**: Phase 4
**Requirements**: UI-02, UI-04, UI-06
**Gap Closure:** Closes FINDING-01 and FINDING-02 from v1.0 audit
**Success Criteria** (what must be TRUE):
  1. GET /companies/:companyId/chat/threads accepts an optional agentId query param and returns all threads for that agent, not just the caller's threads
  2. AgentChatTab uses the server-side agentId filter instead of client-side filtering
  3. WebSocket chat.message.created events cause the agent detail Chat tab thread list to refresh (threadsByAgent query key invalidated)

Plans:
- [ ] 06-01-PLAN.md — Server-side agentId filter, client update, WebSocket key invalidation

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5
Note: Phases 4 and 5 depend only on Phase 2 and can be developed in parallel if desired.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Schema | 2/2 | Complete   | 2026-03-19 |
| 2. Chat API | 0/2 | In progress | - |
| 3. Compaction and Agent Integration | 1/2 | In Progress|  |
| 4. Web UI | 2/2 | Complete   | 2026-03-19 |
| 5. Telegram Integration | 1/3 | In Progress|  |
| 6. Fix Agent Chat Tab Integration | 1/1 | Complete   | 2026-03-20 |
