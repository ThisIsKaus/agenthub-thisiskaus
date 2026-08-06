#!/usr/bin/env python3
"""
Model scanner — find candidates, and refuse to believe anything until it is benchmarked here.

Published benchmarks are measured on other people's hardware with other quantisations and
other memory pressure. On 36 GB of unified memory the binding constraint is the envelope, and
the only evidence that counts is a bench through the production endpoint.

  scanner.py            list candidates as JSON
  scanner.py --envelope report the memory budget only
"""
import json, re, sys, urllib.request
from pathlib import Path

H = Path.home() / "AgentHub"
HF = "https://huggingface.co/api/models"

# Families already proven on this machine. A candidate from a family that has never run here
# is a bigger bet than the download count suggests.
PROVEN = ("qwen", "gpt-oss", "mistral", "gemma", "llama")


def envelope():
    sys.path.insert(0, str(H / "scripts"))
    try:
        import memory_state
        m = memory_state.collect()
        b = m["budget"]
        return {"budget_gib": b["envelope_gib"], "pinned_gib": b["pinned_gib"],
                "resident_gib": b["pinned_gib"] + b["elastic_gib"],
                "headroom_gib": round(b["envelope_gib"] - b["pinned_gib"], 2),
                "pressure": m["pressure"]}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}", "budget_gib": 26.0,
                "pinned_gib": 2.93, "headroom_gib": 23.07}


def params_from(name: str):
    m = re.search(r"(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])", name)
    return float(m.group(1)) if m else None


def quant_from(name: str, tags=None):
    """Quantisation lives in the repo suffix, the tags, or nowhere at all.

    Reading only the name returned "unknown" for all twenty candidates including
    Qwen/Qwen3-8B and openai/gpt-oss-20b — the two families actually in use here. A size
    estimate built on that default is wrong for every row, which makes the envelope colour
    wrong, which makes the whole page misleading rather than merely incomplete.
    """
    hay = (name + " " + " ".join(tags or [])).lower()
    for q in ("4bit", "8bit", "6bit", "3bit", "q4", "q8", "q6", "int4", "int8",
              "bf16", "fp16", "mlx-4", "mlx-8"):
        if q in hay:
            return q.replace("mlx-", "").replace("q", "").replace("int", "") + \
                   ("bit" if q[0] in "qi4863" and "bit" not in q else "")
    # An MLX conversion with no marker is 16-bit by convention; a base repo is full precision.
    # Say unknown when it is unknown. The first version defaulted everything to 4-bit and
    # under-estimated every candidate; the second defaulted to 16-bit and over-estimated all
    # twenty — Qwen3-8B read 17.28 GB when its MLX 4-bit build is about 4.5. A wrong default
    # in either direction makes the envelope colour wrong, which makes the page confidently
    # misleading. An honest gap is better than a precise fiction.
    return "unknown"


def fetch_one(mid):
    try:
        with urllib.request.urlopen(f"{HF}/{mid}", timeout=20) as r:
            return json.loads(r.read().decode())
    except Exception:
        return {}


# gpt-oss ships MXFP4 without saying so in the repo id, so the id alone is not enough.
PACKED_4BIT = ("nvfp4", "mxfp4", "fp4", "-4bit", "int4", "awq", "gptq", "gpt-oss")


def known_size(mid: str):
    """A model already benchmarked here has a real resident size. Use it.

    Four estimation attempts produced four wrong answers. gpt-oss-20b was reported at
    24.48 GB and marked as not fitting, while it has actually run on this machine at
    11.27 GiB. Where measurement exists, an estimate is not merely redundant — it is a
    chance to contradict the truth.
    """
    # models.lock.yaml is YAML, and this called json.loads on it — every lookup threw and the
    # bare except swallowed it, so the one source of ground truth was never consulted. Parse
    # the two fields that matter with a regex rather than adding a YAML dependency.
    f = H / "models.lock.yaml"
    if not f.exists():
        return None
    text = f.read_text(errors="ignore")
    short = mid.split("/")[-1].lower()
    best = None
    for block in re.split(r"\n(?=\s*-\s)", text):
        m_id = re.search(r"id:\s*['\"]?([^'\"\n]+)", block)
        m_gib = re.search(r"(?:loaded_gib|gib):\s*([\d.]+)", block)
        if not m_id or not m_gib:
            continue
        lock_id = m_id.group(1).strip().lower()
        lock_short = lock_id.split("/")[-1]
        # Match on the model name, not the org — mlx-community/gpt-oss-20b and openai/gpt-oss-20b
        # are the same weights from this machine's point of view.
        if lock_short in short or short in lock_short:
            best = round(float(m_gib.group(1)) * 1.074, 2)
    return best


