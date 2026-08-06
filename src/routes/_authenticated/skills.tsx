import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Section } from "@/components/Section";
import { Empty, Skeleton, formatStamp } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import {
  SKILL_SCOPES,
  SKILL_STATES,
  STATE_TONE,
  draftSkill,
  fetchSkills,
  loadSkillBody,

  listVersions,
  mineCandidates,
  readVersion,
  saveSkill,
  serialiseSkill,
  skillsRoot,
  wordDiff,
  type Candidate,
  type Skill,
  type SkillScope,
  type SkillState,
} from "@/lib/skills-store";

export const Route = createFileRoute("/_authenticated/skills")({
  validateSearch: (search: Record<string, unknown>) => ({
    seed: typeof search.seed === "string" ? search.seed : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Skills — AgentHub" },
      {
        name: "description",
        content:
          "An evergreen loop: mine candidates daily, review them, version every change, load them only when a task needs them, deprecate them when they stop earning their place.",
      },
      { property: "og:title", content: "Skills — AgentHub" },
      {
        property: "og:description",
        content:
          "An evergreen loop: mine candidates daily, review them, version every change, load them only when a task needs them, deprecate them when they stop earning their place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Skills" footer="Skills · files read and written on the machine">
      <LocalOnly>
        <SkillsPage />
      </LocalOnly>
    </Page>
  ),
});

const LOOP = [
  { n: "01", label: "Mine", detail: "repetition the machine already recorded" },
  { n: "02", label: "Review", detail: "keep · modify · reject" },
  { n: "03", label: "Version", detail: "every save snapshots the last" },
  { n: "04", label: "Load", detail: "on trigger, or by hand" },
  { n: "05", label: "Retire", detail: "watch → deprecate → archive" },
];

function LoopBoard({ counts }: { counts: Record<SkillState, number> }) {
  return (
    <section className="border border-rule bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">
          Evergreen loop
        </p>
        <p className="font-mono text-[10px] text-faint">
          {SKILL_STATES.map((state) => `${counts[state] ?? 0} ${state}`).join(" · ")}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5">
        {LOOP.map((stage) => (
          <div
            key={stage.n}
            className="border-b border-rule px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[9px] text-copper">{stage.n}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper">
                {stage.label}
              </span>
            </div>
            <p className="mt-1 font-mono text-[9.5px] leading-relaxed text-faint">{stage.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SkillsPage() {
  const local = useLocal();
  const queryClient = useQueryClient();
  const { seed } = Route.useSearch();

  const [active, setActive] = useState<Skill | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | SkillState>("all");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [mining, setMining] = useState(false);

  const skills = useQuery({
    queryKey: ["skills", "list"],
    enabled: local.available,
    queryFn: () => fetchSkills(local),
    retry: false,
  });


  const list = useMemo(() => skills.data?.skills ?? [], [skills.data]);
  const root = skillsRoot(list) ?? "skills";

  const counts = useMemo(() => {
    const out = {} as Record<SkillState, number>;
    for (const state of SKILL_STATES) out[state] = 0;
    for (const [state, n] of Object.entries(skills.data?.counts ?? {})) {
      out[state as SkillState] = Number(n) || 0;
    }
    return out;
  }, [skills.data]);

  // An item sent here from the inbox opens as a draft, already seeded.
  useEffect(() => {
    if (seed && !active) setActive(draftSkill(root, seed.slice(0, 48), seed));
  }, [seed, active, root]);

  /** The body is read on open, once. A refusal is stated and left alone. */
  async function openSkill(skill: Skill) {
    if (active?.path === skill.path) {
      setActive(null);
      return;
    }
    setActive(skill);
    setNote(null);
    const { skill: loaded, refusal } = await loadSkillBody(local, skill);
    setActive((current) => (current?.path === skill.path ? loaded : current));
    if (refusal) setNote(refusal);
  }


  async function mine() {
    setMining(true);
    setNote("mining the machine for repetition…");
    try {
      setCandidates(await mineCandidates(local, list));
      setNote(null);
    } catch {
      setNote("the machine did not answer the mine");
    } finally {
      setMining(false);
    }
  }

  const visible = filter === "all" ? list : list.filter((skill) => skill.state === filter);

  return (
    <div className="space-y-4">

      <Section title="Evergreen loop">
        <LoopBoard counts={counts} />
      </Section>

      <Section title="Library">
      <section className="border border-rule bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">show</span>
          {(["all", ...SKILL_STATES] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`border px-2 py-1 font-mono text-[10px] ${
                filter === option
                  ? "border-copper text-copper"
                  : "border-rule text-muted-foreground hover:text-paper"
              }`}
            >
              {option}
              {option !== "all" && (
                <span className="ml-1 tabular-nums text-faint">{counts[option] ?? 0}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setActive(draftSkill(root, "new skill"))}
            className="ml-auto border border-rule px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
          >
            + draft
          </button>
          <button
            type="button"
            onClick={() => void mine()}
            disabled={mining}
            className="border border-copper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-50"
          >
            {mining ? "Mining…" : "Mine today"}
          </button>
        </div>

        {skills.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-3 font-mono text-[11px] text-faint">
            no skills at this state — draft one, or mine today
          </p>
        ) : (
          <ul>
            {visible.map((skill) => (
              <li key={skill.path} className="border-t border-rule first:border-t-0">
                <button
                  type="button"
                  onClick={() => void openSkill(skill)}
                  className="block w-full px-4 py-3 text-left hover:bg-panel2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[14px] text-paper">{skill.name}</span>
                    <span
                      className={`border border-rule px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${STATE_TONE[skill.state]}`}
                    >
                      {skill.state}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
                      {skill.scope}
                    </span>
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-faint">
                      v{skill.version} · {skill.uses} uses · {formatStamp(skill.updated)}
                    </span>
                  </div>
                  {skill.description && (
                    <p className="mt-1 max-w-[72ch] text-[12.5px] leading-relaxed text-faint">
                      {skill.description.split("\n")[0]}
                    </p>
                  )}
                  {skill.triggers.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-faint">
                      triggers: {skill.triggers.join(" · ")}
                    </p>
                  )}
                </button>
                {active?.path === skill.path && (
                  <Editor
                    skill={active}
                    onChange={setActive}
                    onSaved={() => {
                      setActive(null);
                      void queryClient.invalidateQueries({ queryKey: ["skills", "list"] });
                    }}
                    onNote={setNote}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      </Section>

      <Section title="Editor">
      {active && !list.some((skill) => skill.path === active.path) && (
        <Panel title="Draft">
          <Editor
            skill={active}
            onChange={setActive}
            onSaved={() => {
              setActive(null);
              void queryClient.invalidateQueries({ queryKey: ["skills", "list"] });
            }}
            onNote={setNote}
          />
        </Panel>
      )}

      {candidates && (
        <Panel title="Mined today — put to the council">
          {candidates.length === 0 ? (
            <Empty>Nothing repeated enough today to be worth a skill.</Empty>
          ) : (
            <ul>
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-rule py-3 first:border-t-0"
                >
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-copper">
                    {candidate.source}
                  </span>
                  <span className="text-[14px] text-paper">{candidate.title}</span>
                  <span className="w-full font-mono text-[10px] text-faint">
                    {candidate.evidence}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setActive(draftSkill(root, candidate.title, candidate.seed))
                      }
                      className="border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
                    >
                      Draft it
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCandidates((current) =>
                          (current ?? []).filter((entry) => entry.id !== candidate.id),
                        )
                      }
                      className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-risk"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {note && <p className="font-mono text-[10px] text-copper">{note}</p>}
      </Section>
    </div>
  );
}

function Editor({
  skill,
  onChange,
  onSaved,
  onNote,
}: {
  skill: Skill;
  onChange: (skill: Skill) => void;
  onSaved: () => void;
  onNote: (note: string | null) => void;
}) {
  const local = useLocal();
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [diff, setDiff] = useState<{ stamp: string; parts: ReturnType<typeof wordDiff> } | null>(null);

  const versions = useQuery({
    queryKey: ["skills", "versions", skill.path],
    enabled: showHistory && local.available,
    queryFn: () => listVersions(local, skill),
  });

  async function save() {
    setBusy(true);
    onNote("saving to the machine…");
    try {
      await saveSkill(local, skill, skill.raw);
      onNote("saved · previous text snapshotted to versions/");
      onSaved();
    } catch (error) {
      onNote(
        isRefusal(error) ? "denied at the approval dialog" : "the machine did not save that skill",
      );
      setBusy(false);
    }
  }

  async function openVersion(path: string, stamp: string) {
    try {
      const raw = await readVersion(local, path);
      setDiff({ stamp, parts: wordDiff(raw, serialiseSkill(skill)) });
    } catch {
      onNote("the machine did not open that version");
    }
  }

  return (
    <div className="border-t border-rule bg-panel2 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={skill.name}
            onChange={(event) => onChange({ ...skill, name: event.target.value })}
            className="w-full border border-rule bg-panel px-2 py-1.5 font-mono text-[12px] text-paper outline-none focus:border-copper"
          />
        </Field>
        <Field label="Triggers (comma separated)">
          <input
            value={skill.triggers.join(", ")}
            onChange={(event) =>
              onChange({
                ...skill,
                triggers: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
            placeholder="invoice, vat, quarterly"
            className="w-full border border-rule bg-panel px-2 py-1.5 font-mono text-[12px] text-paper placeholder:text-faint outline-none focus:border-copper"
          />
        </Field>
        <Field label="Description — when this should load">
          <input
            value={skill.description}
            onChange={(event) => onChange({ ...skill, description: event.target.value })}
            className="w-full border border-rule bg-panel px-2 py-1.5 text-[13px] text-paper outline-none focus:border-copper"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State">
            <select
              value={skill.state}
              onChange={(event) => onChange({ ...skill, state: event.target.value as SkillState })}
              className="w-full border border-rule bg-panel px-2 py-1.5 font-mono text-[11px] text-paper outline-none focus:border-copper"
            >
              {SKILL_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scope">
            <select
              value={skill.scope}
              onChange={(event) => onChange({ ...skill, scope: event.target.value as SkillScope })}
              className="w-full border border-rule bg-panel px-2 py-1.5 font-mono text-[11px] text-paper outline-none focus:border-copper"
            >
              {SKILL_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {editing ? (
        <textarea
          value={skill.body}
          onChange={(event) => onChange({ ...skill, body: event.target.value })}
          rows={14}
          spellCheck={false}
          className="mt-3 w-full resize-y border border-rule bg-panel p-3 font-mono text-[12px] leading-relaxed text-paper outline-none focus:border-copper"
        />
      ) : (
        <div className="mt-3 border border-rule bg-panel p-3">
          <Markdown text={skill.body} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing((open) => !open)}
          className="border border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
        >
          {editing ? "Read" : "Edit"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save version"}
        </button>
        <button
          type="button"
          onClick={() => setShowHistory((open) => !open)}
          className="border border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
        >
          History
        </button>
        <span className="font-mono text-[10px] text-faint">{skill.path}</span>
      </div>

      {showHistory && (
        <div className="mt-3 border border-rule">
          {versions.isLoading && (
            <p className="px-3 py-2 font-mono text-[10px] text-faint">reading the machine…</p>
          )}
          {!versions.isLoading && (versions.data ?? []).length === 0 && (
            <p className="px-3 py-2 font-mono text-[10px] text-faint">
              no earlier versions — the next save writes one
            </p>
          )}
          {(versions.data ?? []).map((version) => (
            <button
              key={version.path}
              type="button"
              onClick={() => void openVersion(version.path, version.stamp)}
              className="block w-full border-t border-rule px-3 py-2 text-left font-mono text-[10px] text-muted-foreground first:border-t-0 hover:text-copper"
            >
              {version.stamp}
            </button>
          ))}
        </div>
      )}

      {diff && (
        <div className="mt-3 border border-rule bg-panel p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            {diff.stamp} → now
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
            {diff.parts.map((part, index) => (
              <span
                key={index}
                className={
                  part.kind === "added"
                    ? "text-ok"
                    : part.kind === "removed"
                      ? "text-risk line-through"
                      : "text-muted-foreground"
                }
              >
                {part.text}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
