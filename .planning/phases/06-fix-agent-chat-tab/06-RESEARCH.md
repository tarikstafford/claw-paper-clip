# Phase 6: Fix Agent Chat Tab Integration - Research

**Researched:** 2026-03-20
**Domain:** Express route query params, React Query cache invalidation, WebSocket live events
**Confidence:** HIGH

---

## Summary

Phase 6 closes two audit findings (FINDING-01 and FINDING-02) from the v1.0 milestone audit. Both are small, surgical fixes to an already-working chat system.

**FINDING-01** is a scope gap: `AgentChatTab` uses `chatApi.listThreads(companyId)`, which calls `GET /companies/:companyId/chat/threads`. The server pre-filters by `creatorUserId` (the calling board user), so the client-side `agentId` filter applied afterward only sees that user's own threads. Threads created by other board members for the same agent are invisible. The fix is to add an optional `agentId` query parameter to the server route and pass it down through `chatService.listThreads`, so the server returns all threads for a given agent regardless of creator.

**FINDING-02** is a real-time gap: `LiveUpdatesProvider` handles `chat.message.created` by invalidating `queryKeys.chat.threads(companyId)` and `queryKeys.chat.messages(threadId)`, but not `queryKeys.chat.threadsByAgent(companyId, agentId)`. The agent detail Chat tab uses the `threadsByAgent` key, so it never refreshes when new messages arrive. The fix is to add a `threadsByAgent` invalidation in the `chat.message.created` event handler. To know which `agentId` to use, the handler needs the `agentId` from the event payload (which is not currently included), OR must use a prefix-match invalidation strategy.

**Primary recommendation:** Add `agentId` to `chat.message.created` event payload (it is already available on the thread at send time), then invalidate `queryKeys.chat.threadsByAgent` using the `agentId` from that payload.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-02 | Chat tab on agent detail pages showing threads for that agent | FINDING-01 fix (server-side agentId filter) ensures ALL threads for the agent are shown, not just the current user's |
| UI-04 | Real-time message updates via existing WebSocket live-events + React Query invalidation | FINDING-02 fix (threadsByAgent key invalidation) ensures agent detail Chat tab refreshes on new messages |
| UI-06 | Thread list shows latest message preview and unread indicator | FINDING-01 fix brings in correct threads; lastMessage preview already works via chatService.listThreads; unread indicator was already deferred in v1.0 audit |
</phase_requirements>

---

## Standard Stack

### Core (all already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express | existing | Route handler with query param parsing | Server already uses Express |
| @tanstack/react-query | existing | Query cache with `invalidateQueries` | UI already uses this for all server state |
| React (AgentDetail.tsx) | existing | AgentChatTab component | Already implemented, needs query function change |
| drizzle-orm | existing | ORM for adding `agentId` filter condition to listThreads | Already used in chatService.listThreads |

### No new dependencies needed
This phase is pure fixes to existing code. Zero new packages required.

---

## Architecture Patterns

### Recommended Project Structure
No new files. Three existing files change:

```
server/src/
├── routes/chat.ts              # Add agentId query param handling (GET threads route)
└── services/chat.ts            # Add agentId filter condition to listThreads

ui/src/
├── api/chat.ts                 # Add optional agentId param to listThreads API call
├── context/LiveUpdatesProvider.tsx   # Add threadsByAgent invalidation
└── pages/AgentDetail.tsx       # Update AgentChatTab query to use server-side filter

server/src/__tests__/
└── chat-routes.test.ts         # Add tests for agentId query param behavior
```

### Pattern 1: Optional Query Param on GET Route (Express)

**What:** Add an optional `agentId` query string parameter to `GET /companies/:companyId/chat/threads`. When present and the caller is a board user, filter by `agentId` instead of (or in addition to) `creatorUserId`. When the caller is an agent, `creatorAgentId` filter still applies (agent callers should not use this param).

**When to use:** When a board user wants ALL threads for a specific agent (not just their own). The agent detail Chat tab is the primary consumer.

**Existing route (lines 39-50 in server/src/routes/chat.ts):**
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

