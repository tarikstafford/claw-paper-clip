# Project Research Summary

**Project:** Paperclip Chat System
**Domain:** Multi-channel human-to-AI-agent conversational chat (web dashboard + Telegram)
**Researched:** 2026-03-19
**Confidence:** HIGH

## Executive Summary

The Paperclip chat system is a milestone addition to an existing Express 5 / React 19 / PostgreSQL / Drizzle platform. The core design challenge is enabling board members and Telegram users to hold persistent, multi-turn conversations with any configured AI agent — with full history always preserved, context intelligently compacted before LLM calls, and both channels routing through a single authoritative chat API. The research consistently points to one architectural conclusion: build a thin Channel Adapter layer on top of a fat Chat Core, with zero new npm dependencies, by extending every mechanism already present in the codebase.

The recommended approach is a five-step build order: DB schema first, then four chat services (ThreadService, MessageService, AgentWakeService, CompactionService), then REST API routes, then the web UI and Telegram bot adapters in parallel, and finally agent integration. No new infrastructure is required — `ws` for WebSocket events, `@tanstack/react-query` for UI polling, the existing `agent_wakeup_requests` heartbeat mechanism for agent wake, `@anthropic-ai/sdk`'s `messages.countTokens()` for accurate token counting, and Drizzle Kit for migrations are all already installed and should be used as-is.

The dominant risks are all in the compaction pipeline and Telegram integration. Compaction must fire at 50–60% of the context window (not 80–90%) to avoid silent context rot, must never re-summarize a summary to prevent fact drift, and must use the Anthropic SDK's token counting rather than heuristics. On the Telegram side, the webhook handler must return HTTP 200 before any agent logic runs — otherwise Telegram retries and spawns duplicate agent runs. Both risks have clear, well-documented mitigations; neither requires novel engineering.

---

## Key Findings

### Recommended Stack

The codebase already has every dependency the chat system needs. The stack research confirmed zero new packages are required. The existing `ws` 8.19.0 + process-internal EventEmitter pattern (used by `live-events-ws.ts`) is extended with a `chat_message_created` event type; no Socket.IO, Redis pub/sub, or Postgres LISTEN/NOTIFY is warranted at single-server Railway scale. Drizzle ORM adds two new tables via `drizzle-kit generate` and `drizzle-kit migrate`, consistent with every other schema change in the project. The Anthropic SDK's `messages.countTokens()` endpoint is free, model-accurate, and already available in the Docker image.

**Core technologies:**
- `ws` 8.19.0 + EventEmitter: real-time browser notification — already installed, pattern established in `live-events-ws.ts`
- `@tanstack/react-query` 5.90.21: UI message polling + cache invalidation — already installed, WebSocket-driven invalidation is the documented pattern
- `agent_wakeup_requests` table + HeartbeatService: agent wake on new message — already installed, idempotent and auditable
- `@anthropic-ai/sdk` `messages.countTokens()`: model-accurate token counting — already installed, free endpoint, no third-party tokenizers
- Drizzle ORM 0.38.4 + Drizzle Kit: schema for `chat_threads` and `chat_messages` — already installed, follows established UUID PK and `withTimezone: true` conventions

See `.planning/research/STACK.md` for full component decisions and the complete "what NOT to install" rationale.

### Expected Features

The research defines a clear MVP boundary. The six Phase 1 features are hard dependencies that must ship together; nothing else delivers value without them. Phase 2 features are polish with no blocking dependencies. Everything else is deliberately deferred.

**Must have (table stakes):**
- Persistent message history — full DB storage, never modified; compaction is read-time only
- Topic-based thread isolation — one thread per topic per agent; explicit thread creation
- Agent responds to correct sender — thread bound to specific agent at creation, no routing guessing
- Message ordering guarantee — `(threadId, createdAt)` index, DB-backed sequence
- Asynchronous agent response — polling sufficient for v1; streaming explicitly out of scope
- Telegram message round-trip — user messages in, agent replies out, same Telegram chat
- Context-aware agent responses — compaction pipeline keeps recent turns verbatim + LLM summary of older turns
- Graceful failure messages — agent run errors surfaced to chat thread

