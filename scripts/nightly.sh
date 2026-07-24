#!/bin/zsh
exec >> ~/AgentHub/logs/nightly.log 2>&1
echo "=== nightly start $(date -Iseconds)"
pmset -g batt | grep -q "AC Power" || { echo "skipped: on battery"; exit 0; }
/usr/bin/caffeinate -i /bin/zsh -c '
  cd ~/AgentHub/kbtool && /opt/homebrew/bin/uv run ingest.py --incremental
  cd ~/AgentHub/graphtool && /opt/homebrew/bin/uv run pipeline.py
  if security find-generic-password -a agenthub -s RESTIC_REPOSITORY -w >/dev/null 2>&1; then
    ~/AgentHub/scripts/with-secrets.sh /opt/homebrew/bin/restic backup ~/AgentHub --exclude ~/AgentHub/kbtool/.venv
  else
    echo "restic parked - skipping offsite backup"
  fi
'
D=~/AgentHub/digests/$(date +%F).md
[[ -f "$D" ]] && ~/AgentHub/scripts/notify.sh "Digest ready: $(tail -1 "$D" | tr -d '_*')"
~/AgentHub/scripts/doctor.sh
echo "=== nightly done $(date -Iseconds)"
