import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import {
  BackupRestoreManager, // eslint-disable-line @typescript-eslint/no-unused-vars
  resetBackupRestoreManagerForTests,
  getBackupRestoreManager,
  BACKUP_SCHEMA_VERSION,
  PERFORMANCE_BUDGET_MS, // eslint-disable-line @typescript-eslint/no-unused-vars
} from "../index";
import {
  validateManifest,
  validateStorePresence,
  checkConsistency,
  computeChecksum,
  verifyBackup,
} from "../verify";
import {
  exportDatabase,
  importDatabase, // eslint-disable-line @typescript-eslint/no-unused-vars
  saveMetadata,
  getMetadataList,
  removeMetadata,
  clearAllMetadata,
  clearAllDatabases,
  countDatabaseRecords,
  importStore,
} from "../storage";
import type {
  BackupFile,
  BackupScheduleConfig,
} from "../types";
import { restoreBackup, rollbackRestore, runRestoreTest } from "../restore-test";

// ── Helpers ───────────────────────────────────────────────────────────

function makeMinimalBackup(overrides?: Partial<BackupFile>): BackupFile {
  const base: BackupFile = {
    manifest: {
      version: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      schemaVersion: BACKUP_SCHEMA_VERSION,
      checksum: "test-checksum-placeholder",
      appVersion: "0.1.0",
      deployChannel: "stable",
      releaseSlot: "blue",
      dbNames: ["lumina-field-db", "lumina-offline-queue"],
      recordCounts: {},
      totalSizeBytes: 100,
    },
    databases: {
      "lumina-field-db": {
        inspectionRecords: [],
        nodeConfigSnapshots: [],
        syncQueue: [],
        syncMetadata: [],
        horizonCursors: [],
      },
      "lumina-offline-queue": {
        "outgoing-requests": [],
      },
    },
    integrity: {
      dbChecksums: {},
    },
  };
  return { ...base, ...overrides };
}

// ── Test harness ──────────────────────────────────────────────────────

interface FailedTest { name: string; error: unknown }
const failures: FailedTest[] = [];
let passed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failures.push({ name, error: err });
  }
}

// ─── verify.ts tests ───────────────────────────────────────────────────

