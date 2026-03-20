# Feature Landscape: Paperclip Chat System

**Domain:** Human-to-AI-agent conversational chat, multi-channel (web dashboard + Telegram)
**Researched:** 2026-03-19
**Overall confidence:** HIGH (all major findings verified against official docs and multiple sources)

---

## Table Stakes

Features users expect. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Persistent message history | Users scroll back to review earlier answers; systems that reset context force users to repeat themselves | Low | Full history stored in DB; separate from what gets sent to LLM |
| Topic-based thread isolation | Each conversation has a clear scope; mixing topics produces incoherent agent responses | Low | One thread = one topic; multiple threads per agent per user |
| Explicit thread creation | Users must be able to start a fresh conversation deliberately; implicit resets are disorienting | Low | "New chat" button in web UI; `/new` command in Telegram |
| Agent responds to the sender | The correct agent (the one the user is chatting with) must reply; no ambiguous routing | Low | Thread is bound to a specific agent at creation; no routing guessing |
| Message ordering guarantee | Out-of-order messages create nonsensical dialogue | Low | DB-backed ordered list; timestamps + sequence index |
| Delivery confirmation | User knows their message was received, even if agent hasn't responded yet | Low | HTTP 200 or optimistic UI; no need for complex ACK protocols |
| Asynchronous agent response | Agent response should arrive without requiring the user to hold a connection open | Low | Polling at short intervals is sufficient for v1; streaming optional later |
| Telegram message round-trip | User sends in Telegram, agent responds in Telegram — in the same chat | Medium | Requires proper thread mapping by (chat_id, agent_id) |
| Context-aware agent responses | Agent must have enough conversation history to give coherent follow-up answers | Medium | Context window management; agent sees recent messages, not just the latest one |
| Agent awareness of sender identity | Agent should know whether it is talking to a board member or an external Telegram user | Low | Thread schema must carry sender identifier (user_id or Telegram username) |
| Graceful failure messages | If agent fails or times out, user gets a clear message rather than silence | Low | Error handling in the agent run pipeline, surface to chat |

---

## Differentiators

Features that set this product apart. Not universally expected, but high value for this use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Context compaction at ingestion (not storage) | Full history is always preserved and auditable; LLM only receives a prompt-sized window — best of both worlds | High | Summarization strategy: keep last N turns verbatim + LLM-generated summary of older turns; compaction happens at prompt construction time, not write time |
| Compaction pipeline (layered strategies) | Different message types need different compaction treatment: tool results vs. dialogue vs. summaries | High | Follow the pipeline pattern: collapse tool results first (cheap), then summarize older dialogue (moderate), then sliding window as emergency backstop |
| Any agent is chattable | Board members can query the engineering agent, CEO agent, or any other — not just a fixed bot | Low-Medium | Thread schema takes `agentId`; routing is explicit, not inferred |
| Real-time agent wake on message | Message delivery immediately triggers an agent run; no polling lag | Medium | Integrate with existing heartbeat/execution system; push event on message INSERT |
| Unified API for all channels | Telegram and web UI both consume the same HTTP chat API; Telegram bot is just another API client | Medium | Avoids divergent behavior between channels; consistent compaction and history regardless of channel |
| Topic naming / thread labeling | Users can name threads ("Q3 revenue question", "hiring plan") for easy navigation | Low | Optional field on thread creation; auto-generate from first message content as fallback |
| Thread list in sidebar | Users see all their open threads grouped by agent | Low | Simple list view; active thread highlighted; sorted by last message time |
| Agent-level chat tab | Navigating to an agent's detail page shows their chat history with you | Low | Filtered thread list view; reuses unified API |
| Telegram sender identity preservation | Messages from Telegram carry the Telegram username, not just an anonymous user ID | Low | Platform-specific sender metadata stored with message; agents can address users by name |
| Run status visibility | User sees "Agent is thinking..." while a run is in progress | Low | Polling the run status endpoint; simple loading indicator |

---

## Anti-Features

Features to deliberately NOT build in v1, with rationale.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| WebSocket streaming of agent tokens | Adds significant infrastructure complexity (connection management, backpressure, Railway deployment constraints) for modest UX improvement when agents take 5-30s to respond anyway | Short-interval polling (3-5s) on run completion; show "thinking" indicator |
| Automatic/implicit agent routing | LLM-based routing ("figure out which agent should answer") is non-deterministic, hard to debug, and wrong for this domain — users know which agent they want | Explicit agent selection at thread creation; user picks the agent |
| Human-to-human chat | This is not Slack; mixing agent and human communication adds access control complexity and shifts the product's identity | Keep strictly human-to-agent; use Telegram or Slack for human chat |
| Read receipts and typing indicators | Meaningful for human chat; agents don't "read" messages in the human sense and typing indicators require WebSocket infrastructure | "Agent is thinking" polling state is sufficient |
| File and image attachments | Requires multimodal LLM support, file storage, per-model compatibility checks — high complexity for v1 | Text only; explicitly document the limitation |
| Voice messages | Requires STT/TTS pipeline, separate infrastructure, significant latency handling | Out of scope; document clearly |
| End-to-end encryption | Internal company tool; adds key management complexity with no clear threat model benefit | Use transport-layer TLS (already standard on Railway) |
| Chat search across threads | Useful, but adds full-text search infrastructure (Postgres tsvector or Supabase pgvector); non-trivial | Add to backlog; deliver thread list navigation first |
| Global context / memory across threads | Agent "remembering" facts between separate topic threads is a complex memory architecture problem | Each thread is self-contained; compaction keeps context within the thread |
| Proactive agent messages (agent initiates chat) | Architecturally complex (who triggers? what event?); UX is often perceived as intrusive | Agents respond only; they do not initiate |
| Multi-agent conversations (agent-to-agent in chat) | Out of scope for this milestone; different communication pattern from human-to-agent chat | Existing agent task/issue system handles inter-agent coordination |

