#!/bin/zsh
for f in ~/AgentHub/logs/*.log ~/AgentHub/logs/*.jsonl; do
  [[ -f "$f" ]] || continue
  SZ=$(stat -f%z "$f")
  if [[ $SZ -gt 5242880 ]]; then
    tail -c 1048576 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    echo "$(date -Iseconds) rotated $(basename $f) from ${SZ}B" >> ~/AgentHub/logs/rotate.log
  fi
done
