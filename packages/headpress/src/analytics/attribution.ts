/**
 * Order attribution for a headless storefront.
 *
 * WooCommerce fills its order attribution (the orders list *Origin* column, the *Order attribution*
 * box, Analytics) from `wc-order-attribution.js`, which never runs on a headless storefront. This
 * captures the same data — like WooCommerce's sourcebuster.js — when the shopper lands, and
 * `checkoutAttribution()` turns it into the reserved keys `hp.checkout.place({ attribution })` sends
 * (`extensions.headpress.attribution`). Headpress hands them to WooCommerce and to its GA4, Meta and
 * Pinterest modules, which report the purchase from the paid order.
 *
 * Sessions: the first page starts one; `sessionMinutes` without activity (WooCommerce's
 * `order_attribution.session_length`, 30 by default) or a new campaign click starts the next. The
 * snapshot lives in localStorage so `session_count` survives across sessions.
 */
import type { WoocommerceModuleConfig } from "../types.js";
import type { BrowserIds } from "./browser-ids.js";
import type { ConsentState } from "./consent.js";
import { browserWindow, currentUrl, readJson, userAgent, writeJson } from "./env.js";
import { withoutParam } from "./recovery.js";

/** WooCommerce's source types. */
export type SourceType = "typein" | "organic" | "referral" | "utm";

export interface AttributionSnapshot {
  source_type: SourceType;
  /** `document.referrer` of the landing page; empty for direct visits. */
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  utm_id: string;
  utm_source_platform: string;
  utm_creative_format: string;
  utm_marketing_tactic: string;
  /** The full landing URL (without the recovery token). */
  session_entry: string;
  /** ISO 8601. */
  session_start_time: string;
  session_pages: number;
  session_count: number;
  user_agent: string;
  /** Epoch ms of the last page view (session expiry). */
  last_activity: number;
}

export interface AttributionOptions {
  /** Minutes without activity that end a session. Defaults to 30. */
  sessionMinutes?: number;
  /** localStorage key. Defaults to `hp_attribution`. */
  storageKey?: string;
  /** Query parameters never kept in `session_entry`. Defaults to `["recover"]` (recovery links). */
  ignoreParams?: readonly string[];
  /** Clock, for tests. */
  now?: () => number;
}

export interface Attribution {
  /**
   * Record a page view: starts a session on the landing page (or after expiry, or on a new campaign
   * click) and counts pages after that. Call on every navigation. Null on the server without a URL.
   */
  capture(url?: string, referrer?: string): AttributionSnapshot | null;
  /** The current (latest) session, or null before the first capture. */
  get(): AttributionSnapshot | null;
  clear(): void;
}

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_source_platform",
  "utm_creative_format",
  "utm_marketing_tactic",
] as const;

/** Paid-click ids that mark a visit as campaign traffic even without UTM tags. */
const CLICK_IDS = ["gclid", "gclsrc", "wbraid", "gbraid", "fbclid", "msclkid", "ttclid", "epik"];

/** Search engine hosts, as Headpress classifies them. */
const SEARCH_ENGINES = [/(^|\.)google\./, /(^|\.)bing\./, /(^|\.)yahoo\./, /(^|\.)duckduckgo\./, /(^|\.)yandex\./, /(^|\.)baidu\./, /(^|\.)ecosia\./, /(^|\.)brave\.com$/, /(^|\.)ask\.com$/, /(^|\.)aol\./];

const BASE = "http://localhost";

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function classify(params: URLSearchParams, referrer: string, pageHost: string): SourceType {
  if (UTM_KEYS.some((key) => params.get(key)) || CLICK_IDS.some((key) => params.get(key))) return "utm";
  const referrerHost = referrer ? host(referrer) : "";
  if (referrerHost && referrerHost !== pageHost) {
    return SEARCH_ENGINES.some((pattern) => pattern.test(referrerHost)) ? "organic" : "referral";
  }
  return "typein";
}

function campaignKey(params: URLSearchParams): string {
  return [...UTM_KEYS, ...CLICK_IDS].map((key) => params.get(key) ?? "").join("|");
}

function isSnapshot(value: unknown): value is AttributionSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AttributionSnapshot).source_type === "string" &&
    typeof (value as AttributionSnapshot).last_activity === "number"
  );
}

