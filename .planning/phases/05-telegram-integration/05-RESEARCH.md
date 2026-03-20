# Phase 5: Telegram Integration - Research

**Researched:** 2026-03-19
**Domain:** Telegram Bot API webhook handler + unified chat API migration in a Fastify-based microservice
**Confidence:** HIGH — all findings sourced from the project's own codebase; no external library guesswork required

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TELE-01 | Migrate Telegram bot from issues/comments API to unified chat API | `paperclip.ts` calls `createConversationIssue` and `postBoardMessage` — replace both with `POST /companies/:companyId/chat/threads` + `POST /chat/threads/:threadId/messages`; thread lookup replaces `getConversation().issueId` |
| TELE-02 | Respond 200 to webhook immediately, enqueue message processing | Current `app.ts` already does this structurally (fires `handleBoardMessage` without `await`, returns 200) but uses `.catch` only — needs explicit fire-and-forget with no blocking |
| TELE-03 | One thread per Telegram group/DM — auto-create on first message | `chatId` → `threadId` mapping replaces the existing `conversation-store.ts` JSON file; new thread created via chat API on first message, threadId persisted |
| TELE-04 | /new command resets thread (creates new one for that chat) | Already implemented pattern in `app.ts`; replace `issueId: ''` reset with removing/clearing `threadId` from the new thread store |
| TELE-05 | Use HTML parse mode for agent responses (not Markdown) | `telegram.ts` currently sends with `parse_mode: 'Markdown'`; must change to `parse_mode: 'HTML'`; `formatForTelegram` must emit HTML tags, not Markdown syntax |
| TELE-06 | Forward agent responses from chat API back to Telegram chat | Replace the `pollCeoReplies` poller (which polls Paperclip issues/comments) with polling `GET /chat/threads/:threadId/messages`; filter for `senderType === 'agent'`, forward to Telegram |
| TELE-07 | Dedup guard — skip messages with already-processed telegram_update_id | Pass `telegramUpdateId` (from `update.update_id`) when calling `POST /chat/threads/:threadId/messages`; DB unique constraint on `telegram_update_id` already exists (DATA-03); handle 409/conflict response to silently skip duplicates |
</phase_requirements>

---

## Summary

Phase 5 rewires the Telegram bot service to use the unified chat API built in Phase 2 instead of the legacy issues/comments API. The change is a targeted rewrite of two files (`paperclip.ts` and `conversation-manager.ts`) plus a parse-mode switch in `telegram.ts`. The skeleton of the bot — Fastify webhook server, `isBotMentioned` guard, `/help` and `/new` commands, authorization allowlist — is kept intact.

The architecture split is: the webhook handler returns 200 immediately (fire-and-forget), a background poller delivers agent replies to Telegram. Both patterns exist today. The migration changes the data storage layer (from a JSON file tracking `issueId` to one tracking `threadId`) and the API calls (from issues endpoints to chat endpoints).

The most important technical constraint is that the telegram-bot is a **separate process** from the main server. It cannot subscribe to the server's in-process `live-events.ts` EventEmitter. Therefore the reply-forwarding mechanism must remain polling-based, polling `GET /chat/threads/:threadId/messages` against the chat API instead of `GET /api/issues/:issueId/comments`. The poll interval and dedup logic remain unchanged structurally.

**Primary recommendation:** Replace the contents of `services/telegram-bot/src/lib/paperclip.ts` and `services/telegram-bot/src/conversation-manager.ts` wholesale. Update `telegram.ts` to use HTML parse mode. The conversation-store interface stays the same (chatId → entry) but the entry carries `threadId` instead of `issueId`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | ^5.7.4 | HTTP server for webhook | Already the bot's HTTP framework |
| node fetch (global) | Node 18+ built-in | HTTP calls to chat API | Already used in `paperclip.ts` |
| dotenv | ^16.4.0 | Env var loading | Already installed |
| tsx | ^4.19.1 | TypeScript execution | Already installed |

