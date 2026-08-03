import { useQuery } from "@tanstack/react-query";
import { useLocal } from "@/lib/local-bridge";
import { JOB_KEYS, type CanvasRef } from "@/lib/canvas-types";
import { listSkills, type Skill } from "@/lib/skills-store";

type SkillRow = { name: string; path: string; description?: string; size?: number; modified?: string };
type PromptRow = { name: string; path: string; kind?: string };
type ProjectRow = { name: string; entity?: string; stage?: string; status?: string; sensitivity?: string };
type BenchRow = { role?: string; id?: string; tps?: string | number; gib?: string | number };
type SourceRow = { file?: string; path?: string; chunks?: number };
type RootRow = { name: string; path: string };

export type TreeListing = {
  root: string;
  parent: string;
  dirs: { name: string; path: string; gated?: boolean }[];
  files: { name: string; path: string; size?: number; modified?: string; editable?: boolean }[];
};

const STALE = 60_000;

/**
 * Everything referenceable on the machine, read once and cached. Each list is
 * independent: one unavailable endpoint never blanks the others.
 */
export function useReferenceCatalogue() {
  const local = useLocal();
  const enabled = local.available;

  const skills = useQuery({
    queryKey: ["canvas", "refs", "skills"],
    enabled,
    staleTime: STALE,
    retry: false,
    queryFn: async () => ({
      // The skills endpoint is the source: it cannot be refused by the path
      // allowlist, and it already carries the description that tells you
      // whether loading a skill will help.
      skills: (await listSkills(local)).map((skill: Skill) => ({
        name: skill.name,
        path: skill.path,
        description: skill.description,
      })) as SkillRow[],
    }),
  });



  const prompts = useQuery({
    queryKey: ["canvas", "refs", "prompts"],
    enabled,
    staleTime: STALE,
    retry: false,
    queryFn: () => local.get<{ prompts?: PromptRow[] }>("/api/prompts"),
  });

  const factory = useQuery({
    queryKey: ["canvas", "refs", "factory"],
    enabled,
    staleTime: STALE,
    retry: false,
    queryFn: () => local.get<{ projects?: ProjectRow[] }>("/api/factory"),
  });

  const models = useQuery({
    queryKey: ["canvas", "refs", "models"],
    enabled,
    staleTime: STALE,
    retry: false,
    queryFn: () => local.get<{ resident?: { id: string; size?: string }[]; bench?: BenchRow[]; aliases?: string[] }>(
      "/api/models",
    ),
  });

  const kb = useQuery({
    queryKey: ["canvas", "refs", "kb"],
    enabled,
    staleTime: STALE,
    retry: false,
    queryFn: () => local.get<{ sources?: SourceRow[]; chunks?: number; documents?: number }>("/api/kb"),
  });

  const roots = useQuery({
    queryKey: ["canvas", "refs", "roots"],
    enabled,
    staleTime: STALE,
    retry: false,
    queryFn: () => local.get<{ roots?: RootRow[] }>("/api/roots"),
  });

  const skillRefs: CanvasRef[] = (skills.data?.skills ?? []).map((row) => ({
    id: `skill:${row.path}`,
    kind: "skill",
    label: row.name,
    path: row.path,
    // The trigger line, not a timestamp: it is what tells you whether loading
    // this skill will help.
    meta: row.description?.split("\n")[0]?.trim() || undefined,
  }));


  const promptRefs: CanvasRef[] = (prompts.data?.prompts ?? []).map((row) => ({
    id: `prompt:${row.path}`,
    kind: "prompt",
    label: row.name,
    path: row.path,
    meta: row.kind,
  }));

  const projectRefs: CanvasRef[] = (factory.data?.projects ?? []).map((row) => ({
    id: `project:${row.name}`,
    kind: "project",
    label: row.name,
    meta: [row.stage, row.status, row.sensitivity].filter(Boolean).join(" · "),
  }));

  const benchById = new Map<string, BenchRow>();
  for (const row of models.data?.bench ?? []) if (row.id) benchById.set(row.id, row);

  const modelRefs: CanvasRef[] = [
    ...(models.data?.resident ?? []).map((row) => ({
      id: `model:${row.id}`,
      kind: "model" as const,
      label: row.id,
      meta: [row.size, benchById.get(row.id)?.tps ? `${benchById.get(row.id)?.tps} t/s` : null]
        .filter(Boolean)
        .join(" · "),
    })),
    ...(models.data?.aliases ?? []).map((alias) => ({
      id: `model:alias:${alias}`,
      kind: "model" as const,
      label: alias,
      meta: "alias",
    })),
  ];

  const sourceRefs: CanvasRef[] = (kb.data?.sources ?? []).map((row) => ({
    id: `source:${row.path ?? row.file}`,
    kind: "source",
    label: row.file ?? row.path ?? "—",
    path: row.path,
    meta: row.chunks != null ? `${row.chunks} chunks` : undefined,
  }));

  const toolRefs: CanvasRef[] = JOB_KEYS.map((job) => ({
    id: `tool:${job.key}`,
    kind: "tool",
    label: job.label,
    meta: `${job.key} · ${job.tier}`,
  }));

  return {
    enabled,
    skills: skillRefs,
    prompts: promptRefs,
    projects: projectRefs,
    models: modelRefs,
    sources: sourceRefs,
    tools: toolRefs,
    roots: roots.data?.roots ?? [],
    loading:
      skills.isLoading ||
      prompts.isLoading ||
      factory.isLoading ||
      models.isLoading ||
      kb.isLoading ||
      roots.isLoading,
  };
}

/** File tree, one directory at a time — the picker never walks the disk eagerly. */
export function useTree(path: string | null) {
  const local = useLocal();
  return useQuery({
    queryKey: ["canvas", "tree", path ?? "root"],
    enabled: local.available && path !== null,
    staleTime: 30_000,
    retry: false,
    queryFn: () => local.get<TreeListing>("/api/tree", { path: path ?? "" }),
  });
}
