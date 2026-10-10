/**
 * The one HTTP layer between the SDK and WordPress.
 *
 * Each call says what the route needs and the transport attaches exactly that:
 *
 * - `X-Headpress-Key` — the publishable key, on `headpress/v1` routes.
 * - `Authorization: Bearer <access token>` — only when the call asks for it (`auth`). Public reads
 *   go out without it on purpose: Headpress turns caching off (`private, no-store`) for any request
 *   that carries a signed-in customer.
 * - `Cart-Token` — when the call touches the cart; the token that comes back is stored.
 * - `X-Headpress-Captcha` — on routes protected by the captcha module.
 * - Server-only credentials (secret key, forwarded shopper IP) — only through `@meumouse/headpress/server`.
 *
 * Failures of every kind become `HeadpressError`. A 401 on a customer call triggers one token
 * refresh, shared by every call that hit it at the same time, and one replay.
 */
import type { CartTokenStore } from "./cart-token.js";
import {
  errorFromResponse,
  HeadpressError,
  isHeadpressError,
  SdkErrorCode,
  type ErrorRequest,
} from "./errors.js";
import type { TokenStore } from "./session.js";

/** `headpress` → `headpress/v1`, `store` → `wc/store/v1`, anything else is a namespace (`cm-precheckout/v1`). */
export type ApiNamespace = "headpress" | "store" | (string & {});

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;

/**
 * - `none` — never send the access token (public routes; keeps them cacheable).
 * - `optional` — send it when signed in (Store API cart and checkout).
 * - `required` — a customer route; fails with `headpress_not_authenticated` without a session.
 */
export type AuthMode = "none" | "optional" | "required";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  /** Defaults to GET, or POST when there is a body. */
  method?: HttpMethod;
  /** Defaults to `headpress`. */
  api?: ApiNamespace;
  /** Appended to the path's own query. Arrays are sent comma separated; null and undefined are left out. */
  query?: Readonly<Record<string, QueryValue>>;
  /** Plain values are sent as JSON; `FormData`, `URLSearchParams`, `Blob` and strings as they are. */
  body?: unknown;
  /** Defaults to `none`. */
  auth?: AuthMode;
  /** Use this access token instead of the session's (server code acting for one customer). */
  accessToken?: string | null;
  /** Send the stored Cart-Token and store the one that comes back. */
  cartToken?: boolean;
  /** Captcha token for routes the captcha module protects. */
  captcha?: string;
  /** Authenticate with the secret key (`server/*` routes). Server only. */
  secret?: boolean;
  /** Shopper IP to forward for rate limiting. Server only; ignored without a secret key. */
  clientIp?: string | null;
  /** Module the route belongs to: fail fast when the store has it switched off. */
  module?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
  /** Overrides the client's timeout for this call. */
  timeoutMs?: number;
  /** ETag of a cached copy; a 304 answer resolves with `notModified: true`. */
  ifNoneMatch?: string;
  /** Defaults to `json`. */
  responseType?: "json" | "text" | "none";
  /**
   * Cache tags in the Headpress vocabulary (`product:12`, `seo:head`, `headpress:config`…) for what
   * this call reads. The core ignores them; a framework adapter (the Next.js `nextCache()` plugin)
   * turns them into its own cache keys so the revalidation webhook can expire them.
   */
  cacheTags?: readonly string[];
  /** Seconds a framework cache may keep this read (adapter-defined); false for no time limit. */
  revalidate?: number | false;
  /** Extra `fetch` options, e.g. Next.js `{ next: { tags } }` or `{ cache: "no-store" }`. */
  fetchOptions?: Omit<RequestInit, "method" | "headers" | "body" | "signal"> & Record<string, unknown>;
}

export interface RawResponse<T> {
  /** Undefined for 204, 304 and `responseType: "none"`. */
  data: T | undefined;
  status: number;
  headers: Headers;
  notModified: boolean;
  url: string;
}