async function runVerifyTests() {
  console.log("\n  verify.ts tests");

  await test("validateManifest accepts a valid manifest", async () => {
    const backup = makeMinimalBackup();
    const errors = validateManifest(backup.manifest);
    assert.equal(errors.length, 0, JSON.stringify(errors));
  });

  await test("validateManifest rejects missing version", async () => {
    const backup = makeMinimalBackup();
    (backup.manifest as unknown).version = undefined;
    const errors = validateManifest(backup.manifest);
    assert.ok(errors.some((e) => e.includes("version")));
  });

  await test("validateManifest rejects invalid createdAt", async () => {
    const backup = makeMinimalBackup();
    (backup.manifest as unknown).createdAt = "not-a-date";
    const errors = validateManifest(backup.manifest);
    assert.ok(errors.some((e) => e.includes("createdAt")));
  });

  await test("validateManifest rejects schema version mismatch", async () => {
    const backup = makeMinimalBackup();
    (backup.manifest as unknown).schemaVersion = 999;
    const errors = validateManifest(backup.manifest);
    assert.ok(errors.some((e) => e.includes("schemaVersion")));
  });

  await test("validateManifest rejects missing checksum", async () => {
    const backup = makeMinimalBackup();
    (backup.manifest as unknown).checksum = "";
    const errors = validateManifest(backup.manifest);
    assert.ok(errors.some((e) => e.includes("checksum")));
  });

  await test("validateStorePresence accepts complete backup", async () => {
    const backup = makeMinimalBackup();
    const errors = validateStorePresence(backup);
    assert.equal(errors.length, 0);
  });

  await test("validateStorePresence detects missing database", async () => {
    const backup = makeMinimalBackup();
    delete backup.databases["lumina-field-db"];
    const errors = validateStorePresence(backup);
    assert.ok(errors.some((e) => e.includes("lumina-field-db")));
  });

  await test("validateStorePresence detects missing store", async () => {
    const backup = makeMinimalBackup();
    delete backup.databases["lumina-field-db"].inspectionRecords;
    const errors = validateStorePresence(backup);
    assert.ok(errors.some((e) => e.includes("inspectionRecords")));
  });

  await test("checkConsistency detects missing fields", async () => {
    const backup = makeMinimalBackup();
    backup.databases["lumina-field-db"].inspectionRecords = [
      { id: 1, nodeId: "", technicianId: "tech-1", status: "ok" },
    ];
    const errors = checkConsistency(backup);
    assert.ok(errors.some((e) => e.includes("nodeId")));
  });

  await test("checkConsistency passes clean records", async () => {
    const backup = makeMinimalBackup();
    backup.databases["lumina-field-db"].inspectionRecords = [
      { id: 1, nodeId: "node-1", technicianId: "tech-1", status: "ok" },
    ];
    backup.databases["lumina-field-db"].nodeConfigSnapshots = [
      { id: 1, nodeId: "node-1", config: { key: "val" } },
    ];
    const errors = checkConsistency(backup);
    assert.equal(errors.length, 0);
  });

  await test("checkConsistency detects missing config in snapshot", async () => {
    const backup = makeMinimalBackup();
    backup.databases["lumina-field-db"].nodeConfigSnapshots = [
      { id: 1, nodeId: "node-1", config: null },
    ];
    const errors = checkConsistency(backup);
    assert.ok(errors.some((e) => e.includes("config")));
  });

  await test("verifyBackup passes a valid backup", async () => {
    const backup = makeMinimalBackup();
    backup.manifest.checksum = await computeChecksum(
      JSON.stringify({ databases: backup.databases, integrity: backup.integrity }),
    );
    const report = await verifyBackup(backup);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.checksumOk, true);
    assert.equal(report.schemaOk, true);
    assert.equal(report.consistencyOk, true);
    assert.ok(report.durationMs >= 0);
    assert.ok(report.storeCount > 0);
  });

  await test("verifyBackup detects checksum mismatch", async () => {
    const backup = makeMinimalBackup();
    backup.manifest.checksum = "invalid-checksum";
    const report = await verifyBackup(backup);
    assert.equal(report.ok, false);
    assert.equal(report.checksumOk, false);
  });

  await test("verifyBackup detects schema mismatch", async () => {
    const backup = makeMinimalBackup();
    backup.manifest.schemaVersion = 999;
    const report = await verifyBackup(backup);
    assert.equal(report.ok, false);
    assert.equal(report.schemaOk, false);
  });

  await test("computeChecksum produces consistent results", async () => {
    const hash1 = await computeChecksum("hello world");
    const hash2 = await computeChecksum("hello world");
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
  });

  await test("computeChecksum differs for different inputs", async () => {
    const hash1 = await computeChecksum("foo");
    const hash2 = await computeChecksum("bar");
    assert.notEqual(hash1, hash2);
  });
}

// ─── storage.ts tests ─────────────────────────────────────────────────

async function runStorageTests() {
  console.log("\n  storage.ts tests");

  await test("saveMetadata and getMetadataList roundtrip", async () => {
    clearAllMetadata();
    await clearAllDatabases();
    const meta = {
      id: "test-1",
      createdAt: new Date().toISOString(),
      checksum: "abc123",
      recordCount: 42,
      totalSizeBytes: 1000,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      deployChannel: "stable",
    };
    saveMetadata(meta);
    const list = getMetadataList();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "test-1");
    assert.equal(list[0].recordCount, 42);
  });

  await test("removeMetadata removes entry", async () => {
    clearAllMetadata();
    await clearAllDatabases();
    saveMetadata({
      id: "remove-me", createdAt: "", checksum: "", recordCount: 0,
      totalSizeBytes: 0, schemaVersion: 1, deployChannel: "stable",
    });
    removeMetadata("remove-me");
    assert.equal(getMetadataList().length, 0);
  });

  await test("clearAllMetadata clears all entries", async () => {
    saveMetadata({
      id: "a", createdAt: "", checksum: "", recordCount: 0,
      totalSizeBytes: 0, schemaVersion: 1, deployChannel: "stable",
    });
    saveMetadata({
      id: "b", createdAt: "", checksum: "", recordCount: 0,
      totalSizeBytes: 0, schemaVersion: 1, deployChannel: "stable",
    });
    clearAllMetadata();
    assert.equal(getMetadataList().length, 0);
  });

  await test("exportDatabase returns empty for unknown DB", async () => {
    const data = await exportDatabase("nonexistent-db");
    assert.deepEqual(data, {});
  });

  await test("exportDatabase returns stores for lumina-field-db", async () => {
    const data = await exportDatabase("lumina-field-db");
    assert.ok("inspectionRecords" in data);
    assert.ok("nodeConfigSnapshots" in data);
    assert.ok("syncQueue" in data);
    assert.ok("syncMetadata" in data);
    assert.ok("horizonCursors" in data);
  });

  await test("exportDatabase returns stores for lumina-offline-queue", async () => {
    const data = await exportDatabase("lumina-offline-queue");
    assert.ok("outgoing-requests" in data);
  });

  await test("importStore writes and reads records", async () => {
    const records = [
      { id: 1, nodeId: "n1", technicianId: "t1", status: "ok" },
      { id: 2, nodeId: "n2", technicianId: "t2", status: "fail" },
    ];
    const written = await importStore("lumina-field-db", "inspectionRecords", records, true);
    assert.equal(written, 2);

    const exported = await exportDatabase("lumina-field-db");
    assert.equal(exported.inspectionRecords.length, 2);
  });

  await test("countDatabaseRecords returns correct count", async () => {
    await clearAllDatabases();
    const records = [
      { id: 1, nodeId: "n1", technicianId: "t1", status: "ok" },
    ];
    await importStore("lumina-field-db", "inspectionRecords", records, true);
    const count = await countDatabaseRecords("lumina-field-db");
    assert.ok(count >= 1);
  });
}

