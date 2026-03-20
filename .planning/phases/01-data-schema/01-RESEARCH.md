# Phase 1: Data Schema - Research

**Researched:** 2026-03-19
**Domain:** Drizzle ORM schema authoring + PostgreSQL constraints + migration generation for `@paperclipai/db`
**Confidence:** HIGH — all findings are sourced from the project's own codebase; no external guesswork required

---

## Summary

Phase 1 adds two new tables (`chat_threads` and `chat_messages`) to the existing `@paperclipai/db` package. The project already has a well-established, consistent pattern for Drizzle schema authoring, migration generation, and migration application. There is nothing experimental here: every tool, convention, and workflow is already in use by 35 existing migrations.

The critical implementation steps are: (1) write two new schema files under `packages/db/src/schema/`, (2) export them from `packages/db/src/schema/index.ts`, (3) run `pnpm generate` in the `@paperclipai/db` package to produce the SQL migration file, and (4) verify the migration applies cleanly. The idempotency guard required by DATA-03 is a standard PostgreSQL `UNIQUE` constraint, expressed in Drizzle as `uniqueIndex(...)` in the table config function — exactly as the project already uses for `issues_identifier_idx` and `companies_issue_prefix_idx`.

**Primary recommendation:** Follow the existing schema file pattern exactly (`pgTable` + camelCase field names + `{ withTimezone: true }` on all timestamps + named indexes in the table config callback) and use `pnpm generate` (not manual SQL) to produce the migration.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DATA-01 | Chat threads table with company_id, agent_id, creator info, title, and timestamps | Drizzle schema pattern confirmed; FK targets (`companies`, `agents`) are existing tables |
| DATA-02 | Chat messages table with thread_id, sender type (user/agent/system), body, token_count, and timestamps | Drizzle schema pattern confirmed; `integer` type for token_count, `text` for sender_type enum-as-text |
| DATA-03 | Telegram idempotency guard — unique constraint on telegram_update_id to prevent duplicate processing | `uniqueIndex(...)` in Drizzle table config; nullable column with partial unique index is the correct pattern |
| DATA-04 | Processing status on messages to track enqueued → processed state | `text` column with `.default("enqueued")` — matches how `agentWakeupRequests.status` is modelled |
| DATA-05 | Drizzle migration for all new chat tables | `pnpm generate` in `packages/db` produces SQL; migration applied via existing `applyPendingMigrations` |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.38.4 | Schema definition, query builder | Already the project ORM — all 35+ tables use it |
| drizzle-kit | ^0.31.9 | Migration file generation (`pnpm generate`) | Already in devDependencies of `@paperclipai/db` |
| postgres | ^3.4.5 | PostgreSQL driver | Already the project driver |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-orm/pg-core | (same) | `pgTable`, `uuid`, `text`, `integer`, `timestamp`, `index`, `uniqueIndex` | Every schema file |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `text` for sender_type / processing_status | `pgEnum` | Enums are harder to migrate; project consistently uses `text` with `.default()` — stick with text |
| `uniqueIndex` for telegram dedup | application-level check | DB constraint guarantees are stronger; uniqueIndex is the correct choice |

**Generation command (run from `packages/db`):**
```bash
pnpm generate   # produces next numbered .sql file in src/migrations/
```

**Migration apply:**
```bash
pnpm migrate    # runs tsx src/migrate.ts against DATABASE_URL
```

---

## Architecture Patterns

### Package Location
New schema files go in:
```
packages/db/src/schema/
├── chat_threads.ts        # new — DATA-01
├── chat_messages.ts       # new — DATA-02, DATA-03, DATA-04
└── index.ts               # add two new exports
```

The generated migration lands in:
```
packages/db/src/migrations/
└── 0035_<drizzle-name>.sql    # next sequential number after 0034
```

The `_journal.json` is updated automatically by `drizzle-kit generate`.

### Pattern 1: Standard Table Definition
**What:** Every table uses `pgTable(tableName, columns, (table) => ({ ...indexes }))` with uuid PK, `withTimezone: true` on all timestamps, and named indexes.
**When to use:** Always — every table in the project follows this.

```typescript
// Source: packages/db/src/schema/issues.ts (verified)
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    creatorAgentId: uuid("creator_agent_id").references(() => agents.id),
    creatorUserId: text("creator_user_id"),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentIdx: index("chat_threads_company_agent_idx").on(table.companyId, table.agentId),
    companyCreatedAtIdx: index("chat_threads_company_created_at_idx").on(table.companyId, table.createdAt),
  }),
);
```

