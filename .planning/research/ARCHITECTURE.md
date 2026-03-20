# Architecture Patterns: Paperclip Chat System

**Domain:** Multi-channel chat with LLM context management
**Researched:** 2026-03-19
**Confidence:** HIGH (fits established patterns; integrates cleanly with documented existing architecture)

---

## Recommended Architecture

The system is best structured as a **Channel Adapter + Central Chat Core** pattern. A single authoritative chat core (stored threads, messages, and compaction logic) lives in the server. Each channel (web UI, Telegram) is a thin adapter that translates its native format into that core's API, and the core sends responses back through the same adapter. No channel knows about any other.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Paperclip Server                         │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────────────────────────┐  │
│  │  Chat API    │    │              Chat Core               │  │
│  │  (Express    │───▶│  ThreadService  │  MessageService    │  │
│  │   routes)    │    │  CompactionSvc  │  AgentWakeService  │  │
│  └──────┬───────┘    └────────────────────────────────────┬─┘  │
│         │                                                 │     │
│  ┌──────┴───────┐    ┌──────────────────────────────────┐ │     │
│  │ Auth         │    │         packages/db               │ │     │
│  │ Middleware   │    │  threads | messages | compactions  │◀┘     │
│  │ (existing)   │    └──────────────────────────────────┘        │
│  └──────────────┘                                               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  Agent Execution Layer                    │  │
│  │  HeartbeatService ◀── AgentWakeService (new)             │  │
│  │  (existing)           triggers immediate run              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          ▲                              ▲
          │ REST + polling               │ Agent API key auth
          │                              │
┌─────────┴───────────┐      ┌──────────┴──────────────┐
│   Paperclip UI       │      │   Telegram Bot Service  │
│   (React SPA)        │      │   (services/telegram-   │
│   Chat page +        │      │    bot, Railway)        │
│   Agent chat tab     │      │                         │
└──────────────────────┘      └─────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Chat API routes** (`server/src/routes/chat.ts`) | HTTP endpoints for threads and messages; validates actors; enforces company scoping | ThreadService, MessageService, Auth middleware |
| **ThreadService** (`server/src/services/chat/thread.ts`) | Create/list/get threads; enforce one-thread-per-Telegram-chat invariant; scope to company + agent | DB (threads table) |
| **MessageService** (`server/src/services/chat/message.ts`) | Append messages from any sender; persist full text; never delete; emit live event on write | DB (messages table), LiveEventsService |
| **CompactionService** (`server/src/services/chat/compaction.ts`) | Build the LLM-ready prompt from a thread at ingestion time; apply sliding window with summarization; never mutate stored messages | DB (messages table), optional LLM call for summarization |
| **AgentWakeService** (`server/src/services/chat/agent-wake.ts`) | Translate "new message in thread" into an immediate agent heartbeat run, bypassing the scheduled timer | HeartbeatService (existing), AgentService (existing) |
| **Telegram Bot** (`services/telegram-bot`) | Poll/webhook Telegram; map group/DM to a chat thread; call Chat API with agent API key; forward agent replies to Telegram | Chat API (HTTP), Telegram Bot API |
| **Paperclip UI chat page** (`ui/src/pages/chat/`) | List threads; render message history; poll for new messages; send new messages | Chat API (HTTP), React Query |
| **DB schema** (`packages/db/src/schema/chat.ts`) | Drizzle table definitions for `chat_threads`, `chat_messages` | Nothing internal — consumed by server only |

**What does NOT change:** The existing heartbeat scheduler, adapter registry, auth middleware, live-events WebSocket, and Drizzle ORM setup are all reused as-is.

---

## Data Flow

### 1. Web UI Sends a Message

```
User types message
  → POST /api/companies/:companyId/chat/threads/:threadId/messages
    → actorMiddleware resolves actor: board user (session cookie)
    → MessageService.append({ threadId, sender: "user", senderName, content })
      → INSERT chat_messages
      → publishLiveEvent("chat:message", threadId)   [existing WS bus]
    → AgentWakeService.wake(agentId, threadId)
      → HeartbeatService.scheduleImmediateRun(agentId)
    → 201 { message }
```

