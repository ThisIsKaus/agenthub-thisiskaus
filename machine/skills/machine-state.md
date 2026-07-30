# Machine state — four states, not two

The MacBook is the compute engine; when it sleeps, local reasoning stops.

- **LIVE** — local API answers. Everything works.
- **AWAKE, REMOTE** — local silent, published state <5 min old. Machine works; you aren't at it.
- **DOZING** — local silent, state 5 min–2 h old. Show sleep time and next scheduled wake. If
  on battery, say scheduled work will skip until it is on power.
- **OFFLINE** — state >2 h old. Captures held on the device.

Published `machine` block: posture, power source, battery %, whether sleep is held off and by
which process, repeating wake, upcoming wakes, uptime, thermal limit.