---

## Feature Dependencies

Dependencies define build order constraints. Later features require earlier ones to be in place.

```
DB schema (threads + messages tables)
  → Unified Chat API (CRUD for threads and messages)
    → Web UI thread list (reads threads from API)
    → Web UI chat view (reads messages from API)
    → Telegram bot API client (sends/receives via same API)
      → Telegram sender identity (stored on message record)
      → Telegram thread mapping (chat_id -> thread_id)

Unified Chat API
  → Agent wake on message (INSERT triggers run)
    → Run status polling (client polls run status)
      → "Agent is thinking" UI state

Agent wake on message
  → Context compaction at ingestion
    → Compaction pipeline (layered strategies)
      → Compaction triggers (token count thresholds)

Thread creation (explicit)
  → Topic naming / thread labeling
  → Thread list in sidebar

Thread list in sidebar
  → Agent-level chat tab (filtered view)
```

---

## MVP Recommendation

The minimal viable feature set that delivers the core value proposition ("board members and Telegram users can chat with any agent, with full history"):

**Build in Phase 1:**
1. DB schema — threads and messages tables with proper indexes
2. Unified Chat API — thread CRUD + message send/list endpoints
3. Agent wake on message — real-time push to existing execution system
4. Context compaction at ingestion — sliding window + summarization pipeline, token-threshold triggered
5. Web UI chat page — thread list in sidebar + message view
6. Telegram bot refactor — replace issue/comment pattern with unified Chat API calls

**Build in Phase 2 (polish):**
7. Thread naming / topic labels
8. Run status "thinking" indicator
9. Agent-level chat tab on agent detail page
10. Telegram thread reset command (`/new`)

**Defer beyond MVP:**
- Chat search
- Attachment support
- WebSocket streaming
- Token-level compaction metrics/visibility

---

## Compaction Feature Deep-Dive

Compaction is the most technically distinctive feature and warrants detailed decomposition.

### What users experience (the behavior contract)
- Agent always gives contextually relevant answers, even in thread 100+ messages long
- Full conversation history is always readable in the UI (no messages ever deleted)
- Agent responses don't degrade or hallucinate "I don't remember" for recent exchanges

### What the system does internally (implementation model)
- Full message history persisted to DB — never modified
- At ingestion time (before each agent LLM call), construct a prompt from:
  1. Recent N turns verbatim (configurable, e.g., last 20 messages)
  2. LLM-generated summary of all turns older than N
- Summary is NOT stored as a message — it is a derived artifact for prompt construction
- Token budget enforced: total prompt (system + summary + recent messages + new message) must fit within model's context window with headroom for response

### Compaction strategy ordering (pipeline)
Based on Microsoft's documented pipeline approach, from least to most aggressive:
1. Collapse tool-call results (cheap, no LLM required) — reclaim space from verbose outputs
2. Summarize old dialogue turns (moderate, requires a smaller/cheaper LLM) — preserve semantic context
3. Sliding window (aggressive, no LLM required) — hard limit on turn count
4. Truncation backstop (emergency) — drop oldest groups if still over budget

### Key compaction parameters to configure per agent
- `contextWindowTokens` — target model's context window size
- `verbatimTurns` — how many recent turns to keep in full (default: 20)
- `compactionTriggerThreshold` — % of context window usage before triggering (default: 75%)

---

## Sources

- Microsoft Learn — Threads, Runs, and Messages in Foundry Agent Service: https://learn.microsoft.com/en-us/azure/ai-foundry/agents/concepts/threads-runs-messages
- Microsoft Learn — Compaction strategies (Agent Framework): https://learn.microsoft.com/en-us/agent-framework/agents/conversations/compaction
- Medium — Automatic Context Compression in LLM Agents (March 2026): https://medium.com/the-ai-forum/automatic-context-compression-in-llm-agents-why-agents-need-to-forget-and-how-to-help-them-do-it-43bff14c341d
- Medium — Multi-turn Conversations with Agents: https://medium.com/@sainitesh/multi-turn-conversations-with-agents-building-context-across-dialogues-f0d9f14b8f64
- Smashing Magazine — Designing for Agentic AI UX Patterns (February 2026): https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/
- DEV Community — Two design patterns for Telegram Bots: https://dev.to/madhead/two-design-patterns-for-telegram-bots-59f5
- GetStream — Long Polling vs WebSockets: https://getstream.io/blog/long-polling-vs-websockets/
- n8n Community — Resetting AI agent chat conversations in Telegram: https://community.n8n.io/t/how-to-reset-clear-ai-agent-chat-conversation-if-using-chat-widget-or-telegram/61494
- GitHub DeerFlow Issue — Telegram private chat creates new thread per message: https://github.com/bytedance/deer-flow/issues/1101
- Mem0 — LLM Chat History Summarization Guide (2025): https://mem0.ai/blog/llm-chat-history-summarization-guide-2025
