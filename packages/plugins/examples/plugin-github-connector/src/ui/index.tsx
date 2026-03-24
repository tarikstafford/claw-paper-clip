import { useState } from "react";
import {
  usePluginAction,
  usePluginData,
  type PluginWidgetProps,
  type PluginPageProps,
  type PluginDetailTabProps,
} from "@paperclipai/plugin-sdk/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OverviewData = {
  pluginId: string;
  config: Record<string, unknown>;
  companies: number;
  connectedRepos: number;
  clonedRepos: number;
  syncedIssues: number;
  tokenConfigured: boolean;
};

type AvailableRepo = {
  slug: string;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updatedAt: string;
  connected: boolean;
};

type ConnectedRepo = {
  slug: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  connectedAt: string;
  projectId?: string;
  workspaceId?: string;
};

type WorkspaceStatus = {
  projectName: string;
  workspaceName: string;
  workspaceId: string;
  repoUrl: string | null;
  repoSlug: string | null;
  connected: boolean;
  cloneStatus: {
    status: string;
    localPath: string;
    at: string;
    error?: string;
  } | null;
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  padding: "16px",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: "#e0e0e0",
  maxWidth: 860,
};

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: "16px",
  marginBottom: 12,
};

const badgeStyle = (color: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 600,
  background: color,
  color: "#fff",
  marginLeft: 6,
});

const btnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.08)",
  color: "#e0e0e0",
  cursor: "pointer",
  fontSize: 13,
  marginRight: 8,
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
  background: "#2563eb",
  borderColor: "#3b82f6",
};

const btnDangerStyle: React.CSSProperties = {
  ...btnStyle,
  background: "rgba(220,38,38,0.15)",
  borderColor: "rgba(220,38,38,0.3)",
  color: "#f87171",
};

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.05)",
  color: "#e0e0e0",
  fontSize: 13,
  marginRight: 8,
  width: 200,
};

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    cloned: "#16a34a",
    pulled: "#2563eb",
    failed: "#dc2626",
    pending: "#ca8a04",
    connected: "#16a34a",
  };
  return (
    <span style={badgeStyle(colors[status] ?? "#6b7280")}>{status}</span>
  );
}

function LangBadge({ language }: { language: string | null }) {
  if (!language) return null;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 10,
        background: "rgba(255,255,255,0.08)",
        color: "#9ca3af",
        marginLeft: 6,
      }}
    >
      {language}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Repo Picker (connect/disconnect repos)
// ---------------------------------------------------------------------------