### No new packages required
All Phase 5 work uses the existing bot dependencies. The chat API is accessed over HTTP using the global `fetch` already present.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polling `GET /chat/threads/:threadId/messages` | In-process EventEmitter subscription | Bot is a separate process — cannot subscribe to server's EventEmitter; polling is the only viable approach |
| JSON file conversation store | Postgres/Redis store | JSON file already works; adding a DB for the bot service is out of scope for v1 |
| `parse_mode: 'HTML'` | `parse_mode: 'MarkdownV2'` | MarkdownV2 requires escaping every special character in agent output; HTML is simpler and is the requirement (TELE-05) |

---

## Architecture Patterns

### Current Bot Architecture
```
services/telegram-bot/src/
├── main.ts                    # startup: server + webhook registration + poller
├── app.ts                     # Fastify webhook route + command routing
├── conversation-manager.ts    # handleBoardMessage() + pollCeoReplies() + startPoller()
└── lib/
    ├── conversation-store.ts  # JSON file store: chatId → { issueId, lastSeenCommentId }
    ├── paperclip.ts           # API calls: createConversationIssue, postBoardMessage, getNewComments
    └── telegram.ts            # sendMessage, setWebhook, TelegramUpdate type
```

### Target Architecture After Phase 5
```
services/telegram-bot/src/
├── main.ts                    # unchanged
├── app.ts                     # unchanged (fire-and-forget already correct)
├── conversation-manager.ts    # rewritten: uses chat API instead of issues API
└── lib/
    ├── conversation-store.ts  # updated: issueId → threadId, lastSeenMessageId instead of lastSeenCommentId
    ├── paperclip.ts           # rewritten: createThread, postMessage, getNewMessages via chat API
    └── telegram.ts            # updated: parse_mode HTML, formatForTelegramHtml() replacing formatForTelegram()
```

### Pattern 1: Fire-and-Forget Webhook Handler
**What:** Webhook returns HTTP 200 immediately; message processing runs in background
**When to use:** Always — Telegram re-sends updates if webhook doesn't respond within 5 seconds
**Example:**
```typescript
// services/telegram-bot/src/app.ts (TELE-02 — already correct structurally)
app.post('/webhook', async (request, reply) => {
  const update = request.body as TelegramUpdate;
  // ...guard checks...

  // Fire-and-forget: do NOT await
  handleBoardMessage(chatId, username, cleanText, update.update_id).catch((err: Error) => {
    console.error('[app] handleBoardMessage error:', err.message);
  });

  return reply.code(200).send({ ok: true });
});
```

### Pattern 2: Chat API Thread Lifecycle
**What:** chatId maps to a single threadId; created on first message, reset on /new
**When to use:** Every inbound Telegram message

```typescript
// services/telegram-bot/src/lib/paperclip.ts

// Create thread (TELE-03: first message or after /new)
export async function createChatThread(
  chatId: number,
  username: string,
): Promise<string> {
  const body = {
    agentId: CEO_AGENT_ID,
    title: `Telegram: ${username}`,
  };
  const thread = await chatFetch(
    `/api/companies/${COMPANY_ID}/chat/threads`,
    { method: 'POST', body: JSON.stringify(body) },
  ) as { id: string };
  return thread.id;
}

// Post message to thread (TELE-01, TELE-07: includes telegramUpdateId for dedup)
export async function postChatMessage(
  threadId: string,
  body: string,
  telegramUpdateId: number,
): Promise<void> {
  await chatFetch(
    `/api/chat/threads/${threadId}/messages`,
    { method: 'POST', body: JSON.stringify({ body, telegramUpdateId }) },
  );
}
```

**Note on TELE-07 dedup:** The `sendMessageSchema` in `@paperclipai/shared` must be updated to accept an optional `telegramUpdateId` field, and `chatService.createMessage` must pass it through. The DB unique constraint already exists — a duplicate `telegram_update_id` will trigger a Postgres unique violation. The route or service must catch this and return a 409 (or silently succeed). The bot should treat a 409 on message post as a successful dedup (already processed).

