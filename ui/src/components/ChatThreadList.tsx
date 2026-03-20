import { ChatThread } from "../api/chat";
import { relativeTime } from "../lib/utils";
import { cn } from "../lib/utils";
import { MessageSquare } from "lucide-react";

interface ChatThreadListProps {
  threads: ChatThread[];
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  agentMap: Map<string, string>;
}

function getSenderLabel(senderType: string, agentName: string): string {
  if (senderType === "user") return "You";
  if (senderType === "agent") return agentName;
  return "System";
}

function truncatePreview(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

export function ChatThreadList({ threads, selectedThreadId, onSelectThread, agentMap }: ChatThreadListProps) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 px-4 text-center">
        <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No conversations yet</p>
        <p className="text-xs text-muted-foreground mt-1">Start a new chat to get going</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {threads.map((thread) => {
        const agentName = agentMap.get(thread.agentId) ?? "Unknown Agent";
        const title = thread.title ?? `Chat with ${agentName}`;
        const isSelected = thread.id === selectedThreadId;

        let preview: string | null = null;
        if (thread.lastMessage) {
          const label = getSenderLabel(thread.lastMessage.senderType, agentName);
          preview = `${label}: ${truncatePreview(thread.lastMessage.body)}`;
        }

        return (
          <button
            key={thread.id}
            onClick={() => onSelectThread(thread.id)}
            className={cn(
              "flex flex-col gap-1 px-4 py-3 text-left transition-colors border-b border-border",
              isSelected ? "bg-muted" : "hover:bg-muted/50"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate flex-1">{title}</span>
              {thread.lastMessage && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {relativeTime(thread.lastMessage.createdAt)}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {preview ?? (
                <span className="italic">No messages yet</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground/70">{agentName}</div>
          </button>
        );
      })}
    </div>
  );
}
