/**
 * Where the tracker keeps the visitor's identity (`identify()`): email, phone, names and a stable
 * pseudonymous `external_id`.
 *
 * Writing the identity to storage sends nothing anywhere: the tracker only hands it to providers the
 * visitor's consent allows. Persisting it lets events on later pages and visits still carry the
 * identifiers the platforms match on.
 */
import type { AnalyticsIdentity } from "./events.js";
import { isBrowserEnv, randomId, readJson, writeJson } from "./env.js";

export interface IdentityStore {
  get(): AnalyticsIdentity;
  set(identity: AnalyticsIdentity): void;
  clear(): void;
}

const KEYS = [
  "user_id",
  "external_id",
  "email",
  "phone",
  "first_name",
  "last_name",
  "city",
  "state",
  "zip",
  "country",
] as const satisfies readonly (keyof AnalyticsIdentity)[];

/** Only known keys, trimmed, without empty values. */
export function cleanIdentity(input: unknown): AnalyticsIdentity {
  const out: AnalyticsIdentity = {};
  if (!input || typeof input !== "object") return out;
  for (const key of KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);
  }
  return out;
}

/** Identity kept for this page only. */
export function memoryIdentity(initial: AnalyticsIdentity = {}): IdentityStore {
  let identity = cleanIdentity(initial);
  return {
    get: () => ({ ...identity }),
    set: (next) => {
      identity = cleanIdentity(next);
    },
    clear: () => {
      identity = {};
    },
  };
}

export interface LocalIdentityOptions {
  /** localStorage key. Defaults to `hp_identity`. */
  key?: string;
  /** Mint a random `external_id` on first use. Defaults to true. */
  externalId?: boolean;
}

/** Identity kept in localStorage (memory when storage is blocked), with a minted `external_id`. */
export function localIdentity(options: LocalIdentityOptions = {}): IdentityStore {
  const key = options.key ?? "hp_identity";
  const mint = options.externalId ?? true;
  let memory: AnalyticsIdentity | null = null;

  const read = (): AnalyticsIdentity => {
    const stored = readJson("local", key);
    return stored ? cleanIdentity(stored) : (memory ?? {});
  };
  const write = (identity: AnalyticsIdentity): void => {
    memory = identity;
    writeJson("local", key, Object.keys(identity).length > 0 ? identity : null);
  };

  return {
    get() {
      const identity = read();
      // Never on the server: a module-level store there would be shared by every request.
      if (mint && !identity.external_id && isBrowserEnv()) {
        identity.external_id = randomId();
        write(identity);
      }
      return { ...identity };
    },
    set: (next) => write(cleanIdentity(next)),
    clear: () => {
      memory = null;
      writeJson("local", key, null);
    },
  };
}
