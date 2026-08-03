/**
 * The skills module. A skill is a small focused instruction file on the
 * machine, following Anthropic's shape: YAML frontmatter carrying a name and a
 * trigger-focused description, then a short body. Nothing here ever leaves the
 * machine — every read and write goes over loopback, and every POST is
 * multipart form fields, never JSON.
 *
 * A skill has a life: proposed -> active -> watch -> deprecated -> archived.
 * Every save snapshots the previous text into versions/ so the history is real
 * rather than remembered.
 */

type Local = {
  get: <T>(path: string, query?: Record<string, string | number | undefined>) => Promise<T>;
  post: <T>(path: string, form: Record<string, string | number | Blob | undefined>) => Promise<T>;
};

export const SKILL_STATES = ["proposed", "active", "watch", "deprecated", "archived"] as const;
export type SkillState = (typeof SKILL_STATES)[number];

export const SKILL_SCOPES = ["canvas", "project", "both"] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];

export type SkillMeta = {
  name: string;
  description: string;
  state: SkillState;
  scope: SkillScope;
  triggers: string[];
  uses: number;
  lastUsed: string | null;
  updated: string | null;
  version: number;
};

export type Skill = SkillMeta & {
  path: string;
  body: string;
  /** Verbatim file text, used to snapshot a version before overwriting. */
  raw: string;
};

export type SkillVersion = { path: string; name: string; stamp: string };

export const STATE_TONE: Record<SkillState, string> = {
  proposed: "text-copper",
  active: "text-ok",
  watch: "text-watch",
  deprecated: "text-faint",
  archived: "text-faint",
};

const DEFAULT_META: SkillMeta = {
  name: "",
  description: "",
  state: "active",
  scope: "both",
  triggers: [],
  uses: 0,
  lastUsed: null,
  updated: null,
  version: 1,
};

