# Phase 4: Web UI - Research

**Researched:** 2026-03-19
**Domain:** React + TanStack Query + WebSocket real-time, Paperclip dashboard UI patterns
**Confidence:** HIGH

## Summary

Phase 4 builds the chat interface on top of the fully working Chat API from Phase 2. All backend routes exist and are tested. The UI stack is React 18 with TanStack Query (useQuery/useMutation), React Router v6 (company-prefixed routes), shadcn/ui components, and Tailwind. A live WebSocket connection (`LiveUpdatesProvider`) is already in place and already fires `chat.message.created` events from the server — the UI just needs to listen and call `queryClient.invalidateQueries()` in response.

The pattern for this phase is entirely additive: new files in `ui/src/pages/`, `ui/src/components/`, and `ui/src/api/`, plus route entries in `App.tsx`, a sidebar nav item in `Sidebar.tsx`, and a new tab in `AgentDetail.tsx`. No existing files need structural changes beyond those extension points.

The biggest design decision is the two-pane layout for `/chat`: a thread list on the left and a message view on the right. This is a known pattern in the codebase (IssueDetail uses a similar split). The agent detail Chat tab is simpler — it shows only threads for that agent and opens them inline.

**Primary recommendation:** Follow the existing page/component patterns exactly. Use `useQuery` + `useMutation` from `@tanstack/react-query`. Hook `chat.message.created` into `LiveUpdatesProvider` to invalidate message and thread list queries. Wire the `api/chat.ts` module to the already-built routes under `/companies/:companyId/chat/threads` and `/chat/threads/:threadId/messages`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Dedicated /chat page in sidebar with thread list and message view | Route in boardRoutes(), SidebarNavItem in Sidebar.tsx, new Chat page component |
| UI-02 | Chat tab on agent detail pages showing threads for that agent | New "chat" tab value in AgentDetail.tsx AgentDetailView type + ChatTab component |
| UI-03 | Thread creation — select agent, set optional title, send first message | POST /companies/:companyId/chat/threads then POST /chat/threads/:threadId/messages; agent selector uses existing agents list query |
| UI-04 | Real-time message updates via WebSocket live-events + React Query invalidation | chat.message.created event already emitted by server; needs handler in LiveUpdatesProvider |
| UI-05 | Message display with sender identity (user name, agent name, timestamps) | senderType + senderAgentId + senderUserId fields in chatMessages schema; agent name from agents list query |
| UI-06 | Thread list shows latest message preview and unread indicator | listThreads API response lacks last-message preview — need either server-side join or client-side augmentation via separate query |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-query | Already installed | Server state, caching, invalidation | All pages use it; useQuery + useMutation pattern |
| react-router-dom (v6) | Already installed | Routing, params, navigation | Entire app uses it via `@/lib/router` alias |
| tailwindcss | Already installed | Utility styling | All components use Tailwind classes |
| shadcn/ui | Already installed | Base components: Button, Input, Textarea, Tabs, Dialog | All pages use shadcn components from `@/components/ui/` |
| lucide-react | Already installed | Icons | All icon usage in the project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-markdown + remark-gfm | Already installed | Render agent responses as markdown | Agent messages may contain markdown; use MarkdownBody component |
| date-fns / custom utils | Already installed | Timestamps | Use existing `formatDate`, `relativeTime` from `ui/src/lib/utils` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React Query invalidation | WebSocket streaming | Out of scope per REQUIREMENTS.md; polling/invalidation is the specified approach |
| New DateFormatter | date-fns | Project already has `formatDate` and `relativeTime` in lib/utils — use those |

