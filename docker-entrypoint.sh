#!/bin/sh

# ---------------------------------------------------------------------------
# Fix ownership on persistent volume mount.
# Railway (and Docker named volumes) mount /paperclip as root.  The app runs
# as the `node` user, so we chown the mount point before dropping privileges.
# ---------------------------------------------------------------------------
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /paperclip /agents 2>/dev/null || true
  # Re-exec this script as the node user, preserving all arguments.
  exec gosu node "$0" "$@"
fi

# --- Everything below runs as `node` ---

# Ensure required directories exist inside the persistent volume.
# The volume starts empty on first deploy, so we must create them at runtime.
mkdir -p /paperclip/instances/default/workspaces \
         /paperclip/instances/default/logs \
         /paperclip/instances/default/repos \
         /paperclip/instances/default/data/storage \
         /paperclip/instances/default/secrets \
         /paperclip/.config/opencode \
         /paperclip/.local/share/opencode

# Copy OpenCode provider config into the volume (overwrite each deploy so it stays current).
cp /app/opencode.json /paperclip/.config/opencode/opencode.json

# Write OpenCode auth.json from environment variables so providers can authenticate.
# OpenCode reads credentials from ~/.local/share/opencode/auth.json, not env vars.
# The auth schema uses { type: "api", key: "<api-key>" } per provider ID.
OPENCODE_AUTH_DIR="/paperclip/.local/share/opencode"
node -e "
const auth = {};
if (process.env.MINIMAX_API_KEY) auth.minimax = { type: 'api', key: process.env.MINIMAX_API_KEY };
if (process.env.ANTHROPIC_API_KEY) auth.anthropic = { type: 'api', key: process.env.ANTHROPIC_API_KEY };
if (process.env.OPENAI_API_KEY) auth.openai = { type: 'api', key: process.env.OPENAI_API_KEY };
require('fs').writeFileSync('$OPENCODE_AUTH_DIR/auth.json', JSON.stringify(auth, null, 2));
console.log('[paperclip] Wrote OpenCode auth.json with providers:', Object.keys(auth).join(', '));
"

# Initialize /agents as a git repo with AGENTS.md
if [ ! -d /agents/.git ]; then
  cd /agents
  git init -q
  git add -A
  git -c user.name="paperclip" -c user.email="noreply@paperclip" commit -q -m "init" 2>/dev/null || true
fi

# Background task: watch for new agent subdirectories and provision them
(
  while true; do
    for dir in /agents/*/; do
      if [ -d "$dir" ] && [ ! -f "${dir}AGENTS.md" ]; then
        cp /agents/AGENTS.md "${dir}AGENTS.md" 2>/dev/null || true
        if [ ! -d "${dir}.git" ]; then
          cd "$dir"
          git init -q
          git add -A
          git -c user.name="paperclip" -c user.email="noreply@paperclip" commit -q -m "init" 2>/dev/null || true
        fi
      fi
    done
    sleep 2
  done
) &

# Start health monitor in background
node /app/monitor.mjs &

exec "$@"
