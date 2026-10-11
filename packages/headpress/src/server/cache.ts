/**
 * Server-side caching for Headpress reads.
 *
 * `swr()` is a read-through cache that prefers stale data over no data, with three behaviours that
 * matter when WordPress is slow or down:
 *
 * - **Single-flight:** one upstream request per key, however many visitors arrive at once.
 * - **Stale-while-revalidate:** past `ttl` but inside `grace`, the old value is returned at once and
 *   refreshed in the background.
 * - **Stale-if-error:** when the producer fails and a stale entry exists, the stale entry wins.
 *
 * The outcome tells "nothing cached and the upstream failed" (`ok: false`) apart from "the upstream
 * answered with nothing" (`ok: true, value: null`): a storefront shows a placeholder for the first
 * and a 404 for the second.
 *
 * Storage is a `CacheStore`: `memoryCache()` per process, `redisCache(client)` shared across
 * replicas and deploys, or your own.
 */

export interface CacheStore {
  get(key: string): Promise<string | null>;
  /** Store a value for `ttlSeconds`. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Delete every key matching a glob (`wc:product:*`). Optional. */
  deletePattern?(pattern: string): Promise<void>;
}

export interface MemoryCacheOptions {
  /** Entries kept before the oldest is evicted. Defaults to 1 000. */
  maxEntries?: number;
  now?: () => number;
}

function globToRegex(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${source}$`);
}

export function memoryCache(options: MemoryCacheOptions = {}): CacheStore {
  const max = options.maxEntries ?? 1_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: string; expiresAt: number }>();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      // Refresh recency for the LRU order.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      while (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    async delete(key) {
      entries.delete(key);
    },
    async deletePattern(pattern) {
      const regex = globToRegex(pattern);
      for (const key of Array.from(entries.keys())) if (regex.test(key)) entries.delete(key);
    },
  };
}

/** The subset of an ioredis / node-redis v4 client `redisCache()` uses. */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scan?(cursor: string | number, ...args: unknown[]): Promise<[string, string[]] | { cursor: string | number; keys: string[] }>;
}

export interface RedisCacheOptions {
  /** Prefix added to every key (skip it when the client already has a `keyPrefix`). */
  prefix?: string;
  /**
   * The client's own `keyPrefix` (ioredis), when it has one. SCAN does not apply it but DEL does, so
   * `deletePattern()` needs it to find keys and to delete them without prefixing them twice.
   */
  clientKeyPrefix?: string;
}

/**
 * A `CacheStore` on a Redis client you create (ioredis or node-redis). The SDK has no Redis
 * dependency; errors from the client propagate, and `swr()` treats them as misses.
 */
export function redisCache(client: RedisLikeClient, options: RedisCacheOptions = {}): CacheStore {
  const prefix = options.prefix ?? "";
  return {
    get: (key) => client.get(prefix + key),
    async set(key, value, ttlSeconds) {
      await client.set(prefix + key, value, "EX", Math.max(1, Math.ceil(ttlSeconds)));
    },
    async delete(key) {
      await client.del(prefix + key);
    },
    async deletePattern(pattern) {
      if (!client.scan) return;
      const own = options.clientKeyPrefix ?? "";
      let cursor: string | number = "0";
      do {
        const result = await client.scan(cursor, "MATCH", own + prefix + pattern, "COUNT", 200);
        const [next, keys] = Array.isArray(result) ? result : [result.cursor, result.keys];
        // SCAN answers full keys; DEL adds the client prefix again, so strip it first.
        const local = keys.map((key) => (own && key.startsWith(own) ? key.slice(own.length) : key));
        if (local.length) await client.del(...local);
        cursor = next;
      } while (String(cursor) !== "0");
    },
  };
}

export type CacheOutcome<T> = { ok: true; value: T; stale: boolean } | { ok: false; error: unknown };

export interface SwrOptions {
  /** Seconds the entry counts as fresh. */
  ttl: number;
  /** Extra seconds the entry is kept past `ttl`, usable only as a fallback (the outage budget). */
  grace: number;
  /** Clock in milliseconds, for tests. */
  now?: () => number;
}

interface Envelope<T> {
  v: T;
  at: number;
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  return typeof value === "object" && value !== null && "v" in value && Number.isFinite((value as Envelope<T>).at);
}

const flights = ((globalThis as unknown as Record<symbol, Map<string, Promise<unknown>>>)[
  Symbol.for("@meumouse.com/headpress/swr-flights")
] ??= new Map());

function singleFlight<T>(key: string, producer: () => Promise<T>): Promise<T> {
  const existing = flights.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const run = producer().finally(() => flights.delete(key));
  flights.set(key, run);
  return run;
}

async function write<T>(store: CacheStore, key: string, value: T, options: SwrOptions, now: number): Promise<void> {
  try {
    await store.set(key, JSON.stringify({ v: value, at: now } satisfies Envelope<T>), options.ttl + options.grace);
  } catch {
    // A failed write costs the next reader a fetch, nothing more.
  }
}

/** Read-through cache with single-flight, stale-while-revalidate and stale-if-error. Never throws. */
export async function swr<T>(
  store: CacheStore | null | undefined,
  key: string,
  options: SwrOptions,
  producer: () => Promise<T>,
): Promise<CacheOutcome<T>> {
  const now = options.now ?? Date.now;

  if (!store) {
    try {
      return { ok: true, value: await singleFlight(key, producer), stale: false };
    } catch (error) {
      return { ok: false, error };
    }
  }

  let envelope: Envelope<T> | null = null;
  try {
    const raw = await store.get(key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (isEnvelope<T>(parsed)) envelope = parsed;
    }
  } catch {
    // An unreadable cache is a miss.
  }

  const age = envelope ? (now() - envelope.at) / 1000 : Infinity;
  if (envelope && age < options.ttl) return { ok: true, value: envelope.v, stale: false };

  const refresh = (): Promise<T> =>
    singleFlight(key, async () => {
      const value = await producer();
      await write(store, key, value, options, now());
      return value;
    });

  if (envelope && age < options.ttl + options.grace) {
    // Serve the stale copy now; refresh in the background.
    refresh().catch(() => undefined);
    return { ok: true, value: envelope.v, stale: true };
  }

  try {
    return { ok: true, value: await refresh(), stale: false };
  } catch (error) {
    return envelope ? { ok: true, value: envelope.v, stale: true } : { ok: false, error };
  }
}