function splitList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** Frontmatter is parsed leniently: an older skill file is still a skill. */
export function parseSkill(raw: string, path: string): Skill {
  const name = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  const meta: SkillMeta = { ...DEFAULT_META, name };
  let body = raw;

  if (match) {
    body = match[2] ?? "";
    for (const line of match[1].split("\n")) {
      const pair = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
      if (!pair) continue;
      const key = pair[1].toLowerCase();
      const value = pair[2].trim().replace(/^["']|["']$/g, "");
      if (key === "name" && value) meta.name = value;
      else if (key === "description") meta.description = value;
      else if (key === "state" && (SKILL_STATES as readonly string[]).includes(value))
        meta.state = value as SkillState;
      else if (key === "scope" && (SKILL_SCOPES as readonly string[]).includes(value))
        meta.scope = value as SkillScope;
      else if (key === "triggers") meta.triggers = splitList(value);
      else if (key === "uses") meta.uses = Number(value) || 0;
      else if (key === "last_used") meta.lastUsed = value || null;
      else if (key === "updated") meta.updated = value || null;
      else if (key === "version") meta.version = Number(value) || 1;
    }
  }

  return { ...meta, path, body: body.trimStart(), raw };
}

export function serialiseSkill(skill: Skill): string {
  const front = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `state: ${skill.state}`,
    `scope: ${skill.scope}`,
    `triggers: [${skill.triggers.join(", ")}]`,
    `uses: ${skill.uses}`,
    `last_used: ${skill.lastUsed ?? ""}`,
    `updated: ${new Date().toISOString()}`,
    `version: ${skill.version}`,
    "---",
    "",
  ].join("\n");
  return `${front}${skill.body.trimStart()}\n`;
}

type SkillRow = {
  name?: string;
  path: string;
  modified?: string;
  description?: string;
  /** The endpoint now carries the lifecycle state; it wins over frontmatter. */
  state?: string;
  tier?: string;
  size?: number;
};

export type SkillCounts = Record<SkillState, number>;

function emptyCounts(): SkillCounts {
  const out = {} as SkillCounts;
  for (const state of SKILL_STATES) out[state] = 0;
  return out;
}

/** The list endpoint is the authority for state and description. */
function applyRow(skill: Skill, row: SkillRow): Skill {
  const state =
    row.state && (SKILL_STATES as readonly string[]).includes(row.state)
      ? (row.state as SkillState)
      : skill.state;
  return {
    ...skill,
    state,
    name: row.name?.trim() || skill.name,
    description: row.description?.trim() || skill.description,
  };
}

type TreeListing = {
  root?: string;
  dirs?: ({ name?: string; path?: string } | string)[];
  files?: ({ name?: string; path?: string } | string)[];
};

const asPath = (item: { path?: string; name?: string } | string) =>
  typeof item === "string" ? item : (item.path ?? item.name ?? "");

/**
 * Not every machine build serves /api/skills. When it is absent the files are
 * still there, so walk the tree for a skills folder rather than showing an
 * empty list and calling it the truth.
 */
async function discoverSkillFiles(local: Local): Promise<SkillRow[]> {
  const candidates = new Set<string>([
    "skills",
    "AgentHub/skills",
    "drafts/skills",
    "prompts/skills",
  ]);
  try {
    const roots = await local.get<{ roots?: ({ path?: string; name?: string } | string)[] }>(
      "/api/roots",
    );
    for (const root of roots.roots ?? []) {
      const path = asPath(root);
      if (!path) continue;
      if (/skill/i.test(path)) candidates.add(path);
      candidates.add(`${path.replace(/\/$/, "")}/skills`);
    }
  } catch {
    // No roots endpoint — the fixed candidates below still stand a chance.
  }

  const found: SkillRow[] = [];
  for (const dir of candidates) {
    let listing: TreeListing;
    try {
      listing = await local.get<TreeListing>("/api/tree", { path: dir });
    } catch {
      continue;
    }
    const here = (listing.files ?? []).map(asPath).filter((p) => p.endsWith(".md"));
    found.push(...here.map((path) => ({ path })));
    // One level down: skills/<name>/SKILL.md is the Anthropic shape.
    for (const sub of listing.dirs ?? []) {
      const subPath = asPath(sub);
      if (!subPath || /versions?$/i.test(subPath)) continue;
      try {
        const inner = await local.get<TreeListing>("/api/tree", { path: subPath });
        found.push(
          ...(inner.files ?? [])
            .map(asPath)
            .filter((p) => p.endsWith(".md"))
            .map((path) => ({ path })),
        );
      } catch {
        // Unreadable folder: skip it, keep what we have.
      }
    }
    if (found.length) break;
  }
  return found;
}

export async function listSkills(local: Local): Promise<Skill[]> {
  return (await fetchSkills(local)).skills;
}

/**
 * The list and its lifecycle counts. Counts come from the endpoint when it
 * supplies them, so a bucket never reads 0 while the directory holds fifty.
 */
export async function fetchSkills(
  local: Local,
): Promise<{ skills: Skill[]; counts: SkillCounts }> {
  let rows: SkillRow[] = [];
  let published: SkillCounts | null = null;
  try {
    const listing = await local.get<{
      skills?: (SkillRow | string)[];
      counts?: Record<string, number>;
    }>("/api/skills");
    rows = (listing.skills ?? []).map((item) =>
      typeof item === "string" ? { path: item } : item,
    );
    if (listing.counts) {
      const counts = emptyCounts();
      for (const state of SKILL_STATES) counts[state] = Number(listing.counts[state]) || 0;
      published = counts;
    }
  } catch {
    rows = [];
  }
  if (!rows.length) rows = await discoverSkillFiles(local);

  const files = rows.filter(
    (row) => row.path?.endsWith(".md") && !row.path.includes("/versions/"),
  );
  // The list is built from the listing alone. Reading every file here is what
  // produced a flood of refused /api/file calls; a body is read only when the
  // user opens one skill.
  const loaded = files.map((row) => applyRow(parseSkill("", row.path), row));

  const skills = loaded
    .filter((skill): skill is Skill => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = published ?? emptyCounts();
  if (!published) for (const skill of skills) counts[skill.state] = (counts[skill.state] ?? 0) + 1;
  return { skills, counts };
}


function versionDir(path: string) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  return `${dir}/versions`;
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Snapshot the current text, then overwrite. History before convenience. */
export async function saveSkill(local: Local, skill: Skill, previousRaw?: string) {
  if (previousRaw && previousRaw.trim()) {
    const snapshot = `${versionDir(skill.path)}/${skill.name}--${stampNow()}.md`;
    try {
      await local.post("/api/file/save", { path: snapshot, content: previousRaw });
    } catch {
      // A machine that refuses the versions folder still gets the save below.
    }
  }
  const next: Skill = { ...skill, version: skill.version + (previousRaw ? 1 : 0) };
  await local.post("/api/file/save", { path: skill.path, content: serialiseSkill(next) });
  return next;
}

export async function listVersions(local: Local, skill: Skill): Promise<SkillVersion[]> {
  try {
    const listing = await local.get<{ files?: { name: string; path: string; modified?: string }[] }>(
      "/api/tree",
      { path: versionDir(skill.path) },
    );
    return (listing.files ?? [])
      .filter((file) => file.name.startsWith(`${skill.name}--`))
      .map((file) => ({
        path: file.path,
        name: file.name,
        stamp: file.name.replace(`${skill.name}--`, "").replace(/\.md$/, "").replace(/-/g, ":"),
      }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export async function readVersion(local: Local, path: string): Promise<string> {
  const file = await local.get<{ raw?: string }>("/api/file", { path });
  return file.raw ?? "";
}

/** Word-level difference, enough to see what a version changed. */
export function wordDiff(before: string, after: string) {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const out: { text: string; kind: "same" | "added" | "removed" }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ text: a[i], kind: "same" });
      i += 1;
      j += 1;
      continue;
    }
    const nextMatch = b.indexOf(a[i] ?? "\u0000", j);
    if (i < a.length && nextMatch > -1 && nextMatch - j < 40) {
      out.push({ text: b.slice(j, nextMatch).join(""), kind: "added" });
      j = nextMatch;
      continue;
    }
    if (i < a.length) {
      out.push({ text: a[i], kind: "removed" });
      i += 1;
    }
    if (j < b.length && i >= a.length) {
      out.push({ text: b[j], kind: "added" });
      j += 1;
    }
  }
  return out.filter((part) => part.text !== "");
}

export function skillsRoot(skills: Skill[]): string | null {
  const first = skills[0]?.path;
  return first ? first.slice(0, first.lastIndexOf("/")) : null;
}

export function draftSkill(root: string, name: string, seed?: string): Skill {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return {
    ...DEFAULT_META,
    name: slug || "new-skill",
    description: "",
    state: "proposed",
    path: `${root}/${slug || "new-skill"}.md`,
    body: [
      "## When to use",
      "",
      seed?.trim() ? seed.trim() : "Describe the situation that should load this skill.",
      "",
      "## Steps",
      "",
      "1. ",
      "",
      "## Notes",
      "",
      "Keep this file short. Put depth in references/ beside it.",
      "",
    ].join("\n"),
    raw: "",
  };
}

/** Skills whose triggers appear in the text — the dynamic load. */
export function matchSkills(skills: Skill[], text: string, scope: SkillScope = "canvas") {
  const haystack = text.toLowerCase();
  if (!haystack.trim()) return [];
  return skills.filter((skill) => {
    if (skill.state === "deprecated" || skill.state === "archived" || skill.state === "proposed")
      return false;
    if (skill.scope !== "both" && skill.scope !== scope) return false;
    return skill.triggers.some((trigger) => trigger && haystack.includes(trigger.toLowerCase()));
  });
}

export type Candidate = {
  id: string;
  title: string;
  evidence: string;
  seed: string;
  source: "inbox" | "evals" | "cascade";
};

type DigestItem = { cls?: string; ent?: string; one?: string };
type EvalRow = { date?: string; model?: string; scores?: Record<string, unknown> };

/**
 * The daily mine. Candidates come from repetition the machine already recorded:
 * classes seen repeatedly overnight, and eval results that keep failing. It
 * proposes; the council decides.
 */
export async function mineCandidates(local: Local, existing: Skill[]): Promise<Candidate[]> {
  const known = new Set(existing.map((skill) => skill.name.toLowerCase()));
  const out: Candidate[] = [];

  try {
    const digest = await local.get<{ items?: DigestItem[] }>("/api/digest");
    const counts = new Map<string, { n: number; sample: string }>();
    for (const item of digest.items ?? []) {
      const key = [item.cls, item.ent].filter(Boolean).join(" · ");
      if (!key) continue;
      const seen = counts.get(key) ?? { n: 0, sample: item.one ?? "" };
      counts.set(key, { n: seen.n + 1, sample: seen.sample || (item.one ?? "") });
    }
    for (const [key, value] of counts) {
      if (value.n < 3) continue;
      const title = `Handle ${key}`;
      if (known.has(title.toLowerCase())) continue;
      out.push({
        id: `inbox:${key}`,
        title,
        evidence: `${value.n} items classified ${key} in the last digest`,
        seed: `Repeated work of the shape "${key}". Capture how it should be handled once, so it is not re-decided each time.`,
        source: "inbox",
      });
    }
  } catch {
    // No digest on this machine right now — the other sources still mine.
  }

  try {
    const evals = await local.get<{ results?: EvalRow[] }>("/api/evals");
    const latest = (evals.results ?? [])[0];
    if (latest) {
      const failing = Object.entries(latest.scores ?? {})
        .filter(([, value]) => Number(value) < 0.8)
        .map(([key]) => key);
      for (const metric of failing) {
        out.push({
          id: `evals:${metric}`,
          title: `Improve ${metric}`,
          evidence: `${metric} scored below 0.8 on ${latest.date ?? "the last run"}`,
          seed: `The ${metric} measure is below target. Write the instruction that closes the gap.`,
          source: "evals",
        });
      }
    }
  } catch {
    // Evals unavailable; not an error.
  }

  return out;
}