**No new npm installs required.** All dependencies are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
ui/src/
├── api/
│   └── chat.ts              # New: chatApi — wraps all chat HTTP endpoints
├── pages/
│   └── Chat.tsx             # New: /chat page — thread list + message view
├── components/
│   ├── ChatThreadList.tsx    # New: left-pane list of threads
│   ├── ChatMessageView.tsx  # New: right-pane message history + send form
│   └── NewThreadDialog.tsx  # New: agent selector + optional title + first message
```

### Route Pattern (boardRoutes in App.tsx)

The company-prefixed router wraps all board pages. Chat routes follow the same pattern as issues:

```typescript
// Source: App.tsx boardRoutes()
<Route path="chat" element={<Chat />} />
<Route path="chat/:threadId" element={<Chat />} />
```

Unprefixed redirects also needed in the outer `<Routes>` block (same as issues/agents pattern):

```typescript
<Route path="chat" element={<UnprefixedBoardRedirect />} />
<Route path="chat/:threadId" element={<UnprefixedBoardRedirect />} />
```

### Pattern 1: API Module

All HTTP calls live in `ui/src/api/`. The `api` helper from `client.ts` handles credentials, Content-Type, and 401 redirect automatically.

```typescript
// Source: ui/src/api/client.ts pattern — replicated for chat
// ui/src/api/chat.ts
import { api } from "./client";

export interface ChatThread {
  id: string;
  companyId: string;
  agentId: string;
  title: string | null;
  creatorUserId: string | null;
  creatorAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderType: string;        // "user" | "agent" | "system"
  senderAgentId: string | null;
  senderUserId: string | null;
  body: string;
  tokenCount: number | null;
  processingStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessagesPage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

export const chatApi = {
  listThreads: (companyId: string) =>
    api.get<ChatThread[]>(`/companies/${companyId}/chat/threads`),

  createThread: (companyId: string, body: { agentId: string; title?: string }) =>
    api.post<ChatThread>(`/companies/${companyId}/chat/threads`, body),

  listMessages: (threadId: string, opts?: { after?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.after) params.set("after", opts.after);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<MessagesPage>(`/chat/threads/${threadId}/messages${qs ? `?${qs}` : ""}`);
  },

  sendMessage: (threadId: string, body: { body: string }) =>
    api.post<ChatMessage>(`/chat/threads/${threadId}/messages`, body),
};
```

### Pattern 2: Query Keys

Add to `ui/src/lib/queryKeys.ts` following the exact existing convention:

```typescript
// Source: ui/src/lib/queryKeys.ts pattern
chat: {
  threads: (companyId: string) => ["chat", "threads", companyId] as const,
  threadsByAgent: (companyId: string, agentId: string) =>
    ["chat", "threads", companyId, "agent", agentId] as const,
  messages: (threadId: string) => ["chat", "messages", threadId] as const,
},
```

### Pattern 3: Real-time Invalidation in LiveUpdatesProvider

The server already emits `chat.message.created` with payload `{ threadId, messageId }`. The LiveUpdatesProvider handles all live events centrally. Add a handler there:

```typescript
// Source: ui/src/context/LiveUpdatesProvider.tsx — handleLiveEvent function
if (event.type === "chat.message.created") {
  const threadId = readString(payload.threadId);
  if (threadId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(threadId) });
    // Also refresh thread list so last-message preview stays current
    if (expectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads(expectedCompanyId) });
    }
  }
  return;
}
```

### Pattern 4: Agent Detail Tab Extension

AgentDetail already uses a tab bar with `PageTabBar` and a `Tabs` wrapper from shadcn. The `AgentDetailView` type and `parseAgentDetailView` function control which tab renders.

```typescript
// Source: ui/src/pages/AgentDetail.tsx
// Step 1 — Extend the type:
type AgentDetailView = "dashboard" | "configuration" | "runs" | "budget" | "chat";

// Step 2 — Extend the parser:
function parseAgentDetailView(value: string | null): AgentDetailView {
  if (value === "chat") return "chat";
  // ... existing cases
}

// Step 3 — Add tab item in the PageTabBar items array:
{ value: "chat", label: "Chat" }

