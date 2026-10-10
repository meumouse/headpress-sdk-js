/**
 * Where the WooCommerce Store API `Cart-Token` lives.
 *
 * The Cart-Token identifies the shopper's cart session. The Store API returns a fresh one on its
 * responses and Headpress returns the customer's on sign-in (merging the guest cart), so the SDK
 * writes back whatever comes in. Once the shopper signs in, the cart behind the token holds their
 * name, e-mail, phone and addresses: treat the token as personal data.
 *
 * - `cookieCartToken()` — a first-party cookie (`hp_cart`) readable by both the browser and the
 *   server, so server rendering can show the cart. Not httpOnly, so the store must ship a Content
 *   Security Policy against script injection. The recommended default.
 * - `localStorageCartToken()` — browser only.
 * - `memoryCartToken()` — tests and single-request server code.
 */

export interface CartTokenStore {
  get(): string | null;
  set(token: string | null): void;
}

export function memoryCartToken(initial: string | null = null): CartTokenStore {
  let token = initial;
  return {
    get: () => token,
    set: (next) => {
      token = next;
    },
  };
}

export interface LocalStorageCartTokenOptions {
  key?: string;
}

export function localStorageCartToken(options: LocalStorageCartTokenOptions = {}): CartTokenStore {
  const key = options.key ?? "hp_cart_token";
  const storage = (): Storage | null => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      // Blocked storage (privacy mode, sandboxed iframes) throws on access.
      return null;
    }
  };
  return {
    get: () => {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set: (token) => {
      try {
        if (token) storage()?.setItem(key, token);
        else storage()?.removeItem(key);
      } catch {
        // Full or blocked storage: the cart survives this page only.
      }
    },
  };
}

export interface CookieCartTokenOptions {
  /** Cookie name. */
  name?: string;
  /** Lifetime in seconds. The token itself expires sooner; WooCommerce then starts a new cart. */
  maxAgeSeconds?: number;
  path?: string;
  domain?: string;
  sameSite?: "Lax" | "Strict" | "None";
  /** Defaults to true on https pages. */
  secure?: boolean;
  /** Server-side reader (the framework's request cookies). Defaults to `document.cookie`. */
  read?: () => string | null | undefined;
  /** Server-side writer (the framework's response cookies). Defaults to `document.cookie`. */
  write?: (token: string | null, attributes: CookieAttributes) => void;
}

export interface CookieAttributes {
  name: string;
  maxAgeSeconds: number;
  path: string;
  domain: string | undefined;
  sameSite: "Lax" | "Strict" | "None";
  secure: boolean;
}

function readDocumentCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return null;
}

function writeDocumentCookie(token: string | null, attributes: CookieAttributes): void {
  if (typeof document === "undefined") return;
  const parts = [
    `${attributes.name}=${token ? encodeURIComponent(token) : ""}`,
    `Path=${attributes.path}`,
    `Max-Age=${token ? attributes.maxAgeSeconds : 0}`,
    `SameSite=${attributes.sameSite}`,
  ];
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
  if (attributes.secure) parts.push("Secure");
  document.cookie = parts.join("; ");
}

export function cookieCartToken(options: CookieCartTokenOptions = {}): CartTokenStore {
  const sameSite = options.sameSite ?? "Lax";
  const attributes = (): CookieAttributes => ({
    name: options.name ?? "hp_cart",
    maxAgeSeconds: options.maxAgeSeconds ?? 60 * 60 * 24 * 30,
    path: options.path ?? "/",
    domain: options.domain,
    sameSite,
    // SameSite=None is only honoured on Secure cookies.
    secure:
      options.secure ??
      (sameSite === "None" || (typeof location !== "undefined" && location.protocol === "https:")),
  });

  return {
    get: () => (options.read ? (options.read() ?? null) : readDocumentCookie(attributes().name)) || null,
    set: (token) => {
      const attrs = attributes();
      if (options.write) options.write(token, attrs);
      else writeDocumentCookie(token, attrs);
    },
  };
}
