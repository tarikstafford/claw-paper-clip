# Technology Stack: Chat System Additions

**Project:** Paperclip Chat System (milestone addition)
**Researched:** 2026-03-19
**Scope:** What to ADD to the existing Express 5 / React 19 / PostgreSQL / Drizzle / better-auth / Telegram stack

---

## Existing Stack (do not re-research)

The platform already has everything listed in `.planning/codebase/STACK.md`. Key facts that shape chat decisions:

- `ws` 8.19.0 is already installed and in active use (`live-events-ws.ts`)
- Live events use a **process-internal EventEmitter** (`live-events.ts`) — not Postgres LISTEN/NOTIFY, not Redis
- The WebSocket upgrade flow, auth pattern, and ping/pong heartbeat are established in `live-events-ws.ts`
- Drizzle schema files live in `packages/db/src/schema/` with UUID PKs, `withTimezone: true` timestamps, and `index()` helpers
- Wakeup requests use an `agent_wakeup_requests` table with `status = 'queued'` polling by the heartbeat service
- `@tanstack/react-query` 5.90.21 is already used for all server state in the UI
- The Telegram bot is a separate Fastify service that calls the Paperclip REST API

---

## What the Chat System Needs

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Real-time new-message delivery to browser | Extend existing EventEmitter + WebSocket | Zero new dependencies; pattern already established |
| Real-time agent wake on new message | Extend existing `agent_wakeup_requests` table | Heartbeat service already polls this; adding a wakeup record is the established push mechanism |
| Message polling fallback in UI | TanStack Query `refetchInterval` (already installed) | Out-of-scope WebSocket streaming means polling is fine as fallback |
| Telegram integration | REST calls to new `/api/chat/*` routes (same pattern as existing `paperclip.ts`) | Bot already does this for issues; no new auth mechanism needed |
| Context compaction for LLM | Anthropic SDK `messages.countTokens()` (already installed via `@anthropic-ai/sdk`) | Free endpoint, accurate, works before sending |
| Schema migrations | Drizzle Kit (already installed) | Consistent with entire codebase |

---

## New Dependencies Required: NONE

Every infrastructure concern for the chat system can be satisfied by code written against already-installed packages.

This section documents each concern and confirms no new package is needed.

---

## Component Decisions

### 1. Transport: Extend Existing `ws` + EventEmitter (no new packages)

**Confidence: HIGH** — Verified by reading `server/src/realtime/live-events-ws.ts` and `server/src/services/live-events.ts`.

The current live-events system works as follows:
1. `publishLiveEvent(companyId, type, payload)` emits on a process-internal `EventEmitter`
2. `setupLiveEventsWebSocketServer` subscribes and forwards events over WebSocket to any connected browser client for that company

The chat system should follow this exact pattern. When a new chat message is saved to the database, call `publishLiveEvent` with a `chat_message_created` event type. The browser receives it via the existing WebSocket connection and React Query re-fetches the message list for that thread.

**Do not use Socket.IO.** Socket.IO adds ~200KB to bundle size, a separate connection protocol, and reconnection logic the project already handles manually. The existing `ws`-based setup already handles ping/pong heartbeats, graceful cleanup, and auth-gated upgrades. Introducing Socket.IO would require a parallel server — the `upgrade` event handler already owns the single WebSocket path.

**Do not use PostgreSQL LISTEN/NOTIFY.** The existing live-events pattern uses a process-local EventEmitter intentionally. Postgres LISTEN/NOTIFY requires a dedicated long-lived connection (pool connections cannot be used) and delivers no benefit in a single-server Railway deployment. The project already has the right abstraction.

**Do not use Redis pub/sub.** No Redis instance exists, and this is a single-server deployment. Adding Redis for pub/sub in this context is pure overhead.

### 2. UI Polling + Refresh: `@tanstack/react-query` `refetchInterval` (already installed, v5.90.21)

**Confidence: HIGH** — Verified by reading `.planning/codebase/STACK.md` and confirmed by TanStack Query docs (tanstack.com/query/latest).

Per the project spec, WebSocket streaming of agent responses is explicitly out of scope for v1. The UI pattern is:

1. On new message event from WebSocket → call `queryClient.invalidateQueries(['thread', threadId, 'messages'])`
2. As a fallback, use `refetchInterval: 5000` on the messages query so Telegram-side responses eventually appear even if a WebSocket event is missed

This is the documented "combine WebSocket + React Query" pattern — WebSocket drives invalidation; React Query handles the actual fetch, caching, and error recovery. No additional library needed.

### 3. Agent Wake: Extend `agent_wakeup_requests` Table (no new packages)

**Confidence: HIGH** — Verified by reading `packages/db/src/schema/agent_wakeup_requests.ts` and `server/src/services/heartbeat.ts`.

The existing wakeup mechanism: when a new chat message is received by the API, insert a row into `agent_wakeup_requests` with `status = 'queued'` and a `source` of `'chat'`, a `payload` containing the thread ID and message ID, and the target `agentId`. The heartbeat service already polls this table and triggers agent runs.

This is preferable to a custom wake signal because:
- It is idempotent (the table already handles coalescing via `coalescedCount`)
- It is auditable (records persist)
- It requires no new infrastructure

### 4. Schema: Drizzle ORM (already installed, v0.38.4)

**Confidence: HIGH** — Verified by reading existing schema files.

Two new tables following the established pattern:

**`chat_threads`**
- `id` UUID PK
- `companyId` UUID FK → `companies`
- `agentId` UUID FK → `agents`
- `title` text nullable (user-set or auto-named)
- `source` text (`'ui'` | `'telegram'`)
- `telegramChatId` bigint nullable (for Telegram thread mapping)
- `createdByUserId` UUID nullable FK → `users` (better-auth)
- `createdByTelegramUsername` text nullable
- `createdAt` / `updatedAt` timestamps with timezone

