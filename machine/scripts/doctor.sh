#!/bin/zsh
FAIL=""
curl -sf -m 5 http://127.0.0.1:1234/v1/models >/dev/null || FAIL+="lms "
curl -sf -m 5 http://127.0.0.1:4000/v1/models >/dev/null || FAIL+="router "
curl -sf -m 20 http://127.0.0.1:4000/v1/embeddings -H "Content-Type: application/json" \
  -d '{"model":"local-embed","input":"probe"}' | grep -q embedding || FAIL+="embeddings "
pmset -g sched | grep -Eq "wake(or)?poweron" || FAIL+="schedule "
FREE=$(df -g / | awk 'NR==2{print $4}')
[[ $FREE -ge 100 ]] || FAIL+="disk(${FREE}G) "
if security find-generic-password -a agenthub -s RESTIC_REPOSITORY -w >/dev/null 2>&1; then
  ~/AgentHub/scripts/with-secrets.sh /opt/homebrew/bin/restic snapshots --latest 1 >/dev/null 2>&1 || FAIL+="restic "
else
  echo "$(date -Iseconds) note: restic not configured (parked)" >> ~/AgentHub/logs/doctor.log
fi
if [[ -n "$FAIL" ]]; then
  echo "$(date -Iseconds) doctor FAIL: $FAIL" >> ~/AgentHub/logs/doctor.log
  ~/AgentHub/scripts/notify.sh "doctor FAIL: $FAIL"
  exit 1
fi
echo "$(date -Iseconds) doctor OK" >> ~/AgentHub/logs/doctor.log