### Pattern 2: Creator Info (Dual-Column Agent+User Pattern)
**What:** The project represents "created by either an agent or a user" as two nullable columns: `creator_agent_id uuid` (FK to agents) and `creator_user_id text`. This is used by `issues` (`createdByAgentId`, `createdByUserId`) and `issue_comments` (`authorAgentId`, `authorUserId`).
**When to use:** Any entity that can be created by either an agent or a board user. Apply this to `chat_threads`.

### Pattern 3: Enum-as-Text
**What:** Status/type fields use `text(...).notNull().default("value")` — never `pgEnum`. This avoids painful enum ALTER TABLE migrations.
**When to use:** `sender_type` (values: `user`, `agent`, `system`) and `processing_status` (values: `enqueued`, `processed`).

```typescript
// Source: packages/db/src/schema/agent_wakeup_requests.ts (verified)
status: text("status").notNull().default("queued"),
```

### Pattern 4: Unique Constraint for Idempotency
**What:** `uniqueIndex(...)` inside the table config callback produces a `UNIQUE INDEX` in the migration. This is the correct Drizzle approach for DATA-03.
**When to use:** `telegram_update_id` must be globally unique across all messages. Make the column nullable (`bigint` or `text`, nullable) so non-Telegram messages are not constrained. The unique index should cover non-null values only — use a partial unique index in raw SQL if Drizzle generates a full unique index (see pitfall below).

```typescript
// Source: packages/db/src/schema/companies.ts (verified — full unique)
issuePrefixUniqueIdx: uniqueIndex("companies_issue_prefix_idx").on(table.issuePrefix),

// For nullable telegram_update_id, the preferred approach in Drizzle:
telegramUpdateIdIdx: uniqueIndex("chat_messages_telegram_update_id_idx").on(table.telegramUpdateId),
// Note: PostgreSQL UNIQUE indexes naturally ignore NULL values (multiple NULLs allowed),
// so a standard uniqueIndex on a nullable column is correct without needing a partial index.
```

### Pattern 5: Exporting from Schema Index
**What:** Every new schema file must be added to `packages/db/src/schema/index.ts` as a named export.
**When to use:** Always — the `createDb` factory in `client.ts` imports `* as schema` from `schema/index.ts` and passes it to drizzle, which is how the ORM knows about all tables.

### Recommended `chat_messages` Column Set
Based on DATA-02, DATA-03, DATA-04 combined:

```typescript
// Source: pattern derived from issues.ts + agent_wakeup_requests.ts (verified)
import { pgTable, uuid, text, integer, timestamp, bigint, index, uniqueIndex } from "drizzle-orm/pg-core";
import { chatThreads } from "./chat_threads.js";

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").notNull().references(() => chatThreads.id),
    senderType: text("sender_type").notNull(),          // "user" | "agent" | "system"
    senderAgentId: uuid("sender_agent_id"),             // populated when senderType = "agent"
    senderUserId: text("sender_user_id"),               // populated when senderType = "user"
    body: text("body").notNull(),
    tokenCount: integer("token_count"),
    processingStatus: text("processing_status").notNull().default("enqueued"),
    telegramUpdateId: bigint("telegram_update_id", { mode: "number" }),  // nullable; unique when set
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadCreatedAtIdx: index("chat_messages_thread_created_at_idx").on(table.threadId, table.createdAt),
    processingStatusIdx: index("chat_messages_processing_status_idx").on(table.processingStatus),
    telegramUpdateIdIdx: uniqueIndex("chat_messages_telegram_update_id_idx").on(table.telegramUpdateId),
  }),
);
```

### Anti-Patterns to Avoid
- **Generating migrations by hand:** Always use `pnpm generate`. Hand-written SQL will not be tracked in `_journal.json` and will break the migration system.
- **Using `pgEnum`:** The project uses text columns for all status/type fields. Do not introduce the first enum — it adds ALTER TABLE complexity for future values.
- **Omitting `{ withTimezone: true }`:** Every timestamp in the project uses this option. Omitting it produces `timestamp without time zone`, which is inconsistent and causes subtle timezone bugs.
- **Forgetting the schema index export:** If the table is not exported from `schema/index.ts`, the ORM schema object won't include it and drizzle-kit won't generate a migration for it.
- **Using `onDelete: "cascade"` without thinking:** Cascade deletes on `chat_threads` would destroy all messages. Use `onDelete: "cascade"` on `chat_messages.thread_id` (deleting a thread should delete its messages), but NOT on thread → company or thread → agent foreign keys.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unique-per-non-null telegram_update_id | Application-level dedup check | PostgreSQL `UNIQUE` index on nullable column | PostgreSQL UNIQUE indexes skip NULLs natively; multiple NULL rows are allowed; constraint fires only on duplicate non-null values |
| Migration tracking | Custom migration table | drizzle-kit's `__drizzle_migrations` journal | Already implemented in `client.ts`; custom solutions would break `inspectMigrations` |
| Migration application | Raw `psql` calls | `applyPendingMigrations(url)` | Custom reconciliation logic already handles hash-based dedup, journal repair, and transaction safety |
| Processing status transitions | State machine library | `text` column + direct DB update | Single-step transition (`enqueued` → `processed`); no state machine needed |

