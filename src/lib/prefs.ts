/*
 * Preference store. IndexedDB, the same durable path the capture queue uses.
 * localStorage / sessionStorage are unsupported in this app and must not be used.
 */

const DB_NAME = "agenthub-prefs";
const DB_VERSION = 1;
const STORE = "prefs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readPref<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await open();
    return await new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function writePref(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* preference is a convenience, never a failure surface */
  }
}
