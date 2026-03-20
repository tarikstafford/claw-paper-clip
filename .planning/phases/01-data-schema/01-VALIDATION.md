---
phase: 1
slug: data-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.0.5 |
| **Config file** | `packages/db/vitest.config.ts` |
| **Quick run command** | `cd packages/db && pnpm vitest run` |
| **Full suite command** | `cd packages/db && pnpm vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/db && pnpm vitest run src/runtime-config.test.ts`
- **After every plan wave:** Run `cd packages/db && pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | DATA-01..04 | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | DATA-01 | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | DATA-02 | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | DATA-03 | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 1 | DATA-04 | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-06 | 01 | 2 | DATA-05 | smoke | `cd packages/db && pnpm migrate` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/db/src/__tests__/chat-schema.test.ts` — stubs for DATA-01, DATA-02, DATA-03, DATA-04 using embedded-postgres
- [ ] Shared test helper for embedded-postgres setup/teardown

*Existing infrastructure covers vitest framework — only test files need creating.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration applies to fresh Supabase | DATA-05 | Requires DATABASE_URL to live instance | Run `cd packages/db && pnpm migrate` against a fresh Supabase project |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
