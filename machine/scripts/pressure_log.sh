#!/bin/zsh
# Item 8 needs a week of memory-pressure readings before the wired limit is touched.
# Council condition: measure before you twist the knob.
mkdir -p ~/AgentHub/logs
/usr/bin/python3 ~/AgentHub/scripts/memory_state.py 2>/dev/null | \
  /usr/bin/python3 -c "
import json,sys,datetime
d=json.load(sys.stdin); b=d['budget']
print(json.dumps({'ts':datetime.datetime.now().isoformat(timespec='seconds'),
 'pressure':d['pressure'],'compressed_gib':b['compressed_gib'],'free_gib':b['free_gib'],
 'pinned':b['pinned_gib'],'elastic':b['elastic_gib'],'headroom':b['headroom_gib'],
 'wired_limit_mb':b['wired_limit_mb']}))" >> ~/AgentHub/logs/pressure.jsonl