### Pattern 3: Agent Reply Polling
**What:** Background poller calls `GET /chat/threads/:threadId/messages?after=:lastMessageId` to find new agent messages
**When to use:** Every `POLL_INTERVAL_MS` (default 30s)

```typescript
// services/telegram-bot/src/conversation-manager.ts

export async function pollAgentReplies(): Promise<void> {
  const conversations = getAllConversations();
  for (const conversation of conversations) {
    if (!conversation.threadId) continue;

    const newMessages = await getNewMessages(
      conversation.threadId,
      conversation.lastSeenMessageId,
    );

    // Filter to agent messages only — skip user messages we just posted
    const agentMessages = newMessages.filter(
      (m) => m.senderType === 'agent',
    );

    for (const msg of agentMessages) {
      if (forwardedMessageIds.has(msg.id)) continue;
      forwardedMessageIds.add(msg.id);
      await sendMessage(conversation.chatId, formatForTelegramHtml(msg.body));
    }

    // Advance cursor past all new messages (not just agent ones)
    if (newMessages.length > 0) {
      const latest = newMessages[newMessages.length - 1];
      if (latest) updateLastSeen(conversation.chatId, latest.id);
    }
  }
}
```

### Pattern 4: HTML Formatting for Telegram
**What:** Agent Markdown output converted to Telegram HTML
**When to use:** Every agent message forwarded to Telegram (TELE-05)

