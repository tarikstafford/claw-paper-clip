# Domain Pitfalls: Paperclip Chat System

**Domain:** Unified human-to-agent chat with LLM context compaction, multi-channel (web + Telegram) delivery
**Researched:** 2026-03-19
**Overall confidence:** HIGH (all critical pitfalls verified against official docs or multiple production sources)

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or silent production failures.

---

### Pitfall 1: Telegram Webhook Timeout Causes Cascading Duplicate Agent Runs

**What goes wrong:**
Telegram has a hard delivery timeout on webhook calls. If your endpoint does not respond within that window, Telegram assumes the update was not delivered and re-sends it — potentially dozens of times before giving up. If each re-delivery triggers an agent wake, the same user message can spawn multiple concurrent agent runs.

**Why it happens:**
The naive implementation sends the message to the DB, wakes the agent, waits for agent acknowledgement, then returns 200 to Telegram. Agent execution takes several seconds. The endpoint misses the Telegram timeout. Telegram retries. Chaos.

**Consequences:**
- The agent responds to the same message 2–30+ times
- Duplicate messages written to the chat thread
- Agent execution costs multiply
- If agent waking is not idempotent, downstream side effects (tool calls, issue creation) duplicate

**Prevention:**
- Respond 200 to Telegram immediately upon receipt — before any agent logic
- Enqueue the agent wake as a background task (queue or async job) that runs after the 200 is returned
- Store `telegram_update_id` on every message; add a unique constraint so duplicate deliveries fail silently at the DB layer rather than creating duplicate runs
- Apply idempotency key pattern: `ON CONFLICT DO NOTHING` on insert keyed by `telegram_update_id`

**Detection (warning signs):**
- Telegram logs show retry attempts for the same update_id
- Chat threads show duplicate agent responses with identical content
- Agent execution logs show two runs with the same `thread_id` + `triggered_by_message_id`

**Phase to address:** Database schema phase (add unique constraint on telegram_update_id) + Telegram integration phase (respond-then-queue pattern)

---

### Pitfall 2: Context Rot Before Hard Token Limits Are Reached

**What goes wrong:**
Developers assume LLM quality degrades only when the context window is exceeded. In practice, attention degrades much earlier — models concentrate attention on the beginning and end of the prompt; content in the middle receives less reliable processing. A thread with 40 messages can exhibit hallucinations and ignored instructions while still fitting inside the context window.

**Why it happens:**
The compaction trigger is set to fire only near the token limit (e.g., 90% full). By then, several responses have already been generated with degraded context. The effective usable window is 50–65% of the advertised limit across most models.

**Consequences:**
- Agent responses become inconsistent or contradictory without any visible error
- Users report that the agent "forgot" earlier context even though history was not compacted
- The compaction system looks like it is working but degradation is invisible

**Prevention:**
- Set the compaction threshold at 50–60% of the model's stated context limit, not 80–90%
- Treat the effective window as `(model_context_tokens * 0.6)` when deciding when to summarize
- In compacted context, put the summary at the top of the prompt, then most-recent N turns at the bottom — never bury critical context in the middle
- Test with 20+ turn threads, not just 3–5 turn unit tests

**Detection (warning signs):**
- Agent responses stop referencing facts from the early part of a long thread
- Response quality drops without context overflow errors
- Token usage per call is 40%+ of model limit

**Phase to address:** Compaction implementation phase

---

### Pitfall 3: Compaction Summarization Introduces Hallucinated Facts (Contextual Drift)

**What goes wrong:**
The summarization call rewrites old messages in condensed form. Each round of summarization can silently alter precise details — agent names, decision outcomes, numbers, file paths, code snippets. Over multiple compaction cycles, the summary diverges from what was actually said.

**Why it happens:**
LLMs are generative. Summarization is not lossless compression — it is creative rewriting. When summarizing a summary (progressive compaction), errors compound.

