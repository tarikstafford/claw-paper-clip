import { useState, useMemo } from "react";
import { useParams, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { chatApi } from "../api/chat";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { useCompany } from "../context/CompanyContext";
import { ChatThreadList } from "../components/ChatThreadList";
import { ChatMessageView } from "../components/ChatMessageView";
import { NewThreadDialog } from "../components/NewThreadDialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function Chat() {
  const { selectedCompanyId } = useCompany();
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const [newThreadOpen, setNewThreadOpen] = useState(false);

  const { data: threads = [] } = useQuery({
    queryKey: queryKeys.chat.threads(selectedCompanyId!),
    queryFn: () => chatApi.listThreads(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      map.set(agent.id, agent.name);
    }
    return map;
  }, [agents]);

  function handleSelectThread(id: string) {
    navigate(`/chat/${id}`);
  }

  const selectedThreadId = threadId ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left pane: thread list */}
      <div className="w-80 border-r border-border flex flex-col overflow-hidden shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Chat</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setNewThreadOpen(true)}
            className="h-8 w-8 p-0"
            title="New Chat"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ChatThreadList
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelectThread={handleSelectThread}
            agentMap={agentMap}
          />
        </div>
      </div>

      {/* Right pane: message view */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <ChatMessageView
          threadId={selectedThreadId}
          agentMap={agentMap}
        />
      </div>

      {selectedCompanyId && (
        <NewThreadDialog
          open={newThreadOpen}
          onOpenChange={setNewThreadOpen}
          companyId={selectedCompanyId}
        />
      )}
    </div>
  );
}
