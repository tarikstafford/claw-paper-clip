#!/bin/sh

# Write OpenCode auth.json from environment variables so providers can authenticate.
# OpenCode reads credentials from ~/.local/share/opencode/auth.json, not env vars.
OPENCODE_AUTH_DIR="$HOME/.local/share/opencode"
mkdir -p "$OPENCODE_AUTH_DIR"
cat > "$OPENCODE_AUTH_DIR/auth.json" <<AUTHEOF
{
$([ -n "$MINIMAX_API_KEY" ] && echo "  \"minimax\": { \"type\": \"api\", \"apiKey\": \"$MINIMAX_API_KEY\" },")
$([ -n "$ANTHROPIC_API_KEY" ] && echo "  \"anthropic\": { \"type\": \"api\", \"apiKey\": \"$ANTHROPIC_API_KEY\" },")
$([ -n "$OPENAI_API_KEY" ] && echo "  \"openai\": { \"type\": \"api\", \"apiKey\": \"$OPENAI_API_KEY\" },")
  "_generated": true
}
AUTHEOF

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
