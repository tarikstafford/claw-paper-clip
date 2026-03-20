---
phase: 6
slug: fix-agent-chat-tab
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `server/vitest.config.ts` |
| **Quick run command** | `pnpm vitest run --project server --reporter=verbose server/src/__tests__/chat-routes.test.ts` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --project server --reporter=verbose server/src/__tests__/chat-routes.test.ts`
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | UI-02 | unit | `pnpm vitest run --project server server/src/__tests__/chat-routes.test.ts` | ✅ (existing file, new tests) | ⬜ pending |
| 06-01-02 | 01 | 1 | UI-02 | unit | `pnpm vitest run --project server server/src/__tests__/chat-routes.test.ts` | ✅ (existing tests) | ⬜ pending |
| 06-01-03 | 01 | 1 | UI-04 | manual | Browser verification | N/A | ⬜ pending |
| 06-01-04 | 01 | 1 | UI-06 | integration | Covered by route + rendering | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases in `server/src/__tests__/chat-routes.test.ts` — agentId query param filter behavior

*Existing infrastructure covers most phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WebSocket threadsByAgent invalidation refreshes agent Chat tab | UI-04 | LiveUpdatesProvider runs in browser context; no server-side unit test possible | 1. Open agent detail Chat tab. 2. Send a message to that agent from another tab/user. 3. Verify thread list updates without page refresh. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