```typescript
// services/telegram-bot/src/lib/telegram.ts

function formatForTelegramHtml(text: string): string {
  return text
    // Convert **bold** to <b>bold</b>
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Convert *italic* to <i>italic</i>
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    // Convert `code` to <code>code</code>
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Remove heading markers (Telegram HTML has no headings)
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    // Clean up multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sendMessage(chatId: number | string, text: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    // On HTML parse failure, fall back to plain text
    const body = await res.text();
    if (body.includes("can't parse entities")) {
      await fetch(`${TELEGRAM_API}/bot${TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    }
  }
}
```

### Pattern 5: ConversationStore Schema Update
**What:** Rename `issueId` to `threadId`, `lastSeenCommentId` to `lastSeenMessageId`

```typescript
// services/telegram-bot/src/lib/conversation-store.ts
export interface ConversationEntry {
  threadId: string;         // was: issueId
  chatId: number;
  username: string;
  lastSeenMessageId: string | null;  // was: lastSeenCommentId
  updatedAt: string;
}
```

### Anti-Patterns to Avoid
- **Awaiting handleBoardMessage in the webhook handler:** This would block the 200 response and cause Telegram to retry. Keep fire-and-forget.
- **Polling the issues/comments API for agent replies:** After migration, agent responses live in `chat_messages` not issue comments. Polling the old endpoint will find nothing.
- **Using MarkdownV2 parse mode:** Agent output contains characters that must be escaped in MarkdownV2 (`_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`). Unescaped characters cause Telegram to reject the message. HTML is safer and is the requirement.
- **Blocking on duplicate update_id handling:** If the DB raises a unique constraint violation, the bot should catch it at the API call level (expect a 409 or catch a network error) and return early — not crash.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thread ↔ chatId mapping persistence | Custom database or Redis for bot | Existing JSON file `conversation-store.ts` | Sufficient for single-instance bot; no new infra needed |
| Dedup at application layer (Set in memory) | Build application-level dedup cache | DB unique constraint on `telegram_update_id` (DATA-03) | DB constraint is the canonical guard; in-memory Set in `forwardedMessageIds` is a secondary efficiency guard |
| HTML sanitization of agent output | Build a full HTML escaper | Simple regex-based `formatForTelegramHtml` | Telegram HTML subset is small: `<b>`, `<i>`, `<code>`, `<pre>`, `<a>`. Regex is sufficient. |
| Auth for chat API calls from bot | New auth mechanism | Existing `PAPERCLIP_API_KEY` + `Authorization: Bearer` header pattern | The chat API already authenticates agent API keys via `actorMiddleware` |

---

## Common Pitfalls

### Pitfall 1: sendMessageSchema Does Not Accept telegramUpdateId
**What goes wrong:** `POST /chat/threads/:threadId/messages` returns 400 because `sendMessageSchema` only allows `body`, not `telegramUpdateId`
**Why it happens:** The Zod schema in `@paperclipai/shared` was created for Phase 2 and does not include `telegramUpdateId`
**How to avoid:** Update `sendMessageSchema` in `packages/shared/src/validators/` to add `telegramUpdateId: z.number().int().optional()` and re-export. Update `chatService.createMessage` to accept and pass it.
**Warning signs:** 400 response from message POST with validation error body mentioning unknown key

### Pitfall 2: Duplicate Telegram Update Processing on Crash/Restart
**What goes wrong:** Bot crashes after message is posted to chat API but before the 200 is sent. Telegram re-sends the update. Without dedup, the message is inserted twice.
**Why it happens:** The DB unique constraint (DATA-03) only fires if `telegramUpdateId` is actually passed. If the migration omits sending `telegramUpdateId`, the constraint never fires.
**How to avoid:** Always pass `telegramUpdateId: update.update_id` to `handleBoardMessage` and down to the API call. Catch the resulting 409 (or DB unique violation surfaced as an API error) and silently succeed.
**Warning signs:** Duplicate messages appearing in threads after bot restart

### Pitfall 3: CEO Agent Replies Not Forwarded After Migration
**What goes wrong:** Agent posts response to `chat_messages` (via `POST /chat/threads/:threadId/messages` with agent API key). Bot's poller still queries issue comments → finds nothing → never forwards to Telegram.
**Why it happens:** `pollCeoReplies` in `conversation-manager.ts` calls `getNewComments` which hits `/api/issues/:issueId/comments`
**How to avoid:** Replace `pollCeoReplies` with `pollAgentReplies` that calls `GET /chat/threads/:threadId/messages?after=:lastMessageId`. Filter to `senderType === 'agent'`.
**Warning signs:** Telegram messages go in (no error) but no reply ever arrives

### Pitfall 4: Thread Not Found After /new Reset
**What goes wrong:** After `/new`, the conversation store clears `threadId`. The next message calls `postChatMessage` before `createChatThread` completes. Race condition if fire-and-forget is not carefully sequenced.
**Why it happens:** `handleBoardMessage` in current code checks `conversation.issueId`, creates issue if missing. Same pattern must apply for `threadId` — check before post, create if absent.
**How to avoid:** In `handleBoardMessage`, always check `conversation?.threadId` first. If absent or empty, call `createChatThread` first (await it), persist the new `threadId`, then post the message.
**Warning signs:** 404 from message POST (thread doesn't exist)

### Pitfall 5: Poller Storing lastSeenMessageId as Comment ID
**What goes wrong:** After migration, bot still has old `conversation-store.json` entries with `lastSeenCommentId` populated. New poller reads `entry.lastSeenMessageId` which is `undefined`.
**Why it happens:** Schema migration of the JSON store is not handled
**How to avoid:** In `conversation-store.ts`, support both old and new schema during migration — treat `lastSeenCommentId` (if present, `lastSeenMessageId` absent) as `null` to force a fresh poll. Or wipe the store on startup if migration is acceptable.
**Warning signs:** Poller always polls from the beginning of a thread (no after cursor)

---

## Code Examples

### getNewMessages — chat API pagination
```typescript
// Source: derived from GET /chat/threads/:threadId/messages route in server/src/routes/chat.ts
export async function getNewMessages(
  threadId: string,
  afterMessageId: string | null,
): Promise<ChatMessage[]> {
  const url = afterMessageId
    ? `/api/chat/threads/${threadId}/messages?after=${afterMessageId}&limit=50`
    : `/api/chat/threads/${threadId}/messages?limit=50`;

  const data = await chatFetch(url) as { messages: ChatMessage[]; nextCursor: string | null };
  return data.messages;
}
```

### Handling dedup 409 in postChatMessage
```typescript
// Source: DB unique constraint behavior on telegram_update_id (DATA-03)
export async function postChatMessage(
  threadId: string,
  body: string,
  telegramUpdateId: number,
): Promise<'created' | 'duplicate'> {
  const res = await fetch(`${API_URL}/api/chat/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ body, telegramUpdateId }),
  });

  if (res.status === 409) return 'duplicate';
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[paperclip] postChatMessage ${res.status}: ${text}`);
  }
  return 'created';
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Issues/comments for conversation storage | Unified chat API (threads + messages) | Phase 2 (complete) | Bot must call chat endpoints, not issues endpoints |
| `parse_mode: 'Markdown'` with fallback | `parse_mode: 'HTML'` | Phase 5 | Simpler escaping, cleaner agent output rendering |
| CEO agent replies via issue comments | Agent replies via `POST /chat/threads/:threadId/messages` with `senderType: 'agent'` | Phase 2 (complete) | Poller must filter `chat_messages.senderType === 'agent'` |

