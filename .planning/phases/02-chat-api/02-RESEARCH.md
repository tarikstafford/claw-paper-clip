# Phase 2: Chat API - Research

**Researched:** 2026-03-19
**Domain:** Express REST API layer — chat threads and messages on top of existing Drizzle/Postgres schema, with dual auth (board session + agent API key) and immediate agent wakeup
**Confidence:** HIGH — all findings sourced from the project's own codebase; no guesswork required

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | POST /companies/:companyId/chat/threads — create thread bound to an agent | `companyRoutes` pattern for company-scoped creates; `assertCompanyAccess` + `heartbeatService` already confirm the pattern |
| API-02 | GET /companies/:companyId/chat/threads — list threads for authenticated user | Identical scope guard; filter by `creatorUserId`/`creatorAgentId` based on actor type |
| API-03 | GET /chat/threads/:threadId/messages — get messages with cursor-based pagination | Exact cursor pattern from `issueService.listComments` (timestamp+id keyset); apply to `chatMessages` |
| API-04 | POST /chat/threads/:threadId/messages — send message to thread | Insert `chatMessages` row; set processingStatus="enqueued"; fire wakeup after insert |
| API-05 | Agent wake trigger — inserting a user message triggers immediate agent run via wakeup_requests | `heartbeatService(db).wakeup(agentId, opts)` — already exposed, used in issue update routes |
| API-06 | Auth scoping — board users access via session, Telegram bot accesses via agent API key | `actorMiddleware` already resolves both; route handlers inspect `req.actor.type` |
| API-07 | Agent can post messages back to thread (response path from heartbeat execution) | Same POST /chat/threads/:threadId/messages endpoint; when `req.actor.type === "agent"`, set `senderType="agent"` and `senderAgentId` |
</phase_requirements>

---

## Summary

Phase 2 builds a REST API layer on top of the `chat_threads` and `chat_messages` tables created in Phase 1. The codebase provides every building block needed: an Express Router factory pattern, a dual-actor auth middleware (`actorMiddleware`) that already distinguishes board sessions from agent API keys, a `heartbeatService.wakeup()` call for immediate agent runs, and a proven cursor-based pagination pattern from `issueService.listComments`.

The five endpoints decompose cleanly. The two company-scoped thread endpoints (`POST` and `GET` on `/companies/:companyId/chat/threads`) follow the exact same guard-then-query structure used in `companies.ts`, `issues.ts`, and `agents.ts`. The two thread-scoped message endpoints (`GET` and `POST` on `/chat/threads/:threadId/messages`) require a thread-ownership check before proceeding, which is a new but trivial lookup. The agent wake trigger (API-05) is fire-and-forget using `void heartbeat.wakeup(...)` — the same pattern used in `routes/issues.ts` after assignment changes.

The only design decisions that require explicit choices are: (1) whether board users' thread listing filters by their `userId` or returns all threads for the company; (2) what `contextSnapshot` fields the wakeup carries so the agent knows which thread triggered the run; and (3) whether to publish a live event (`chat.message.created`) when a message is inserted. The REQUIREMENTS.md answers (1): "list their threads" means filter by creator. For (2) and (3) this research recommends specific approaches below.

**Primary recommendation:** Create a single `chatRoutes(db)` factory in `server/src/routes/chat.ts`, mounted at `/api` alongside the other route families; add Zod schemas to `packages/shared/src/validators/`; add a service module `server/src/services/chat.ts`; and add `"chat.message.created"` to `LIVE_EVENT_TYPES` in `packages/shared/src/constants.ts`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express Router | (project version) | Route factory pattern | Every route file uses `Router()` factory |
| drizzle-orm | ^0.38.4 | DB queries — insert, select, where, orderBy, limit | Already the project ORM |
| zod | (project version) | Request body validation via `validate()` middleware | All existing schemas use Zod |
| @paperclipai/db | local | `chatThreads`, `chatMessages`, `agents` table refs | Phase 1 created these tables |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `publishLiveEvent` from `./live-events.js` | project-internal | Notify UI of new messages | After every successful message insert |
| `heartbeatService(db).wakeup` | project-internal | Fire immediate agent run | After user message insert only |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `chat.ts` service module | Inline queries in route file | Service pattern is consistent with all other routes; inlining gets messy with cursor logic |
| `chat.message.created` live event | Polling only | The requirements state UI will use "existing WebSocket live-events + React Query invalidation" (UI-04); emitting the event here enables that without any extra work in Phase 4 |

