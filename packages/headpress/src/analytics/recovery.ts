/**
 * Abandoned-cart recovery links: `<cart route>?recover=<Cart-Token>`.
 *
 * A module that messages the shopper (a Joinotify flow, an email) builds the link from the storefront
 * `cart` route and the capture's token. Opening it restores the cart by storing that token as the
 * Cart-Token; the next cart read loads the abandoned cart. The token is a bearer credential for the
 * cart, so it must leave the address bar right away (no bookmark, shared link, page view or
 * attribution should carry it): replace the URL with the one `consumeRecoveryToken()` returns.
 */
import type { CartTokenStore } from "../cart-token.js";

/** The Store API Cart-Token is a JWT: base64url segments joined by dots. */
const TOKEN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/;
const MAX_TOKEN_LENGTH = 2048;
const BASE = "http://localhost";

function parse(url: string | URL): { parsed: URL; absolute: boolean } | null {
  try {
    if (url instanceof URL) return { parsed: new URL(url.href), absolute: true };
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(url);
    return { parsed: new URL(url, BASE), absolute };
  } catch {
    return null;
  }
}

function serialize(parsed: URL, absolute: boolean): string {
  return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** `url` without a query parameter (the recovery token by default). Unparseable URLs come back as they are. */
export function withoutParam(url: string, param = "recover"): string {
  const result = parse(url);
  if (!result || !result.parsed.searchParams.has(param)) return url;
  result.parsed.searchParams.delete(param);
  return serialize(result.parsed, result.absolute);
}

/**
 * Take the recovery token out of a URL and store it as the Cart-Token.
 *
 * Returns the URL without the parameter — hand it to `history.replaceState` — or null when the URL
 * has no recovery parameter. A malformed token is not stored, but still removed from the URL.
 */
export function consumeRecoveryToken(url: string | URL, cartToken: CartTokenStore, param = "recover"): string | null {
  const result = parse(url);
  if (!result || !result.parsed.searchParams.has(param)) return null;
  const token = (result.parsed.searchParams.get(param) ?? "").trim();
  result.parsed.searchParams.delete(param);
  if (token && token.length <= MAX_TOKEN_LENGTH && TOKEN.test(token)) {
    try {
      cartToken.set(token);
    } catch {
      // A store that cannot write keeps the current cart.
    }
  }
  return serialize(result.parsed, result.absolute);
}
