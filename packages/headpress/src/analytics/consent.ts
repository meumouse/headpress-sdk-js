/**
 * Cookie consent: the shopper's decision, Google Consent Mode v2 signals and Headpress' proof of
 * consent log (`consent` module).
 *
 * - The decision is kept in a first-party cookie (`hp_consent`) for `cookie_days`, readable by the
 *   server too, so server rendering knows whether to show the banner.
 * - It is versioned: a decision made under an older `modules.consent.version` counts as undecided,
 *   because it no longer covers what the store does with the data. The banner asks again.
 * - Required categories (`necessary`) are always granted and cannot be refused.
 * - Nothing here sends anything by itself. `recordConsent()` posts a decision to Headpress, and the
 *   tracker (`createTracker`) is what holds analytics back until consent is decided.
 */
import type { HeadpressClient } from "../client.js";
import type { ConsentModuleConfig } from "../types.js";
import { readCookie, randomId, writeCookie } from "./env.js";

export type ConsentSignal = "granted" | "denied";

/** The Google Consent Mode v2 types. */
export type ConsentModeType =
  | "ad_storage"
  | "ad_user_data"
  | "ad_personalization"
  | "analytics_storage"
  | "functionality_storage"
  | "personalization_storage"
  | "security_storage";

/** Signals for `gtag('consent', 'default' | 'update', …)`. */
export type ConsentModeState = Record<ConsentModeType, ConsentSignal> & { [type: string]: ConsentSignal };

/** `gtag('consent', 'default', …)`: the undecided signals plus `wait_for_update`. */
export interface ConsentModeDefaults extends Record<ConsentModeType, ConsentSignal> {
  wait_for_update?: number;
  [type: string]: ConsentSignal | number | undefined;
}

export interface ConsentState {
  /** Whether the shopper made a choice under the current consent version. */
  decided: boolean;
  /** Consent version the choice was made under; null while undecided. */
  version: number | null;
  /** Granted category ids. Always includes the required ones. */
  categories: string[];
  /** Pseudonymous id of the decision (sent to Headpress' consent log); null while undecided. */
  id: string | null;
}

/** The consent module config, or a getter for it (the store config usually loads later). */
export type ConsentConfigSource =
  | ConsentModuleConfig
  | null
  | undefined
  | (() => ConsentModuleConfig | null | undefined);

export interface ConsentOptions {
  /**
   * `config.modules.consent`, or a getter such as `() => hp.capabilities.get("consent")`. Gives the
   * version, the categories (required ones, the full list for `acceptAll`) and the cookie lifetime.
   * Without it, stored decisions are taken as they are and the default categories apply.
   */
  config?: ConsentConfigSource;
  /** Cookie name. Defaults to `hp_consent`. */
  cookieName?: string;
  /** Cookie lifetime in days. Defaults to the module's `cookie_days`, else 180. */
  cookieDays?: number;
  path?: string;
  domain?: string;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
  /** Server-side reader (the framework's request cookie value). Defaults to `document.cookie`. */
  read?: () => string | null | undefined;
  /** Server-side writer. Defaults to `document.cookie`. */
  write?: (value: string | null, attributes: { name: string; maxAgeSeconds: number }) => void;
}

export interface Consent {
  /** The current decision (undecided when there is none, or it was made under an older version). */
  get(): ConsentState;
  /** Decide: grant these categories (plus the required ones), refuse the rest. */
  grant(categories: readonly string[]): ConsentState;
  /** Grant every category the store lists. */
  acceptAll(): ConsentState;
  /** Refuse everything but the required categories. */
  rejectAll(): ConsentState;
  /** Whether a category is granted. Required categories always are. */
  has(category: string): boolean;
  /** Forget the decision (the banner shows again). */
  reset(): void;
  /** Called after every change made through this object. Returns the unsubscribe function. */
  subscribe(listener: (state: ConsentState) => void): () => void;
  /** The consent module config in use, when known. */
  config(): ConsentModuleConfig | undefined;
}

/** Category ids Headpress uses when the store config does not list any. */
export const DEFAULT_CONSENT_CATEGORIES: readonly string[] = ["necessary", "preferences", "analytics", "marketing"];

