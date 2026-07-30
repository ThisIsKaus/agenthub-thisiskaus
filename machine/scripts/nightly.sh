#!/bin/zsh
exec >> ~/AgentHub/logs/nightly.log 2>&1
STAMP=~/AgentHub/state/nightly-last
mkdir -p ~/AgentHub/state
[[ "$(cat $STAMP 2>/dev/null)" == "$(date +%F)" ]] && exit 0
echo "=== nightly start $(date -Iseconds)"
pmset -g batt | grep -q "AC Power" || { echo "skipped: on battery"; exit 0; }
curl -sf -m 5 http://127.0.0.1:1234/v1/models >/dev/null || {
  echo "serving down at start - attempting restart"
  /Users/thisiskaus/.lmstudio/bin/lms server start
  sleep 20
  ~/AgentHub/scripts/mode standard
}
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
~/AgentHub/scripts/rotate.sh
if [[ "$(date +%d)" == "01" ]]; then
  echo "monthly restore verification"
  rm -rf /tmp/rv && mkdir -p /tmp/rv
  ~/AgentHub/scripts/with-secrets.sh /opt/homebrew/bin/restic restore latest --target /tmp/rv --include ~/AgentHub/canon >/dev/null 2>&1
  if diff -q /tmp/rv$HOME/AgentHub/canon/policies.md ~/AgentHub/canon/policies.md >/dev/null 2>&1; then
    echo "restore verified - byte identical"
  else
    echo "RESTORE MISMATCH - backups cannot be trusted"
    ~/AgentHub/scripts/notify.sh "RESTORE VERIFICATION FAILED"
  fi
  rm -rf /tmp/rv
fi
python3 ~/AgentHub/scripts/selftest.py --quiet
~/AgentHub/scripts/doctor.sh
date +%F > $STAMP
echo "=== nightly done $(date -Iseconds)"
