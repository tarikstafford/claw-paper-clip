import { api } from "./client";

export interface ChatThread {
  id: string;
  companyId: string;
  agentId: string;
  title: string | null;
  creatorUserId: string | null;
  creatorAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage: { body: string; senderType: string; createdAt: string } | null;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderType: string;
  senderAgentId: string | null;
  senderUserId: string | null;
  body: string;
  tokenCount: number | null;
  processingStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessagesPage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

export const chatApi = {
  listThreads: (companyId: string, opts?: { agentId?: string }) => {
    const qs = opts?.agentId ? `?agentId=${encodeURIComponent(opts.agentId)}` : "";
    return api.get<ChatThread[]>(`/companies/${companyId}/chat/threads${qs}`);
  },

  createThread: (companyId: string, body: { agentId: string; title?: string }) =>
    api.post<ChatThread>(`/companies/${companyId}/chat/threads`, body),

  listMessages: (threadId: string, opts?: { after?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.after) params.set("after", opts.after);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return api.get<MessagesPage>(`/chat/threads/${threadId}/messages${qs}`);
  },

  sendMessage: (threadId: string, body: { body: string }) =>
    api.post<ChatMessage>(`/chat/threads/${threadId}/messages`, body),
};
