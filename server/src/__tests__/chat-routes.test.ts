import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatRoutes } from "../routes/chat.js";
import { errorHandler } from "../middleware/index.js";

// --- Hoisted mocks ---

const mockChatService = vi.hoisted(() => ({
  createThread: vi.fn(),
  listThreads: vi.fn(),
  getThread: vi.fn(),
  createMessage: vi.fn(),
  listMessages: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockPublishLiveEvent = vi.hoisted(() => vi.fn());

const mockCompactionService = vi.hoisted(() => ({
  countMessageTokens: vi.fn(),
  buildThreadPrompt: vi.fn(),
}));

vi.mock("../services/chat.js", () => ({
  chatService: () => mockChatService,
}));

vi.mock("../services/heartbeat.js", () => ({
  heartbeatService: () => mockHeartbeatService,
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: mockPublishLiveEvent,
}));

// --- App factory helpers ---

type ActorOverride =
  | { type: "board"; userId: string; companyIds: string[] }
  | { type: "agent"; agentId: string; companyId: string }
  | { type: "none" };

function createApp(actor: ActorOverride = { type: "board", userId: "user-1", companyIds: ["company-1"] }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor =
      actor.type === "board"
        ? { type: "board", userId: actor.userId, companyIds: actor.companyIds, source: "session", isInstanceAdmin: false }
        : actor.type === "agent"
          ? { type: "agent", agentId: actor.agentId, companyId: actor.companyId, source: "agent_key" }
          : { type: "none", source: "none" };
    next();
  });
  app.use("/api", chatRoutes({} as any, mockCompactionService as any));
  app.use(errorHandler);
  return app;
}

// --- Shared fixtures ---

const COMPANY_ID = "company-1";
// Must be valid UUIDs to pass createThreadSchema validation
const AGENT_ID = "a0000000-0000-4000-8000-000000000001";
const THREAD_ID = "b0000000-0000-4000-8000-000000000001";
const USER_ID = "user-1";

const sampleThread = {
  id: THREAD_ID,
  companyId: COMPANY_ID,
  agentId: AGENT_ID,
  title: "Support chat",
  creatorUserId: USER_ID,
  creatorAgentId: null,
  createdAt: new Date("2024-01-01T10:00:00Z"),
  updatedAt: new Date("2024-01-01T10:00:00Z"),
};

const sampleMessage = (id: string, senderType = "user", processingStatus = "enqueued") => ({
  id,
  threadId: THREAD_ID,
  senderType,
  senderUserId: senderType === "user" ? USER_ID : null,
  senderAgentId: senderType === "agent" ? AGENT_ID : null,
  body: "Hello world",
  processingStatus,
  createdAt: new Date("2024-01-01T10:00:00Z"),
  updatedAt: new Date("2024-01-01T10:00:00Z"),
});

// ============================================================
// POST /companies/:companyId/chat/threads
// ============================================================

describe("POST /companies/:companyId/chat/threads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatService.createThread.mockResolvedValue(sampleThread);
  });

  // API-01: Creates thread, returns 201 + thread object
  it("API-01: creates thread with valid data and returns 201 with thread object", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${COMPANY_ID}/chat/threads`)
      .send({ agentId: AGENT_ID, title: "Support chat" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: THREAD_ID,
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
    });
    expect(mockChatService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        agentId: AGENT_ID,
        title: "Support chat",
      }),
    );
  });

  // API-06: Board user sets creatorUserId
  it("API-06: board caller sets creatorUserId on created thread", async () => {
    await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .post(`/api/companies/${COMPANY_ID}/chat/threads`)
      .send({ agentId: AGENT_ID });

    expect(mockChatService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorUserId: USER_ID,
        creatorAgentId: null,
      }),
    );
  });

  // API-06: Agent caller sets creatorAgentId
  it("API-06: agent caller sets creatorAgentId on created thread", async () => {
    const agentThread = { ...sampleThread, creatorUserId: null, creatorAgentId: AGENT_ID };
    mockChatService.createThread.mockResolvedValue(agentThread);

    await request(createApp({ type: "agent", agentId: AGENT_ID, companyId: COMPANY_ID }))
      .post(`/api/companies/${COMPANY_ID}/chat/threads`)
      .send({ agentId: AGENT_ID });

    expect(mockChatService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorUserId: null,
        creatorAgentId: AGENT_ID,
      }),
    );
  });

  // API-06: Returns 401 for unauthenticated caller (send valid body so validate passes, auth check rejects)
  it("returns 401 for unauthenticated caller", async () => {
    const res = await request(createApp({ type: "none" }))
      .post(`/api/companies/${COMPANY_ID}/chat/threads`)
      .send({ agentId: AGENT_ID });

    expect(res.status).toBe(401);
  });

  // Validation: Returns 400 when body is missing agentId (ZodError → 400 in error handler)
  it("returns 400 when agentId is missing", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${COMPANY_ID}/chat/threads`)
      .send({ title: "only a title" });

    expect(res.status).toBe(400);
  });

  // Cross-company access returns 403
  it("returns 403 when board user does not belong to the company", async () => {
    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: ["other-company"] }))
      .post(`/api/companies/${COMPANY_ID}/chat/threads`)
      .send({ agentId: AGENT_ID });

    expect(res.status).toBe(403);
  });
});

// ============================================================
// GET /companies/:companyId/chat/threads
// ============================================================

describe("GET /companies/:companyId/chat/threads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatService.listThreads.mockResolvedValue([sampleThread]);
  });

  // API-02: Board user sees only their threads (filtered by creatorUserId)
  it("API-02: board user receives threads filtered by their userId", async () => {
    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .get(`/api/companies/${COMPANY_ID}/chat/threads`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockChatService.listThreads).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ creatorUserId: USER_ID }),
    );
  });

  // API-02: Agent sees only threads matching their agentId
  it("API-02: agent receives threads filtered by their agentId", async () => {
    mockChatService.listThreads.mockResolvedValue([]);
    const res = await request(createApp({ type: "agent", agentId: AGENT_ID, companyId: COMPANY_ID }))
      .get(`/api/companies/${COMPANY_ID}/chat/threads`);

    expect(res.status).toBe(200);
    expect(mockChatService.listThreads).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ creatorAgentId: AGENT_ID }),
    );
  });

  // API-06: Returns 401 for unauthenticated caller
  it("returns 401 for unauthenticated caller", async () => {
    const res = await request(createApp({ type: "none" }))
      .get(`/api/companies/${COMPANY_ID}/chat/threads`);

    expect(res.status).toBe(401);
  });

  // Cross-company access returns 403
  it("returns 403 when board user does not belong to the company", async () => {
    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: ["other-company"] }))
      .get(`/api/companies/${COMPANY_ID}/chat/threads`);

    expect(res.status).toBe(403);
  });

  // UI-02: board user with agentId param receives all threads for that agent
  it("UI-02: board user with agentId param receives all threads for that agent", async () => {
    const AGENT_UUID = "c0000000-0000-4000-8000-000000000001";
    const threadFromOtherUser = {
      ...sampleThread,
      id: "d0000000-0000-4000-8000-000000000001",
      agentId: AGENT_UUID,
      creatorUserId: "other-user-id",
    };
    mockChatService.listThreads.mockResolvedValue([sampleThread, threadFromOtherUser]);

    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .get(`/api/companies/${COMPANY_ID}/chat/threads?agentId=${AGENT_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(mockChatService.listThreads).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ agentId: AGENT_UUID }),
    );
    // Should NOT filter by creatorUserId when agentId is provided
    expect(mockChatService.listThreads).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ creatorUserId: undefined }),
    );
  });

  // UI-02: board user without agentId param still receives own threads only (no regression)
  it("UI-02: board user without agentId param still receives own threads only (no regression)", async () => {
    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .get(`/api/companies/${COMPANY_ID}/chat/threads`);

    expect(res.status).toBe(200);
    expect(mockChatService.listThreads).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ creatorUserId: USER_ID }),
    );
    // Should NOT have agentId filter when no param
    expect(mockChatService.listThreads).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ agentId: undefined }),
    );
  });

  // UI-02: agent caller ignores agentId query param
  it("UI-02: agent caller ignores agentId query param", async () => {
    const OTHER_AGENT_UUID = "e0000000-0000-4000-8000-000000000001";
    mockChatService.listThreads.mockResolvedValue([]);

    const res = await request(createApp({ type: "agent", agentId: AGENT_ID, companyId: COMPANY_ID }))
      .get(`/api/companies/${COMPANY_ID}/chat/threads?agentId=${OTHER_AGENT_UUID}`);

    expect(res.status).toBe(200);
    // Agent caller always filters by its own creatorAgentId, ignoring query param
    expect(mockChatService.listThreads).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ creatorAgentId: AGENT_ID }),
    );
    expect(mockChatService.listThreads).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ agentId: undefined }),
    );
  });
});

// ============================================================
// GET /chat/threads/:threadId/messages
// ============================================================

describe("GET /chat/threads/:threadId/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatService.getThread.mockResolvedValue(sampleThread);
  });

  // API-03: Returns messages in chronological order with nextCursor when results == limit
  it("API-03: returns messages and nextCursor when result count equals limit", async () => {
    const msgs = Array.from({ length: 50 }, (_, i) => sampleMessage(`msg-${i + 1}`));
    mockChatService.listMessages.mockResolvedValue(msgs);

    const res = await request(createApp())
      .get(`/api/chat/threads/${THREAD_ID}/messages`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(50);
    expect(res.body.nextCursor).toBe("msg-50");
  });

  // API-03: Returns nextCursor null when fewer results than limit
  it("API-03: returns nextCursor null when fewer messages than limit", async () => {
    const msgs = [sampleMessage("msg-1"), sampleMessage("msg-2")];
    mockChatService.listMessages.mockResolvedValue(msgs);

    const res = await request(createApp())
      .get(`/api/chat/threads/${THREAD_ID}/messages`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.nextCursor).toBeNull();
  });

  // API-03: Cursor parameter passes afterMessageId to service
  it("API-03: passes after cursor to listMessages service", async () => {
    mockChatService.listMessages.mockResolvedValue([sampleMessage("msg-5")]);

    const res = await request(createApp())
      .get(`/api/chat/threads/${THREAD_ID}/messages?after=msg-3`);

    expect(res.status).toBe(200);
    expect(mockChatService.listMessages).toHaveBeenCalledWith(
      THREAD_ID,
      expect.objectContaining({ afterMessageId: "msg-3" }),
    );
  });

  // Returns 404 when thread does not exist
  it("returns 404 when thread does not exist", async () => {
    mockChatService.getThread.mockResolvedValue(undefined);

    const res = await request(createApp())
      .get(`/api/chat/threads/nonexistent/messages`);

    expect(res.status).toBe(404);
  });

  // Returns 403 when thread belongs to a different company
  it("returns 403 when thread belongs to a different company than the actor", async () => {
    mockChatService.getThread.mockResolvedValue({ ...sampleThread, companyId: "other-company" });

    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .get(`/api/chat/threads/${THREAD_ID}/messages`);

    expect(res.status).toBe(403);
  });
});

// ============================================================
// POST /chat/threads/:threadId/messages
// ============================================================

describe("POST /chat/threads/:threadId/messages", () => {
  const msg = sampleMessage("new-msg-1", "user", "enqueued");

  beforeEach(() => {
    vi.clearAllMocks();
    mockChatService.getThread.mockResolvedValue(sampleThread);
    mockChatService.createMessage.mockResolvedValue(msg);
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "wake-1" });
    mockPublishLiveEvent.mockReturnValue(undefined);
    mockCompactionService.buildThreadPrompt.mockResolvedValue({
      prompt: "compacted-thread-context-for-test",
      wasCompacted: false,
      tokensBefore: 100,
      tokensAfter: 100,
    });
  });

  // API-04: User message is inserted with processingStatus="enqueued", returns 201
  it("API-04: user message is saved with processingStatus=enqueued and returns 201", async () => {
    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Hello agent!" });

    expect(res.status).toBe(201);
    expect(mockChatService.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: "enqueued",
        senderType: "user",
      }),
    );
  });

  // API-05: User message triggers heartbeat.wakeup with correct agentId and contextSnapshot
  it("API-05: user message triggers heartbeat.wakeup with agentId and contextSnapshot containing threadId and messageId", async () => {
    await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Wake the agent" });

    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({
        contextSnapshot: expect.objectContaining({
          threadId: THREAD_ID,
          messageId: "new-msg-1",
        }),
      }),
    );
  });

  // API-07: Agent message sets senderType="agent", processingStatus="processed"
  it("API-07: agent message is saved with senderType=agent and processingStatus=processed", async () => {
    const agentMsg = sampleMessage("agent-msg-1", "agent", "processed");
    mockChatService.createMessage.mockResolvedValue(agentMsg);

    const res = await request(createApp({ type: "agent", agentId: AGENT_ID, companyId: COMPANY_ID }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Here is my response." });

    expect(res.status).toBe(201);
    expect(mockChatService.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        senderType: "agent",
        processingStatus: "processed",
      }),
    );
  });

  // API-07: Agent message does NOT trigger heartbeat.wakeup (prevents infinite loop)
  it("API-07: agent message does NOT trigger heartbeat.wakeup", async () => {
    const agentMsg = sampleMessage("agent-msg-1", "agent", "processed");
    mockChatService.createMessage.mockResolvedValue(agentMsg);

    await request(createApp({ type: "agent", agentId: AGENT_ID, companyId: COMPANY_ID }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Agent reply." });

    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  // Live event published for every message (user and agent)
  it("publishes chat.message.created live event for user message", async () => {
    await request(createApp())
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Hello" });

    expect(mockPublishLiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chat.message.created",
        companyId: COMPANY_ID,
        payload: expect.objectContaining({ threadId: THREAD_ID, messageId: "new-msg-1" }),
      }),
    );
  });

  it("publishes chat.message.created live event for agent message", async () => {
    const agentMsg = sampleMessage("agent-msg-1", "agent", "processed");
    mockChatService.createMessage.mockResolvedValue(agentMsg);

    await request(createApp({ type: "agent", agentId: AGENT_ID, companyId: COMPANY_ID }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Agent reply." });

    expect(mockPublishLiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chat.message.created" }),
    );
  });

  // API-06: Both board and agent callers can post messages
  it("API-06: board caller can post a message successfully", async () => {
    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Board message." });

    expect(res.status).toBe(201);
  });

  it("API-06: agent caller can post a message successfully", async () => {
    const agentMsg = sampleMessage("agent-msg-1", "agent", "processed");
    mockChatService.createMessage.mockResolvedValue(agentMsg);

    const res = await request(createApp({ type: "agent", agentId: AGENT_ID, companyId: COMPANY_ID }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Agent message." });

    expect(res.status).toBe(201);
  });

  // Returns 404 when thread does not exist
  it("returns 404 when thread does not exist", async () => {
    mockChatService.getThread.mockResolvedValue(undefined);

    const res = await request(createApp())
      .post(`/api/chat/threads/nonexistent/messages`)
      .send({ body: "Hello" });

    expect(res.status).toBe(404);
  });

  // Validation: Returns 400 when body is empty (ZodError → 400 in error handler)
  it("returns 400 when message body is empty", async () => {
    const res = await request(createApp())
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "" });

    expect(res.status).toBe(400);
  });
});

// ============================================================
// TELE-07: Telegram dedup — 409 on duplicate telegramUpdateId
// ============================================================

describe("TELE-07: telegram dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatService.getThread.mockResolvedValue(sampleThread);
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "wake-1" });
    mockPublishLiveEvent.mockReturnValue(undefined);
    mockCompactionService.buildThreadPrompt.mockResolvedValue({
      prompt: "compacted-thread-context-for-test",
      wasCompacted: false,
      tokensBefore: 100,
      tokensAfter: 100,
    });
  });

  it("POST message with telegramUpdateId succeeds (201)", async () => {
    const msg = sampleMessage("tele-msg-1", "user", "enqueued");
    mockChatService.createMessage.mockResolvedValue(msg);

    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "hello", telegramUpdateId: 999001 });

    expect(res.status).toBe(201);
    expect(mockChatService.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUpdateId: 999001 }),
    );
  });

  it("POST duplicate telegramUpdateId returns 409", async () => {
    const duplicateError = Object.assign(new Error("duplicate key"), { code: "23505" });
    mockChatService.createMessage.mockRejectedValue(duplicateError);

    const res = await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "hello", telegramUpdateId: 999001 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "Duplicate telegram update" });
  });
});

// ============================================================
// COMP-05: Context injection — paperclipChatThreadContext
// ============================================================

describe("COMP-05: context injection into heartbeat wakeup", () => {
  const msg = sampleMessage("comp05-msg-1", "user", "enqueued");

  beforeEach(() => {
    vi.clearAllMocks();
    mockChatService.getThread.mockResolvedValue(sampleThread);
    mockChatService.createMessage.mockResolvedValue(msg);
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "wake-1" });
    mockPublishLiveEvent.mockReturnValue(undefined);
    mockCompactionService.buildThreadPrompt.mockResolvedValue({
      prompt: "compacted-thread-context-for-test",
      wasCompacted: false,
      tokensBefore: 100,
      tokensAfter: 100,
    });
  });

  it("COMP-05: user message wakeup contains contextSnapshot.paperclipChatThreadContext from buildThreadPrompt", async () => {
    await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Hello agent!" });

    expect(mockCompactionService.buildThreadPrompt).toHaveBeenCalledWith(THREAD_ID, "claude-sonnet-4-5");
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({
        contextSnapshot: expect.objectContaining({
          paperclipChatThreadContext: "compacted-thread-context-for-test",
        }),
      }),
    );
  });

  it("COMP-05: paperclipChatThreadContext value matches exactly what buildThreadPrompt returns", async () => {
    mockCompactionService.buildThreadPrompt.mockResolvedValue({
      prompt: "custom-compacted-prompt-xyz",
      wasCompacted: true,
      tokensBefore: 150_000,
      tokensAfter: 5_000,
    });

    await request(createApp({ type: "board", userId: USER_ID, companyIds: [COMPANY_ID] }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Message that triggers compaction" });

    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({
        contextSnapshot: expect.objectContaining({
          paperclipChatThreadContext: "custom-compacted-prompt-xyz",
        }),
      }),
    );
  });

  it("COMP-05: agent message does NOT trigger wakeup (no regression)", async () => {
    const agentMsg = sampleMessage("agent-comp05-1", "agent", "processed");
    mockChatService.createMessage.mockResolvedValue(agentMsg);

    await request(createApp({ type: "agent", agentId: AGENT_ID, companyId: COMPANY_ID }))
      .post(`/api/chat/threads/${THREAD_ID}/messages`)
      .send({ body: "Agent reply." });

    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    // buildThreadPrompt should not be called for agent messages
    expect(mockCompactionService.buildThreadPrompt).not.toHaveBeenCalled();
  });
});
