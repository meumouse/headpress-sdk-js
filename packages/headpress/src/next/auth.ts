/**
 * `createAuthHandler()`: the storefront's own auth routes (backend-for-frontend).
 *
 * Mount it on a catch-all route and pair it with `bffSession()` in the browser:
 *
 * ```ts
 * // app/api/auth/[...action]/route.ts
 * export const { POST } = createAuthHandler({
 *   baseUrl: process.env.NEXT_PUBLIC_WP_URL!,
 *   publishableKey: process.env.NEXT_PUBLIC_HEADPRESS_PUBLISHABLE_KEY,
 *   secretKey: process.env.HEADPRESS_SECRET_KEY,
 * });
 * ```
 *
 * Actions: `login`, `register`, `google`, `otp/start`, `otp/verify`, `otp/resend`, `otp/register`,
 * `refresh`, `logout`, `password`, `password-reset`, `password-reset/confirm`.
 *
 * - The refresh token lives in an httpOnly cookie scoped to the auth routes (`hp_rt`); the browser
 *   gets only the access token. A second, non-secret cookie (`hp_session`) tells the page a session
 *   exists, so guests never ask for a refresh.
 * - Requests must be same-origin JSON: a cross-site form cannot post JSON without a CORS preflight,
 *   and a foreign `Origin` is refused.
 * - Only the fields each action needs are forwarded, with the shopper's Cart-Token and captcha, and
 *   the shopper's IP (with the secret key) so Headpress rate-limits per shopper.
 */
import { createHeadpress } from "../client.js";
import { memoryCartToken } from "../cart-token.js";
import { isHeadpressError } from "../errors.js";
import { clientIp, createServerHeadpress, type ClientIpOptions } from "../server/index.js";

