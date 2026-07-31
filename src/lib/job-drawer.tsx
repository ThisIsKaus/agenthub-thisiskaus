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
import { isRefusal, useLocal } from "@/lib/local-bridge";

const POLL_MS = 900;
const KEEP = 5;

export type JobRun = {
  id: string;
  key: string;
  label: string;
  out: string;
  running: boolean;
  code: number | null;
  startedAt: Date;
  finishedAt: Date | null;
};

type JobDrawerValue = {
  jobs: JobRun[];
  activeId: string | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  setActiveId: (id: string) => void;
  /** Start a job by key on the local API; expands the drawer and streams output. */
  runJob: (key: string, label?: string, onDone?: (job: JobRun) => void) => Promise<void>;
  /** Stream an already-started job (one begun by an endpoint other than /api/run). */
  trackJob: (id: string, key: string, label: string, onDone?: (job: JobRun) => void) => void;
};

const JobDrawerContext = createContext<JobDrawerValue | null>(null);

export function JobDrawerProvider({ children }: { children: ReactNode }) {
  const local = useLocal();
  const [jobs, setJobs] = useState<JobRun[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const timers = useRef<Record<string, number>>({});
  const dones = useRef<Record<string, ((job: JobRun) => void) | undefined>>({});

  useEffect(() => {
    const current = timers.current;
    return () => {
      Object.values(current).forEach((timer) => window.clearInterval(timer));
    };
  }, []);

  const finish = useCallback((id: string, patch: Partial<JobRun>) => {
    window.clearInterval(timers.current[id]);
    delete timers.current[id];
    setJobs((previous) =>
      previous.map((job) => {
        if (job.id !== id) return job;
        const done: JobRun = { ...job, running: false, finishedAt: new Date(), ...patch };
        const callback = dones.current[id];
        delete dones.current[id];
        if (callback) window.setTimeout(() => callback(done), 0);
        return done;
      }),
    );
  }, []);

  const runJob = useCallback<JobDrawerValue["runJob"]>(
    async (key, label, onDone) => {
      setOpen(true);
      try {
        const started = await local.post<{ job: string; label?: string }>("/api/run", { key });
        const id = String(started.job);
        dones.current[id] = onDone;
        setJobs((previous) =>
          [
            {
              id,
              key,
              label: label ?? started.label ?? key,
              out: "",
              running: true,
              code: null,
              startedAt: new Date(),
              finishedAt: null,
            },
            ...previous.filter((job) => job.id !== id),
          ].slice(0, KEEP),
        );
        setActiveId(id);

        timers.current[id] = window.setInterval(async () => {
          try {
            const job = await local.get<{ out?: string; running?: boolean; code?: number }>(
              "/api/job",
              { id },
            );
            setJobs((previous) =>
              previous.map((entry) =>
                entry.id === id ? { ...entry, out: job.out ?? "" } : entry,
              ),
            );
            if (!job.running) finish(id, { out: job.out ?? "", code: job.code ?? 0 });
          } catch (error) {
            finish(id, {
              out: `${isRefusal(error) ? (error.message || "denied at the approval dialog") : "the machine stopped reporting on this job"}`,
              code: 1,
            });
          }
        }, POLL_MS);
      } catch (error) {
        const id = `local-${Date.now()}`;
        setJobs((previous) =>
          [
            {
              id,
              key,
              label: label ?? key,
              out: isRefusal(error)
                ? error.message || "denied at the approval dialog"
                : "the machine did not start the job",
              running: false,
              code: 1,
              startedAt: new Date(),
              finishedAt: new Date(),
            },
            ...previous,
          ].slice(0, KEEP),
        );
        setActiveId(id);
      }
    },
    [finish, local],
  );

  const value = useMemo<JobDrawerValue>(
    () => ({ jobs, activeId, open, setOpen, setActiveId, runJob }),
    [jobs, activeId, open, runJob],
  );

  return <JobDrawerContext.Provider value={value}>{children}</JobDrawerContext.Provider>;
}

export function useJobDrawer() {
  const context = useContext(JobDrawerContext);
  if (!context) throw new Error("useJobDrawer must be used inside JobDrawerProvider");
  return context;
}
