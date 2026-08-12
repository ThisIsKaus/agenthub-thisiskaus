#!/bin/zsh
JSON_MODE=false
for arg in "$@"; do
  [[ "$arg" == "--json" ]] && JSON_MODE=true
done

LMS="ok"; curl -sf -m 5 http://127.0.0.1:1234/v1/models >/dev/null || LMS="fail"
ROUTER="ok"; curl -sf -m 5 http://127.0.0.1:4000/v1/models >/dev/null || ROUTER="fail"
EMBEDDINGS="ok"; curl -sf -m 20 http://127.0.0.1:4000/v1/embeddings -H "Content-Type: application/json" \
  -d '{"model":"local-embed","input":"probe"}' | grep -q embedding || EMBEDDINGS="fail"
SCHEDULE="ok"; pmset -g sched | grep -Eq "wake(or)?poweron" || SCHEDULE="fail"
FREE=$(df -g / | awk 'NR==2{print $4}')
DISK_STATUS="ok"; [[ $FREE -ge 100 ]] || DISK_STATUS="fail"
RESTIC_CONFIGURED=true; RESTIC_STATUS="ok"
if security find-generic-password -a agenthub -s RESTIC_REPOSITORY -w >/dev/null 2>&1; then
  ~/AgentHub/scripts/with-secrets.sh /opt/homebrew/bin/restic snapshots --latest 1 >/dev/null 2>&1 || RESTIC_STATUS="fail"
else
  RESTIC_CONFIGURED=false
fi

TIMESTAMP=$(date -Iseconds)

if $JSON_MODE; then
  cat <<EOF
{
  "timestamp": "$TIMESTAMP",
  "lms": "$LMS",
  "router": "$ROUTER",
  "embeddings": "$EMBEDDINGS",
  "schedule": "$SCHEDULE",
  "disk": {"status": "$DISK_STATUS", "free_gb": $FREE},
  "restic": {"configured": $RESTIC_CONFIGURED, "status": "$RESTIC_STATUS"}
}
EOF
  exit 0
fi

FAIL=""
[[ "$LMS" == "fail" ]] && FAIL+="lms "
[[ "$ROUTER" == "fail" ]] && FAIL+="router "
[[ "$EMBEDDINGS" == "fail" ]] && FAIL+="embeddings "
[[ "$SCHEDULE" == "fail" ]] && FAIL+="schedule "
[[ "$DISK_STATUS" == "fail" ]] && FAIL+="disk(${FREE}G) "
[[ "$RESTIC_STATUS" == "fail" ]] && FAIL+="restic "

if [[ -n "$FAIL" ]]; then
  echo "$(date -Iseconds) doctor FAIL: $FAIL" >> ~/AgentHub/logs/doctor.log
  ~/AgentHub/scripts/notify.sh "doctor FAIL: $FAIL"
  exit 1
fi
echo "$(date -Iseconds) doctor OK" >> ~/AgentHub/logs/doctor.log

# LM Studio's server does not survive a reboot even when the app relaunches. Models can be
# pinned and resident while port 1234 is closed — endpoints answer 200 and nothing can reason.
if ! /usr/sbin/lsof -nP -iTCP:1234 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  starting LM Studio server (port was closed)"
  ~/.lmstudio/bin/lms server start >/dev/null 2>&1
  sleep 6
  ~/AgentHub/scripts/residency pin >/dev/null 2>&1
fi