### 2. Agent Wakes and Responds

```
HeartbeatService.scheduleImmediateRun(agentId)
  → adapter.execute(context)
    → Agent calls POST /api/companies/:companyId/chat/threads/:threadId/messages
      with actor: agent (agent API key / JWT)
      → MessageService.append({ sender: "agent", content })
        → INSERT chat_messages
        → publishLiveEvent("chat:message", threadId)
```

### 3. Web UI Receives Agent Response

```
LiveUpdatesProvider receives "chat:message" WebSocket event
  → queryClient.invalidateQueries(["thread", threadId, "messages"])
    → UI re-fetches GET /api/.../threads/:threadId/messages
    → Message list updates
```
(No streaming required for v1; React Query invalidation handles refresh.)

### 4. Telegram Message In

```
Telegram Bot (polling or webhook)
  → Receives update from Telegram Bot API
  → Looks up or creates thread for this chat_id
    → POST /api/.../chat/threads  (agent API key auth)
  → POST /api/.../threads/:threadId/messages  { sender: "user", senderName: telegram_username }
  → Waits: poll GET .../threads/:threadId/messages?after=<last_msg_id>
    → When agent reply appears, forward to Telegram sendMessage
```

### 5. LLM Context Build (Compaction at Ingestion)

```
Agent adapter calls CompactionService.buildPrompt(threadId, modelContextLimit)
  → Fetch ALL messages for thread (never deleted)
  → Count tokens from most-recent backward (sliding window)
  → If all messages fit: return verbatim history
  → If overflow:
      Split at cutoff: [old_messages | recent_window]
      LLM summarize(old_messages) → summary_text
      Return: [{ role: "system", content: summary_text }, ...recent_window]
  → Result: prompt array ready for LLM API call
  → Full DB history unchanged
```

This is compaction-at-ingestion: every agent run calls `buildPrompt()` fresh; nothing in the DB is ever summarized or truncated.

---

## Database Schema (New Tables)

```
chat_threads
  id             uuid PK
  company_id     uuid FK → companies.id
  agent_id       uuid FK → agents.id
  topic          text nullable          -- user-supplied label
  channel        enum('web', 'telegram')
  channel_ref    text nullable          -- Telegram chat_id, null for web
  created_at     timestamptz
  updated_at     timestamptz

  UNIQUE (agent_id, channel, channel_ref)  -- one thread per Telegram chat per agent

chat_messages
  id             uuid PK
  thread_id      uuid FK → chat_threads.id
  sender_type    enum('user', 'agent')
  sender_name    text                   -- board user display name or agent name
  content        text
  created_at     timestamptz
  -- Never deleted; compaction reads but never writes back
```

The unique constraint on `(agent_id, channel, channel_ref)` enforces the one-thread-per-Telegram-chat-per-agent invariant without application logic.

---

## Patterns to Follow

### Pattern 1: Channel Adapter (thin channel, fat core)

**What:** Each channel (web, Telegram) translates its native event format into the same Chat API calls. Channel code knows nothing about threads, compaction, or agents — it only knows how to authenticate and call the API.

**Why:** Adding a new channel (Slack, email) requires no changes to core logic. The Telegram bot's existing Railway deployment becomes one more thin client.

**Example — Telegram bot:**
```typescript
// services/telegram-bot/src/handlers/message.ts
async function onTelegramMessage(update: TelegramUpdate) {
  const thread = await chatApi.getOrCreateThread({
    agentId: resolveAgent(update),
    channel: "telegram",
    channelRef: String(update.message.chat.id),
  });
  await chatApi.postMessage(thread.id, {
    senderType: "user",
    senderName: update.message.from.username ?? "unknown",
    content: update.message.text,
  });
  // then poll for agent reply and forward it
}
```

