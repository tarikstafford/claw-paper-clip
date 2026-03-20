---
phase: 2
slug: chat-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.0.5 |
| **Config file** | `server/vitest.config.ts` |
| **Quick run command** | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` |
| **Full suite command** | `cd server && pnpm vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts`
- **After every plan wave:** Run `cd server && pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | API-01..07 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | API-01 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | API-02 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | API-03 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | API-04 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 1 | API-05 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-07 | 01 | 1 | API-06 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-08 | 01 | 1 | API-07 | unit | `cd server && pnpm vitest run src/__tests__/chat-routes.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/src/__tests__/chat-routes.test.ts` — test stubs for API-01 through API-07 (mock DB + heartbeat service)
- [ ] `server/src/__tests__/chat-service.test.ts` — optional: cursor pagination logic unit tests

*Existing infrastructure at `server/vitest.config.ts` is complete — no framework install needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
