import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackupMetadata } from "./types";

const BACKUP_META_KEY = "lumina-backup-metadata";

// In-memory fallback for environments without localStorage (Node.js tests, SSR)
const memoryStore = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

// ── Known database schemas ──────────────────────────────────────────

interface HorizonPageRecord {
  index: number;
  cursor: string | null;
  prevCursor: string | null;
  nextCursor: string | null;
}

interface SerializedCursorCache {
  endpoint: string;
  pages: HorizonPageRecord[];
  updatedAt: string;
}

interface LuminaFieldDB extends DBSchema {
  inspectionRecords: {
    key: number;
    value: Record<string, unknown>;
    indexes: { "by-nodeId": string; "by-createdAt": string };
  };
  nodeConfigSnapshots: {
    key: number;
    value: Record<string, unknown>;
    indexes: { "by-nodeId": string; "by-snapshotAt": string };
  };
  syncQueue: {
    key: number;
    value: Record<string, unknown>;
    indexes: { "by-collection": string; "by-createdAt": string };
  };
  syncMetadata: {
    key: number;
    value: Record<string, unknown>;
    indexes: { "by-collection": string };
  };
  horizonCursors: {
    key: string;
    value: SerializedCursorCache;
  };
}

interface LuminaOfflineDB extends DBSchema {
  "outgoing-requests": {
    key: number;
    value: Record<string, unknown>;
    indexes: { "by-enqueuedAt": string };
  };
}

// ── DB names and store lists ────────────────────────────────────────

const DB_CONFIGS: Record<
  string,
  { version: number; stores: string[]; upgrade?: (db: IDBPDatabase<unknown>) => void }
> = {
  "lumina-field-db": {
    version: 2,
    stores: [
      "inspectionRecords",
      "nodeConfigSnapshots",
      "syncQueue",
      "syncMetadata",
      "horizonCursors",
    ],
  },
  "lumina-offline-queue": {
    version: 1,
    stores: ["outgoing-requests"],
  },
};

const KNOWN_DB_NAMES = Object.keys(DB_CONFIGS);

// ── Metadata helpers (localStorage) ─────────────────────────────────

function getStoredMetadata(): BackupMetadata[] {
  try {
    const raw = hasLocalStorage()
      ? localStorage.getItem(BACKUP_META_KEY)
      : memoryStore.get(BACKUP_META_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BackupMetadata[];
  } catch {
    return [];
  }
}

function persistMetadata(list: BackupMetadata[]): void {
  try {
    const json = JSON.stringify(list);
    if (hasLocalStorage()) {
      localStorage.setItem(BACKUP_META_KEY, json);
    } else {
      memoryStore.set(BACKUP_META_KEY, json);
    }
  } catch {
    // localStorage full — silently degrade
  }
}

export function saveMetadata(meta: BackupMetadata): void {
  const list = getStoredMetadata();
  const idx = list.findIndex((m) => m.id === meta.id);
  if (idx >= 0) {
    list[idx] = meta;
  } else {
    list.push(meta);
  }
  persistMetadata(list);
}

export function getMetadataList(): BackupMetadata[] {
  return getStoredMetadata();
}

export function removeMetadata(id: string): void {
  const list = getStoredMetadata().filter((m) => m.id !== id);
  persistMetadata(list);
}

export function clearAllMetadata(): void {
  try {
    if (hasLocalStorage()) {
      localStorage.removeItem(BACKUP_META_KEY);
    } else {
      memoryStore.delete(BACKUP_META_KEY);
    }
  } catch {
    // noop
  }
}

// ── IndexedDB export / import ───────────────────────────────────────

function getFieldDbPromise(): Promise<IDBPDatabase<LuminaFieldDB>> | null {
  if (typeof indexedDB === "undefined") return null;
  return openDB<LuminaFieldDB>("lumina-field-db", 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const ir = db.createObjectStore("inspectionRecords", {
          keyPath: "id",
          autoIncrement: true,
        });
        ir.createIndex("by-nodeId", "nodeId");
        ir.createIndex("by-createdAt", "createdAt");

        const nc = db.createObjectStore("nodeConfigSnapshots", {
          keyPath: "id",
          autoIncrement: true,
        });
        nc.createIndex("by-nodeId", "nodeId");
        nc.createIndex("by-snapshotAt", "snapshotAt");

        const sq = db.createObjectStore("syncQueue", {
          keyPath: "id",
          autoIncrement: true,
        });
        sq.createIndex("by-collection", "collection");
        sq.createIndex("by-createdAt", "createdAt");

        const sm = db.createObjectStore("syncMetadata", {
          keyPath: "id",
          autoIncrement: true,
        });
        sm.createIndex("by-collection", "collection");
      }
      if (oldVersion < 2) {
        db.createObjectStore("horizonCursors", { keyPath: "endpoint" });
      }
    },
    blocked() {},
  });
}

