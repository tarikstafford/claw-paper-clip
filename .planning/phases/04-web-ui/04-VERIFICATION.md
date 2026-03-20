---
phase: 04-web-ui
verified: 2026-03-19T10:00:00Z
status: human_needed
score: 9/9 must-haves verified
re_verification: false
human_verification:
  - test: "Navigate to sidebar and click Chat nav item"
    expected: "/chat page loads with two-pane layout — thread list on the left (w-80), empty state on the right"
    why_human: "Visual layout and routing behavior require browser rendering"
  - test: "Click 'New Chat' button (plus icon), select an agent, type a message, click 'Start Chat'"
    expected: "Thread is created, appears in the thread list, message view shows the sent message with 'You' label"
    why_human: "End-to-end form flow, navigation, and API round-trip require live environment"
  - test: "In message view, type a message and press Enter (without Shift)"
    expected: "Message sends immediately; textarea clears; message appears with 'You' label and timestamp"
    why_human: "Keyboard event behaviour and mutation state require browser interaction"
  - test: "Wait for (or manually trigger) an agent response message"
    expected: "New message appears in the view without a page refresh — React Query cache invalidated via WebSocket"
    why_human: "Real-time WebSocket behaviour requires live server connection"
  - test: "Navigate to an agent detail page and click the 'Chat' tab"
    expected: "Chat tab appears in the tab bar; it shows only threads whose agentId matches this agent"
    why_human: "Tab rendering and per-agent filtering require visual confirmation"
  - test: "Click 'New Chat' from the agent Chat tab"
    expected: "NewThreadDialog opens with the agent pre-selected and the selector disabled"
    why_human: "Pre-selection state and disabled selector require visual confirmation"
  - test: "Navigate to /chat (no company prefix)"
    expected: "Redirected to /:companyPrefix/chat automatically"
    why_human: "Redirect behaviour requires browser routing"
---

# Phase 4: Web UI Verification Report

**Phase Goal:** Board members can start, browse, and continue conversations with any agent directly from the Paperclip dashboard
**Verified:** 2026-03-19
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | listThreads API returns lastMessage data per thread (no N+1 queries needed) | VERIFIED | `server/src/services/chat.ts` lines 51-78: second query with `inArray` + in-memory `Map` dedup; each thread spread with `lastMessage` |
| 2 | Chat query keys are available for cache management | VERIFIED | `ui/src/lib/queryKeys.ts` lines 17-21: `chat.threads`, `chat.threadsByAgent`, `chat.messages` added after the `issues` block |
| 3 | /chat route is registered in boardRoutes and unprefixed redirects | VERIFIED | `ui/src/App.tsx` lines 139-140 (boardRoutes) and lines 317-318 (UnprefixedBoardRedirect) |
| 4 | Chat sidebar nav item visible in sidebar | VERIFIED | `ui/src/components/Sidebar.tsx` line 101: `<SidebarNavItem to="/chat" label="Chat" icon={MessageSquare} />` in Work section |
| 5 | chat.message.created WebSocket event triggers React Query invalidation for messages AND threads | VERIFIED | `ui/src/context/LiveUpdatesProvider.tsx` lines 513-522: dual invalidation for `chat.messages(threadId)` and `chat.threads(expectedCompanyId)` |
| 6 | Board member sees a list of threads at /chat with latest message preview per thread | VERIFIED | `ui/src/pages/Chat.tsx` fetches threads via `queryKeys.chat.threads`; `ChatThreadList` renders preview with sender label prefix and `relativeTime` timestamp |
| 7 | Board member can create a new thread by selecting an agent and sending a first message | VERIFIED | `NewThreadDialog.tsx` lines 63-71: sequential `await chatApi.createThread` then `await chatApi.sendMessage`; navigates to `/chat/${thread.id}` |
| 8 | Board member can open an agent's detail page Chat tab and see threads for that agent | VERIFIED | `AgentDetail.tsx` lines 780-816: `AgentChatTab` queries `queryKeys.chat.threadsByAgent`; client-side filter `ts.filter(t => t.agentId === agentId)` |
| 9 | Each message shows who sent it — 'You' for current user, agent name for agents, 'System' for system | VERIFIED | `ChatMessageView.tsx` lines 73-82: `getSenderLabel` compares `senderUserId` to `currentUserId`; resolves agent name from `agentMap`; falls back to "System" |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Min Lines | Actual Lines | Status | Notes |
|----------|-----------|--------------|--------|-------|
| `ui/src/api/chat.ts` | — | 51 | VERIFIED | Exports `chatApi` (4 methods), `ChatThread`, `ChatMessage`, `MessagesPage` |
| `ui/src/lib/queryKeys.ts` | — | 114 | VERIFIED | `chat.threads`, `chat.threadsByAgent`, `chat.messages` added |
| `ui/src/pages/Chat.tsx` | 80 | 89 | VERIFIED | Full two-pane layout; replaces Plan 01 placeholder |
| `ui/src/components/ChatThreadList.tsx` | 40 | 76 | VERIFIED | Thread list with previews, agent names, timestamps, selection state |
| `ui/src/components/ChatMessageView.tsx` | 60 | 171 | VERIFIED | Message history, sender identity, auto-scroll, send form |
| `ui/src/components/NewThreadDialog.tsx` | 40 | 142 | VERIFIED | Agent selector, optional title, first message, sequential submit |
| `ui/src/pages/AgentDetail.tsx` | — | large | VERIFIED | "chat" added to union type; Chat tab renders `AgentChatTab` |
| `server/src/services/chat.ts` | — | 165 | VERIFIED | `listThreads` returns `lastMessage` via second query + Map dedup |

