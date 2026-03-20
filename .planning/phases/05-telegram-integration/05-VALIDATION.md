---
phase: 5
slug: telegram-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (project standard, `vitest.config.ts` at root) |
| **Config file** | `vitest.config.ts` — telegram-bot is NOT currently in `projects` array |
| **Quick run command** | `pnpm test:run -- --reporter=verbose services/telegram-bot` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:run -- server/src/__tests__/chat-routes.test.ts`
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 0 | TELE-01 | unit | `pnpm test:run -- services/telegram-bot` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | TELE-01 | unit (mock fetch) | `pnpm test:run -- services/telegram-bot` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | TELE-02 | unit (supertest) | `pnpm test:run -- services/telegram-bot/src/__tests__/app.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | TELE-03 | unit (mock fetch) | `pnpm test:run -- services/telegram-bot/src/__tests__/conversation-manager.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-05 | 01 | 1 | TELE-04 | unit | `pnpm test:run -- services/telegram-bot/src/__tests__/app.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-06 | 01 | 1 | TELE-05 | unit (spy on fetch) | `pnpm test:run -- services/telegram-bot/src/__tests__/telegram.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-07 | 01 | 1 | TELE-06 | unit (mock fetch) | `pnpm test:run -- services/telegram-bot/src/__tests__/conversation-manager.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-08 | 01 | 1 | TELE-07 | integration | `pnpm test:run -- server/src/__tests__/chat-routes.test.ts` | Partial | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `services/telegram-bot/vitest.config.ts` — adds bot to test infrastructure
- [ ] `services/telegram-bot/src/__tests__/app.test.ts` — covers TELE-02 (immediate 200), TELE-04 (/new reset)
- [ ] `services/telegram-bot/src/__tests__/conversation-manager.test.ts` — covers TELE-03, TELE-06
- [ ] `services/telegram-bot/src/__tests__/telegram.test.ts` — covers TELE-05 (HTML parse mode)
- [ ] `server/src/__tests__/chat-routes.test.ts` — extend with TELE-07 dedup case (duplicate telegramUpdateId returns 409)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full round-trip: Telegram message → agent response in chat | TELE-01 | Requires live Telegram bot + running server | Send message to bot, verify response appears in same chat |
| Webhook returns 200 under load | TELE-02 | Load testing beyond unit scope | Send concurrent updates, verify all get 200 immediately |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
