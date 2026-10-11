/**
 * The store config (`GET /store/config`), loaded once and kept fresh.
 *
 * - Fresh for `ttlMs` (5 minutes); after that the next `get()` revalidates with `If-None-Match`,
 *   and a 304 keeps the copy without downloading it again.
 * - Concurrent `get()` calls share one request.
 * - When Headpress cannot be reached, a stale copy keeps being served for up to `maxStaleMs`
 *   (24 hours), with a warning: the storefront shell depends on it. Past that, the error surfaces —
 *   showing day-old payment or shipping rules as current is worse than showing an error.
 * - `hydrate()` seeds it from server-rendered data, so the browser does not fetch it again.
 */
import { HeadpressError, SdkErrorCode } from "./errors.js";
import type { Transport, RequestOptions } from "./transport.js";
import type { StoreConfig } from "./types.js";

/** The `schema_version` this SDK understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Oldest Headpress this SDK works with. Split and shipping quotes and price previews need 1.3. */
export const MIN_HEADPRESS_VERSION = "1.2.0";

/** -1, 0 or 1, comparing dotted numeric versions (`1.10.0` > `1.9.2`). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = a.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length, 3); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export interface HeadpressWarning {
  code: "config_schema_version" | "config_stale" | "headpress_version" | (string & {});
  message: string;
  data?: unknown;
}

export interface ConfigOptions {
  /** Milliseconds a loaded config counts as fresh. Defaults to 300 000. */
  ttlMs?: number;
  /** Milliseconds a stale config may still be served while Headpress is unreachable. Defaults to 86 400 000. */
  maxStaleMs?: number;
  /** A config rendered on the server, to start from. */
  initial?: StoreConfig;
  /** Extra `fetch` options for the config request (Next.js cache tags, say). */
  fetchOptions?: RequestOptions["fetchOptions"];
}

export interface ConfigGetOptions {
  /** Revalidate even when the copy is fresh. */
  force?: boolean;
  signal?: AbortSignal;
}

export interface ConfigStore {
  get(options?: ConfigGetOptions): Promise<StoreConfig>;
  /** The loaded config, without fetching. Null before the first load. */
  peek(): StoreConfig | null;
  /** Seed the store, e.g. with the config the server rendered the page with. */
  hydrate(config: StoreConfig, etag?: string | null): void;
  /** Mark the copy stale so the next `get()` revalidates (the revalidation webhook calls this). */
  invalidate(): void;
  subscribe(listener: (config: StoreConfig) => void): () => void;
  readonly etag: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Enough of a store config to trust it over a cached one. */
export function isStoreConfig(value: unknown): value is StoreConfig {
  return isRecord(value) && isRecord(value.modules) && isRecord(value.store) && isRecord(value.routes);
}

export function createConfigStore(
  transport: Transport,
  options: ConfigOptions & { onWarning?: (warning: HeadpressWarning) => void; now?: () => number } = {},
): ConfigStore {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 300_000;
  const maxStale = options.maxStaleMs ?? 86_400_000;
  const warn = options.onWarning ?? (() => undefined);

  let config: StoreConfig | null = null;
  let etag: string | null = null;
  let loadedAt = 0;
  let inflight: Promise<StoreConfig> | null = null;
  let warnedVersion = false;
  const listeners = new Set<(config: StoreConfig) => void>();

  const accept = (next: StoreConfig, nextEtag: string | null): void => {
    if (next.schema_version !== SUPPORTED_SCHEMA_VERSION && !warnedVersion) {
      warnedVersion = true;
      warn({
        code: "config_schema_version",
        message: `Headpress sent store config schema_version ${next.schema_version}; this SDK understands ${SUPPORTED_SCHEMA_VERSION}. Update @meumouse.com/headpress.`,
        data: { received: next.schema_version, supported: SUPPORTED_SCHEMA_VERSION },
      });
    }
    const installed = next.store?.headpress_version;
    if (installed && compareVersions(installed, MIN_HEADPRESS_VERSION) < 0 && !warnedVersion) {
      warnedVersion = true;
      warn({
        code: "headpress_version",
        message: `Headpress ${installed} is older than ${MIN_HEADPRESS_VERSION}, the oldest this SDK supports. Update the plugin.`,
        data: { installed, minimum: MIN_HEADPRESS_VERSION },
      });
    }
    const changed = config?.version !== next.version;
    config = next;
    etag = nextEtag ?? (next.version ? `"${next.version}"` : null);
    loadedAt = now();
    if (changed) listeners.forEach((listener) => listener(next));
  };

  if (options.initial) accept(options.initial, null);

  async function load(signal?: AbortSignal): Promise<StoreConfig> {
    try {
      const response = await transport.raw<unknown>("/store/config", {
        ifNoneMatch: config && etag ? etag : undefined,
        cacheTags: ["headpress:config"],
        fetchOptions: options.fetchOptions,
        signal,
      });
      if (response.notModified && config) {
        loadedAt = now();
        return config;
      }
      if (!isStoreConfig(response.data)) {
        // A proxy error page or a half-installed plugin must not replace a good copy.
        throw new HeadpressError(
          SdkErrorCode.invalidConfig,
          "Headpress answered /store/config with something that is not a store config.",
          502,
        );
      }
      accept(response.data, response.headers.get("ETag"));
      return response.data;
    } catch (error) {
      if (config && now() - loadedAt <= maxStale) {
        warn({
          code: "config_stale",
          message: "Could not refresh the Headpress store config; serving the last good copy.",
          data: { error, ageMs: now() - loadedAt },
        });
        return config;
      }
      throw error;
    }
  }

  return {
    get(getOptions = {}) {
      if (config && !getOptions.force && now() - loadedAt < ttl) return Promise.resolve(config);
      inflight ??= load(getOptions.signal).finally(() => {
        inflight = null;
      });
      return inflight;
    },
    peek: () => config,
    hydrate(next, nextEtag = null) {
      accept(next, nextEtag);
    },
    invalidate() {
      loadedAt = 0;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get etag() {
      return etag;
    },
  };
}