**Updated pattern:**
```typescript
router.get("/companies/:companyId/chat/threads", async (req, res) => {
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);
  if (req.actor.type === "none") throw unauthorized();

  const agentIdFilter = typeof req.query.agentId === "string" ? req.query.agentId : undefined;

  // When agentId is provided (board user viewing agent tab), filter by agentId only
  // When agentId is absent, keep existing behaviour (filter by creator)
  const filters =
    req.actor.type === "board" && agentIdFilter
      ? { agentId: agentIdFilter }
      : req.actor.type === "board"
        ? { creatorUserId: req.actor.userId }
        : { creatorAgentId: req.actor.agentId };

  const threads = await svc.listThreads(companyId, filters);
  res.json(threads);
});
```

### Pattern 2: Add agentId Filter to chatService.listThreads

**What:** Extend the `filters` parameter of `listThreads` to accept an optional `agentId`. When present, add `eq(chatThreads.agentId, filters.agentId)` to the WHERE conditions.

**Key constraint:** The `agentId` filter is exclusive of the creator filters — when filtering by `agentId`, all threads for that agent (any creator) are returned.

**Existing service signature (server/src/services/chat.ts line 30-36):**
```typescript
listThreads: async (
  companyId: string,
  filters: {
    creatorUserId?: string;
    creatorAgentId?: string;
  },
) => {
```

**Updated signature:**
```typescript
listThreads: async (
  companyId: string,
  filters: {
    creatorUserId?: string;
    creatorAgentId?: string;
    agentId?: string;           // new: filter by thread.agentId (all creators)
  },
) => {
  const conditions = [eq(chatThreads.companyId, companyId)];
  if (filters.agentId) {
    conditions.push(eq(chatThreads.agentId, filters.agentId));
  } else if (filters.creatorUserId) {
    conditions.push(eq(chatThreads.creatorUserId, filters.creatorUserId));
  } else if (filters.creatorAgentId) {
    conditions.push(eq(chatThreads.creatorAgentId, filters.creatorAgentId));
  }
  // ... rest unchanged
```

### Pattern 3: Client-side API update (chatApi.listThreads)

**What:** Add an optional `agentId` query string to the API call when the caller wants agent-scoped threads.

**Existing (ui/src/api/chat.ts line 34-35):**
```typescript
listThreads: (companyId: string) =>
  api.get<ChatThread[]>(`/companies/${companyId}/chat/threads`),
```

**Updated:**
```typescript
listThreads: (companyId: string, opts?: { agentId?: string }) => {
  const qs = opts?.agentId ? `?agentId=${encodeURIComponent(opts.agentId)}` : "";
  return api.get<ChatThread[]>(`/companies/${companyId}/chat/threads${qs}`);
},
```

### Pattern 4: AgentChatTab query update

**What:** Replace client-side filter with server-side filter by passing `agentId` to `chatApi.listThreads`.

**Existing (AgentDetail.tsx line 784-788):**
```typescript
const { data: threads = [] } = useQuery({
  queryKey: queryKeys.chat.threadsByAgent(companyId, agentId),
  queryFn: () => chatApi.listThreads(companyId).then((ts) => ts.filter((t) => t.agentId === agentId)),
  enabled: !!companyId,
});
```

**Updated:**
```typescript
const { data: threads = [] } = useQuery({
  queryKey: queryKeys.chat.threadsByAgent(companyId, agentId),
  queryFn: () => chatApi.listThreads(companyId, { agentId }),
  enabled: !!companyId,
});
```

The `queryKey` stays the same — `threadsByAgent` — because the cache is already keyed correctly.

### Pattern 5: LiveUpdatesProvider — threadsByAgent invalidation (FINDING-02)

**What:** In `handleLiveEvent`, when `event.type === "chat.message.created"`, also invalidate the `threadsByAgent` query key family.

**The problem:** To invalidate `queryKeys.chat.threadsByAgent(companyId, agentId)` we need the `agentId`. Currently the `chat.message.created` payload only contains `{ threadId, messageId }`. Two strategies exist:

**Option A (recommended): Add `agentId` to the event payload at send time.**
The route handler already has the `thread` object (which has `thread.agentId`) before publishing the event. Cost: one field added to the payload.

