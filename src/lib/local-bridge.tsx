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
const PROBE_TIMEOUT = 1500;
const PROBE_INTERVAL = 60_000;

export type MachineBlock = {
  posture?: string;
  power?: string;
  sleep?: string;
  schedule?: string;
  uptime?: string;
  thermal?: string;
  collected_at?: string;
  [key: string]: unknown;
};

export type LocalState = {
  available: boolean;
  version: string | null;
  features: string[];
  machine: MachineBlock | null;
  lastProbe: Date | null;
};

/** Thrown when the local API refuses: path outside the allowlist, or approval denied. */
export class LocalRefusal extends Error {
  readonly refusal = true;
  constructor(message: string) {
    super(message);
    this.name = "LocalRefusal";
  }
}

export class LocalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LocalError";
  }
}

export function isRefusal(error: unknown): error is LocalRefusal {
  return error instanceof LocalRefusal;
}

async function throwForStatus(response: Response): Promise<never> {
  const text = (await response.text().catch(() => "")) || response.statusText;
  if (response.status === 403) throw new LocalRefusal(text);
  throw new LocalError(text, response.status);
}

async function localGet<T = unknown>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path, BASE);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url.toString(), { credentials: "omit" });
  if (!response.ok) await throwForStatus(response);
  return (await response.json()) as T;
}

/** Every local POST is multipart form fields — a JSON body returns 422. */
async function localPost<T = unknown>(
  path: string,
  form: Record<string, string | number | Blob | undefined>,
): Promise<T> {
  const body = new FormData();
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null) continue;
    body.append(key, value instanceof Blob ? value : String(value));
  }
  const response = await fetch(new URL(path, BASE).toString(), {
    method: "POST",
    credentials: "omit",
    body,
  });
  if (!response.ok) await throwForStatus(response);
  return (await response.json()) as T;
}

const EMPTY: LocalState = {
  available: false,
  version: null,
  features: [],
  machine: null,
  lastProbe: null,
};

type LocalContextValue = LocalState & {
  get: typeof localGet;
  post: typeof localPost;
};

const LocalContext = createContext<LocalContextValue>({
  ...EMPTY,
  get: localGet,
  post: localPost,
});

export function LocalBridgeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LocalState>(EMPTY);
  const probing = useRef(false);

  const probe = useCallback(async () => {
    if (probing.current) return;
    probing.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
    try {
      const response = await fetch(`${BASE}/api/capabilities`, {
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as {
        ok?: boolean;
        version?: string;
        features?: string[];
        machine?: MachineBlock;
      };
      setState({
        available: true,
        version: data.version ?? null,
        features: data.features ?? [],
        machine: data.machine ?? null,
        lastProbe: new Date(),
      });
    } catch {
      // Absence is the expected state away from the machine — never an error.
      setState({ ...EMPTY, lastProbe: new Date() });
    } finally {
      clearTimeout(timer);
      probing.current = false;
    }
  }, []);

  useEffect(() => {
    void probe();
    const interval = setInterval(() => void probe(), PROBE_INTERVAL);
    const onFocus = () => void probe();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [probe]);

  const value = useMemo<LocalContextValue>(
    () => ({ ...state, get: localGet, post: localPost }),
    [state],
  );

  return <LocalContext.Provider value={value}>{children}</LocalContext.Provider>;
}

export function useLocal() {
  return useContext(LocalContext);
}
