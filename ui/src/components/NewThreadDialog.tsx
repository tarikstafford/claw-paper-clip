import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { chatApi } from "../api/chat";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { useToast } from "../context/ToastContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  preselectedAgentId?: string;
}

export function NewThreadDialog({ open, onOpenChange, companyId, preselectedAgentId }: NewThreadDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [selectedAgentId, setSelectedAgentId] = useState<string>(preselectedAgentId ?? "");
  const [title, setTitle] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedAgentId) {
      pushToast({ title: "Please select an agent", tone: "error" });
      return;
    }
    const trimmedMessage = firstMessage.trim();
    if (!trimmedMessage) {
      pushToast({ title: "Please enter a first message", tone: "error" });
      return;
    }

    setIsPending(true);
    try {
      const thread = await chatApi.createThread(companyId, {
        agentId: selectedAgentId,
        title: title.trim() || undefined,
      });
      await chatApi.sendMessage(thread.id, { body: trimmedMessage });
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads(companyId) });
      onOpenChange(false);
      navigate(`/chat/${thread.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create chat";
      pushToast({ title: "Failed to start chat", body: message, tone: "error" });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Agent</label>
            <Select
              value={selectedAgentId}
              onValueChange={setSelectedAgentId}
              disabled={!!preselectedAgentId || isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an agent…" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">Title (optional)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Thread title (optional)"
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">First message</label>
            <Textarea
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              placeholder="Type your first message…"
              rows={4}
              disabled={isPending}
            />
          </div>

          <Button type="submit" disabled={isPending || !selectedAgentId || !firstMessage.trim()}>
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting…
              </>
            ) : (
              "Start Chat"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