**Key insight:** PostgreSQL `UNIQUE` indexes on nullable columns already provide exactly the semantics DATA-03 requires. NULLs are not considered equal for uniqueness purposes, so non-Telegram messages (where `telegram_update_id IS NULL`) coexist without conflict.

---

## Common Pitfalls

### Pitfall 1: drizzle-kit reads compiled JS, not TypeScript source
**What goes wrong:** `pnpm generate` fails or produces an empty migration.
**Why it happens:** `drizzle.config.ts` specifies `schema: "./dist/schema/*.js"` — it reads the compiled output, not `src/`. If `tsc` has not been run, there are no `.js` files to read.
**How to avoid:** The `generate` script in `package.json` is `tsc -p tsconfig.json && drizzle-kit generate` — it compiles first. Always use `pnpm generate`, not `drizzle-kit generate` directly.
**Warning signs:** drizzle-kit reports "No schema changes detected" despite new files.

### Pitfall 2: New schema file not exported from index.ts
**What goes wrong:** drizzle-kit generates an empty migration (no new tables appear). The ORM `schema` object passed to `drizzle()` does not include the new table.
**Why it happens:** `client.ts` does `import * as schema from "./schema/index.js"` — only exported symbols are included.
**How to avoid:** Add export lines to `schema/index.ts` immediately when creating new schema files.
**Warning signs:** Migration SQL has no `CREATE TABLE` statements.

### Pitfall 3: Forgetting `withTimezone: true` on timestamps
**What goes wrong:** Columns land as `timestamp without time zone` in PostgreSQL.
**Why it happens:** Drizzle's `timestamp()` defaults to no timezone unless specified.
**How to avoid:** Every timestamp call must be `timestamp("col_name", { withTimezone: true })`. Check the existing schema files for confirmation.

### Pitfall 4: Circular import between chat_threads and chat_messages
**What goes wrong:** TypeScript module resolution error at build time.
**Why it happens:** `chat_messages` imports `chat_threads` for the FK reference. If `chat_threads` also imports `chat_messages` this creates a circular dependency.
**How to avoid:** Only `chat_messages` imports `chat_threads` (for the FK). `chat_threads` imports nothing from `chat_messages`. The pattern is unidirectional.

### Pitfall 5: Using `bigint` mode incorrectly for telegram_update_id
**What goes wrong:** Drizzle returns `string` instead of `number` for bigint columns.
**Why it happens:** JavaScript doesn't support 64-bit integers natively. Drizzle offers `{ mode: "number" }` and `{ mode: "bigint" }` — `"number"` is safe for Telegram update IDs (they fit in JS number safely for the foreseeable future).
**How to avoid:** Use `bigint("telegram_update_id", { mode: "number" })` to get `number | null` in TypeScript.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Hand-written SQL migrations | drizzle-kit generate from TypeScript schema | Already the project standard |
| Enum types for status fields | Text columns with `.default()` | Already the project standard |

No deprecated patterns detected in the project's migration system.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.5 |
| Config file | `packages/db/vitest.config.ts` (exists) |
| Quick run command | `cd packages/db && pnpm vitest run` |
| Full suite command | `cd packages/db && pnpm vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | `chat_threads` row can be inserted with company_id, agent_id, creator info, title, and retrieved | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ Wave 0 |
| DATA-02 | `chat_messages` row can be inserted with sender_type, body, token_count, processing_status, and retrieved ordered by created_at | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ Wave 0 |
| DATA-03 | Inserting duplicate `telegram_update_id` fails at DB constraint level | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ Wave 0 |
| DATA-04 | Message with `processing_status=enqueued` can be updated to `processed` without conflict | integration | `cd packages/db && pnpm vitest run src/__tests__/chat-schema.test.ts` | ❌ Wave 0 |
| DATA-05 | `pnpm migrate` applies all new tables to a fresh Supabase instance without error | smoke/manual | `cd packages/db && pnpm migrate` (requires DATABASE_URL) | N/A — migration file is the artifact |

**Note on integration tests:** Schema integration tests require a live PostgreSQL connection. The existing `runtime-config.test.ts` avoids the DB entirely. For DATA-01 through DATA-04, the tests need a test database. The `embedded-postgres` package (already a dependency) provides an in-process Postgres for tests — this is the recommended approach to avoid external DB dependency in CI.

### Sampling Rate
- **Per task commit:** `cd packages/db && pnpm vitest run src/runtime-config.test.ts` (existing test, no DB needed)
- **Per wave merge:** `cd packages/db && pnpm vitest run` (full suite including new chat schema tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/db/src/__tests__/chat-schema.test.ts` — covers DATA-01, DATA-02, DATA-03, DATA-04 using embedded-postgres
- [ ] Shared test helper for embedded-postgres setup/teardown (can be inline in the test file for simplicity)