export interface RequestContext {
  url: URL;
  init: RequestInit & { headers: Headers };
  options: RequestOptions;
}

export interface ResponseContext {
  url: URL;
  response: Response;
  data: unknown;
  options: RequestOptions;
}

export interface ErrorContext {
  url: URL;
  options: RequestOptions;
}

export interface TransportHooks {
  /** Runs before every attempt; may change `init.headers`. */
  onRequest?: (context: RequestContext) => void | Promise<void>;
  onResponse?: (context: ResponseContext) => void | Promise<void>;
  /** May replace the error (translate an add-on's codes, attach data). */
  onError?: (error: HeadpressError, context: ErrorContext) => HeadpressError | void;
}

/** Adds server-only credentials. Installed by `@meumouse/headpress/server`. */
export type ServerAuth = (headers: Headers, options: RequestOptions) => void;

export interface TransportConfig {
  baseUrl: string;
  /** REST prefix of the site. Defaults to `/wp-json`. */
  restPrefix?: string;
  publishableKey?: string;
  fetch?: typeof fetch;
  /** Milliseconds. Defaults to 20 000. */
  timeoutMs?: number;
  /** Sent on every request. */
  headers?: Readonly<Record<string, string>>;
  session?: TokenStore;
  cartToken?: CartTokenStore;
  /** True/false when the store config is known, undefined before it loads. */
  isModuleEnabled?: (id: string) => boolean | undefined;
  /** Header the captcha module reads (`config.modules.captcha.header`). */
  captchaHeader?: () => string | undefined;
  serverAuth?: ServerAuth;
  hooks?: () => readonly TransportHooks[];
}

export interface Transport {
  /** Call a route and resolve its body. */
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  /** Call a route and resolve the body with the status and headers. */
  raw<T = unknown>(path: string, options?: RequestOptions): Promise<RawResponse<T>>;
  /** Absolute URL of a route. */
  url(path: string, options?: Pick<RequestOptions, "api" | "query">): string;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

const NAMESPACES: Record<string, string> = {
  headpress: "headpress/v1",
  store: "wc/store/v1",
};

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function appendQuery(params: URLSearchParams, query: RequestOptions["query"]): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
}

function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === "string" ||
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
  );
}

interface Deadline {
  signal: AbortSignal;
  /** The error for a failed fetch or body read: aborted by the caller, timed out, or network. */
  toError(cause: unknown): HeadpressError;
  clear(): void;
}

/**
 * A timeout plus the caller's signal, as one signal. A plain `setTimeout` rather than
 * `AbortSignal.timeout()`, whose timer is unref'd in Node and does not fire predictably, and a
 * listener rather than `AbortSignal.any()`, which older runtimes lack.
 */
function createDeadline(timeoutMs: number, external: AbortSignal | undefined, request: ErrorRequest): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = (): void => controller.abort(external?.reason);
  if (external?.aborted) forward();
  else external?.addEventListener("abort", forward, { once: true });

  return {
    signal: controller.signal,
    toError(cause) {
      if (isHeadpressError(cause)) return cause;
      if (external?.aborted) {
        return new HeadpressError(SdkErrorCode.aborted, "The request was aborted.", 0, {}, { request, cause });
      }
      if (timedOut) {
        return new HeadpressError(SdkErrorCode.timeout, "Headpress did not answer in time.", 0, {}, { request, cause });
      }
      return new HeadpressError(SdkErrorCode.network, "Could not reach Headpress.", 0, {}, { request, cause });
    },
    clear() {
      clearTimeout(timer);
      external?.removeEventListener("abort", forward);
    },
  };
}

