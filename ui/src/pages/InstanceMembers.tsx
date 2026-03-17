import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Shield, ShieldCheck, Users } from "lucide-react";
import { api } from "../api/client";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type UserInfo = {
  id: string;
  name: string;
  email: string;
};

type InstanceRole = {
  id: string;
  user_id: string;
  role: string;
};

function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: UserInfo;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/admin/users/${user.id}/reset-password`, { password }),
    onSuccess: () => {
      setSuccess(true);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Failed to reset password"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg p-6 w-full max-w-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold mb-1">Reset Password</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Set a new password for {user.name || user.email}
        </p>

        {success ? (
          <div className="space-y-3">
            <div className="rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm text-green-600">
              Password reset successfully.
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground"
              autoFocus
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground"
            />
            {error && (
              <div className="text-xs text-destructive">{error}</div>
            )}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? "Resetting..." : "Reset Password"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function InstanceMembers() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [resetUser, setResetUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Instance Settings" }, { label: "Members" }]);
  }, [setBreadcrumbs]);

  const usersQuery = useQuery({
    queryKey: ["instance", "users"],
    queryFn: async () => {
      const [users, roles] = await Promise.all([
        api.get<UserInfo[]>("/admin/users"),
        api.get<InstanceRole[]>("/admin/instance-roles"),
      ]);
      return { users, roles };
    },
    retry: false,
  });

  const promoteMutation = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/admin/users/${userId}/promote-instance-admin`, {}),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["instance", "users"] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Failed to promote user"),
  });

  const demoteMutation = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/admin/users/${userId}/demote-instance-admin`, {}),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["instance", "users"] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Failed to demote user"),
  });

  if (usersQuery.isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Loading members...</div>
    );
  }

  if (usersQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {usersQuery.error instanceof Error
          ? usersQuery.error.message
          : "Failed to load members."}
      </div>
    );
  }

  const { users, roles } = usersQuery.data ?? { users: [], roles: [] };
  const adminUserIds = new Set(
    roles.filter((r) => r.role === "instance_admin").map((r) => r.user_id)
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Members</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          All registered users on this Paperclip instance.
        </p>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{users.length}</span>{" "}
          users
        </span>
        <span>
          <span className="font-semibold text-foreground">
            {adminUserIds.size}
          </span>{" "}
          admins
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {users.length === 0 ? (
        <EmptyState icon={Users} message="No users found." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {users.map((user) => {
                const isAdmin = adminUserIds.has(user.id);
                const isSaving =
                  (promoteMutation.isPending &&
                    promoteMutation.variables === user.id) ||
                  (demoteMutation.isPending &&
                    demoteMutation.variables === user.id);
                return (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 px-4 py-3 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {user.name || "Unnamed"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </div>
                    </div>
                    <Badge
                      variant={isAdmin ? "default" : "outline"}
                      className="shrink-0 gap-1"
                    >
                      {isAdmin ? (
                        <ShieldCheck className="h-3 w-3" />
                      ) : (
                        <Shield className="h-3 w-3" />
                      )}
                      {isAdmin ? "Admin" : "Member"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0"
                      disabled={isSaving}
                      onClick={() =>
                        isAdmin
                          ? demoteMutation.mutate(user.id)
                          : promoteMutation.mutate(user.id)
                      }
                    >
                      {isSaving
                        ? "..."
                        : isAdmin
                          ? "Remove Admin"
                          : "Make Admin"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0 gap-1"
                      onClick={() => setResetUser(user)}
                    >
                      <KeyRound className="h-3 w-3" />
                      Reset Password
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {resetUser && (
        <ResetPasswordDialog
          user={resetUser}
          onClose={() => setResetUser(null)}
        />
      )}
    </div>
  );
}