**Deprecated/outdated:**
- `createConversationIssue`: replaced by `createChatThread` (chat API)
- `postBoardMessage`: replaced by `postChatMessage` (chat API)
- `getNewComments` (issues comments): replaced by `getNewMessages` (chat messages)
- `pollCeoReplies`: renamed/replaced by `pollAgentReplies` using chat API
- `lastSeenCommentId` in ConversationEntry: replaced by `lastSeenMessageId`
- `issueId` in ConversationEntry: replaced by `threadId`

---

## Open Questions

1. **Does the server return 409 on telegram_update_id duplicate?**
   - What we know: The DB has a `uniqueIndex` on `telegram_update_id`. PostgreSQL unique constraint violations surface as a Drizzle error. The server's error handler would return a 500 (generic) unless the route catches and converts.
   - What's unclear: The existing error handler in `server/src/middleware/` may or may not map Postgres unique violation codes (23505) to 409.
   - Recommendation: Plan 01 must add unique-violation handling in `chatService.createMessage` — catch the Postgres error code `23505` and either return a sentinel value or throw a typed error that the route converts to 409. The bot then treats 409 as a success (dedup fired).

2. **Does the chat API's sendMessageSchema need server-side update?**
   - What we know: `sendMessageSchema` in `@paperclipai/shared` currently only allows `body: z.string().min(1)`.
   - What's unclear: Whether `telegramUpdateId` should be added as an optional field, or whether the bot should use a different endpoint entirely.
   - Recommendation: Add `telegramUpdateId: z.number().int().optional()` to `sendMessageSchema`. This is a backward-compatible addition — existing callers (UI) don't send it and won't break.

3. **How does the CEO agent know to reply to a Telegram-originated thread?**
   - What we know: The agent wakeup fires when `senderType === 'user'`. The `contextSnapshot.paperclipChatThreadContext` contains the thread content. The agent posts a reply via `POST /chat/threads/:threadId/messages`.
   - What's unclear: Whether the agent's response needs any Telegram-specific routing hint, or whether the bot's poller handles it generically.
   - Recommendation: No routing hint needed. The bot's poller iterates all known `threadId`s and forwards any `senderType === 'agent'` messages to the corresponding `chatId`. The agent doesn't need to know it's talking to a Telegram user.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project standard, `vitest.config.ts` at root) |
| Config file | `vitest.config.ts` — telegram-bot is NOT currently in `projects` array |
| Quick run command | `pnpm test:run -- --reporter=verbose services/telegram-bot` |
| Full suite command | `pnpm test:run` |

