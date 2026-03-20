import { useRef, useEffect, useState, KeyboardEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chatApi } from "../api/chat";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime, cn } from "../lib/utils";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, MessageSquare } from "lucide-react";

interface ChatMessageViewProps {
  threadId: string | null;
  agentMap: Map<string, string>;
}

export function ChatMessageView({ threadId, agentMap }: ChatMessageViewProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.chat.messages(threadId ?? ""),
    queryFn: () => chatApi.listMessages(threadId!),
    enabled: !!threadId,
  });

  const messages = data?.messages ?? [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  const sendMessage = useMutation({
    mutationFn: (body: string) => chatApi.sendMessage(threadId!, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(threadId!) });
      setDraft("");
    },
  });

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || sendMessage.isPending || !threadId) return;
    sendMessage.mutate(trimmed);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!threadId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <MessageSquare className="w-12 h-12 text-muted-foreground mb-3" />
        <p className="text-muted-foreground font-medium">Select a conversation to start chatting</p>
        <p className="text-sm text-muted-foreground mt-1">Or create a new chat using the button on the left</p>
      </div>
    );
  }

  function getSenderLabel(msg: { senderType: string; senderUserId: string | null; senderAgentId: string | null }): string {
    if (msg.senderType === "user") {
      if (currentUserId && msg.senderUserId === currentUserId) return "You";
      return "User";
    }
    if (msg.senderType === "agent") {
      return msg.senderAgentId ? (agentMap.get(msg.senderAgentId) ?? "Agent") : "Agent";
    }
    return "System";
  }

  function getMessageAlignment(msg: { senderType: string; senderUserId: string | null }): "user" | "agent" | "system" {
    if (msg.senderType === "user" && msg.senderUserId === currentUserId) return "user";
    if (msg.senderType === "system") return "system";
    return "agent";
  }

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">No messages yet. Send the first one!</p>
          </div>
        )}
        {messages.map((msg) => {
          const alignment = getMessageAlignment(msg);
          const senderLabel = getSenderLabel(msg);

          if (alignment === "system") {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="max-w-md text-center">
                  <p className="text-xs text-muted-foreground mb-1">{senderLabel} · {relativeTime(msg.createdAt)}</p>
                  <div className="bg-muted text-muted-foreground text-xs rounded-md px-3 py-2">
                    <MarkdownBody className="text-xs">{msg.body}</MarkdownBody>
                  </div>
                </div>
              </div>
            );
          }

          const isUser = alignment === "user";

          return (
            <div key={msg.id} className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="font-medium">{senderLabel}</span>
                <span>·</span>
                <span>{relativeTime(msg.createdAt)}</span>
              </div>
              <div
                className={cn(
                  "max-w-prose rounded-xl px-3 py-2",
                  isUser
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                )}
              >
                <MarkdownBody className={cn("text-sm", isUser && "[&_*]:text-primary-foreground [&_a]:text-primary-foreground")}>{msg.body}</MarkdownBody>
              </div>
            </div>
          );
        })}
      </div>

      {/* Send form */}
      <div className="border-t border-border p-4 flex gap-2 items-end">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          className="flex-1 min-h-[40px] max-h-36 resize-none"
          disabled={sendMessage.isPending}
          rows={1}
        />
        <Button
          onClick={handleSend}
          disabled={!draft.trim() || sendMessage.isPending}
          size="icon"
          className="shrink-0"
        >
          {sendMessage.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