**`chat_messages`**
- `id` UUID PK
- `threadId` UUID FK → `chat_threads`
- `role` text (`'user'` | `'assistant'`)
- `content` text
- `authorUserId` UUID nullable FK → `users`
- `authorTelegramUsername` text nullable
- `authorAgentId` UUID nullable FK → `agents`
- `createdAt` timestamp with timezone (indexed for cursor-based pagination)

Index on `(threadId, createdAt)` for efficient message list queries.

Use `drizzle-kit generate` and `drizzle-kit migrate` as with every other schema change.

### 5. Context Compaction: Anthropic `messages.countTokens()` (already installed via `@anthropic-ai/sdk`)

**Confidence: HIGH** — Verified directly against official Anthropic documentation at platform.claude.com/docs/en/build-with-claude/token-counting.

The Anthropic SDK already present in the Docker image provides `client.messages.countTokens(params)` — a free endpoint (not billed, has separate rate limits) that accepts the same message array you intend to send and returns `{ input_tokens: N }`.

The compaction algorithm:

1. Fetch all messages for the thread from DB
2. Build the full messages array (most recent first)
3. Call `countTokens` on the entire array
4. While `input_tokens > contextWindowThreshold` (e.g., 80% of model limit), move the oldest messages out of the live array and into a "to-summarize" batch
5. If the to-summarize batch exceeds a minimum size, make a separate summarization call to produce a compressed system-prompt block
6. Prepend the summary block to the live messages array

**Do not use tiktoken** or other tokenizer libraries. They are calibrated for GPT models, not Claude. The `countTokens` API is model-accurate and free.

**Do not store the compacted summary back into `chat_messages`.** Per the project spec, full history must always be preserved. Compaction is a build-time transformation for LLM prompt construction, not a storage transformation.

Model context window reference (verified from Anthropic docs, 2026-03-19):
- Claude Opus 4.6 / Sonnet 4.6: 1,000,000 tokens
- All other active Claude models: 200,000 tokens

### 6. Telegram Bot: REST calls to new `/api/chat/*` routes (no new packages)

**Confidence: HIGH** — Verified by reading `services/telegram-bot/src/lib/paperclip.ts`.

The bot already calls Paperclip REST endpoints with Bearer auth (`PAPERCLIP_API_KEY`). Replacing the issue-based approach means:

- `POST /api/companies/:companyId/chat/threads` — find-or-create a thread for the Telegram chat ID
- `POST /api/chat/threads/:threadId/messages` — add a user message
- `GET /api/chat/threads/:threadId/messages?after=:messageId` — poll for agent responses

The bot's `conversation-store.ts` (which currently tracks issue IDs per Telegram chat ID) is updated to track thread IDs instead. No new npm packages are required in the Telegram service.

Agent responses get forwarded back to Telegram by the bot's existing polling loop — the same pattern currently used with `getNewComments()`.

---

## What NOT to Install

| Package | Why Not |
|---------|---------|
| `socket.io` | The project already has `ws` + a custom upgrade handler. Socket.IO would require a parallel server or a full migration of the existing live-events WebSocket. The features it adds (rooms, namespaces, auto-reconnect) are either not needed or already implemented manually. |
| `redis` / `ioredis` | Single-server Railway deployment. The process-local EventEmitter is the right scope. Adding Redis as a pub/sub broker solves a multi-server scaling problem this project does not have. |
| `pg-listen` / `pg-pubsub` | Postgres LISTEN/NOTIFY requires a permanently reserved connection outside the pool. The existing EventEmitter is faster (in-process), simpler, and already used for the same purpose. |
| `@google-cloud/pubsub` / `bullmq` | A message queue for agent wake is unnecessary — `agent_wakeup_requests` is already the job queue with idempotency, coalescing, and audit trail. |
| `tiktoken` / `@anthropic-ai/tokenizer` | Token counting via the Anthropic API is free, model-accurate, and already available. Third-party tokenizers are calibrated for GPT, not Claude. |
| `react-virtualized` / `react-window` | Message lists for human-to-agent chat threads are short (dozens to hundreds of messages, not tens of thousands). Standard React rendering with a scrollable container is sufficient for v1. |
| `socket.io-client` / `reconnecting-websocket` | The existing live-events WebSocket client in the UI already handles reconnection. No separate WebSocket client library is needed. |

---

## Installation

No new packages need to be installed. The chat system is implemented entirely against the existing dependency graph.

If the project later scales to multi-server Railway deployments, the EventEmitter in `live-events.ts` would need to be replaced with Redis pub/sub. That is a single-file refactor. The rest of the chat system (routes, schema, UI) would be unaffected.

---

## Sources

- Anthropic Token Counting API (official docs, verified 2026-03-19): https://platform.claude.com/docs/en/build-with-claude/token-counting
- Anthropic Context Windows (official docs, verified 2026-03-19): https://platform.claude.com/docs/en/build-with-claude/context-windows
- `ws` npm library (github.com/websockets/ws): https://github.com/websockets/ws
- Postgres.js LISTEN/NOTIFY (github.com/porsager/postgres): https://github.com/porsager/postgres#listen--notify
- TanStack Query polling (official docs): https://tanstack.com/query/latest
- WebSockets vs SSE for chat (ably.com, verified): https://ably.com/blog/websockets-vs-sse
- Socket.IO vs ws comparison (velt.dev): https://velt.dev/blog/socketio-vs-websocket-guide-developers
- Context compaction patterns (JetBrains Research, 2025): https://blog.jetbrains.com/research/2025/12/efficient-context-management/
- LLM context management techniques (agenta.ai): https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms
