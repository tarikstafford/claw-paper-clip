import { Router } from "express";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, projects, projectWorkspaces } from "@paperclipai/db";
import type { CreateThread, SendMessage } from "@paperclipai/shared";
import { createThreadSchema, sendMessageSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { unauthorized, notFound } from "../errors.js";
import { publishLiveEvent } from "../services/live-events.js";
import { heartbeatService } from "../services/heartbeat.js";
import { chatService } from "../services/chat.js";
import { logActivity } from "../services/activity-log.js";
import type { compactionService } from "../services/compaction.js";

export function chatRoutes(db: Db, compactionSvc: ReturnType<typeof compactionService>) {
  const router = Router();
  const svc = chatService(db, compactionSvc);
  const heartbeat = heartbeatService(db);

  // POST /companies/:companyId/chat/threads — create thread (API-01)
  router.post("/companies/:companyId/chat/threads", validate(createThreadSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "none") throw unauthorized();

    const { agentId, title } = req.body as CreateThread;
    const actor = getActorInfo(req);

    const thread = await svc.createThread({
      companyId,
      agentId,
      title: title ?? null,
      creatorUserId: actor.actorType === "user" ? actor.actorId : null,
      creatorAgentId: actor.actorType === "agent" ? actor.actorId : null,
    });

    res.status(201).json(thread);
  });

  // GET /companies/:companyId/chat/threads — list threads filtered by actor (API-02)
  router.get("/companies/:companyId/chat/threads", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "none") throw unauthorized();

    const agentIdFilter =
      req.actor.type === "board" && typeof req.query.agentId === "string"
        ? req.query.agentId
        : undefined;

    const threads = await svc.listThreads(companyId, {
      agentId: agentIdFilter,
      creatorUserId: !agentIdFilter && req.actor.type === "board" ? req.actor.userId : undefined,
      creatorAgentId: req.actor.type === "agent" ? req.actor.agentId : undefined,
    });

    res.json(threads);
  });

  // GET /chat/threads/:threadId/messages — cursor-paginated messages (API-03)
  router.get("/chat/threads/:threadId/messages", async (req, res) => {
    const threadId = req.params.threadId as string;
    const thread = await svc.getThread(threadId);
    if (!thread) throw notFound("Thread not found");
    assertCompanyAccess(req, thread.companyId);

    const afterId = typeof req.query.after === "string" ? req.query.after : null;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);

    const messages = await svc.listMessages(threadId, { afterMessageId: afterId, limit });
    const nextCursor = messages.length === limit ? (messages[messages.length - 1]?.id ?? null) : null;

    res.json({ messages, nextCursor });
  });

  // POST /chat/threads/:threadId/messages — send message, wake agent on user message (API-04, API-05, API-06, API-07)
  router.post("/chat/threads/:threadId/messages", validate(sendMessageSchema), async (req, res) => {
    const threadId = req.params.threadId as string;
    const thread = await svc.getThread(threadId);
    if (!thread) throw notFound("Thread not found");
    assertCompanyAccess(req, thread.companyId);

    const actor = getActorInfo(req);
    const { body, telegramUpdateId, senderType: requestedSenderType } = req.body as SendMessage;
    const senderType = requestedSenderType ?? (actor.actorType === "agent" ? "agent" : "user");
    // Messages that will wake the target agent should be "enqueued" until processed.
    // Agent messages to its own thread (self-talk) remain "processed".
    const isCrossAgentMessage = senderType === "agent" && actor.actorType === "agent" && actor.actorId !== thread.agentId;
    const processingStatus = senderType === "user" || isCrossAgentMessage ? "enqueued" : "processed";

    let message;
    try {
      message = await svc.createMessage({
        threadId,
        senderType,
        senderAgentId: actor.actorType === "agent" ? actor.actorId : null,
        senderUserId: actor.actorType === "user" ? actor.actorId : null,
        body,
        processingStatus,
        telegramUpdateId: telegramUpdateId ?? null,
      });
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "23505"
      ) {
        res.status(409).json({ error: "Duplicate telegram update" });
        return;
      }
      throw err;
    }

    publishLiveEvent({
      companyId: thread.companyId,
      type: "chat.message.created",
      payload: {
        threadId,
        messageId: message.id,
        agentId: thread.agentId,
        senderType,
        senderAgentId: actor.actorType === "agent" ? actor.actorId : undefined,
      },
    });

    // Wake the target agent for user messages, or agent messages from a *different* agent
    const isAgentToAgent = senderType === "agent" && actor.actorType === "agent" && actor.actorId !== thread.agentId;

    if (isAgentToAgent) {
      void logActivity(db, {
        companyId: thread.companyId,
        actorType: "agent",
        actorId: actor.actorId,
        agentId: actor.actorId,
        runId: actor.runId,
        action: "chat.agent_message",
        entityType: "chat_thread",
        entityId: threadId,
        details: {
          targetAgentId: thread.agentId,
          messageId: message.id,
          bodyPreview: body.length > 200 ? body.slice(0, 200) + "..." : body,
        },
      });
    }
    if (senderType === "user" || isAgentToAgent) {
      // Build compacted thread context for agent (COMP-05)
      const compacted = await compactionSvc.buildThreadPrompt(threadId, "claude-sonnet-4-5");

      // Build lightweight company context so the agent knows about the ecosystem
      let companyContext = "";
      try {
        const companyId = thread.companyId;
        const [agentRows, projectRows] = await Promise.all([
          db.select({ id: agents.id, name: agents.name, status: agents.status, adapterType: agents.adapterType })
            .from(agents)
            .where(eq(agents.companyId, companyId)),
          db.select({
            id: projects.id,
            name: projects.name,
            status: projects.status,
            repoUrl: projectWorkspaces.repoUrl,
            cwd: projectWorkspaces.cwd,
          })
            .from(projects)
            .leftJoin(projectWorkspaces, and(eq(projects.id, projectWorkspaces.projectId), eq(projectWorkspaces.companyId, companyId)))
            .where(eq(projects.companyId, companyId)),
        ]);
        const agentList = agentRows.map((a) => `- ${a.name} (${a.status}, ${a.adapterType})`).join("\n");
        const projectList = projectRows.map((p) => {
          const repo = p.repoUrl ? ` — repo: ${p.repoUrl}` : "";
          const cwd = p.cwd && p.cwd !== "/__paperclip_repo_only__" ? ` — cwd: ${p.cwd}` : "";
          return `- ${p.name} (${p.status})${repo}${cwd}`;
        }).join("\n");
        companyContext = [
          "## Your company context",
          "",
          "### Agents",
          agentList || "No agents configured.",
          "",
          "### Projects",
          projectList || "No projects configured.",
        ].join("\n");
      } catch {
        // Non-critical — agent can still respond without context
      }

      void heartbeat.wakeup(thread.agentId, {
        source: "on_demand",
        triggerDetail: "system",
        reason: "chat_message",
        payload: { threadId, messageId: message.id },
        requestedByActorType: actor.actorType,
        requestedByActorId: actor.actorId,
        contextSnapshot: {
          threadId,
          messageId: message.id,
          source: "chat.message",
          paperclipChatThreadContext: compacted.prompt,
          paperclipCompanyContext: companyContext,
        },
      });
    }

    res.status(201).json(message);
  });

  return router;
}