**No new packages to install** — this phase uses only existing dependencies.

---

## Architecture Patterns

### Recommended Project Structure (additions only)
```
server/src/
├── routes/
│   └── chat.ts          # New: chatRoutes(db) factory — 5 endpoints
├── services/
│   └── chat.ts          # New: chatService(db) — DB queries only
packages/shared/src/validators/
└── chat.ts              # New: createThreadSchema, sendMessageSchema
```

Also modify:
- `server/src/routes/index.ts` — add `export { chatRoutes } from "./chat.js"`
- `server/src/app.ts` — mount `chatRoutes(db)` under `/api`
- `packages/shared/src/validators/index.ts` — re-export new schemas
- `packages/shared/src/constants.ts` — add `"chat.message.created"` to `LIVE_EVENT_TYPES`

### Pattern 1: Route Factory (identical to all other routes)
**What:** A function that accepts `db: Db`, instantiates services, and returns an Express `Router`.
**When to use:** Always — this is the only pattern in the codebase.
**Example (from `server/src/routes/companies.ts`):**
```typescript
export function chatRoutes(db: Db) {
  const router = Router();
  const svc = chatService(db);
  const heartbeat = heartbeatService(db);

  router.post("/companies/:companyId/chat/threads", validate(createThreadSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    // ...
  });

  return router;
}
```

### Pattern 2: Actor-type branching for auth scope (API-06)
**What:** `req.actor.type` is already resolved by `actorMiddleware`. Routes branch on it.
**When to use:** Any endpoint that must behave differently for board vs agent callers.
```typescript
// Board user creating a thread
if (req.actor.type === "board") {
  creatorUserId = req.actor.userId;
  creatorAgentId = null;
} else if (req.actor.type === "agent") {
  creatorAgentId = req.actor.agentId ?? null;
  creatorUserId = null;
} else {
  throw unauthorized();
}
```

### Pattern 3: Cursor-based pagination (API-03)
**What:** Keyset pagination using `(createdAt, id)` composite sort key — same as `issueService.listComments`.
**When to use:** `GET /chat/threads/:threadId/messages`
```typescript
// anchor lookup, then:
conditions.push(
  sql<boolean>`(
    ${chatMessages.createdAt} > ${anchorTs}::timestamptz
    OR (${chatMessages.createdAt} = ${anchorTs}::timestamptz AND ${chatMessages.id} > ${anchor.id})
  )`
);
const rows = await db
  .select()
  .from(chatMessages)
  .where(and(...conditions))
  .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
  .limit(limit);
```

### Pattern 4: Fire-and-forget wakeup (API-05)
**What:** After inserting a user message, enqueue an agent wakeup without blocking the response. Mirrors the issue-update wakeup pattern in `routes/issues.ts`.
**When to use:** Immediately after a successful `chatMessages` insert when `senderType === "user"`.
```typescript
// After insert returns, before res.json():
void heartbeat.wakeup(thread.agentId, {
  source: "on_demand",
  triggerDetail: "system",
  reason: "chat_message",
  payload: { threadId: thread.id, messageId: newMessage.id },
  requestedByActorType: actor.actorType,
  requestedByActorId: actor.actorId,
  contextSnapshot: {
    threadId: thread.id,
    messageId: newMessage.id,
    source: "chat.message",
  },
});
```

### Pattern 5: Thread ownership check (API-03, API-04, API-07)
**What:** Before reading or writing messages, confirm the thread exists and the actor has access.
**When to use:** All `/chat/threads/:threadId/*` endpoints.
```typescript
const thread = await svc.getThread(threadId);
if (!thread) throw notFound("Thread not found");
// For board actors: check companyId membership (assertCompanyAccess)
// For agent actors: check thread.agentId === req.actor.agentId OR same companyId
assertCompanyAccess(req, thread.companyId);
```