function getOfflineDbPromise(): Promise<IDBPDatabase<LuminaOfflineDB>> | null {
  if (typeof indexedDB === "undefined") return null;
  return openDB<LuminaOfflineDB>("lumina-offline-queue", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("outgoing-requests")) {
        const store = db.createObjectStore("outgoing-requests", {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("by-enqueuedAt", "enqueuedAt");
      }
    },
    blocked() {},
  });
}

/**
 * Reads every object store from a named IndexedDB and returns a map of
 * store-name → records[]. Returns an empty object if the DB does not
 * exist or is inaccessible.
 */
export async function exportDatabase(
  dbName: string,
): Promise<Record<string, unknown[]>> {
  const config = DB_CONFIGS[dbName];
  if (!config) return {};

  let db: IDBPDatabase<unknown> | null = null;
  try {
    if (dbName === "lumina-field-db") {
      db = await getFieldDbPromise();
    } else if (dbName === "lumina-offline-queue") {
      db = await getOfflineDbPromise();
    }
    if (!db) return {};

    const result: Record<string, unknown[]> = {};
    for (const storeName of config.stores) {
      if (db.objectStoreNames.contains(storeName)) {
        const tx = db.transaction(storeName, "readonly");
        const all = await tx.store.getAll();
        await tx.done;
        result[storeName] = all;
      }
    }
    return result;
  } catch {
    return {};
  } finally {
    if (db) db.close();
  }
}

/**
 * Writes records into an IndexedDB object store. If `clear` is true, the
 * store is cleared before writing. Returns the number of records written.
 */
export async function importStore(
  dbName: string,
  storeName: string,
  records: unknown[],
  clear?: boolean,
): Promise<number> {
  let db: IDBPDatabase<unknown> | null = null;
  try {
    if (dbName === "lumina-field-db") {
      db = await getFieldDbPromise();
    } else if (dbName === "lumina-offline-queue") {
      db = await getOfflineDbPromise();
    }
    if (!db) return 0;

    if (!db.objectStoreNames.contains(storeName)) return 0;

    const tx = db.transaction(storeName, "readwrite");
    if (clear) {
      await tx.store.clear();
    }
    let written = 0;
    for (const record of records) {
      await tx.store.put(record);
      written++;
    }
    await tx.done;
    return written;
  } catch {
    return 0;
  } finally {
    if (db) db.close();
  }
}

/**
 * Writes all stores for a database in a single transaction per store.
 * If `clear` is true, each store is cleared before writing.
 * Returns a map of store-name → recordsWritten.
 */
export async function importDatabase(
  dbName: string,
  data: Record<string, unknown[]>,
  clear?: boolean,
): Promise<Record<string, number>> {
  const config = DB_CONFIGS[dbName];
  if (!config) return {};

  const result: Record<string, number> = {};
  for (const storeName of config.stores) {
    const records = data[storeName];
    if (records && records.length > 0) {
      result[storeName] = await importStore(dbName, storeName, records, clear);
    } else {
      result[storeName] = 0;
    }
  }
  return result;
}

/**
 * Returns the total record count across all stores in a named IndexedDB.
 */
export async function countDatabaseRecords(
  dbName: string,
): Promise<number> {
  let db: IDBPDatabase<unknown> | null = null;
  try {
    if (dbName === "lumina-field-db") {
      db = (await getFieldDbPromise()) as unknown as IDBPDatabase<unknown>;
    } else if (dbName === "lumina-offline-queue") {
      db = (await getOfflineDbPromise()) as unknown as IDBPDatabase<unknown>;
    }
    if (!db) return 0;

    const config = DB_CONFIGS[dbName];
    if (!config) return 0;

    let total = 0;
    for (const storeName of config.stores) {
      if (db.objectStoreNames.contains(storeName)) {
        total += await db.count(storeName);
      }
    }
    return total;
  } catch {
    return 0;
  } finally {
    if (db) db.close();
  }
}

/**
 * Clears all data from all known databases.
 */
export async function clearAllDatabases(): Promise<void> {
  for (const dbName of KNOWN_DB_NAMES) {
    const config = DB_CONFIGS[dbName];
    if (!config) continue;
    let db: IDBPDatabase<unknown> | null = null;
    try {
      if (dbName === "lumina-field-db") {
        db = (await getFieldDbPromise()) as unknown as IDBPDatabase<unknown>;
      } else if (dbName === "lumina-offline-queue") {
        db = (await getOfflineDbPromise()) as unknown as IDBPDatabase<unknown>;
      }
      if (!db) continue;
      const tx = db.transaction(config.stores, "readwrite");
      for (const storeName of config.stores) {
        if (db.objectStoreNames.contains(storeName)) {
          await tx.objectStore(storeName).clear();
        }
      }
      await tx.done;
    } catch {
      // best-effort
    } finally {
      if (db) db.close();
    }
  }
}

export function getKnownDbNames(): string[] {
  return [...KNOWN_DB_NAMES];
}
