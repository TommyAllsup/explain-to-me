import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertNoLinkedPath, assertSupportedFilePath, ensurePrivateDirectory, openRegularFile } from "./file-safety.js";

const KEY_SCHEMA_VERSION = "1";
const CACHE_FILE_MAGIC = Buffer.from("ETMCACHE", "ascii");
const CACHE_FILE_VERSION = 2;
const DIGEST_SIZE = 32;
const KEY_SIZE = 32;
const HEADER_SIZE = CACHE_FILE_MAGIC.length + 1 + KEY_SIZE + DIGEST_SIZE;
const KEY_PATTERN = /^[a-f0-9]{64}$/;

export interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
  corruptions: number;
}

export class ContentAddressedCache {
  private readonly root: string;
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private readonly stats: CacheStats = { hits: 0, misses: 0, writes: 0, corruptions: 0 };

  constructor(root: string) {
    assertSupportedFilePath(root);
    this.root = resolve(root);
  }

  key(namespace: string, input: unknown): string {
    if (typeof namespace !== "string") throw new TypeError("Cache namespace must be a string");

    const canonicalInput = canonicalJson(input);
    return createHash("sha256")
      .update("content-addressed-cache\0")
      .update(KEY_SCHEMA_VERSION)
      .update("\0")
      .update(JSON.stringify(namespace))
      .update("\0")
      .update(canonicalInput)
      .digest("hex");
  }

  async read(key: string): Promise<Buffer | null> {
    const entryPath = this.entryPath(key);
    let handle: FileHandle;
    try {
      handle = await openRegularFile(entryPath, this.root);
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT") {
        this.stats.misses += 1;
        return null;
      }
      if (code === "ELOOP" || code === "EISDIR" || code === "EUNSAFEFILE") return this.recordCorruption();
      throw error;
    }

    try {
      const fileStats = await handle.stat();
      if (!fileStats.isFile()) return this.recordCorruption();

      const stored = await handle.readFile();
      if (stored.length < HEADER_SIZE
        || !stored.subarray(0, CACHE_FILE_MAGIC.length).equals(CACHE_FILE_MAGIC)
        || stored[CACHE_FILE_MAGIC.length] !== CACHE_FILE_VERSION) {
        return this.recordCorruption();
      }

      const storedKey = stored.subarray(CACHE_FILE_MAGIC.length + 1, CACHE_FILE_MAGIC.length + 1 + KEY_SIZE);
      if (!timingSafeEqual(storedKey, Buffer.from(key, "hex"))) return this.recordCorruption();
      const expectedDigest = stored.subarray(CACHE_FILE_MAGIC.length + 1 + KEY_SIZE, HEADER_SIZE);
      const value = stored.subarray(HEADER_SIZE);
      const actualDigest = createHash("sha256").update(value).digest();
      if (!timingSafeEqual(expectedDigest, actualDigest)) return this.recordCorruption();

      this.stats.hits += 1;
      return Buffer.from(value);
    } finally {
      await handle.close();
    }
  }

  async write(key: string, value: Buffer): Promise<void> {
    const entryPath = this.entryPath(key);
    if (!Buffer.isBuffer(value)) throw new TypeError("Cache values must be Buffers");

    try {
      await assertNoLinkedPath(this.root, false);
      // A corrupt linked entry is never read. Remove only the owned link so a
      // replacement can be published without applying ACL inheritance to it.
      if ((await lstat(entryPath)).isSymbolicLink()) await unlink(entryPath);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    await ensurePrivateDirectory(this.root);

    const stored = Buffer.allocUnsafe(HEADER_SIZE + value.length);
    CACHE_FILE_MAGIC.copy(stored, 0);
    stored[CACHE_FILE_MAGIC.length] = CACHE_FILE_VERSION;
    Buffer.from(key, "hex").copy(stored, CACHE_FILE_MAGIC.length + 1);
    value.copy(stored, HEADER_SIZE);
    createHash("sha256").update(stored.subarray(HEADER_SIZE)).digest()
      .copy(stored, CACHE_FILE_MAGIC.length + 1 + KEY_SIZE);

    const temporaryPath = join(this.root, `.cache-${randomBytes(16).toString("hex")}.tmp`);
    let handle: FileHandle | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(stored);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await assertNoLinkedPath(this.root, false);
      await rename(temporaryPath, entryPath);
      this.stats.writes += 1;
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  getOrCreate(key: string, factory: () => Promise<Buffer>): Promise<Buffer> {
    this.entryPath(key);
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const created = this.loadOrCreate(key, factory);
    this.inFlight.set(key, created);
    const clearPending = () => {
      if (this.inFlight.get(key) === created) this.inFlight.delete(key);
    };
    created.then(clearPending, clearPending);
    return created;
  }

  snapshotStats(): CacheStats {
    return { ...this.stats };
  }

  private async loadOrCreate(key: string, factory: () => Promise<Buffer>): Promise<Buffer> {
    const cached = await this.read(key);
    if (cached !== null) return cached;

    const created = await factory();
    if (!Buffer.isBuffer(created)) throw new TypeError("Cache factory must return a Buffer");
    await this.write(key, created);
    return created;
  }

  private entryPath(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new TypeError("Cache key must be a 64-character lowercase hexadecimal SHA-256 digest");
    return join(this.root, `${key}.cache`);
  }

  private recordCorruption(): null {
    this.stats.misses += 1;
    this.stats.corruptions += 1;
    return null;
  }
}

function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();

  const encode = (item: unknown): string => {
    if (item === null) return "null";
    switch (typeof item) {
      case "string":
      case "boolean":
        return JSON.stringify(item);
      case "number":
        if (!Number.isFinite(item)) throw new TypeError("Cache key input numbers must be finite");
        return JSON.stringify(item);
      case "object": {
        if (ancestors.has(item)) throw new TypeError("Cache key input cannot contain cycles");
        ancestors.add(item);
        try {
          if (Array.isArray(item)) return encodeArray(item, encode);
          return encodeObject(item, encode);
        } finally {
          ancestors.delete(item);
        }
      }
      default:
        throw new TypeError(`Unsupported cache key input type: ${typeof item}`);
    }
  };

  return encode(value);
}

function encodeArray(value: unknown[], encode: (item: unknown) => string): string {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new TypeError("Cache key arrays cannot have symbol properties");
    if (key === "length") continue;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw new TypeError("Cache key arrays cannot have extra properties");
    }
  }

  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("Cache key arrays must be dense and contain only data properties");
    }
    items.push(encode(descriptor.value));
  }
  return `[${items.join(",")}]`;
}

function encodeObject(value: object, encode: (item: unknown) => string): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Cache key objects must be plain JSON objects");
  }

  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new TypeError("Cache key objects cannot have symbol properties");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("Cache key objects must contain only enumerable data properties");
    }
    keys.push(key);
  }

  keys.sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(Object.getOwnPropertyDescriptor(value, key)!.value)}`).join(",")}}`;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
