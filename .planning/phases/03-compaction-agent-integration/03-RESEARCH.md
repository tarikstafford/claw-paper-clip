# Phase 3: Compaction and Agent Integration - Research

**Researched:** 2026-03-19
**Domain:** Token counting, conversation compaction, agent prompt injection
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMP-01 | Token counting per message using Anthropic SDK countTokens at write time | Verified: `@anthropic-ai/sdk` not yet installed; `client.messages.countTokens()` is the correct API. Must add dependency to `server/package.json`. |
| COMP-02 | Sliding window prompt builder — full recent messages + LLM-summarized older messages | Architecture: CompactionService called from chatService or directly by prompt builder; summarization via Anthropic Messages API. |
| COMP-03 | Compaction threshold at 55% of target model's context window | Claude Sonnet/Haiku: 200k tokens → threshold = 110,000. Must be model-aware. |
| COMP-04 | Compaction audit table — track when compaction occurred, what was summarized, token counts | New Drizzle table `chat_compaction_events`; new migration 0036. |
| COMP-05 | Thread context injection into agent prompt during heartbeat execution | `contextSnapshot.threadId` already flows into `execute()` ctx; inject via `context.paperclipChatThreadContext` read by `buildClaudeRuntimeConfig` → prompt template. |
</phase_requirements>

---

## Summary

Phase 3 adds exact token counting at message-write time, a prompt builder that compacts old messages into an LLM summary while preserving verbatim recent turns, and wires that compacted prompt into the agent's heartbeat execution context.

The key dependency gap is `@anthropic-ai/sdk` — the project does not currently depend on it. The SDK must be added to `server/package.json`. Token counting calls `client.messages.countTokens({ model, messages })` and returns `{ input_tokens: number }`. An `ANTHROPIC_API_KEY` environment variable must be present; the codebase already supports this via the claude-local adapter env config, so the server process will have access if configured.

The heartbeat execution path is well-understood: `enqueueWakeup` stores a `contextSnapshot` that includes `{ threadId, messageId, source: "chat.message" }`. That snapshot flows through `executeRun` → adapter `execute(ctx)` where `ctx.context` contains it. The Claude adapter already reads `ctx.context.paperclipSessionHandoffMarkdown` as a prompt section. The same mechanism — a new `context` key `paperclipChatThreadContext` — is the injection point for Phase 3. No heartbeat.ts changes are required; only `chat.ts` (route) needs to populate the context with the compacted thread, and the Claude adapter already concatenates prompt sections via `joinPromptSections`.

**Primary recommendation:** Add `@anthropic-ai/sdk` to server, implement `CompactionService` in `server/src/services/`, update `chatService.createMessage` to count tokens, and inject compacted context via `context.paperclipChatThreadContext` at wakeup time.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | `^0.61.0` (latest) | `client.messages.countTokens()` for exact token counts; Anthropic Messages API for summarization | Official Anthropic SDK; the only way to call `/v1/messages/count_tokens` and the Messages API |
| `drizzle-orm` | already `^0.38.4` | New `chat_compaction_events` table | Already used throughout; matches all existing schema patterns |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | already `^3.24.2` | Validate CompactionService config (verbatimTurns, threshold) | Already used for all request validation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@anthropic-ai/sdk countTokens` | Character-based estimate (e.g. chars / 4) | COMP-01 explicitly requires SDK countTokens — estimation does not satisfy the requirement |
| LLM summarization via Anthropic API | Rules-based extractive summary | LLM produces higher-quality summaries; requirement says "LLM summary" |

**Installation:**
```bash
pnpm --filter @paperclipai/server add @anthropic-ai/sdk
```

---

## Architecture Patterns

### New Service: CompactionService

`server/src/services/compaction.ts`

```
compaction.ts
  compactionService(db, anthropicClient)
    countTokensForMessage(body: string, model: string): Promise<number>
    buildThreadPrompt(threadId: string, model: string): Promise<{ prompt: string; wasCompacted: boolean; tokensBefore: number; tokensAfter: number }>
    maybeCompact(threadId: string, model: string): Promise<void>     // called internally by buildThreadPrompt