// ─── restore-test.ts tests ────────────────────────────────────────────

async function runRestoreTestTests() {
  console.log("\n  restore-test.ts tests");

  await test("runRestoreTest passes for valid backup", async () => {
    const backup = makeMinimalBackup();
    backup.databases["lumina-field-db"].inspectionRecords = [
      { id: 1, nodeId: "n1", technicianId: "t1", status: "ok", notes: "", checklist: {}, createdAt: "", updatedAt: "" },
    ];
    backup.manifest.recordCounts["lumina-field-db/inspectionRecords"] = 1;
    backup.manifest.totalSizeBytes = 200;
    backup.manifest.checksum = await computeChecksum(
      JSON.stringify({ databases: backup.databases, integrity: backup.integrity }),
    );
    const report = await runRestoreTest(backup);
    assert.equal(report.ok, true, JSON.stringify(report.error));
    assert.ok(report.storesAttempted > 0);
    assert.equal(report.totalRecordsRestored, 1);
  });

  await test("runRestoreTest fails for corrupted backup", async () => {
    const backup = makeMinimalBackup();
    backup.manifest.checksum = "bad";
    const report = await runRestoreTest(backup);
    assert.equal(report.ok, false);
    assert.ok(report.error);
  });

  await test("restoreBackup dry-run does not write", async () => {
    await clearAllDatabases();
    const backup = makeMinimalBackup();
    backup.databases["lumina-field-db"].inspectionRecords = [
      { id: 1, nodeId: "n1", technicianId: "t1", status: "ok", notes: "", checklist: {}, createdAt: "", updatedAt: "" },
    ];
    backup.manifest.checksum = await computeChecksum(
      JSON.stringify({ databases: backup.databases, integrity: backup.integrity }),
    );
    backup.manifest.recordCounts["lumina-field-db/inspectionRecords"] = 1;
    backup.manifest.totalSizeBytes = 200;

    const report = await restoreBackup(backup, true);
    assert.equal(report.ok, true);
    assert.ok(report.preRestoreSnapshot);

    // Verify no data was actually written
    const exported = await exportDatabase("lumina-field-db");
    assert.equal(exported.inspectionRecords.length, 0);
  });

  await test("restoreBackup actually writes data", async () => {
    await clearAllDatabases();
    const backup = makeMinimalBackup();
    backup.databases["lumina-field-db"].inspectionRecords = [
      { id: 1, nodeId: "n1", technicianId: "t1", status: "ok", notes: "", checklist: {}, createdAt: "", updatedAt: "" },
    ];
    backup.manifest.checksum = await computeChecksum(
      JSON.stringify({ databases: backup.databases, integrity: backup.integrity }),
    );
    backup.manifest.recordCounts["lumina-field-db/inspectionRecords"] = 1;
    backup.manifest.totalSizeBytes = 200;

    const report = await restoreBackup(backup, false);
    assert.equal(report.ok, true);
    assert.equal(report.totalRecordsRestored, 1);

    const exported = await exportDatabase("lumina-field-db");
    assert.equal(exported.inspectionRecords.length, 1);
    assert.equal((exported.inspectionRecords[0] as unknown).nodeId, "n1");
  });

  await test("rollbackRestore restores original state", async () => {
    await clearAllDatabases();
    // First, write some data
    const originalData = [
      { id: 1, nodeId: "original", technicianId: "t1", status: "ok", notes: "", checklist: {}, createdAt: "", updatedAt: "" },
    ];
    await importStore("lumina-field-db", "inspectionRecords", originalData, true);
    const preExport = await exportDatabase("lumina-field-db");
    const preSnapshot = { "lumina-field-db": preExport };

    // Now restore new data
    const backup = makeMinimalBackup();
    backup.databases["lumina-field-db"].inspectionRecords = [
      { id: 1, nodeId: "new-data", technicianId: "t2", status: "ok", notes: "", checklist: {}, createdAt: "", updatedAt: "" },
    ];
    backup.manifest.checksum = await computeChecksum(
      JSON.stringify({ databases: backup.databases, integrity: backup.integrity }),
    );
    backup.manifest.recordCounts["lumina-field-db/inspectionRecords"] = 1;
    backup.manifest.totalSizeBytes = 200;
    await restoreBackup(backup, false);

    // Rollback using pre-restore snapshot
    const rollbackReport = await rollbackRestore(preSnapshot);
    assert.equal(rollbackReport.ok, true);

    const exported = await exportDatabase("lumina-field-db");
    assert.equal(exported.inspectionRecords.length, 1);
    assert.equal((exported.inspectionRecords[0] as unknown).nodeId, "original");
  });
}