**Consequences:**
- The agent references incorrect facts from summarized history
- Board members receive responses that contradict earlier decisions
- Bugs are introduced if the agent acts on hallucinated historical context (wrong agent names, wrong issue IDs)

**Prevention:**
- Summarize only once per conversation segment — never re-summarize an existing summary
- Use structured extraction rather than free-form summarization: "Extract the following fields: decisions made, action items, agent referenced, key facts stated"
- Preserve raw messages in the DB unconditionally; the summary is only used for LLM injection, never as the authoritative record
- Include a summary confidence marker in the prompt: "The following is a compressed summary. If a detail is ambiguous, ask the user to clarify rather than assuming."

**Detection (warning signs):**
- Agent responses reference decisions that are slightly different from what appears in the DB message log
- Differences between the stored summary text and the actual DB messages
- Users correct the agent on facts from earlier in the conversation

**Phase to address:** Compaction implementation phase

---

### Pitfall 4: Channel-Specific State — Thread Identity Diverges Across Web and Telegram

**What goes wrong:**
Telegram messages and web UI messages are stored in separate tables or identified differently, so the agent receives incomplete thread context depending on which channel sent the most recent message. A board member who chatted on the web and then continued on Telegram appears to be two different users starting new threads.

**Why it happens:**
The Telegram bot is built as a separate Railway service. It is tempting to have it maintain its own thread state rather than consuming the shared chat API. This is the "channel-specific state storage" trap: each platform stores its own copy of the conversation.

**Consequences:**
- Agent loses context when user switches channels
- Duplicate threads are created for the same user/agent pair
- The "full history always accessible" requirement fails silently

**Prevention:**
- All message writes must go through the unified chat API — the Telegram bot must be a thin adapter that POSTs to the same `/api/chat/threads/:id/messages` endpoint as the web UI
- Thread ID is the canonical identity; it must be created once and referenced from both channels
- The Telegram bot stores only the mapping: `telegram_chat_id → thread_id` — no conversation state of its own
- Test explicitly: send 3 web messages, then 3 Telegram messages, verify agent receives all 6 in context

**Detection (warning signs):**
- Agent responses to Telegram messages lack awareness of earlier web UI messages
- Two threads exist in the DB for the same user/agent pair
- `thread_id` is never referenced in the Telegram bot's state

**Phase to address:** API design phase (unified endpoint) + Telegram integration phase (thin adapter pattern)

---

### Pitfall 5: Agent Wake Race Condition — Concurrent Runs on the Same Thread

**What goes wrong:**
A new message triggers an agent wake. Before the first run completes, a second message arrives (user is impatient, or Telegram retries), triggering a second wake. Both runs read the same thread state, generate responses, and write back — creating duplicate or interleaved agent replies.

**Why it happens:**
The heartbeat/wake system has no concept of "this thread is currently being processed." Each message independently triggers a run without checking for an inflight execution.

**Consequences:**
- Two agent responses to one user message
- Responses reference different "last message" — one may respond to message N, one to message N-1
- Session state in the agent gets corrupted if two runs try to write to the same context simultaneously

**Prevention:**
- Add a `processing_status` column to threads: `idle | processing | error`
- The wake trigger checks: if `processing_status = processing`, skip (the inflight run will process the queued message when it completes)
- Use a DB-level advisory lock or `SELECT ... FOR UPDATE SKIP LOCKED` pattern when claiming a thread for processing
- Agent run always re-fetches the latest messages from DB at execution time — not from the trigger payload

**Detection (warning signs):**
- Two consecutive messages in the thread both attributed to the agent with different content
- Agent execution logs show overlapping `started_at` / `ended_at` timestamps for the same `thread_id`

**Phase to address:** Agent wake + real-time integration phase

---

### Pitfall 6: Token Counting Uses Estimates, Causing Compaction to Fire Too Late or Too Early

