#!/bin/zsh
for M in ~/.lmstudio/models/*/*(/); do
  [[ "$M" == *mbed* ]] && continue
  echo "=== $M ==="
  mlx_lm.generate --model "$M" --prompt "$(python3 -c 'print("Sydney "*2000)') Summarise this." --max-tokens 256 2>&1 | grep -E "tokens-per-sec|Peak memory"
done
