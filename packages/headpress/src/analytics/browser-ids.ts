/**
 * The browser and click ids the ad platforms use to tie a conversion to the visit behind it.
 *
 * - GA4 client and session ids, from the `_ga` and `_ga_<stream>` cookies, so the purchase Headpress
 *   sends later (Measurement Protocol) lands on the same user and session.
 * - Meta `fbp` / `fbc`: the `_fbp` and `_fbc` cookies, or `fbc` built from the landing `fbclid`
 *   (`fb.1.<ms>.<fbclid>`, Meta's format) when the pixel has not written `_fbc`.
 * - Pinterest `epik`: the click id Pinterest appends to ad landing URLs (`?epik=`), or `_epik`.
 *
 * Landing click ids usually arrive before the shopper answers the banner, so they are held in
 * sessionStorage for the visit; nothing is returned (or written to a lasting cookie) without the
 * matching consent category.
 */
import type { ConsentState } from "./consent.js";
import { currentUrl, readCookie, readCookies, readJson, writeCookie, writeJson } from "./env.js";

export interface BrowserIds {
  ga_client_id?: string;
  ga_session_id?: string;
  fbp?: string;
  fbc?: string;
  epik?: string;
}

export interface BrowserIdsOptions {
  /** GA4 stream (`G-XXXX`): names the session cookie. Without it the first `_ga_*` cookie is read. */
  measurementId?: string;
  /** Category GA ids need. Defaults to `analytics`. */
  analyticsCategory?: string;
  /** Category the Meta and Pinterest ids need. Defaults to `marketing`. */
  marketingCategory?: string;
  /** Page URL to read click ids from. Defaults to the current page. */
  url?: string;
  /** sessionStorage key of the landing click ids. Defaults to `hp_click_ids`. */
  storageKey?: string;
  /** Lasting cookie for the Pinterest click id (30 days, written only with consent). Defaults to `hp_epik`. */
  epikCookie?: string;
}

interface LandingIds {
  epik?: string;
  fbclid?: string;
  /** When the fbclid was first seen, ms: the `fbc` creation time. */
  fbclid_at?: number;
}

const EPIK = /^[A-Za-z0-9_\-.=~+/]{8,512}$/;
const FBCLID = /^[A-Za-z0-9_\-.]{8,500}$/;
const FBP = /^fb\.\d\.\d{10,13}\.\d{1,20}$/;
const FBC = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_\-.]{8,500}$/;
const EPIK_DAYS = 30;

/** The GA4 client id (`<random>.<seconds>`) from a `_ga` cookie such as `GA1.1.1996991888.1789498255`. */
export function parseGaClientId(cookie: string | null | undefined): string | undefined {
  const parts = String(cookie ?? "").split(".");
  if (parts.length < 4) return undefined;
  const id = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return /^\d{1,20}\.\d{1,20}$/.test(id) ? id : undefined;
}

/** The GA4 session id from a `_ga_<stream>` cookie, in both formats (`GS1.1.<id>.…`, `GS2.1.s<id>$…`). */
export function parseGaSessionId(cookie: string | null | undefined): string | undefined {
  const value = String(cookie ?? "");
  const gs2 = /^GS2\.\d+\.s(\d{1,20})/.exec(value);
  if (gs2) return gs2[1];
  const parts = value.split(".");
  return parts[0] === "GS1" && /^\d{1,20}$/.test(parts[2] ?? "") ? parts[2] : undefined;
}

/**
 * Remember the click ids of a page URL (`epik`, `fbclid`) for the rest of the visit. `browserIds()`
 * calls it; call it yourself on every navigation when you read the ids only at checkout.
 */
export function captureClickIds(url: string | undefined = currentUrl(), storageKey = "hp_click_ids"): void {
  if (!url) return;
  let params: URLSearchParams;
  try {
    params = new URL(url, "http://localhost").searchParams;
  } catch {
    return;
  }
  const epik = params.get("epik") ?? "";
  const fbclid = params.get("fbclid") ?? "";
  if (!epik && !fbclid) return;
  const stored = (readJson("session", storageKey) as LandingIds | null) ?? {};
  const next: LandingIds = { ...stored };
  if (EPIK.test(epik)) next.epik = epik;
  if (FBCLID.test(fbclid) && fbclid !== stored.fbclid) {
    next.fbclid = fbclid;
    next.fbclid_at = Date.now();
  }
  writeJson("session", storageKey, next);
}

function granted(state: ConsentState, category: string): boolean {
  return state.decided && state.categories.includes(category);
}

/**
 * The ids the visitor's consent allows: GA ids with the analytics category, Meta and Pinterest ids
 * with the marketing one. `{}` on the server or while undecided.
 */
export function browserIds(consent: ConsentState, options: BrowserIdsOptions = {}): BrowserIds {
  const storageKey = options.storageKey ?? "hp_click_ids";
  const url = options.url ?? currentUrl();
  if (!url && typeof document === "undefined") return {};
  captureClickIds(url, storageKey);
  const out: BrowserIds = {};

  if (granted(consent, options.analyticsCategory ?? "analytics")) {
    const clientId = parseGaClientId(readCookie("_ga"));
    if (clientId) out.ga_client_id = clientId;
    const stream = (options.measurementId ?? "").replace(/^G-/i, "");
    const sessionCookie = stream ? readCookie(`_ga_${stream}`) : (readCookies(/^_ga_[A-Z0-9]+$/)[0]?.[1] ?? null);
    const sessionId = parseGaSessionId(sessionCookie);
    if (sessionId) out.ga_session_id = sessionId;
  }

  if (granted(consent, options.marketingCategory ?? "marketing")) {
    const landing = (readJson("session", storageKey) as LandingIds | null) ?? {};
    const epikCookie = options.epikCookie ?? "hp_epik";
    const epik = landing.epik || readCookie(epikCookie) || readCookie("_epik") || "";
    if (EPIK.test(epik)) {
      out.epik = epik;
      // Keep the click for later visits now that consent allows a lasting cookie.
      if (landing.epik) writeCookie(epikCookie, landing.epik, { maxAgeSeconds: EPIK_DAYS * 86_400 });
    }
    const fbp = readCookie("_fbp") ?? "";
    if (FBP.test(fbp)) out.fbp = fbp;
    const fbcCookie = readCookie("_fbc") ?? "";
    const built = landing.fbclid && landing.fbclid_at ? `fb.1.${landing.fbclid_at}.${landing.fbclid}` : "";
    const fbc = FBC.test(fbcCookie) ? fbcCookie : built;
    if (FBC.test(fbc)) out.fbc = fbc;
  }

  return out;
}