In `server/src/routes/chat.ts`, line 103-108:
```typescript
publishLiveEvent({
  companyId: thread.companyId,
  type: "chat.message.created",
  payload: { threadId, messageId: message.id, agentId: thread.agentId },  // add agentId
});
```

Then in `LiveUpdatesProvider.tsx`, line 513-522:
```typescript
if (event.type === "chat.message.created") {
  const threadId = readString(payload.threadId);
  const agentId = readString(payload.agentId);  // new
  if (threadId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(threadId) });
    if (expectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads(expectedCompanyId) });
      if (agentId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.chat.threadsByAgent(expectedCompanyId, agentId),
        });
      }
    }
  }
  return;
}
```

**Option B (simpler, slightly over-invalidates): Prefix-match invalidation**
Use the shared `["chat", "threads", companyId]` prefix to invalidate ALL thread queries for the company:
```typescript
queryClient.invalidateQueries({
  queryKey: ["chat", "threads", expectedCompanyId],
  // No exact match — all keys starting with this prefix are invalidated
});
```
This would invalidate both `threads(companyId)` AND `threadsByAgent(companyId, agentId)` in a single call since `threadsByAgent` starts with the same prefix. React Query's `invalidateQueries` uses prefix matching by default.

**Recommendation:** Option A (add `agentId` to payload) — explicit, no over-invalidation risk, minimal change to the existing pattern.

**Check `queryKeys` alignment:**
```typescript
chat: {
  threads: (companyId: string) => ["chat", "threads", companyId] as const,
  threadsByAgent: (companyId: string, agentId: string) => ["chat", "threads", companyId, "agent", agentId] as const,
  messages: (threadId: string) => ["chat", "messages", threadId] as const,
},
```
`threadsByAgent` starts with `["chat", "threads", companyId]` — so Option B (prefix match on `threads(companyId)`) would automatically cover it, since `queryKeys.chat.threads(companyId)` is a prefix of `queryKeys.chat.threadsByAgent(companyId, agentId)`.

This means **the existing `queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads(expectedCompanyId) })` call ALREADY prefix-matches threadsByAgent** — because React Query's `invalidateQueries` uses prefix matching by default when no `exact: true` is specified.

**This is the critical insight:** FINDING-02 may already be partially covered if `invalidateQueries` is doing prefix matching. However, inspection of the code confirms that `queryKeys.chat.threads(companyId)` returns `["chat", "threads", companyId]` and `queryKeys.chat.threadsByAgent(companyId, agentId)` returns `["chat", "threads", companyId, "agent", agentId]`. Since the former is a prefix of the latter, React Query WILL invalidate `threadsByAgent` when `threads(companyId)` is invalidated — **unless `exact: true` is passed** (it is not).

**Actual conclusion:** FINDING-02 may already be fixed by the existing `threads(companyId)` invalidation if React Query prefix matching is in effect. The planner should verify this in the test and add an explicit `threadsByAgent` invalidation for clarity regardless, since it makes the intent explicit and is zero-cost.

### Anti-Patterns to Avoid

- **Don't add a new API endpoint.** Extend the existing `GET /companies/:companyId/chat/threads` with the optional query param. Creating a separate `/threads?agentId=X` endpoint would duplicate auth/scoping logic.
- **Don't validate agentId as UUID in the route.** The existing `createThreadSchema` validates UUID on creation. The `agentId` query param is read-only and should be trusted if the board user has company access.
- **Don't break existing API-02 tests.** The existing test suite verifies that board users receive `creatorUserId`-filtered threads. The new `agentId` param is additive — existing callers (Chat page sidebar) pass no `agentId` and get the old behaviour.
- **Don't change the `queryKey` shape.** `queryKeys.chat.threadsByAgent` already exists in `queryKeys.ts` — use it as-is.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query cache invalidation | Custom cache clear logic | `queryClient.invalidateQueries` | Already in use; React Query handles stale/refetch lifecycle |
| Query param parsing | Manual string parsing | Express `req.query` | Express already parses query strings |
| Drizzle filter condition | Raw SQL | `eq(chatThreads.agentId, agentId)` with drizzle-orm's `and()` | Already used in chatService.listThreads for all other conditions |

