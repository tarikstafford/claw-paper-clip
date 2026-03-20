import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { eq, asc } from "drizzle-orm";
import { chatThreads } from "../schema/chat_threads.js";
import { chatMessages } from "../schema/chat_messages.js";
import { applyPendingMigrations, createDb, type Db } from "../client.js";

// Use a random port to avoid conflicts with other test runs or local postgres
const TEST_PORT = 54_000 + (Math.floor(Math.random() * 999) + 1);
const TEST_DB_NAME = "chat_schema_test";
const TEST_USER = "postgres";
const TEST_PASSWORD = "test_password_123";

let pg: EmbeddedPostgres;
let db: Db;
let connectionUrl: string;

// Prerequisite IDs for FK constraints
let companyId: string;
let agentId: string;

beforeAll(async () => {
  const databaseDir = join(tmpdir(), `embedded-pg-chat-test-${randomBytes(6).toString("hex")}`);

  pg = new EmbeddedPostgres({
    databaseDir,
    port: TEST_PORT,
    user: TEST_USER,
    password: TEST_PASSWORD,
    persistent: false,
    onLog: () => {}, // suppress log output during tests
    onError: () => {}, // suppress error output during tests
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(TEST_DB_NAME);

  connectionUrl = `postgresql://${TEST_USER}:${TEST_PASSWORD}@localhost:${TEST_PORT}/${TEST_DB_NAME}`;

  // Apply all migrations to create the full schema
  await applyPendingMigrations(connectionUrl);

  db = createDb(connectionUrl);
}, 120_000); // Allow up to 2 minutes for embedded-postgres to initialise

afterAll(async () => {
  await pg.stop();
}, 30_000);

beforeEach(async () => {
  // Clean chat tables before each test to ensure isolation
  // Delete in dependency order: messages before threads
  await db.delete(chatMessages);
  await db.delete(chatThreads);

  // Insert prerequisite rows for FK constraints using raw SQL via the pg client
  // We need valid company and agent rows for chat_threads.company_id and .agent_id
  const prerequisiteClient = pg.getPgClient(TEST_DB_NAME);
  await prerequisiteClient.connect();
  try {
    // Upsert a company for test isolation
    companyId = "11111111-1111-1111-1111-111111111111";
    agentId = "22222222-2222-2222-2222-222222222222";

    await prerequisiteClient.query(`
      INSERT INTO companies (id, name, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents, require_board_approval_for_new_agents)
      VALUES ($1, 'Test Company', 'active', 'TST', 0, 0, 0, false)
      ON CONFLICT (id) DO NOTHING
    `, [companyId]);

    await prerequisiteClient.query(`
      INSERT INTO agents (id, company_id, name, role, status, adapter_type, adapter_config, runtime_config, budget_monthly_cents, spent_monthly_cents, permissions)
      VALUES ($1, $2, 'Test Agent', 'general', 'idle', 'process', '{}', '{}', 0, 0, '{}')
      ON CONFLICT (id) DO NOTHING
    `, [agentId, companyId]);
  } finally {
    await prerequisiteClient.end();
  }
});

describe("chat schema integration tests", () => {
  it("DATA-01: can insert and retrieve a chat thread", async () => {
    const [inserted] = await db
      .insert(chatThreads)
      .values({
        companyId,
        agentId,
        creatorUserId: "user-abc",
        title: "Support Chat #1",
      })
      .returning();

    expect(inserted).toBeDefined();
    expect(inserted.id).toBeTruthy();
    expect(inserted.companyId).toBe(companyId);
    expect(inserted.agentId).toBe(agentId);
    expect(inserted.creatorUserId).toBe("user-abc");
    expect(inserted.title).toBe("Support Chat #1");
    expect(inserted.createdAt).toBeInstanceOf(Date);
    expect(inserted.updatedAt).toBeInstanceOf(Date);

    // Retrieve and verify all fields match
    const [retrieved] = await db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.id, inserted.id));

    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(inserted.id);
    expect(retrieved.companyId).toBe(companyId);
    expect(retrieved.agentId).toBe(agentId);
    expect(retrieved.creatorUserId).toBe("user-abc");
    expect(retrieved.title).toBe("Support Chat #1");
    expect(retrieved.createdAt).toEqual(inserted.createdAt);
    expect(retrieved.updatedAt).toEqual(inserted.updatedAt);
  });

  it("DATA-02: can insert and retrieve messages ordered by creation time", async () => {
    const [thread] = await db
      .insert(chatThreads)
      .values({ companyId, agentId })
      .returning();

    // Insert two messages with explicit createdAt values to ensure ordering
    const [msg1] = await db
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        senderType: "user",
        senderUserId: "user-abc",
        body: "First message",
        tokenCount: 10,
        processingStatus: "processed",
        createdAt: new Date("2024-01-01T10:00:00Z"),
        updatedAt: new Date("2024-01-01T10:00:00Z"),
      })
      .returning();

    const [msg2] = await db
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        senderType: "agent",
        senderAgentId: agentId,
        body: "Second message reply",
        tokenCount: 25,
        processingStatus: "processed",
        createdAt: new Date("2024-01-01T10:01:00Z"),
        updatedAt: new Date("2024-01-01T10:01:00Z"),
      })
      .returning();

    // Retrieve ordered by createdAt ascending
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, thread.id))
      .orderBy(asc(chatMessages.createdAt));

    expect(messages).toHaveLength(2);

    // Verify ordering: first message comes first
    expect(messages[0].id).toBe(msg1.id);
    expect(messages[1].id).toBe(msg2.id);

    // Verify first message fields
    expect(messages[0].senderType).toBe("user");
    expect(messages[0].senderUserId).toBe("user-abc");
    expect(messages[0].body).toBe("First message");
    expect(messages[0].tokenCount).toBe(10);
    expect(messages[0].processingStatus).toBe("processed");

    // Verify second message fields
    expect(messages[1].senderType).toBe("agent");
    expect(messages[1].senderAgentId).toBe(agentId);
    expect(messages[1].body).toBe("Second message reply");
    expect(messages[1].tokenCount).toBe(25);
    expect(messages[1].processingStatus).toBe("processed");
  });

  it("DATA-03: rejects duplicate telegram_update_id but allows multiple NULLs", async () => {
    const [thread] = await db
      .insert(chatThreads)
      .values({ companyId, agentId })
      .returning();

    // Insert first message with telegramUpdateId = 12345
    await db.insert(chatMessages).values({
      threadId: thread.id,
      senderType: "user",
      body: "Telegram message",
      telegramUpdateId: 12345,
    });

    // Insert second message with the same telegramUpdateId — must throw a unique constraint error
    await expect(
      db.insert(chatMessages).values({
        threadId: thread.id,
        senderType: "user",
        body: "Duplicate Telegram message",
        telegramUpdateId: 12345,
      }),
    ).rejects.toThrow();

    // Verify that two messages with NULL telegramUpdateId can coexist (no constraint violation)
    await db.insert(chatMessages).values({
      threadId: thread.id,
      senderType: "user",
      body: "Message without Telegram ID (1)",
      telegramUpdateId: null,
    });

    await db.insert(chatMessages).values({
      threadId: thread.id,
      senderType: "user",
      body: "Message without Telegram ID (2)",
      telegramUpdateId: null,
    });

    const nullMessages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, thread.id));

    // Should have 3 total: one with telegramUpdateId=12345 and two with NULL
    expect(nullMessages).toHaveLength(3);
    const nullTelegramMessages = nullMessages.filter((m) => m.telegramUpdateId === null);
    expect(nullTelegramMessages).toHaveLength(2);
  });

  it("DATA-04: can update processing_status from enqueued to processed", async () => {
    const [thread] = await db
      .insert(chatThreads)
      .values({ companyId, agentId })
      .returning();

    // Insert a message — processingStatus defaults to "enqueued"
    const [message] = await db
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        senderType: "user",
        body: "Message to process",
      })
      .returning();

    // Verify default processingStatus is "enqueued"
    expect(message.processingStatus).toBe("enqueued");

    // Update processingStatus to "processed"
    await db
      .update(chatMessages)
      .set({ processingStatus: "processed" })
      .where(eq(chatMessages.id, message.id));

    // Retrieve and verify the status changed
    const [updated] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, message.id));

    expect(updated.processingStatus).toBe("processed");
  });
});
