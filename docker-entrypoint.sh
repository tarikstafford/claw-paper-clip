#!/bin/sh

# Write OpenCode auth.json from environment variables so providers can authenticate.
# OpenCode reads credentials from ~/.local/share/opencode/auth.json, not env vars.
# The auth schema uses { type: "api", key: "<api-key>" } per provider ID.
OPENCODE_AUTH_DIR="$HOME/.local/share/opencode"
mkdir -p "$OPENCODE_AUTH_DIR"
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