// Step 4 — Add TabsContent panel:
// Render <AgentChatTab agentId={agentId} companyId={companyId} />
```

### Pattern 5: Sidebar Nav Item

Add to `Sidebar.tsx` inside the top section (alongside Dashboard and Inbox):

```typescript
// Source: ui/src/components/Sidebar.tsx
import { MessageSquare } from "lucide-react";
<SidebarNavItem to="/chat" label="Chat" icon={MessageSquare} />
```

### UI-06: Last Message Preview

The `listThreads` API currently returns raw `chatThreads` rows without any last-message data. Two options:

**Option A (recommended, pure client-side):** After fetching threads, for each thread also issue `listMessages(threadId, { limit: 1 })` in a follow-up query. This is simple but fires N queries for N threads.

**Option B (preferred at scale):** Add a server-side join in `chatService.listThreads` to include `lastMessage` in the response. This is a single query.

Given that the system is internal with small thread counts, Option A (client-side follow-up) is acceptable for v1. However if board members have many threads, a server-side join is cleaner. **Recommend Option B** — add a `lastMessage` field to the `listThreads` response by joining `chatMessages` in the service layer. This avoids N+1 in the browser.

The `listThreads` service in `server/src/services/chat.ts` currently does a simple `select().from(chatThreads)`. A lateral join or subquery can attach the latest message per thread.

### Anti-Patterns to Avoid
- **Polling for new messages:** Not needed — WebSocket invalidation is the correct approach. Do not add `refetchInterval` to the messages query.
- **Component-level WebSocket connections:** LiveUpdatesProvider already manages the single WebSocket connection. Do not open a second one for chat.
- **Custom fetch logic:** Use the `api` helper from `client.ts`. It handles credentials, Content-Type, and auth redirects.
- **URL params without companyPrefix:** All board routes are prefixed with `/:companyPrefix`. The `/chat` route must live inside the `boardRoutes()` function, not at the top level.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom markdown parser | `MarkdownBody` component (already exists) | Already handles GFM, mermaid, dark mode |
| Avatar/identity display | Custom avatar | `Identity` component + `AgentIcon` | Already handles initials, agent icons, sizing |
| Toast notifications | Custom toast | `useToast()` + `pushToast()` | Already hooked into app-wide ToastViewport |
| Real-time connection | New WebSocket | `LiveUpdatesProvider` (existing) + `queryClient.invalidateQueries` | One WS per company already managed |
| Date formatting | Custom formatter | `formatDate`, `relativeTime` from `lib/utils` | Already in use across all pages |
| Tab navigation | Custom tab state | `PageTabBar` + shadcn `Tabs` | Pattern already established in AgentDetail |
| Agent list for selector | Re-fetch in dialog | `useQuery(queryKeys.agents.list(companyId))` | Already cached from Sidebar/other pages |

## Common Pitfalls

### Pitfall 1: Stale Thread List After New Message
**What goes wrong:** Agent responds, `chat.message.created` fires, messages refresh, but thread list still shows old "last message" preview.
**Why it happens:** The thread list query and messages query are separate cache keys. Invalidating only messages leaves threads stale.
**How to avoid:** In the `chat.message.created` handler in `LiveUpdatesProvider`, invalidate BOTH `queryKeys.chat.messages(threadId)` AND `queryKeys.chat.threads(companyId)`.
**Warning signs:** Thread list shows old message preview after agent responds.

### Pitfall 2: Missing companyId in listThreads API scope
**What goes wrong:** Calling `GET /chat/threads/:threadId/messages` works, but `GET /companies/:companyId/chat/threads` returns empty or 403.
**Why it happens:** The API scopes thread listing to `creatorUserId` for board actors (see chat route: `req.actor.type === "board" ? req.actor.userId`). If the session doesn't resolve correctly, threads are filtered out.
**How to avoid:** Ensure `selectedCompanyId` from `useCompany()` is passed to the API call and is non-null before enabling the query.
**Warning signs:** Thread list is empty despite threads existing.

### Pitfall 3: Route order / missing Unprefixed redirect
**What goes wrong:** Navigating directly to `/chat` (without company prefix) shows 404 or wrong component.
**Why it happens:** boardRoutes() are mounted under `/:companyPrefix`. Direct `/chat` hits the outer routes which have no handler.
**How to avoid:** Add `<Route path="chat" element={<UnprefixedBoardRedirect />} />` in the outer routes alongside the existing ones for issues/agents.
**Warning signs:** `/chat` without prefix redirects to wrong page or 404.

### Pitfall 4: Agent tab URL collision
**What goes wrong:** Adding "chat" as an AgentDetail tab value breaks existing routes (`/agents/:agentId/chat` might conflict).
**Why it happens:** The agent detail routes include `agents/:agentId/:tab` — "chat" becomes a valid tab URL. This is actually correct and desired, but the `parseAgentDetailView` function must explicitly handle `"chat"` or it falls through to `"dashboard"`.
**How to avoid:** Add `if (value === "chat") return "chat";` to `parseAgentDetailView` before the default return.
**Warning signs:** Navigating to `/agents/:id/chat` shows the dashboard tab instead of chat tab.

### Pitfall 5: New Thread Dialog — first message sent before thread confirmed
**What goes wrong:** Optimistic create-thread then immediately send-message races result in 404 on message send.
**Why it happens:** `createThread` is async; if `sendMessage` is triggered before the response resolves, `threadId` is undefined.
**How to avoid:** Sequence operations: `const thread = await chatApi.createThread(...)` then `await chatApi.sendMessage(thread.id, ...)`. Both in the same mutation handler.
**Warning signs:** Console 404 errors on first message after thread creation.

### Pitfall 6: listThreads — N+1 for last message preview
**What goes wrong:** Fetching last message per thread causes N separate network requests.
**Why it happens:** The listThreads API doesn't include last-message data.
**How to avoid:** Add `lastMessage` to the server-side listThreads response (a single SQL lateral join). See Architecture Patterns — UI-06 option B above.
**Warning signs:** Network tab shows dozens of message requests on page load.

## Code Examples

### useQuery for thread list
```typescript
// Pattern source: ui/src/pages/Issues.tsx, ui/src/api/issues.ts
const { data: threads = [], isLoading } = useQuery({
  queryKey: queryKeys.chat.threads(companyId!),
  queryFn: () => chatApi.listThreads(companyId!),
  enabled: !!companyId,
});
```

### useMutation for sending a message
```typescript
// Pattern source: IssueDetail — addComment mutation pattern
const queryClient = useQueryClient();
const sendMessage = useMutation({
  mutationFn: (body: string) =>
    chatApi.sendMessage(threadId, { body }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(threadId) });
  },
});
```

### LiveUpdatesProvider chat handler addition
```typescript
// Add to handleLiveEvent in ui/src/context/LiveUpdatesProvider.tsx
if (event.type === "chat.message.created") {
  const threadId = readString(payload.threadId);
  if (threadId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(threadId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads(expectedCompanyId) });
  }
  return;
}
```

### Server-side listThreads with lastMessage (Option B for UI-06)
```typescript
// server/src/services/chat.ts — extend listThreads
// Use a subquery to attach latest message per thread
import { desc, max, sql } from "drizzle-orm";

