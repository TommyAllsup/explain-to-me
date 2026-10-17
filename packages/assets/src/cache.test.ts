import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ContentAddressedCache } from "./cache.js";

const scratchDirectory = process.env.TMPDIR ?? join(process.cwd(), ".cache", "tests");

async function withCacheRoot(run: (root: string) => Promise<void>): Promise<void> {
  await mkdir(scratchDirectory, { recursive: true });
  const root = await mkdtemp(join(scratchDirectory, "assets-cache-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("cache keys sort object properties and reject non-JSON values", () => {
  const cache = new ContentAddressedCache("unused");
  assert.equal(
    cache.key("audio", { z: [1, { b: true, a: null }], a: "voice" }),
    cache.key("audio", { a: "voice", z: [1, { a: null, b: true }] }),
  );
  assert.notEqual(cache.key("audio", [1, 2]), cache.key("audio", [2, 1]));
  assert.notEqual(cache.key("audio", "same"), cache.key("video", "same"));
  assert.throws(() => cache.key("audio", { omitted: undefined }), /Unsupported cache key input type/);
  assert.throws(() => cache.key("audio", Number.POSITIVE_INFINITY), /must be finite/);

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => cache.key("audio", cyclic), /cannot contain cycles/);
});

test("corrupt cache entries are misses and increment corruption stats", async () => {
  await withCacheRoot(async (root) => {
    const cache = new ContentAddressedCache(root);
    const key = cache.key("audio", { text: "hello" });
    await cache.write(key, Buffer.from("original"));

    const entryPath = join(root, `${key}.cache`);
    const stored = await readFile(entryPath);
    stored[stored.length - 1] = stored[stored.length - 1]! ^ 0xff;
    await writeFile(entryPath, stored);

    assert.equal(await cache.read(key), null);
    assert.deepEqual(cache.snapshotStats(), { hits: 0, misses: 1, writes: 1, corruptions: 1 });
  });
});

test("cache entries copied under a different request key are rejected", async () => {
  await withCacheRoot(async (root) => {
    const cache = new ContentAddressedCache(root);
    const first = cache.key("audio", { text: "first" });
    const second = cache.key("audio", { text: "second" });
    await cache.write(first, Buffer.from("first audio"));
    await writeFile(join(root, `${second}.cache`), await readFile(join(root, `${first}.cache`)));
    assert.equal(await cache.read(second), null);
    assert.equal(cache.snapshotStats().corruptions, 1);
  });
});

test("directory entries are corruption misses", async () => {
  await withCacheRoot(async (root) => {
    const cache = new ContentAddressedCache(root);
    const key = cache.key("unsafe", "directory");
    await mkdir(join(root, `${key}.cache`));
    assert.equal(await cache.read(key), null);
    assert.equal(cache.snapshotStats().corruptions, 1);
  });
});

test("linked entries are corruption misses and replacements preserve the target", async (t) => {
  await withCacheRoot(async (root) => {
    const cache = new ContentAddressedCache(root);
    const key = cache.key("unsafe", "symlink");
    const target = join(root, "keep.txt");
    await writeFile(target, "preserve target");
    try {
      await symlink(target, join(root, `${key}.cache`), "file");
    } catch (error) {
      if (process.platform === "win32" && error && typeof error === "object" && "code" in error && error.code === "EPERM") {
        t.skip("File symlinks require Developer Mode or symlink privilege; junction root coverage remains enabled");
        return;
      }
      throw error;
    }
    assert.equal(await cache.read(key), null);
    assert.equal(cache.snapshotStats().corruptions, 1);
    await cache.write(key, Buffer.from("replacement"));
    assert.deepEqual(await cache.read(key), Buffer.from("replacement"));
    assert.equal(await readFile(target, "utf8"), "preserve target");
  });
});

test("concurrent getOrCreate calls share one factory and later reuse the cache", async () => {
  await withCacheRoot(async (root) => {
    const cache = new ContentAddressedCache(root);
    const key = cache.key("audio", { text: "hello" });
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Buffer.from("audio bytes");
    };

    const results = await Promise.all(Array.from({ length: 8 }, () => cache.getOrCreate(key, factory)));
    assert.equal(factoryCalls, 1);
    assert.ok(results.every((result) => result.equals(Buffer.from("audio bytes"))));
    assert.deepEqual(cache.snapshotStats(), { hits: 0, misses: 1, writes: 1, corruptions: 0 });

    assert.deepEqual(await cache.getOrCreate(key, factory), Buffer.from("audio bytes"));
    assert.equal(factoryCalls, 1);
    assert.deepEqual(cache.snapshotStats(), { hits: 1, misses: 1, writes: 1, corruptions: 0 });
  });
});