---

## Common Pitfalls

### Pitfall 1: Breaking existing API-02 behaviour when no agentId param
**What goes wrong:** If `agentId` param presence is not checked before building filters, board users on the Chat sidebar page (which calls `listThreads` without `agentId`) would see all company threads instead of their own.
**Why it happens:** Changing the filter logic without conditional branching.
**How to avoid:** Use `agentIdFilter !== undefined` as the branch condition. Only skip `creatorUserId` filter when `agentId` is explicitly provided.
**Warning signs:** Existing test `"API-02: board user receives threads filtered by their userId"` failing.

### Pitfall 2: React Query exact vs prefix invalidation misunderstanding
**What goes wrong:** Believing `threadsByAgent` is NOT invalidated by the existing `threads(companyId)` call when it already IS (due to prefix matching).
**Why it happens:** Misreading React Query invalidation semantics.
**How to avoid:** Add an explicit `threadsByAgent` invalidation anyway for clarity, then add a test that confirms the tab updates. Both the prefix invalidation (automatic) and the explicit one (belt-and-suspenders) are harmless.

### Pitfall 3: agentId query param accepted from agent callers
**What goes wrong:** An agent actor passes `?agentId=some-other-agent` and gets threads for an agent they don't own.
**Why it happens:** Not scoping the `agentId` param to board callers only.
**How to avoid:** Only apply the `agentId` filter when `req.actor.type === "board"`. Agent callers always use `creatorAgentId` filter (existing behaviour unchanged).

### Pitfall 4: Existing chat-routes tests failing on GET threads changes
**What goes wrong:** The test `"API-02: agent receives threads filtered by their agentId"` checks that `listThreads` is called with `creatorAgentId`. If the route logic branches incorrectly, this breaks.
**Why it happens:** Logic error in the filters branch.
**How to avoid:** The `agentId` query param path only activates for `req.actor.type === "board"` — agent callers are entirely unaffected.

---

## Code Examples

### Complete updated GET /threads route handler
```typescript
// Source: server/src/routes/chat.ts (updated)
router.get("/companies/:companyId/chat/threads", async (req, res) => {
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);
  if (req.actor.type === "none") throw unauthorized();

  const agentIdFilter =
    req.actor.type === "board" && typeof req.query.agentId === "string"
      ? req.query.agentId
      : undefined;

  const threads = await svc.listThreads(companyId, {
    agentId: agentIdFilter,
    creatorUserId: !agentIdFilter && req.actor.type === "board" ? req.actor.userId : undefined,
    creatorAgentId: req.actor.type === "agent" ? req.actor.agentId : undefined,
  });

  res.json(threads);
});
```

### Complete updated listThreads service filter
```typescript
// Source: server/src/services/chat.ts (updated)
listThreads: async (
  companyId: string,
  filters: {
    creatorUserId?: string;
    creatorAgentId?: string;
    agentId?: string;
  },
) => {
  const conditions = [eq(chatThreads.companyId, companyId)];
  if (filters.agentId) {
    conditions.push(eq(chatThreads.agentId, filters.agentId));
  } else if (filters.creatorUserId) {
    conditions.push(eq(chatThreads.creatorUserId, filters.creatorUserId));
  } else if (filters.creatorAgentId) {
    conditions.push(eq(chatThreads.creatorAgentId, filters.creatorAgentId));
  }
  // ... lastMessage enrichment unchanged
```

