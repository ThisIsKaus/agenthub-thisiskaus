#!/bin/zsh
for K in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY RESTIC_PASSWORD B2_ACCOUNT_ID B2_ACCOUNT_KEY RESTIC_REPOSITORY; do
  V="$(security find-generic-password -a agenthub -s "$K" -w 2>/dev/null)"
  [[ -n "$V" ]] && export "$K"="$V"
done
exec "$@"
