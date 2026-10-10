/**
 * Guarded access to browser APIs for the analytics entry.
 *
 * Nothing here touches `window` or `document` at import time, and every access is wrapped: blocked
 * storage (privacy mode, sandboxed iframes) and cookie access throw, and analytics must never break
 * a page because of that. On the server every helper returns its "nothing there" value.
 */

/** The browser window, or undefined on the server. */
export function browserWindow(): (Window & typeof globalThis) | undefined {
  return typeof window !== "undefined" && typeof document !== "undefined" ? window : undefined;
}

export function isBrowserEnv(): boolean {
  return browserWindow() !== undefined;
}

/** The current page URL, or undefined on the server. */
export function currentUrl(): string | undefined {
  try {
    return browserWindow()?.location?.href;
  } catch {
    return undefined;
  }
}

export function userAgent(): string {
  try {
    return browserWindow()?.navigator?.userAgent ?? "";
  } catch {
    return "";
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A cookie of `document.cookie`, decoded, or null. */
export function readCookie(name: string): string | null {
  try {
    if (typeof document === "undefined") return null;
    for (const part of String(document.cookie ?? "").split(";")) {
      const trimmed = part.trim();
      const index = trimmed.indexOf("=");
      const key = index === -1 ? trimmed : trimmed.slice(0, index);
      if (key === name) return decode(index === -1 ? "" : trimmed.slice(index + 1));
    }
  } catch {
    // Cookie access throws in sandboxed documents.
  }
  return null;
}

/** Every cookie whose name matches `pattern`, as `[name, decoded value]` pairs. */
export function readCookies(pattern: RegExp): [string, string][] {
  const out: [string, string][] = [];
  try {
    if (typeof document === "undefined") return out;
    for (const part of String(document.cookie ?? "").split(";")) {
      const trimmed = part.trim();
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index);
      if (pattern.test(key)) out.push([key, decode(trimmed.slice(index + 1))]);
    }
  } catch {
    // See readCookie.
  }
  return out;
}

export interface CookieWriteOptions {
  /** Seconds; ignored when deleting. */
  maxAgeSeconds: number;
  path?: string;
  domain?: string;
  sameSite?: "Lax" | "Strict" | "None";
  /** Defaults to true on https pages and with SameSite=None. */
  secure?: boolean;
}

/** Write (or, with null, delete) a first-party cookie. Returns false when it could not. */
export function writeCookie(name: string, value: string | null, options: CookieWriteOptions): boolean {
  try {
    if (typeof document === "undefined") return false;
    const sameSite = options.sameSite ?? "Lax";
    let https = false;
    try {
      https = browserWindow()?.location?.protocol === "https:";
    } catch {
      https = false;
    }
    const parts = [
      `${name}=${value === null ? "" : encodeURIComponent(value)}`,
      `Path=${options.path ?? "/"}`,
      `Max-Age=${value === null ? 0 : Math.max(0, Math.floor(options.maxAgeSeconds))}`,
      `SameSite=${sameSite}`,
    ];
    if (options.domain) parts.push(`Domain=${options.domain}`);
    if (options.secure ?? (sameSite === "None" || https)) parts.push("Secure");
    document.cookie = parts.join("; ");
    return true;
  } catch {
    return false;
  }
}

export type StorageKind = "local" | "session";

/** `localStorage` / `sessionStorage`, or null when absent or blocked. */
export function storage(kind: StorageKind): Storage | null {
  try {
    const win = browserWindow();
    if (!win) return null;
    return (kind === "local" ? win.localStorage : win.sessionStorage) ?? null;
  } catch {
    return null;
  }
}

/** A JSON value from storage, or null when missing, unreadable or blocked. */
export function readJson(kind: StorageKind, key: string): unknown {
  try {
    const raw = storage(kind)?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** Store a JSON value (null removes it). Returns false when storage is full or blocked. */
export function writeJson(kind: StorageKind, key: string, value: unknown): boolean {
  try {
    const target = storage(kind);
    if (!target) return false;
    if (value === null || value === undefined) target.removeItem(key);
    else target.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Random opaque id: a UUID when Web Crypto is there, else a time-plus-random string. */
export function randomId(): string {
  try {
    if (typeof crypto !== "undefined") {
      if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
      if (typeof crypto.getRandomValues === "function") {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
    }
  } catch {
    // Fall through to the non-cryptographic id.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Short random suffix for event ids: base36, from Web Crypto when available. */
export function randomSuffix(length = 8): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
    }
  } catch {
    // Fall through.
  }
  let out = "";
  while (out.length < length) out += Math.random().toString(36).slice(2);
  return out.slice(0, length);
}

/** Append an async `<script>` once (by `src`). Returns false on the server or when it failed. */
export function injectScript(src: string): boolean {
  try {
    if (typeof document === "undefined") return false;
    const existing = typeof document.querySelector === "function" ? document.querySelector(`script[src="${src}"]`) : null;
    if (existing) return true;
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    (document.head ?? document.body ?? document.documentElement).appendChild(script);
    return true;
  } catch {
    return false;
  }
}

/** Drop undefined, null, empty strings and empty arrays (payloads stay small and honest). */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
