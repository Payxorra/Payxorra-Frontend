"use client";

import { useBackupRestore } from "@/src/hooks/useBackupRestore";

export function BackupDashboard() {
  const {
    backups,
    lastBackup,
    lastEvent,
    isCreating,
    isRestoring,
    scheduleConfig,
    createBackup,
    downloadBackup,
    uploadAndRestore,
    updateSchedule,
    deleteBackup,
    refreshBackups,
  } = useBackupRestore();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAndRestore(file);
    e.target.value = "";
  };

  const handleScheduleToggle = () => {
    updateSchedule({
      ...scheduleConfig,
      enabled: !scheduleConfig.enabled,
    });
  };

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-100">
            Database Backup & Restore
          </h2>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            scheduleConfig.enabled
              ? "bg-emerald-900/50 text-emerald-400"
              : "bg-neutral-800 text-neutral-400"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              scheduleConfig.enabled ? "bg-emerald-400" : "bg-neutral-500"
            }`} />
            {scheduleConfig.enabled ? "Scheduled" : "Manual Only"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-neutral-500">Backups</span>
            <p className="mt-0.5 font-mono text-neutral-200">{backups.length}</p>
          </div>
          <div>
            <span className="text-neutral-500">Last Backup</span>
            <p className="mt-0.5 font-mono text-neutral-200">
              {lastBackup
                ? new Date(lastBackup.createdAt).toLocaleString()
                : "Never"}
            </p>
          </div>
          <div>
            <span className="text-neutral-500">Last Event</span>
            <p className="mt-0.5 font-mono text-neutral-200">
              {lastEvent
                ? `${lastEvent.type.replace("-", " ")} ${lastEvent.durationMs ? `(${lastEvent.durationMs}ms)` : ""}`
                : "None"}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => downloadBackup()}
          disabled={isCreating}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isCreating ? "Creating..." : "Download Backup"}
        </button>

        <button
          onClick={() => createBackup()}
          disabled={isCreating}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-600 disabled:opacity-50"
        >
          {isCreating ? "Creating..." : "Create Backup"}
        </button>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-600">
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="hidden"
            disabled={isRestoring}
          />
          {isRestoring ? "Restoring..." : "Restore Backup"}
        </label>
      </div>

      {/* Schedule Controls */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-200">
            Backup Schedule
          </h3>
          <button
            onClick={handleScheduleToggle}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              scheduleConfig.enabled ? "bg-emerald-600" : "bg-neutral-700"
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              scheduleConfig.enabled ? "translate-x-4.5" : "translate-x-1"
            }`} />
          </button>
        </div>

        {scheduleConfig.enabled && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-neutral-500">Frequency</label>
              <select
                value={scheduleConfig.frequency}
                onChange={(e) =>
                  updateSchedule({
                    ...scheduleConfig,
                    frequency: e.target.value as unknown,
                  })
                }
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200"
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Time</label>
              <input
                type="time"
                value={scheduleConfig.timeOfDay ?? "02:00"}
                onChange={(e) =>
                  updateSchedule({
                    ...scheduleConfig,
                    timeOfDay: e.target.value,
                  })
                }
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Keep</label>
              <input
                type="number"
                min={1}
                value={scheduleConfig.retentionCount}
                onChange={(e) =>
                  updateSchedule({
                    ...scheduleConfig,
                    retentionCount: parseInt(e.target.value) || 7,
                  })
                }
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200"
              />
            </div>
          </div>
        )}
      </div>

      {/* Backup History */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-200">
            Backup History
          </h3>
          <button
            onClick={() => refreshBackups()}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            Refresh
          </button>
        </div>

        {backups.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No backups yet. Create your first backup above.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-neutral-500">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Records</th>
                  <th className="pb-2 pr-4 font-medium">Size</th>
                  <th className="pb-2 pr-4 font-medium">Channel</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-neutral-800/50 text-neutral-300"
                  >
                    <td className="py-2 pr-4 font-mono text-xs">
                      {new Date(b.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {b.recordCount.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {formatBytes(b.totalSizeBytes)}
                    </td>
                    <td className="py-2 pr-4 text-xs">{b.deployChannel}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => deleteBackup(b.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
