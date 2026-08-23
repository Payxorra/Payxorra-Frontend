import type {
  BackupFile,
  BackupManifest,
  BackupMetadata,
  BackupEvent,
  BackupEventType,
  BackupScheduleConfig,
  BackupFrequency, // eslint-disable-line @typescript-eslint/no-unused-vars
  BackupDatabases,
  RestoreReport,
  VerifyReport,
} from "./types";
import { BACKUP_SCHEMA_VERSION } from "./types";
import {
  exportDatabase,
  importDatabase, // eslint-disable-line @typescript-eslint/no-unused-vars
  saveMetadata,
  getMetadataList,
  removeMetadata,
  clearAllMetadata,
  countDatabaseRecords, // eslint-disable-line @typescript-eslint/no-unused-vars
  getKnownDbNames,
} from "./storage";
import { computeChecksum, verifyBackup } from "./verify";
import { restoreBackup, runRestoreTest, restoreTestCycle } from "./restore-test";

type BackupSubscriber = (event: BackupEvent) => void;

const STORAGE_KEY_SCHEDULE = "lumina-backup-schedule";
const DEFAULT_SCHEDULE: BackupScheduleConfig = {
  enabled: false,
  frequency: "daily",
  timeOfDay: "02:00",
  retentionCount: 7,
  autoRestoreTest: false,
};

const memoryScheduleStore = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `backup-${ts}-${rand}`;
}

async function getAppVersion(): Promise<string> {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="app-version"]');
    if (meta) return meta.getAttribute("content") ?? "0.0.0";
  }
  return "0.0.0";
}

function getDeployChannel(): string {
  if (typeof process !== "undefined" && process.env) {
    return (
      (process as unknown).env?.NEXT_PUBLIC_DEPLOY_CHANNEL ?? "stable"
    );
  }
  return "stable";
}

function getReleaseSlot(): string {
  if (typeof process !== "undefined" && process.env) {
    return (process as unknown).env?.NEXT_PUBLIC_RELEASE_SLOT ?? "blue";
  }
  return "blue";
}

export class BackupRestoreManager {
  private subscribers: Set<BackupSubscriber> = new Set();

  subscribe(cb: BackupSubscriber): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private emit(type: BackupEventType, details: string, opts?: {
    backupId?: string;
    durationMs?: number;
  }): void {
    const event: BackupEvent = {
      type,
      timestamp: new Date().toISOString(),
      details,
      backupId: opts?.backupId,
      durationMs: opts?.durationMs,
    };
    for (const cb of this.subscribers) {
      try {
        cb(event);
      } catch {
        // subscriber must not throw
      }
    }
  }

  async createBackup(): Promise<BackupFile | null> {
    const start = performance.now();
    const dbNames = getKnownDbNames();
    const databases: BackupDatabases = {};
    const recordCounts: Record<string, number> = {};
    let totalSizeBytes = 0;

    // Export all databases
    for (const dbName of dbNames) {
      const data = await exportDatabase(dbName);
      databases[dbName] = data;

      let dbSize = 0;
      for (const [storeName, records] of Object.entries(data)) {
        const storeKey = `${dbName}/${storeName}`;
        recordCounts[storeKey] = records.length;
        for (const record of records) {
          dbSize += new Blob([JSON.stringify(record)]).size;
        }
      }
      totalSizeBytes += dbSize;
    }

    // Compute per-DB checksums
    const dbChecksums: Record<string, string> = {};
    for (const dbName of dbNames) {
      const dbData = databases[dbName];
      dbChecksums[dbName] = await computeChecksum(
        JSON.stringify(dbData),
      );
    }

    const integrity = { dbChecksums };

    // Compute full checksum over databases + integrity (matches verifyBackup)
    const checksumPayload = JSON.stringify({ databases, integrity });
    const checksum = await computeChecksum(checksumPayload);

    const manifest: BackupManifest = {
      version: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      schemaVersion: BACKUP_SCHEMA_VERSION,
      checksum,
      appVersion: await getAppVersion(),
      deployChannel: getDeployChannel(),
      releaseSlot: getReleaseSlot(),
      dbNames: [...dbNames],
      recordCounts,
      totalSizeBytes,
    };

    const backupFile: BackupFile = {
      manifest,
      databases,
      integrity,
    };

    // Save metadata to localStorage index
    const totalRecords = Object.values(recordCounts).reduce((a, b) => a + b, 0);
    const backupMetadata: BackupMetadata = {
      id: generateId(),
      createdAt: manifest.createdAt,
      checksum: manifest.checksum,
      recordCount: totalRecords,
      totalSizeBytes: manifest.totalSizeBytes,
      schemaVersion: manifest.schemaVersion,
      deployChannel: manifest.deployChannel,
    };
    saveMetadata(backupMetadata);

    // Enforce retention
    this.enforceRetention();

    const durationMs = Math.round(performance.now() - start);
    this.emit("backup-created", `Backup ${backupMetadata.id} created`, {
      backupId: backupMetadata.id,
      durationMs,
    });

    return backupFile;
  }

