import fs from "node:fs/promises";
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, asNumber } from "../utils.js";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: ToolCall[] };
    finish_reason: string;
  }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// Paths where Paperclip skill files may live
const SKILL_CANDIDATES = ["/app/skills/paperclip/SKILL.md", "skills/paperclip/SKILL.md"];
const SKILL_REF_CANDIDATES = ["/app/skills/paperclip/references/api-reference.md", "skills/paperclip/references/api-reference.md"];

async function readFileIfExists(filePath: string): Promise<string | null> {
  try { return await fs.readFile(filePath, "utf-8"); } catch { return null; }
}

async function loadFirstExisting(candidates: string[]): Promise<string> {
  for (const c of candidates) {
    const content = await readFileIfExists(c);
    if (content) return content;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "paperclip_api",
      description: "Make an HTTP request to the Paperclip control plane API. Use this for all Paperclip operations: get identity, check inbox, checkout tasks, update status, post comments, create subtasks, etc. The base URL and auth are handled automatically.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PATCH", "PUT", "DELETE"], description: "HTTP method" },
          path: { type: "string", description: "API path starting with /api/, e.g. /api/agents/me or /api/issues/{issueId}/checkout" },
          body: { type: "object", description: "JSON body for POST/PATCH/PUT requests. Omit for GET/DELETE." },
        },
        required: ["method", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_chat_response",
      description: "Post your response message back to the chat thread so the user can see it. Use this when responding to a chat message.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Your response text to send to the user" },
        },
        required: ["message"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  env: { apiUrl: string; authToken: string; runId: string; threadId: string },
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
): Promise<string> {
  if (toolName === "paperclip_api") {
    const method = (args.method as string) || "GET";
    const apiPath = (args.path as string) || "/api/agents/me";
    const body = args.body as Record<string, unknown> | undefined;
    const url = `${env.apiUrl}${apiPath}`;

    await onLog("stderr", `[tool] ${method} ${apiPath}\n`);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.authToken}`,
        "X-Paperclip-Run-Id": env.runId,
      };
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) {
        await onLog("stderr", `[tool] ${method} ${apiPath} → ${res.status}\n`);
        return JSON.stringify({ status: res.status, error: text });
      }
      await onLog("stderr", `[tool] ${method} ${apiPath} → ${res.status}\n`);
      // Try to parse and re-serialize for clean formatting
      try { return JSON.stringify(JSON.parse(text)); } catch { return text; }
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  if (toolName === "post_chat_response") {
    const message = (args.message as string) || "";
    if (!env.threadId) return JSON.stringify({ error: "No threadId in context" });
    if (!env.authToken) return JSON.stringify({ error: "No auth token available" });

    const url = `${env.apiUrl}/api/chat/threads/${env.threadId}/messages`;
    await onLog("stderr", `[tool] Posting to chat thread ${env.threadId}\n`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.authToken}`,
        },
        body: JSON.stringify({ body: message }),
      });
      if (res.ok) {
        await onLog("stderr", `[tool] Posted to chat thread successfully\n`);
        return JSON.stringify({ ok: true });
      }
      const errText = await res.text();
      await onLog("stderr", `[tool] Post to chat failed: ${res.status} ${errText}\n`);
      return JSON.stringify({ status: res.status, error: errText });
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, runId, agent, context, onLog, onMeta } = ctx;

  const baseUrl = asString(config.baseUrl, "https://api.minimax.io/v1");
  const apiKey = asString(config.apiKey, "") || process.env.MINIMAX_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY || "";
  const model = asString(config.model, "MiniMax-M2.7");
  const maxTokens = asNumber(config.maxTokens, 4096);
  const temperature = asNumber(config.temperature, 0.7);
  const timeoutMs = asNumber(config.timeoutMs, 300_000); // 5 min for agentic loops
  const maxToolRounds = asNumber(config.maxToolRounds, 20);

  if (!apiKey) {
    return {
      exitCode: 1, signal: null, timedOut: false,
      errorMessage: "No API key configured.",
      errorCode: "missing_api_key",
    };
  }

  // Load context files
  const instructionsFilePath = asString(config.instructionsFilePath, "");
  const [paperclipSkill, paperclipApiRef, agentInstructions] = await Promise.all([
    loadFirstExisting(SKILL_CANDIDATES),
    loadFirstExisting(SKILL_REF_CANDIDATES),
    instructionsFilePath ? readFileIfExists(instructionsFilePath) : Promise.resolve(null),
  ]);

  const wakeReason = asString(context.wakeReason, "");
  const threadId = asString(context.threadId, "");
  const chatThreadContext = asString(context.paperclipChatThreadContext, "");
  const paperclipApiUrl = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
  const authToken = ctx.authToken || "";

  // Build system prompt
  const systemParts: string[] = [];

  systemParts.push(`You are agent ${agent.id} (${agent.name}), company ${agent.companyId}. You work on the Paperclip platform.

Environment variables available to you:
- PAPERCLIP_AGENT_ID: ${agent.id}
- PAPERCLIP_COMPANY_ID: ${agent.companyId}
- PAPERCLIP_API_URL: ${paperclipApiUrl}
- PAPERCLIP_RUN_ID: ${runId}
- PAPERCLIP_WAKE_REASON: ${wakeReason}${context.taskId ? `\n- PAPERCLIP_TASK_ID: ${context.taskId}` : ""}${context.wakeCommentId ? `\n- PAPERCLIP_WAKE_COMMENT_ID: ${context.wakeCommentId}` : ""}`);

  const customSystemPrompt = asString(config.systemPrompt, "");
  if (customSystemPrompt) systemParts.push(customSystemPrompt);
  if (agentInstructions) systemParts.push(`## Agent Instructions\n\n${agentInstructions}`);
  if (paperclipSkill) systemParts.push(`## Paperclip Skill\n\n${paperclipSkill}`);
  if (paperclipApiRef) systemParts.push(`## Paperclip API Reference\n\n${paperclipApiRef}`);

  // Tool usage instructions
  systemParts.push(`## Tools

You have two tools available:

1. **paperclip_api** — Make any HTTP request to the Paperclip API. Use this for all Paperclip operations (get identity, inbox, checkout, update, comment, create subtasks, etc.). The method, path, and optional body are all you need. Auth and base URL are handled for you.

2. **post_chat_response** — Post your response to the chat thread so the user sees it. You MUST call this tool with your final response when replying to a chat message. Without this, the user won't see your response.

When the wake reason is "chat_message", respond to the conversation using post_chat_response. Only use paperclip_api if the user asks about tasks/work.
When the wake reason is a heartbeat or assignment, follow the Heartbeat Procedure from the Paperclip Skill.`);

  const systemPrompt = systemParts.join("\n\n---\n\n");

  // Build initial messages
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  if (wakeReason === "chat_message" && chatThreadContext) {
    const lines = chatThreadContext.split("\n");
    for (const line of lines) {
      const userMatch = line.match(/^\[user\]:\s*(.+)$/);
      const agentMatch = line.match(/^\[agent\]:\s*(.+)$/);
      if (userMatch) {
        messages.push({ role: "user", content: userMatch[1] });
      } else if (agentMatch) {
        messages.push({ role: "assistant", content: agentMatch[1] });
      } else if (line.trim()) {
        messages.push({ role: "user", content: line.trim() });
      }
    }
  } else {
    const promptTemplate = asString(config.promptTemplate, "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.");
    const prompt = promptTemplate
      .replace(/\{\{agent\.id\}\}/g, agent.id)
      .replace(/\{\{agent\.name\}\}/g, agent.name);
    messages.push({ role: "user", content: prompt });
  }

  await onMeta?.({
    adapterType: "openai_compatible",
    command: `POST ${baseUrl}/chat/completions`,
    prompt: messages.map((m) => `[${m.role}]: ${(m.content || "").slice(0, 200)}`).join("\n"),
    context,
  });

  await onLog("stderr", `[openai-compatible] Starting agentic loop (model: ${model}, max rounds: ${maxToolRounds})\n`);
  if (agentInstructions) await onLog("stderr", `[openai-compatible] Loaded instructions from ${instructionsFilePath}\n`);
  if (paperclipSkill) await onLog("stderr", `[openai-compatible] Loaded Paperclip skill + API reference\n`);

  const toolEnv = { apiUrl: paperclipApiUrl, authToken, runId, threadId };
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = "";
  let round = 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    while (round < maxToolRounds) {
      round++;
      await onLog("stderr", `[openai-compatible] Round ${round}/${maxToolRounds}\n`);

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          tools: TOOLS,
          tool_choice: "auto",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text();
        await onLog("stderr", `[openai-compatible] API error ${res.status}: ${errorBody}\n`);
        return {
          exitCode: 1, signal: null, timedOut: false,
          errorMessage: `API call failed: ${res.status}: ${errorBody}`,
          errorCode: "api_error",
        };
      }

      const data = (await res.json()) as ChatCompletionResponse;
      if (data.usage) {
        totalInputTokens += data.usage.prompt_tokens;
        totalOutputTokens += data.usage.completion_tokens;
      }

      const choice = data.choices?.[0];
      if (!choice) break;

      const assistantMsg = choice.message;
      // Preserve full assistant message (required by MiniMax for reasoning chain)
      messages.push({
        role: "assistant",
        content: assistantMsg.content,
        tool_calls: assistantMsg.tool_calls,
      });

      // If no tool calls, we're done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        finalText = (assistantMsg.content || "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
        await onLog("stdout", assistantMsg.content || "");
        await onLog("stderr", `[openai-compatible] Final response (no more tool calls)\n`);
        break;
      }

      // Execute tool calls
      for (const tc of assistantMsg.tool_calls) {
        await onLog("stderr", `[openai-compatible] Tool call: ${tc.function.name}(${tc.function.arguments.slice(0, 200)})\n`);

        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }

        const result = await executeTool(tc.function.name, args, toolEnv, onLog);

        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }

      // If finish_reason is "stop" with tool calls already processed, continue loop
      // If finish_reason is something else, break
      if (choice.finish_reason === "stop" && !assistantMsg.tool_calls?.length) break;
    }

    if (round >= maxToolRounds) {
      await onLog("stderr", `[openai-compatible] Hit max tool rounds (${maxToolRounds})\n`);
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      model: model,
      provider: "openai_compatible",
      billingType: "api",
      summary: finalText.slice(0, 200),
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { exitCode: 1, signal: null, timedOut: true, errorMessage: `Timed out after ${timeoutMs}ms`, errorCode: "timeout" };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