### Pattern 6: Agent posting a response (API-07)
**What:** When `req.actor.type === "agent"`, the sender is the agent. The endpoint is the same POST endpoint — no separate path needed.
```typescript
if (req.actor.type === "agent") {
  senderType = "agent";
  senderAgentId = req.actor.agentId ?? null;
  // Do NOT fire a wakeup — this IS the agent responding
}
```

### Anti-Patterns to Avoid
- **Separate agent-response endpoint:** Requirements say the agent posts back through the same endpoint. No separate `/agent-response` path.
- **Blocking on wakeup:** `heartbeat.wakeup` is async and may queue. Always `void` it; don't `await` it before responding.
- **Firing wakeup when agent posts:** Only user-sourced messages should trigger a wakeup. If `senderType === "agent"`, skip the wakeup.
- **Using `assertBoard` for chat endpoints:** Chat is accessible to both board and agents (API-06). Use `assertCompanyAccess` instead of `assertBoard`.
- **Not checking thread-to-company ownership:** Always verify the thread belongs to the same company as the actor before allowing reads/writes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth resolution | Custom token parsing | `req.actor` (already set by `actorMiddleware`) | Middleware already handles session + API key + JWT; duplicating it introduces inconsistency |
| Cursor pagination | Custom offset/page logic | Keyset pattern from `issueService.listComments` | Offset pagination is O(n) and breaks under inserts; keyset is already proven in this codebase |
| Agent wakeup | Direct DB insert into `agent_wakeup_requests` | `heartbeatService(db).wakeup(agentId, opts)` | The service handles coalescing, budget checks, live event publishing, and run promotion |
| Request validation | Manual `if (!body.field)` checks | `validate(schema)` + Zod schema | The `validate` middleware throws a caught parse error with correct status |
| Company access check | Manual membership query | `assertCompanyAccess(req, companyId)` | Already handles local_implicit, instanceAdmin, board companyIds, and agent companyId |

---

## Common Pitfalls

### Pitfall 1: Waking the agent when the agent is the sender
**What goes wrong:** If the agent posts a message back (API-07) and the route fires a wakeup, the agent enters an infinite loop — it wakes up, posts a message, gets woken again.
**Why it happens:** Forgetting to gate the wakeup on `senderType === "user"`.
**How to avoid:** Always check `senderType` before calling `heartbeat.wakeup`. Only fire for user-originated messages.
**Warning signs:** Agent enters repeated heartbeat runs with no user activity.

### Pitfall 2: Missing thread-to-company ownership check
**What goes wrong:** An agent or board user from company A reads messages from a thread in company B by guessing a UUID.
**Why it happens:** `assertCompanyAccess(req, companyId)` only validates the URL parameter, not the thread's actual company.
**How to avoid:** Always look up the thread first, then call `assertCompanyAccess(req, thread.companyId)`.
**Warning signs:** `403` not thrown when correct — or the reverse, access incorrectly denied.

### Pitfall 3: Blocking the response on wakeup
**What goes wrong:** Slow or queued wakeup delays the API response by seconds.
**Why it happens:** `await heartbeat.wakeup(...)` before `res.json()`.
**How to avoid:** Use `void heartbeat.wakeup(...)` — fire and forget, exactly as `routes/issues.ts` does.

### Pitfall 4: `processingStatus` not updated after agent processes the message
**What goes wrong:** The `chat_messages.processingStatus` column stays "enqueued" forever, making it impossible for the heartbeat to find unprocessed messages in Phase 3/5.
**Why it happens:** Phase 2 only inserts messages; it does not define the processing lifecycle. But the API-07 path (agent posting response) is the natural place to also mark the triggering message as "processed".
**How to avoid:** When the agent posts a response via API-07, also `PATCH` or update the original user message to `processingStatus = "processed"`. This can be a separate endpoint or an optional field on the message send body. Decide and document; Phase 3 (context compaction) and Phase 5 (Telegram) rely on this status.

### Pitfall 5: Forgetting to add `"chat.message.created"` to `LIVE_EVENT_TYPES`
**What goes wrong:** `publishLiveEvent` type-checks the `type` parameter against the const array. If the new event type isn't in the array, TypeScript rejects the call.
**Why it happens:** The array is in `packages/shared/src/constants.ts`. It's easy to miss when focused on the server package.
**How to avoid:** Add the event type before writing any call to `publishLiveEvent` in the chat routes.