**Should have (differentiators):**
- Context compaction at ingestion — full history preserved in DB; compacted prompt built at agent run time
- Layered compaction pipeline — tool-result collapse, then dialogue summarization, then sliding window emergency backstop
- Any agent is chattable — thread schema takes `agentId`; board members pick which agent to address
- Real-time agent wake on message — immediate heartbeat trigger via `agent_wakeup_requests`, no polling lag
- Thread naming / topic labels — optional field at creation; auto-generate from first message as fallback
- Thread list in sidebar — sorted by last message time; active thread highlighted
- Run status "thinking" indicator — polling the run status endpoint; simple loading state

**Defer (v2+):**
- WebSocket streaming of agent tokens — significant infrastructure complexity for modest UX gain
- Chat search across threads — needs full-text search infrastructure (tsvector or pgvector)
- File and image attachments — multimodal support, file storage, per-model compatibility
- Global memory across threads — complex memory architecture, out of scope for this milestone

See `.planning/research/FEATURES.md` for the full feature dependency graph and compaction deep-dive.

### Architecture Approach

The system uses a Channel Adapter + Central Chat Core pattern. All message persistence, thread management, compaction, and agent wake logic lives in four server-side services (`ThreadService`, `MessageService`, `CompactionService`, `AgentWakeService`). Each channel — the React SPA and the Telegram bot — is a thin adapter that translates its native event format into the same Chat REST API. No channel knows about any other. Adding a new channel (Slack, email) would require no changes to core services.

**Major components:**
1. **Chat API routes** (`server/src/routes/chat.ts`) — HTTP endpoints for threads and messages; validates actors; enforces company scoping
2. **ThreadService** — create/list/get threads; enforces one-thread-per-Telegram-chat invariant; scoped to company + agent
3. **MessageService** — appends messages from any sender; persists full text; never deletes; emits `publishLiveEvent("chat:message")` on write
4. **CompactionService** — builds LLM-ready prompt from thread at ingestion time; applies sliding window with summarization; never mutates stored messages
5. **AgentWakeService** — translates "new message" into an immediate heartbeat run via the existing `HeartbeatService`; no new execution machinery
6. **DB schema** (`packages/db/src/schema/chat.ts`) — `chat_threads` and `chat_messages` with UUID PKs, `withTimezone: true` timestamps, and a `UNIQUE (agent_id, channel, channel_ref)` constraint to enforce thread identity
7. **Telegram Bot adapter** — polls/webhooks Telegram; maps `chat_id` to `thread_id`; calls Chat API with agent API key; forwards agent replies
8. **Paperclip UI chat page** — thread list in sidebar; message view; React Query polling invalidated by WebSocket `chat:message` events

The build order is strictly: schema → services → routes → channel adapters in parallel → agent integration. This is enforced by hard dependencies: services need the schema, routes need the services, adapters need the routes.

See `.planning/research/ARCHITECTURE.md` for data flow diagrams, anti-patterns, and integration points with existing systems.

### Critical Pitfalls

1. **Telegram webhook timeout causes cascading duplicate agent runs** — Return HTTP 200 to Telegram immediately before any agent logic. Enqueue agent wake as a background job. Store `telegram_update_id` with a unique constraint so retries fail silently at the DB layer.

2. **Context rot before hard token limits are reached** — Set compaction trigger at 50–60% of model context limit, not 80–90%. Attention degrades in the middle of long prompts well before overflow errors occur. Place summary at the top of the prompt; recent turns at the bottom.

3. **Compaction summarization introduces hallucinated facts** — Never re-summarize an existing summary; each conversation segment is summarized exactly once. Use structured extraction prompts ("extract decisions, action items, key facts") rather than free-form rewriting.