**Note:** The telegram-bot has no vitest config and is not in the root `vitest.config.ts` projects array. Tests for the bot's new `paperclip.ts` logic (TELE-01, TELE-06, TELE-07) should be added either:
- As unit tests inside `services/telegram-bot/src/__tests__/` with a `vitest.config.ts` added to the service, OR
- As integration tests in `server/src/__tests__/` testing the chat route's dedup behavior (TELE-07)

The server's existing test pattern (vitest + supertest + vi.mock) is the established pattern.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TELE-01 | Bot uses chat API (threads+messages) not issues API | unit (mock fetch) | `pnpm test:run -- server/src/__tests__/chat-routes.test.ts` | Partial (chat routes exist, bot tests don't) |
| TELE-02 | Webhook returns 200 immediately without awaiting processing | unit (supertest) | `pnpm test:run -- server/src/__tests__/chat-routes.test.ts` | Wave 0 gap |
| TELE-03 | First message auto-creates thread, subsequent messages reuse it | unit (mock fetch) | `pnpm test:run` | Wave 0 gap |
| TELE-04 | /new command clears threadId, next message creates fresh thread | unit | `pnpm test:run` | Wave 0 gap |
| TELE-05 | sendMessage uses parse_mode: HTML | unit (spy on fetch) | `pnpm test:run` | Wave 0 gap |
| TELE-06 | Poller forwards agent messages to Telegram chatId | unit (mock fetch) | `pnpm test:run` | Wave 0 gap |
| TELE-07 | Duplicate telegram_update_id results in only one message stored | integration (chat routes) | `pnpm test:run -- server/src/__tests__/chat-routes.test.ts` | Wave 0 gap |

### Sampling Rate
- **Per task commit:** `pnpm test:run -- server/src/__tests__/chat-routes.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `services/telegram-bot/vitest.config.ts` — adds bot to test infrastructure
- [ ] `services/telegram-bot/src/__tests__/app.test.ts` — covers TELE-02 (immediate 200), TELE-04 (/new reset)
- [ ] `services/telegram-bot/src/__tests__/conversation-manager.test.ts` — covers TELE-03, TELE-06
- [ ] `services/telegram-bot/src/__tests__/telegram.test.ts` — covers TELE-05 (HTML parse mode)
- [ ] `server/src/__tests__/chat-routes.test.ts` — extend with TELE-07 dedup case (duplicate telegramUpdateId returns 409)

---

## Sources

### Primary (HIGH confidence)
- `services/telegram-bot/src/app.ts` — current webhook handler structure
- `services/telegram-bot/src/conversation-manager.ts` — current polling and handleBoardMessage
- `services/telegram-bot/src/lib/paperclip.ts` — current API calls (issues-based)
- `services/telegram-bot/src/lib/conversation-store.ts` — current JSON store schema
- `services/telegram-bot/src/lib/telegram.ts` — current sendMessage + parse_mode
- `server/src/routes/chat.ts` — chat API endpoints and response shapes
- `server/src/services/chat.ts` — createMessage, listMessages logic
- `packages/db/src/schema/chat_messages.ts` — telegramUpdateId column + uniqueIndex (DATA-03)
- `server/src/__tests__/chat-routes.test.ts` — test pattern to follow for new tests
- `server/src/services/live-events.ts` — confirms live events are in-process only (not accessible from separate bot process)

### Secondary (MEDIUM confidence)
- Telegram Bot API documentation (from code patterns): `parse_mode: 'HTML'` is a supported value alongside `Markdown` and `MarkdownV2`; HTML entities `<b>`, `<i>`, `<code>` are supported

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are existing project dependencies
- Architecture: HIGH — all integration points verified from codebase
- Pitfalls: HIGH — derived from reading the actual code paths and schema constraints
- Test gaps: HIGH — vitest config and existing tests confirmed by inspection

**Research date:** 2026-03-19
**Valid until:** Stable — only changes if chat API schema or agent auth mechanism changes