### Pitfall 6: `req.actor.companyIds` is undefined on agent callers
**What goes wrong:** Agent actors set `companyId` (singular, string), not `companyIds` (array). Accessing `req.actor.companyIds` on an agent actor returns `undefined`.
**Why it happens:** The `Actor` type has different shapes per `type`. `assertCompanyAccess` handles this correctly, but custom code that reads `req.actor.companyIds` directly will fail silently.
**How to avoid:** Always use `assertCompanyAccess(req, companyId)` — never roll a custom membership check.

---

## Code Examples

### Create thread (API-01)
```typescript
// Source: server/src/routes/issues.ts create pattern + authz.ts
router.post("/companies/:companyId/chat/threads", validate(createThreadSchema), async (req, res) => {
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);
  if (req.actor.type === "none") throw unauthorized();

  const { agentId, title } = req.body as CreateThread;
  const actor = getActorInfo(req);

  const thread = await svc.createThread({
    companyId,
    agentId,
    title: title ?? null,
    creatorUserId: actor.actorType === "user" ? actor.actorId : null,
    creatorAgentId: actor.actorType === "agent" ? actor.actorId : null,
  });

  res.status(201).json(thread);
});
```

### List threads (API-02) — board filters by userId, agent filters by agentId
```typescript
router.get("/companies/:companyId/chat/threads", async (req, res) => {
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);
  if (req.actor.type === "none") throw unauthorized();

  const threads = await svc.listThreads(companyId, {
    creatorUserId: req.actor.type === "board" ? req.actor.userId : undefined,
    creatorAgentId: req.actor.type === "agent" ? req.actor.agentId : undefined,
  });

  res.json(threads);
});
```

### Send message + wake agent (API-04 + API-05)
```typescript
router.post("/chat/threads/:threadId/messages", validate(sendMessageSchema), async (req, res) => {
  const { threadId } = req.params;
  const thread = await svc.getThread(threadId);
  if (!thread) throw notFound("Thread not found");
  assertCompanyAccess(req, thread.companyId);

  const actor = getActorInfo(req);
  const senderType = actor.actorType === "agent" ? "agent" : "user";

  const message = await svc.createMessage({
    threadId,
    senderType,
    senderAgentId: actor.actorType === "agent" ? actor.actorId : null,
    senderUserId: actor.actorType === "user" ? actor.actorId : null,
    body: req.body.body,
    processingStatus: senderType === "user" ? "enqueued" : "processed",
  });

  publishLiveEvent({ companyId: thread.companyId, type: "chat.message.created", payload: { threadId, messageId: message.id } });

  if (senderType === "user") {
    void heartbeat.wakeup(thread.agentId, {
      source: "on_demand",
      triggerDetail: "system",
      reason: "chat_message",
      payload: { threadId, messageId: message.id },
      requestedByActorType: actor.actorType,
      requestedByActorId: actor.actorId,
      contextSnapshot: { threadId, messageId: message.id, source: "chat.message" },
    });
  }

  res.status(201).json(message);
});
```

