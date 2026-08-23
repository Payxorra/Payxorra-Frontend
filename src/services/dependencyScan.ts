import {
  ADVISORY_SOURCE_VERSION,
  DEFAULT_ADVISORY_SOURCES,
  PERFORMANCE_BUDGET_MS,
  buildFindings,
  buildReport,
  checkCanaryGate,
  parsePackageJson,
  redactReport,
  type AdvisorySource,
  type CanaryGateResult,
  type DeploymentChannel,
  type PackageSource,
  type ParsedDependency,
  type ScanReport,
} from "../lib/vulnerability";

export type ScanListener = (report: ScanReport) => void;

export interface DependencyScanOptions {
  packageSources?: PackageSource[];
  advisorySources?: AdvisorySource[];
  channel?: DeploymentChannel;
  now?: () => number;
  clock?: () => number;
  historyLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 50;

export function createDefaultPackageSources(): PackageSource[] {
  const cache: { deps?: ParsedDependency[] } = {};

  return [
    {
      name: "app",
      parse: () => {
        if (cache.deps) return { dependencies: cache.deps };
        try {
           
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pkg = require("../../package.json");
          cache.deps = parsePackageJson(pkg);
          return { dependencies: cache.deps };
        } catch {
          return { dependencies: [] };
        }
      },
    },
  ];
}

export class DependencyScanner {
  private packageSources: Map<string, PackageSource>;
  private advisorySources: Map<string, AdvisorySource>;
  private listeners = new Set<ScanListener>();
  private history: ScanReport[] = [];
  private channel: DeploymentChannel;
  private now: () => number;
  private clock: () => number;
  private historyLimit: number;
  private lastReport: ScanReport | null = null;

  constructor(options: DependencyScanOptions = {}) {
    this.packageSources = new Map(
      (options.packageSources ?? createDefaultPackageSources()).map((s) => [
        s.name,
        s,
      ]),
    );
    this.advisorySources = new Map(
      (options.advisorySources ?? DEFAULT_ADVISORY_SOURCES).map((s) => [
        s.name,
        s,
      ]),
    );
    this.channel = options.channel ?? "stable";
    this.now = options.now ?? (() => Date.now());
    this.clock =
      options.clock ??
      (() =>
        typeof performance !== "undefined" ? performance.now() : Date.now());
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  registerPackageSource(source: PackageSource): void {
    this.packageSources.set(source.name, source);
  }

  unregisterPackageSource(name: string): void {
    this.packageSources.delete(name);
  }

  setChannel(channel: DeploymentChannel): void {
    this.channel = channel;
  }

  subscribe(listener: ScanListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHistory(): ScanReport[] {
    return [...this.history];
  }

  getLastReport(): ScanReport | null {
    return this.lastReport;
  }

  /**
   * Scan a single registered package source. Critical path — must stay <100ms.
   */
  async scanSource(sourceName: string): Promise<ScanReport> {
    const started = this.clock();
    const source = this.packageSources.get(sourceName);

    if (!source) {
      const durationMs = this.clock() - started;
      const report: ScanReport = {
        ok: false,
        findings: [],
        metrics: {
          durationMs,
          withinBudget: durationMs < PERFORMANCE_BUDGET_MS,
          findingCount: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          totalDependencies: 0,
          scannedAt: this.now(),
        },
        channel: this.channel,
        source: sourceName,
        advisorySourceVersion: ADVISORY_SOURCE_VERSION,
      };
      this.record(report);
      return report;
    }

    let deps: ParsedDependency[];
    try {
      const parsed = source.parse();
      deps = parsed.dependencies;
    } catch (error) { // eslint-disable-line @typescript-eslint/no-unused-vars
      const durationMs = this.clock() - started;
      const report: ScanReport = {
        ok: false,
        findings: [],
        metrics: {
          durationMs,
          withinBudget: durationMs < PERFORMANCE_BUDGET_MS,
          findingCount: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          totalDependencies: 0,
          scannedAt: this.now(),
        },
        channel: this.channel,
        source: sourceName,
        advisorySourceVersion: ADVISORY_SOURCE_VERSION,
      };
      this.record(report);
      return report;
    }

    const allAdvisories = [];
    for (const advSource of this.advisorySources.values()) {
      try {
        const advisories = await advSource.fetch(deps);
        allAdvisories.push(...advisories);
      } catch (error) {
        console.warn(
          `Advisory source "${advSource.name}" failed:`,
          error,
        );
      }
    }

    const findings = buildFindings(deps, allAdvisories);
    const durationMs = this.clock() - started;
    const report = redactReport(
      buildReport(sourceName, findings, deps.length, durationMs, this.channel),
    );
    this.record(report);
    return report;
  }

  /**
   * Scan all registered package sources.
   */
  async scanAll(): Promise<ScanReport> {
    const started = this.clock();
    const sources = [...this.packageSources.keys()];

    const results = await Promise.all(
      sources.map((name) => this.scanSource(name)),
    );

    const allFindings = results.flatMap((r) => r.findings);
    const totalDeps = results.reduce(
      (sum, r) => sum + r.metrics.totalDependencies,
      0,
    );
    const durationMs = this.clock() - started;
    const report = redactReport(
      buildReport("*", allFindings, totalDeps, durationMs, this.channel),
    );
    this.lastReport = report;
    this.record(report);
    return report;
  }

  checkCanaryGate(): CanaryGateResult {
    return checkCanaryGate(this.history, this.channel);
  }

  private record(report: ScanReport): void {
    this.history.push(report);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
    for (const listener of this.listeners) {
      listener(report);
    }
  }
}

let sharedScanner: DependencyScanner | null = null;

export function getDependencyScanner(): DependencyScanner {
  if (!sharedScanner) {
    sharedScanner = new DependencyScanner();
  }
  return sharedScanner;
}

export function resetDependencyScannerForTests(): void {
  sharedScanner = null;
}