### Pattern 2: Ingestion-Time Compaction (never mutate history)

**What:** `CompactionService.buildPrompt()` is called every time an agent is about to be invoked. It reads the full thread history, decides what fits in the model's context window, and returns a structured prompt. The DB rows are never updated or deleted.

**Why:** The PROJECT.md requirement is explicit — "Full message history always preserved in DB regardless of compaction." Ingestion-time compaction is the only approach that satisfies this without dual writes.

**Token budget logic:**
```
total_budget = model_context_limit - system_prompt_tokens - response_reserve
recent_window = take messages from tail until budget exhausted
overflow = everything before recent_window
if overflow is empty: return recent_window verbatim
else: summary = llm_summarize(overflow)
      return [summary_system_message, ...recent_window]
```

### Pattern 3: Agent Wake via Immediate Heartbeat Run

**What:** `AgentWakeService` calls the existing heartbeat execution path with a "run now" override rather than waiting for the next scheduled timer tick.

**Why:** The existing `HeartbeatService` already manages agent execution lifecycle, concurrency guards, and run event recording. Reusing it avoids duplicating execution logic.

**Integration point:** Check `server/src/services/heartbeat.ts` for the method that schedules a run. The wake service either calls that directly or posts to an internal endpoint if the heartbeat scheduler exposes one. No new execution machinery is needed.

### Pattern 4: Polling for Agent Replies (No Streaming)

**What:** The UI polls `GET /threads/:threadId/messages?after=<lastId>` until a new agent message appears. The Telegram bot does the same after posting.

**Why:** PROJECT.md explicitly excludes WebSocket streaming of agent responses for v1. React Query's cache invalidation via the existing live-events WebSocket already handles the UI refresh pattern — the same `publishLiveEvent("chat:message")` call that works for issues will trigger invalidation here.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Reusing Issues/Comments as Chat Storage

**What:** Continuing to create a Paperclip issue per Telegram conversation and treating comments as messages.

**Why bad:** Different data lifecycle (issues are closeable, assignable, have statuses), different access patterns, wrong semantic model. Adding threading, compaction, and per-agent routing on top of issues requires constant workarounds.

**Instead:** New `chat_threads` and `chat_messages` tables. Issues remain for task tracking.

### Anti-Pattern 2: Compaction at Write Time (Mutating Stored Messages)

**What:** Summarizing and replacing old messages in the DB when a threshold is hit, like a destructive rolling window.

**Why bad:** Destroys history permanently. Makes debugging impossible. Violates the explicit requirement that full history is always accessible. Creates race conditions if two concurrent reads trigger compaction simultaneously.

**Instead:** Compaction produces a transient prompt structure at read time. The DB always holds the full record.

### Anti-Pattern 3: Channel-Specific Logic Inside Chat Core Services

**What:** `MessageService` or `ThreadService` containing `if (channel === "telegram") { ... }` branches.

**Why bad:** Breaks the channel adapter isolation. Every new channel requires touching core services.

**Instead:** Channel identity is stored as data (`channel` enum column). Core services are channel-agnostic. Channel-specific formatting (Telegram Markdown, HTML escaping) lives only in the bot adapter.

### Anti-Pattern 4: New Agent Execution Path Bypassing Heartbeat

**What:** Adding a second code path that directly calls the LLM adapter from the chat message handler, skipping heartbeat scaffolding.

**Why bad:** Duplicates execution lifecycle management, run recording, and billing logic. Creates two places where agent runs can start, making debugging confusing.

**Instead:** Always go through `HeartbeatService` for agent execution, even for immediate/triggered runs.

---

## Component Build Order

Dependencies flow strictly: schema first, services second, API routes third, then channels in parallel.