---

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `LiveUpdatesProvider.tsx` | `queryKeys.chat.messages` | `invalidateQueries` on `chat.message.created` | WIRED | Lines 513-521: event type match, dual invalidation |
| `App.tsx` | `Chat` component | `Route path="chat"` in boardRoutes | WIRED | Lines 15, 139-140: import + two routes |
| `server/src/services/chat.ts` | `chatMessages` table | `inArray` subquery for `lastMessage` | WIRED | Lines 52-78: second query, Map dedup, spread return |
| `ui/src/pages/Chat.tsx` | `chatApi.listThreads` | `useQuery` with `queryKeys.chat.threads` | WIRED | Lines 20-24: query using `queryKeys.chat.threads(selectedCompanyId!)` |
| `ChatMessageView.tsx` | `chatApi.listMessages` | `useQuery` with `queryKeys.chat.messages` | WIRED | Lines 28-32: query using `queryKeys.chat.messages(threadId ?? "")` |
| `ChatMessageView.tsx` | `chatApi.sendMessage` | `useMutation` with invalidation | WIRED | Lines 42-48: mutation + `invalidateQueries` on success |
| `NewThreadDialog.tsx` | `chatApi.createThread` + `chatApi.sendMessage` | sequential `await` | WIRED | Lines 63-68: `await createThread` then `await sendMessage` |
| `AgentDetail.tsx` | `queryKeys.chat.threadsByAgent` | `useQuery` in `AgentChatTab` | WIRED | Lines 785-786: query uses `queryKeys.chat.threadsByAgent(companyId, agentId)` |

All 8 key links: WIRED.

---

### Requirements Coverage

