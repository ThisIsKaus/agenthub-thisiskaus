/**
 * Offline capture queue.
 *
 * A capture written with no connection is stored in IndexedDB and flushed to
 * the `jobs` table as soon as the network and a session are available. Only
 * the text the user typed on this device is stored — nothing read back from
 * the machine ever touches this queue.
 */
import { supabase } from "@/integrations/supabase/client";

export type PendingCapture = {
  id: string;
  text: string;
  tags: string[];
  captured_at: string;
};

const DB_NAME = "agenthub";
const DB_VERSION = 1;
const STORE = "pending_captures";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

export async function queueCapture(capture: PendingCapture) {
  await tx("readwrite", (store) => store.put(capture));
}

export async function listPending(): Promise<PendingCapture[]> {
  const rows = await tx<PendingCapture[]>("readonly", (store) => store.getAll());
  return rows.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
}

export async function removePending(id: string) {
  await tx("readwrite", (store) => store.delete(id));
}

export async function countPending() {
  return tx<number>("readonly", (store) => store.count());
}

export async function insertCaptureJob(capture: PendingCapture) {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("No session");

  const { error } = await supabase.from("jobs").insert({
    kind: "capture",
    created_by: userId,
    payload: {
      text: capture.text,
      tags: capture.tags,
      captured_at: capture.captured_at,
      client_id: capture.id,
    },
  });
  if (error) throw error;
}

let flushing = false;

/** Sends everything queued offline. Returns how many were accepted. */
export async function flushQueue(): Promise<number> {
  if (flushing || typeof indexedDB === "undefined" || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const capture of await listPending()) {
      try {
        await insertCaptureJob(capture);
        await removePending(capture.id);
        sent += 1;
      } catch {
        break; // still offline or unauthenticated — keep the rest queued
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
