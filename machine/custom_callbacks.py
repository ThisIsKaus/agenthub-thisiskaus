"""Append per-request spend to ~/AgentHub/logs/spend.jsonl. Local models cost $0 by design."""
import json, datetime as dt
from pathlib import Path
from litellm.integrations.custom_logger import CustomLogger

LOG = Path.home()/"AgentHub/logs/spend.jsonl"

class SpendLogger(CustomLogger):
    def _write(self, kwargs, response_obj):
        try:
            u = getattr(response_obj, "usage", None)
            rec = {"ts": dt.datetime.now().isoformat(),
                   "model": str(kwargs.get("model", "?")),
                   "cost_usd": round(float(kwargs.get("response_cost") or 0), 6),
                   "in": int(getattr(u, "prompt_tokens", 0) or 0),
                   "out": int(getattr(u, "completion_tokens", 0) or 0)}
            with open(LOG, "a") as f:
                f.write(json.dumps(rec) + "\n")
        except Exception:
            pass
    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        self._write(kwargs, response_obj)
    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self._write(kwargs, response_obj)

proxy_handler_instance = SpendLogger()
