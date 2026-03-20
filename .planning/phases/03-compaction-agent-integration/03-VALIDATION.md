---
phase: 3
slug: compaction-agent-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `server/vitest.config.ts` |
| **Quick run command** | `pnpm --filter @paperclipai/server test --run -- compaction` |
| **Full suite command** | `pnpm --filter @paperclipai/server test --run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @paperclipai/server test --run -- compaction`
- **After every plan wave:** Run `pnpm --filter @paperclipai/server test --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 0 | COMP-01 | unit | `pnpm --filter @paperclipai/server test --run -- compaction-service` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 0 | COMP-02 | unit | `pnpm --filter @paperclipai/server test --run -- compaction-service` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 0 | COMP-03 | unit | `pnpm --filter @paperclipai/server test --run -- compaction-service` | ❌ W0 | ⬜ pending |
| 3-01-04 | 01 | 0 | COMP-04 | unit | `pnpm --filter @paperclipai/server test --run -- compaction-service` | ❌ W0 | ⬜ pending |
| 3-01-05 | 01 | 0 | COMP-05 | unit | `pnpm --filter @paperclipai/server test --run -- chat-routes` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/src/__tests__/compaction-service.test.ts` — stubs for COMP-01, COMP-02, COMP-03, COMP-04
- [ ] `packages/db/src/schema/chat_compaction_events.ts` — schema required before service tests
- [ ] `packages/db/src/migrations/0036_<name>.sql` — DB migration for compaction events table
- [ ] `pnpm --filter @paperclipai/server add @anthropic-ai/sdk` — new SDK dependency
- [ ] Extend `server/src/__tests__/chat-routes.test.ts` — new `it` blocks for COMP-05

*Existing infrastructure covers test framework — Wave 0 adds test files and dependencies only.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