/** Google Consent Mode type → Headpress category, Headpress' defaults. */
export const DEFAULT_CONSENT_MODE: Readonly<Record<ConsentModeType, string>> = {
  ad_storage: "marketing",
  ad_user_data: "marketing",
  ad_personalization: "marketing",
  analytics_storage: "analytics",
  functionality_storage: "necessary",
  personalization_storage: "preferences",
  security_storage: "necessary",
};

const DEFAULT_COOKIE_DAYS = 180;

interface StoredConsent {
  id: string;
  version: number;
  categories: string[];
  at: string;
}

function resolveConfig(source: ConsentConfigSource): ConsentModuleConfig | undefined {
  try {
    const value = typeof source === "function" ? source() : source;
    return value && typeof value === "object" && (value as { enabled?: unknown }).enabled !== false ? value : undefined;
  } catch {
    return undefined;
  }
}

function configVersion(config: ConsentModuleConfig | undefined): number {
  const version = config?.version;
  return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : 1;
}

/** Required category ids: from the config, else `necessary`. */
export function requiredCategories(config?: ConsentModuleConfig | null): string[] {
  const listed = Array.isArray(config?.categories) ? config.categories : [];
  const required = listed.filter((category) => category && category.required === true).map((category) => category.id);
  return required.length > 0 ? required : ["necessary"];
}

/** Every category id the store lists, else Headpress' defaults. */
export function knownCategories(config?: ConsentModuleConfig | null): string[] {
  const listed = Array.isArray(config?.categories) ? config.categories.map((category) => category?.id).filter(Boolean) : [];
  return listed.length > 0 ? (listed as string[]) : [...DEFAULT_CONSENT_CATEGORIES];
}

/** The Headpress category behind a Consent Mode type, through `consent_mode`. */
export function consentModeCategory(type: ConsentModeType | (string & {}), config?: ConsentModuleConfig | null): string | undefined {
  const map = (config?.consent_mode ?? {}) as Record<string, unknown>;
  const mapped = map[type];
  if (typeof mapped === "string" && mapped) return mapped;
  return (DEFAULT_CONSENT_MODE as Record<string, string>)[type];
}

function parseStored(raw: string | null | undefined): StoredConsent | null {
  if (!raw) return null;
  const attempts = [raw];
  try {
    attempts.push(decodeURIComponent(raw));
  } catch {
    // Not encoded.
  }
  for (const attempt of attempts) {
    try {
      const value = JSON.parse(attempt) as Partial<StoredConsent> | null;
      if (
        value &&
        typeof value === "object" &&
        typeof value.id === "string" &&
        typeof value.version === "number" &&
        Array.isArray(value.categories)
      ) {
        return {
          id: value.id,
          version: value.version,
          categories: value.categories.filter((category): category is string => typeof category === "string"),
          at: typeof value.at === "string" ? value.at : "",
        };
      }
    } catch {
      // Try the next form.
    }
  }
  return null;
}

function undecided(config: ConsentModuleConfig | undefined): ConsentState {
  return { decided: false, version: null, categories: requiredCategories(config), id: null };
}