```

### Database: New Compaction Audit Table

`packages/db/src/schema/chat_compaction_events.ts`

```typescript
// Source: pattern matches existing schema files (chat_messages.ts, heartbeat_run_events.ts)
export const chatCompactionEvents = pgTable("chat_compaction_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  compactedMessageCount: integer("compacted_message_count").notNull(),
  summaryTokenCount: integer("summary_token_count").notNull(),
  tokenCountBefore: integer("token_count_before").notNull(),
  tokenCountAfter: integer("token_count_after").notNull(),
  summaryText: text("summary_text").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Migration: `packages/db/src/migrations/0036_<name>.sql`

### Pattern 1: Token Counting at Write Time (COMP-01)

**What:** After `chatService.createMessage` inserts a row, call `compactionService.countTokensForMessage(body, model)` and update the row's `tokenCount` column.
**When to use:** Every time a message is written via the API.

```typescript
// Source: Anthropic SDK docs — platform.claude.com/docs/en/api/typescript/messages/count_tokens
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const result = await client.messages.countTokens({
  model: "claude-sonnet-4-5",           // use the thread's target model
  messages: [{ role: "user", content: body }],
});
// result.input_tokens: number
```

**Note:** `countTokens` makes a real API call to `/v1/messages/count_tokens`. Requires `ANTHROPIC_API_KEY`. Must handle network failures gracefully — on failure, log error and leave `tokenCount` as `null` rather than failing the write.

### Pattern 2: Compaction Threshold (COMP-02, COMP-03)

**What:** Sum `token_count` for all messages in a thread. If sum >= 55% of the model's context window, trigger compaction. Compaction: pick the oldest N messages (all except the `verbatimTurns` most-recent), summarize them via Anthropic Messages API, store the summary, and record in `chat_compaction_events`.

```typescript
// Context windows (HIGH confidence — Anthropic docs March 2026)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-5":    200_000,
  "claude-sonnet-4-5":  200_000,
  "claude-haiku-3-5":   200_000,
  "claude-3-opus":      200_000,
  "claude-3-sonnet":    200_000,
  "claude-3-haiku":     200_000,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;
const COMPACTION_THRESHOLD_RATIO = 0.55;
const DEFAULT_VERBATIM_TURNS = 20;  // most-recent messages kept verbatim

function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

function shouldCompact(totalTokens: number, model: string): boolean {
  const threshold = Math.floor(getContextWindow(model) * COMPACTION_THRESHOLD_RATIO);
  return totalTokens >= threshold;
}
```

### Pattern 3: Compaction Algorithm (COMP-02)

```
messages = all thread messages, ordered chronologically
if messages.length <= verbatimTurns → no compaction needed

toSummarize = messages[0 .. messages.length - verbatimTurns - 1]
verbatimMessages = messages[messages.length - verbatimTurns ..]

summaryText = await callAnthropicSummarize(toSummarize)

prompt = "<Conversation summary>\n" + summaryText
       + "\n\n<Recent messages>\n" + formatVerbatim(verbatimMessages)
```

**Critical:** DB messages are NEVER modified or deleted. The compaction output is a read-time prompt construction only. The audit row in `chat_compaction_events` records what was done.

### Pattern 4: Summarization Prompt

```typescript
// Summarization prompt for Anthropic API
const SUMMARIZE_SYSTEM = `You are summarizing a conversation between a user and an AI agent.
Produce a concise structured summary that preserves:
- Key decisions made
- Questions asked and their answers
- Action items or tasks discussed
- Important context the agent needs to continue

Be factual. Do not add information not present in the messages.
Format: plain prose paragraphs, no headers needed.`;

const summaryResponse = await client.messages.create({
  model: "claude-haiku-3-5",  // cheap model for summarization
  max_tokens: 1024,
  system: SUMMARIZE_SYSTEM,
  messages: [
    {
      role: "user",
      content: `Summarize this conversation:\n\n${formattedMessages}`,
    },
  ],
});
```

### Pattern 5: Agent Context Injection (COMP-05)

**How context flows:** `chat.ts` route → `heartbeat.wakeup(agentId, { contextSnapshot })` → `executeRun` → `adapter.execute(ctx)` where `ctx.context = contextSnapshot`.

The Claude adapter already handles a `paperclipSessionHandoffMarkdown` key in context. Add a parallel key `paperclipChatThreadContext`:

```typescript
// In chat.ts route (POST /chat/threads/:threadId/messages)
// Build compacted prompt before enqueueing wakeup:
const compactedPrompt = await compactionSvc.buildThreadPrompt(threadId, model);

void heartbeat.wakeup(thread.agentId, {
  source: "on_demand",
  triggerDetail: "system",
  reason: "chat_message",
  payload: { threadId, messageId: message.id },
  requestedByActorType: actor.actorType,
  requestedByActorId: actor.actorId,
  contextSnapshot: {
    threadId,
    messageId: message.id,
    source: "chat.message",
    paperclipChatThreadContext: compactedPrompt,  // new field
  },
});
```

```typescript
// In claude-local adapter execute.ts (or a helper read in buildClaudeRuntimeConfig):
const chatThreadContext = asString(context.paperclipChatThreadContext, "").trim();
// ... included in joinPromptSections alongside sessionHandoffNote and renderedPrompt
const prompt = joinPromptSections([
  renderedBootstrapPrompt,
  sessionHandoffNote,
  chatThreadContext,   // inject compacted thread
  renderedPrompt,
]);
```

**Alternative (simpler, no adapter change):** Store `paperclipChatThreadContext` in contextSnapshot; expand it inside `renderTemplate` call in the agent's `promptTemplate` config via `{{context.paperclipChatThreadContext}}`. This requires zero adapter changes — agents already have full template access. This is the preferred approach.

### Recommended Project Structure for Phase 3

```
server/src/services/
├── chat.ts               # existing — add tokenCount update after createMessage
├── compaction.ts         # NEW — CompactionService
server/src/routes/
├── chat.ts               # existing — call compactionSvc.buildThreadPrompt before wakeup
packages/db/src/schema/
├── chat_compaction_events.ts   # NEW
├── index.ts              # add export
packages/db/src/migrations/
├── 0036_<name>.sql       # NEW — CREATE TABLE chat_compaction_events
```

### Anti-Patterns to Avoid

- **Compacting DB rows:** The requirement explicitly prohibits modifying stored messages. Compaction is prompt-construction only.
- **Counting tokens in the route handler:** countTokens is async and can fail. Do it as a background update after the message is inserted and the HTTP response is sent — or tolerate null and count synchronously on first read.
- **Using a model-specific SDK for token estimation:** Anthropic's tokenizer is not publicly available as a standalone library. `countTokens` API is the only reliable method.
- **Blocking wakeup on summarization:** If the compaction/summary LLM call is slow, it delays the agent wake. Consider: count tokens synchronously, build prompt from already-counted messages (no new LLM call needed unless compaction threshold is hit).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Character-based estimation | `@anthropic-ai/sdk client.messages.countTokens()` | Anthropic's tokenizer is non-public; character estimates are off by 2-4x for non-English or code |
| Anthropic API calls | Raw `fetch()` to `api.anthropic.com` | `@anthropic-ai/sdk` | SDK handles retry, auth, streaming, error normalization |
| Message formatting | Custom serialization | Map `senderType` to `role` (`user`/`assistant`) | Anthropic API requires `role` to alternate `user`/`assistant` |

**Key insight:** Both token counting and summarization go through `@anthropic-ai/sdk`. Single dependency, single client instance.

---

## Common Pitfalls

### Pitfall 1: Alternating Role Constraint
**What goes wrong:** Anthropic's Messages API requires messages to alternate `user`/`assistant`. A thread can have consecutive `user` messages (e.g., system messages or multi-user turns).
**Why it happens:** `senderType` is `user | agent | system` — maps to `user | assistant | user`. Two consecutive `user` senderTypes produce consecutive `user` roles.
**How to avoid:** Merge consecutive same-role messages before passing to `countTokens` or summarization. Or coerce `system` sender messages to `user` role with a label prefix like `[system]: ...`.
**Warning signs:** Anthropic API returns 400 "messages must alternate between user and assistant roles".

### Pitfall 2: countTokens API Key Requirement
**What goes wrong:** `countTokens` calls `/v1/messages/count_tokens` which requires a valid `ANTHROPIC_API_KEY`. In local deployments without an API key (subscription auth), countTokens will fail.
**Why it happens:** The Anthropic SDK countTokens endpoint is a real API call, not a local calculation.
**How to avoid:** Make token counting best-effort — wrap in try/catch, leave `tokenCount` as `null` on failure. Build the prompt builder to work even if some messages have `null` tokenCount (fall back to character estimate or omit from sum).
**Warning signs:** Every message has `tokenCount: null` in local dev environments.

### Pitfall 3: contextSnapshot Size
**What goes wrong:** `contextSnapshot` is stored as JSONB on `heartbeat_runs`. If `paperclipChatThreadContext` contains a large compacted prompt (e.g. 50k chars), it bloats the runs table.
**Why it happens:** The compacted prompt is embedded verbatim in contextSnapshot.
**How to avoid:** Only store `threadId` in contextSnapshot; build the prompt at execution time inside `executeRun` or the adapter, fetching messages fresh from DB. This is cleaner but requires a DB read at run time. Alternatively store only up to ~8KB of context.
**Warning signs:** heartbeat_runs table grows unusually fast; JSONB column > 64KB per row.

### Pitfall 4: Race Between createMessage and countTokens Update
**What goes wrong:** `createMessage` inserts, then immediately `countTokens` is called async. If `buildThreadPrompt` runs before `countTokens` finishes (another fast user message), the thread token sum is stale.
**Why it happens:** Token counting is async/non-blocking after insert.
**How to avoid:** Sum only messages with non-null `tokenCount`, OR perform countTokens synchronously before returning from createMessage (adds ~200ms latency to message send). The second option satisfies COMP-01 "at write time" most cleanly.

### Pitfall 5: COMP-03 Model Not Stored Per Thread
**What goes wrong:** The target model used to calculate the context window (COMP-03) is not stored on `chat_threads`. You don't know which model to use for the threshold calculation.
**Why it happens:** `chat_threads` has no `model` column. The agent's `runtimeConfig.model` is the source.
**How to avoid:** At compaction time, join `chat_threads` → `agents` → read `agents.runtimeConfig` → extract `model`. Default to `claude-sonnet-4-5` (200k) if not found.

---

## Code Examples

Verified patterns from official sources:

### Token Counting (single message)
```typescript
// Source: platform.claude.com/docs/en/api/typescript/messages/count_tokens
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function countMessageTokens(body: string): Promise<number | null> {
  try {
    const result = await client.messages.countTokens({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: body }],
    });
    return result.input_tokens;
  } catch (err) {
    return null; // best-effort
  }
}
```

### Normalizing Message Roles (avoiding alternating-role violation)
```typescript
function toAnthropicMessages(
  messages: Array<{ senderType: string; body: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.map((m) => ({
    role: m.senderType === "agent" ? "assistant" : "user",
    content: m.body,
  }));
}
// Note: if consecutive same roles appear, merge by concatenating content with "\n"
```

### Heartbeat invoke with contextSnapshot
```typescript
// Source: server/src/routes/chat.ts (existing pattern, line 93–101)
void heartbeat.wakeup(thread.agentId, {
  source: "on_demand",
  triggerDetail: "system",
  reason: "chat_message",
  payload: { threadId, messageId: message.id },
  requestedByActorType: actor.actorType,
  requestedByActorId: actor.actorId,
  contextSnapshot: { threadId, messageId: message.id, source: "chat.message" },
});
```

### CompactionService shell
```typescript
// server/src/services/compaction.ts
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { chatMessages, chatCompactionEvents, chatThreads, agents } from "@paperclipai/db";
import Anthropic from "@anthropic-ai/sdk";

const COMPACTION_THRESHOLD = 0.55;
const DEFAULT_VERBATIM_TURNS = 20;
const DEFAULT_CONTEXT_WINDOW = 200_000;

export function compactionService(db: Db, anthropicClient: Anthropic) {
  return {
    countMessageTokens: async (body: string, model: string): Promise<number | null> => { ... },
    buildThreadPrompt: async (threadId: string, model: string): Promise<string> => { ... },
  };
}
```

---

## Integration Map

### Where Existing Code Is Modified

| File | Change |
|------|--------|
| `server/src/services/chat.ts` | `createMessage` gains optional `tokenCount` update call after insert |
| `server/src/routes/chat.ts` | Before `heartbeat.wakeup`, call `compactionSvc.buildThreadPrompt` and pass result in `contextSnapshot.paperclipChatThreadContext` |
| `packages/db/src/schema/index.ts` | Export `chatCompactionEvents` |
| `server/package.json` | Add `@anthropic-ai/sdk` dependency |

### New Files

| File | Purpose |
|------|---------|
| `server/src/services/compaction.ts` | CompactionService |
| `packages/db/src/schema/chat_compaction_events.ts` | Audit table schema |
| `packages/db/src/migrations/0036_<name>.sql` | Migration for new table |

### HeartbeatService — Confirmed No Changes Needed

`heartbeatService.wakeup` already accepts `contextSnapshot: Record<string, unknown>`. Adding `paperclipChatThreadContext` to that object requires zero changes to `heartbeat.ts`.

The `executeRun` function passes `context` (= `contextSnapshot`) directly to `adapter.execute(ctx)`. The Claude adapter already reads arbitrary keys from `ctx.context` (e.g. `paperclipSessionHandoffMarkdown`, `wakeReason`, `taskId`). Therefore Phase 3 can inject chat context purely via contextSnapshot without modifying the adapter.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Character-based token estimation | `client.messages.countTokens()` API | Anthropic token count API released 2024 | Exact counts, eliminates all estimation error |
| Tiktoken (OpenAI tokenizer) for Anthropic models | Anthropic's own countTokens endpoint | 2024 | Anthropic's tokenizer differs from tiktoken; SDK is the only reliable method |

**Deprecated/outdated:**
- tiktoken for Anthropic: Anthropic does not use BPE identical to GPT; token counts differ by 5–15%.

---

## Open Questions

1. **Where is ANTHROPIC_API_KEY configured in production?**
   - What we know: `ANTHROPIC_API_KEY` is read by the claude-local adapter from `process.env`. The server itself currently has no direct Anthropic API dependency.
   - What's unclear: Will operators always have this key available? Local (subscription-auth) deployments will NOT have it.
   - Recommendation: Make token counting entirely best-effort. COMP-01 says "accurate token_count recorded at write time" but the system must still function when key is unavailable. Use null to signal uncounted.

2. **Model source for threshold calculation (COMP-03)**
   - What we know: `chat_threads` has `agentId`. Agent has `runtimeConfig` containing `model`.
   - What's unclear: Agent model config format — must read `agents.runtimeConfig.model` at compaction time.
   - Recommendation: At planning time, read `parseObject(agent.runtimeConfig).model` and fall back to `"claude-sonnet-4-5"` / 200k context window.

3. **verbatimTurns default**
   - What we know: STATE.md notes "verbatimTurns default (20) not validated against actual agent system prompt sizes".
   - What's unclear: Whether 20 turns is correct given typical system prompt token budgets.
   - Recommendation: Make `DEFAULT_VERBATIM_TURNS = 20` a named constant; document it as a tunable. Final value is a design decision, not a researched fact (LOW confidence).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `server/vitest.config.ts` (environment: "node") |
| Quick run command | `pnpm --filter @paperclipai/server test --run -- compaction` |
| Full suite command | `pnpm --filter @paperclipai/server test --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMP-01 | `createMessage` stores accurate token_count; null on API failure | unit | `pnpm --filter @paperclipai/server test --run -- compaction-service` | ❌ Wave 0 |
| COMP-02 | `buildThreadPrompt` returns verbatim recent + summary of older messages | unit | `pnpm --filter @paperclipai/server test --run -- compaction-service` | ❌ Wave 0 |
| COMP-03 | Compaction triggers at 55% of model context window | unit | `pnpm --filter @paperclipai/server test --run -- compaction-service` | ❌ Wave 0 |
| COMP-04 | `chat_compaction_events` row inserted on compaction with correct fields | unit | `pnpm --filter @paperclipai/server test --run -- compaction-service` | ❌ Wave 0 |
| COMP-05 | `contextSnapshot.paperclipChatThreadContext` populated when wakeup fired | unit | `pnpm --filter @paperclipai/server test --run -- chat-routes` | ❌ Wave 0 (extends existing `chat-routes.test.ts`) |

### Sampling Rate
- **Per task commit:** `pnpm --filter @paperclipai/server test --run -- compaction`
- **Per wave merge:** `pnpm --filter @paperclipai/server test --run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/src/__tests__/compaction-service.test.ts` — covers COMP-01, COMP-02, COMP-03, COMP-04
- [ ] `packages/db/src/schema/chat_compaction_events.ts` — required before service tests
- [ ] `packages/db/src/migrations/0036_<name>.sql` — DB migration
- [ ] `pnpm --filter @paperclipai/server add @anthropic-ai/sdk` — new SDK dependency

*(COMP-05 extends the existing `server/src/__tests__/chat-routes.test.ts` — file exists, new `it` blocks needed.)*

---

## Sources

### Primary (HIGH confidence)
- Anthropic TypeScript SDK docs — `platform.claude.com/docs/en/api/typescript/messages/count_tokens` — countTokens API, parameters, return type
- `/Users/tarikstafford/Desktop/Projects/claw-paper-clip/server/src/routes/chat.ts` — existing contextSnapshot shape passed to `heartbeat.wakeup`
- `/Users/tarikstafford/Desktop/Projects/claw-paper-clip/packages/adapters/claude-local/src/server/execute.ts` — confirmed `ctx.context` is read freely; `joinPromptSections` used for prompt assembly
- `/Users/tarikstafford/Desktop/Projects/claw-paper-clip/packages/db/src/schema/chat_messages.ts` — `tokenCount integer` column already exists (nullable)
- `/Users/tarikstafford/Desktop/Projects/claw-paper-clip/server/src/services/heartbeat.ts` lines 2309–2330 — `enqueueWakeup` accepts `contextSnapshot: Record<string, unknown>` (no schema enforcement)

### Secondary (MEDIUM confidence)
- Anthropic model context windows (200k for all Claude 3.x and Claude Sonnet/Haiku/Opus 4.x) — verified via Anthropic docs search
- `@anthropic-ai/sdk` npm package — version `^0.61.0` current as of March 2026

### Tertiary (LOW confidence)
- DEFAULT_VERBATIM_TURNS = 20 — design decision noted in STATE.md, not externally validated
- Summarization model choice (claude-haiku-3-5) — reasonable for cost, not benchmarked

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — countTokens API verified against official docs; SDK is the only supported method
- Architecture: HIGH — integration points confirmed by reading actual source files
- Pitfalls: HIGH — alternating role constraint and API key requirement verified against Anthropic API spec
- verbatimTurns default: LOW — noted as unvalidated in STATE.md

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable Anthropic API; SDK minor versions stable)