  async restoreBackup(
    file: BackupFile,
    dryRun?: boolean,
  ): Promise<RestoreReport & { preRestoreSnapshot?: BackupDatabases }> {
    const start = performance.now();
    const result = await restoreBackup(file, dryRun);

    if (dryRun) {
      return result;
    }

    const eventType: BackupEventType = result.ok
      ? "restore-completed"
      : "restore-failed";
    this.emit(
      eventType,
      result.error ?? `Restored ${result.totalRecordsRestored} records`,
      { durationMs: Math.round(performance.now() - start) },
    );

    return result;
  }

  async verifyBackup(file: BackupFile): Promise<VerifyReport> {
    const report = await verifyBackup(file);

    if (!report.ok) {
      this.emit("verify-failed", report.errors.join("; "), {
        durationMs: report.durationMs,
      });
    }

    return report;
  }

  async runRestoreTest(backup: BackupFile): Promise<RestoreReport> {
    return runRestoreTest(backup);
  }

  async restoreTestCycle(backup: BackupFile): Promise<RestoreReport> {
    const start = performance.now();
    const result = await restoreTestCycle(backup);

    const eventType: BackupEventType = result.ok
      ? "restore-completed"
      : "restore-failed";
    this.emit(eventType, result.error ?? "Restore test cycle completed", {
      durationMs: Math.round(performance.now() - start),
    });

    return result;
  }

  // ── Metadata management ─────────────────────────────────────────

  listBackups(): BackupMetadata[] {
    return getMetadataList().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  deleteBackup(id: string): void {
    removeMetadata(id);
  }

  clearAllBackupMetadata(): void {
    clearAllMetadata();
  }

  // ── Schedule management ─────────────────────────────────────────

  getScheduleConfig(): BackupScheduleConfig {
    try {
      const raw = hasLocalStorage()
        ? localStorage.getItem(STORAGE_KEY_SCHEDULE)
        : memoryScheduleStore.get(STORAGE_KEY_SCHEDULE);
      if (!raw) return { ...DEFAULT_SCHEDULE };
      return { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SCHEDULE };
    }
  }

  updateScheduleConfig(config: BackupScheduleConfig): void {
    try {
      const json = JSON.stringify(config);
      if (hasLocalStorage()) {
        localStorage.setItem(STORAGE_KEY_SCHEDULE, json);
      } else {
        memoryScheduleStore.set(STORAGE_KEY_SCHEDULE, json);
      }
    } catch {
      // localStorage full — silently degrade
    }
  }

  // ── Retention ───────────────────────────────────────────────────

  private enforceRetention(): void {
    const config = this.getScheduleConfig();
    const maxRetention = Math.max(config.retentionCount, 1);
    const backups = this.listBackups();

    if (backups.length > maxRetention) {
      const toRemove = backups.slice(maxRetention);
      for (const b of toRemove) {
        this.deleteBackup(b.id);
      }
    }
  }
}

/** Singleton instance */
let instance: BackupRestoreManager | null = null;

export function getBackupRestoreManager(): BackupRestoreManager {
  if (!instance) {
    instance = new BackupRestoreManager();
  }
  return instance;
}

/** Reset for tests */
export function resetBackupRestoreManagerForTests(): void {
  instance = null;
}

export { computeChecksum } from "./verify";
export {
  restoreBackup,
  runRestoreTest,
  restoreTestCycle,
  rollbackRestore,
} from "./restore-test";
export {
  exportDatabase,
  importDatabase,
  importStore,
  saveMetadata,
  getMetadataList,
  removeMetadata,
  clearAllMetadata,
  clearAllDatabases,
  countDatabaseRecords,
  getKnownDbNames,
} from "./storage";
export type {
  BackupFile,
  BackupManifest,
  BackupMetadata,
  BackupEvent,
  BackupScheduleConfig,
  BackupFrequency,
  RestoreReport,
  VerifyReport,
  BackupDatabases,
  BackupEventType,
  BackupRestoreTelemetryPayload,
} from "./types";
export { BACKUP_SCHEMA_VERSION, PERFORMANCE_BUDGET_MS } from "./types";
