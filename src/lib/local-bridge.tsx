import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const BASE = "http://127.0.0.1:4100";
const PROBE_TIMEOUT_MS = 1500;
const PROBE_INTERVAL_MS = 60_000;

export type LocalMachine = {
  posture?: string;
  [key: string]: unknown;
};

type Capabilities = {
  version?: string;
  features?: string[];
  machine?: LocalMachine;
};

type LocalBridgeState = {
  available: boolean;
  version: string | null;
  features: string[];
  machine: LocalMachine | null;
  lastProbe: Date | null;
};

const INITIAL: LocalBridgeState = {
  available: false,
  version: null,
  features: [],
  machine: null,
  lastProbe: null,
};

/** Thrown for any non-2xx. A 403 is a refusal (allowlist / denied approval), not a failure. */
export class LocalError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LocalError";
    this.status = status;
  }
}

export function isRefusal(error: unknown): error is LocalError {
  return error instanceof LocalError && error.status === 403;
}

const LocalBridgeContext = createContext<LocalBridgeState>(INITIAL);

async function request(input: string, init: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs, ...rest } = init;
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await fetch(input, {
      ...rest,
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new LocalError(response.status, text || `${response.status}`);
    }
    return response;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBody(response: Response) {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return response.json();
  return response.text();
}

export function LocalBridgeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LocalBridgeState>(INITIAL);
  const probing = useRef(false);

  const probe = useCallback(async () => {
    if (probing.current) return;
    probing.current = true;
    try {
      const response = await request(`${BASE}/api/capabilities`, {
        method: "GET",
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      const data = (await readBody(response)) as Capabilities;
      setState({
        available: true,
        version: data?.version ?? null,
        features: Array.isArray(data?.features) ? data.features : [],
        machine: data?.machine ?? null,
        lastProbe: new Date(),
      });
    } catch {
      setState({ ...INITIAL, lastProbe: new Date() });
    } finally {
      probing.current = false;
    }
  }, []);

  useEffect(() => {
    void probe();
    const interval = setInterval(() => void probe(), PROBE_INTERVAL_MS);
    const onFocus = () => void probe();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [probe]);

  return <LocalBridgeContext.Provider value={state}>{children}</LocalBridgeContext.Provider>;
}

export function useLocal() {
  const state = useContext(LocalBridgeContext);

  const get = useCallback(async (path: string, query?: Record<string, string | number | boolean>) => {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, BASE);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    const response = await request(url.toString(), { method: "GET" });
    return readBody(response);
  }, []);

  /** POST is always multipart form data — the local console takes form fields, never JSON. */
  const post = useCallback(
    async (path: string, form: FormData | Record<string, string | Blob>) => {
      const body =
        form instanceof FormData
          ? form
          : Object.entries(form).reduce((acc, [key, value]) => {
              acc.append(key, value);
              return acc;
            }, new FormData());
      const url = new URL(path.startsWith("/") ? path : `/${path}`, BASE);
      const response = await request(url.toString(), { method: "POST", body });
      return readBody(response);
    },
    [],
  );

  return useMemo(
    () => ({
      available: state.available,
      version: state.version,
      features: state.features,
      machine: state.machine,
      lastProbe: state.lastProbe,
      get,
      post,
    }),
    [state, get, post],
  );
}