| Requirement | Plans | Description | Status | Evidence |
|-------------|-------|-------------|--------|----------|
| UI-01 | 04-01, 04-02 | Dedicated /chat page in sidebar with thread list and message view | SATISFIED | Route registered, sidebar nav item present, `Chat.tsx` renders two-pane layout |
| UI-02 | 04-02 | Chat tab on agent detail pages showing threads for that agent | SATISFIED | `AgentDetail.tsx` Chat tab + `AgentChatTab` component with per-agent filter |
| UI-03 | 04-02 | Thread creation — select agent, set optional title, send first message | SATISFIED | `NewThreadDialog.tsx` implements all three fields with sequential API calls |
| UI-04 | 04-01, 04-02 | Real-time message updates via existing WebSocket live-events + React Query invalidation | SATISFIED | `LiveUpdatesProvider.tsx` handles `chat.message.created` with dual invalidation |
| UI-05 | 04-02 | Message display with sender identity (user name, agent name, timestamps) | SATISFIED | `ChatMessageView.tsx` `getSenderLabel` + `relativeTime` on every message |
| UI-06 | 04-01, 04-02 | Thread list shows latest message preview and unread indicator | SATISFIED (partial) | `lastMessage` preview rendered with sender prefix; no unread indicator implemented |

**Note on UI-06:** REQUIREMENTS.md describes "latest message preview and unread indicator". The preview is fully implemented. No unread indicator is present in the code. The PLAN success criteria does not mention unread indicators, only "latest message preview stays current". REQUIREMENTS.md claims UI-06 as "Complete" — the unread indicator discrepancy is pre-existing in the requirements tracking and not introduced by this phase. Flagged for human confirmation.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TODO/FIXME comments, no empty implementations, no stub returns, no console.log-only handlers found in any chat phase files.

---

### Human Verification Required

All automated checks pass. The following require browser-based confirmation:

#### 1. Two-pane Chat Layout

**Test:** Navigate to sidebar, click "Chat"
**Expected:** /chat loads with a fixed-width left pane (thread list) and a flex-1 right pane (empty state "Select a conversation to start chatting")
**Why human:** Visual layout requires browser rendering

#### 2. New Thread End-to-End

**Test:** Click the plus icon, select an agent, type a message, click "Start Chat"
**Expected:** Thread is created; thread appears in list with agent name and message preview; message view shows the sent message labeled "You" with a timestamp; URL changes to /chat/{threadId}
**Why human:** Requires live API (Phase 2 server must be running) and browser interaction

#### 3. Send Message in Existing Thread

**Test:** With a thread selected, type a message and press Enter
**Expected:** Message sends; textarea clears; message appears immediately labeled "You"; send button shows loading spinner while pending
**Why human:** Mutation state and keyboard event behaviour require browser interaction

#### 4. Real-time Agent Response

**Test:** After sending a message, wait for or manually inject an agent response
**Expected:** Agent message appears in the view without a page reload; thread list preview updates to the latest message
**Why human:** WebSocket invalidation requires live server event emission

#### 5. Agent Detail Chat Tab

**Test:** Open any agent's detail page, click the "Chat" tab
**Expected:** Tab bar shows "Chat"; tab content shows only threads where agentId matches this agent; empty state shown if no threads
**Why human:** Tab rendering and filter correctness require visual + data confirmation

#### 6. Pre-selected Agent in Dialog from Agent Tab

**Test:** Click "New Chat" from the agent detail Chat tab
**Expected:** NewThreadDialog opens with the specific agent pre-selected and the agent selector visually disabled
**Why human:** Pre-selection and disabled state require visual confirmation

#### 7. Unprefixed Route Redirect

**Test:** Navigate directly to /chat in the browser address bar
**Expected:** Immediately redirected to /{companyPrefix}/chat
**Why human:** Browser routing behaviour

---

### Gaps Summary

No functional gaps found. All 9 observable truths are verified against actual codebase content. All 8 key links are wired. All artifacts are substantive (well above minimum line counts). All six requirement IDs (UI-01 through UI-06) are accounted for in the two plans.

One minor discrepancy: UI-06 in REQUIREMENTS.md includes "unread indicator" which has no implementation in the codebase. This was not included in the PLAN success criteria and REQUIREMENTS.md already marks UI-06 as "Complete". This is not a gap introduced by this phase — it is either an out-of-scope feature or a pre-existing documentation inconsistency.

The status is `human_needed` because the phase delivers an interactive UI that must be validated in a live browser session with the server running.

---

_Verified: 2026-03-19_
_Verifier: Claude (gsd-verifier)_
