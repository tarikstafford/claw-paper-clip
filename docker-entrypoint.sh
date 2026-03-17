#!/bin/sh
# Ensure AGENTS.md exists in any agent working directory under /agents
# The server creates subdirs like /agents/ceo, /agents/engineer, etc.
for dir in /agents/*/; do
  [ -d "$dir" ] && [ ! -f "${dir}AGENTS.md" ] && cp /agents/AGENTS.md "${dir}AGENTS.md" 2>/dev/null || true
done

# Also set up a git repo in /agents so Claude Code has context
if [ ! -d /agents/.git ]; then
  cd /agents
  git init -q
  git add -A
  git -c user.name="paperclip" -c user.email="noreply@paperclip" commit -q -m "init" 2>/dev/null || true
fi

exec "$@"