4. **Channel-specific state causes thread identity to diverge** — The Telegram bot must be a thin adapter that POSTs to the unified Chat API. It stores only the `telegram_chat_id → thread_id` mapping; no conversation state of its own. Test explicitly: send web messages then Telegram messages and verify the agent receives all in context.

5. **Concurrent agent runs on the same thread** — Add a `processing_status` column to `chat_threads` (`idle | processing | error`). The wake trigger skips if status is `processing`. Agent always re-fetches latest messages from DB at execution time, not from the trigger payload.

See `.planning/research/PITFALLS.md` for 14 pitfalls with phase-specific warnings and detection signs.

---

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Database Schema and Core Services
**Rationale:** Everything else is blocked by the schema and service layer. This phase creates the foundation all subsequent phases depend on. Doing it correctly here (dedicated `chat_threads` and `chat_messages` tables, proper indexes, `telegram_update_id` unique constraint, `processing_status` column) prevents the most expensive pitfalls later (Pitfalls 1, 5, 8).
**Delivers:** Drizzle schema, migrations, ThreadService, MessageService, AgentWakeService — the persistence and event layer with all idempotency guards in place.
**Addresses:** Persistent message history, message ordering guarantee, thread isolation (table stakes from FEATURES.md).
**Avoids:** Pitfall 8 (reusing issues/comments tables), Pitfall 6 (token counting — store `token_count` at write time), Pitfall 5 (concurrent runs — `processing_status` column).

### Phase 2: Unified Chat API
**Rationale:** The REST API is the contract that both channel adapters and the agent integration depend on. It must exist and be stable before either the UI or Telegram bot can be built. Idempotency and auth scoping must be designed here, not retrofitted.
**Delivers:** Thread CRUD endpoints, message send/list endpoints, idempotency key support, company-scoped auth via existing `actorMiddleware`, Zod validators.
**Addresses:** Agent responds to correct sender, delivery confirmation, agent awareness of sender identity.
**Avoids:** Pitfall 10 (missing idempotency on chat API), Pitfall 13 (API key auth scoped correctly — agent identity comes from `thread.agent_id`, not from the API key).

### Phase 3: Compaction Pipeline
**Rationale:** Agent integration depends on CompactionService being correct and stable. Compaction is the highest-complexity, highest-risk component — it should be built and tested in isolation before it is wired into live agent execution. A dedicated phase lets the compaction threshold and summarization strategy be validated against real message volumes before any user sees a response.
**Delivers:** CompactionService with sliding window, structured summarization, Anthropic SDK token counting, `chat_thread_compactions` audit table.
**Addresses:** Context-aware agent responses, context compaction at ingestion, layered compaction pipeline (differentiators from FEATURES.md).
**Avoids:** Pitfall 2 (context rot — 50–60% threshold), Pitfall 3 (hallucinated facts — structured extraction, no re-summarization), Pitfall 6 (token heuristics — use `messages.countTokens()`), Pitfall 11 (no compaction audit trail).

### Phase 4: Agent Integration
**Rationale:** Agent wiring is last among server-side work because it depends on the full message lifecycle (schema, API, compaction) being in place. The agent must read from CompactionService and write back through the Chat API using the same routes as any other actor.
**Delivers:** Agent adapter reads `CompactionService.buildPrompt()` output; agent posts responses via `POST /api/chat/threads/:id/messages` with agent actor; AgentWakeService triggers immediate heartbeat run.
**Addresses:** Real-time agent wake on message, asynchronous agent response, graceful failure messages.
**Avoids:** Pitfall 4 (anti-pattern: new execution path bypassing HeartbeatService), Pitfall 14 (backpressure — debounce wake via `processing_status` guard).

### Phase 5: Web UI Chat
**Rationale:** The UI is a consumer of the Chat API and can be developed once the API is stable. It has no server-side dependencies beyond Phase 2 and 3. UI work and Telegram integration (Phase 6) can proceed in parallel.
**Delivers:** Chat page with thread list sidebar, message view, new thread creation, React Query polling with WebSocket-driven cache invalidation, "agent is thinking" run status indicator.
**Addresses:** Thread list in sidebar, thread naming, run status visibility (differentiators); all table-stakes UX requirements.
**Avoids:** Pitfall 9 (stale polling UX — use 1–2 second interval on active thread, immediate poll on send, pause when tab unfocused).

