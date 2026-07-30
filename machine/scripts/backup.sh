#!/bin/zsh
exec >> ~/AgentHub/logs/backup.log 2>&1
pmset -g batt | grep -q "AC Power" || { echo "$(date -Iseconds) skipped: battery"; exit 0; }
security find-generic-password -a agenthub -s RESTIC_REPOSITORY -w >/dev/null 2>&1 || { echo "$(date -Iseconds) skipped: restic not configured"; exit 0; }
~/AgentHub/scripts/with-secrets.sh /opt/homebrew/bin/restic backup ~/AgentHub ~/Factory \
  --exclude ~/AgentHub/kbtool/.venv --exclude ~/AgentHub/graphtool/.venv \
  --exclude node_modules --exclude .venv --exclude dist --exclude __pycache__
echo "$(date -Iseconds) backup done"