export interface AuthHandlerOptions {
  baseUrl: string;
  publishableKey?: string;
  /** Needed to forward the shopper's IP; without it every shopper shares the server's rate limit. */
  secretKey?: string;
  /** Path the handler is mounted at. Defaults to `/api/auth`. */
  basePath?: string;
  cookies?: {
    /** Refresh-token cookie (httpOnly). Defaults to `hp_rt`. */
    refresh?: string;
    /** Marker cookie (readable by the page, no secret). Defaults to `hp_session`. */
    marker?: string;
    /** Defaults to true on https requests. */
    secure?: boolean;
    sameSite?: "Lax" | "Strict";
    domain?: string;
  };
  clientIp?: ClientIpOptions;
  /** Origins allowed besides the request's own (a storefront on several domains). */
  allowedOrigins?: readonly string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface SessionBody {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  cart_token?: string | null;
  customer?: unknown;
  [key: string]: unknown;
}

type Action = {
  path: string;
  fields: readonly string[];
  cart?: boolean;
  captcha?: boolean;
};

const ACTIONS: Record<string, Action> = {
  login: { path: "/store/auth/login", fields: ["login", "password"], cart: true, captcha: true },
  register: { path: "/store/auth/register", fields: ["email", "password", "first_name", "last_name"], cart: true, captcha: true },
  google: { path: "/store/auth/google", fields: ["credential"], cart: true },
  "otp/start": { path: "/store/auth/otp/start", fields: ["channel", "recipient", "purpose"], captcha: true },
  "otp/verify": { path: "/store/auth/otp/verify", fields: ["challenge_id", "code"], cart: true },
  "otp/resend": { path: "/store/auth/otp/resend", fields: ["challenge_id"] },
  "otp/register": { path: "/store/auth/otp/register", fields: ["registration_token", "email", "password", "first_name", "last_name"], cart: true },
  "password-reset": { path: "/store/auth/password-reset", fields: ["login"], captcha: true },
  "password-reset/confirm": { path: "/store/auth/password-reset/confirm", fields: ["login", "key", "password"] },
};

function json(body: unknown, status: number, cookies: string[] = []): Response {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return null;
}

function errorResponse(error: unknown): Response {
  if (isHeadpressError(error)) {
    // No response from Headpress: a gateway error, not the shopper's fault.
    const status = error.status === 0 ? (error.code === "headpress_timeout" ? 504 : 502) : error.status;
    return json({ code: error.code, message: error.message, data: { ...error.data, status } }, status);
  }
  return json({ code: "headpress_internal_error", message: "Unexpected error.", data: { status: 500 } }, 500);
}

export function createAuthHandler(options: AuthHandlerOptions): { POST: (request: Request) => Promise<Response> } {
  const basePath = (options.basePath ?? "/api/auth").replace(/\/+$/, "");
  const refreshName = options.cookies?.refresh ?? "hp_rt";
  const markerName = options.cookies?.marker ?? "hp_session";

  const cookieAttributes = (request: Request, path: string, maxAge: number, httpOnly: boolean): string => {
    const secure = options.cookies?.secure ?? new URL(request.url).protocol === "https:";
    return [
      `Path=${path}`,
      `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
      `SameSite=${options.cookies?.sameSite ?? "Lax"}`,
      ...(httpOnly ? ["HttpOnly"] : []),
      ...(secure ? ["Secure"] : []),
      ...(options.cookies?.domain ? [`Domain=${options.cookies.domain}`] : []),
    ].join("; ");
  };

  const sessionCookies = (request: Request, refreshToken: string, maxAge: number): string[] => [
    `${refreshName}=${encodeURIComponent(refreshToken)}; ${cookieAttributes(request, basePath, maxAge, true)}`,
    `${markerName}=1; ${cookieAttributes(request, "/", maxAge, false)}`,
  ];
  const clearCookies = (request: Request): string[] => [
    `${refreshName}=; ${cookieAttributes(request, basePath, 0, true)}`,
    `${markerName}=; ${cookieAttributes(request, "/", 0, false)}`,
  ];

  /** The browser's view of a session: no refresh token. */
  const publicBody = (body: SessionBody): Record<string, unknown> => {
    const { refresh_token: _refresh, refresh_expires_in: _expires, token_type: _type, ...rest } = body;
    return rest;
  };

  const client = (request: Request) => {
    const cartToken = memoryCartToken(request.headers.get("Cart-Token"));
    const common = {
      baseUrl: options.baseUrl,
      publishableKey: options.publishableKey,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      cartToken,
      // Server-side only: never cache auth traffic.
      headers: {} as Record<string, string>,
    };
    const hp = options.secretKey ? createServerHeadpress({ ...common, secretKey: options.secretKey }) : createHeadpress(common);
    return { hp, ip: clientIp(request.headers, options.clientIp) };
  };

  const originAllowed = (request: Request): boolean => {
    if (request.headers.get("sec-fetch-site") === "cross-site") return false;
    const origin = request.headers.get("origin");
    if (!origin) return true;
    const own = new URL(request.url).origin;
    const forwardedHost = request.headers.get("x-forwarded-host");
    const candidates = new Set([own, ...(options.allowedOrigins ?? [])]);
    if (forwardedHost) candidates.add(`${request.headers.get("x-forwarded-proto") ?? "https"}://${forwardedHost}`);
    return candidates.has(origin);
  };

  return {
    async POST(request) {
      const action = new URL(request.url).pathname.replace(/\/+$/, "").slice(basePath.length).replace(/^\/+/, "");
      if (!originAllowed(request)) return json({ code: "headpress_forbidden", message: "Cross-site request.", data: { status: 403 } }, 403);
      if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
        return json({ code: "headpress_invalid_param", message: "Send JSON.", data: { status: 415 } }, 415);
      }

      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = await request.json();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
      } catch {
        return json({ code: "headpress_invalid_param", message: "Invalid JSON.", data: { status: 400 } }, 400);
      }

      const { hp, ip } = client(request);
      const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;

      try {
        if (action === "refresh") {
          const refreshToken = readCookie(request, refreshName);
          if (!refreshToken) return json({ code: "headpress_unauthorized", message: "No session.", data: { status: 401 } }, 401, clearCookies(request));
          let body: SessionBody;
          try {
            body = await hp.request<SessionBody>("/store/auth/refresh", { method: "POST", body: { refresh_token: refreshToken }, clientIp: ip });
          } catch (error) {
            if (isHeadpressError(error) && (error.status === 401 || error.status === 403)) {
              return json({ code: error.code, message: error.message, data: { status: error.status } }, error.status, clearCookies(request));
            }
            throw error;
          }
          const customer = await hp.request("/store/customers/me", { auth: "required", accessToken: body.access_token, clientIp: ip }).catch(() => null);
          return json(
            { ...publicBody(body), customer },
            200,
            body.refresh_token ? sessionCookies(request, body.refresh_token, body.refresh_expires_in ?? 2_592_000) : [],
          );
        }

        if (action === "logout") {
          const refreshToken = readCookie(request, refreshName);
          try {
            if (input.all === true && bearer) {
              await hp.request("/store/auth/logout", { method: "POST", body: { all: true }, auth: "required", accessToken: bearer, clientIp: ip });
            } else if (refreshToken) {
              await hp.request("/store/auth/logout", { method: "POST", body: { refresh_token: refreshToken }, clientIp: ip });
            }
          } catch {
            // Signed out locally whatever Headpress answered.
          }
          return json(null, 204, clearCookies(request));
        }

        if (action === "password") {
          if (!bearer) return json({ code: "headpress_unauthorized", message: "Sign in first.", data: { status: 401 } }, 401);
          const body = await hp.request<SessionBody>("/store/customers/me/password", {
            method: "POST",
            body: { password: input.password, ...(typeof input.current_password === "string" ? { current_password: input.current_password } : {}) },
            auth: "required",
            accessToken: bearer,
            clientIp: ip,
          });
          return json(publicBody(body), 200, body.refresh_token ? sessionCookies(request, body.refresh_token, body.refresh_expires_in ?? 2_592_000) : []);
        }

        const definition = ACTIONS[action];
        if (!definition) return json({ code: "rest_no_route", message: "Unknown auth action.", data: { status: 404 } }, 404);

        const body: Record<string, unknown> = {};
        for (const field of definition.fields) {
          const value = field === "login" ? input.login ?? input.email : input[field];
          if (typeof value === "string" || typeof value === "boolean") body[field] = value;
        }
        const response = await hp.raw<SessionBody | Record<string, unknown>>(definition.path, {
          method: "POST",
          body,
          cartToken: definition.cart,
          captcha: definition.captcha ? request.headers.get("X-Headpress-Captcha") ?? undefined : undefined,
          clientIp: ip,
        });
        const data = response.data as SessionBody | undefined;
        if (data && typeof data.access_token === "string" && typeof data.refresh_token === "string") {
          return json(publicBody(data), response.status, sessionCookies(request, data.refresh_token, data.refresh_expires_in ?? 2_592_000));
        }
        return json(data ?? null, response.status);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