function RepoPicker({ companyId }: { companyId: string }) {
  const [org, setOrg] = useState("");
  const [fetchOrg, setFetchOrg] = useState("");
  const { data: availableRepos, loading: loadingRepos } = usePluginData<
    AvailableRepo[]
  >("available-repos", { companyId, org: fetchOrg });
  const connectRepo = usePluginAction("connect-repo");
  const disconnectRepo = usePluginAction("disconnect-repo");
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(new Set());

  const handleToggle = async (repo: AvailableRepo) => {
    setPendingSlugs((prev) => new Set([...prev, repo.slug]));
    try {
      if (repo.connected) {
        await disconnectRepo({ companyId, slug: repo.slug });
      } else {
        await connectRepo({ companyId, slug: repo.slug });
      }
    } finally {
      setPendingSlugs((prev) => {
        const next = new Set(prev);
        next.delete(repo.slug);
        return next;
      });
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>Connect Repos</h3>
        <input
          style={inputStyle}
          placeholder="Org name (optional)"
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setFetchOrg(org);
          }}
        />
        <button style={btnStyle} onClick={() => setFetchOrg(org)}>
          {loadingRepos ? "Loading..." : "Fetch Repos"}
        </button>
      </div>

      {!availableRepos && !loadingRepos && (
        <div style={{ ...cardStyle, color: "#9ca3af", fontSize: 13 }}>
          Click "Fetch Repos" to browse your GitHub repositories. Enter an org
          name to filter by organization.
        </div>
      )}

      {availableRepos && availableRepos.length === 0 && (
        <div style={{ ...cardStyle, color: "#9ca3af", fontSize: 13 }}>
          No repositories found.
        </div>
      )}

      {availableRepos?.map((repo) => {
        const isPending = pendingSlugs.has(repo.slug);
        return (
          <div
            key={repo.slug}
            style={{
              ...cardStyle,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {repo.slug}
                </span>
                {repo.private && (
                  <span style={badgeStyle("#6b7280")}>private</span>
                )}
                <LangBadge language={repo.language} />
                {repo.connected && <StatusBadge status="connected" />}
              </div>
              {repo.description && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#9ca3af",
                    marginTop: 3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {repo.description}
                </div>
              )}
            </div>
            <button
              style={repo.connected ? btnDangerStyle : btnPrimaryStyle}
              disabled={isPending}
              onClick={() => handleToggle(repo)}
            >
              {isPending
                ? "..."
                : repo.connected
                  ? "Disconnect"
                  : "Connect"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected Repos list
// ---------------------------------------------------------------------------

function ConnectedReposList({ companyId }: { companyId: string }) {
  const { data: repos, loading } = usePluginData<ConnectedRepo[]>(
    "connected-repos",
    { companyId },
  );
  const syncRepos = usePluginAction("sync-repos-now");
  const [syncing, setSyncing] = useState(false);

  if (loading)
    return <div style={{ fontSize: 13 }}>Loading connected repos...</div>;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Connected Repos ({repos?.length ?? 0})
        </h3>
        <button
          style={btnStyle}
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            await syncRepos({});
            setSyncing(false);
          }}
        >
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {(!repos || repos.length === 0) && (
        <div style={{ ...cardStyle, color: "#9ca3af", fontSize: 13 }}>
          No repos connected yet. Use the picker above to connect repositories.
        </div>
      )}

      {repos?.map((repo) => (
        <div
          key={repo.slug}
          style={{ ...cardStyle, padding: "10px 14px" }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{repo.slug}</span>
            {repo.private && (
              <span style={badgeStyle("#6b7280")}>private</span>
            )}
            <LangBadge language={repo.language} />
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
            Connected {new Date(repo.connectedAt).toLocaleDateString()} | Branch: {repo.defaultBranch}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace statuses
// ---------------------------------------------------------------------------

function WorkspaceList({ companyId }: { companyId: string }) {
  const { data: statuses, loading } = usePluginData<WorkspaceStatus[]>(
    "workspace-statuses",
    { companyId },
  );

  if (loading)
    return <div style={{ fontSize: 13 }}>Loading workspaces...</div>;

  const connected = statuses?.filter((ws) => ws.connected) ?? [];

  if (connected.length === 0) return null;

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Clone Status</h3>
      {connected.map((ws) => (
        <div
          key={ws.workspaceId}
          style={{ ...cardStyle, padding: "10px 14px" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {ws.projectName}
              </span>
              <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 8 }}>
                {ws.workspaceName}
              </span>
            </div>
            {ws.cloneStatus && <StatusBadge status={ws.cloneStatus.status} />}
            {!ws.cloneStatus && <StatusBadge status="pending" />}
          </div>
          {ws.repoSlug && (
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
              {ws.repoSlug}
            </div>
          )}
          {ws.cloneStatus?.localPath && (
            <div
              style={{
                fontSize: 11,
                color: "#6b7280",
                marginTop: 2,
                fontFamily: "monospace",
              }}
            >
              {ws.cloneStatus.localPath}
            </div>
          )}
          {ws.cloneStatus?.error && (
            <div style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>
              {ws.cloneStatus.error}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview card
// ---------------------------------------------------------------------------

function OverviewSection({ data }: { data: OverviewData }) {
  return (
    <div style={cardStyle}>
      <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Connection Status</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          fontSize: 13,
        }}
      >
        <div>
          Token:{" "}
          {data.tokenConfigured ? (
            <span style={{ color: "#4ade80" }}>configured</span>
          ) : (
            <span style={{ color: "#f87171" }}>not set</span>
          )}
        </div>
        <div>Connected repos: {data.connectedRepos}</div>
        <div>Cloned locally: {data.clonedRepos}</div>
        <div>Synced issues: {data.syncedIssues}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page exports
// ---------------------------------------------------------------------------

export function GitHubPage(props: PluginPageProps) {
  const companyId = props.context?.companyId ?? "";
  const { data, loading, error } = usePluginData<OverviewData>("overview", {
    companyId,
  });

  return (
    <div style={containerStyle}>
      <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>GitHub Connector</h2>
      {loading && <div>Loading...</div>}
      {error && (
        <div style={{ color: "#f87171" }}>Error: {String(error)}</div>
      )}
      {data && <OverviewSection data={data} />}
      {companyId && (
        <>
          <RepoPicker companyId={companyId} />
          <div style={{ marginTop: 20 }} />
          <ConnectedReposList companyId={companyId} />
          <div style={{ marginTop: 20 }} />
          <WorkspaceList companyId={companyId} />
        </>
      )}
    </div>
  );
}

export function GitHubSettingsPage(props: PluginPageProps) {
  const companyId = props.context?.companyId ?? "";
  const [oauthStatus, setOauthStatus] = useState<{
    connected: boolean;
    description: string | null;
    oauthConfigured: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  // Check OAuth status on mount
  useState(() => {
    if (!companyId) return;
    fetch(`/api/github/oauth/status?companyId=${companyId}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        setOauthStatus(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  });

  const handleConnect = () => {
    window.location.href = `/api/github/oauth/authorize?companyId=${companyId}`;
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    await fetch(`/api/github/oauth/disconnect?companyId=${companyId}`, {
      method: "DELETE",
      credentials: "include",
    });
    setOauthStatus({ connected: false, description: null, oauthConfigured: true });
    setDisconnecting(false);
  };

  return (
    <div style={containerStyle}>
      <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>
        GitHub Connector Settings
      </h2>

      {loading && <div style={{ fontSize: 13 }}>Loading...</div>}

      {!loading && oauthStatus && (
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>GitHub Connection</h3>

          {oauthStatus.connected ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#4ade80",
                }} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>Connected to GitHub</span>
              </div>
              {oauthStatus.description && (
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>
                  {oauthStatus.description}
                </div>
              )}
              <button
                style={btnDangerStyle}
                disabled={disconnecting}
                onClick={handleDisconnect}
              >
                {disconnecting ? "Disconnecting..." : "Disconnect GitHub"}
              </button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12 }}>
                Connect your GitHub account to enable repo cloning, issue sync, and agent tools.
              </p>
              {oauthStatus.oauthConfigured ? (
                <button style={btnPrimaryStyle} onClick={handleConnect}>
                  Connect with GitHub
                </button>
              ) : (
                <div style={{ fontSize: 12, color: "#f87171" }}>
                  GitHub OAuth is not configured on the server. Ask your admin to set
                  GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET environment variables.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GitHubDashboardWidget(props: PluginWidgetProps) {
  const companyId = props.context?.companyId ?? "";
  const { data, loading } = usePluginData<OverviewData>("overview", {
    companyId,
  });

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        GitHub
      </div>
      {loading && (
        <div style={{ fontSize: 12, color: "#9ca3af" }}>Loading...</div>
      )}
      {data && (
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          <div>Connected: {data.connectedRepos} repos</div>
          <div>Cloned: {data.clonedRepos}</div>
          <div>Issues synced: {data.syncedIssues}</div>
          <div>
            Token:{" "}
            {data.tokenConfigured ? (
              <span style={{ color: "#4ade80" }}>ok</span>
            ) : (
              <span style={{ color: "#f87171" }}>missing</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateRepoForm({ companyId, projectId }: { companyId: string; projectId?: string }) {
  const { data: orgs } = usePluginData<Array<{ login: string; id: number }>>(
    "orgs",
    {},
  );
  const createRepoAction = usePluginAction("create-repo");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setResult(null);
    try {
      const res = await createRepoAction({
        companyId,
        projectId,
        name: name.trim(),
        org: org || undefined,
        description: description || undefined,
        private: isPrivate,
      });
      const data = res as { ok: boolean; repo?: { slug: string; htmlUrl: string } };
      setResult({ ok: true, message: `Created ${data.repo?.slug ?? name}` });
      setName("");
      setDescription("");
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    setCreating(false);
  };

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Create New Repository</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            style={{ ...inputStyle, width: 180 }}
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          >
            <option value="">Personal account</option>
            {orgs?.map((o) => (
              <option key={o.login} value={o.login}>
                {o.login}
              </option>
            ))}
          </select>
          <span style={{ color: "#6b7280", alignSelf: "center", fontSize: 16 }}>/</span>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="repo-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
        </div>
        <input
          style={inputStyle}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ fontSize: 12, color: "#9ca3af", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Private
          </label>
          <button
            style={btnPrimaryStyle}
            disabled={creating || !name.trim()}
            onClick={handleCreate}
          >
            {creating ? "Creating..." : "Create Repository"}
          </button>
        </div>
        {result && (
          <div style={{ fontSize: 12, color: result.ok ? "#4ade80" : "#f87171" }}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}

export function GitHubProjectTab(props: PluginDetailTabProps) {
  const companyId = props.context?.companyId ?? "";
  const projectId = props.context?.entityId ?? "";
  return (
    <div style={containerStyle}>
      {companyId && <CreateRepoForm companyId={companyId} projectId={projectId || undefined} />}
      {companyId && <div style={{ marginTop: 16 }} />}
      {companyId && <WorkspaceList companyId={companyId} />}
    </div>
  );
}

export function GitHubIssueTab(props: PluginDetailTabProps) {
  const companyId = props.context?.companyId ?? "";
  const entityId = props.context?.entityId ?? "";
  const { data: entities } = usePluginData<
    Array<{
      entityType: string;
      externalId: string;
      data: { htmlUrl?: string; number?: number; repo?: string };
    }>
  >("entities", {
    entityType: "github-issue",
    scopeKind: "project",
    scopeId: entityId,
  });

  return (
    <div style={containerStyle}>
      <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>
        Linked GitHub Issues
      </h3>
      {(!entities || entities.length === 0) && (
        <div style={{ fontSize: 13, color: "#9ca3af" }}>
          No linked GitHub issues.
        </div>
      )}
      {entities?.map((e) => (
        <div key={e.externalId} style={{ ...cardStyle, padding: "8px 12px" }}>
          <div style={{ fontSize: 13 }}>
            {e.data.repo}#{e.data.number}
          </div>
          {e.data.htmlUrl && (
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              {e.data.htmlUrl}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