### LiveUpdatesProvider chat.message.created handler (with explicit threadsByAgent invalidation)
```typescript
// Source: ui/src/context/LiveUpdatesProvider.tsx (updated)
if (event.type === "chat.message.created") {
  const threadId = readString(payload.threadId);
  const agentId = readString(payload.agentId);  // added
  if (threadId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(threadId) });
    if (expectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads(expectedCompanyId) });
      // Explicit threadsByAgent invalidation (belt-and-suspenders; prefix match already covers this)
      if (agentId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.chat.threadsByAgent(expectedCompanyId, agentId),
        });
      }
    }
  }
  return;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side agentId filter in AgentChatTab | Server-side agentId query param | Phase 6 | All board users' threads for the agent become visible |
| Implicit prefix invalidation only | Explicit threadsByAgent invalidation added | Phase 6 | Intent is documented; no functional change if prefix already works |

**Deprecated/outdated after this phase:**
- `chatApi.listThreads(companyId).then((ts) => ts.filter((t) => t.agentId === agentId))` pattern in AgentChatTab — replaced by `chatApi.listThreads(companyId, { agentId })` direct call.

---

## Open Questions

1. **Is FINDING-02 already effectively fixed by prefix matching?**
   - What we know: `queryKeys.chat.threads(companyId)` = `["chat","threads",companyId]`. `queryKeys.chat.threadsByAgent(companyId, agentId)` = `["chat","threads",companyId,"agent",agentId]`. React Query `invalidateQueries` does prefix matching by default.
   - What's unclear: Whether the project's React Query version behaviour matches this assumption.
   - Recommendation: Add explicit invalidation anyway. It is zero-cost and makes the intention clear for future maintainers.

2. **Should the `agentId` param on the GET route be validated as a UUID?**
   - What we know: `createThreadSchema` validates `agentId` as `z.string().uuid()` on creation. The GET param is read-only; an invalid UUID would simply return zero threads.
   - What's unclear: Whether stricter validation is desired.
   - Recommendation: No validation needed. An invalid agentId returns an empty array gracefully; no security boundary is crossed since the board user already passed `assertCompanyAccess`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `server/vitest.config.ts` |
| Quick run command | `pnpm vitest run --project server --reporter=verbose server/src/__tests__/chat-routes.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-02 | GET /threads?agentId=X returns all threads for agent (any creator) | unit (route) | `pnpm vitest run --project server server/src/__tests__/chat-routes.test.ts` | existing file, new tests needed |
| UI-02 | GET /threads without agentId still filters by creatorUserId (no regression) | unit (route) | same | existing tests cover this |
| UI-04 | chat.message.created event invalidates threadsByAgent key | unit (LiveUpdatesProvider) | manual/browser | no automated test for LiveUpdatesProvider |
| UI-06 | Thread list shows lastMessage preview for agent-filtered threads | integration | covered by route + existing ChatThreadList rendering | no new test needed |

### Sampling Rate
- **Per task commit:** `pnpm vitest run --project server server/src/__tests__/chat-routes.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases in `server/src/__tests__/chat-routes.test.ts` — covers UI-02 agentId filter (existing file needs new `describe` block or new `it` cases within GET threads describe)

*(LiveUpdatesProvider changes are not unit-testable in the server test suite; verification is done via browser manual check or by confirming the key invalidation logic is structurally correct in code review)*

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `server/src/routes/chat.ts` — current GET /threads handler and filter logic
- Direct code inspection: `server/src/services/chat.ts` — `listThreads` filter conditions
- Direct code inspection: `ui/src/context/LiveUpdatesProvider.tsx` — `chat.message.created` handler (lines 513-522)
- Direct code inspection: `ui/src/lib/queryKeys.ts` — `chat.threads` and `chat.threadsByAgent` key shapes
- Direct code inspection: `ui/src/pages/AgentDetail.tsx` (lines 780-817) — `AgentChatTab` with client-side filter
- Direct code inspection: `ui/src/api/chat.ts` — `listThreads` API call (no agentId param currently)
- `.planning/v1.0-MILESTONE-AUDIT.md` — FINDING-01 and FINDING-02 exact descriptions and recommended fixes

### Secondary (MEDIUM confidence)
- React Query documentation: `invalidateQueries` uses prefix matching unless `exact: true` is specified — well-established library behaviour, confirmed by observation of existing usage patterns in `LiveUpdatesProvider.tsx`

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing, no new dependencies
- Architecture: HIGH — all three changes are surgical and verified against live code
- Pitfalls: HIGH — derived from reading actual code, not assumptions

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable codebase; findings are version-pinned to current code)