**What goes wrong:**
Token counts are estimated (e.g., `chars / 4`) instead of being computed with the actual tokenizer for the target model. GPT-4o, Claude, and Gemini have different tokenizers. Emoji, code blocks, and non-ASCII characters tokenize very differently across models. The compaction trigger fires at the wrong threshold.

**Why it happens:**
Exact tokenization requires importing a model-specific tokenizer library (tiktoken for OpenAI, the Anthropic SDK's count_tokens, etc.). Developers use a rough heuristic instead.

**Consequences:**
- Compaction fires too early: threads summarized after 5 turns, destroying recent context needlessly
- Compaction fires too late: context overflow errors during LLM calls, or context rot in long threads
- Token budget math is wrong, so the compacted prompt still exceeds limits

**Prevention:**
- Use model-specific token counting: `tiktoken` for OpenAI models, `anthropic.messages.count_tokens()` for Claude, etc.
- Store `token_count` on each message at write time (computed once, not re-estimated on every read)
- Apply a 10% safety margin: if model limit is 128K tokens, treat 115K as the ceiling
- Track cumulative thread token count as a materialized value on the threads table, updated on each message insert

**Detection (warning signs):**
- Context overflow errors in agent execution logs on threads that "should" have been compacted
- Compaction triggering after only 2–3 messages on long-text threads
- Token count column and actual API usage (from response metadata) diverge by more than 15%

**Phase to address:** Compaction implementation phase + database schema phase

---

### Pitfall 7: Telegram MarkdownV2 Formatting Breaks Agent Responses

**What goes wrong:**
Agent responses often contain characters that have special meaning in Telegram's MarkdownV2 format: `.`, `-`, `(`, `)`, `!`, `#`, `+`, `=`, `|`, `{`, `}`, `~`. Any unescaped occurrence causes a "Can't parse entities" error and Telegram silently drops the message or the bot crashes.

**Why it happens:**
LLM output is uncontrolled prose. The agent may generate any text. A response like "Use version 1.2.3 — it's stable." contains `.` characters that must be escaped in MarkdownV2 but are never escaped automatically.

**Consequences:**
- Agent responses fail to deliver on Telegram silently (the error is returned by the API but not visible to the user)
- The bot crashes or enters an error state if the exception is unhandled
- Board members receive no response with no indication that anything went wrong

**Prevention:**
- Do not use MarkdownV2 for dynamic agent output. Use HTML parse mode instead — it requires only `<`, `>`, `&` escaping, which is predictable and safe
- Alternatively, send the raw text with `entities` array (pre-parsed entities) and `parse_mode` omitted — this is the safest approach for uncontrolled LLM output
- Apply a sanitization pass to agent output before sending: escape or strip problematic characters based on chosen parse mode
- Add Telegram send failures to an error log with the message content — silent delivery failures are a common debugging trap

**Detection (warning signs):**
- Telegram API returns 400 with "Bad Request: can't parse entities"
- Agent execution logs show a completed run but no Telegram message is received by the user
- Error rate spikes after agent responses containing code blocks, version numbers, or bullet lists

**Phase to address:** Telegram integration phase

---

## Moderate Pitfalls

### Pitfall 8: Reusing Issues/Comments Table Instead of Dedicated Chat Tables

**What goes wrong:**
The existing Paperclip platform has issues and comments tables. It is tempting to add `is_chat = true` flags and reuse them to avoid new migrations. This creates long-term schema debt: issues have lifecycles (open/closed/assigned), comments have issue-specific metadata, and the data model breaks down when chat-specific features (topic threading, compaction metadata, telegram_update_id) need to be added.

**Why it happens:**
Migration avoidance. The existing table is "close enough" for v1.

**Prevention:**
- Build dedicated `chat_threads` and `chat_messages` tables from the start — the PROJECT.md decision to do this is correct and should not be walked back
- The existing Telegram bot's issue-per-conversation pattern must be fully migrated, not shimmed
- Schema migrations are cheaper now than refactoring a production chat system later

**Phase to address:** Database schema phase (Phase 1)

---

### Pitfall 9: Polling-Based Agent Status Creates Stale UX Despite "Real-Time" Wake

**What goes wrong:**
The agent is woken immediately when a new message arrives (good), but the UI polls for responses on a fixed interval (e.g., every 5 seconds). The user sends a message, the agent responds in 2 seconds, but the UI does not show it for up to 5 seconds. This undermines the impression of real-time communication even though the infrastructure is correct.

**Why it happens:**
WebSocket streaming is explicitly out of scope. Polling is the chosen mechanism. Polling interval is set conservatively.

**Prevention:**
- Use a 1–2 second polling interval for the active/focused chat window (not a global setting)
- Trigger an immediate poll on message send ("optimistic fetch") — poll once right after sending, then resume normal interval
- Show a "waiting for agent..." indicator between send and response arrival, not a blank state
- Pause polling when the tab/window is not focused to avoid unnecessary DB load

**Phase to address:** UI implementation phase

---

### Pitfall 10: Missing Idempotency on the Unified Chat API Itself

**What goes wrong:**
Network failures can cause client retries. If the web UI's fetch fails after the server has already written the message to the DB, a retry creates a duplicate message. Telegram's retry behavior (described in Pitfall 1) also affects the chat API if the Telegram adapter does not deduplicate before calling the API.

**Prevention:**
- Accept an optional `idempotency_key` on the message POST endpoint
- Store the key with the message; return the existing message if the key has been seen before (within a TTL window, e.g., 5 minutes)
- The Telegram adapter must use `telegram_update_id` as the idempotency key when calling the chat API

**Phase to address:** API implementation phase

---

### Pitfall 11: Compaction Metadata Not Stored — Cannot Debug or Audit Compacted Threads

**What goes wrong:**
When compaction fires, the summary is generated and injected into the LLM prompt but is never stored. If a user asks "why did the agent say X?", there is no way to inspect what the compacted context contained at that point in time.

**Prevention:**
- Store compaction summaries in a `chat_thread_compactions` table: `thread_id`, `created_at`, `summarized_through_message_id`, `summary_text`, `token_count`
- Associate each agent response with the `compaction_id` that was active when it was generated
- This is the audit trail required for diagnosing agent hallucinations that originate from bad compaction

**Phase to address:** Compaction implementation phase

---

## Minor Pitfalls

### Pitfall 12: One Thread Per Telegram Group/DM Forces `/new` for Topic Switching

**What goes wrong:**
The "one thread per Telegram group/DM" decision is sensible but creates a UX gap: a user chatting about one topic in a Telegram group cannot easily switch agents or topics without the `/new` command. If `/new` is not prominently documented, users perceive the bot as context-confused.

**Prevention:**
- Implement `/new [agent-name]` command that creates a new thread for the specified agent and confirms the switch
- Confirm thread resets with a message: "Starting a new conversation with [agent]. Previous conversation is archived."
- Document available agents with a `/list` command

**Phase to address:** Telegram integration phase

---

### Pitfall 13: Agent API Key Auth Not Scoped Per-Agent for Chat Endpoint

**What goes wrong:**
The Telegram bot uses agent API keys for authentication. If the same key is used for all agents, a compromised key gives access to all agent threads. If key auth is too permissive, the Telegram bot can impersonate agents it is not supposed to represent.

**Prevention:**
- API keys used by the Telegram bot should be scoped to write messages as a Telegram source, not as a specific agent
- Agent identity in the chat system should come from the thread's `agent_id` field, not from the API key
- Separate the "who can post messages" auth from "which agent processes messages" routing

**Phase to address:** API implementation phase

---

### Pitfall 14: No Backpressure on Agent Wake — High Message Volume Spawns Too Many Runs

**What goes wrong:**
If a Telegram group sends 20 messages in quick succession (e.g., several board members all messaging at once), 20 wake signals are queued. The agent is invoked 20 times. Most runs will see the same thread state (since the first run hasn't responded yet) and generate 20 nearly-identical responses.

**Prevention:**
- Debounce the agent wake: if a wake is already queued or inflight for a thread, discard the new wake signal
- The processing_status guard from Pitfall 5 handles most of this — an inflight run will naturally see all queued messages when it re-reads thread state at execution time

**Phase to address:** Agent wake integration phase

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Database schema design | Adding chat_type flags to existing issues/comments tables instead of new tables | Dedicated tables from the start (Pitfall 8) |
| Compaction threshold setting | Firing at 90% of context limit, hitting context rot before compaction | Use 50–60% threshold (Pitfall 2) |
| Compaction implementation | Using free-form summarization, leading to hallucinated facts | Structured extraction over creative rewriting (Pitfall 3) |
| Token budget math | Heuristic `chars/4` estimation | Model-specific tokenizer at message write time (Pitfall 6) |
| Telegram webhook setup | Responding slowly, causing Telegram to retry and spawn duplicate agent runs | Respond 200 immediately, queue agent wake (Pitfall 1) |
| Telegram message formatting | MarkdownV2 breaking on LLM output | Use HTML parse mode or entities array (Pitfall 7) |
| Multi-channel identity | Telegram bot maintaining its own thread state | Thin adapter pattern, all writes via unified API (Pitfall 4) |
| Agent wake mechanism | Concurrent runs on the same thread | processing_status column + advisory lock (Pitfall 5) |
| API design | No idempotency on message creation endpoint | Accept idempotency_key, deduplicate by telegram_update_id (Pitfall 10) |
| UI polling | 5-second polling feels slow even with instant agent wake | 1–2 second polling on active thread + optimistic fetch on send (Pitfall 9) |

---

## Sources

- [Context Window Overflow in 2026: Fix LLM Errors Fast — Redis](https://redis.io/blog/context-window-overflow/) — HIGH confidence, official Redis engineering blog
- [Multi-Channel Chatbot Synchronization: When Your Bot Has Multiple Personalities Across Platforms — DEV Community](https://dev.to/faraz_farhan_83ed23a154a2/multi-channel-chatbot-synchronization-when-your-bot-has-multiple-personalities-across-platforms-cle) — MEDIUM confidence, production case study
- [Long Polling vs. Webhooks — grammY official docs](https://grammy.dev/guide/deployment-types) — HIGH confidence, official Telegram bot framework documentation
- [Processing the same update multiple times — telegraf/telegraf GitHub Issue #806](https://github.com/telegraf/telegraf/issues/806) — HIGH confidence, documented production issue in major Telegram library
- [Telegram MarkdownV2 Formatting — DeepWiki](https://deepwiki.com/cvzi/telegram-bot-cloudflare/6.3-markdownv2-formatting) — MEDIUM confidence, documented API behavior matches official Telegram docs
- [Context Rot: Why AI Gets Worse the Longer You Chat — Product Talk](https://www.producttalk.org/context-rot/) — MEDIUM confidence, multiple sources corroborate
- [The Fundamentals of Context Management and Compaction in LLMs — Medium](https://kargarisaac.medium.com/the-fundamentals-of-context-management-and-compaction-in-llms-171ea31741a2) — MEDIUM confidence
- [Context Compaction Research: Claude Code, Codex CLI — GitHub Gist](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f) — MEDIUM confidence, real-world compaction implementation analysis
- [Stop LLM Summarization From Failing Users — Galileo](https://galileo.ai/blog/llm-summarization-production-guide) — LOW confidence (page content not accessible, title only)
- [Idempotent Consumer Pattern — microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html) — HIGH confidence, canonical pattern reference
- [Building Stateful Conversations with Postgres and LLMs — Medium](https://medium.com/@levi_stringer/building-stateful-conversations-with-postgres-and-llms-e6bb2a5ff73e) — MEDIUM confidence
- [Telegram Bot API official documentation](https://core.telegram.org/bots/api) — HIGH confidence