### Cursor-based message list (API-03)
```typescript
router.get("/chat/threads/:threadId/messages", async (req, res) => {
  const { threadId } = req.params;
  const thread = await svc.getThread(threadId);
  if (!thread) throw notFound("Thread not found");
  assertCompanyAccess(req, thread.companyId);

  const afterId = typeof req.query.after === "string" ? req.query.after : null;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const messages = await svc.listMessages(threadId, { afterMessageId: afterId, limit });
  res.json({ messages, nextCursor: messages.length === limit ? messages[messages.length - 1]?.id ?? null : null });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Issues/comments for agent communication | Dedicated chat tables | Phase 1 (this project) | Chat has its own lifecycle; separate tables avoid polluting task tracking |

No deprecated APIs to navigate in this phase — all tooling is current.

---

## Open Questions

1. **Should listing threads (API-02) return ALL company threads to board users, or only threads created by the requesting user?**
   - What we know: REQUIREMENTS.md says "list their threads" (board user success criteria #1).
   - What's unclear: "their threads" could mean created-by or accessible-by.
   - Recommendation: Implement as created-by-user for board, created-by-agent for agent calls. This is the conservative interpretation of "their threads" and aligns with success criteria #1.

2. **Should `processingStatus` be updated to "processed" in Phase 2 or Phase 3?**
   - What we know: Phase 2 API-07 is where the agent posts a response. Phase 3 handles compaction and context injection.
   - What's unclear: The processing lifecycle is not fully defined for this phase.
   - Recommendation: In Phase 2, when the agent posts a message (API-07), also allow an optional `markProcessedMessageId` field in the request body, or perform the update based on the thread's most recent "enqueued" message. Alternatively, leave it as a Phase 3 concern and document the dependency explicitly.

3. **`contextSnapshot` fields for the chat wakeup — what should the agent see?**
   - What we know: The heartbeat service supports arbitrary `contextSnapshot` fields. The SKILL.md shows `PAPERCLIP_WAKE_REASON` is a known env var.
   - Recommendation: Include `{ threadId, messageId, source: "chat.message", wakeReason: "chat_message" }` in the contextSnapshot. This mirrors the issue comment pattern and is sufficient for the agent to query the message via the API.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.5 |
| Config file | `server/vitest.config.ts` |
| Quick run command | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` |
| Full suite command | `cd server && pnpm vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | POST /companies/:companyId/chat/threads creates a thread | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | Wave 0 |
| API-02 | GET /companies/:companyId/chat/threads filters by actor | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | Wave 0 |
| API-03 | GET messages returns cursor-paginated results | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | Wave 0 |
| API-04 | POST message inserts with processingStatus="enqueued" | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | Wave 0 |
| API-05 | User message insert fires heartbeat.wakeup (mocked) | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | Wave 0 |
| API-06 | Agent API key caller is accepted; unauthenticated caller gets 401 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | Wave 0 |
| API-07 | Agent POST sets senderType="agent"; does NOT fire wakeup | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts`
- **Per wave merge:** `cd server && pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/src/__tests__/chat-routes.test.ts` — unit tests for all 7 requirements above (mock DB + heartbeat service)
- [ ] `server/src/__tests__/chat-service.test.ts` — optional: cursor pagination logic unit tests

*(Existing test infrastructure at `server/vitest.config.ts` is complete — no framework install needed)*

---

## Sources

### Primary (HIGH confidence)
- `server/src/middleware/auth.ts` — Actor resolution: board session, agent JWT, agent API key
- `server/src/routes/authz.ts` — `assertCompanyAccess`, `assertBoard`, `getActorInfo` signatures
- `server/src/routes/issues.ts` — wakeup fire-and-forget pattern (lines 808–860), route factory pattern
- `server/src/services/heartbeat.ts` — `WakeupOptions` interface (line 119), `enqueueWakeup` signature (line 2309), `wakeup` export (line 3117)
- `server/src/services/issues.ts` — cursor pagination keyset pattern (lines 1076–1128)
- `server/src/services/live-events.ts` — `publishLiveEvent` signature
- `packages/shared/src/constants.ts` — `LIVE_EVENT_TYPES` array (line 279) — no chat events yet
- `packages/db/src/schema/chat_threads.ts` — Phase 1 output: exact column names and types
- `packages/db/src/schema/chat_messages.ts` — Phase 1 output: `senderType`, `processingStatus`, `telegramUpdateId`
- `server/src/app.ts` — route mounting pattern
- `packages/shared/src/validators/issue.ts` — Zod schema pattern used across all validators

### Secondary (MEDIUM confidence)
- `packages/db/src/schema/agent_wakeup_requests.ts` — confirms `source`, `triggerDetail`, `contextSnapshot` payload fields accepted by the wakeup service

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already in use; no new dependencies needed
- Architecture: HIGH — every pattern is directly read from project source files
- Pitfalls: HIGH — pitfalls are derived from reading how existing code guards against these exact failure modes
- Open questions: MEDIUM — interpretation of "their threads" and the processingStatus lifecycle are genuinely ambiguous from requirements alone

**Research date:** 2026-03-19
**Valid until:** 2026-06-19 (stable codebase — no fast-moving external dependencies)
