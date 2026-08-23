import type { BackupScheduleConfig, BackupFrequency } from "./types"; // eslint-disable-line @typescript-eslint/no-unused-vars

type SchedulerCallback = () => Promise<void>;

let activeTimer: ReturnType<typeof setInterval> | null = null;
let currentCallback: SchedulerCallback | null = null;
let lastRunAt: number | null = null;

/**
 * Returns the interval in milliseconds for a given frequency.
 */
export function getIntervalMs(config: BackupScheduleConfig): number {
  switch (config.frequency) {
    case "hourly":
      return 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    case "manual":
    default:
      return 0;
  }
}

/**
 * Checks whether the schedule should fire based on time-of-day and day-of-week constraints.
 */
export function shouldRunNow(config: BackupScheduleConfig, now?: Date): boolean {
  const d = now ?? new Date();

  // Weekly: check day of week (0=Sun, 6=Sat)
  if (config.frequency === "weekly" && config.dayOfWeek != null) {
    if (d.getDay() !== config.dayOfWeek) return false;
  }

  // Hourly/daily/weekly: check time of day
  if (
    config.frequency !== "hourly" &&
    config.timeOfDay
  ) {
    const [hours, minutes] = config.timeOfDay.split(":").map(Number);
    if (d.getHours() !== hours || d.getMinutes() !== minutes) return false;
  }

  return true;
}

/**
 * Registers a scheduled backup callback. If a schedule was already active,
 * it is unregistered first.
 *
 * The scheduler uses `setInterval` with the configured frequency and also
 * checks time-of-day / day-of-week constraints.
 */
export function registerSchedule(
  config: BackupScheduleConfig,
  callback: SchedulerCallback,
): void {
  unregisterSchedule();

  if (!config.enabled || config.frequency === "manual") return;

  currentCallback = callback;
  const intervalMs = getIntervalMs(config);

  if (intervalMs <= 0) return;

  // On registration, check if we should run immediately
  if (shouldRunNow(config)) {
    callback().catch(() => {
      // Silently handle — errors flow through the event system
    });
  }

  // Check once per minute for time-of-day constraints
  const CHECK_INTERVAL = 60 * 1000;
  activeTimer = setInterval(async () => {
    if (!currentCallback) return;

    const shouldRun = shouldRunNow(config);
    if (!shouldRun) return;

    // Guard against running twice in the same minute
    const now = Date.now();
    if (lastRunAt && now - lastRunAt < intervalMs * 0.5) return;

    lastRunAt = now;
    try {
      await currentCallback();
    } catch {
      // Errors handled by caller
    }
  }, CHECK_INTERVAL);
}

/**
 * Unregisters the active schedule timer.
 */
export function unregisterSchedule(): void {
  if (activeTimer !== null) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
  currentCallback = null;
  lastRunAt = null;
}

/**
 * Returns whether a schedule is currently active.
 */
export function isScheduleActive(): boolean {
  return activeTimer !== null;
}

/**
 * Returns the last run timestamp, or null if never run.
 */
export function getLastRunAt(): number | null {
  return lastRunAt;
}