export function createAttribution(options: AttributionOptions = {}): Attribution {
  const storageKey = options.storageKey ?? "hp_attribution";
  const sessionMs = Math.max(1, options.sessionMinutes ?? 30) * 60_000;
  const ignore = options.ignoreParams ?? ["recover"];
  const now = options.now ?? Date.now;
  let memory: AttributionSnapshot | null = null;

  const read = (): AttributionSnapshot | null => {
    const stored = readJson("local", storageKey);
    return isSnapshot(stored) ? stored : memory;
  };
  const write = (snapshot: AttributionSnapshot | null): void => {
    memory = snapshot;
    writeJson("local", storageKey, snapshot);
  };

  const start = (url: URL, referrer: string, previous: AttributionSnapshot | null, at: number): AttributionSnapshot => {
    let entry = url.toString();
    for (const param of ignore) entry = withoutParam(entry, param);
    const snapshot: AttributionSnapshot = {
      source_type: classify(url.searchParams, referrer, url.hostname),
      referrer,
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
      utm_term: "",
      utm_content: "",
      utm_id: "",
      utm_source_platform: "",
      utm_creative_format: "",
      utm_marketing_tactic: "",
      session_entry: entry,
      session_start_time: new Date(at).toISOString(),
      session_pages: 1,
      session_count: (previous?.session_count ?? 0) + 1,
      user_agent: userAgent(),
      last_activity: at,
    };
    for (const key of UTM_KEYS) snapshot[key] = url.searchParams.get(key) ?? "";
    return snapshot;
  };

  return {
    capture(url = currentUrl(), referrer) {
      if (!url) return null;
      let parsed: URL;
      try {
        parsed = new URL(url, browserWindow()?.location?.href ?? BASE);
      } catch {
        return null;
      }
      let ref = referrer;
      if (ref === undefined) {
        try {
          ref = typeof document !== "undefined" ? String(document.referrer ?? "") : "";
        } catch {
          ref = "";
        }
      }
      const at = now();
      const previous = read();
      const expired = !previous || at - previous.last_activity > sessionMs;
      const key = campaignKey(parsed.searchParams);
      const newCampaign =
        !!previous && key.replace(/\|/g, "") !== "" && key !== campaignKey(new URL(previous.session_entry || BASE, BASE).searchParams);
      const snapshot = expired || newCampaign
        ? start(parsed, ref, previous, at)
        : { ...previous, session_pages: previous.session_pages + 1, last_activity: at };
      write(snapshot);
      return snapshot;
    },
    get: read,
    clear: () => write(null),
  };
}

export interface CheckoutAttributionOptions {
  /** `config.modules.woocommerce`: its `order_attribution` consent rules apply. */
  woocommerce?: Pick<WoocommerceModuleConfig, "order_attribution"> | null;
  /** The shopper's consent, for those rules. */
  consent?: ConsentState;
}

function value(input: string | number | null | undefined): string | null {
  if (input === undefined || input === null) return null;
  const textValue = String(input).trim();
  return textValue === "" ? null : textValue;
}

function landing(sessionEntry: string): URL | null {
  if (!sessionEntry) return null;
  try {
    return new URL(sessionEntry, BASE);
  } catch {
    return null;
  }
}

/**
 * The reserved attribution keys `hp.checkout.place({ attribution })` sends: the captured session
 * (with `gclid` / `fbclid` / `landing_path` read from the landing URL) plus the browser ids (each
 * already gated by consent in `browserIds()`). Every value is a string or null.
 *
 * Null — send no attribution — when the store's `order_attribution` rules say so: the shopper decided
 * without granting `consent_category`, or `require_consent` is on and there is no decision.
 */
export function checkoutAttribution(
  attribution: Attribution | AttributionSnapshot | null | undefined,
  ids: BrowserIds = {},
  options: CheckoutAttributionOptions = {},
): Record<string, string | null> | null {
  const rules = options.woocommerce?.order_attribution;
  if (rules) {
    const category = typeof rules.consent_category === "string" && rules.consent_category ? rules.consent_category : "marketing";
    const consent = options.consent;
    if (consent?.decided && !consent.categories.includes(category)) return null;
    if (rules.require_consent === true && !consent?.decided) return null;
  }

  const snapshot =
    attribution && "capture" in attribution ? (attribution.get() ?? attribution.capture()) : (attribution ?? null);
  const entry = landing(snapshot?.session_entry ?? "");

  return {
    source_type: value(snapshot?.source_type),
    referrer: value(snapshot?.referrer),
    utm_source: value(snapshot?.utm_source),
    utm_medium: value(snapshot?.utm_medium),
    utm_campaign: value(snapshot?.utm_campaign),
    utm_term: value(snapshot?.utm_term),
    utm_content: value(snapshot?.utm_content),
    utm_id: value(snapshot?.utm_id),
    utm_source_platform: value(snapshot?.utm_source_platform),
    utm_creative_format: value(snapshot?.utm_creative_format),
    utm_marketing_tactic: value(snapshot?.utm_marketing_tactic),
    session_entry: value(snapshot?.session_entry),
    session_start_time: value(snapshot?.session_start_time),
    session_pages: snapshot && snapshot.session_pages > 0 ? String(snapshot.session_pages) : null,
    session_count: snapshot && snapshot.session_count > 0 ? String(snapshot.session_count) : null,
    gclid: value(entry?.searchParams.get("gclid")),
    fbclid: value(entry?.searchParams.get("fbclid")),
    landing_path: entry ? value(entry.pathname) : null,
    user_agent: value(snapshot?.user_agent || userAgent()),
    ga_client_id: value(ids.ga_client_id),
    ga_session_id: value(ids.ga_session_id),
    fbp: value(ids.fbp),
    fbc: value(ids.fbc),
    epik: value(ids.epik),
  };
}