// In listThreads: after base select, do a second query for last messages
// then merge client-side, or use a lateral join in Drizzle
// Simple approach: fetch latest message ids separately
const latestMessages = await db
  .select({
    threadId: chatMessages.threadId,
    body: chatMessages.body,
    senderType: chatMessages.senderType,
    createdAt: chatMessages.createdAt,
  })
  .from(chatMessages)
  .where(
    inArray(chatMessages.threadId, threads.map((t) => t.id))
  )
  .orderBy(asc(chatMessages.createdAt)); // then take last per threadId in-memory
```

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Per-component WebSocket | Single LiveUpdatesProvider + invalidation | Already in use; chat just adds a new event handler |
| Polling for live data | WebSocket push + React Query invalidation | Specified pattern; no refetchInterval needed |
| Custom tab routing | PageTabBar + shadcn Tabs + URL param | AgentDetail establishes this; chat tab follows same |

## Open Questions

1. **UI-06: last-message preview — server join vs. client-side**
   - What we know: listThreads returns no last-message data today
   - What's unclear: Whether to add it server-side (service + response type change) or client-side (N queries)
   - Recommendation: Add server-side in `chatService.listThreads` with a subquery. Return `lastMessage: { body, senderType, createdAt } | null` alongside each thread. This is a single SQL change with no schema migration.

2. **Sender name resolution for user messages**
   - What we know: `senderUserId` is a text field (Supabase user ID). There is no users list API in the UI currently — `Identity` component is used with hardcoded "You" for the current user in CommentThread.
   - What's unclear: Whether to show the actual user name or "You" / "Board Member"
   - Recommendation: Show "You" for the current user (compare `senderUserId` to session user id), and "Board Member" for other users. Agent names are resolved from the agents list query by `senderAgentId`. This matches the CommentThread component convention (it already uses `"You"` for non-agent senders).

3. **Auto-scroll to latest message**
   - What we know: `ScrollToBottom` component exists in `ui/src/components/ScrollToBottom.tsx`
   - What's unclear: Whether it works with the flex-column layout needed for chat
   - Recommendation: Use `ScrollToBottom` component or implement a `useEffect` that scrolls to bottom when `messages` array changes. AgentDetail's live run view already handles this (scroll helper pattern at lines 175–186 in AgentDetail.tsx).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts at root, server/vitest.config.ts, ui/vitest.config.ts) |
| Config file | `server/vitest.config.ts` (environment: "node") |
| Quick run command | `pnpm --filter server test --run src/__tests__/chat-routes.test.ts` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | /chat page renders thread list | manual | N/A — UI smoke | ❌ Wave 0 |
| UI-02 | Agent detail chat tab renders | manual | N/A — UI smoke | ❌ Wave 0 |
| UI-03 | Thread creation + first message round-trip | integration | `pnpm --filter server test --run src/__tests__/chat-routes.test.ts` | ✅ (server routes tested) |
| UI-04 | WebSocket invalidation triggers re-render | unit | N/A — manual test or dedicated vitest with jsdom | ❌ Wave 0 |
| UI-05 | Message display shows sender identity | manual | N/A — UI smoke | ❌ Wave 0 |
| UI-06 | Thread list last-message preview | integration | `pnpm --filter server test --run src/__tests__/chat-routes.test.ts` | ❌ Wave 0 (if server-side join added) |

### Sampling Rate
- **Per task commit:** `pnpm --filter server test --run src/__tests__/chat-routes.test.ts`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/src/__tests__/chat-routes.test.ts` — already exists; extend with listThreads-with-lastMessage test if server join added
- [ ] UI tests are manual-only for this phase (no jsdom test harness set up in `ui/vitest.config.ts`); UI-04 can be verified by manual inspection of network tab + React Query devtools