def size_from_safetensors(m, mid=""):
    """Real weights, not an estimate.

    Hugging Face publishes a safetensors index for most repos: `total` is the actual parameter
    count and `parameters` is keyed by dtype. That is measurement, and it removes the guess
    entirely for the models that publish it. Two estimating attempts produced twenty wrong
    numbers in opposite directions; this reads the answer instead.
    """
    st = m.get("safetensors") or {}
    total = st.get("total")
    params = st.get("parameters") or {}
    if not total or not params:
        return None, None
    BYTES = {"F32": 4, "FP32": 4, "F16": 2, "FP16": 2, "BF16": 2,
             "I8": 1, "INT8": 1, "F8_E4M3": 1, "U8": 1, "I4": 0.5, "INT4": 0.5,
             # MLX packs quantised weights into U32 words. The entry counts words, not
             # parameters, so the bytes-per-entry is 4 — the packing is already reflected in
             # a smaller total.
             "U32": 4, "I32": 4, "U16": 2}
    weighted = sum(n * BYTES.get(dt.upper(), 2) for dt, n in params.items() if isinstance(n, int))
    if not weighted:
        return None, None
    dominant = max(params.items(), key=lambda kv: kv[1] if isinstance(kv[1], int) else 0)[0]
    # MXFP4 and NVFP4 pack two 4-bit values per byte and declare them as U8. Counting one
    # byte each doubles the answer, which is how a model that runs here at 11.27 GiB was
    # reported at 24.48 GB and marked red.
    if any(k in mid.lower() for k in PACKED_4BIT) and dominant.upper() in ("U8", "I8"):
        weighted /= 2
        dominant = "fp4"
    return round(weighted / 1e9 * 1.05, 2), dominant.lower()


def size_estimate(params, quant):
    """Weights only. Bytes per parameter by quantisation, plus overhead."""
    bpp = {"3bit": 0.42, "4bit": 0.56, "6bit": 0.80, "8bit": 1.06,
           "bf16": 2.0, "fp16": 2.0}.get(quant)
    if bpp is None:
        return None          # unknown quantisation means unknown size; do not invent one
    return round(params * bpp * 1.08, 2) if params else None


def fetch(limit=40):
    url = (f"{HF}?library=mlx&pipeline_tag=text-generation&sort=downloads"
           f"&direction=-1&limit={limit}&full=true")
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"__err": f"{type(e).__name__}: {e}"}


def scan():
    env = envelope()
    head = env.get("headroom_gib", 23.07)
    raw = fetch()
    if isinstance(raw, dict) and "__err" in raw:
        return {"candidates": [], "envelope": env, "error": raw["__err"], "last_scan": None}

    have = set()
    try:
        have = {m["id"].lower() for m in
                json.loads((H / "models.lock.yaml").read_text()).get("models", [])}
    except Exception:
        pass

    out = []
    for m in raw:
        mid = m.get("id", "")
        low = mid.lower()
        if low in have or "embedding" in low or "whisper" in low:
            continue
        p = params_from(mid)
        if not p or p < 7 or p > 80:
            continue
        # Measured first; estimated only where the repo publishes no index.
        size, dtype = size_from_safetensors(m, mid)
        if size is None:
            size, dtype = size_from_safetensors(fetch_one(mid), mid)
        real = known_size(mid)
        if real:
            size, dtype = real, (dtype or "measured here")
        q = dtype or quant_from(mid, m.get("tags"))
        measured = size is not None
        if size is None:
            size = size_estimate(p, q)
        # A candidate whose size cannot be estimated is not green, amber or red — it is
        # unmeasured. The trial resolves it in ninety seconds; a guess never does.
        if size is None:
            fits = "unknown"
        else:
            fits = "green" if size <= head - 2 else "amber" if size <= head else "red"
        why = []
        if any(f in low for f in PROVEN):
            why.append("family already proven on this machine")
        if m.get("downloads", 0) > 50000:
            why.append(f"{m['downloads']:,} downloads")
        if p >= 27:
            why.append("larger than the current brain")
        out.append({"id": mid, "author": mid.split("/")[0], "params": p, "quant": q,
                    "size_measured": measured,
                    "size_gb": size, "downloads": m.get("downloads", 0),
                    "likes": m.get("likes", 0), "fits_envelope": fits,
                    "why": " · ".join(why) or "surfaced by download rank",
                    "hf_url": f"https://huggingface.co/{mid}", "status": "untried"})
    out.sort(key=lambda x: (x["fits_envelope"] != "green", -x["downloads"]))
    return {"candidates": out[:20], "envelope": env,
            "note": ("A candidate is a hypothesis until it is benchmarked on this machine. "
                     "Size is estimated from parameters and quantisation; the bench measures "
                     "the truth."),
            "last_scan": None}


if __name__ == "__main__":
    print(json.dumps(envelope() if "--envelope" in sys.argv else scan(), indent=2))
