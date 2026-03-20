# Requirements: Paperclip Chat System

**Defined:** 2026-03-19
**Core Value:** Board members can communicate with any agent through a consistent chat experience — whether from the Paperclip dashboard or Telegram

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Data Layer

- [x] **DATA-01**: Chat threads table with company_id, agent_id, creator info, title, and timestamps
- [x] **DATA-02**: Chat messages table with thread_id, sender type (user/agent/system), body, token_count, and timestamps
- [x] **DATA-03**: Telegram idempotency guard — unique constraint on telegram_update_id to prevent duplicate processing
- [x] **DATA-04**: Processing status on messages to track enqueued → processed state
- [x] **DATA-05**: Drizzle migration for all new chat tables

### Chat API

- [x] **API-01**: POST /companies/:companyId/chat/threads — create thread bound to an agent
- [x] **API-02**: GET /companies/:companyId/chat/threads — list threads for authenticated user
- [x] **API-03**: GET /chat/threads/:threadId/messages — get messages with cursor-based pagination
- [x] **API-04**: POST /chat/threads/:threadId/messages — send message to thread
- [x] **API-05**: Agent wake trigger — inserting a user message triggers immediate agent run via wakeup_requests
- [x] **API-06**: Auth scoping — board users access via session, Telegram bot accesses via agent API key
- [x] **API-07**: Agent can post messages back to thread (response path from heartbeat execution)

### Context Compaction

- [x] **COMP-01**: Token counting per message using Anthropic SDK countTokens at write time
- [x] **COMP-02**: Sliding window prompt builder — full recent messages + LLM-summarized older messages
- [x] **COMP-03**: Compaction threshold at 55% of target model's context window
- [x] **COMP-04**: Compaction audit table — track when compaction occurred, what was summarized, token counts
- [x] **COMP-05**: Thread context injection into agent prompt during heartbeat execution

### Web UI

- [x] **UI-01**: Dedicated /chat page in sidebar with thread list and message view
- [x] **UI-02**: Chat tab on agent detail pages showing threads for that agent
- [x] **UI-03**: Thread creation — select agent, set optional title, send first message
- [x] **UI-04**: Real-time message updates via existing WebSocket live-events + React Query invalidation
- [x] **UI-05**: Message display with sender identity (user name, agent name, timestamps)
- [x] **UI-06**: Thread list shows latest message preview and unread indicator

### Telegram Integration

- [x] **TELE-01**: Migrate Telegram bot from issues/comments API to unified chat API
- [x] **TELE-02**: Respond 200 to webhook immediately, enqueue message processing
- [x] **TELE-03**: One thread per Telegram group/DM — auto-create on first message
- [x] **TELE-04**: /new command resets thread (creates new one for that chat)
- [x] **TELE-05**: Use HTML parse mode for agent responses (not Markdown)
- [x] **TELE-06**: Forward agent responses from chat API back to Telegram chat
- [x] **TELE-07**: Dedup guard — skip messages with already-processed telegram_update_id

## v2 Requirements

### Enhanced UX

- **UX-01**: Thread title auto-generation from first message
- **UX-02**: Message search across threads
- **UX-03**: Thread archiving and cleanup
- **UX-04**: Typing/thinking indicators while agent is processing

### Multi-channel

- **CHAN-01**: Slack channel adapter
- **CHAN-02**: WhatsApp channel adapter
- **CHAN-03**: Email channel adapter

## Out of Scope

| Feature | Reason |
|---------|--------|
| WebSocket streaming of agent responses | Adds complexity for marginal UX gain; polling is fine for 5-30s agent responses |
| End-to-end encryption | Internal company communication, not needed |
| File/image attachments | Text only for v1; adds storage complexity |
| Human-to-human chat | This is human-to-agent only |
| LLM-based agent routing | Users explicitly select which agent to chat with |
| Voice messages | Text only |
| Read receipts / typing indicators | Defer to v2 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 1 | Complete |
| DATA-04 | Phase 1 | Complete |
| DATA-05 | Phase 1 | Complete |
| API-01 | Phase 2 | Complete |
| API-02 | Phase 2 | Complete |
| API-03 | Phase 2 | Complete |
| API-04 | Phase 2 | Complete |
| API-05 | Phase 2 | Complete |
| API-06 | Phase 2 | Complete |
| API-07 | Phase 2 | Complete |
| COMP-01 | Phase 3 | Complete |
| COMP-02 | Phase 3 | Complete |
| COMP-03 | Phase 3 | Complete |
| COMP-04 | Phase 3 | Complete |
| COMP-05 | Phase 3 | Complete |
| UI-01 | Phase 4 | Complete |
| UI-02 | Phase 6 | Complete |
| UI-03 | Phase 4 | Complete |
| UI-04 | Phase 6 | Complete |
| UI-05 | Phase 4 | Complete |
| UI-06 | Phase 6 | Complete |
| TELE-01 | Phase 5 | Complete |
| TELE-02 | Phase 5 | Complete |
| TELE-03 | Phase 5 | Complete |
| TELE-04 | Phase 5 | Complete |
| TELE-05 | Phase 5 | Complete |
| TELE-06 | Phase 5 | Complete |
| TELE-07 | Phase 5 | Complete |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 — traceability updated to reflect 5-phase roadmap (TELE moved from Phase 4 to Phase 5)*