export function createConsent(options: ConsentOptions = {}): Consent {
  const name = options.cookieName ?? "hp_consent";
  const listeners = new Set<(state: ConsentState) => void>();
  // The last value written, so the decision applies for this page even when cookies are blocked.
  let memory: string | null | undefined;

  const config = (): ConsentModuleConfig | undefined => resolveConfig(options.config);
  const maxAgeSeconds = (): number => {
    const days = options.cookieDays ?? config()?.cookie_days;
    return Math.round((typeof days === "number" && days > 0 ? days : DEFAULT_COOKIE_DAYS) * 86_400);
  };

  const readRaw = (): string | null => {
    let raw: string | null | undefined;
    try {
      raw = options.read ? options.read() : readCookie(name);
    } catch {
      raw = null;
    }
    if (raw) return raw;
    return memory ?? null;
  };

  const writeRaw = (value: string | null): void => {
    memory = value;
    const attributes = { name, maxAgeSeconds: maxAgeSeconds() };
    try {
      if (options.write) options.write(value, attributes);
      else
        writeCookie(name, value, {
          maxAgeSeconds: attributes.maxAgeSeconds,
          path: options.path,
          domain: options.domain,
          sameSite: options.sameSite,
          secure: options.secure,
        });
    } catch {
      // Kept in memory for this page.
    }
  };

  const get = (): ConsentState => {
    const current = config();
    const stored = parseStored(readRaw());
    if (!stored) return undecided(current);
    // A decision made under an older version does not cover the store's current purposes.
    if (current && stored.version < configVersion(current)) return undecided(current);
    const categories = new Set([...requiredCategories(current), ...stored.categories]);
    return { decided: true, version: stored.version, categories: [...categories], id: stored.id };
  };

  const notify = (state: ConsentState): void => {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // A failing listener never blocks the others.
      }
    }
  };

  const grant = (categories: readonly string[]): ConsentState => {
    const current = config();
    const known = new Set(knownCategories(current));
    const granted = new Set(requiredCategories(current));
    for (const category of categories) {
      // Unknown categories are dropped, as Headpress drops them when recording.
      if (typeof category === "string" && (known.has(category) || !current)) granted.add(category);
    }
    const stored: StoredConsent = {
      // Every decision is a new record in Headpress' log.
      id: randomId(),
      version: configVersion(current),
      categories: [...granted],
      at: new Date().toISOString(),
    };
    writeRaw(JSON.stringify(stored));
    const state = get();
    notify(state);
    return state;
  };

  return {
    get,
    grant,
    acceptAll: () => grant(knownCategories(config())),
    rejectAll: () => grant([]),
    has(category) {
      const state = get();
      if (requiredCategories(config()).includes(category)) return true;
      return state.decided && state.categories.includes(category);
    },
    reset() {
      writeRaw(null);
      notify(get());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    config,
  };
}

/**
 * Google Consent Mode v2 signals for a decision: each type is granted when its Headpress category
 * (through `consent_mode`) is granted. While undecided, the module's `consent_defaults` apply
 * (types without a default are denied unless their category is required).
 */
export function consentModeState(state: ConsentState, config?: ConsentModuleConfig | null): ConsentModeState {
  const required = new Set(requiredCategories(config));
  const types = new Set<string>([...Object.keys(DEFAULT_CONSENT_MODE), ...Object.keys(config?.consent_mode ?? {})]);
  const defaults = (config?.consent_defaults ?? {}) as Record<string, unknown>;
  const out: Record<string, ConsentSignal> = {};
  for (const type of types) {
    const category = consentModeCategory(type, config);
    if (!state.decided) {
      const fallback = defaults[type];
      out[type] =
        fallback === "granted" || fallback === "denied" ? fallback : category && required.has(category) ? "granted" : "denied";
      continue;
    }
    out[type] = category && (required.has(category) || state.categories.includes(category)) ? "granted" : "denied";
  }
  return out as ConsentModeState;
}

/**
 * The `gtag('consent', 'default', …)` call to make before any tag loads: the undecided signals plus
 * `wait_for_update` from the module.
 */
export function consentModeDefaults(config?: ConsentModuleConfig | null): ConsentModeDefaults {
  const state = consentModeState({ decided: false, version: null, categories: [], id: null }, config);
  const wait = config?.wait_for_update;
  return typeof wait === "number" && wait > 0 ? { ...state, wait_for_update: wait } : state;
}

/** `{ version, categories }` as `hp.checkout.place({ consent })` sends it. */
export function checkoutConsent(state: ConsentState): { version: number | null; categories: string[] } {
  return { version: state.decided ? state.version : null, categories: [...state.categories] };
}

export interface RecordConsentOptions {
  /** Where the decision was made. Defaults to `banner`. */
  source?: string;
}

/**
 * Post a decision to Headpress' proof-of-consent log (`POST /store/consent`) when the store keeps
 * one (`modules.consent.record_endpoint`). Only explicit decisions are recorded. Never throws:
 * resolves true when Headpress recorded it.
 */
export async function recordConsent(
  hp: Pick<HeadpressClient, "request" | "config" | "capabilities">,
  state: ConsentState,
  options: RecordConsentOptions = {},
): Promise<boolean> {
  try {
    if (!state.decided || !state.id || state.version === null) return false;
    if (!hp.capabilities.known()) await hp.config.get();
    const module = hp.capabilities.get("consent");
    if (!module || !module.record_endpoint) return false;
    await hp.request("/store/consent", {
      method: "POST",
      module: "consent",
      body: { consent_id: state.id, version: state.version, categories: state.categories, source: options.source ?? "banner" },
      fetchOptions: { keepalive: true },
    });
    return true;
  } catch {
    return false;
  }
}
