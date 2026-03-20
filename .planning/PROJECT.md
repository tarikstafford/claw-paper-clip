# Paperclip Chat System

## What This Is

A unified chat system for the Paperclip platform that allows board members and authorized external users (via Telegram) to have real-time, topic-based conversations with any AI agent in their company. Chat threads persist in the database, and older messages are automatically compacted before being ingested into the agent's LLM context window — keeping the full history intact while respecting context limits.

## Core Value

Board members can communicate with any agent through a consistent chat experience — whether from the Paperclip dashboard or Telegram — with the agent responding in real-time and full conversation history always accessible.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Telegram bot can receive messages and forward to CEO agent — existing
- ✓ Agent can respond via Paperclip issue comments — existing
- ✓ Board authentication and session management — existing
- ✓ Agent heartbeat and execution infrastructure — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Unified chat API that both Paperclip UI and Telegram bot consume
- [ ] Chat threads stored in database (new schema: threads + messages tables)
- [ ] Topic-based threading — users can have multiple open threads per agent
- [ ] Any agent can be chatted with, not just CEO
- [ ] Real-time agent wake on new message (push, not poll)
- [ ] Context-aware compaction — compress older messages before LLM ingestion based on model context limit
- [ ] Full message history always preserved in DB regardless of compaction
- [ ] Dedicated chat page in Paperclip UI sidebar
- [ ] Chat tab on agent detail pages
- [ ] Telegram integration uses the same chat API (one thread per group/DM)
- [ ] Telegram messages identified by sender username
- [ ] Agent responses forwarded back to Telegram with proper formatting

### Out of Scope

- Real-time WebSocket streaming of agent responses — use polling/refresh for now
- End-to-end encryption — internal company communication
- File/image attachments in chat — text only for v1
- Voice messages — text only
- Read receipts / typing indicators
- Chat between human users — this is human-to-agent only

## Context

The current Telegram bot creates Paperclip **issues** for each conversation and uses **comments** as messages. This is architecturally wrong — issues are for task tracking, not conversation. The chat system replaces this with a purpose-built messaging layer.

The Paperclip server already has:
- Express API with authentication (better-auth)
- PostgreSQL via Supabase (Drizzle ORM)
- Agent heartbeat/execution system
- Telegram bot service (separate Railway service)

Key technical consideration: The compaction system doesn't compress the actual stored messages. It creates a compressed representation of older messages specifically for LLM context injection. The system needs to know the target model's context window size and manage the thread-to-prompt conversion intelligently.

## Constraints

- **Database**: Supabase PostgreSQL via Drizzle ORM — new tables must have migrations
- **API pattern**: Express routes following existing patterns in `server/src/routes/`
- **Auth**: Must use existing better-auth session/JWT auth for API, agent API keys for Telegram bot
- **Deployment**: Server on Railway (Docker), Telegram bot as separate Railway service
- **UI framework**: React 19 + Tailwind + Radix UI (matching existing Paperclip UI)
- **Agent wake**: Must integrate with existing heartbeat/execution system for real-time wake

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Separate chat tables (not reuse issues/comments) | Issues are for task tracking; chat is conversational with different lifecycle | — Pending |
| Compaction at ingestion time, not storage | Full history must always be accessible; only LLM prompt needs compaction | — Pending |
| One thread per Telegram group/DM | Simplest mapping; users use /new to reset if needed | — Pending |
| Real-time push for agent wake | Better UX than 30s polling; message triggers immediate agent run | — Pending |

---
*Last updated: 2026-03-19 after initialization*
