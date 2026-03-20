---
phase: 4
slug: web-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (vitest.config.ts at root, server/vitest.config.ts, ui/vitest.config.ts) |
| **Config file** | `server/vitest.config.ts` (environment: "node") |
| **Quick run command** | `pnpm --filter server test --run src/__tests__/chat-routes.test.ts` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter server test --run src/__tests__/chat-routes.test.ts`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | UI-06 | integration | `pnpm --filter server test --run src/__tests__/chat-routes.test.ts` | ✅ (extend) | ⬜ pending |
| 4-02-01 | 02 | 1 | UI-01 | manual | N/A — UI smoke | ❌ W0 | ⬜ pending |
| 4-02-02 | 02 | 1 | UI-02 | manual | N/A — UI smoke | ❌ W0 | ⬜ pending |
| 4-02-03 | 02 | 1 | UI-03 | manual | N/A — UI smoke | ❌ W0 | ⬜ pending |
| 4-02-04 | 02 | 1 | UI-04 | manual | N/A — manual WebSocket verify | ❌ W0 | ⬜ pending |
| 4-02-05 | 02 | 1 | UI-05 | manual | N/A — UI smoke | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/src/__tests__/chat-routes.test.ts` — extend with listThreads-with-lastMessage test if server join added
- [ ] UI components are manual-only (no jsdom test harness in `ui/vitest.config.ts`)

*Existing `server/src/__tests__/chat-routes.test.ts` covers API-01 through API-07. UI components are not unit-tested in this codebase — manual verification is the established pattern.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| /chat page renders thread list | UI-01 | No jsdom UI test harness | Navigate to /chat, verify thread list renders |
| Agent detail chat tab | UI-02 | No jsdom UI test harness | Open agent detail, click Chat tab, verify threads shown |
| Thread creation flow | UI-03 | Requires UI interaction | Click new thread, select agent, send message, verify thread created |
| WebSocket live updates | UI-04 | Requires real WS connection | Send message from another context, verify it appears without refresh |
| Sender identity display | UI-05 | Visual verification | Send messages as user/agent, verify names + timestamps shown correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
