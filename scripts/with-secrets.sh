#!/bin/zsh
for K in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY RESTIC_PASSWORD; do
  export "$K"="$(security find-generic-password -a agenthub -s "$K" -w)"
done
exec "$@"
