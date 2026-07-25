#!/bin/zsh
exec >> ~/AgentHub/logs/nightly.log 2>&1
echo "=== nightly start $(date -Iseconds)"
pmset -g batt | grep -q "AC Power" || { echo "skipped: on battery"; exit 0; }
/usr/bin/caffeinate -i /bin/zsh -c '
  cd ~/AgentHub/kbtool && /opt/homebrew/bin/uv run ingest.py --incremental
  cd ~/AgentHub/graphtool && /opt/homebrew/bin/uv run pipeline.py
  ~/AgentHub/scripts/backup.sh
'
D=~/AgentHub/digests/$(date +%F).md
if [[ -f "$D" ]]; then
  SUMMARY=$(grep '^_items' "$D" | tr -d '_*')
  printf '\n## Factory\n' >> "$D"
  ~/AgentHub/scripts/factory status >> "$D"
  ~/AgentHub/scripts/notify.sh "Digest ready: $SUMMARY"
fi
/opt/homebrew/bin/uv run --python 3.12 ~/AgentHub/report/build_report.py
~/AgentHub/scripts/doctor.sh
echo "=== nightly done $(date -Iseconds)"