### Phase 6: Telegram Bot Integration
**Rationale:** The Telegram bot is the other channel adapter; it runs in parallel with Phase 5 since both depend only on the stable Chat API from Phase 2. Telegram has its own failure modes that require careful handling.
**Delivers:** Telegram bot refactored from issue-creation to Chat API; `telegram_chat_id → thread_id` mapping; respond-then-queue webhook pattern; HTML parse mode for agent output; `/new` and `/list` commands.
**Addresses:** Telegram message round-trip, Telegram sender identity preservation (table stakes and differentiator from FEATURES.md).
**Avoids:** Pitfall 1 (webhook timeout — 200 immediately, queue agent wake), Pitfall 7 (MarkdownV2 — use HTML parse mode), Pitfall 4 (thin adapter — no local thread state), Pitfall 12 (`/new` command with confirmation message).

### Phase Ordering Rationale

- Schema must precede all services (type safety, migration state).
- API must precede both channel adapters (they are consumers, not co-builders).
- Compaction is isolated before agent integration so its correctness can be unit-tested with fixture message arrays before any live LLM traffic.
- Web UI and Telegram bot are independent consumers of the same API and can be developed in parallel (Phases 5 and 6).
- Agent integration is last server-side because it depends on the complete message lifecycle — any earlier and the agent might call CompactionService against a partially-built schema or API.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Compaction):** The compaction pipeline is the most technically novel component. The summarization prompt design (structured extraction vs. free-form), the `verbatimTurns` default, and the `chat_thread_compactions` schema warrant a dedicated research-phase pass before implementation begins. The threshold of 50–60% vs. a specific token number also needs calibration against actual agent system prompt sizes.
- **Phase 4 (Agent Integration):** The exact integration point in `HeartbeatService` for an immediate-run trigger needs codebase inspection before the phase is planned in detail. The researcher noted "check `server/src/services/heartbeat.ts` for the method that schedules a run" — this is an open implementation question.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Schema):** Drizzle table definitions follow the established codebase pattern exactly. Schema fields are fully specified in both STACK.md and ARCHITECTURE.md.
- **Phase 2 (API):** Express route + `actorMiddleware` + Zod validator is the documented, repeated pattern in this codebase. The route shapes are well-specified in the research.
- **Phase 5 (Web UI):** React Query + `LiveUpdatesProvider` invalidation is already the UI pattern for real-time data. No novel patterns required.
- **Phase 6 (Telegram):** The Telegram bot already calls Paperclip REST endpoints with agent API key auth. Refactoring from issue-creation to Chat API calls is a known pattern change with no new integration surface.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All decisions verified against official docs and existing codebase. Zero new dependencies — every choice confirmed by reading actual installed package versions and existing code patterns. |
| Features | HIGH | Table stakes verified against multiple sources (Microsoft Agent Framework docs, Anthropic docs, UX research). Compaction pipeline strategy cross-referenced against three independent sources. |
| Architecture | HIGH | Integration points confirmed by direct codebase inspection (`.planning/codebase/ARCHITECTURE.md`). Channel adapter pattern is a canonical EIP reference. Data flow diagrams derived from reading actual existing service code. |
| Pitfalls | HIGH | Critical pitfalls verified against official Telegram bot framework docs, Anthropic official docs, and documented production issues in major open-source Telegram libraries. |

**Overall confidence:** HIGH

### Gaps to Address

- **HeartbeatService immediate-run API:** The exact method signature or endpoint for triggering an immediate agent run (vs. waiting for the next scheduled tick) was not confirmed by reading source code. Phase 4 planning must begin with a codebase read of `server/src/services/heartbeat.ts` to confirm the integration point before the phase is spec'd.

