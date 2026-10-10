/**
 * `bffSession()`: a browser session whose refresh token never reaches JavaScript.
 *
 * The storefront's own server (a backend-for-frontend, e.g. `createAuthHandler()` from
 * `@meumouse/headpress/next`) talks to Headpress for sign-in, keeps the refresh token in an httpOnly
 * cookie and hands the browser only the short-lived access token. This store keeps that token in
 * memory and renews it through the BFF:
 *
 * - one renewal at a time across tabs (`navigator.locks`), so rotating refresh tokens never race;
 * - a renewal answered 401 is retried once — another tab may have rotated the cookie a moment ago;
 * - new tokens and sign-outs are shared with the other tabs (`BroadcastChannel`);
 * - `hasSession()` reads the BFF's non-secret marker cookie, so guests never trigger renewals.
 *
 * The `hp.auth` methods detect this store and go through the BFF instead of Headpress.
 */
import type { Customer } from "./account-types.js";
import { errorFromResponse, HeadpressError, SdkErrorCode } from "./errors.js";
import type { AuthTokens, SessionListener, TokenStore } from "./session.js";

export interface BffSessionOptions {
  /** Where the BFF routes live, on the storefront's origin. Defaults to `/api/auth`. */
  basePath?: string;
  /** Name of the BFF's marker cookie (not the refresh token). Defaults to `hp_session`. */
  markerCookie?: string;
  fetch?: typeof fetch;
  /** Seconds shaved off the token lifetime. Defaults to 30. */
  skewSeconds?: number;
}

/** What the BFF answers after a sign-in, a refresh or a password change. */
export interface BffSessionBody {
  access_token: string;
  expires_in: number;
  cart_token?: string | null;
  customer?: Customer | null;
  purpose?: "login" | "recovery";
  grant?: { expires_in: number };
}

export interface BffSession extends TokenStore {
  readonly bff: {
    basePath: string;
    /** POST a BFF action (`login`, `otp/verify`…) and resolve its JSON body. */
    request<T>(action: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
  };
  hasSession(): boolean;
  /** The customer the last sign-in or renewal returned. */
  customer(): Customer | null;
  /** Take a BFF session body (sign-in answer) and share it with the other tabs. */
  accept(body: BffSessionBody): void;
  /** Forget the session here and in the other tabs (after a sign-out). */
  forget(): void;
  subscribe(listener: SessionListener): () => void;
  refresh(): Promise<string | null>;
}

type Message = { type: "tokens"; access_token: string; expires_at: number; customer: Customer | null } | { type: "signed_out" };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function bffSession(options: BffSessionOptions = {}): BffSession {
  const basePath = (options.basePath ?? "/api/auth").replace(/\/+$/, "");
  const marker = options.markerCookie ?? "hp_session";
  const skew = options.skewSeconds ?? 30;
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  let access: string | null = null;
  let expiresAt = 0;
  let customer: Customer | null = null;
  let signedOut = false;
  let refreshing: Promise<string | null> | null = null;
  const listeners = new Set<SessionListener>();

  const channel: BroadcastChannel | null =
    typeof BroadcastChannel === "function" ? new BroadcastChannel("hp-auth") : null;

  const notify = (): void => listeners.forEach((listener) => listener(access));
  const set = (token: string | null, until: number, who: Customer | null): void => {
    access = token;
    expiresAt = until;
    if (who !== null || token === null) customer = who;
    notify();
  };

  channel?.addEventListener("message", (event: MessageEvent<Message>) => {
    const message = event.data;
    if (message?.type === "tokens") {
      signedOut = false;
      set(message.access_token, message.expires_at, message.customer);
    } else if (message?.type === "signed_out") {
      signedOut = true;
      set(null, 0, null);
    }
  });

  async function request<T>(action: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const path = `${basePath}/${action.replace(/^\/+/, "")}`;
    let response: Response;
    try {
      response = await fetchImpl(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body ?? {}),
      });
    } catch (cause) {
      throw new HeadpressError(SdkErrorCode.network, "Could not reach the storefront auth routes.", 0, {}, { cause, request: { method: "POST", path } });
    }
    if (!response.ok) throw await errorFromResponse(response, { method: "POST", path });
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const accept = (body: BffSessionBody): void => {
    signedOut = false;
    const until = Date.now() + Math.max(body.expires_in - skew, 1) * 1000;
    set(body.access_token, until, body.customer ?? null);
    channel?.postMessage({ type: "tokens", access_token: body.access_token, expires_at: until, customer: body.customer ?? null } satisfies Message);
  };

  const forget = (): void => {
    signedOut = true;
    set(null, 0, null);
    channel?.postMessage({ type: "signed_out" } satisfies Message);
  };

  async function renew(): Promise<string | null> {
    // Another tab may have renewed while we waited for the lock.
    if (access && Date.now() < expiresAt) return access;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        accept(await request<BffSessionBody>("refresh"));
        return access;
      } catch (error) {
        const status = error instanceof HeadpressError ? error.status : 0;
        if (status === 401 && attempt === 0) {
          // A concurrent renewal elsewhere rotated the cookie: try once more with the new one.
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        if (status === 401 || status === 403) forget();
        return null;
      }
    }
    return null;
  }

  const store: BffSession = {
    bff: { basePath, request },
    getAccessToken: () => (access && Date.now() < expiresAt ? access : null),
    setTokens(tokens: AuthTokens | null) {
      if (!tokens) return forget();
      accept({ access_token: tokens.accessToken, expires_in: tokens.expiresIn ?? 900 });
    },
    hasSession: () => !signedOut && (access !== null || readCookie(marker) !== null),
    customer: () => customer,
    accept,
    forget,
    refresh() {
      if (refreshing) return refreshing;
      const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
      const run = locks ? locks.request("hp-auth-refresh", renew) : renew();
      refreshing = Promise.resolve(run).finally(() => {
        refreshing = null;
      });
      return refreshing;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return store;
}

/** Whether a token store is a BFF session (the auth resource then goes through the BFF). */
export function isBffSession(store: TokenStore | undefined): store is BffSession {
  return Boolean(store && typeof (store as Partial<BffSession>).bff === "object");
}