```
Step 1: DB schema (packages/db)
  chat_threads table + chat_messages table + Drizzle migrations
  Nothing depends on this yet; everything below depends on it.

Step 2: Chat services (server/src/services/chat/)
  ThreadService  — depends on schema only
  MessageService — depends on schema + LiveEventsService (existing)
  AgentWakeService — depends on HeartbeatService (existing)
  CompactionService — depends on MessageService (reads messages)
  Build order within: ThreadService → MessageService → AgentWakeService → CompactionService

Step 3: Chat API routes (server/src/routes/chat.ts)
  Depends on all four services + existing auth middleware
  Register routes on existing Express app (server/src/app.ts)

Step 4: Channel adapters (in parallel, both depend on Step 3)
  4a. Telegram Bot updates (services/telegram-bot)
      Replace issue-creation flow with Chat API calls
  4b. Paperclip UI chat (ui/src/pages/chat/ + ui/src/api/chat.ts)
      New chat page + agent detail chat tab
      Uses React Query + existing API client pattern

Step 5: Agent integration
  Agent adapter reads CompactionService.buildPrompt() output
  Agent writes responses back via Chat API (same as Step 3)
  Depends on Steps 2-4 all being complete
```

**Why this order:**
- Schema must exist before any service can run migrations or type-check.
- Services must exist before routes can call them.
- Routes (the Chat API) must be deployed before either channel can call them.
- The Telegram bot and UI are independent consumers of the same API — they can be developed and deployed in parallel.
- Agent integration (reading compacted context and writing replies) is last because it depends on the full message lifecycle being in place.

---

## Integration Points with Existing Architecture

| Existing System | How Chat Integrates |
|----------------|---------------------|
| `actorMiddleware` | Chat routes use the same `req.actor` pattern; `board` users post human messages, `agent` actors post agent replies |
| `packages/db` | New `schema/chat.ts` file added alongside existing schema files; `createDb()` unchanged |
| `LiveEventsService` + `publishLiveEvent()` | `MessageService.append()` calls `publishLiveEvent("chat:message", { threadId })` — same pattern as issue/comment mutations |
| `HeartbeatService` | `AgentWakeService` calls an immediate-run trigger; no new execution machinery |
| `services/telegram-bot` | Existing bot replaces issue-creation calls with Chat API calls; auth uses existing agent API key mechanism |
| `validate()` middleware + Zod schemas | Chat request bodies validated with new Zod schemas in `packages/shared/src/validators/chat.ts` |
| React Query + `LiveUpdatesProvider` | UI chat polls invalidated on `chat:message` WebSocket events; no new real-time infrastructure |

---

## Scalability Considerations

| Concern | At current scale (small company) | At future scale |
|---------|-----------------------------------|-----------------|
| Message volume | Simple SELECT with `ORDER BY created_at` is fast | Add index on `(thread_id, created_at)`; already sufficient for thousands of messages per thread |
| Compaction LLM calls | One summarization call per agent run when overflow exists; negligible | Cache the summary for the overflow segment; only re-summarize when new overflow messages arrive |
| Telegram polling | Bot polls Telegram API; no load on Paperclip server between messages | Switch to Telegram webhooks to eliminate poll loop |
| Concurrent agent runs | HeartbeatService already has concurrency guards | No change needed |

---

## Sources

- [Context Window Management Strategies - Maxim AI](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) — Sliding window and hierarchical memory patterns (MEDIUM confidence, commercial article)
- [Channel Adapter - Enterprise Integration Patterns](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ChannelAdapter.html) — Canonical definition of the channel adapter pattern (HIGH confidence, foundational EIP reference)
- [LLM Chat History Summarization Guide 2025 - Mem0](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) — ConversationSummaryBufferMemory pattern (MEDIUM confidence)
- [Context Compaction - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/context-windows) — Server-side compaction available in Claude Sonnet 4.6 (HIGH confidence, official docs)
- [Effective context engineering for AI agents - Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Ingestion-time compaction rationale (HIGH confidence, official source)
- Existing codebase analysis: `.planning/codebase/ARCHITECTURE.md` — All integration point details are HIGH confidence from direct codebase inspection