- **CompactionService summarization prompt:** The specific prompt template for structured extraction (the "extract decisions, action items, key facts" pattern) is a design decision, not a researched standard. The compaction research phase should produce a tested prompt before Phase 3 implementation begins.

- **Token count caching strategy:** PITFALLS.md recommends storing `token_count` on each message at write time. STACK.md does not include this column in the schema definition. The Phase 1 schema task should resolve this: either add a `token_count` column to `chat_messages` or accept re-counting at compaction time (acceptable if the Anthropic `countTokens` call is made per-run anyway).

- **`verbatimTurns` default value:** The compaction feature specifies a configurable `verbatimTurns` (default: 20), but this number was not validated against real agent system prompt sizes. If agent system prompts are large, 20 turns may exceed the 50–60% threshold alone. Phase 3 should begin with a token budget calculation using actual agent system prompts.

---

## Sources

### Primary (HIGH confidence)
- Anthropic Token Counting API (official docs): https://platform.claude.com/docs/en/build-with-claude/token-counting
- Anthropic Context Windows (official docs): https://platform.claude.com/docs/en/build-with-claude/context-windows
- Effective context engineering for AI agents — Anthropic Engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Context Compaction — Claude API Docs: https://platform.claude.com/docs/en/build-with-claude/context-windows
- Channel Adapter — Enterprise Integration Patterns: https://www.enterpriseintegrationpatterns.com/patterns/messaging/ChannelAdapter.html
- Microsoft Learn — Threads, Runs, and Messages in Foundry Agent Service: https://learn.microsoft.com/en-us/azure/ai-foundry/agents/concepts/threads-runs-messages
- Microsoft Learn — Compaction strategies (Agent Framework): https://learn.microsoft.com/en-us/agent-framework/agents/conversations/compaction
- grammY deployment types (Telegram long polling vs. webhooks): https://grammy.dev/guide/deployment-types
- telegraf/telegraf GitHub Issue #806 (duplicate update delivery): https://github.com/telegraf/telegraf/issues/806
- Telegram Bot API official documentation: https://core.telegram.org/bots/api
- Idempotent Consumer Pattern — microservices.io: https://microservices.io/patterns/communication-style/idempotent-consumer.html
- Context Window Overflow in 2026 — Redis Engineering Blog: https://redis.io/blog/context-window-overflow/
- TanStack Query polling (official docs): https://tanstack.com/query/latest
- Existing codebase analysis: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STACK.md`

### Secondary (MEDIUM confidence)
- Context Window Management Strategies — Maxim AI: https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/
- LLM Chat History Summarization Guide 2025 — Mem0: https://mem0.ai/blog/llm-chat-history-summarization-guide-2025
- Multi-Channel Chatbot Synchronization — DEV Community: https://dev.to/faraz_farhan_83ed23a154a2/multi-channel-chatbot-synchronization-when-your-bot-has-multiple-personalities-across-platforms-cle
- Context Rot: Why AI Gets Worse the Longer You Chat — Product Talk: https://www.producttalk.org/context-rot/
- Telegram MarkdownV2 Formatting — DeepWiki: https://deepwiki.com/cvzi/telegram-bot-cloudflare/6.3-markdownv2-formatting
- Automatic Context Compression in LLM Agents — Medium (March 2026): https://medium.com/the-ai-forum/automatic-context-compression-in-llm-agents-why-agents-need-to-forget-and-how-to-help-them-do-it-43bff14c341d
- Designing for Agentic AI UX Patterns — Smashing Magazine (February 2026): https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/
- Building Stateful Conversations with Postgres and LLMs — Medium: https://medium.com/@levi_stringer/building-stateful-conversations-with-postgres-and-llms-e6bb2a5ff73e
- Context Compaction Research: Claude Code, Codex CLI — GitHub Gist: https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f
- WebSockets vs SSE — Ably: https://ably.com/blog/websockets-vs-sse
- Socket.IO vs ws — Velt: https://velt.dev/blog/socketio-vs-websocket-guide-developers

---
*Research completed: 2026-03-19*
*Ready for roadmap: yes*