*(Existing `server/src/__tests__/chat-routes.test.ts` covers API-01 through API-07. UI components are not unit-tested in this codebase — manual verification is the pattern.)*

## Sources

### Primary (HIGH confidence)
- Direct code inspection — `ui/src/context/LiveUpdatesProvider.tsx` — WebSocket event handling and invalidation patterns
- Direct code inspection — `ui/src/pages/AgentDetail.tsx` — Tab extension pattern, PageTabBar usage
- Direct code inspection — `ui/src/App.tsx` — boardRoutes() and UnprefixedBoardRedirect patterns
- Direct code inspection — `ui/src/api/client.ts` — HTTP client pattern
- Direct code inspection — `ui/src/lib/queryKeys.ts` — React Query key conventions
- Direct code inspection — `server/src/routes/chat.ts` — API endpoint signatures and event types
- Direct code inspection — `server/src/services/chat.ts` — listThreads data shape
- Direct code inspection — `packages/shared/src/constants.ts` — `chat.message.created` LiveEventType confirmed present
- Direct code inspection — `packages/db/src/schema/chat_threads.ts` + `chat_messages.ts` — exact DB schema

### Secondary (MEDIUM confidence)
- Direct code inspection — `ui/src/components/CommentThread.tsx` — "You" convention for user sender display
- Direct code inspection — `ui/src/components/Sidebar.tsx` — SidebarNavItem API and placement convention

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and verified by reading package usage
- Architecture: HIGH — patterns verified by reading existing pages and components
- Pitfalls: HIGH — root causes verified from code; N+1 pitfall verified from service layer code
- API shape: HIGH — routes and schemas read directly from source

**Research date:** 2026-03-19
**Valid until:** 2026-04-18 (stable internal codebase; low churn expected)
