import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactionService } from "../services/compaction.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockCountTokens = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockDbSelectResult = vi.hoisted(() => vi.fn());
const mockDbInsert = vi.hoisted(() => vi.fn());
const mockDbUpdate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      countTokens: mockCountTokens,
      create: mockCreate,
    },
  })),
}));

vi.mock("@paperclipai/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/db")>();
  return {
    ...actual,
  };
});

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a fluent drizzle-query mock that returns `rows` for .select().from().where().orderBy().
 */
function buildMockDb(rows: unknown[]) {
  const orderByMock = vi.fn().mockResolvedValue(rows);
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const valuesInsertMock = vi.fn().mockResolvedValue([]);
  const insertMock = vi.fn(() => ({ values: valuesInsertMock }));

  const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
  const updateMock = vi.fn(() => ({ set: setMock }));

  return {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    _mocks: {
      orderBy: orderByMock,
      where: whereMock,
      from: fromMock,
      select: selectMock,
      valuesInsert: valuesInsertMock,
      insert: insertMock,
      set: setMock,
      update: updateMock,
    },
  };
}

function buildMockAnthropic() {
  return {
    messages: {
      countTokens: mockCountTokens,
      create: mockCreate,
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THREAD_ID = "c0000000-0000-4000-8000-000000000001";

function makeMessage(
  id: string,
  senderType: "user" | "agent",
  body: string,
  tokenCount: number | null = null,
) {
  return {
    id,
    threadId: THREAD_ID,
    senderType,
    body,
    tokenCount,
    createdAt: new Date("2024-01-01T10:00:00Z"),
    updatedAt: new Date("2024-01-01T10:00:00Z"),
  };
}

// ---------------------------------------------------------------------------
// COMP-01: Token counting
// ---------------------------------------------------------------------------

describe("COMP-01: countMessageTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a number when Anthropic API succeeds", async () => {
    mockCountTokens.mockResolvedValue({ input_tokens: 42 });
    const db = buildMockDb([]) as any;
    const anthropic = buildMockAnthropic() as any;
    const svc = compactionService(db, anthropic);

    const result = await svc.countMessageTokens("Hello world", "claude-sonnet-4-5");

    expect(result).toBe(42);
    expect(mockCountTokens).toHaveBeenCalledWith({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello world" }],
    });
  });

  it("returns null when Anthropic API throws", async () => {
    mockCountTokens.mockRejectedValue(new Error("API error"));
    const db = buildMockDb([]) as any;
    const anthropic = buildMockAnthropic() as any;
    const svc = compactionService(db, anthropic);

    const result = await svc.countMessageTokens("Hello world", "claude-sonnet-4-5");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// COMP-02: buildThreadPrompt — prompt structure
// ---------------------------------------------------------------------------

describe("COMP-02: buildThreadPrompt — verbatim path (few messages)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all verbatim and wasCompacted=false when token count is below threshold", async () => {
    // 5 messages with low token counts (far below 110k threshold)
    const messages = [
      makeMessage("m1", "user", "Hi agent", 10),
      makeMessage("m2", "agent", "Hello user", 10),
      makeMessage("m3", "user", "How are you?", 10),
      makeMessage("m4", "agent", "I am fine", 10),
      makeMessage("m5", "user", "Great", 10),
    ];

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;
    const svc = compactionService(db, anthropic);

    const result = await svc.buildThreadPrompt(THREAD_ID, "claude-sonnet-4-5");

    expect(result.wasCompacted).toBe(false);
    expect(result.tokensBefore).toBe(50);
    expect(result.tokensAfter).toBe(50);
    expect(result.prompt).toContain("[user]: Hi agent");
    expect(result.prompt).toContain("[agent]: Hello user");
    // No XML summary tags when verbatim
    expect(result.prompt).not.toContain("<conversation_summary>");
  });

  it("returns verbatim and wasCompacted=false when messages <= DEFAULT_VERBATIM_TURNS even if above threshold", async () => {
    // 5 messages with very high token counts (above 110k) but <= 20 messages
    const messages = [
      makeMessage("m1", "user", "big message", 50_000),
      makeMessage("m2", "agent", "big response", 60_100),
    ];

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;
    const svc = compactionService(db, anthropic);

    const result = await svc.buildThreadPrompt(THREAD_ID, "claude-sonnet-4-5");

    expect(result.wasCompacted).toBe(false);
    // No summarization API call for small message counts
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("COMP-02: buildThreadPrompt — compacted path (many messages)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compacts when messages > 20 and tokens >= threshold, returns summary + verbatim", async () => {
    // Create 25 messages, each with 5000 tokens (total = 125k > 110k threshold)
    const messages = Array.from({ length: 25 }, (_, i) =>
      makeMessage(`m${i + 1}`, i % 2 === 0 ? "user" : "agent", `Message ${i + 1}`, 5_000),
    );

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Summary of the first 5 messages." }],
    });
    mockCountTokens.mockResolvedValue({ input_tokens: 200 });

    const svc = compactionService(db, anthropic);
    const result = await svc.buildThreadPrompt(THREAD_ID, "claude-sonnet-4-5");

    expect(result.wasCompacted).toBe(true);
    expect(result.prompt).toContain("<conversation_summary>");
    expect(result.prompt).toContain("</conversation_summary>");
    expect(result.prompt).toContain("<recent_messages>");
    expect(result.prompt).toContain("</recent_messages>");
    expect(result.prompt).toContain("Summary of the first 5 messages.");
  });

  it("merges consecutive same-role messages before summarization API call", async () => {
    // Create 21 messages with pattern: user, user, agent, user (to test merging)
    // First 2 messages will be in the "to summarize" batch (21 total, last 20 are verbatim)
    const messages = [
      makeMessage("m1", "user", "First user message", 60_000),
      makeMessage("m2", "user", "Second user message", 60_000),
    ];
    // Add 20 more messages for verbatim tail (alternating)
    for (let i = 3; i <= 22; i++) {
      messages.push(makeMessage(`m${i}`, i % 2 === 0 ? "agent" : "user", `Message ${i}`, 100));
    }

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Summary." }],
    });
    mockCountTokens.mockResolvedValue({ input_tokens: 50 });

    const svc = compactionService(db, anthropic);
    await svc.buildThreadPrompt(THREAD_ID, "claude-sonnet-4-5");

    // The summarization should have been called
    expect(mockCreate).toHaveBeenCalled();

    // Verify the messages passed to create — consecutive user messages should be merged
    const createCall = mockCreate.mock.calls[0][0];
    const anthropicMessages = createCall.messages;
    // First message in batch was m1 (user) and m2 (user) — they should merge to 1 user message
    expect(anthropicMessages[0].role).toBe("user");
    // The merged content should contain both bodies
    const firstContent = anthropicMessages[0].content;
    if (typeof firstContent === "string") {
      expect(firstContent).toContain("First user message");
      expect(firstContent).toContain("Second user message");
    } else {
      // Array of blocks
      const textBlocks = firstContent.map((b: any) => (typeof b === "string" ? b : b.text)).join("\n");
      expect(textBlocks).toContain("First user message");
      expect(textBlocks).toContain("Second user message");
    }
  });
});

// ---------------------------------------------------------------------------
// COMP-03: Threshold logic
// ---------------------------------------------------------------------------

describe("COMP-03: compaction threshold logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers compaction when total tokens >= 55% of 200k (110,000)", async () => {
    // 21 messages, sum = 110,000 (exactly at threshold)
    const messages = Array.from({ length: 21 }, (_, i) =>
      makeMessage(`m${i + 1}`, i % 2 === 0 ? "user" : "agent", `Message ${i + 1}`, Math.ceil(110_000 / 21)),
    );

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Summary." }],
    });
    mockCountTokens.mockResolvedValue({ input_tokens: 50 });

    const svc = compactionService(db, anthropic);
    const result = await svc.buildThreadPrompt(THREAD_ID, "claude-sonnet-4-5");

    expect(result.wasCompacted).toBe(true);
  });

  it("does NOT trigger compaction when total tokens < 110,000", async () => {
    const messages = Array.from({ length: 21 }, (_, i) =>
      makeMessage(`m${i + 1}`, i % 2 === 0 ? "user" : "agent", `Message ${i + 1}`, 100),
    );

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;
    const svc = compactionService(db, anthropic);

    const result = await svc.buildThreadPrompt(THREAD_ID, "claude-sonnet-4-5");

    expect(result.wasCompacted).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("falls back to DEFAULT_CONTEXT_WINDOW (200k) for unknown model", async () => {
    // Threshold for unknown model = 200k * 0.55 = 110k
    // Use 21 messages summing to 115k (just above 110k)
    const messages = Array.from({ length: 21 }, (_, i) =>
      makeMessage(`m${i + 1}`, i % 2 === 0 ? "user" : "agent", `Message ${i + 1}`, Math.ceil(115_000 / 21)),
    );

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Summary for unknown model." }],
    });
    mockCountTokens.mockResolvedValue({ input_tokens: 50 });

    const svc = compactionService(db, anthropic);
    const result = await svc.buildThreadPrompt(THREAD_ID, "unknown-model-xyz");

    expect(result.wasCompacted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// COMP-04: Audit row in chatCompactionEvents
// ---------------------------------------------------------------------------

describe("COMP-04: audit row recorded in chatCompactionEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a row into chatCompactionEvents after compaction", async () => {
    const messages = Array.from({ length: 25 }, (_, i) =>
      makeMessage(`m${i + 1}`, i % 2 === 0 ? "user" : "agent", `Message ${i + 1}`, 5_000),
    );

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Test summary text." }],
    });
    mockCountTokens.mockResolvedValue({ input_tokens: 300 });

    const svc = compactionService(db, anthropic);
    await svc.buildThreadPrompt(THREAD_ID, "claude-sonnet-4-5");

    // Insert should have been called
    expect(db.insert).toHaveBeenCalled();
    expect(db._mocks.valuesInsert).toHaveBeenCalled();

    const auditRow = db._mocks.valuesInsert.mock.calls[0][0];
    expect(auditRow).toMatchObject({
      threadId: THREAD_ID,
      summaryText: "Test summary text.",
      model: "claude-sonnet-4-5",
    });
    expect(auditRow.compactedMessageCount).toBeGreaterThan(0);
    expect(auditRow.tokenCountBefore).toBeGreaterThan(0);
    expect(auditRow.tokenCountAfter).toBeGreaterThan(0);
    expect(auditRow.summaryTokenCount).toBe(300);
  });

  it("audit row contains correct compactedMessageCount matching non-verbatim messages", async () => {
    // 25 total messages, last 20 are verbatim → 5 should be compacted
    const messages = Array.from({ length: 25 }, (_, i) =>
      makeMessage(`m${i + 1}`, i % 2 === 0 ? "user" : "agent", `Message ${i + 1}`, 5_000),
    );

    const db = buildMockDb(messages) as any;
    const anthropic = buildMockAnthropic() as any;

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Summary." }],
    });
    mockCountTokens.mockResolvedValue({ input_tokens: 100 });

    const svc = compactionService(db, anthropic);
    await svc.buildThreadPrompt(THREAD_ID, "claude-sonnet-4-5");

    const auditRow = db._mocks.valuesInsert.mock.calls[0][0];
    // 25 - 20 verbatim = 5 compacted
    expect(auditRow.compactedMessageCount).toBe(5);
  });
});
