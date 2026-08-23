import assert from "node:assert/strict";
import {
  DependencyScanner,
  resetDependencyScannerForTests,
  type ScanReport,
} from "../dependencyScan";
import type {
  Advisory,
  AdvisorySource,
  PackageSource,
  ParsedDependency,
} from "../../lib/vulnerability";

let failures = 0;

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`\u2713 ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`\u2717 ${name}`);
    console.error(error);
  }
}

function makeMockSource(name: string, deps: ParsedDependency[]): PackageSource {
  return {
    name,
    parse: () => ({ dependencies: deps }),
  };
}

function makeMockAdvisorySource(
  name: string,
  advisories: Advisory[],
  shouldThrow = false,
): AdvisorySource {
  return {
    name,
    fetch: async () => {
      if (shouldThrow) throw new Error("advisory source error");
      return advisories;
    },
  };
}

run("DependencyScanner scanSource returns ok with no findings", async () => {
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("test", [
        { name: "react", version: "19.0.0", type: "dependencies" },
      ]),
    ],
    advisorySources: [makeMockAdvisorySource("mock", [])],
    now: () => 1_000,
  });
  const report = await scanner.scanSource("test");
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 0);
  assert.equal(report.metrics.withinBudget, true);
  assert.equal(report.source, "test");
});

run("DependencyScanner scanSource detects vulnerabilities", async () => {
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("test", [
        { name: "react", version: "19.0.0", type: "dependencies" },
      ]),
    ],
    advisorySources: [
      makeMockAdvisorySource("mock", [
        {
          id: "CVE-2024-0001",
          packageName: "react",
          vulnerableVersions: "<19.0.1",
          severity: "critical",
          title: "React vuln",
          source: "mock",
        },
      ]),
    ],
    now: () => 2_000,
  });
  const report = await scanner.scanSource("test");
  assert.equal(report.ok, false);
  assert.equal(report.metrics.criticalCount, 1);
  assert.equal(report.metrics.findingCount, 1);
  assert.equal(report.findings[0].advisory.id, "CVE-2024-0001");
});

run("DependencyScanner scanSource handles missing source", async () => {
  const scanner = new DependencyScanner({
    packageSources: [],
    now: () => 3_000,
  });
  const report = await scanner.scanSource("nonexistent");
  assert.equal(report.ok, false);
  assert.equal(report.metrics.findingCount, 0);
  assert.equal(report.source, "nonexistent");
});

run("DependencyScanner scanAll aggregates across sources", async () => {
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("src-a", [
        { name: "react", version: "19.0.0", type: "dependencies" },
      ]),
      makeMockSource("src-b", [
        { name: "lodash", version: "4.17.21", type: "dependencies" },
      ]),
    ],
    advisorySources: [
      makeMockAdvisorySource("mock", [
        {
          id: "CVE-2024-0001",
          packageName: "react",
          vulnerableVersions: "<19.0.1",
          severity: "critical",
          title: "React vuln",
          source: "mock",
        },
        {
          id: "CVE-2024-0002",
          packageName: "lodash",
          vulnerableVersions: "<4.17.22",
          severity: "high",
          title: "Lodash vuln",
          source: "mock",
        },
      ]),
    ],
    now: () => 4_000,
  });
  const report = await scanner.scanAll();
  assert.equal(report.source, "*");
  assert.equal(report.metrics.findingCount, 2);
  assert.equal(report.metrics.criticalCount, 1);
  assert.equal(report.metrics.highCount, 1);
});

run("DependencyScanner scanAll reports empty when no findings", async () => {
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("clean", [
        { name: "safe-pkg", version: "1.0.0", type: "dependencies" },
      ]),
    ],
    advisorySources: [makeMockAdvisorySource("mock", [])],
    now: () => 5_000,
  });
  const report = await scanner.scanAll();
  assert.equal(report.ok, true);
  assert.equal(report.metrics.findingCount, 0);
});

run("DependencyScanner subscribes and notifies listeners", async () => {
  let seen: ScanReport | null = null;
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("sub-test", [
        { name: "pkg", version: "1.0.0", type: "dependencies" },
      ]),
    ],
    advisorySources: [
      makeMockAdvisorySource("mock", [
        {
          id: "CVE-1",
          packageName: "pkg",
          vulnerableVersions: "<2",
          severity: "high",
          title: "Pkg vuln",
          source: "mock",
        },
      ]),
    ],
    now: () => 6_000,
  });
  scanner.subscribe((report) => {
    seen = report;
  });
  await scanner.scanSource("sub-test");
  assert.ok(seen);
  assert.equal(seen!.source, "sub-test");
  assert.equal(seen!.metrics.findingCount, 1);
});

run("DependencyScanner history is bounded", async () => {
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("h-test", [
        { name: "pkg", version: "1.0.0", type: "dependencies" },
      ]),
    ],
    advisorySources: [makeMockAdvisorySource("mock", [])],
    now: () => 7_000,
    historyLimit: 3,
  });

  for (let i = 0; i < 5; i++) {
    await scanner.scanSource("h-test");
  }
  assert.equal(scanner.getHistory().length, 3);
});

run("DependencyScanner handles advisory source failures gracefully", async () => {
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("f-test", [
        { name: "pkg", version: "1.0.0", type: "dependencies" },
      ]),
    ],
    advisorySources: [makeMockAdvisorySource("failing", [], true)],
    now: () => 8_000,
  });
  const report = await scanner.scanSource("f-test");
  // Should still succeed with no findings since advisory source failed
  assert.equal(report.ok, true);
  assert.equal(report.metrics.findingCount, 0);
});

run("DependencyScanner canary gate analysis works", async () => {
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("c-test", [
        { name: "pkg", version: "1.0.0", type: "dependencies" },
      ]),
    ],
    advisorySources: [makeMockAdvisorySource("mock", [])],
    channel: "canary",
    now: () => 9_000,
  });

  // Not enough samples yet
  const early = scanner.checkCanaryGate();
  assert.equal(early.promote, false);
  assert.match(early.reason, /Insufficient samples/);
});

run("DependencyScanner supports unregisterPackageSource", () => {
  const scanner = new DependencyScanner({
    packageSources: [
      makeMockSource("temp", [
        { name: "pkg", version: "1.0.0", type: "dependencies" },
      ]),
    ],
    advisorySources: [makeMockAdvisorySource("mock", [])],
  });
  scanner.unregisterPackageSource("temp");
  assert.equal(scanner.getHistory().length, 0);
});

run("resetDependencyScannerForTests clears singleton", () => {
  resetDependencyScannerForTests();
  const scanner = getDependencyScanner();
  assert.ok(scanner instanceof DependencyScanner);
  resetDependencyScannerForTests();
  const scanner2 = getDependencyScanner();
  assert.notEqual(scanner, scanner2);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll dependency scanner service tests passed");

function getDependencyScanner() {
  const { getDependencyScanner: getter } = await import("../dependencyScan");
  return getter();
}
