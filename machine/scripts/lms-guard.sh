#!/bin/zsh
# LM Studio's local server does not survive a reboot even when the app relaunches: models stay
# pinned and resident while port 1234 is closed. Every endpoint answers 200 and nothing can
# reason — the failure looks like health.
#
# Its own script rather than a block inside doctor.sh, because three attempts to place it there
# landed after an exit, after the final OK line, and inside a heredoc. A repair path with one
# job is easier to test than a repair path threaded through a script with several.
if /usr/sbin/lsof -nP -iTCP:1234 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$(date -Iseconds) lms-guard: port open"
  exit 0
fi
echo "$(date -Iseconds) lms-guard: port closed, starting server" | tee -a ~/AgentHub/logs/doctor.log
~/.lmstudio/bin/lms server start >/dev/null 2>&1
sleep 6
if /usr/sbin/lsof -nP -iTCP:1234 -sTCP:LISTEN >/dev/null 2>&1; then
  ~/AgentHub/scripts/residency pin >/dev/null 2>&1
  echo "$(date -Iseconds) lms-guard: recovered and core pinned" | tee -a ~/AgentHub/logs/doctor.log
  exit 0
fi
echo "$(date -Iseconds) lms-guard: FAILED to start" | tee -a ~/AgentHub/logs/doctor.log
exit 1
