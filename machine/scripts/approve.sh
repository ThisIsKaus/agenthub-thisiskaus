#!/bin/zsh
R=$(osascript -e "display dialog \"ACTION: $1\n\nREQUESTED BY (source):\n$2\" with title \"AgentHub T2 Approval\" buttons {\"Deny\",\"Approve\"} default button \"Deny\" giving up after 300" 2>&1)
echo "$(date -Iseconds) T2 [$1] -> $R" >> ~/AgentHub/logs/approvals.log
[[ "$R" == *"Approve"* ]] && exit 0 || exit 1