export function createTransport(config: TransportConfig): Transport {
  const base = config.baseUrl.replace(/\/+$/, "");
  const prefix = `/${(config.restPrefix ?? "/wp-json").replace(/^\/+|\/+$/g, "")}`;
  const fetchImpl: typeof fetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const defaultTimeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let refreshing: Promise<string | null> | null = null;

  const hooks = (): readonly TransportHooks[] => config.hooks?.() ?? [];

  function buildUrl(path: string, options: Pick<RequestOptions, "api" | "query">): URL {
    let url: URL;
    if (/^https?:\/\//i.test(path)) {
      // Absolute endpoints published in the store config (an add-on's upload URL, say).
      url = new URL(path);
    } else {
      const api = options.api ?? "headpress";
      const namespace = NAMESPACES[api] ?? api.replace(/^\/+|\/+$/g, "");
      url = new URL(`${base}${prefix}/${namespace}${path.startsWith("/") ? path : `/${path}`}`);
    }
    appendQuery(url.searchParams, options.query);
    return url;
  }

  /** One refresh at a time: refresh tokens rotate, so two in parallel would revoke each other. */
  function refreshOnce(): Promise<string | null> {
    const session = config.session;
    if (!session?.refresh) return Promise.resolve(null);
    refreshing ??= session
      .refresh()
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function resolveToken(options: RequestOptions): Promise<string | null> {
    if (options.accessToken !== undefined) return options.accessToken;
    const auth = options.auth ?? "none";
    const session = config.session;
    if (auth === "none" || !session) return null;
    const token = session.getAccessToken();
    if (token || !session.refresh) return token;
    // Expired (or not yet restored after a page load): renew first when the call cannot go
    // without it, or when there is a session to renew. The Store API silently treats an expired
    // Bearer as a guest, so waiting for a 401 is not an option there.
    if (auth === "required" || session.hasSession?.()) return refreshOnce();
    return null;
  }

  function moduleDisabled(module: string, request: ErrorRequest, cause?: unknown): HeadpressError {
    return new HeadpressError(
      SdkErrorCode.moduleDisabled,
      `The "${module}" module is not enabled in Headpress.`,
      404,
      { module },
      { request, cause },
    );
  }

  async function raw<T>(path: string, options: RequestOptions = {}): Promise<RawResponse<T>> {
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    const api = options.api ?? "headpress";
    const url = buildUrl(path, options);
    const request: ErrorRequest = { method, path: url.pathname };
    let deadline: Deadline | null = null;

    try {
      if (options.module && config.isModuleEnabled?.(options.module) === false) {
        throw moduleDisabled(options.module, request);
      }
      if (options.secret) {
        if (isBrowser()) {
          throw new HeadpressError(
            SdkErrorCode.serverOnly,
            "Calls with the secret key cannot run in the browser.",
            0,
            {},
            { request },
          );
        }
        if (!config.serverAuth) {
          throw new HeadpressError(
            SdkErrorCode.secretMissing,
            "No secret key configured: create the client with createServerHeadpress({ secretKey }).",
            0,
            {},
            { request },
          );
        }
      }

      const token = await resolveToken(options);
      if ((options.auth ?? "none") === "required" && !token && !options.secret) {
        throw new HeadpressError(
          SdkErrorCode.notAuthenticated,
          "This call needs a signed-in customer.",
          401,
          {},
          { request },
        );
      }

      // Serialize once so a replay after a refresh sends the same body.
      const bodyHeaders = new Headers();
      let body: BodyInit | undefined;
      if (options.body !== undefined && options.body !== null) {
        if (isRawBody(options.body)) {
          body = options.body;
          // A JSON string without a type would go out as text/plain, which WordPress does not parse.
          if (typeof options.body === "string") bodyHeaders.set("Content-Type", "application/json");
        } else {
          body = JSON.stringify(options.body);
          bodyHeaders.set("Content-Type", "application/json");
        }
      }

      // One deadline for the whole call, body included, so a stalled response cannot hang it.
      const active = createDeadline(options.timeoutMs ?? defaultTimeout, options.signal, request);
      deadline = active;

      const send = async (bearer: string | null): Promise<Response> => {
        const headers = new Headers({ Accept: "application/json" });
        bodyHeaders.forEach((value, key) => headers.set(key, value));
        for (const [key, value] of Object.entries(config.headers ?? {})) headers.set(key, value);
        new Headers(options.headers).forEach((value, key) => headers.set(key, value));

        if (api === "headpress" && config.publishableKey) headers.set("X-Headpress-Key", config.publishableKey);
        if (options.captcha) headers.set(config.captchaHeader?.() || "X-Headpress-Captcha", options.captcha);
        if (options.cartToken) {
          const cartToken = config.cartToken?.get();
          if (cartToken) headers.set("Cart-Token", cartToken);
        }
        if (bearer && !options.secret) headers.set("Authorization", `Bearer ${bearer}`);
        if (options.ifNoneMatch) headers.set("If-None-Match", options.ifNoneMatch);
        if ((options.secret || options.clientIp) && config.serverAuth) config.serverAuth(headers, options);

        const init: RequestInit & { headers: Headers } = {
          ...options.fetchOptions,
          method,
          headers,
          body,
          signal: active.signal,
        };
        for (const hook of hooks()) await hook.onRequest?.({ url, init, options });

        // Aborted while the token was being resolved: some fetch implementations never settle on
        // a signal that was already aborted when they got it.
        if (active.signal.aborted) throw active.toError(active.signal.reason);
        try {
          return await fetchImpl(url.toString(), init);
        } catch (cause) {
          throw active.toError(cause);
        }
      };

      const storeCartToken = (response: Response): void => {
        if (!options.cartToken || !config.cartToken) return;
        const next = response.headers.get("Cart-Token");
        if (next) config.cartToken.set(next);
      };

      let response = await send(token);
      storeCartToken(response);

      // An access token expires within minutes: renew once and replay. Not for explicit tokens
      // (the caller owns them) nor for public calls, where a 401 means a missing publishable key.
      if (
        response.status === 401 &&
        token &&
        options.accessToken === undefined &&
        (options.auth ?? "none") !== "none"
      ) {
        const renewed = await refreshOnce();
        if (renewed && renewed !== token) {
          response = await send(renewed);
          storeCartToken(response);
        }
      }

      if (response.status === 304) {
        return { data: undefined, status: 304, headers: response.headers, notModified: true, url: url.toString() };
      }

      if (!response.ok) {
        const error = await errorFromResponse(response, request);
        // `rest_no_route` on a module route means the module is off — unless the loaded config says
        // it is on, in which case the route itself is missing (an older Headpress) and says so.
        const moduleOff =
          options.module !== undefined &&
          error.code === "rest_no_route" &&
          config.isModuleEnabled?.(options.module) !== true;
        throw moduleOff && options.module ? moduleDisabled(options.module, request, error) : error;
      }

      let data: unknown;
      const responseType = options.responseType ?? "json";
      if (response.status !== 204 && responseType !== "none") {
        let text: string;
        try {
          text = await response.text();
        } catch (cause) {
          throw active.toError(cause);
        }
        if (responseType === "text") {
          data = text;
        } else if (text.trim() !== "") {
          try {
            data = JSON.parse(text);
          } catch (cause) {
            throw new HeadpressError(
              SdkErrorCode.invalidResponse,
              "Headpress answered with something that is not JSON.",
              response.status,
              {},
              { request, cause },
            );
          }
        }
      }

      for (const hook of hooks()) await hook.onResponse?.({ url, response, data, options });
      return { data: data as T | undefined, status: response.status, headers: response.headers, notModified: false, url: url.toString() };
    } catch (error) {
      if (!isHeadpressError(error)) throw error;
      let current: HeadpressError = error;
      for (const hook of hooks()) current = hook.onError?.(current, { url, options }) ?? current;
      throw current;
    } finally {
      deadline?.clear();
    }
  }

  return {
    raw,
    request: async <T>(path: string, options?: RequestOptions) => (await raw<T>(path, options)).data as T,
    url: (path, options = {}) => buildUrl(path, options).toString(),
  };
}
