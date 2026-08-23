import assert from "node:assert/strict";
import { RedisCache } from "../redisCache";
import { CacheMonitor } from "../cacheMonitor";
import {
  DEFAULT_TTL_CONFIG, // eslint-disable-line @typescript-eslint/no-unused-vars
  getTTLForGroup,
  mergeTTLConfig,
} from "../ttlConfig";

interface FailedTest {
  name: string;
  error: unknown;
}
const failures: FailedTest[] = [];
let passed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(
      `    ${err instanceof Error ? err.message : String(err)}`,
    );
    failures.push({ name, error: err });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log("\nRedisCache — comprehensive tests\n");

  // ── Basic get/set ────────────────────────────────────────────────
  await test("set and get a string value", async () => {
    const cache = new RedisCache();
    cache.set("name", "lumina");
    assert.equal(cache.get("name"), "lumina");
  });

  await test("set and get an object value", async () => {
    const cache = new RedisCache();
    const obj = { id: 1, label: "test", tags: ["a", "b"] };
    cache.set("obj", obj);
    assert.deepEqual(cache.get("obj"), obj);
  });

  await test("get returns null for missing key", async () => {
    const cache = new RedisCache();
    assert.equal(cache.get("nonexistent"), null);
  });

  await test("set returns true on success", async () => {
    const cache = new RedisCache();
    assert.equal(cache.set("x", 1), true);
  });

  // ── TTL ──────────────────────────────────────────────────────────
  await test("ttl returns -2 for missing key", async () => {
    const cache = new RedisCache();
    assert.equal(cache.ttl("missing"), -2);
  });

  await test("ttl returns -1 for key without expiry", async () => {
    const cache = new RedisCache();
    cache.set("persistent", "value");
    assert.equal(cache.ttl("persistent"), -1);
  });

  await test("set with TTL and ttl returns remaining seconds", async () => {
    const cache = new RedisCache();
    cache.set("ephemeral", "value", 5_000);
    const remaining = cache.ttl("ephemeral");
    assert.ok(remaining > 0, `Expected positive TTL, got ${remaining}`);
    assert.ok(remaining <= 5, `Expected ≤5s TTL, got ${remaining}s`);
  });

  await test("get returns null after TTL expires", async () => {
    const cache = new RedisCache();
    cache.set("quick", "gone", 10);
    await sleep(30);
    assert.equal(cache.get("quick"), null);
  });

  // ── del ──────────────────────────────────────────────────────────
  await test("del removes a key and returns true", async () => {
    const cache = new RedisCache();
    cache.set("temp", "value");
    assert.equal(cache.del("temp"), true);
    assert.equal(cache.get("temp"), null);
  });

  await test("del on missing key returns false", async () => {
    const cache = new RedisCache();
    assert.equal(cache.del("missing"), false);
  });

  // ── expire ───────────────────────────────────────────────────────
  await test("expire sets TTL on existing key", async () => {
    const cache = new RedisCache();
    cache.set("mutable", "value");
    assert.equal(cache.ttl("mutable"), -1);
    assert.equal(cache.expire("mutable", 10_000), true);
    const remaining = cache.ttl("mutable");
    assert.ok(remaining > 0 && remaining <= 10);
  });

  await test("expire on missing key returns false", async () => {
    const cache = new RedisCache();
    assert.equal(cache.expire("missing", 10_000), false);
  });

  // ── exists ───────────────────────────────────────────────────────
  await test("exists returns true for existing key", async () => {
    const cache = new RedisCache();
    cache.set("present", 1);
    assert.equal(cache.exists("present"), true);
  });

  await test("exists returns false for missing key", async () => {
    const cache = new RedisCache();
    assert.equal(cache.exists("absent"), false);
  });

  await test("exists returns false for expired key", async () => {
    const cache = new RedisCache();
    cache.set("gone", 1, 10);
    await sleep(30);
    assert.equal(cache.exists("gone"), false);
  });

  // ── keys ─────────────────────────────────────────────────────────
  await test("keys returns all keys without pattern", async () => {
    const cache = new RedisCache();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    const ks = cache.keys().sort();
    assert.deepEqual(ks, ["a", "b", "c"]);
  });

  await test("keys filters by glob pattern", async () => {
    const cache = new RedisCache();
    cache.set("nodes:1", "a");
    cache.set("nodes:2", "b");
    cache.set("alerts:1", "c");
    const ks = cache.keys("nodes:*").sort();
    assert.deepEqual(ks, ["nodes:1", "nodes:2"]);
  });

  await test("keys returns empty array for non-matching pattern", async () => {
    const cache = new RedisCache();
    cache.set("a", 1);
    assert.deepEqual(cache.keys("z:*"), []);
  });

  // ── flushAll ─────────────────────────────────────────────────────
  await test("flushAll clears all keys", async () => {
    const cache = new RedisCache();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.flushAll();
    assert.equal(cache.get("a"), null);
    assert.equal(cache.get("b"), null);
    assert.equal(cache.size, 0);
  });

  // ── flushGroup ───────────────────────────────────────────────────
  await test("flushGroup clears keys with matching prefix", async () => {
    const cache = new RedisCache();
    cache.set("nodes:1", "n1");
    cache.set("nodes:2", "n2");
    cache.set("alerts:1", "a1");
    cache.flushGroup("nodes");
    assert.equal(cache.get("nodes:1"), null);
    assert.equal(cache.get("nodes:2"), null);
    assert.equal(cache.get("alerts:1"), "a1");
  });

  // ── mget / mset ─────────────────────────────────────────────────
  await test("mget returns array of values for multiple keys", async () => {
    const cache = new RedisCache();
    cache.set("k1", "v1");
    cache.set("k2", "v2");
    const results = cache.mget("k1", "k2", "k3");
    assert.equal(results[0], "v1");
    assert.equal(results[1], "v2");
    assert.equal(results[2], null);
  });

  await test("mset sets multiple key-value pairs", async () => {
    const cache = new RedisCache();
    cache.mset({ a: 1, b: 2, c: 3 });
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("b"), 2);
    assert.equal(cache.get("c"), 3);
  });

  await test("mset with TTL applies to all entries", async () => {
    const cache = new RedisCache();
    cache.mset({ x: 10, y: 20 }, 5_000);
    assert.ok(cache.ttl("x") > 0);
    assert.ok(cache.ttl("y") > 0);
  });

  // ── stats ────────────────────────────────────────────────────────
  await test("stats returns correct hit/miss counts", async () => {
    const cache = new RedisCache();
    cache.set("a", 1);
    cache.get("a");
    cache.get("missing");
    cache.get("missing");
    const stats = cache.stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 2);
    assert.equal(stats.keyCount, 1);
  });

  await test("stats hitRate is 0 when no operations", async () => {
    const cache = new RedisCache();
    const stats = cache.stats();
    assert.equal(stats.hitRate, 0);
  });

  await test("stats hitRate is 1 when only hits", async () => {
    const cache = new RedisCache();
    cache.set("a", 1);
    cache.get("a");
    const stats = cache.stats();
    assert.equal(stats.hitRate, 1);
  });

  await test("stats includes memory estimate", async () => {
    const cache = new RedisCache();
    cache.set("data", "x".repeat(100));
    const stats = cache.stats();
    assert.ok(stats.memoryEstimateBytes > 0);
  });

  // ── size ─────────────────────────────────────────────────────────
  await test("size returns correct count", async () => {
    const cache = new RedisCache();
    assert.equal(cache.size, 0);
    cache.set("a", 1);
    assert.equal(cache.size, 1);
    cache.set("b", 2);
    assert.equal(cache.size, 2);
    cache.del("a");
    assert.equal(cache.size, 1);
  });

  // ── createWithGroupTTL ───────────────────────────────────────────
  await test("createWithGroupTTL applies group-level TTL", async () => {
    const cache = RedisCache.createWithGroupTTL("nodes");
    cache.set("nodes:1", "data");
    const remaining = cache.ttl("nodes:1");
    const expectedTtl = getTTLForGroup("nodes") / 1000;
    assert.ok(
      remaining <= expectedTtl && remaining > 0,
      `Expected TTL ~${expectedTtl}s, got ${remaining}s`,
    );
  });

  await test("createWithGroupTTL respects custom TTL override", async () => {
    const cache = RedisCache.createWithGroupTTL("nodes", undefined, 60_000);
    cache.set("nodes:1", "data");
    const remaining = cache.ttl("nodes:1");
    assert.ok(
      remaining <= 60 && remaining > 0,
      `Expected TTL ~60s, got ${remaining}s`,
    );
  });

  // ── TTL config ───────────────────────────────────────────────────
  await test("getTTLForGroup returns correct value for known group", () => {
    assert.equal(getTTLForGroup("nodes"), 10_000);
    assert.equal(getTTLForGroup("alerts"), 60_000);
  });

  await test("getTTLForGroup returns default for unknown group", () => {
    assert.equal(getTTLForGroup("unknown"), 30_000);
  });

  await test("getTTLForGroup respects custom config", () => {
    const custom = { custom: { ttlMs: 5_000, description: "test" } };
    assert.equal(getTTLForGroup("custom", custom), 5_000);
  });

  await test("mergeTTLConfig merges overrides with defaults", () => {
    const merged = mergeTTLConfig({ nodes: { ttlMs: 99_000, description: "override" } });
    assert.equal(merged.nodes.ttlMs, 99_000);
    assert.equal(merged.alerts.ttlMs, 60_000);
    assert.equal(merged.default.ttlMs, 30_000);
  });

  // ── CacheMonitor ─────────────────────────────────────────────────
  await test("CacheMonitor records hits and misses", () => {
    const mon = new CacheMonitor();
    mon.recordHit();
    mon.recordHit();
    mon.recordMiss();
    const s = mon.snapshot(5, 100);
    assert.equal(s.hits, 2);
    assert.equal(s.misses, 1);
    assert.equal(s.hitRate, 2 / 3);
    assert.equal(s.keyCount, 5);
    assert.equal(s.memoryEstimateBytes, 100);
  });

  await test("CacheMonitor snapshot hitRate is 0 when no operations", () => {
    const mon = new CacheMonitor();
    const s = mon.snapshot(0, 0);
    assert.equal(s.hitRate, 0);
  });

  await test("CacheMonitor reset clears counters", () => {
    const mon = new CacheMonitor();
    mon.recordHit();
    mon.recordMiss();
    mon.reset();
    const s = mon.snapshot(0, 0);
    assert.equal(s.hits, 0);
    assert.equal(s.misses, 0);
    assert.equal(s.evictions, 0);
  });

  // ── Edge cases ───────────────────────────────────────────────────
  await test("set with null value stores null", async () => {
    const cache = new RedisCache();
    cache.set("null", null);
    assert.equal(cache.get("null"), null);
  });

  await test("set with undefined value stores undefined", async () => {
    const cache = new RedisCache();
    cache.set("undef", undefined);
    assert.equal(cache.get("undef"), undefined);
  });

  await test("keys returns empty array for empty cache", async () => {
    const cache = new RedisCache();
    assert.deepEqual(cache.keys(), []);
  });

  await test("flattened keys pattern works with multiple wildcards", async () => {
    const cache = new RedisCache();
    cache.set("nodes:1:metrics", "m1");
    cache.set("nodes:2:metrics", "m2");
    cache.set("alerts:1", "a1");
    const ks = cache.keys("nodes:*:metrics").sort();
    assert.deepEqual(ks, ["nodes:1:metrics", "nodes:2:metrics"]);
  });

  // ── Summary ──────────────────────────────────────────────────────
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
    console.log("\n✅ All tests passed.\n");
  }
}

run();