// ─── BackupRestoreManager tests ───────────────────────────────────────

function makeSampleBackupFile(checksum: string): BackupFile {
  return {
    manifest: {
      version: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      schemaVersion: BACKUP_SCHEMA_VERSION,
      checksum,
      appVersion: "0.1.0",
      deployChannel: "stable",
      releaseSlot: "blue",
      dbNames: ["lumina-field-db", "lumina-offline-queue"],
      recordCounts: { "lumina-field-db/inspectionRecords": 0 },
      totalSizeBytes: 100,
    },
    databases: {
      "lumina-field-db": {
        inspectionRecords: [],
        nodeConfigSnapshots: [],
        syncQueue: [],
        syncMetadata: [],
        horizonCursors: [],
      },
      "lumina-offline-queue": {
        "outgoing-requests": [],
      },
    },
    integrity: {
      dbChecksums: {},
    },
  };
}

async function runManagerTests() {
  console.log("\n  BackupRestoreManager tests");

  await test("getBackupRestoreManager returns singleton", async () => {
    resetBackupRestoreManagerForTests();
    const a = getBackupRestoreManager();
    const b = getBackupRestoreManager();
    assert.equal(a, b);
  });

  await test("createBackup returns a valid backup file", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    const backup = await manager.createBackup();
    assert.ok(backup !== null, "backup must not be null");
    assert.ok(backup!.manifest.checksum.length === 64);
    assert.equal(backup!.manifest.schemaVersion, BACKUP_SCHEMA_VERSION);
    assert.ok(Array.isArray(backup!.manifest.dbNames));
    assert.ok(backup!.manifest.totalSizeBytes >= 0);
  });

  await test("createBackup records databases in manifest", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    const backup = await manager.createBackup();
    assert.ok(backup!.manifest.dbNames.includes("lumina-field-db"));
    assert.ok(backup!.manifest.dbNames.includes("lumina-offline-queue"));
    assert.ok("lumina-field-db" in backup!.databases);
    assert.ok("lumina-offline-queue" in backup!.databases);
  });

  await test("createBackup adds metadata to index", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    await manager.createBackup();
    const backups = manager.listBackups();
    assert.ok(backups.length >= 1);
    assert.ok(backups[0].checksum.length === 64);
  });

  await test("listBackups returns sorted by date (newest first)", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    await manager.createBackup();
    await new Promise((r) => setTimeout(r, 10));
    await manager.createBackup();
    const list = manager.listBackups();
    assert.ok(list.length >= 2);
    assert.ok(
      new Date(list[0].createdAt).getTime() >= new Date(list[1].createdAt).getTime(),
    );
  });

  await test("deleteBackup removes metadata", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    await manager.createBackup();
    const before = manager.listBackups().length;
    manager.deleteBackup(manager.listBackups()[0].id);
    const after = manager.listBackups().length;
    assert.equal(after, before - 1);
  });

  await test("schedule config roundtrips", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();

    // Default config
    const defaultCfg = manager.getScheduleConfig();
    assert.equal(defaultCfg.enabled, false);
    assert.equal(defaultCfg.frequency, "daily");
    assert.equal(defaultCfg.retentionCount, 7);

    // Update config
    const newCfg: BackupScheduleConfig = {
      enabled: true,
      frequency: "weekly",
      timeOfDay: "03:00",
      dayOfWeek: 1,
      retentionCount: 4,
      autoRestoreTest: true,
    };
    manager.updateScheduleConfig(newCfg);

    const loaded = manager.getScheduleConfig();
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.frequency, "weekly");
    assert.equal(loaded.retentionCount, 4);
    assert.equal(loaded.autoRestoreTest, true);
  });

  await test("subscribe receives backup-created event", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    const events: unknown[] = [];
    const unsub = manager.subscribe((event) => events.push(event));
    await manager.createBackup();
    assert.ok(events.length >= 1);
    assert.equal(events[0].type, "backup-created");
    unsub();
  });

  await test("subscribe receives verify-failed event", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    const events: unknown[] = [];
    const unsub = manager.subscribe((event) => events.push(event));

    const badBackup = makeSampleBackupFile("bad-checksum");
    await manager.verifyBackup(badBackup);
    assert.ok(events.some((e) => e.type === "verify-failed"));
    unsub();
  });

  await test("subscribe can be unsubscribed", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    let count = 0;
    const unsub = manager.subscribe(() => count++);
    unsub();
    await manager.createBackup();
    assert.equal(count, 0);
  });

  await test("restoreBackup with invalid backup returns error", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    const badBackup = makeSampleBackupFile("invalid");
    const report = await manager.restoreBackup(badBackup);
    assert.equal(report.ok, false);
    assert.ok(report.error);
  });

  await test("restoreBackup dry-run returns without writing", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();

    // Create a backup first
    const backup = await manager.createBackup();
    assert.ok(backup);

    // Now dry-run restore it
    const report = await manager.restoreBackup(backup!, true);
    assert.equal(report.ok, true);
  });

  await test("clearAllBackupMetadata clears metadata index", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();
    await manager.createBackup();
    await manager.createBackup();
    manager.clearAllBackupMetadata();
    assert.equal(manager.listBackups().length, 0);
  });

  await test("restoreTestCycle validates and restores", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();

    // Create a backup with some data
    await importStore("lumina-field-db", "inspectionRecords", [
      { id: 1, nodeId: "test", technicianId: "t1", status: "ok", notes: "", checklist: {}, createdAt: "", updatedAt: "" },
    ], true);

    const backup = await manager.createBackup();
    assert.ok(backup);

    // Run the restore test cycle
    const report = await manager.restoreTestCycle(backup!);
    assert.equal(report.ok, true, JSON.stringify(report.error));
  });
}