---

## Code Examples

### Schema file structure (verified from codebase)

```typescript
// packages/db/src/schema/chat_threads.ts
// Source: pattern from packages/db/src/schema/issues.ts + issue_comments.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    creatorAgentId: uuid("creator_agent_id").references(() => agents.id),
    creatorUserId: text("creator_user_id"),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentIdx: index("chat_threads_company_agent_idx").on(table.companyId, table.agentId),
    companyCreatedAtIdx: index("chat_threads_company_created_at_idx").on(table.companyId, table.createdAt),
  }),
);
```

### Index export addition (verified pattern)

```typescript
// packages/db/src/schema/index.ts — add these two lines
export { chatThreads } from "./chat_threads.js";
export { chatMessages } from "./chat_messages.js";
```

### Expected generated SQL shape

```sql
-- Generated by drizzle-kit generate (do not write manually)
CREATE TABLE "chat_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "creator_agent_id" uuid,
  "creator_user_id" text,
  "title" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL,
  "sender_type" text NOT NULL,
  "sender_agent_id" uuid,
  "sender_user_id" text,
  "body" text NOT NULL,
  "token_count" integer,
  "processing_status" text DEFAULT 'enqueued' NOT NULL,
  "telegram_update_id" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- ... FK constraints and indexes follow
```

---

## Open Questions

1. **`sender_agent_id` FK to agents table**
   - What we know: messages can come from agents (`senderType = "agent"`). The `agents` table exists and is the obvious FK target.
   - What's unclear: Telegram messages come in via bot, not a Paperclip agent row. The Telegram integration (Phase 5) may insert messages where `senderType = "system"` or a dedicated bot agent exists.
   - Recommendation: Make `sender_agent_id` nullable (no `notNull()`). No FK enforcement issue since it's nullable.

2. **`token_count` nullability**
   - What we know: Phase 3 (COMP-01) computes token count at write time using Anthropic SDK. Phase 1 just needs the column.
   - What's unclear: Should Phase 1 messages have `token_count = NULL` (filled in later) or is a default of 0 appropriate?
   - Recommendation: Leave `tokenCount` nullable (`integer("token_count")` with no `.notNull()`) — Phase 3 fills it in. Avoids coupling Phase 1 to Phase 3's counting logic.

---

## Sources

### Primary (HIGH confidence)
- `packages/db/src/schema/issues.ts` — verified table definition pattern, FK conventions, index naming
- `packages/db/src/schema/issue_comments.ts` — verified dual author pattern (agent + user)
- `packages/db/src/schema/agent_wakeup_requests.ts` — verified text-status pattern with `.default()`
- `packages/db/src/schema/companies.ts` — verified `uniqueIndex` usage
- `packages/db/src/schema/auth.ts` — verified `text` PK for user IDs
- `packages/db/drizzle.config.ts` — confirmed `schema: "./dist/schema/*.js"` (compile first requirement)
- `packages/db/package.json` — confirmed `generate` script: `tsc -p tsconfig.json && drizzle-kit generate`
- `packages/db/src/client.ts` — confirmed `import * as schema from "./schema/index.js"` pattern
- `packages/db/src/migrations/0029_plugin_tables.sql` — verified SQL output format from drizzle-kit
- `packages/db/src/migrations/meta/_journal.json` — confirmed journal structure, next idx is 35

### Secondary (MEDIUM confidence)
- PostgreSQL documentation (known behavior): UNIQUE indexes skip NULL values — multiple NULL rows are allowed. This is ANSI SQL compliant and applies to all modern Postgres versions.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from project's own package.json files; no external lookup required
- Architecture: HIGH — 35 existing schema files provide unambiguous patterns to follow
- Pitfalls: HIGH — derived from reading actual drizzle.config.ts and client.ts; not speculative
- PostgreSQL NULL uniqueness behavior: HIGH — well-established SQL standard behavior

**Research date:** 2026-03-19
**Valid until:** 2026-06-19 (drizzle-orm is a stable, slow-moving library; patterns are stable)
