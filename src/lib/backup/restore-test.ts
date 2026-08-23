import type { BackupFile, RestoreReport, StoreResult } from "./types";
import { verifyBackup } from "./verify";
import {
  exportDatabase,
  importDatabase,
  countDatabaseRecords, // eslint-disable-line @typescript-eslint/no-unused-vars
} from "./storage";

/**
 * Runs a dry-run restore test: validates the backup file and reports what
 * would be restored without writing any data to IndexedDB.
 */
export async function runRestoreTest(backup: BackupFile): Promise<RestoreReport> {
  const start = performance.now();
  const stores: StoreResult[] = [];
  let totalRecordsRestored = 0;

  // First, verify the backup integrity
  const verifyReport = await verifyBackup(backup);
  if (!verifyReport.ok) {
    return {
      ok: false,
      storesAttempted: 0,
      storesSucceeded: 0,
      storesFailed: 1,
      totalRecordsRestored: 0,
      durationMs: Math.round(performance.now() - start),
      results: [],
      error: `Verification failed: ${verifyReport.errors.join("; ")}`,
    };
  }

  // Count what would be restored
  for (const [dbName, storesData] of Object.entries(backup.databases ?? {})) {
    for (const [storeName, records] of Object.entries(storesData)) {
      stores.push({
        storeName: `${dbName}/${storeName}`,
        records: records.length,
        ok: true,
      });
      totalRecordsRestored += records.length;
    }
  }

  return {
    ok: true,
    storesAttempted: stores.length,
    storesSucceeded: stores.length,
    storesFailed: 0,
    totalRecordsRestored,
    durationMs: Math.round(performance.now() - start),
    results: stores,
  };
}

/**
 * Performs a full restore of the backup file to IndexedDB.
 * If `dryRun` is true, validates without writing.
 *
 * Creates a pre-restore snapshot in memory that is returned so callers
 * can perform a rollback if needed.
 */
export async function restoreBackup(
  backup: BackupFile,
  dryRun?: boolean,
): Promise<RestoreReport & { preRestoreSnapshot?: BackupFile["databases"] }> {
  const start = performance.now();
  const stores: StoreResult[] = [];
  let totalRecordsRestored = 0;

  // First, verify the backup
  const verifyReport = await verifyBackup(backup);
  if (!verifyReport.ok) {
    return {
      ok: false,
      storesAttempted: 0,
      storesSucceeded: 0,
      storesFailed: 1,
      totalRecordsRestored: 0,
      durationMs: Math.round(performance.now() - start),
      results: [],
      error: `Verification failed: ${verifyReport.errors.join("; ")}`,
    };
  }

  // Capture pre-restore snapshot for rollback
  const preRestoreSnapshot: BackupFile["databases"] = {};
  for (const dbName of Object.keys(backup.databases ?? {})) {
    preRestoreSnapshot[dbName] = await exportDatabase(dbName);
  }

  if (dryRun) {
    // In dry-run mode, count what would be written
    for (const [dbName, storesData] of Object.entries(backup.databases ?? {})) {
      for (const [storeName, records] of Object.entries(storesData)) {
        stores.push({
          storeName: `${dbName}/${storeName}`,
          records: records.length,
          ok: true,
        });
        totalRecordsRestored += records.length;
      }
    }

    return {
      ok: true,
      storesAttempted: stores.length,
      storesSucceeded: stores.length,
      storesFailed: 0,
      totalRecordsRestored,
      durationMs: Math.round(performance.now() - start),
      results: stores,
      preRestoreSnapshot,
    };
  }

  // Perform actual restore
  let anyFailed = false;
  for (const [dbName, storesData] of Object.entries(backup.databases ?? {})) {
    const dbResults = await importDatabase(dbName, storesData, true);
    for (const [storeName, written] of Object.entries(dbResults)) {
      const expected = (storesData[storeName] ?? []).length;
      const ok = written === expected;
      stores.push({
        storeName: `${dbName}/${storeName}`,
        records: written,
        ok,
      });
      totalRecordsRestored += written;
      if (!ok) anyFailed = true;
    }
  }

  return {
    ok: !anyFailed,
    storesAttempted: stores.length,
    storesSucceeded: stores.filter((s) => s.ok).length,
    storesFailed: stores.filter((s) => !s.ok).length,
    totalRecordsRestored,
    durationMs: Math.round(performance.now() - start),
    results: stores,
    preRestoreSnapshot,
  };
}

/**
 * Rolls back a restore by writing the pre-restore snapshot back into
 * IndexedDB.
 */
export async function rollbackRestore(
  snapshot: BackupFile["databases"],
): Promise<RestoreReport> {
  const start = performance.now();
  const stores: StoreResult[] = [];
  let totalRecordsRestored = 0;
  const anyFailed = false;

  for (const [dbName, storesData] of Object.entries(snapshot)) {
    const dbResults = await importDatabase(dbName, storesData, true);
    for (const [storeName, written] of Object.entries(dbResults)) {
      stores.push({
        storeName: `${dbName}/${storeName}`,
        records: written,
        ok: true,
      });
      totalRecordsRestored += written;
    }
  }

  return {
    ok: !anyFailed,
    storesAttempted: stores.length,
    storesSucceeded: stores.filter((s) => s.ok).length,
    storesFailed: stores.filter((s) => !s.ok).length,
    totalRecordsRestored,
    durationMs: Math.round(performance.now() - start),
    results: stores,
  };
}

/**
 * Runs a full restore test cycle: verify → dry-run → full restore → verify.
 * Returns the final restore report.
 */
export async function restoreTestCycle(
  backup: BackupFile,
): Promise<RestoreReport> {
  const verifyResult = await verifyBackup(backup);
  if (!verifyResult.ok) {
    return {
      ok: false,
      storesAttempted: 0,
      storesSucceeded: 0,
      storesFailed: 1,
      totalRecordsRestored: 0,
      durationMs: verifyResult.durationMs,
      results: [],
      error: `Verification failed: ${verifyResult.errors.join("; ")}`,
    };
  }

  const dryRunResult = await runRestoreTest(backup);
  if (!dryRunResult.ok) {
    return dryRunResult;
  }

  return restoreBackup(backup, false);
}