// ─── Scheduler tests ──────────────────────────────────────────────────

async function runSchedulerTests() {
  console.log("\n  scheduler logic tests");

  await test("enforceRetention limits backup count", async () => {
    resetBackupRestoreManagerForTests();
    const manager = getBackupRestoreManager();

    // Set retention to 2
    manager.updateScheduleConfig({
      enabled: true,
      frequency: "daily",
      retentionCount: 2,
      autoRestoreTest: false,
    });

    // Create 3 backups
    await manager.createBackup();
    await new Promise((r) => setTimeout(r, 5));
    await manager.createBackup();
    await new Promise((r) => setTimeout(r, 5));
    await manager.createBackup();

    // Retention should have removed the oldest
    const list = manager.listBackups();
    assert.ok(list.length <= 2, `Expected ≤2 backups, got ${list.length}`);
  });

  await test("default schedule config is valid", async () => {
    const manager = getBackupRestoreManager();
    const cfg = manager.getScheduleConfig();
    assert.ok(["manual", "hourly", "daily", "weekly"].includes(cfg.frequency));
    assert.ok(cfg.retentionCount > 0);
    assert.equal(typeof cfg.enabled, "boolean");
  });

  await test("updateScheduleConfig persists across manager instances", async () => {
    resetBackupRestoreManagerForTests();
    const m1 = getBackupRestoreManager();
    m1.updateScheduleConfig({
      enabled: true,
      frequency: "weekly",
      retentionCount: 3,
      autoRestoreTest: true,
    });

    // Create new manager (same localStorage)
    resetBackupRestoreManagerForTests();
    const m2 = getBackupRestoreManager();
    const cfg = m2.getScheduleConfig();
    assert.equal(cfg.frequency, "weekly");
    assert.equal(cfg.retentionCount, 3);
  });
}

// ─── Main runner ──────────────────────────────────────────────────────

async function run() {
  console.log("\nBackup & Restore — comprehensive tests\n");

  await runVerifyTests();
  await runStorageTests();
  await runRestoreTestTests();
  await runManagerTests();
  await runSchedulerTests();

  const failed = failures.length;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.error("\nFailed tests:");
    failures.forEach(({ name, error }) => {
      console.error(`  ✗ ${name}`);
      if (error instanceof Error) console.error(`    ${error.stack}`);
    });
    process.exit(1);
  } else {
    console.log("\n✅ All backup and restore tests passed.\n");
  }
}

run();
