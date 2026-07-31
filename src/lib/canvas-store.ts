import { normaliseDoc, type CanvasDoc } from "@/lib/canvas-types";

type Local = {
  get: <T>(path: string, query?: Record<string, string | number | undefined>) => Promise<T>;
  post: <T>(path: string, form: Record<string, string | number | Blob | undefined>) => Promise<T>;
};

export const CANVAS_SUFFIX = ".canvas.json";

/** Canvases live beside drafts on the machine. They are never written anywhere else. */
export function canvasDir(roots: { name: string; path: string }[]): string | null {
  const drafts = roots.find((root) => root.name.toLowerCase() === "drafts");
  const docs = roots.find((root) => root.name.toLowerCase() === "docs");
  const base = drafts ?? docs ?? roots[0];
  return base ? `${base.path.replace(/\/$/, "")}/canvas` : null;
}

export function slugify(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "canvas";
}

export type LibraryEntry = { name: string; path: string; title: string; modified?: string };

export async function listCanvases(local: Local, dir: string): Promise<LibraryEntry[]> {
  try {
    const listing = await local.get<{ files?: { name: string; path: string; modified?: string }[] }>(
      "/api/tree",
      { path: dir },
    );
    return (listing.files ?? [])
      .filter((file) => file.name.endsWith(CANVAS_SUFFIX))
      .map((file) => ({
        name: file.name,
        path: file.path,
        title: file.name.slice(0, -CANVAS_SUFFIX.length).replace(/-/g, " "),
        modified: file.modified,
      }))
      .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
  } catch {
    // The folder does not exist yet. An empty library is the correct answer.
    return [];
  }
}

export async function readCanvas(local: Local, path: string): Promise<CanvasDoc | null> {
  const file = await local.get<{ raw?: string }>("/api/file", { path });
  try {
    return normaliseDoc(JSON.parse(file.raw ?? ""), path);
  } catch {
    return null;
  }
}

export async function writeCanvas(local: Local, dir: string, doc: CanvasDoc): Promise<string> {
  const path = doc.path ?? `${dir}/${slugify(doc.title)}${CANVAS_SUFFIX}`;
  const payload: CanvasDoc = { ...doc, path, updated: new Date().toISOString() };
  await local.post("/api/file/save", { path, content: JSON.stringify(payload, null, 2) });
  return path;
}

export async function deleteCanvas(local: Local, path: string) {
  await local.post("/api/file/delete", { path });
}
